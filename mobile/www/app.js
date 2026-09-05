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

function showMain() {
  $('page-main').classList.remove('hidden');
  switchTab('review');
  refreshSyncLine();
}

function switchTab(name) {
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  for (const t of ['review', 'query', 'words', 'settings']) {
    $('tab-' + t).classList.toggle('hidden', t !== name);
  }
  $('tab-title').textContent = { review: '今日复习', query: '查词', words: '生词本', settings: '设置' }[name];
  if (name === 'review') loadReview();
  if (name === 'query') { loadMiniDict(); checkClipboard(); } // 进查询页：预载离线词典 + 剪贴板接力
  if (name === 'words') refreshWords();
  if (name === 'settings') refreshSettings();
}

// ---------- 配对（设置页卡片） ----------

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
    refreshSettings();
    runSync(false);
    switchTab('review');
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
  if (!rpsync.isPaired()) {
    $('sync-line').className = 'sync-line';
    $('sync-line').textContent = '未连接电脑：查词/复习离线可用，配对后自动同步（设置页）';
    return;
  }
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

async function refreshSyncLine() {
  if (!rpsync.isPaired()) {
    $('sync-line').className = 'sync-line';
    $('sync-line').textContent = '未连接电脑：查词/复习离线可用，配对后自动同步（设置页）';
    return;
  }
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
  const wordRow = el('div', 'q-title-row');
  wordRow.appendChild(el('div', 'word', w.word));
  wordRow.appendChild(speakBtn(w.word));
  back.appendChild(wordRow);
  if (w.phonetic) back.appendChild(el('div', 'phon', w.phonetic));
  let hasEn = false;
  if (ctx && ctx.simple_def) {
    back.appendChild(el('div', 'simple-def', ctx.simple_def));
    hasEn = true;
  } else {
    // 离线英英释义兜底：mini 词典的 WordNet 义项 + 按词汇水平标注难词
    const mini = await loadMiniDict();
    const entry = mini && (mini.words[w.word] || (mini.lemma[w.word] && mini.words[mini.lemma[w.word]]));
    const en = entry && rpend.buildEnDefinition(entry, await rpdb.getMeta('vocabLevel', null), mini);
    if (en && en.senses && en.senses.length) {
      back.appendChild(renderSenses(en));
      hasEn = true;
    }
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

// ---------- 查询（理念：离线秒查优先；英英释义在上中文兜底；查词是积累的起点） ----------

let miniDict = null; // {words, lemma} | false（加载失败标记）
async function loadMiniDict() {
  if (miniDict !== null) return miniDict;
  try {
    const r = await fetch('dict/mini.json');
    if (r.ok) miniDict = await r.json();
  } catch { /* 忽略 */ }
  if (!miniDict) miniDict = false;
  return miniDict;
}

const TAG_LABEL = { zk: '中考', gk: '高考', cet4: '四级', cet6: '六级', kaoyan: '考研', toefl: '托福', ielts: '雅思', gre: 'GRE' };

/** ECDICT 行式释义（"n. 苹果\nv. …"）→ [{pos, def}] */
function parseRows(t) {
  return String(t || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^([a-z]+)\.\s*(.*)$/i);
    return m ? { pos: m[1].toLowerCase(), def: m[2] } : { pos: '', def: l };
  });
}

async function runQuery(raw) {
  const word = String(raw || '').trim().toLowerCase();
  if (!word) return;
  $('q-input').value = word;
  const card = $('q-card');
  card.classList.remove('hidden');
  card.innerHTML = '';
  card.appendChild(el('div', 'q-loading', '查询中…'));
  $('q-src').textContent = '';

  const lvl = await rpdb.getMeta('vocabLevel', null);
  const mini = await loadMiniDict();

  // 1) 本地瘦身词典：离线秒查（lemma 还原词干；带英文释义 → 难词标注，理念英文在上）
  let payload = null;
  let srcLabel = '';
  if (mini) {
    const direct = mini.words[word];
    const base = direct ? null : (mini.lemma[word] || null);
    const hit = direct || (base ? mini.words[base] : null);
    if (hit) {
      payload = {
        word: base || word, phonetic: hit.p, defs: parseRows(hit.t),
        tags: [], enDefinition: rpend.buildEnDefinition(hit, lvl, mini) || null,
        simpleDef: null, translated: null, found: true,
      };
      srcLabel = direct ? '离线词典' : `离线词典（${word} → ${base}）`;
    }
  }
  // 2) PC 端完整词典（局域网；含按词汇水平的英英释义 + LLM 简单释义）
  if (!payload && rpsync.isPaired()) {
    try {
      const r = await fetch(rpsync.apiBase() + '/api/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-sync-token': rpsync.syncConfig().token },
        body: JSON.stringify({ word }),
      });
      if (r.ok) {
        payload = await r.json();
        srcLabel = payload.found ? 'PC 词典' : 'PC 词典（未收录，在线兜底）';
      }
    } catch { /* 不在局域网：降级 */ }
  }
  // 3) LLM 直连（自己配的 OpenAI 兼容接口，外出可用）：整体兜底 + 补简单释义
  if (rpllm.isConfigured()) {
    try {
      const sd = await rpllm.simpleDefinition(word, lvl);
      if (sd) {
        if (payload) {
          payload.simpleDef = sd.simpleDef;
          srcLabel += ' · AI 释义';
        } else {
          payload = { word, found: true, phonetic: '', defs: [], tags: [], enDefinition: null, simpleDef: sd.simpleDef, translated: null };
          srcLabel = 'AI 释义';
        }
      }
    } catch { /* LLM 失败继续走 MyMemory */ }
  }
  // 4) 直连在线翻译（免费 MyMemory，无需任何配置）
  if (!payload) {
    const t = await mymemoryTranslate(word);
    if (t) {
      payload = { word, found: true, phonetic: '', defs: [{ pos: '', def: t }], tags: [], enDefinition: null, simpleDef: null, translated: t };
      srcLabel = '在线翻译（仅供参考）';
    }
  }

  card.innerHTML = '';
  if (!payload || (!payload.found && !payload.translated)) {
    card.appendChild(el('div', 'q-empty', '没查到这个词：离线词典未收录、在线翻译与 AI 释义也无返回'));
    return;
  }

  // 划词语境（无障碍句）：LLM 出句译 + 词中译法，MyMemory 兜底句译——语境永远在场
  let selCtx = await captureSelectionContext(word);
  // 剪贴板整句兜底：输入的词是刚复制句子的一部分 → 整句作语境（挖空该词）
  if (!selCtx && clipSentence) {
    const sentence = clipSentence.trim().replace(/\s+/g, ' ');
    const cloze = clozeSentence(sentence, word);
    if (cloze) selCtx = { context: sentence, cloze };
  }
  if (selCtx) {
    payload.context = selCtx.context;
    payload.cloze = selCtx.cloze;
    let trans = null;
    let wis = null;
    if (rpllm.isConfigured()) {
      try {
        const r = await rpllm.lookupInContext(word, selCtx.context, lvl);
        if (r) { trans = r.sentenceTranslation; wis = r.wordInSentence; payload.explain = r.explain || null; payload.usage = r.usage || null; }
      } catch { /* 降级 MM */ }
    }
    if (!trans) trans = await mymemoryTranslate(selCtx.context);
    payload.sentenceTranslation = trans || null;
    payload.wordInSentence = wis || null;
    srcLabel += ' · 含语境' + (payload.sentenceTranslation ? '' : '（句译不可用）');
  }

  renderQueryCard(payload, srcLabel);
  applyCardSize();
}

/** MyMemory 直连（与 PC translate.js 同款接口）；8 秒超时，失败返回 null */
async function mymemoryTranslate(text) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch('https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) + '&langpair=en|zh-CN', { signal: ctrl.signal });
    if (!r.ok) return null;
    const data = await r.json();
    const t = data && data.responseData && data.responseData.translatedText;
    return t ? String(t) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function renderQueryCard(p, srcLabel) {
  const card = $('q-card');
  const titleRow = el('div', 'q-title-row');
  titleRow.appendChild(el('div', 'word', p.word));
  titleRow.appendChild(speakBtn(p.word));
  card.appendChild(titleRow);
  if (p.phonetic) card.appendChild(el('div', 'phon', p.phonetic));
  if (p.tags && p.tags.length) {
    const tl = el('div', 'tag-line');
    for (const t of p.tags.slice(0, 6)) tl.appendChild(el('span', 'tag-chip', TAG_LABEL[t] || t));
    card.appendChild(tl);
  }
  // 理念：英文释义在上（AI 简单释义 / WordNet 义项），中文弱化兜底——默认收起，点击展开
  let hasEn = false;
  if (p.simpleDef) { card.appendChild(el('div', 'simple-def', p.simpleDef)); hasEn = true; }
  else if (p.enDefinition && p.enDefinition.senses && p.enDefinition.senses.length) {
    card.appendChild(renderSenses(p.enDefinition));
    hasEn = true;
  }
  const defs = p.defs && p.defs.length ? p.defs : (p.translated ? [{ pos: '', def: p.translated }] : []);
  if (defs.length) {
    const zhText = defs.map((x) => (x.pos ? x.pos + '. ' : '') + x.def).join('；');
    if (hasEn) {
      // 有英文区 → 中文默认收起（理念：中文是兜底，不是主释义）
      const zh = el('div', 'zh-block');
      const head = el('div', 'zh-head', '中文释义 ▾');
      const body = el('div', 'zh-body hidden', zhText);
      head.onclick = () => {
        const collapsed = body.classList.toggle('hidden');
        head.textContent = '中文释义 ' + (collapsed ? '▾' : '▴');
      };
      zh.appendChild(head); zh.appendChild(body);
      card.appendChild(zh);
    } else {
      card.appendChild(el('div', 'back-def', zhText)); // 无英文释义：中文即主释义，直接展示
    }
  }
  // 语境在场：原句 + 句译 + 词中译法 + 用法（LLM 时）；无语境时提示整句玩法
  if (p.context) {
    card.appendChild(el('div', 'back-ctx', '📖 ' + p.context));
    if (p.sentenceTranslation) card.appendChild(el('div', 'back-ctx', '↳ ' + p.sentenceTranslation));
    if (p.wordInSentence) card.appendChild(el('div', 'back-ctx', '· 本句中：' + p.wordInSentence));
    if (p.usage) card.appendChild(el('div', 'back-ctx', '· 用法：' + p.usage));
    else if (p.explain) card.appendChild(el('div', 'back-ctx', '· ' + p.explain));
  } else {
    card.appendChild(el('div', 'back-ctx', '💡 复制整句再触发拾词，可自动带出语境'));
  }
  const addBtn = el('button', 'btn primary q-add', '＋ 加入生词本');
  addBtn.onclick = async () => {
    addBtn.disabled = true;
    const ok = await addToWordbook(p);
    addBtn.textContent = ok ? '✓ 已加入（同步中）' : '加入失败，请重试';
    if (!ok) addBtn.disabled = false;
  };
  card.appendChild(addBtn);
  $('q-src').textContent = srcLabel + (p.simpleDef ? ' · 简单释义' : '');
}

/** 英文义项渲染：难词虚线下划线，点按就地浮层化解 */
function renderSenses(en) {
  const hardSet = new Set((en.hard || []).map((x) => String(x).toLowerCase()));
  const hintMap = new Map((en.hints || []).map((h) => [String(h.word).toLowerCase(), h]));
  const wrap = el('div', 'en-def-block');
  for (const s of en.senses) {
    const row = el('div', 'en-sense');
    if (s.pos) row.appendChild(el('span', 'pos', rpend.POS_LABEL[s.pos] || s.pos + '.'));
    for (const part of String(s.text || '').split(/([A-Za-z][A-Za-z'-]*)/g)) {
      if (/^[A-Za-z]/.test(part) && hardSet.has(part.toLowerCase())) {
        const b = el('button', 'hard-word', part);
        b.onclick = (ev) => { ev.stopPropagation(); showWordTip(part, hintMap.get(part.toLowerCase())); };
        row.appendChild(b);
      } else {
        row.appendChild(document.createTextNode(part));
      }
    }
    wrap.appendChild(row);
  }
  return wrap;
}

/** 入库（手机本地）→ 触发同步回流 PC。语境/句译/简单释义已在 runQuery 里算好，随词落库 */
async function addToWordbook(p) {
  try {
    await rpdb.recordLookup({
      word: p.word,
      phonetic: p.phonetic || '',
      definition: (p.defs || []).map((x) => (x.pos ? x.pos + '. ' : '') + x.def).join('\n') || p.translated || '',
      context: p.context || null,
      contextCloze: p.cloze || null,
      sentenceTranslation: p.sentenceTranslation || null,
      wordInSentence: p.wordInSentence || null,
      simpleDef: p.simpleDef || null,
      source: 'mobile',
    });
  } catch (e) {
    console.error('入库失败', e);
    return false;
  }
  $('q-src').textContent = '✓ 已加入生词本' + (p.context ? ' · 带语境句' : '');
  runSync(false);
  if (cardMode) setTimeout(closeCard, 1400); // 悬浮卡：入库后稍候自动关闭回阅读处
  return true;
}

// ---------- 划词语境（无障碍服务缓存 → 句子提取 + 挖空） ----------

async function captureSelectionContext(word) {
  const P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Selection;
  if (!P) return null; // 浏览器/PWA 无原生层
  try {
    const r = await P.getRecent({ word });
    if (!r || !r.text) return null;
    if (Date.now() - Number(r.at) > 120000) return null; // 2 分钟内的选中才算语境
    const m = findWordInText(r.text, word, Number(r.start) || 0);
    if (!m) return null;
    const sentence = extractSentence(r.text, m.index, m.length);
    if (!sentence || sentence.length < word.length + 2) return null;
    // 在归一化后的句子上替换首个匹配（避免空白归一化导致的索引偏移）
    const esc = r.text.slice(m.index, m.index + m.length).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const clozeRe = new RegExp('(^|[^A-Za-z])(' + esc + ')', 'i');
    if (!clozeRe.test(sentence)) return null;
    const cloze = sentence.replace(clozeRe, (all, pre, hit) => pre + '{{c1::' + hit + '}}');
    return { context: sentence, cloze };
  } catch { return null; }
}

function findWordInText(text, word, near) {
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('(^|[^A-Za-z])(' + esc + ')([^A-Za-z]|$)', 'gi');
  let first = null;
  let m;
  while ((m = re.exec(text))) {
    const idx = m.index + m[1].length;
    if (first === null) first = { index: idx, length: m[2].length };
    if (near >= idx && near <= idx + m[2].length) return { index: idx, length: m[2].length }; // 选中位置优先
  }
  return first;
}

function sentenceStart(text, idx) {
  let s = idx;
  while (s > 0 && !/[.!?;。！？；\n]/.test(text[s - 1])) s--;
  return s;
}

function extractSentence(text, idx, len) {
  const s = sentenceStart(text, idx);
  let e = idx + len;
  while (e < text.length && !/[.!?;。！？；\n]/.test(text[e])) e++;
  return text.slice(s, e).trim().replace(/\s+/g, ' ');
}

/** TTS 发音：优先原生系统 TTS（WebView 无 speechSynthesis），浏览器回退 Web Speech API */
function speak(text) {
  const P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.ProcessText;
  if (P && P.speak) { P.speak({ text }); return; }
  try {
    if (!window.speechSynthesis) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 0.9;
    speechSynthesis.speak(u);
  } catch { /* 无 TTS 引擎：忽略 */ }
}

// ---------- 划词悬浮卡模式（CardActivity 拉起：隐藏主导航，只渲染查词卡，关闭即回到源应用） ----------

let cardMode = false;
const CARD_SIZE_KEY = 'rp-card-size';

function cardSize() {
  const v = Number(localStorage.getItem(CARD_SIZE_KEY));
  return v >= 60 && v <= 100 ? v : 72;
}

/** 卡片宽度滑杆 + 内容高度 → 原生（顶部锚定 + 自适应高度，封顶 60% 屏高） */
function applyCardSize() {
  const P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.ProcessText;
  if (!P || !P.setCardSize) return;
  const maxH = Math.round((window.screen.height || 640) * 0.6);
  const h = Math.min(document.body.scrollHeight, maxH);
  P.setCardSize({ widthPct: cardSize(), contentHeight: h });
}

function enterCardMode() {
  if (cardMode) { applyCardSize(); return; }
  cardMode = true;
  document.body.classList.add('card-mode');
  document.documentElement.classList.add('card-mode');
  switchTab('query');
  applyCardSize();
  const close = el('button', 'card-close', '✕');
  close.onclick = () => closeCard();
  $('q-form').appendChild(close);
  // TTS 错误提示（国产 ROM 无 TTS 引擎/缺语言数据时）
  const P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.ProcessText;
  if (P && P.addListener) P.addListener('ttsError', (d) => {
    $('q-src').textContent = '⚠ ' + ((d && d.message) || '发音失败');
  });
  // 悬浮球进入 = 主动查词意图 → 聚焦输入框弹键盘
  setTimeout(() => { const i = $('q-input'); if (i && !i.value) i.focus(); }, 300);
}

function closeCard() {
  const P = window.Capacitor && window.Capacitor.Plugins;
  const PT = P && P.ProcessText;
  if (PT && PT.closeCard) PT.closeCard(); // 原生 finish CardActivity
  else if (P && P.App && P.App.exitApp) P.App.exitApp();
  else window.close(); // 浏览器兜底
}

// ---------- 划词入口（PROCESS_TEXT：系统选择菜单「拾词」→ 预填查询） ----------

function setupProcessText() {
  const P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.ProcessText;
  if (!P) return;
  const handle = (d) => {
    if (d && d.card) enterCardMode();
    if (d && d.text) prefillQuery(d.text);
  };
  if (P.getPending) P.getPending().then(handle).catch(() => {});
  if (P.addListener) P.addListener('processText', handle);
}

function prefillQuery(text) {
  switchTab('query');
  const t = (text || '').trim();
  // 长句（分享/划入）不自动当单词查：填入输入框 + 记为语境源，改到要查的词后查
  if (t.split(/\s+/).length >= 2 && t.length > 12) {
    clipSentence = t;
    $('q-input').value = t;
    $('q-input').focus();
    $('q-src').textContent = '已粘贴句子：删到要查的词后查（自动带整句语境）';
    return;
  }
  runQuery(t);
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

function speakBtn(word) {
  const b = el('button', 'speak-btn', '🔊');
  b.onclick = (ev) => { ev.stopPropagation(); speak(word); };
  return b;
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
  const q = ($('word-search').value || '').trim().toLowerCase();
  const st = await rpdb.stats();
  $('words-stats').innerHTML = '';
  $('words-stats').appendChild(el('span', 'stat-chip', `共 ${st.total} 个生词`));
  $('words-stats').appendChild(el('span', 'stat-chip', `${st.due} 个待复习`));
  const list = $('words-list');
  list.innerHTML = '';
  let words = await rpdb.allWords();
  if (q) words = words.filter((w) => w.word.includes(q));
  if (!words.length) {
    list.appendChild(el('div', 'empty', q ? '没有匹配的生词' : '📭 生词本还是空的 —— 在电脑端划词积累后，点右上角「同步」拉过来'));
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
  const paired = rpsync.isPaired();
  $('pair-card').classList.toggle('hidden', paired);
  $('set-device').textContent = localStorage.getItem('rp-device-name') || deviceName();
  $('set-server').textContent = paired ? (cfg.serverUrl || rpsync.apiBase()) : '未配对（离线模式）';
  refreshCardSize();
  refreshFontScale();
  refreshA11y();
  refreshBall();
  const last = await rpdb.getMeta('lastSyncAt', 0);
  $('set-lastsync').textContent = last ? new Date(last).toLocaleString('zh-CN') : '从未';
  const lvl = await rpdb.getMeta('vocabLevel', null);
  $('set-vocab').textContent = lvl && lvl.score ? `约 ${lvl.score} 词（CEFR ${lvl.cefr}）` : '未测（电脑端测过后自动同步）';
  const llm = rpllm.getConfig();
  $('llm-enabled').checked = !!llm.enabled;
  $('llm-baseUrl').value = llm.baseUrl || '';
  $('llm-apiKey').value = llm.apiKey || '';
  $('llm-model').value = llm.model || '';
}

$('llm-save').onclick = () => {
  const m = $('llm-msg');
  const enabled = $('llm-enabled').checked;
  const baseUrl = $('llm-baseUrl').value.trim();
  const apiKey = $('llm-apiKey').value.trim();
  if (enabled && (!baseUrl || !apiKey)) {
    m.textContent = '启用时 Base URL 与 API Key 必填';
    m.className = 'msg';
    return;
  }
  rpllm.saveConfig({ enabled, baseUrl, apiKey, model: $('llm-model').value.trim() });
  m.textContent = '✓ 已保存，外出查词直连生效';
  m.className = 'msg ok';
};

// ---------- 词汇量自测（与 PC 同算法，结果同步互通） ----------

let vocabSession = null; // { items, answers, idx }

async function vocabShowHome() {
  vocabSession = null;
  $('vocab-test').classList.add('hidden');
  $('vocab-home').classList.remove('hidden');
  const lvl = await rpdb.getMeta('vocabLevel', null);
  $('set-vocab').textContent = lvl && lvl.score ? `约 ${lvl.score} 词（CEFR ${lvl.cefr}）` : '未测';
  $('vocab-start').textContent = lvl && lvl.score ? '重新测试' : '📊 测词汇量';
}

$('vocab-start').onclick = async () => {
  const mini = await loadMiniDict();
  const s = rpvocab.start(mini);
  if (!s.ok) {
    $('set-vocab').textContent = s.error;
    return;
  }
  vocabSession = { items: s.items, answers: [], idx: 0 };
  $('vocab-home').classList.add('hidden');
  $('vocab-test').classList.remove('hidden');
  vocabShowWord();
};

function vocabShowWord() {
  const s = vocabSession;
  $('vocab-word').textContent = s.items[s.idx].word;
  $('vocab-progress').textContent = `第 ${s.idx + 1} / ${s.items.length} 题`;
  $('vocab-bar').style.width = ((s.idx / s.items.length) * 100).toFixed(1) + '%';
}

async function vocabAnswer(known) {
  const s = vocabSession;
  if (!s) return;
  s.answers[s.idx] = known;
  s.idx++;
  if (s.idx >= s.items.length) {
    const r = rpvocab.finish(s.items, s.answers);
    await rpdb.setMeta('vocabLevel', r);
    await vocabShowHome(); // 先让首页状态落地，再覆盖为本次结果（避免异步覆盖竞态）
    $('set-vocab').textContent = r.score > 0
      ? `✓ 约 ${r.score} 词（CEFR ${r.cefr}）` + (r.fakeKnown ? ` · 误认伪词 ${r.fakeKnown} 个` : '')
      : '✓ 测完了：这次全部未命中（词汇量记为 0，可重测）';
    runSync(false); // 推给电脑端，两端个性化一致
  } else {
    vocabShowWord();
  }
}
$('vocab-known').onclick = () => vocabAnswer(true);
$('vocab-unknown').onclick = () => vocabAnswer(false);

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
  refreshSettings();
  refreshSyncLine();
};

$('unbind').onclick = () => {
  if (!confirm('解除配对？本机生词数据保留，仅清除连接信息。')) return;
  localStorage.removeItem('rp-sync');
  refreshSettings();
  refreshSyncLine();
};

// ---------- 悬浮卡大小 + 划词语境引导 ----------

async function refreshA11y() {
  const P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Selection;
  if (!P || !P.isRunning) {
    $('a11y-status').textContent = '浏览器不可用（APK 内有效）';
    $('a11y-open').classList.add('hidden');
    return;
  }
  try {
    const r = await P.isRunning();
    $('a11y-status').textContent = r && r.running ? '✓ 已开启' : '未开启';
  } catch { $('a11y-status').textContent = '未知'; }
}

$('a11y-open').onclick = () => {
  const P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Selection;
  if (P && P.openAccessibilitySettings) P.openAccessibilitySettings();
};

function refreshCardSize() {
  const pct = cardSize();
  $('card-size').value = pct;
  $('card-size-val').textContent = pct + '%';
}

$('card-size').addEventListener('input', () => {
  localStorage.setItem(CARD_SIZE_KEY, $('card-size').value);
  $('card-size-val').textContent = $('card-size').value + '%';
  applyCardSize();
});

// ---------- 字号大小（Chromium zoom：所有 px 等比缩放，悬浮卡同步生效） ----------

const FONT_KEY = 'rp-font-scale';

function fontScale() {
  const v = Number(localStorage.getItem(FONT_KEY));
  return v >= 80 && v <= 140 ? v : 100;
}

function applyFontScale() {
  document.body.style.zoom = fontScale() / 100;
}

function refreshFontScale() {
  $('font-size').value = fontScale();
  $('font-size-val').textContent = fontScale() + '%';
}

$('font-size').addEventListener('input', () => {
  localStorage.setItem(FONT_KEY, $('font-size').value);
  $('font-size-val').textContent = $('font-size').value + '%';
  applyFontScale();
});

// ---------- 剪贴板接力（无法划词的界面：复制单词/整句 → 切到拾词 → 一键查词） ----------
// 单词模式：自动查词；语境由无障碍服务扫描后台源应用「包含该词的文本节点」带出
//（你刚复制这个词的地方就是它所在的句子）。整句模式：粘贴到输入框，改到要查的词后自动带整句语境。

let lastClip = '';
let clipSentence = null;

/** 在句子上为词做挖空（首个词边界命中） */
function clozeSentence(sentence, word) {
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('(^|[^A-Za-z])(' + esc + ')(?![A-Za-z])', 'i');
  if (!re.test(sentence)) return null;
  return sentence.replace(re, (all, pre, hit) => pre + '{{c1::' + hit + '}}');
}

async function checkClipboard() {
  if (cardMode || document.hidden) return;
  const P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.ProcessText;
  if (!P || !P.readClipboard) return;
  try {
    const r = await P.readClipboard();
    const text = ((r && r.text) || '').trim();
    if (!text || text === lastClip || text.length > 200) return;
    const isWord = /^[A-Za-z][A-Za-z' -]{0,39}$/.test(text);
    const isSentence = /^[A-Za-z][A-Za-z' ,.!?;:'"()-]{9,199}$/.test(text) && text.trim().split(/\s+/).length >= 2;
    if (!isWord && !isSentence) return;
    lastClip = text;
    const bar = $('clip-bar');
    clearTimeout(bar._t);
    if (isWord) {
      bar.textContent = '📋 检测到剪贴板：「' + text + '」 点击查词（自动带上所在句子）';
      bar.onclick = () => {
        bar.classList.add('hidden');
        switchTab('query');
        runQuery(text);
      };
    } else {
      clipSentence = text;
      bar.textContent = '📋 检测到句子 → 点击粘贴，改成要查的词后查（自动带语境）';
      bar.onclick = () => {
        bar.classList.add('hidden');
        switchTab('query');
        const input = $('q-input');
        input.value = text;
        input.focus();
      };
    }
    bar.classList.remove('hidden');
    bar._t = setTimeout(() => bar.classList.add('hidden'), 12000);
  } catch { /* 剪贴板不可用：忽略 */ }
}

// 回到前台：字号/剪贴板检查 + 设置页状态刷新（无障碍开关回来后状态即时更新）
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  applyFontScale();
  checkClipboard();
  if (cardMode) return;
  const active = document.querySelector('.tabbar button.active');
  if (active && active.dataset.tab === 'settings') refreshSettings();
});

// ---------- 全局悬浮球（自绘选区应用的万能入口） ----------

const BALL_KEY = 'rp-ball-on';

async function refreshBall() {
  const P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.ProcessText;
  const btn = $('ball-toggle');
  if (!P || !P.overlayStatus) {
    $('ball-status').textContent = '浏览器不可用（APK 内有效）';
    btn.classList.add('hidden');
    return;
  }
  try {
    const r = await P.overlayStatus();
    if (!r.granted) {
      $('ball-status').textContent = '未授权';
      btn.textContent = '去授权「显示在其他应用上层」';
      btn.onclick = () => { if (P.openOverlaySettings) P.openOverlaySettings(); };
      return;
    }
    $('ball-status').textContent = r.running ? '✓ 已开启' : '未开启';
    btn.textContent = r.running ? '关闭悬浮球' : '开启悬浮球';
    btn.onclick = async () => {
      const res = await P.setBall({ on: !r.running });
      if (res && res.granted === false) { refreshBall(); return; }
      localStorage.setItem(BALL_KEY, res && res.running ? '1' : '0');
      refreshBall();
    };
  } catch { $('ball-status').textContent = '未知'; }
}

// ---------- 事件绑定 ----------

document.querySelectorAll('.tabbar button').forEach((btn) => {
  btn.onclick = () => switchTab(btn.dataset.tab);
});
$('card').onclick = flip;
document.querySelectorAll('#actions button').forEach((btn) => {
  btn.addEventListener('click', () => answer(btn.id));
});
$('q-form').addEventListener('submit', (e) => { e.preventDefault(); runQuery($('q-input').value); });
$('word-search').addEventListener('input', () => refreshWords());
// 难词/浮层：点击空白处关闭
document.addEventListener('click', (e) => {
  if (tipEl && !tipEl.contains(e.target)) closeWordTip();
});

// ---------- 启动 ----------

(async () => {
  try {
    await rpdb.open();
    deviceName();
    applyFontScale();
    setupProcessText(); // APK：系统选择菜单「拾词」/ 分享 / 悬浮球 → 悬浮卡
    showMain(); // 始终进入主界面：查词/复习离线独立可用，配对在设置页
    loadMiniDict(); // 离线词典后台预载（消除首次查词等待）
    // 悬浮球上次开着的话 → 恢复启动（服务随 App 关闭而停止，这里重新拉起）
    if (localStorage.getItem(BALL_KEY) === '1') {
      setTimeout(() => {
        const P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.ProcessText;
        if (P && P.overlayStatus) P.overlayStatus().then((r) => { if (r && r.granted && P.setBall) P.setBall({ on: true }); });
      }, 800);
    }
  } catch (e) {
    if (window.rpboot) window.rpboot.show('初始化失败：' + ((e && e.message) || e));
  }
})();
