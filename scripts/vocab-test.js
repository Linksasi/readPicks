// 词汇量测试模块验证脚本：抽样 / 假词校准 / 计分 / CEFR / 难词标注与提示 / wordLevel / 释义链路
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const vocab = require('../main/vocabtest');
const config = require('../main/config');

app.whenReady().then(async () => {
  // 备份 config，测试后恢复（finishTest 会写盘）
  const cfgPath = config.getConfigPath();
  const backup = fs.existsSync(cfgPath) ? fs.readFileSync(cfgPath, 'utf8') : null;
  const restore = () => {
    if (backup !== null) fs.writeFileSync(cfgPath, backup, 'utf8');
    else { try { fs.unlinkSync(cfgPath); } catch {} }
    console.log('[restore] config 已恢复');
  };

  let failed = 0;
  const check = (name, cond, extra) => {
    console.log((cond ? '✅' : '❌') + ' ' + name + (extra ? ' — ' + extra : ''));
    if (!cond) failed++;
  };

  try {
    // 1. 开始测试：60 题
    const t = vocab.startTest();
    check('startTest ok', t.ok === true, `total=${t.total}`);
    check('题数 = 60', t.total === 60, `实际 ${t.total}`);
    check('单词均为字符串且非空', t.words.every((w) => typeof w === 'string' && w.length > 0));

    // 2. 假词校验：池中假词在词典中不存在
    const db = require('better-sqlite3')(path.join(config.getDataDir(), 'ecdict', 'ecdict.db'), { readonly: true });
    const fakeExists = vocab.BUCKETS;
    const poolFake = ['worbly', 'flumness', 'prancify', 'crostion', 'blunderse', 'dravelous', 'splotment', 'quernify', 'thwipish', 'ploritude', 'vixible', 'froddle', 'clumberous', 'drepplet', 'brizzen', 'glumph', 'snorkative', 'pliffer', 'crunge', 'draffly', 'fumblet', 'snurble', 'drenchle', 'plobble', 'flomper'];
    const conflicts = poolFake.filter((w) => db.prepare('SELECT 1 FROM stardict WHERE word=?').get(w));
    check('假词池与词典无冲突', conflicts.length === 0, conflicts.join(','));

    // 3. 计分：全认识 → 高分；全不认识 → 低分；假词误认 → 惩罚（全认识但 12 个假词全误认，分数应低于无惩罚上限 50000）
    const allYes = t.words.map(() => true);
    const r1 = vocab.finishTest(allYes);
    check('全认识计分 ok', r1.ok === true, `score=${r1.result.score} cefr=${r1.result.cefr} fakeKnown=${r1.result.fakeKnown}`);
    check('全认识分数高(>20000)', r1.result.score > 20000);
    check('假词误认被惩罚(score<50000)', r1.result.score < 50000 && r1.result.fakeKnown === 12, `score=${r1.result.score}, fakeKnown=${r1.result.fakeKnown}`);
    // config 持久化（r1 刚写入，立即验证）
    const saved1 = config.load().vocabLevel;
    check('vocabLevel 已写入 config', !!saved1 && saved1.score === r1.result.score, `saved=${saved1 && saved1.score}, expect=${r1.result.score}`);

    const t2 = vocab.startTest();
    const allNo = t2.words.map(() => false);
    const r2 = vocab.finishTest(allNo);
    check('全不认识分数低(<1000)', r2.ok && r2.result.score < 1000, `score=${r2.ok ? r2.result.score : 'err'}`);

    // 4. 会话过期保护
    const r4 = vocab.finishTest([true]);
    check('无会话时 finish 报错', r4.ok === false);

    // 5. levelInfo / CEFR
    check('levelInfo(6500).maxBnc ≈ 5200', vocab.levelInfo(6500).maxBnc === 5200, `maxBnc=${vocab.levelInfo(6500).maxBnc}`);
    check('CEFR 映射 B2', vocab.toCefr(6500) === 'B2');
    check('CEFR 映射 C1', vocab.toCefr(10000) === 'C1');

    // 6. 难词标注（模拟词汇量 3000 → maxBnc 2400）
    const def = 'device consisting of a set of keys on a piano or organ or typewriter or computer';
    const { hard } = vocab.annotateHardWords(def, 2400);
    console.log('   难词标注 @2400:', hard.join(', '));
    check('难词标注返回数组', Array.isArray(hard) && hard.length > 0);
    check('高频词 device 不在难词中', !hard.includes('device'));

    // 8. 模拟 index.js 的组装路径：有词汇量时查词附带英英释义（lookup + annotate 联动）
    const ecdict = require('../main/ecdict');
    ecdict.init();
    const dict = ecdict.lookup('keyboard');
    if (dict && dict.definition) {
      const { maxBnc } = vocab.levelInfo(3000);
      const { hard: h2 } = vocab.annotateHardWords(dict.definition, maxBnc);
      check('组装：lookup 返回 definition', dict.definition.length > 20);
      check('组装：annotate 返回难词列表', Array.isArray(h2));
      console.log('   释义@3000:', dict.definition.slice(0, 90));
      console.log('   难词:', h2.slice(0, 8).join(', '));

      // 9. 难词提示数据齐全（就地化解）
      const hints = vocab.hardWordHints(h2);
      check('hints 数量与难词一致', hints.length === h2.length, `${hints.length}/${h2.length}`);
      check('每个难词都有提示', hints.every((h) => h.zh || h.en));
    } else {
      check('组装：lookup 返回 definition', false, 'lookup(keyboard) 失败');
    }

    // 10. wordLevel 判定（词汇量 3000 → maxBnc=2400，above 上限=4500）
    const wlCases = [[1, 'within'], [2000, 'within'], [2500, 'above'], [4000, 'above'], [5000, 'far-above'], [13723, 'far-above'], [0, 'far-above'], ['', 'far-above']];
    for (const [bnc, expect] of wlCases) {
      const r = vocab.wordLevel(bnc, 3000);
      check(`wordLevel(${bnc}) = ${expect}`, r.level === expect, `实际 ${r.level}`);
    }
    check('wordLevel 未测词汇量 → null', vocab.wordLevel(5000, 0) === null);
    // 真实词难度：the(keyboard 场景外) 与 arduous
    const dThe = ecdict.lookup('the');
    check('the 对 3000 词汇量 = within', dThe && vocab.wordLevel(dThe.bnc, 3000).level === 'within');
    const dArd = ecdict.lookup('arduous');
    check('arduous 对 3000 词汇量 = far-above', dArd && vocab.wordLevel(dArd.bnc, 3000).level === 'far-above');

    // 11. simpleDefinition 未配置 LLM 时返回 null（不发起网络请求）
    const translate = require('../main/translate');
    const sd = await translate.simpleDefinition('keyboard');
    check('simpleDefinition 无 apiKey → null', sd === null, JSON.stringify(sd));
  } catch (e) {
    console.error('❌ 异常:', e);
    failed++;
  } finally {
    restore();
  }
  console.log(failed === 0 ? '\n全部通过 ✅' : `\n${failed} 项失败 ❌`);
  app.exit(failed === 0 ? 0 : 1);
});
