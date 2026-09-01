// mobile/www/db.js — IndexedDB 数据层
// 与 PC 端 main/db.js 同一 schema 语义：words（SM-2 状态 + updated_at + 墓碑）+ queries（uuid 事件流）
// 所有本地修改都记录脏标记，供同步客户端增量 push
'use strict';

const DAY = 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 60 * 1000;

let idb = null;

/** 打开 IndexedDB（命名 openDb：顶层 function 会挂到 window，避免覆盖 window.open） */
async function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('readpicks', 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('words')) {
        const s = d.createObjectStore('words', { keyPath: 'word' });
        s.createIndex('due', 'due_date');
        s.createIndex('updated', 'updated_at');
      }
      if (!d.objectStoreNames.contains('queries')) {
        const s = d.createObjectStore('queries', { keyPath: 'uuid' });
        s.createIndex('word', 'word');
        s.createIndex('srv', 'srv_at');
      }
      if (!d.objectStoreNames.contains('meta')) {
        d.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => { idb = req.result; resolve(req.result); };
    req.onerror = () => reject(req.error);
  });
}

/** promisify 单个 request */
function r(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** 在一个事务里跑 fn(store...)，返回 fn 的 Promise 结果 */
function tx(stores, mode, fn) {
  const t = idb.transaction(stores, mode);
  const done = fn(t);
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve(done && done.res);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

// ---------- meta ----------

async function getMeta(key, fallback) {
  const row = await r(idb.transaction('meta').objectStore('meta').get(key));
  return row ? row.value : fallback;
}
function setMeta(key, value) {
  return tx(['meta'], 'readwrite', (t) => { t.objectStore('meta').put({ key, value }); });
}

// ---------- words / queries ----------

function getWord(word) {
  return r(idb.transaction('words').objectStore('words').get(word));
}

async function putWord(w) {
  await tx(['words'], 'readwrite', (t) => { t.objectStore('words').put(w); });
  await addDirtyWord(w.word);
}

/** 本地修改过的词（push 后清空）。存 meta.dirtyWords 数组（词表量级小，数组够用） */
async function addDirtyWord(word) {
  const cur = await getMeta('dirtyWords', []);
  if (!cur.includes(word)) {
    cur.push(word);
    await setMeta('dirtyWords', cur);
  }
}

function getHistory(word, limit = 10) {
  return new Promise((resolve, reject) => {
    const idx = idb.transaction('queries').objectStore('queries').index('word');
    const out = [];
    const req = idx.openCursor(IDBKeyRange.only(word));
    req.onsuccess = () => {
      const c = req.result;
      if (!c) {
        out.sort((a, b) => b.created_at - a.created_at); // 游标序≠时间序，排序后截断
        return resolve(out.slice(0, limit));
      }
      const q = c.value;
      if (q.context || q.word_in_sentence || q.simple_def) out.push(q); // 裸事件行不进历史
      c.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * 记录一次查询（手机端手动添加生词用）：与 PC recordLookup 同语义。
 * @returns {{queryCount: number, firstSeen: number}}
 */
async function recordLookup({ word, phonetic = '', definition = '', context = null, contextCloze = null, sentenceTranslation = null, wordInSentence = null, simpleDef = null, source = 'mobile' }) {
  const now = Date.now();
  const existing = await getWord(word);
  let queryCount;
  let firstSeen;
  if (existing && !existing.deleted) {
    queryCount = existing.query_count + 1;
    firstSeen = existing.first_seen;
    await putWord({ ...existing, query_count: queryCount, last_seen: now, phonetic: phonetic || existing.phonetic, definition: definition || existing.definition, updated_at: now });
  } else if (existing && existing.deleted) {
    queryCount = 1; firstSeen = now; // 墓碑复活：重新拾取，进度重置
    await putWord({ ...existing, query_count: 1, first_seen: now, last_seen: now, phonetic, definition, efactor: 2.5, interval: 0, repetitions: 0, due_date: 0, deleted: 0, updated_at: now });
  } else {
    queryCount = 1; firstSeen = now;
    await putWord({ word, phonetic, definition, note: '', query_count: 1, first_seen: now, last_seen: now, efactor: 2.5, interval: 0, repetitions: 0, due_date: 0, updated_at: now, deleted: 0 });
  }
  await addEvent({ word, context, context_cloze: contextCloze, sentence_translation: sentenceTranslation, word_in_sentence: wordInSentence, simple_def: simpleDef, source, created_at: now });
  return { queryCount, firstSeen };
}

/** 落一条事件行（uuid 唯一；uuid→seq 映射供增量 push，避免 queries 表混入本地字段） */
async function addEvent(q) {
  const seq = (await getMeta('localSeq', 0)) + 1;
  await setMeta('localSeq', seq);
  const uuid = window.rpuuid(); // boot.js 提供（randomUUID 回退）
  await tx(['queries'], 'readwrite', (t) => {
    t.objectStore('queries').put({ uuid, srv_at: 0, ...q });
  });
  const seqs = await getMeta('eventSeqs', {});
  seqs[uuid] = seq;
  await setMeta('eventSeqs', seqs);
}

/** 全部事件行（同步 push / 调试用） */
function allQueries() {
  return new Promise((resolve, reject) => {
    const out = [];
    const req = idb.transaction('queries').objectStore('queries').openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve(out);
      out.push(c.value);
      c.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

/** SM-2 复习 */
async function reviewWord(word, grade) {
  const row = await getWord(word);
  if (!row || row.deleted) return null;
  const next = window.supermemo({ interval: row.interval, repetition: row.repetitions, efactor: row.efactor }, grade);
  const due = Date.now() + next.interval * DAY;
  await putWord({ ...row, interval: next.interval, repetitions: next.repetition, efactor: next.efactor, due_date: due, updated_at: Date.now() });
  return { ...row, ...next, due };
}

async function dueWords(limit = 50) {
  const all = [];
  await new Promise((resolve, reject) => {
    const req = idb.transaction('words').objectStore('words').openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve();
      const w = c.value;
      const due = !w.deleted && w.due_date <= Date.now() && (w.due_date !== 0 || w.first_seen < Date.now() - DAY);
      if (due) all.push(w);
      c.continue();
    };
    req.onerror = () => reject(req.error);
  });
  all.sort((a, b) => a.due_date - b.due_date || a.first_seen - b.first_seen);
  return all.slice(0, limit);
}

async function dueCount() {
  const ws = await dueWords(Infinity);
  return ws.length;
}

async function allWords() {
  const out = [];
  await new Promise((resolve, reject) => {
    const req = idb.transaction('words').objectStore('words').openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve();
      if (!c.value.deleted) out.push(c.value);
      c.continue();
    };
    req.onerror = () => reject(req.error);
  });
  out.sort((a, b) => b.last_seen - a.last_seen);
  return out;
}

async function recentWords(limit = 12) {
  const ws = await allWords();
  return ws.slice(0, limit).map((w) => ({ word: w.word, query_count: w.query_count, last_seen: w.last_seen }));
}

function setNote(word, note) {
  return getWord(word).then((w) => w && putWord({ ...w, note, updated_at: Date.now() }));
}

function removeWord(word) {
  return getWord(word).then((w) => w && putWord({ ...w, deleted: 1, updated_at: Date.now() }));
}

async function stats() {
  const ws = await allWords();
  return { total: ws.length, due: await dueCount() };
}

/** 复习卡语境回捞：每个词优先带挖空的最近事件，否则最近一条（与 PC getRecentContexts 同语义） */
async function getRecentContexts(words) {
  const map = new Map();
  for (const word of words) {
    const hist = await getHistory(word, 30);
    if (!hist.length) continue;
    map.set(word, hist.find((h) => h.context_cloze) || hist[0]);
  }
  return map;
}

// ---------- 同步合并（与 PC 端 applySyncBatch 相同的规则，方向相反：接收服务端行） ----------

function applyWordFromSync(row, now) {
  if (!row || !row.word) return Promise.resolve(false);
  let ua = Number(row.updated_at) || 0;
  if (ua > now + CLOCK_SKEW_MS) ua = now;
  return getWord(row.word).then((existing) => {
    if (existing && existing.updated_at >= ua) return false;
    const w = {
      word: row.word,
      phonetic: row.phonetic || '',
      definition: row.definition || '',
      note: row.note || '',
      query_count: Number(row.query_count) || 1,
      first_seen: Number(row.first_seen) || ua,
      last_seen: Number(row.last_seen) || ua,
      efactor: Number(row.efactor) || 2.5,
      interval: Number(row.interval) || 0,
      repetitions: Number(row.repetitions) || 0,
      due_date: Number(row.due_date) || 0,
      updated_at: ua,
      deleted: row.deleted ? 1 : 0,
    };
    return tx(['words'], 'readwrite', (t) => { t.objectStore('words').put(w); }).then(() => true);
  });
}

function applyQueryFromSync(row, now) {
  if (!row || !row.uuid || !row.word) return Promise.resolve(false);
  return r(idb.transaction('queries').objectStore('queries').get(row.uuid)).then((dup) => {
    if (dup) return false;
    return tx(['queries'], 'readwrite', (t) => {
      t.objectStore('queries').put({
        uuid: row.uuid,
        word: row.word,
        context: row.context ?? null,
        context_cloze: row.context_cloze ?? null,
        sentence_translation: row.sentence_translation ?? null,
        word_in_sentence: row.word_in_sentence ?? null,
        simple_def: row.simple_def ?? null,
        source: row.source || 'sync',
        created_at: Number(row.created_at) || now,
        srv_at: Number(row.srv_at) || now,
      });
    }).then(() => true);
  });
}

// ---------- 全局暴露（无构建系统） ----------
window.rpdb = {
  open: openDb, getMeta, setMeta,
  getWord, recordLookup, getHistory, getRecentContexts,
  reviewWord, dueWords, dueCount, allWords, recentWords,
  setNote, removeWord, stats,
  applyWordFromSync, applyQueryFromSync,
  addEvent, allQueries,
};