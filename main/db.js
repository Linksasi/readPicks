const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { supermemo } = require('supermemo');
const { getDataDir } = require('./config');

let db = null;
const DAY = 24 * 60 * 60 * 1000;
// LWW 时钟容差：远端 updated_at 超前本地时钟超过该值视为设备时钟漂移，钳制到当前时间
const CLOCK_SKEW_MS = 5 * 60 * 1000;

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
  // 同步支持迁移（PC = 局域网同步中枢，本库即服务端库）：
  // - words.updated_at   每次本地修改的时间戳，LWW 合并依据
  // - words.deleted      墓碑：删除跨设备传播，查询路径统一过滤；重新查询=复活并重置进度
  // - queries.uuid       同步主键（AUTOINCREMENT 各端独立会撞号，语境事件以 uuid 为身份做并集）
  // - queries.srv_at     服务端接收时间（拉取增量游标，服务端权威时钟，不信任设备时钟）
  const wcols = db.prepare('PRAGMA table_info(words)').all().map((c) => c.name);
  if (!wcols.includes('updated_at')) db.exec('ALTER TABLE words ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0');
  if (!wcols.includes('deleted')) db.exec('ALTER TABLE words ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0');
  const qcols2 = db.prepare('PRAGMA table_info(queries)').all().map((c) => c.name);
  // 先补列后回填（回填语句同时写 uuid 和 srv_at，两列必须都已存在）
  if (!qcols2.includes('uuid')) db.exec('ALTER TABLE queries ADD COLUMN uuid TEXT');
  if (!qcols2.includes('srv_at')) db.exec('ALTER TABLE queries ADD COLUMN srv_at INTEGER NOT NULL DEFAULT 0');
  // 每次启动都补洞：升级前遗留的历史行、以及升级前启动的旧进程在新结构上写入的行（无 uuid）
  const legacy = db.prepare('SELECT id FROM queries WHERE uuid IS NULL').all();
  if (legacy.length) {
    const backfill = db.prepare('UPDATE queries SET uuid = ?, srv_at = created_at WHERE id = ?');
    const run = db.transaction(() => {
      for (const r of legacy) backfill.run(crypto.randomUUID(), r.id);
    });
    run();
    console.log('[db] 迁移回填：', legacy.length, '条历史查询已补 uuid/srv_at');
  }
  // words.updated_at 回填：老行取 last_seen（近似最后活跃时间）
  if (db.prepare('SELECT COUNT(*) AS c FROM words WHERE updated_at = 0').get().c > 0) {
    db.prepare('UPDATE words SET updated_at = last_seen WHERE updated_at = 0').run();
  }
  db.exec(`
    DROP INDEX IF EXISTS idx_queries_word;
    CREATE INDEX IF NOT EXISTS idx_queries_word_created ON queries(word, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_words_due ON words(due_date);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_queries_uuid ON queries(uuid);
    CREATE INDEX IF NOT EXISTS idx_queries_srv ON queries(srv_at);
    CREATE INDEX IF NOT EXISTS idx_words_updated ON words(updated_at);
  `);
}
/**
 * 记录一次查询：生词计数 +1（首次则插入），语境/简单释义入库。
 * 每次查询都落一条 queries 事件行（uuid 唯一），既做语境回捞也是同步的事件流——
 * 跨端合并时 query_count 由事件行数推导，不会因并发查询丢计数。
 * 已删除（墓碑）的词再次被查到 = 用户重新拾取：复活并重置 SM-2 进度。
 * @returns {object} { word, phonetic, definition, queryCount, firstSeen, lastSeen, history }
 */
function recordLookup({ word, phonetic = '', definition = '', context = '', contextCloze = '', sentenceTranslation = '', wordInSentence = '', simpleDef = '', source = 'dict' }) {
  const now = Date.now();
  const existing = db.prepare('SELECT * FROM words WHERE word = ?').get(word);
  let queryCount;
  if (existing && !existing.deleted) {
    queryCount = existing.query_count + 1;
    db.prepare('UPDATE words SET query_count = ?, last_seen = ?, phonetic = ?, definition = ?, updated_at = ? WHERE word = ?')
      .run(queryCount, now, phonetic || existing.phonetic, definition || existing.definition, now, word);
  } else if (existing && existing.deleted) {
    // 墓碑复活：重新拾取，SM-2 进度重置（计数也从 1 开始）
    queryCount = 1;
    db.prepare(`UPDATE words SET query_count = 1, first_seen = ?, last_seen = ?, phonetic = ?, definition = ?,
                efactor = 2.5, interval = 0, repetitions = 0, due_date = 0, deleted = 0, updated_at = ? WHERE word = ?`)
      .run(now, now, phonetic, definition, now, word);
  } else {
    queryCount = 1;
    db.prepare('INSERT INTO words (word, phonetic, definition, first_seen, last_seen, query_count, updated_at) VALUES (?,?,?,?,?,?,?)')
      .run(word, phonetic, definition, now, now, 1, now);
  }
  // 事件行：每次查询必落一条（无语境的裸查词也记，供跨端计数合并与语境回捞）
  db.prepare(`INSERT INTO queries (word, context, context_cloze, sentence_translation, word_in_sentence, source, created_at, simple_def, uuid, srv_at)
              VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(word, context || null, contextCloze || null, sentenceTranslation || null, wordInSentence || null, source, now, simpleDef || null, crypto.randomUUID(), now);
  return {
    word,
    phonetic,
    definition,
    queryCount,
    firstSeen: existing && !existing.deleted ? existing.first_seen : now,
    lastSeen: now,
    history: getHistory(word, 10),
  };
}

function getWord(word) {
  return db.prepare('SELECT * FROM words WHERE word = ?').get(word);
}

function getHistory(word, limit = 10) {
  // 只取带内容的记录（语境/句中译法/简单释义）——裸事件行仅供同步计数，不进历史展示
  return db.prepare(`SELECT * FROM queries WHERE word = ? AND (context IS NOT NULL OR word_in_sentence IS NOT NULL OR simple_def IS NOT NULL)
                    ORDER BY created_at DESC LIMIT ?`).all(word, limit);
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
  db.prepare('UPDATE words SET note = ?, updated_at = ? WHERE word = ?').run(note, Date.now(), word);
}

/** 删除 = 打墓碑（同步语义：跨设备传播删除；queries 事件保留，重新拾取时语境可回捞） */
function removeWord(word) {
  db.prepare('UPDATE words SET deleted = 1, updated_at = ? WHERE word = ?').run(Date.now(), word);
}

/** 物理删除（仅供测试/开发清理，不走同步——正常删除请用 removeWord 墓碑） */
function purgeWord(word) {
  db.prepare('DELETE FROM words WHERE word = ?').run(word);
  db.prepare('DELETE FROM queries WHERE word = ?').run(word);
}

/** SM-2 复习：grade 0-5（UI 映射：忘记=0 模糊=3 认识=5） */
function reviewWord(word, grade) {
  const row = db.prepare('SELECT * FROM words WHERE word = ? AND deleted = 0').get(word);
  if (!row) return null;
  const next = supermemo({ interval: row.interval, repetition: row.repetitions, efactor: row.efactor }, grade);
  const due = Date.now() + next.interval * DAY;
  db.prepare('UPDATE words SET interval = ?, repetitions = ?, efactor = ?, due_date = ?, updated_at = ? WHERE word = ?')
    .run(next.interval, next.repetition, next.efactor, due, Date.now(), word);
  return { ...row, ...next, due };
}

/** 今日到期（含从未复习过的：due_date=0 且首次查询超过 1 天） */
function dueWords(limit = 20) {
  return db.prepare(
    `SELECT * FROM words
     WHERE deleted = 0 AND due_date <= ? AND (due_date != 0 OR first_seen < ?)
     ORDER BY due_date ASC, first_seen ASC LIMIT ?`
  ).all(Date.now(), Date.now() - DAY, limit);
}

function dueCount() {
  return db.prepare(
    `SELECT COUNT(*) AS c FROM words
     WHERE deleted = 0 AND due_date <= ? AND (due_date != 0 OR first_seen < ?)`
  ).get(Date.now(), Date.now() - DAY).c;
}

function allWords(limit = 5000) {
  return db.prepare('SELECT * FROM words WHERE deleted = 0 ORDER BY last_seen DESC LIMIT ?').all(limit);
}

/** 最近查询过的词（悬浮窗快捷入口） */
function recentWords(limit = 12) {
  return db.prepare('SELECT word, query_count, last_seen FROM words WHERE deleted = 0 ORDER BY last_seen DESC LIMIT ?').all(limit);
}

/** 导出 Anki 可导入的 UTF-8 制表符 .txt（附语境句：context 原句 + cloze 挖空句，供 Basic/Cloze 两种卡片类型使用） */
function exportAnki(filePath) {
  const rows = db.prepare('SELECT word, phonetic, definition FROM words WHERE deleted = 0 ORDER BY first_seen DESC').all();
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
  return db.prepare('SELECT COUNT(*) AS total FROM words WHERE deleted = 0').get().total;
}

// ---------- 同步合并（PC 即服务端；手机端 push 上来在这里落地，其他设备 pull 走增量游标） ----------

/** 增量：自游标以来的词行（含墓碑，删除也要传播） */
function getWordsSince(sinceTs) {
  return db.prepare('SELECT * FROM words WHERE updated_at >= ?').all(sinceTs);
}

/** 增量：自游标以来的语境事件（按服务端接收时间 srv_at，权威时钟不依赖设备） */
function getQueriesSince(sinceTs) {
  return db.prepare('SELECT * FROM queries WHERE srv_at >= ?').all(sinceTs);
}

/** 合并一行远端词：LWW（updated_at 新者胜；超前的设备时钟钳制到本地当前时间）。返回是否落库 */
function applyWordFromSync(row, now) {
  if (!row || !row.word) return false;
  let ua = Number(row.updated_at) || 0;
  if (ua > now + CLOCK_SKEW_MS) ua = now; // 设备时钟漂移防护
  const existing = db.prepare('SELECT updated_at FROM words WHERE word = ?').get(row.word);
  if (existing && existing.updated_at >= ua) return false; // 本地更新或同刻 → 远端让位（幂等）
  db.prepare(`INSERT INTO words (word, phonetic, definition, note, query_count, first_seen, last_seen,
              efactor, interval, repetitions, due_date, updated_at, deleted)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(word) DO UPDATE SET phonetic=excluded.phonetic, definition=excluded.definition,
              note=excluded.note, query_count=excluded.query_count, first_seen=excluded.first_seen,
              last_seen=excluded.last_seen, efactor=excluded.efactor, interval=excluded.interval,
              repetitions=excluded.repetitions, due_date=excluded.due_date, updated_at=excluded.updated_at,
              deleted=excluded.deleted`)
    .run(row.word, row.phonetic || '', row.definition || '', row.note || '',
      Number(row.query_count) || 1, Number(row.first_seen) || ua, Number(row.last_seen) || ua,
      Number(row.efactor) || 2.5, Number(row.interval) || 0, Number(row.repetitions) || 0,
      Number(row.due_date) || 0, ua, row.deleted ? 1 : 0);
  return true;
}

/** 合并一条远端语境事件：按 uuid 做并集（append-only 永不冲突），重复即忽略（幂等） */
function applyQueryFromSync(row, now) {
  if (!row || !row.uuid || !row.word) return false;
  const dup = db.prepare('SELECT id FROM queries WHERE uuid = ?').get(row.uuid);
  if (dup) return false;
  // 防御：事件先于词行到达时补一条词行骨架（正常 push 中词行同批携带）
  const hasWord = db.prepare('SELECT word FROM words WHERE word = ?').get(row.word);
  if (!hasWord) {
    const ca = Number(row.created_at) || now;
    db.prepare(`INSERT INTO words (word, phonetic, definition, first_seen, last_seen, query_count, updated_at, deleted)
                VALUES (?, '', '', ?, ?, 0, ?, 0)`).run(row.word, ca, ca, now);
  }
  db.prepare(`INSERT INTO queries (word, context, context_cloze, sentence_translation, word_in_sentence,
              simple_def, source, created_at, uuid, srv_at)
              VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(row.word, row.context ?? null, row.context_cloze ?? null, row.sentence_translation ?? null,
      row.word_in_sentence ?? null, row.simple_def ?? null, row.source || 'sync',
      Number(row.created_at) || now, row.uuid, now);
  return true;
}

/** 事件落地后由事件流推导计数：query_count/last_seen 取「行值与事件统计的较大者」（单调不回退） */
function refreshCountsFromEvents(words) {
  // COALESCE：无事件的词 MAX(created_at) 为 NULL，而 SQLite 多参 max() 任一参为 NULL 即返回 NULL
  const upd = db.prepare(`UPDATE words SET
      query_count = MAX(query_count, (SELECT COUNT(*) FROM queries WHERE queries.word = words.word)),
      last_seen   = MAX(last_seen,  COALESCE((SELECT MAX(created_at) FROM queries WHERE queries.word = words.word), 0))
    WHERE word = ?`);
  for (const w of words) if (w) upd.run(w);
}

/**
 * 应用一批来自设备的远端变更（push 落地），事务保证原子性。
 * @returns {{appliedWords: number, appliedQueries: number, touched: string[]}}
 */
function applySyncBatch({ words = [], queries = [] } = {}, now = Date.now()) {
  const touched = new Set();
  let appliedWords = 0;
  let appliedQueries = 0;
  const run = db.transaction(() => {
    for (const w of words) if (applyWordFromSync(w, now)) appliedWords++;
    for (const q of queries) if (applyQueryFromSync(q, now)) appliedQueries++;
    // 词行与事件行都可能带来计数变化，统一推导一次
    for (const w of words) if (w && w.word) touched.add(w.word);
    for (const q of queries) if (q && q.word) touched.add(q.word);
    refreshCountsFromEvents([...touched]);
  });
  run();
  return { appliedWords, appliedQueries, touched: [...touched] };
}

module.exports = { init, recordLookup, getWord, getHistory, getRecentContexts, setNote, removeWord, purgeWord, reviewWord, dueWords, dueCount, allWords, recentWords, exportAnki, stats, getWordsSince, getQueriesSince, applySyncBatch };
