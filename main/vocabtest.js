// 词汇量自测：分层抽样（借鉴 TestYourVocab 桶估计法）+ 真假词防作弊（借鉴 LexTALE）
// 数据源：ECDICT 的 bnc（BNC 语料词频排名），离线完成，无需联网。
// 计分：每频段通过率（真词认识数 - 假词误认数 修正）× 该频段词表大小，累加得词汇量估计。

const path = require('path');
const { getDataDir, load, update } = require('./config');

let db = null; // ecdict.db 只读连接（懒加载）

function ensureDb() {
  if (db) return db;
  const p = path.join(getDataDir(), 'ecdict', 'ecdict.db');
  try {
    const fs = require('fs');
    if (!fs.existsSync(p)) return null;
    db = require('better-sqlite3')(p, { readonly: true });
  } catch (e) {
    console.warn('[vocab] ecdict 打开失败:', e.message);
    db = null;
  }
  return db;
}

// ---------- 频段与抽样 ----------

// bnc 排名分 6 个频段（第 6 段为低频长尾，代表 15001-50000 的常用书面词）
const BUCKETS = [
  { lo: 1, hi: 1000, size: 1000, real: 8 },
  { lo: 1001, hi: 2000, size: 1000, real: 8 },
  { lo: 2001, hi: 4000, size: 2000, real: 8 },
  { lo: 4001, hi: 8000, size: 4000, real: 8 },
  { lo: 8001, hi: 15000, size: 7000, real: 8 },
  { lo: 15001, hi: 50000, size: 35000, real: 8 },
];
const REAL_TOTAL = BUCKETS.reduce((s, b) => s + b.real, 0); // 48
const FAKE_TOTAL = 12; // 48 真词 + 12 假词 = 60 题

// 预置假词池：形似英语但不存在（已逐词对照 ECDICT 校验；运行时仍会查库兜底）
const FAKE_WORDS = [
  'worbly', 'flumness', 'prancify', 'crostion', 'blunderse',
  'dravelous', 'splotment', 'quernify', 'thwipish', 'ploritude',
  'vixible', 'froddle', 'clumberous', 'drepplet', 'brizzen',
  'glumph', 'snorkative', 'pliffer', 'crunge', 'draffly',
  'fumblet', 'snurble', 'drenchle', 'plobble', 'flomper',
];

// 真词筛选：纯小写字母 3-14 位（排除专名/缩写/过短过长），且带释义
function sampleReal(conn, b) {
  return conn.prepare(
    `SELECT word FROM stardict
     WHERE bnc BETWEEN ? AND ? AND word GLOB '[a-z]*' AND length(word) BETWEEN 3 AND 14
       AND (translation IS NOT NULL AND length(translation) > 1)
     ORDER BY RANDOM() LIMIT ?`
  ).all(b.lo, b.hi, b.real).map((r) => r.word);
}

function wordExists(conn, w) {
  return !!conn.prepare('SELECT 1 FROM stardict WHERE word = ? LIMIT 1').get(w);
}

function sampleFake(conn, n) {
  const pool = FAKE_WORDS.filter((w) => !wordExists(conn, w)); // 防与真词冲突
  const out = [];
  while (out.length < n && pool.length) {
    const i = Math.floor(Math.random() * pool.length);
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}

// ---------- 会话 ----------

let session = null; // { items: [{word, bucketIdx, fake}], ts }

/**
 * 开始一次测试：生成 60 题（48 真词 + 12 假词，随机混排）。
 * 返回给渲染层的题组不含真假标记（防作弊）。
 */
function startTest() {
  const conn = ensureDb();
  if (!conn) return { ok: false, error: '词汇量测试需要 ECDICT 词典，请先在「词典」页安装' };

  const items = [];
  BUCKETS.forEach((b, idx) => {
    for (const w of sampleReal(conn, b)) items.push({ word: w, bucketIdx: idx, fake: false });
    // 每段真词可能抽不满（段内数据不足），用剩余名额补偿到下一段不现实——直接按实际数量
  });
  for (const w of sampleFake(conn, FAKE_TOTAL)) items.push({ word: w, bucketIdx: -1, fake: true });

  // 随机洗牌
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  session = { items, ts: Date.now() };
  return { ok: true, total: items.length, words: items.map((it) => it.word) };
}

/**
 * 提交答案（answers[i] = 第 i 题是否认识），桶估计计分并写入 config.vocabLevel。
 */
function finishTest(answers) {
  if (!session) return { ok: false, error: '测试会话已过期，请重新开始' };
  if (!Array.isArray(answers) || answers.length !== session.items.length) {
    return { ok: false, error: '答案数量不匹配，请重新测试' };
  }
  const conn = ensureDb();
  if (!conn) return { ok: false, error: 'ECDICT 词典不可用' };

  // 按桶统计真词认识数；假词误认数单独统计（惩罚：每个误认 ≈ 多算了 1 个真词名额）
  const perBucket = BUCKETS.map((b) => ({ ...b, knownReal: 0 }));
  let fakeKnownTotal = 0;
  session.items.forEach((it, i) => {
    const known = !!answers[i];
    if (it.fake) {
      if (known) fakeKnownTotal++;
      return;
    }
    perBucket[it.bucketIdx].knownReal += known ? 1 : 0;
  });

  // 修正：把假词误认数按比例从总得分中扣除（每个误认 ≈ 多算了 1 个真词名额的加权平均）
  let score = 0;
  const buckets = [];
  for (const b of perBucket) {
    const rate = Math.max(0, (b.knownReal - fakeKnownTotal / BUCKETS.length) / b.real);
    const est = Math.round(b.size * rate);
    score += est;
    buckets.push({
      range: `${b.lo}-${b.hi}`,
      known: b.knownReal,
      total: b.real,
      rate: Math.round(rate * 100),
      estimated: est,
    });
  }
  score = Math.min(score, 50000);
  const cefr = toCefr(score);
  const result = { score, cefr, buckets, fakeKnown: fakeKnownTotal, takenAt: Date.now() };
  update({ vocabLevel: result }); // 持久化
  session = null;
  return { ok: true, result };
}

// ---------- 词汇水平工具 ----------

function toCefr(score) {
  if (score < 2000) return 'A1';
  if (score < 3500) return 'A2';
  if (score < 5000) return 'B1';
  if (score < 8000) return 'B2';
  if (score < 12000) return 'C1';
  return 'C2';
}

/**
 * 词汇量 → 释义用词难度上限（bnc 排名）。
 * 释义中的词若排名超过该值（更生僻），视为超出用户水平。
 */
function levelInfo(score) {
  const maxBnc = Math.max(1000, Math.min(40000, Math.round((score || 0) * 0.8)));
  return { cefr: toCefr(score || 0), maxBnc };
}

// ---------- 离线难词标注 ----------

const bncCache = new Map(); // word -> bnc（0=语料外，-1=未收录）
let bncLoaded = false;

function getBnc(word) {
  const w = String(word).toLowerCase();
  if (bncCache.has(w)) return bncCache.get(w);
  const conn = ensureDb();
  let v = -1;
  if (conn) {
    const row = conn.prepare('SELECT bnc FROM stardict WHERE word = ? LIMIT 1').get(w);
    v = row ? (row.bnc || 0) : -1;
  }
  bncCache.set(w, v);
  return v;
}

/** 标注释义文本中超出用户词汇水平的难词。返回 { hard: [word...] } */
function annotateHardWords(defText, maxBnc) {
  const words = String(defText || '').toLowerCase().match(/[a-z][a-z'-]{2,}/g) || [];
  const hard = new Set();
  for (const w of words) {
    const b = getBnc(w);
    if (b === -1 || b === 0 || b > maxBnc) hard.add(w);
  }
  return { hard: [...hard] };
}

/** 取 ECDICT 释义的第一个义项（WordNet 格式 "n. xxx n. yyy" → 第一段） */
function firstSense(def) {
  const d = String(def || '').trim();
  if (!d) return '';
  const m = d.match(/^[nvas]{1,2}\.\s*(.*)$/s);
  if (!m) return d.slice(0, 90);
  const nxt = m[1].match(/\s+[nvas]{1,2}\.\s/);
  const sense = nxt ? m[1].slice(0, nxt.index) : m[1];
  return sense.trim().slice(0, 90);
}

/**
 * 难词就地化解：为每个难词查「中文第一义 + 英文简释」，随查词结果一起下发，
 * 用户点击难词即可就地看懂，无需再查一次。
 * @returns {Array<{word, zh, en}>}
 */
function hardWordHints(hardWords) {
  const conn = ensureDb();
  if (!conn) return [];
  const out = [];
  for (const w of hardWords) {
    const key = String(w).toLowerCase();
    const row = conn.prepare('SELECT translation, definition FROM stardict WHERE word = ? LIMIT 1').get(key);
    if (!row) {
      out.push({ word: w, zh: '', en: '' });
      continue;
    }
    // 中文第一义：翻译字段首行（去词性前缀）
    let zh = '';
    const tline = String(row.translation || '').split('\n').map((s) => s.trim()).find(Boolean) || '';
    const tm = tline.match(/^[a-z]+\.\s*(.*)$/i);
    zh = (tm ? tm[1] : tline).slice(0, 60);
    out.push({ word: w, zh, en: firstSense(row.definition) });
  }
  return out;
}

/** 当前已保存的词汇量（config） */
function currentLevel() {
  const cfg = load();
  return cfg.vocabLevel || null;
}

/**
 * 词难度判定：该词的 bnc 词频排名相对用户词汇量的难度。
 * @returns {null|{level:'within'|'above'|'far-above', bnc, maxBnc}}
 *   within    = 在用户水平内（bnc ≤ 词汇量×0.8）
 *   above     = 略超水平（≤ 词汇量×1.5）
 *   far-above = 远超水平或语料外生僻词
 */
function wordLevel(bnc, userScore) {
  if (!userScore) return null;
  const { maxBnc } = levelInfo(userScore);
  const b = Number(bnc) || 0;
  if (b <= 0) return { level: 'far-above', bnc: b, maxBnc }; // 语料外/未收录
  if (b <= maxBnc) return { level: 'within', bnc: b, maxBnc };
  if (b <= userScore * 1.5) return { level: 'above', bnc: b, maxBnc };
  return { level: 'far-above', bnc: b, maxBnc };
}

module.exports = { startTest, finishTest, levelInfo, annotateHardWords, hardWordHints, currentLevel, wordLevel, toCefr, BUCKETS };
