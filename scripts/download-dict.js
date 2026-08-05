// ECDICT 官方 SQLite 下载安装：release 资产 ecdict-sqlite-*.zip + lemma.en.txt
// 在 Electron 主进程内调用（依赖 config.getDataDir）
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { getDataDir } = require('../main/config');

const DIR = () => path.join(getDataDir(), 'ecdict');
const UA = 'TranEn/0.1 (word-lookup app)';
// 国内网络可设 TRANEN_DL_MIRROR 前缀加速（如 https://ghproxy.net/ 等代理）
const MIRROR = process.env.TRANEN_DL_MIRROR || '';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function request(url, onResponse) {
  const mod = url.startsWith('https') ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.get(url, { headers: { 'User-Agent': UA } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        request(res.headers.location, onResponse).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200 && res.statusCode !== 206) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      onResponse(res);
      resolve();
    });
    req.setTimeout(30000, () => req.destroy(new Error('网络超时')));
    req.on('error', reject);
  });
}

async function fetchJson(url) {
  return new Promise((resolve, reject) => {
    request(url, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
      res.on('error', reject);
    }).catch(reject);
  });
}

/** 下载文件（断点续传 + 自动重试），进度回调 emit({phase:'download', percent, received, total}) */
function downloadFile(url, dest, emit, retries = 3) {
  return (async () => {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await downloadOnce(url, dest, emit);
        return;
      } catch (e) {
        console.warn(`[download] attempt ${attempt}/${retries} failed:`, e.message);
        if (attempt >= retries) throw e;
        await sleep(2000 * attempt);
      }
    }
  })();
}

function downloadOnce(url, dest, emit) {
  return new Promise((resolve, reject) => {
    const existing = fs.existsSync(dest) ? fs.statSync(dest).size : 0;
    const headers = { 'User-Agent': UA };
    if (existing > 0) headers.Range = `bytes=${existing}-`;
    const finish = () => {};
    request(url, (res) => {
      const total = parseInt(res.headers['content-length'] || '0', 10);
      const resumed = res.statusCode === 206;
      const grandTotal = resumed ? existing + total : total;
      const flags = resumed ? 'a' : 'w';
      let received = existing;
      const out = fs.createWriteStream(dest, { flags });
      res.on('data', (c) => {
        received += c.length;
        if (grandTotal && emit) emit({ phase: 'download', percent: Math.min(100, Math.round((received / grandTotal) * 100)), received, total: grandTotal });
      });
      res.pipe(out);
      out.on('finish', () => {
        out.close();
        // 完整性校验：服务端声明大小 vs 实际大小
        if (grandTotal > 0 && received < grandTotal) {
          reject(new Error(`下载不完整 ${received}/${grandTotal}`));
          return;
        }
        resolve();
      });
      out.on('error', reject);
      res.on('error', reject);
    }).catch(reject);
  });
}

function unzip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    // Windows 10+ 自带 tar (bsdtar)，支持 zip；失败则退回 PowerShell Expand-Archive
    execFile('tar.exe', ['-xf', zipPath, '-C', destDir], { windowsHide: true }, (err) => {
      if (!err) return resolve();
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${destDir}' -Force`],
      { windowsHide: true }, (err2) => (err2 ? reject(new Error('解压失败：' + err2.message)) : resolve()));
    });
  });
}

const DB_PATH = () => path.join(DIR(), 'ecdict.db');

/**
 * 安装 ECDICT：
 * - 已安装（ecdict.db 存在）→ 直接完成
 * - zipPath 参数指定本地 zip（用户手动下载）→ 跳过下载直接解压
 * - 否则：GitHub latest release 下载 ecdict-sqlite-*.zip → 解压
 * 解压后找 *.db/*.sqlite → 复制为 ecdict.db → 下载 lemma.en.txt
 */
async function downloadDict(emit = () => {}, zipPath = null) {
  const dir = DIR();
  fs.mkdirSync(dir, { recursive: true });

  if (fs.existsSync(DB_PATH())) {
    emit({ phase: 'done', message: '词典已安装，无需重复下载' });
    return;
  }

  if (!zipPath) {
    emit({ phase: 'info', message: '获取 ECDICT 最新版本信息…' });
    const rel = await fetchJson('https://api.github.com/repos/skywind3000/ECDICT/releases/latest');
    const asset = (rel.assets || []).find((a) => /ecdict-sqlite-.*\.zip$/i.test(a.name));
    if (!asset) throw new Error('未找到 ecdict-sqlite 发布包');
    zipPath = path.join(dir, 'ecdict-sqlite.zip');
    if (fs.existsSync(zipPath) && fs.statSync(zipPath).size > 200 * 1048576) {
      emit({ phase: 'info', message: '检测到已下载的词典压缩包，直接安装…' });
    } else {
      emit({ phase: 'info', message: `下载 ${asset.name}（${(asset.size / 1048576).toFixed(0)} MB）…` });
      await downloadFile(MIRROR + asset.browser_download_url, zipPath, emit);
    }
  } else {
    // 手动安装：复制到数据目录
    const target = path.join(dir, path.basename(zipPath));
    if (target !== zipPath) fs.copyFileSync(zipPath, target);
    zipPath = target;
  }

  emit({ phase: 'info', message: '解压中…' });
  await unzip(zipPath, dir);
  fs.unlinkSync(zipPath);

  const dbFile = fs.readdirSync(dir).find((f) => /\.(db|sqlite|sqlite3)$/i.test(f));
  if (!dbFile) throw new Error('解压后未找到数据库文件');
  const target = path.join(dir, 'ecdict.db');
  if (path.join(dir, dbFile) !== target) {
    fs.copyFileSync(path.join(dir, dbFile), target);
    fs.unlinkSync(path.join(dir, dbFile));
  }

  emit({ phase: 'info', message: '下载词形还原表 lemma.en.txt…' });
  const lemmaUrls = [
    'https://cdn.jsdelivr.net/gh/skywind3000/ECDICT@master/lemma.en.txt', // 国内快
    MIRROR + 'https://raw.githubusercontent.com/skywind3000/ECDICT/master/lemma.en.txt',
  ];
  let lemmaOk = false;
  for (const u of lemmaUrls) {
    try {
      await downloadFile(u, path.join(dir, 'lemma.en.txt'), () => {});
      lemmaOk = true;
      break;
    } catch (e) {
      console.warn('[dict] lemma download failed (optional):', e.message);
    }
  }
  if (!lemmaOk) console.warn('[dict] 词形还原表下载失败（可后续在设置中重试），不影响基础查词');

  emit({ phase: 'done', message: 'ECDICT 安装完成' });
}

module.exports = { downloadDict, DIR };
