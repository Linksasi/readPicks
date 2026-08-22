// GUI 全链路测试：启动完整应用 → 通过 IPC 触发查询 → 验证悬浮窗渲染
// npx electron scripts/gui-test.js
const { app, BrowserWindow } = require('electron');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  try {
    require('../main/index'); // 完整初始化（托盘/热键/IPC）
    await sleep(1500);

    const windowMgr = require('../main/window');
    const popup = windowMgr.createPopup();
    popup.webContents.on('console-message', (_e, level, msg) => {
      console.log('[renderer]', level, msg);
    });
    if (popup.webContents.isLoading()) {
      await new Promise((res) => popup.webContents.once('did-finish-load', res));
    }
    await sleep(300);

    const check = (label, cond, detail) => {
      if (!cond) throw new Error(`FAIL ${label}: ${detail}`);
      console.log('PASS', label, detail ? '— ' + detail : '');
    };

    // 1. 单词查询（无 ECDICT → 走在线兜底）
    const payloadStr = await popup.webContents.executeJavaScript(`(async () => {
      try {
        const p = await window.tranen.query('apple');
        return JSON.stringify(p);
      } catch (e) { return 'ERR:' + e.message; }
    })()`, true);
    console.log('Q-RESULT:', String(payloadStr).slice(0, 500));
    const payload = JSON.parse(payloadStr);
    const wordDom = await popup.webContents.executeJavaScript(`({
      word: document.getElementById('word').textContent,
      defs: document.getElementById('defs').children.length,
      meta: document.getElementById('meta').textContent,
      visible: !document.getElementById('word-view').classList.contains('hidden')
    })`);
    check('word render', wordDom.visible && wordDom.word === 'apple', JSON.stringify(wordDom));
    check('word defs', (payload.defs || []).length > 0, `defs=${payload.defs.length}`);
    const defsOpen = await popup.webContents.executeJavaScript(
      `document.getElementById('defs-details').hasAttribute('open')`);
    // 折叠状态应与词汇量状态一致：测过（有英英释义）→ 折叠；未测 → 展开
    check('word defs 折叠状态与词汇量一致', defsOpen === !payload.vocabLevel,
      `open=${defsOpen}, vocabLevel=${!!payload.vocabLevel}`);

    // 2. 句子查询
    await popup.webContents.executeJavaScript(
      `window.tranen.query('The quick brown fox jumps over the lazy dog.')`, true);
    await sleep(2500);
    const sentDom = await popup.webContents.executeJavaScript(`({
      raw: document.getElementById('s-raw').textContent,
      trans: document.getElementById('s-trans').textContent,
      visible: !document.getElementById('sentence-view').classList.contains('hidden')
    })`);
    check('sentence render', sentDom.visible && sentDom.raw.includes('quick brown fox'), JSON.stringify(sentDom));
    check('sentence translation', sentDom.trans.length > 0, sentDom.trans);

    // 3. 数据库应有记录（apple 再次 +1，fox 查询记录）
    const db = require('../main/db');
    const apple = db.getWord('apple');
    check('db persisted', apple && apple.query_count >= 2, `apple count=${apple.query_count}`);
    const appleHist = db.getHistory('apple');
    check('db history', appleHist.length >= 1, `history=${appleHist.length}`);

    // 3.5 语境回溯全链路：模拟复制句子 → 查词 → payload 带语境
    const context = require('../main/context');
    context.push('An apple a day keeps the doctor away.');
    const ctxPayload = JSON.parse(await popup.webContents.executeJavaScript(`(async () => {
      try { return JSON.stringify(await window.tranen.query('apple')); }
      catch (e) { return 'ERR:' + e.message; }
    })()`, true));
    check('语境回溯 payload', ctxPayload.context && ctxPayload.context.includes('An apple'),
      JSON.stringify(ctxPayload.context));
    check('语境句译', !!ctxPayload.sentenceTranslation, ctxPayload.sentenceTranslation);
    check('挖空语境句', !!ctxPayload.contextCloze && ctxPayload.contextCloze.includes('{{c1::apple}}'),
      ctxPayload.contextCloze);
    const ctxDom = await popup.webContents.executeJavaScript(`({
      secShown: !document.getElementById('context-section').classList.contains('hidden'),
      hintShown: !document.getElementById('context-hint').classList.contains('hidden')
    })`, true);
    check('语境区渲染', ctxDom.secShown && !ctxDom.hintShown, JSON.stringify(ctxDom));

    // 4. 复习接口
    const due = await popup.webContents.executeJavaScript(`window.tranen.reviewCount()`, true);
    console.log('INFO due count =', due);

    // 4.2 复习窗口全链路（理念对齐断言）：
    //     直连 SQLite 种入到期词「reviewflow」（带语境挖空 + LLM 简单释义），验证
    //     正面挖空 / 外链样式生效(CSP修复) / 背面英文在上中文muted / 键盘快捷键 / 忘记重排队
    const Database = require('better-sqlite3');
    const pathMod = require('path');
    const configMod = require('../main/config');
    const DAY_MS = 24 * 60 * 60 * 1000;
    const rawDb = new Database(pathMod.join(configMod.getDataDir(), 'words.db'));
    rawDb.prepare('DELETE FROM words WHERE word = ?').run('reviewflow');
    rawDb.prepare(`INSERT INTO words (word, phonetic, definition, first_seen, last_seen, query_count)
                   VALUES ('reviewflow', '', 'n. 复习；回顾', ?, ?, 1)`)
      .run(Date.now() - 3 * DAY_MS, Date.now());
    rawDb.prepare(`INSERT INTO queries
                   (word, context, context_cloze, sentence_translation, word_in_sentence, source, created_at, simple_def)
                   VALUES ('reviewflow',
                           'Please review your notes before the exam.',
                           'Please {{c1::review}} your notes before the exam.',
                           '考试前请复习你的笔记。', 'v. 复习', 'llm', ?,
                           'to look at something again carefully')`)
      .run(Date.now() - DAY_MS);
    rawDb.close();

    const reviewWin = windowMgr.createReview();
    await new Promise((res) => reviewWin.webContents.once('did-finish-load', res));
    await sleep(700); // 等 load()/render()

    // 队列里可能混有真实到期词：把测试词轮换到当前位（只动内存顺序，不碰真实词 SM-2）
    const rotated = await reviewWin.webContents.executeJavaScript(`(() => {
      const i = queue.findIndex((w) => w.word === 'reviewflow');
      if (i < 0) return false;
      const arr = queue.splice(i, 1);
      queue.splice(idx, 0, arr[0]);
      render();
      return true;
    })()`, true);
    check('review 队列包含测试词', rotated === true, `total=${await reviewWin.webContents.executeJavaScript('queue.length', true)}`);

    const frontDom = await reviewWin.webContents.executeJavaScript(`({
      progress: document.getElementById('progress').textContent,
      frontVisible: !document.getElementById('front').classList.contains('hidden'),
      frontBlank: !!document.querySelector('#front .blank'),
      cardBorder: getComputedStyle(document.getElementById('card')).borderTopWidth,
      cardBorderStyle: getComputedStyle(document.getElementById('card')).borderTopStyle,
    })`, true);
    check('review 正面挖空渲染', frontDom.frontVisible && frontDom.frontBlank, JSON.stringify(frontDom));
    // DPI 缩放下 1px 计算值可能是小数（如 150% → 0.666667px），用「有实线边框」证明外链 CSS 生效
    check('review 外链样式表生效（CSP 修复）',
      frontDom.cardBorder !== '0px' && frontDom.cardBorderStyle === 'solid',
      `border=${frontDom.cardBorder} ${frontDom.cardBorderStyle}`);

    // 空格键翻面 → 背面：simple-def 在上、中文 muted 在下（理念：英文在上，中文兜底）
    const backDom = await reviewWin.webContents.executeJavaScript(`(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      const sd = document.querySelector('#back .simple-def');
      const zd = document.querySelector('#back .back-def');
      return {
        backShown: !document.getElementById('back').classList.contains('hidden'),
        word: (document.querySelector('#back .word') || {}).textContent || '',
        simpleDefText: sd ? sd.textContent : null,
        zhText: zd ? zd.textContent : null,
        zhMuted: !!(zd && zd.classList.contains('muted')),
        enAboveZh: !!(sd && zd && (sd.compareDocumentPosition(zd) & Node.DOCUMENT_POSITION_FOLLOWING)),
      };
    })()`, true);
    check('review 空格翻面', backDom.backShown === true);
    check('review 背面单词渲染', backDom.word === 'reviewflow', backDom.word);
    check('review 英文简单释义渲染', backDom.simpleDefText === 'to look at something again carefully', String(backDom.simpleDefText));
    check('理念:复习卡英文区在中文之上', backDom.enAboveZh === true, JSON.stringify(backDom));
    check('理念:复习卡中文弱化(muted)', backDom.zhMuted === true, 'zh=' + backDom.zhText);

    // 键盘 1 = 忘记：SM-2 即时更新 + 词被塞回队列尾部（当次重现）
    await reviewWin.webContents.executeJavaScript(`(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
      await new Promise((r) => setTimeout(r, 300)); // 等 async answer() 走完 IPC
    })()`, true);
    const rfState = await reviewWin.webContents.executeJavaScript(`({
      total: queue.length,
      idx,
      rfCount: queue.filter((w) => w.word === 'reviewflow').length,
    })`, true);
    check('review 忘记重排队（会话内重现）', rfState.rfCount >= 2 && rfState.idx >= 1, JSON.stringify(rfState));
    const rfSm2 = db.getWord('reviewflow');
    check('review SM-2 忘记分支落库',
      rfSm2 && rfSm2.repetitions === 0 && rfSm2.interval === 1 && rfSm2.due_date > Date.now(),
      JSON.stringify({ rep: rfSm2.repetitions, ivl: rfSm2.interval }));

    // 收尾：清掉测试词（words+queries），关闭复习窗
    db.removeWord('reviewflow');
    reviewWin.close();


    // 4.5 最近查询入口
    const recent = await popup.webContents.executeJavaScript(`window.tranen.wordsRecent()`, true);
    check('recent words', Array.isArray(recent) && recent.length >= 1, JSON.stringify(recent.map((w) => w.word).slice(0, 3)));
    const recentDom = await popup.webContents.executeJavaScript(`({
      shown: !document.getElementById('recent-section').classList.contains('hidden'),
      chips: document.getElementById('recent-chips').children.length
    })`, true);
    check('recent section rendered', recentDom.shown && recentDom.chips > 0, JSON.stringify(recentDom));

    // 5. 设置窗口能打开 + tab 切换正常
    const settings = windowMgr.createSettings();
    await new Promise((res) => settings.webContents.once('did-finish-load', res));
    await sleep(400);
    const sOk = await settings.webContents.executeJavaScript(`!!document.getElementById('save-general')`, true);
    check('settings window', sOk);
    for (const tab of ['words', 'dict', 'translate', 'general']) {
      const t = await settings.webContents.executeJavaScript(`(() => {
        document.querySelector('[data-tab="${tab}"]').click();
        return document.getElementById('tab-${tab}').classList.contains('active');
      })()`, true);
      check(`settings tab ${tab}`, t === true);
    }

    console.log('ALL GUI TESTS DONE');
  } catch (e) {
    console.error('GUI TEST FAIL:', e.message);
    process.exitCode = 1;
  }
  app.exit(0);
});
