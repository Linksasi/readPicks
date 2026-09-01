// 生成手机端瘦身离线词典：从 PC 的 ECDICT 抽高频词头 + lemma 词形还原表 → mobile/www/dict/mini.json
// 用法：npx electron scripts/build-mini-dict.js [词头数量=50000]
// 产物 ~5-8MB（APK 资产 / 手机端 Wi-Fi 下懒加载），离线覆盖日常阅读绝大多数查词
const { app } = require('electron');

app.whenReady().then(() => {
  try {
    const Database = require('better-sqlite3');
    const fs = require('fs');
    const path = require('path');
    const { getDataDir } = require('../main/config');

    const src = path.join(getDataDir(), 'ecdict', 'ecdict.db');
    const outPath = path.join(__dirname, '..', 'mobile', 'www', 'dict', 'mini.json');
    const limit = Math.max(1000, Number(process.argv[2]) || 50000);

    if (!fs.existsSync(src)) {
      console.error('未找到 ECDICT 词典：' + src + '（先在 PC 端设置里下载词典）');
      process.exitCode = 1;
      return app.exit(1);
    }
    const db = new Database(src, { readonly: true });

    // 高频词优先（frq 为语料库频率序，1 最常用），另补 Collins/牛津 标注但语料缺频的词
    const rows = db.prepare(
      'SELECT word, phonetic, translation, definition, bnc FROM stardict WHERE frq > 0 ORDER BY frq ASC LIMIT ?'
    ).all(limit);
    const seen = new Set(rows.map((r) => r.word));
    const extra = db.prepare(
      'SELECT word, phonetic, translation, definition, bnc FROM stardict WHERE frq = 0 AND (collins > 0 OR oxford > 0) LIMIT 5000'
    ).all();
    for (const r of extra) if (!seen.has(r.word)) { rows.push(r); seen.add(r.word); }

    // 中文释义截断：前 2 行、每行 80 字符；英文释义截断 200 字符（供手机端离线出 WordNet 式义项）
    const trunc = (t) => String(t || '').split('\n').slice(0, 2).map((s) => s.slice(0, 80)).join('\n');
    const words = {};
    for (const r of rows) {
      const t = trunc(r.translation);
      if (!t) continue; // 无中文释义的条目（专名等）不占体积
      const e = { p: r.phonetic || '', t };
      const d = String(r.definition || '').trim();
      if (d) e.d = d.slice(0, 200);
      const b = Number(r.bnc) || 0;
      if (b > 0) e.b = b; // 词频排名（难词标注用）
      words[r.word.toLowerCase()] = e;
    }

    // lemma 词形还原表：官方格式 `be/4109826 -> is,was,are`；只保留「原形在词头集内」的变形
    const lemmaPath = path.join(getDataDir(), 'ecdict', 'lemma.en.txt');
    const lemma = {};
    if (fs.existsSync(lemmaPath)) {
      for (const line of fs.readFileSync(lemmaPath, 'utf8').split('\n')) {
        const m = line.match(/^([^/;\s][^/]*)\/\d+\s*->\s*(.+)$/);
        if (!m) continue;
        const base = m[1].trim().toLowerCase();
        if (!base || !words[base]) continue;
        for (const f of m[2].split(',')) {
          const form = f.trim().toLowerCase();
          if (form && form !== base) lemma[form] = base;
        }
      }
    }

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify({ meta: { built: Date.now(), count: Object.keys(words).length, lemma: Object.keys(lemma).length }, words, lemma }));
    const mb = (fs.statSync(outPath).size / 1048576).toFixed(1);
    console.log(`mini 词典已生成: ${outPath}`);
    console.log(`词头 ${Object.keys(words).length} · lemma ${Object.keys(lemma).length} · ${mb} MB`);
    db.close();
  } catch (e) {
    console.error('FAIL:', e.message);
    process.exitCode = 1;
  }
  app.exit(process.exitCode || 0);
});
