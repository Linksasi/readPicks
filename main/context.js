const { getDataDir } = require('./config');
const path = require('path');
const fs = require('fs');

// 剪贴板历史回溯：记录最近复制过的文本，
// 查单词时自动找最近包含该词的句子作为语境（产品核心功能）。
// 持久化到磁盘：重启应用后仍保留，句子复制时间窗口 10 分钟。

const WINDOW_MS = 10 * 60 * 1000;
const MAX = 50;
const HISTORY_FILE = () => path.join(getDataDir(), 'clipboard-history.json');

let buf = [];
let saveTimer = null;

function persist() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(getDataDir(), { recursive: true });
      fs.writeFileSync(HISTORY_FILE(), JSON.stringify(buf), 'utf8');
    } catch (e) {
      console.warn('[context] persist failed:', e.message);
    }
  }, 1500);
}

/** 启动时加载上次记录的复制内容（时间戳重置为当前，视为最近语境） */
function init() {
  try {
    if (!fs.existsSync(HISTORY_FILE())) return;
    const saved = JSON.parse(fs.readFileSync(HISTORY_FILE(), 'utf8'));
    if (Array.isArray(saved)) {
      const now = Date.now();
      buf = saved.filter((x) => x && typeof x.text === 'string' && x.text.trim())
        .slice(-MAX)
        .map((x) => ({ text: x.text.trim(), ts: now }));
    }
  } catch (e) {
    console.warn('[context] init failed:', e.message);
  }
}

function push(text) {
  if (!text || typeof text !== 'string') return;
  const t = text.trim();
  if (!t) return;
  const last = buf[buf.length - 1];
  if (last && last.text === t) return; // 去重
  buf.push({ text: t, ts: Date.now() });
  if (buf.length > MAX) buf.shift();
  persist();
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function loadLemmaMap() {
  try {
    const p = path.join(getDataDir(), 'ecdict', 'lemma.en.txt');
    if (!fs.existsSync(p)) return new Map();
    const map = new Map();
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.trim().split('\t');
      if (m.length >= 2 && m[0]) map.set(m[0].toLowerCase(), m[1].toLowerCase());
    }
    return map;
  } catch {
    return new Map();
  }
}

const lemmaCache = loadLemmaMap();

function containsWord(text, word) {
  const w = String(word).toLowerCase();
  if (new RegExp(`\\b${escapeRegExp(w)}\\b`, 'i').test(text)) return true;
  const base = lemmaCache.get(w);
  return base ? new RegExp(`\\b${escapeRegExp(base)}\\b`, 'i').test(text) : false;
}

/** 在最近 WINDOW_MS 内缓存文本中，找包含 word 的句子 */
function findContext(word) {
  const now = Date.now();
  const w = String(word).trim();
  if (!w) return null;
  for (let i = buf.length - 1; i >= 0; i--) {
    const { text, ts } = buf[i];
    if (now - ts > WINDOW_MS) continue;
    const sentences = text.split(/[.!?。！？;；\n]+/).map((s) => s.trim()).filter((s) => s.length > 2);
    for (const s of sentences) {
      if (s.toLowerCase() === w.toLowerCase()) continue;       // 排除查询词自身
      if (s.length <= w.length + 1) continue;                  // 语境句必须比单词长
      if (containsWord(s, w)) return s;
    }
  }
  return null;
}

/** 挖空语境句：ContextCloze（沙拉查词理念） */
function makeCloze(context, word) {
  const w = String(word);
  return String(context).replace(new RegExp(`\\b(${escapeRegExp(w)})\\b`, 'i'), '{{c1::$1}}');
}

function clear() {
  buf = [];
  persist();
}

module.exports = { init, push, findContext, makeCloze, containsWord, clear };
