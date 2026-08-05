// 全局热键 + 模拟复制取词（nextai 快照恢复方案）：
// 保存剪贴板 → 清空 → 模拟 Ctrl+C → 读取 → 恢复原内容（含图片/HTML）
// PowerShell 进程常驻：应用生命周期内只启动一次，避免每次按键 400ms+ 的进程启动开销

const { globalShortcut, clipboard } = require('electron');
const { spawn, execFile } = require('child_process');
const { load } = require('./config');

let isSimulating = false;
let watchSync = null;   // clipboard-watch 模块的回调，恢复后同步其 last
let onStart = null;     // 取词开始前的回调（用于立即显示「取词中」）
let handler = null;     // async (text) => {}
let lastQuery = { text: '', ts: 0 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 常驻 PowerShell ----------
let ps = null;
let psQueue = Promise.resolve();
let psPending = null;

function ensurePs() {
  if (ps && ps.exitCode === null) return ps;
  ps = spawn('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', '-'],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  ps.stderr.on('data', () => {});
  ps.stdout.on('data', (d) => {
    if (psPending && d.toString().includes('__DONE__')) {
      const p = psPending;
      psPending = null;
      p();
    }
  });
  ps.on('exit', () => { ps = null; psPending = null; });
  return ps;
}

/** 通过常驻进程发送一次 Ctrl+C（队列化，避免并发写 stdin） */
function sendCopy() {
  const p = ensurePs();
  const job = psQueue.then(() => new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (psPending === finish) psPending = null;
      resolve();
    };
    const timer = setTimeout(finish, 1500); // 保险：1.5s 未确认也继续
    psPending = finish;
    p.stdin.write("$w = New-Object -ComObject wscript.shell; $w.SendKeys('^c'); Write-Output '__DONE__'\n");
  }));
  psQueue = job.catch(() => {});
  return job;
}

/** 兼容旧调用方式（备用路径） */
function sendCopyOnce() {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
        "$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys('^c')"],
      { windowsHide: true },
      () => resolve()
    );
  });
}

function setWatchSync(fn) {
  watchSync = fn;
}

function register(cb, onStartCb) {
  handler = cb;
  onStart = onStartCb || null;
  unregister();
  const cfg = load();
  try {
    return globalShortcut.register(cfg.hotkey, onHotkey);
  } catch (e) {
    console.error('[hotkey] register failed:', e.message);
    return false;
  }
}

function unregister() {
  globalShortcut.unregisterAll();
}

function onHotkey() {
  if (isSimulating) return;
  if (onStart) onStart(); // 立即弹「取词中」窗口，与取词并行
  grabSelection().then((text) => {
    if (!text) return;
    if (text === lastQuery.text && Date.now() - lastQuery.ts < 3000) return; // 去重
    lastQuery = { text, ts: Date.now() };
    handler(text);
  });
}

/** 模拟复制并读取选中文本，完成后恢复剪贴板原内容 */
async function grabSelection() {
  if (isSimulating) return '';
  isSimulating = true;
  try {
    const formats = clipboard.availableFormats();
    const snap = {
      text: clipboard.readText(),
      html: formats.includes('text/html') ? clipboard.readHTML() : '',
      image: formats.includes('image/png') || formats.includes('image/jpeg') ? clipboard.readImage() : null,
      bookmark: formats.includes('text/uri-list') ? clipboard.readBookmark() : null,
    };
    clipboard.writeText(''); // 清空，确保后续读到的是新复制内容
    await sendCopy();
    // 轮询剪贴板直到读到新内容（通常 50-150ms），上限 800ms
    let picked = '';
    const deadline = Date.now() + 800;
    while (Date.now() < deadline) {
      await sleep(40);
      const t = clipboard.readText();
      if (t && t !== snap.text) { picked = t; break; }
    }
    if (!picked) {
      // 应用响应慢，重试一次
      await sendCopy();
      const deadline2 = Date.now() + 800;
      while (Date.now() < deadline2) {
        await sleep(40);
        const t = clipboard.readText();
        if (t && t !== snap.text) { picked = t; break; }
      }
    }
    // 恢复快照（文本/HTML/图片）
    if (snap.image && !snap.image.isEmpty()) {
      clipboard.writeImage(snap.image);
    } else if (snap.html) {
      clipboard.write({ text: snap.text, html: snap.html, bookmark: snap.bookmark || undefined });
    } else {
      clipboard.writeText(snap.text);
    }
    if (watchSync) watchSync(snap.text);
    return picked.trim();
  } finally {
    isSimulating = false;
  }
}

function sendCopy() {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
        "$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys('^c')"],
      { windowsHide: true },
      () => resolve()
    );
  });
}

function isBusy() {
  return isSimulating;
}

/** 剪贴板文本清洗：去首尾标点、PDF 断行合并 */
function cleanText(raw) {
  let t = String(raw || '').trim();
  if (!t) return '';
  // 去首尾成对引号/括号
  t = t.replace(/^[“"'‘(\[【《]+|[”"'’)\]】》]+$/g, '').trim();
  // 去尾部句号/逗号等（选中单词时常带上："apple."、"apple,"）
  t = t.replace(/[.,;:!?，。！？；：、…]+$/, '').trim();
  const lines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1) {
    // PDF 断行：行尾连字符-下一行小写开头 → 直接拼接；否则空格拼接
    let merged = '';
    for (const line of lines) {
      if (!merged) { merged = line; continue; }
      const hyphen = /-$/.test(merged);
      merged = hyphen ? merged.slice(0, -1) + line : merged + ' ' + line;
    }
    t = merged;
  }
  return t.trim();
}

/** 判断是单词还是句子 */
function classify(text) {
  const isWord = !/\s/.test(text) && text.length <= 50 && /^[A-Za-z][A-Za-z'-]*$/.test(text);
  return isWord ? 'word' : 'sentence';
}

module.exports = { register, unregister, grabSelection, cleanText, classify, setWatchSync, isBusy };
