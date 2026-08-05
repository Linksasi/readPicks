const { globalShortcut, clipboard } = require('electron');
const { execFile } = require('child_process');
const { load } = require('./config');

// 全局热键 + 模拟复制取词（nextai 快照恢复方案）：
// 保存剪贴板 → 清空 → 模拟 Ctrl+C → 读取 → 恢复原内容（含图片/HTML）

let isSimulating = false;
let watchSync = null;   // clipboard-watch 模块的回调，恢复后同步其 last
let handler = null;     // async (text) => {}
let lastQuery = { text: '', ts: 0 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function setWatchSync(fn) {
  watchSync = fn;
}

function register(cb) {
  handler = cb;
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
