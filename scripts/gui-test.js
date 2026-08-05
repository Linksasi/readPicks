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
