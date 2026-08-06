// 端到端 GUI 验证：带 vocabLevel 的真实查询链路（enDefinition/难词浮层/词难度徽章渲染）
// npx electron scripts/e2e-vocab-test.js
// 跑完即删；config 与 words.db 均恢复原状
const { app } = require('electron');
const fs = require('fs');
const config = require('../main/config');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 等待渲染完成：query 的 promise 在 IPC 返回即 resolve，DOM 渲染是异步的，需轮询
async function waitRender(popup, condExpr, timeout = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      if (await popup.webContents.executeJavaScript(condExpr, true)) return true;
    } catch { /* 页面未就绪 */ }
    await sleep(100);
  }
  return false;
}
app.whenReady().then(async () => {
  const cfgPath = config.getConfigPath();
  const backup = fs.existsSync(cfgPath) ? fs.readFileSync(cfgPath, 'utf8') : null;
  const restore = () => {
    if (backup !== null) fs.writeFileSync(cfgPath, backup, 'utf8');
    else { try { fs.unlinkSync(cfgPath); } catch {} }
    try { require('../main/db').removeWord('arduous'); } catch {}
    console.log('[restore] config/words.db 已恢复');
  };
  let failed = 0;
  const check = (label, cond, detail) => {
    console.log((cond ? '✅' : '❌') + ' ' + label + (detail ? ' — ' + detail : ''));
    if (!cond) failed++;
  };
  try {
    // 模拟用户测过词汇量：4000 词 / B1（maxBnc=3200 → apple(2446)=within，arduous(13723)=far-above）
    // 并锁定离线路径（不依赖用户 LLM 配置、不触发网络），确保测到 senses 渲染分支
    config.update({
      vocabLevel: { score: 4000, cefr: 'B1', buckets: [], fakeKnown: 0, takenAt: Date.now() },
      provider: 'mymemory',
      providers: { llm: { apiKey: '' } },
    });
    require('../main/index');
    await sleep(1500);
    const windowMgr = require('../main/window');
    const popup = windowMgr.createPopup();
    popup.webContents.on('console-message', (_e, level, msg) => {
      if (level >= 2) console.log('[renderer-error]', msg);
    });
    if (popup.webContents.isLoading()) {
      await new Promise((res) => popup.webContents.once('did-finish-load', res));
    }
    await sleep(300);

    // 1. 查 far-above 词 arduous
    const p1 = JSON.parse(await popup.webContents.executeJavaScript(
      `(async () => JSON.stringify(await window.tranen.query('arduous')))()`, true));
    check('payload: enDefinition 义项存在', !!(p1.enDefinition && p1.enDefinition.senses && p1.enDefinition.senses.length > 0),
      `senses=${p1.enDefinition.senses.length}`);
    check('payload: 义项含词性与文本', p1.enDefinition.senses.every((s) => typeof s.pos === 'string' && s.text.length > 5));
    check('payload: hints 随下发', Array.isArray(p1.enDefinition.hints) && p1.enDefinition.hints.length === p1.enDefinition.hard.length,
      `hard=${p1.enDefinition.hard.length} hints=${p1.enDefinition.hints.length}`);
    check('payload: wordLevel = far-above', p1.wordLevel && p1.wordLevel.level === 'far-above',
      JSON.stringify(p1.wordLevel));
    check('渲染等待: arduous 义项已渲染', await waitRender(popup, `document.querySelectorAll('.en-sense').length > 0`));
    const dom1 = await popup.webContents.executeJavaScript(`({
      enSec: !document.getElementById('en-def-section').classList.contains('hidden'),
      hardBtns: document.querySelectorAll('.hard-word').length,
      senseRows: document.querySelectorAll('.en-sense').length,
      badge: document.getElementById('badges').textContent,
      enBeforeDefs: (document.getElementById('en-def-section').compareDocumentPosition(document.getElementById('defs')) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
      defsMuted: document.getElementById('defs').classList.contains('muted'),
      defsCollapsed: !document.getElementById('defs-details').hasAttribute('open')
    })`);
    check('渲染: 英英释义区块可见', dom1.enSec === true);
    check('渲染: 义项按行渲染', dom1.senseRows === p1.enDefinition.senses.length, `rows=${dom1.senseRows}`);
    check('渲染: 难词按钮已生成', dom1.hardBtns >= 3, `hardBtns=${dom1.hardBtns}`);
    check('渲染: 徽章显示"远超你水平"', dom1.badge.includes('远超你水平'), dom1.badge);
    check('排版: 英文释义在中文释义之上（理念：英英优先）', dom1.enBeforeDefs === true);
    check('排版: 中文释义已弱化（muted）', dom1.defsMuted === true);
    check('排版: 中文释义默认折叠（有词汇量时）', dom1.defsCollapsed === true);

    // 2. 点击第一个难词 → 就地浮层
    const tip = await popup.webContents.executeJavaScript(`(async () => {
      const b = document.querySelector('.hard-word');
      b.click();
      await new Promise((r) => setTimeout(r, 200));
      const t = document.querySelector('.word-tip');
      return t ? { text: t.textContent, hasZh: !!t.querySelector('.word-tip-zh'), hasEn: !!t.querySelector('.word-tip-en') } : null;
    })()`, true);
    check('浮层: 点击难词出现就地提示', !!(tip && tip.text.length > 5), JSON.stringify(tip));
    check('浮层: 含中文第一义', !!(tip && tip.hasZh));
    // 点击外部关闭
    await popup.webContents.executeJavaScript(`(async () => {
      document.body.click();
      await new Promise((r) => setTimeout(r, 100));
      return !!document.querySelector('.word-tip');
    })()`, true).then((still) => check('浮层: 点击外部关闭', still === false));

    // 3. 查 within 词 apple
    const p3 = JSON.parse(await popup.webContents.executeJavaScript(
      `(async () => JSON.stringify(await window.tranen.query('apple')))()`, true));
    check('payload: apple wordLevel = within', p3.wordLevel && p3.wordLevel.level === 'within', JSON.stringify(p3.wordLevel));
    check('渲染等待: apple 已渲染', await waitRender(popup, `document.getElementById('badges').textContent.includes('在你水平内')`));
    const dom3 = await popup.webContents.executeJavaScript(`({
      enSec: !document.getElementById('en-def-section').classList.contains('hidden'),
      badge: document.getElementById('badges').textContent
    })`);
    check('渲染: apple 英英释义可见', dom3.enSec === true);
    check('渲染: apple 徽章"在你水平内"', dom3.badge.includes('在你水平内'), dom3.badge);

    // 4. 义项拆分质量：human 应拆出 3 条形容词义项（用户反馈的原始格式）
    const p4 = JSON.parse(await popup.webContents.executeJavaScript(
      `(async () => JSON.stringify(await window.tranen.query('human')))()`, true));
    check('渲染等待: human 已渲染', await waitRender(popup, `document.querySelectorAll('.en-sense').length === 3`));
    check('human: 义项拆分为 3 条', p4.enDefinition.senses.length === 3, `senses=${p4.enDefinition.senses.length}`);
    check('human: 词性均为 a（形容词）', p4.enDefinition.senses.every((s) => s.pos === 'a'));
    check('human: 首条义项文本正确', p4.enDefinition.senses[0].text.includes('characteristic of humanity'),
      p4.enDefinition.senses[0].text.slice(0, 50));
  } catch (e) {
    console.error('❌ 异常:', e);
    failed++;
  } finally {
    restore();
  }
  console.log(failed === 0 ? '\n全部通过 ✅' : `\n${failed} 项失败 ❌`);
  app.exit(failed === 0 ? 0 : 1);
});
