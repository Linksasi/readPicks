const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { supermemo } = require('supermemo');
const { getDataDir } = require('./config');

let db = null;
const DAY = 24 * 60 * 60 * 1000;

function init() {
  const dir = getDataDir();
  fs.mkdirSync(dir, { recursive: true });
  db = new Database(path.join(dir, 'words.db'));
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS words (
      word        TEXT PRIMARY KEY,
      phonetic    TEXT DEFAULT '',
      definition  TEXT DEFAULT '',
      first_seen  INTEGER NOT NULL,
      last_seen   INTEGER NOT NULL,
      query_count INTEGER NOT NULL DEFAULT 1,
      note        TEXT DEFAULT '',
      efactor     REAL NOT NULL DEFAULT 2.5,
      interval    INTEGER NOT NULL DEFAULT 0,
      repetitions INTEGER NOT NULL DEFAULT 0,
      due_date    INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS queries (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      word                 TEXT NOT NULL,
      context              TEXT,
      context_cloze        TEXT,
      sentence_translation TEXT,
      word_in_sentence     TEXT,
      source               TEXT,
      created_at           INTEGER NOT NULL
    );
    DROP INDEX IF EXISTS idx_queries_word;
    CREATE INDEX IF NOT EXISTS idx_queries_word_created ON queries(word, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_words_due ON words(due_date);
  `);
  // 增量迁移：旧库补 simple_def 列（LLM 简单英语释义持久化，复习卡复用；查词时算一次就丢太浪费）
  const cols = db.prepare('PRAGMA table_info(queries)').all().map((c) => c.name);
  if (!cols.includes('simple_def')) db.exec('ALTER TABLE queries ADD COLUMN simple_def TEXT');
}

/**
 * 记录一次查询：生词计数 +1（首次则插入），语境/简单释义入库。
 * @returns {object} { word, phonetic, definition, queryCount, firstSeen, lastSeen, history }
 */
function recordLookup({ word, phonetic = '', definition = '', context = '', contextCloze = '', sentenceTranslation = '', wordInSentence = '', simpleDef = '', source = 'dict' }) {
  const now = Date.now();
  const existing = db.prepare('SELECT * FROM words WHERE word = ?').get(word);
  let queryCount;
  if (existing) {
    queryCount = existing.query_count + 1;
    db.prepare('UPDATE words SET query_count = ?, last_seen = ?, phonetic = ?, definition = ? WHERE word = ?')
      .run(queryCount, now, phonetic || existing.phonetic, definition || existing.definition, word);
  } else {
    queryCount = 1;
    db.prepare('INSERT INTO words (word, phonetic, definition, first_seen, last_seen, query_count) VALUES (?,?,?,?,?,?)')
      .run(word, phonetic, definition, now, now, 1);
  }
  // simple_def 单独成行也入库（无语境查词的简单释义同样供复习卡复用）
  if (context || wordInSentence || simpleDef) {
    db.prepare(`INSERT INTO queries (word, context, context_cloze, sentence_translation, word_in_sentence, source, created_at, simple_def)
                VALUES (?,?,?,?,?,?,?,?)`)
      .run(word, context || null, contextCloze || null, sentenceTranslation || null, wordInSentence || null, source, now, simpleDef || null);
  }
  return {
    word,
    phonetic,
    definition,
    queryCount,
    firstSeen: existing ? existing.first_seen : now,
    lastSeen: now,
    history: getHistory(word, 10),
  };
}

function getWord(word) {
  return db.prepare('SELECT * FROM words WHERE word = ?').get(word);
}

function getHistory(word, limit = 10) {
  return db.prepare('SELECT * FROM queries WHERE word = ? ORDER BY created_at DESC LIMIT ?').all(word, limit);
}

/**
 * 批量取每个词的语境记录（复习卡/导出用，避免 N+1 查询）。
 * 优先取最近一条「带挖空语境句」的记录——最新一次查询可能没复制句子，
 * 但语境永远在场（理念）：只要历史上有过语境就回捞出来。
 * 该词从未有语境时回退到最新一条记录（保住句译/词中译法展示）。
 * 返回 Map<word, row>
 */
function getRecentContexts(words) {
  const map = new Map();
  if (!words.length) return map;
  const ph = words.map(() => '?').join(',');
  const ctxRows = db.prepare(
    `SELECT * FROM queries WHERE id IN (
       SELECT MAX(id) FROM queries WHERE word IN (${ph}) AND context_cloze IS NOT NULL GROUP BY word
     )`
  ).all(...words);
  for (const r of ctxRows) map.set(r.word, r);
  const missing = words.filter((w) => !map.has(w));
  if (missing.length) {
    const ph2 = missing.map(() => '?').join(',');
    const latest = db.prepare(
      `SELECT * FROM queries WHERE id IN (
         SELECT MAX(id) FROM queries WHERE word IN (${ph2}) GROUP BY word
       )`
    ).all(...missing);
    for (const r of latest) map.set(r.word, r);
  }
  return map;
}

function setNote(word, note) {
  db.prepare('UPDATE words SET note = ? WHERE word = ?').run(note, word);
}

function removeWord(word) {
  db.prepare('DELETE FROM words WHERE word = ?').run(word);
  db.prepare('DELETE FROM queries WHERE word = ?').run(word);
}

/** SM-2 复习：grade 0-5（UI 映射：忘记=0 模糊=3 认识=5） */
function reviewWord(word, grade) {
  const row = db.prepare('SELECT * FROM words WHERE word = ?').get(word);
  if (!row) return null;
  const next = supermemo({ interval: row.interval, repetition: row.repetitions, efactor: row.efactor }, grade);
  const due = Date.now() + next.interval * DAY;
  db.prepare('UPDATE words SET interval = ?, repetitions = ?, efactor = ?, due_date = ? WHERE word = ?')
    .run(next.interval, next.repetition, next.efactor, due, word);
  return { ...row, ...next, due };
}

/** 今日到期（含从未复习过的：due_date=0 且首次查询超过 1 天） */
function dueWords(limit = 20) {
  return db.prepare(
    `SELECT * FROM words
     WHERE due_date <= ? AND (due_date != 0 OR first_seen < ?)
     ORDER BY due_date ASC, first_seen ASC LIMIT ?`
  ).all(Date.now(), Date.now() - DAY, limit);
}

function dueCount() {
  return db.prepare(
    `SELECT COUNT(*) AS c FROM words
     WHERE due_date <= ? AND (due_date != 0 OR first_seen < ?)`
  ).get(Date.now(), Date.now() - DAY).c;
}

function allWords(limit = 5000) {
  return db.prepare('SELECT * FROM words ORDER BY last_seen DESC LIMIT ?').all(limit);
}

/** 最近查询过的词（悬浮窗快捷入口） */
function recentWords(limit = 12) {
  return db.prepare('SELECT word, query_count, last_seen FROM words ORDER BY last_seen DESC LIMIT ?').all(limit);
}

/** 导出 Anki 可导入的 UTF-8 制表符 .txt（附语境句：context 原句 + cloze 挖空句，供 Basic/Cloze 两种卡片类型使用） */
function exportAnki(filePath) {
  const rows = db.prepare('SELECT word, phonetic, definition FROM words ORDER BY first_seen DESC').all();
  const ctxMap = getRecentContexts(rows.map((r) => r.word));
  const esc = (s) => String(s || '').replace(/\n/g, '<br>').replace(/\t/g, ' ');
  const lines = [
    '#separator:tab',
    '#html:true',
    '#tags:readpicks',
    '#columns:word,phonetic,translation,context,cloze',
    '#deck:ReadPicks 生词本',
  ];
  for (const r of rows) {
    const ctx = ctxMap.get(r.word);
    lines.push([
      esc(r.word), esc(r.phonetic), esc(r.definition),
      esc(ctx?.context || ''), esc(ctx?.context_cloze || ''),
    ].join('\t'));
  }
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
  return rows.length;
}

function stats() {
  return db.prepare('SELECT COUNT(*) AS total FROM words').get().total;
}

module.exports = { init, recordLookup, getWord, getHistory, getRecentContexts, setNote, removeWord, reviewWord, dueWords, dueCount, allWords, recentWords, exportAnki, stats };
