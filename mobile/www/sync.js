// mobile/www/sync.js — 同步客户端：push 本地脏数据 + pull 服务端增量，一次往返
// 服务端地址/token：PWA 场景同源直接用；APK 场景配对时写入 localStorage
'use strict';

const SYNC_META = { cursorsW: 'cursorWords', cursorsQ: 'cursorQueries', pushedSeq: 'pushedSeq' };

function syncConfig() {
  const raw = localStorage.getItem('rp-sync') || '{}';
  return JSON.parse(raw);
}
function saveSyncConfig(patch) {
  localStorage.setItem('rp-sync', JSON.stringify({ ...syncConfig(), ...patch }));
}

/** 是否已配对（有 token 即视为已配对） */
function isPaired() {
  return !!syncConfig().token;
}

/** 从配对链接（http://ip:port/app/?t=xxx）提取服务端地址 + token */
function parsePairUrl(text) {
  const m = String(text || '').trim().match(/^(https?:\/\/[^/?#]+)\/app\/?\?(?:[^#]*&)?t=([0-9a-f]+)/i);
  if (!m) return null;
  return { serverUrl: m[1], token: m[2] };
}

/** 服务端 API 根：PWA（页面由 PC 托管）取同源；APK 取配对保存的地址 */
function apiBase() {
  const cfg = syncConfig();
  if (cfg.serverUrl) return cfg.serverUrl;
  return location.origin;
}

/**
 * 执行一次双向同步。
 * @returns {{applied:number, pulledWords:number, pulledQueries:number, serverTime:number}}
 */
async function doSync() {
  const cfg = syncConfig();
  const token = cfg.token;
  if (!token) throw new Error('尚未配对：请先粘贴配对链接或扫码');

  // push 载荷：本地新事件（seq > pushedSeq）+ 本地脏词
  const localSeq = await rpdb.getMeta('localSeq', 0);
  const pushedSeq = await rpdb.getMeta(SYNC_META.pushedSeq, 0);
  const events = localSeq > pushedSeq ? await eventsSince(pushedSeq) : [];
  const dirtyWords = await rpdb.getMeta('dirtyWords', []);
  const words = [];
  for (const w of dirtyWords) {
    const row = await rpdb.getWord(w);
    if (row) words.push(row);
  }

  const res = await fetch(apiBase() + '/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-sync-token': token },
    body: JSON.stringify({
      device: { id: deviceId(), name: deviceName() },
      cursors: { words: await rpdb.getMeta(SYNC_META.cursorsW, 0), queries: await rpdb.getMeta(SYNC_META.cursorsQ, 0) },
      words,
      queries: events,
    }),
  });
  if (res.status === 401) throw new Error('配对已失效：token 不正确，请重新扫码配对');
  if (!res.ok) throw new Error('同步失败：HTTP ' + res.status);
  const data = await res.json();

  // pull 合并（与服务端同规则：LWW + uuid 并集，幂等可重复）
  const now = Date.now();
  let pulled = 0;
  for (const w of data.words || []) if (await rpdb.applyWordFromSync(w, now)) pulled++;
  for (const q of data.queries || []) if (await rpdb.applyQueryFromSync(q, now)) pulled++;

  await rpdb.setMeta(SYNC_META.cursorsW, data.serverTime);
  await rpdb.setMeta(SYNC_META.cursorsQ, data.serverTime);
  if (events.length) await rpdb.setMeta(SYNC_META.pushedSeq, localSeq);
  await rpdb.setMeta('dirtyWords', []); // 服务端已收下本批脏词
  await rpdb.setMeta('lastSyncAt', Date.now());

  return { applied: data.applied ? data.applied.appliedWords + data.applied.appliedQueries : 0, pulledWords: (data.words || []).length, pulledQueries: (data.queries || []).length, serverTime: data.serverTime };
}

/** seq 大于 sinceSeq 的本地事件行（uuid→seq 映射在落库时记入 meta.eventSeqs） */
async function eventsSince(sinceSeq) {
  const seqMap = await rpdb.getMeta('eventSeqs', {});
  const rows = await rpdb.allQueries();
  return rows.filter((r) => seqMap[r.uuid] && seqMap[r.uuid] > sinceSeq);
}

// ---------- 设备身份 ----------

function deviceId() {
  let id = localStorage.getItem('rp-device-id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('rp-device-id', id);
  }
  return id;
}

function deviceName() {
  const ua = navigator.userAgent;
  const m = ua.match(/Android[^;)]*/i);
  return m ? m[0].slice(0, 20) : /iPhone|iPad/i.test(ua) ? 'iOS 设备' : '移动浏览器';
}

window.rpsync = { doSync, isPaired, parsePairUrl, saveSyncConfig, syncConfig, apiBase, deviceId };
