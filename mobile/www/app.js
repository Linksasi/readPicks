// mobile/www/app.js — 拾词手机版：配对 / 复习（理念化渲染移植自 PC review.js）/ 词表 / 设置
'use strict';

let queue = [];
let idx = 0;
let flipped = false;
let doneWords = new Set();
let againCount = 0;
let requeued = new Map();
const MAX_REQUEUE = 2;

const $ = (id) => document.getElementById(id);

// ---------- 页面路由 ----------

function showPair() {
  $('page-pair').classList.remove('hidden');
  $('page-main').classList.add('hidden');
}

function showMain() {
  $('page-pair').classList.add('hidden');
  $('page-main').classList.remove('hidden');
  switchTab('review');
  refreshSyncLine(true);
}

function switchTab(name) {
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  for (const t of ['review', 'words', 'settings']) {
    $('tab-' + t).classList.toggle('hidden', t !== name);
  }
  $('tab-title').textContent = { review: '今日复习', words: '生词本', settings: '设置' }[name];
  if (name === 'review') loadReview();
  if (name === 'words') refreshWords();
  if (name === 'settings') refreshSettings();
}

// ---------- 配对 ----------

$('pair-btn').onclick = async () => {
  const msg = $('pair-msg');
  const parsed = rpsync.parsePairUrl($('pair-input').value);
  if (!parsed) {
    msg.textContent = '链接格式不对：应为 http://IP:端口/app/?t=…（PC 设置 → 同步 → 显示配对二维码）';
    return;
  }
  rpsync.saveSyncConfig(parsed);
  msg.textContent = '';
  $('pair-btn').disabled = true;
  $('pair-btn').textContent = '同步中…';
  try {
    await rpsync.doSync();
    showMain();
  } catch (e) {
    msg.textContent = '❌ ' + e.message;
  } finally {
    $('pair-btn').disabled = false;
    $('pair-btn').textContent = '配对并同步';
  }
};

// ---------- 同步 ----------

let syncing = false;
async function runSync(explicit) {
  if (syncing) return;
  syncing = true;
  const btn = $('sync-now');
  btn.disabled = true;
  btn.textContent = '⟳ 同步中…';
  try {
    const r = await rpsync.doSync();
    const t = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    $('sync-line').className = 'sync-line';
    $('sync-line').textContent = `✓ ${t} 已同步 · 收到 ${r.pulledWords + r.pulledQueries} 条变更`;
    // 同步落地后当前页数字/队列可能变化（首次同步尤其明显）
    const active = document.querySelector('.tabbar button.active');
    if (active) switchTab(active.dataset.tab);
  } catch (e) {
    $('sync-line').className = 'sync-line err';
    $('sync-line').textContent = '同步失败：' + e.message;
    if (explicit) alert('同步失败：' + e.message);
  } finally {
    syncing = false;
    btn.disabled = false;
    btn.textContent = '⟳ 同步';
  }
}

async function refreshSyncLine(auto) {
  if (!rpsync.isPaired()) { showPair(); return; }
  const last = await rpdb.getMeta('lastSyncAt', 0);
  if (last) {
    $('sync-line').className = 'sync-line';
    $('sync-line').textContent = '上次同步 ' + new Date(last).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  runSync(false); // 打开页面即静默同步一次（失败不打扰：行内提示）
}

$('sync-now').onclick = async () => {
  await runSync(true);
  // 同步后各页数字可能变化：当前页刷新
  const active = document.querySelector('.tabbar button.active');
  if (active) switchTab(active.dataset.tab);
};

// ---------- 复习（移植 PC review.js：语境挖空正面 / 英英释义在上中文兜底 / 忘记会话内重现） ----------

async function loadReview() {
  queue = await rpdb.dueWords(50);
  idx = 0;
  if (!queue.length) {
    showDone('✅ 没有到期的单词', '去阅读中积累生词吧');
    return;
  }
  render();
}

async function render() {
  flipped = false;
  closeWordTip();
  const w = queue[idx];
  const ctxMap = await rpdb.getRecentContexts([w.word]);
  const ctx = ctxMap.get(w.word);

  const front = $('front');
  front.innerHTML = '';
  if (ctx && ctx.context_cloze) {
    front.appendChild(el('div', 'hint', '根据语境回忆单词：'));
    front.appendChild(elHtml('div', 'cloze', clozeHtml(ctx.context_cloze)));
  } else {
    front.appendChild(elHtml('div', 'cloze', '<span class="blank">？</span>'));
    front.appendChild(el('div', 'hint', '这个单词还记得吗？点击显示答案'));
  }

  const back = $('back');
  back.innerHTML = '';
  back.appendChild(el('div', 'word', w.word));
  if (w.phonetic) back.appendChild(el('div', 'phon', w.phonetic));
  let hasEn = false;
  if (ctx && ctx.simple_def) {
    back.appendChild(el('div', 'simple-def', ctx.simple_def));
    hasEn = true;
  }
  const def = el('div', 'back-def', w.definition || '（无释义记录）');
  if (hasEn) def.classList.add('muted');
  back.appendChild(def);
  if (ctx && ctx.sentence_translation) back.appendChild(el('div', 'back-ctx', '📖 ' + ctx.sentence_translation));
  if (w.note) back.appendChild(el('div', 'back-ctx', '📝 ' + w.note));

  $('card').classList.remove('hidden');
  $('actions').classList.remove('hidden');
  $('done').classList.add('hidden');
  showFront();
}

function updateProgress() {
  $('tab-title').textContent = `今日复习 · 还剩 ${queue.length - idx} 个`;
}

function flip() {
  if (flipped) return;
  flipped = true;
  updateProgress();
  showBack();
}
function showFront() {
  $('front').classList.remove('hidden');
  $('back').classList.add('hidden');
}
function showBack() {
  $('front').classList.add('hidden');
  $('back').classList.remove('hidden');
}

function clozeHtml(cloze) {
  return escapeHtml(cloze).replace(/\{\{c1::(.*?)\}\}/g, '<span class="blank">________</span>');
}

const GRADES = { again: 0, hard: 3, good: 5 };

async function answer(id) {
  const w = queue[idx];
  if (!w) return;
  await rpdb.reviewWord(w.word, GRADES[id]);
  doneWords.add(w.word);
  if (id === 'again') againCount++;
  if (id === 'again' && (requeued.get(w.word) || 0) < MAX_REQUEUE) {
    requeued.set(w.word, (requeued.get(w.word) || 0) + 1);
    queue.push(w);
  }
  idx++;
  if (idx >= queue.length) finish();
  else render();
}

function finish() {
  $('card').classList.add('hidden');
  $('actions').classList.add('hidden');
  const tail = againCount ? ' · 忘掉的词已在队列中重现巩固' : '';
  showDone('🎉 今日复习完成', `本次复习 ${doneWords.size} 个词 · 忘记 ${againCount} 次${tail}`);
}

function showDone(title, sub) {
  $('done-title').textContent = title;
  $('done-sub').textContent = sub;
  $('done').classList.remove('hidden');
  $('tab-title').textContent = '今日复习';
}

// ---------- 难词浮层（手机端简化：底部浮出，仅展示已有提示） ----------

let tipEl = null;
function showWordTip(word, hint) {
  closeWordTip();
  const tip = el('div', 'word-tip');
  tip.appendChild(el('div', 'word-tip-head', word));
  if (hint && hint.zh) tip.appendChild(el('div', 'word-tip-zh', hint.zh));
  if (hint && hint.en) tip.appendChild(el('div', 'word-tip-en', hint.en));
  if (!hint || (!hint.zh && !hint.en)) tip.appendChild(el('div', 'word-tip-en', '（无简释记录）'));
  document.body.appendChild(tip);
  tipEl = tip;
}
function closeWordTip() {
  if (tipEl) { tipEl.remove(); tipEl = null; }
}

// ---------- DOM 工具 ----------

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.textContent = text ?? '';
  return e;
}
function elHtml(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.innerHTML = html;
  return e;
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- 词表 ----------

async function refreshWords() {
  const st = await rpdb.stats();
  $('words-stats').innerHTML = '';
  $('words-stats').appendChild(el('span', 'stat-chip', `共 ${st.total} 个生词`));
  $('words-stats').appendChild(el('span', 'stat-chip', `${st.due} 个待复习`));
  const list = $('words-list');
  list.innerHTML = '';
  const words = await rpdb.allWords();
  if (!words.length) {
    list.appendChild(el('div', 'empty', '📭 生词本还是空的 —— 在电脑端划词积累后，点右上角「同步」拉过来'));
    return;
  }
  for (const w of words) {
    const row = el('div', 'word-row');
    const left = el('div', 'left');
    left.appendChild(el('span', 'w', w.word));
    left.appendChild(el('span', 'count', `${w.query_count} 次`));
    left.appendChild(el('span', 'info', new Date(w.last_seen).toLocaleDateString('zh-CN')));
    const del = el('button', 'del', '删除');
    del.onclick = async () => { await rpdb.removeWord(w.word); refreshWords(); };
    row.appendChild(left); row.appendChild(del);
    list.appendChild(row);
  }
}

// ---------- 设置 ----------

async function refreshSettings() {
  const cfg = rpsync.syncConfig();
  $('set-device').textContent = localStorage.getItem('rp-device-name') || deviceName();
  $('set-server').textContent = cfg.serverUrl || rpsync.apiBase();
  const last = await rpdb.getMeta('lastSyncAt', 0);
  $('set-lastsync').textContent = last ? new Date(last).toLocaleString('zh-CN') : '从未';
}

function deviceName() {
  const ua = navigator.userAgent;
  const m = ua.match(/Android[^;)]*/i);
  const name = m ? m[0].slice(0, 20) : /iPhone|iPad/i.test(ua) ? 'iOS 设备' : '移动浏览器';
  localStorage.setItem('rp-device-name', name);
  return name;
}

$('unbind').onclick = () => {
  if (!confirm('解除配对？本机生词数据保留，仅清除连接信息。')) return;
  localStorage.removeItem('rp-sync');
  showPair();
};

// ---------- 事件绑定 ----------

document.querySelectorAll('.tabbar button').forEach((btn) => {
  btn.onclick = () => switchTab(btn.dataset.tab);
});
$('card').onclick = flip;
document.querySelectorAll('#actions button').forEach((btn) => {
  btn.addEventListener('click', () => answer(btn.id));
});
// 难词/浮层：点击空白处关闭
document.addEventListener('click', (e) => {
  if (tipEl && !tipEl.contains(e.target)) closeWordTip();
});

// ---------- 启动 ----------

(async () => {
  await rpdb.open();
  deviceName();
  if (rpsync.isPaired()) showMain();
  else showPair();
})();
