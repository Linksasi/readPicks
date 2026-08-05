const path = require('path');
const fs = require('fs');
const { getDataDir } = require('./config');

let db = null;          // better-sqlite3 实例（ecdict.db）
let lemma = new Map();  // 变形词 → 原形（lemma.en.txt）
let installed = false;

const DIR = () => path.join(getDataDir(), 'ecdict');
const DB_PATH = () => path.join(DIR(), 'ecdict.db');
const LEMMA_PATH = () => path.join(DIR(), 'lemma.en.txt');

function isInstalled() {
  return installed;
}

function init() {
  try {
    if (fs.existsSync(DB_PATH())) {
      db = require('better-sqlite3')(DB_PATH(), { readonly: true });
      // 探测表名：官方 sqlite release 用 stardict
      const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").get();
      installed = !!t;
      loadLemma();
    }
  } catch (e) {
    console.error('[ecdict] init failed:', e.message);
    installed = false;
  }
  return installed;
}

function loadLemma() {
  try {
    if (!fs.existsSync(LEMMA_PATH())) return;
    const raw = fs.readFileSync(LEMMA_PATH(), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.trim().split('\t');
      if (m.length >= 2 && m[0] && m[1]) {
        // 第一列=词形，第二列=原形（小写归一）
        lemma.set(m[0].toLowerCase(), m[1].toLowerCase());
      }
    }
  } catch (e) {
    console.error('[ecdict] lemma load failed:', e.message);
  }
}

const COLUMNS = 'word, phonetic, translation, definition, pos, collins, oxford, tag, bnc, frq, exchange';

/**
 * 查词：精确 → lemma 词形还原 → 大小写变体。
 * @returns {object|null} 含 word/phonetic/translation/definition/pos/tags/collins/oxford/exchange
 */
function lookup(input) {
  if (!installed || !db) return null;
  const w = String(input || '').trim();
  if (!w) return null;

  const variants = new Set();
  variants.add(w.toLowerCase());
  variants.add(w);
  const base = lemma.get(w.toLowerCase());
  if (base) variants.add(base);

  let row = null;
  for (const v of variants) {
    row = db.prepare(`SELECT ${COLUMNS} FROM stardict WHERE word = ? LIMIT 1`).get(v);
    if (row) break;
  }
  if (!row) return null;

  return {
    word: row.word,
    phonetic: row.phonetic || '',
    translation: row.translation || '',      // "n. 苹果\nv. 认可" 行式
    definition: row.definition || '',        // 英文释义
    pos: row.pos || '',
    tags: String(row.tag || '').split(/\s+/).filter(Boolean),
    collins: row.collins || 0,               // 柯林斯星级 0-5
    oxford: row.oxford || 0,                 // 牛津 3000 标记
    bnc: row.bnc || '',                      // 词频序
    frq: row.frq || '',
    exchange: row.exchange || '',            // 词形变化 "d:gave/given/giving"
    matchedBase: base || null,
  };
}

/** 翻译字段 → [{pos, def}] */
function parseTranslation(translation) {
  return String(translation || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = l.match(/^([a-z]+)\.\s*(.*)$/i);
      return m ? { pos: m[1].toLowerCase(), def: m[2] } : { pos: '', def: l };
    });
}

module.exports = { init, isInstalled, lookup, parseTranslation, DIR, DB_PATH, LEMMA_PATH };
