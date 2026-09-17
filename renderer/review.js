/* 复习窗口：挖空语境正面 + 英英释义优先背面 + 忘记重排队 + 键盘快捷键 */
const api = window.tranen;
let queue = [];
let idx = 0;
let flipped = false;
let doneWords = new Set(); // 唯一词数（忘记重排的词不重复计数）
let againCount = 0;
let requeued = new Map();  // word -> 本次会话已重现次数
const MAX_REQUEUE = 2;     // 每词每会话最多重现次数（防单卡死循环）

async function load() {
  queue = await api.reviewDue();
  idx = 0;
  if (!queue.length) {
    showDone('没有到期的单词', '去阅读中积累生词吧');
    return;
  }
  render();
}

function render() {
  flipped = false;
  closeWordTip();
  const w = queue[idx];
  updateProgress();

  // 正面：语境挖空优先，无语境才退化为「还记得吗」
  const front = document.getElementById('front');
  front.innerHTML = '';
  if (w.history && w.history.context_cloze) {
    front.appendChild(el('div', 'hint', '根据语境回忆单词：'));
    front.appendChild(elHtml('div', 'cloze', clozeHtml(w.history.context_cloze)));
  } else {
    front.appendChild(elHtml('div', 'cloze', '<span class="blank">？</span>'));
    front.appendChild(el('div', 'hint', '这个单词还记得吗？点击显示答案'));
  }

  // 背面（理念：英文释义在上、中文弱化兜底——复习也用英语理解英语）
  const back = document.getElementById('back');
  back.innerHTML = '';
  back.appendChild(el('div', 'word', w.word));
  if (w.phonetic) back.appendChild(el('div', 'phon', w.phonetic));
  let hasEn = false;
  if (w.simpleDef) {
    back.appendChild(el('div', 'simple-def', w.simpleDef)); // LLM 简单英语释义
    hasEn = true;
  } else if (w.enDefinition && w.enDefinition.senses && w.enDefinition.senses.length) {
    back.appendChild(renderSenses(w.enDefinition.senses, w.enDefinition.hard || [], w.enDefinition.hints || []));
    hasEn = true;
  }
  const def = el('div', 'back-def', w.definition || '（无释义记录）');
  if (hasEn) def.classList.add('muted'); // 有英文区 → 中文降为灰色对照
  back.appendChild(def);
  if (w.history && w.history.sentence_translation) {
    back.appendChild(el('div', 'back-ctx', w.history.sentence_translation));
  }
  if (w.note) back.appendChild(el('div', 'back-ctx', w.note));

  document.getElementById('card').classList.remove('hidden');
  document.getElementById('actions').classList.remove('hidden');
  document.getElementById('done').classList.add('hidden');
  showFront();
}

function updateProgress() {
  document.getElementById('progress').textContent = `还剩 ${queue.length - idx} 个`;
}

function flip() {
  if (flipped) return;
  flipped = true;
  showBack();
}
function showFront() {
  document.getElementById('front').classList.remove('hidden');
  document.getElementById('back').classList.add('hidden');
}
function showBack() {
  document.getElementById('front').classList.add('hidden');
  document.getElementById('back').classList.remove('hidden');
}

function clozeHtml(cloze) {
  // {{c1::word}} → <span class="blank">_____</span>（先转义再注入，防 XSS）
  return escapeHtml(cloze).replace(/\{\{c1::(.*?)\}\}/g, '<span class="blank">________</span>');
}

// ---------- 打分 / 忘记重排队 ----------

const GRADES = { again: 0, hard: 3, good: 5 };

async function answer(id, btn) {
  const w = queue[idx];
  if (!w) return;
  if (btn) btn.blur(); // 防止焦点残留导致空格误触发上次按钮
  await api.reviewAnswer(w.word, GRADES[id]);
  doneWords.add(w.word);
  if (id === 'again') againCount++;
  // 会话内重现：「忘记」的词塞回队列尾部马上再来一次（SM-2 状态已即时更新，这里只做当次巩固）
  if (id === 'again' && (requeued.get(w.word) || 0) < MAX_REQUEUE) {
    requeued.set(w.word, (requeued.get(w.word) || 0) + 1);
    queue.push(w);
  }
  idx++;
  if (idx >= queue.length) {
    finish();
  } else {
    render();
  }
}

function finish() {
  document.getElementById('card').classList.add('hidden');
  document.getElementById('actions').classList.add('hidden');
  const tail = againCount ? ` · 忘掉的词已在队列中重现巩固` : '';
  showDone('今日复习完成', `本次复习 ${doneWords.size} 个词 · 忘记 ${againCount} 次${tail}`);
}

function showDone(title, sub) {
  document.getElementById('done-title').textContent = title;
  document.getElementById('done-sub').textContent = sub;
  document.getElementById('done').classList.remove('hidden');
}

// ---------- 英英释义渲染（难词就地化解，移植自 popup） ----------

const POS_LABEL = {
  n: '名词', v: '动词', a: '形容词', s: '形容词', r: '副词',
  vt: '及物动词', vi: '不及物动词', ad: '副词',
};

/** 义项列表：难词渲染为可点击虚线按钮，点击就地弹出解释。纯 DOM 构建，无 innerHTML 注入。 */
function renderSenses(senses, hardWords, hints) {
  const hs = new Set(hardWords.map((x) => String(x).toLowerCase()));
  const hintMap = new Map((hints || []).map((h) => [String(h.word).toLowerCase(), h]));
  const wrap = el('div', 'en-def-block');
  for (const sense of senses) {
    const row = el('div', 'en-sense');
    const pos = String(sense.pos || '').toLowerCase();
    if (pos) row.appendChild(el('span', 'pos', POS_LABEL[pos] || pos + '.'));
    const parts = String(sense.text || '').split(/([A-Za-z][A-Za-z'-]*)/g);
    for (const part of parts) {
      if (/^[A-Za-z]/.test(part) && hs.has(part.toLowerCase())) {
        const b = el('button', 'hard-word', part);
        b.title = '这个词超出你的词汇水平，点击就地查看';
        b.onclick = (ev) => { ev.stopPropagation(); showWordTip(b, part, hintMap.get(part.toLowerCase())); };
        row.appendChild(b);
      } else {
        row.appendChild(document.createTextNode(part));
      }
    }
    wrap.appendChild(row);
  }
  return wrap;
}

// ---------- 难词就地浮层 ----------

let tipEl = null;
function showWordTip(anchor, word, hint) {
  closeWordTip();
  const tip = el('div', 'word-tip');
  tip.appendChild(el('div', 'word-tip-head', word));
  if (hint && hint.zh) tip.appendChild(el('div', 'word-tip-zh', hint.zh));
  if (hint && hint.en) tip.appendChild(el('div', 'word-tip-en', hint.en));
  if (!hint || (!hint.zh && !hint.en)) {
    const d = el('div', 'word-tip-en', '（词典无简释，点击可查词）');
    d.onclick = () => { closeWordTip(); api.query(word); }; // 兜底：直接发起查词
    tip.appendChild(d);
  }
  document.body.appendChild(tip);
  // 定位：按钮下方，越界翻转到上方/左侧
  const r = anchor.getBoundingClientRect();
  let x = Math.min(r.left, window.innerWidth - tip.offsetWidth - 8);
  let y = r.bottom + 4;
  if (y + tip.offsetHeight > window.innerHeight - 8) y = Math.max(4, r.top - tip.offsetHeight - 4);
  tip.style.left = Math.max(4, x) + 'px';
  tip.style.top = y + 'px';
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

// ---------- 事件绑定 ----------

document.getElementById('card').onclick = flip;

document.querySelectorAll('#actions button').forEach((btn) => {
  btn.addEventListener('click', () => answer(btn.id, btn));
});

document.getElementById('close').onclick = () => window.close();

// 键盘快捷键：空格/回车翻面，1/2/3 打分（仅背面生效），Esc 关闭
const GRADE_KEYS = { 1: 'again', 2: 'hard', 3: 'good' };
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { window.close(); return; }
  if (e.repeat) return;
  const cardActive = queue.length > 0 && idx < queue.length;
  if ((e.key === ' ' || e.key === 'Enter') && cardActive && !flipped) {
    e.preventDefault();
    flip();
    return;
  }
  const g = GRADE_KEYS[e.key];
  if (g && cardActive && flipped) answer(g);
});

// 点击浮层外任意处关闭；卡片滚动时关闭（浮层为 fixed 定位，不跟随滚动）
document.addEventListener('click', (e) => {
  if (tipEl && !tipEl.contains(e.target) && !e.target.classList.contains('hard-word')) closeWordTip();
});
document.querySelector('.card').addEventListener('scroll', closeWordTip);

load();
