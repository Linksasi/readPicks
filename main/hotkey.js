// 全局热键 + 取词：
// 1. 优先 Windows UI Automation 直读选中文本及其所在段落（不碰剪贴板，语境自动获取）
// 2. 失败回退：模拟 Ctrl+C + 剪贴板快照恢复
// PowerShell 进程常驻：应用生命周期内只启动一次，避免每次按键 400ms+ 的进程启动开销

const { globalShortcut, clipboard } = require('electron');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { load, getDataDir } = require('./config');
const context = require('./context');

let isSimulating = false;
let watchSync = null;   // clipboard-watch 模块的回调，恢复后同步其 last
let onStart = null;     // 取词开始前的回调（用于立即显示「取词中」）
let handler = null;     // async (text) => {}
let lastQuery = { text: '', ts: 0 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 常驻 PowerShell（带输出返回的命令通道） ----------
let ps = null;
let psQueue = Promise.resolve();
let psPending = null;
let psBuf = '';

function ensurePs() {
  if (ps && ps.exitCode === null) return ps;
  ps = spawn('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', '-'],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  ps.stderr.on('data', () => {});
  ps.stdout.on('data', (d) => {
    psBuf += d.toString();
    let idx;
    while ((idx = psBuf.indexOf('__DONE__')) >= 0) {
      const out = psBuf.slice(0, idx);
      psBuf = psBuf.slice(idx + '__DONE__'.length);
      if (psPending) {
        const p = psPending;
        psPending = null;
        p(out);
      }
    }
  });
  ps.on('exit', () => { ps = null; psPending = null; });
  return ps;
}

/** 向常驻 PowerShell 发送命令，返回其 stdout 输出（不含 __DONE__ 标记） */
function sendCommand(cmd, timeoutMs = 2000) {
  const p = ensurePs();
  const job = psQueue.then(() => new Promise((resolve) => {
    let done = false;
    const finish = (out) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (psPending === finish) psPending = null;
      resolve(out || '');
    };
    const timer = setTimeout(() => finish(''), timeoutMs); // 保险超时
    psPending = finish;
    p.stdin.write(`${cmd}; Write-Output '__DONE__'\n`);
  }));
  psQueue = job.catch(() => {});
  return job;
}

/** 发送一次 Ctrl+C 模拟复制 */
function sendCopy() {
  return sendCommand("$w = New-Object -ComObject wscript.shell; $w.SendKeys('^c')");
}

/** 兼容旧调用方式（独立进程，备用） */
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

// ---------- UIA 取词（不碰剪贴板） ----------

let uiaPs1Path = null;
function ensureUiaPs1() {
  if (uiaPs1Path) return uiaPs1Path;
  // 从 asar 内读取脚本（打包后 fs 也可读），写入数据目录供 PowerShell 加载（需 UTF-8 BOM）
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'uia.ps1'), 'utf8');
  const dest = path.join(getDataDir(), 'uia.ps1');
  fs.writeFileSync(dest, '\uFEFF' + src, 'utf8');
  uiaPs1Path = dest;
  return dest;
}

/**
 * UIA 取词：读取选中文本 + 所在段落。
 * @returns {null|{selected:string, context:string}}
 */
async function grabViaUia() {
  try {
    const ps1 = ensureUiaPs1();
    const out = await sendCommand(
      `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; . '${ps1}'; Get-TranenSelection | ConvertTo-Json -Compress`,
      1500
    );
    const line = String(out).trim().split('\n').filter(Boolean).pop() || '{}';
    const data = JSON.parse(line);
    if (!data.ok || !data.selected) return null;
    return { selected: data.selected.trim(), context: (data.context || '').trim() };
  } catch (e) {
    console.warn('[uia] 取词失败:', e.message);
    return null;
  }
}

// ---------- 热键注册 ----------

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

/**
 * 取词：UIA 优先（不碰剪贴板、自动带语境段落），失败回退剪贴板方案。
 */
async function grabSelection() {
  // 1) UIA 直读
  const uia = await grabViaUia();
  if (uia) {
    // 选中文本所在段落 → 语境缓存（查词时自动匹配出句子）
    if (uia.context && uia.context !== uia.selected) context.push(uia.context);
    return uia.selected;
  }

  // 2) 回退：模拟复制 + 剪贴板快照恢复
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

module.exports = { register, unregister, grabSelection, cleanText, classify, setWatchSync, isBusy, grabViaUia, sendCommand };
