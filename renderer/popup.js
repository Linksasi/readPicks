/* 悬浮窗逻辑：单词卡 / 句译 / 历史 / 笔记 / 钉住 / 自动隐藏 */
const api = window.tranen;
let pinned = false;
let leaveTimer = null;
let currentWord = null;

// ---------- 渲染 ----------

api.onLookupResult((p) => {
  document.getElementById('loading').classList.add('hidden');
  hideError();
  if (p.kind === 'word') renderWord(p);
  else renderSentence(p);
});

function renderWord(p) {
  currentWord = p.word;
  document.getElementById('word-view').classList.remove('hidden');
  document.getElementById('sentence-view').classList.add('hidden');

  document.getElementById('word').textContent = p.word;
  document.getElementById('phonetic').textContent = p.phonetic || '';

  const badges = document.getElementById('badges');
  badges.innerHTML = '';
  if (p.collins > 0) {
    const b = el('span', 'badge star', '柯林斯 ' + '★'.repeat(p.collins));
    badges.appendChild(b);
  }
  if (p.oxford) badges.appendChild(el('span', 'badge', '牛津3000'));
  for (const tag of (p.tags || []).slice(0, 6)) {
    badges.appendChild(el('span', 'badge', tag.toUpperCase()));
  }

  const defs = document.getElementById('defs');
  defs.innerHTML = '';
  if (p.defs && p.defs.length) {
    for (const d of p.defs) {
      const li = document.createElement('li');
      if (d.pos) li.appendChild(el('span', 'pos', d.pos));
      li.appendChild(el('span', null, d.def));
      defs.appendChild(li);
    }
  } else if (p.error && !p.matched) {
    defs.appendChild(el('li', null, '本地词典未收录' + (p.dictInstalled ? '' : '（本地词典未安装）')));
  }

  const meta = document.getElementById('meta');
  if (p.queryCount > 0) {
    meta.textContent = `第 ${p.queryCount} 次查询 · 首次 ${fmtTime(p.firstSeen)} · 最近 ${fmtTime(p.lastSeen)}`;
  } else {
    meta.textContent = p.dictInstalled ? '' : '💡 设置中可一键安装离线词典';
  }

  // 语境区
  const ctxSec = document.getElementById('context-section');
  if (p.context) {
    ctxSec.classList.remove('hidden');
    document.getElementById('context').innerHTML = highlightWord(p.context, p.word);
    const ct = document.getElementById('context-trans');
    ct.textContent = p.sentenceTranslation || '';
    const wis = document.getElementById('word-in-sentence');
    if (p.wordInSentence) {
      wis.textContent = `「${p.word}」在本句中译为：${p.wordInSentence}`;
      wis.classList.remove('hidden');
    } else wis.classList.add('hidden');
    const ex = document.getElementById('explain');
    if (p.explain) {
      ex.textContent = '💡 ' + p.explain;
      ex.classList.remove('hidden');
    } else ex.classList.add('hidden');
    const ow = document.getElementById('other-words');
    ow.innerHTML = '';
    if (p.words && p.words.length) {
      ow.classList.remove('hidden');
      ow.appendChild(el('span', 'section-title', '句中生词：').firstChild || textSpan('句中生词：'));
      for (const w of p.words) {
        const c = document.createElement('button');
        c.className = 'chip';
        c.innerHTML = `${escapeHtml(w.word)}<small>${escapeHtml(w.meaning || '')}</small>`;
        c.onclick = () => api.query(w.word);
        ow.appendChild(c);
      }
    } else ow.classList.add('hidden');
  } else {
    ctxSec.classList.add('hidden');
  }

  // 历史
  const hist = document.getElementById('history');
  hist.innerHTML = '';
  if (p.history && p.history.length) {
    for (const h of p.history) {
      const item = document.createElement('div');
      item.className = 'hist-item';
      let html = `<div class="t">${fmtTime(h.created_at)}${h.source ? ' · ' + h.source : ''}</div>`;
      if (h.context) html += `<div>${highlightWord(h.context, p.word)}</div>`;
      if (h.sentence_translation) html += `<div class="t">${escapeHtml(h.sentence_translation)}</div>`;
      if (h.word_in_sentence) html += `<div class="t">译：${escapeHtml(h.word_in_sentence)}</div>`;
      item.innerHTML = html;
      hist.appendChild(item);
    }
  } else {
    hist.textContent = '暂无历史记录';
  }

  showError(p.error);
}

function renderSentence(p) {
  document.getElementById('sentence-view').classList.remove('hidden');
  document.getElementById('word-view').classList.add('hidden');
  document.getElementById('s-raw').textContent = p.raw;
  document.getElementById('s-trans').textContent = p.translation || '';
  const err = document.getElementById('s-error');
  if (p.error) { err.textContent = p.error; err.classList.remove('hidden'); }
  else err.classList.add('hidden');
}

// ---------- 交互 ----------

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function textSpan(t) { return el('span', null, t); }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function highlightWord(text, word) {
  const re = new RegExp(`\\b(${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\b`, 'i');
  return escapeHtml(text).replace(re, '<mark>$1</mark>');
}
function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}
function showError(msg) {
  const e = document.getElementById('error');
  if (msg) { e.textContent = msg; e.classList.remove('hidden'); }
  else e.classList.add('hidden');
}
function hideError() { showError(null); }

function speak(type) {
  if (!currentWord) return;
  new Audio(`https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(currentWord)}&type=${type}`).play().catch(() => {});
}

document.getElementById('speak-en').onclick = () => speak(1);
document.getElementById('speak-us').onclick = () => speak(2);
document.getElementById('close').onclick = () => api.hidePopup();
document.getElementById('s-copy').onclick = async () => {
  const t = document.getElementById('s-trans').textContent;
  if (t) { await navigator.clipboard.writeText(t); document.getElementById('s-copy').textContent = '已复制 ✓'; }
};

const pinBtn = document.getElementById('pin');
pinBtn.onclick = () => {
  pinned = !pinned;
  pinBtn.classList.toggle('active', pinned);
  pinBtn.textContent = pinned ? '📌' : '📍';
  api.pin(pinned);
};

// 笔记
const noteEl = document.getElementById('note');
document.getElementById('note-save').onclick = async () => {
  if (currentWord) await api.noteSet(currentWord, noteEl.value);
  document.getElementById('note-save').textContent = '已保存 ✓';
  setTimeout(() => (document.getElementById('note-save').textContent = '保存笔记'), 1200);
};

// 键盘：Esc 关闭（点击窗口获得焦点后生效）
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') api.hidePopup(); });

// 鼠标移出窗口 → 未钉住则 1.2s 后自动隐藏（移回取消）
document.body.addEventListener('mouseleave', () => {
  if (pinned) return;
  leaveTimer = setTimeout(() => api.hidePopup(), 1200);
});
document.body.addEventListener('mouseenter', () => clearTimeout(leaveTimer));
