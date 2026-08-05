// ECDICT 下载 + 查询验证
// npx electron scripts/dl-test.js
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { getDataDir } = require('../main/config');

app.whenReady().then(async () => {
  try {
    const { downloadDict } = require('./download-dict');
    await downloadDict((p) => console.log('[dl]', p.phase, p.percent != null ? p.percent + '%' : '', p.message || ''));
    const lemmaPath = path.join(getDataDir(), 'ecdict', 'lemma.en.txt');
    const head = fs.readFileSync(lemmaPath, 'utf8').split('\n').slice(0, 5).join(' | ');
    console.log('[lemma] head:', head);

    const ecdict = require('../main/ecdict');
    ecdict.init();
    console.log('installed:', ecdict.isInstalled());
    const r = ecdict.lookup('apple');
    console.log('[dict] apple:', JSON.stringify({ word: r.word, phonetic: r.phonetic, translation: (r.translation || '').split('\n')[0], collins: r.collins, tags: r.tags.slice(0, 4) }));
    const r2 = ecdict.lookup('gave');
    console.log('[dict] gave → matched:', r2 ? r2.word : 'NULL', '| base:', r2 ? r2.matchedBase : '-');
    const r3 = ecdict.lookup('running');
    console.log('[dict] running → matched:', r3 ? r3.word : 'NULL', '| base:', r3 ? r3.matchedBase : '-');
    app.exit(0);
  } catch (e) {
    console.error('DL FAIL:', e.message);
    app.exit(1);
  }
});
