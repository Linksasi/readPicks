const { getDataDir } = require('./config');
const path = require('path');
const fs = require('fs');

// 剪贴板历史回溯：缓存最近复制过的文本，
// 查单词时自动找 1 分钟内包含该词的句子作为语境（产品核心功能）。

const WINDOW_MS = 60 * 1000;
const MAX = 50;
let buf = [];

function push(text) {
  if (!text || typeof text !== 'string') return;
  const t = text.trim();
  if (!t) return;
  const last = buf[buf.length - 1];
  if (last && last.text === t) return; // 去重
  buf.push({ text: t, ts: Date.now() });
  if (buf.length > MAX) buf.shift();
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
}

module.exports = { push, findContext, makeCloze, containsWord, clear };
