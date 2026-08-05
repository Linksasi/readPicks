// 手动 zip 安装路径验证：mini ECDICT → zip → downloadDict 安装 → 查询
// npx electron scripts/zip-install-test.js
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

app.whenReady().then(async () => {
  const root = process.cwd();
  try {
    // 1. 用已下载的 ecdict.mini.csv 建 mini SQLite
    const csv = fs.readFileSync(path.join(root, 'scripts', 'ecdict.mini.csv'), 'utf8');
    const Database = require('better-sqlite3');
    const dbPath = path.join(root, 'scripts', 'mini-ecdict.db');
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    const db = new Database(dbPath);
    db.exec('CREATE TABLE stardict (word TEXT, phonetic TEXT, definition TEXT, translation TEXT, pos TEXT, collins INT, oxford INT, tag TEXT, bnc INT, frq INT, exchange TEXT, detail TEXT, audio TEXT)');
    const lines = csv.split(/\r?\n/).filter((l) => l.trim());
    if (/^word/i.test(lines[0])) lines.shift(); // 跳过表头
    const ins = db.prepare('INSERT INTO stardict VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
    const parse = (l) => { const a = []; let cur = '', q = false; for (const c of l) { if (c === '"') { q = !q; continue; } if (c === ',' && !q) { a.push(cur); cur = ''; } else cur += c; } a.push(cur); return a; };
    const tx = db.transaction((rows) => { for (const r of rows) ins.run(...r); });
    tx(lines.map(parse).filter((r) => r.length === 13)); // 跳过解析异常的脏行
    db.prepare('CREATE INDEX idx_word ON stardict(word)').run();
    db.close();
    console.log('mini SQLite 建好, 词条数:', lines.length);

    // 2. 打包 zip（PowerShell Compress-Archive）
    const zipPath = path.join(root, 'scripts', 'mini-ecdict.zip');
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    await new Promise((res, rej) => execFile('powershell.exe', ['-NoProfile', '-Command',
      `Compress-Archive -LiteralPath '${dbPath}' -DestinationPath '${zipPath}' -Force`],
      { windowsHide: true }, (e) => (e ? rej(e) : res())));
    console.log('zip 打包完成');

    // 3. 清理已有词典，走手动安装路径
    const { getDataDir } = require('../main/config');
    const dir = path.join(getDataDir(), 'ecdict');
    fs.rmSync(dir, { recursive: true, force: true });

    const { downloadDict } = require('./download-dict');
    await downloadDict((p) => console.log('[install]', p.phase, p.message || p.percent), zipPath);
    console.log('安装流程完成');

    // 4. 查询验证
    const ecdict = require('../main/ecdict');
    ecdict.init();
    console.log('installed:', ecdict.isInstalled());
    const r = ecdict.lookup('nite');
    console.log('lookup hello:', JSON.stringify({ word: r && r.word, first: r && (r.translation || '').split('\n')[0] }));
    if (!r || r.word !== 'nite') throw new Error('查询失败');
    console.log('ZIP-INSTALL TEST PASS');
  } catch (e) {
    console.error('ZIP-INSTALL TEST FAIL:', e.message);
    process.exitCode = 1;
  }
  app.exit(0);
});
