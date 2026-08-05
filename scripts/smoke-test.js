// 冒烟测试：验证核心模块（在 Electron 环境运行）
// npx electron scripts/smoke-test.js
const { app } = require('electron');

app.whenReady().then(async () => {
  try {
    const os = require('os');
    const path = require('path');
    const fs = require('fs');
    const db = require('../main/db');
    const ecdict = require('../main/ecdict');
    const context = require('../main/context');
    const translate = require('../main/translate');
    const hotkey = require('../main/hotkey');
    const config = require('../main/config');

    // 1. 数据库 + 次数+1
    db.init();
    db.removeWord('apple'); // 清理上次测试残留
    const r1 = db.recordLookup({
      word: 'apple', phonetic: '/ˈæpl/', definition: 'n. 苹果',
      context: 'An apple a day keeps the doctor away.',
      contextCloze: 'An {{c1::apple}} a day keeps the doctor away.',
      sentenceTranslation: '一天一苹果，医生远离我。',
      wordInSentence: 'n. 苹果', source: 'llm',
    });
    const r2 = db.recordLookup({ word: 'apple', definition: 'n. 苹果' });
    console.log('PASS db: count=%d (expect 2), history=%d (expect 1)', r2.queryCount, r2.history.length);
    if (r2.queryCount !== 2) throw new Error('query_count 未 +1');

    // 2. SM-2 复习
    db.reviewWord('apple', 3);
    const wAfter = db.getWord('apple');
    console.log('PASS sm2: after grade3 -> interval=%d repetition=%d due=%s',
      wAfter.interval, wAfter.repetitions, new Date(wAfter.due_date).toISOString());
    if (wAfter.interval !== 1 || wAfter.repetitions !== 1) throw new Error('SM-2 状态未正确更新');
    // 忘记 → 计数归零
    db.reviewWord('apple', 0);
    const wForget = db.getWord('apple');
    if (wForget.repetitions !== 0 || wForget.interval !== 1) throw new Error('SM-2 忘记分支错误');
    console.log('PASS sm2: forget -> repetition=%d interval=%d', wForget.repetitions, wForget.interval);
    // 到期查询：手动造一个到期的
    const dbMod = require('better-sqlite3')(require('path').join(config.getDataDir(), 'words.db'));
    dbMod.prepare('UPDATE words SET due_date = ? WHERE word = ?').run(Date.now() - 1000, 'apple');
    const due = db.dueWords();
    console.log('PASS sm2: due words =', due.map((w) => w.word));
    if (!due.some((w) => w.word === 'apple')) throw new Error('到期查询失败');

    // 3. Anki 导出
    const out = path.join(os.tmpdir(), 'tranen-anki-test.txt');
    const n = db.exportAnki(out);
    const content = fs.readFileSync(out, 'utf8');
    console.log('PASS anki: exported %d words, header=%s', n, content.split('\n')[0]);
    if (!content.includes('#separator:tab') || !content.includes('apple')) throw new Error('Anki 导出格式错误');

    // 4. 剪贴板历史回溯
    context.push('The quick brown fox jumps over the lazy dog.');
    const found = context.findContext('fox');
    console.log('PASS context: found =', JSON.stringify(found));
    if (!found) throw new Error('语境回溯失败');
    const cloze = context.makeCloze(found, 'fox');
    console.log('PASS cloze:', cloze);
    if (!cloze.includes('{{c1::fox}}')) throw new Error('挖空失败');

    // 5. 文本清洗 + 分类（PDF 断行）
    const clean = hotkey.cleanText('The quick brown\nfox jumps over\nthe lazy dog.');
    console.log('PASS clean:', JSON.stringify(clean));
    if (hotkey.classify(clean) !== 'sentence') throw new Error('断行合并后应为句子');
    if (hotkey.classify('apple') !== 'word') throw new Error('apple 应为单词');

    // 6. 在线翻译（MyMemory 免费接口）
    try {
      const t = await translate.translateSentence('The quick brown fox jumps over the lazy dog.');
      console.log('PASS translate(mymemory):', JSON.stringify(t.translation));
    } catch (e) {
      console.log('WARN translate(mymemory):', e.message, '（网络受限时正常）');
    }

    // 7. 词典状态
    console.log('INFO dict installed =', ecdict.isInstalled());

    console.log('ALL SMOKE TESTS DONE');
  } catch (e) {
    console.error('SMOKE FAIL:', e.message);
    process.exitCode = 1;
  }
  app.exit(0);
});
