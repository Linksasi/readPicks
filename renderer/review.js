const api = window.tranen;
let queue = [];
let idx = 0;
let flipped = false;
let doneCount = 0;
let againCount = 0;

async function load() {
  queue = await api.reviewDue();
  idx = 0;
  if (!queue.length) {
    document.getElementById('done').classList.remove('hidden');
    document.getElementById('done-sub').textContent = '没有到期的单词，去阅读中积累生词吧';
    return;
  }
  render();
}

function render() {
  flipped = false;
  const w = queue[idx];
  document.getElementById('progress').textContent = `第 ${idx + 1} / ${queue.length} 个`;
  const front = document.getElementById('front');
  front.innerHTML = '';
  if (w.history && w.history.context_cloze) {
    front.appendChild(el('div', 'hint', '根据语境回忆单词：'));
    front.appendChild(el('div', 'cloze', clozeHtml(w.history.context_cloze)));
  } else {
    front.appendChild(el('div', 'cloze', '<span class="blank">？</span>'));
    front.appendChild(el('div', 'hint', '这个单词还记得吗？点击显示答案'));
  }
  const back = document.getElementById('back');
  back.innerHTML = '';
  back.appendChild(el('div', 'word', esc(w.word)));
  if (w.phonetic) back.appendChild(el('div', 'phon', esc(w.phonetic)));
  back.appendChild(el('div', 'back-def', esc(w.definition || '（无释义记录）')));
  if (w.history && w.history.sentence_translation) {
    back.appendChild(el('div', 'back-ctx', '📖 ' + esc(w.history.sentence_translation)));
  }
  if (w.note) back.appendChild(el('div', 'back-ctx', '📝 ' + esc(w.note)));

  document.getElementById('card').classList.remove('hidden');
  document.getElementById('actions').classList.remove('hidden');
  document.getElementById('done').classList.add('hidden');
  showFront();
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
  // {{c1::word}} → <span class="blank">_____</span>
  return esc(cloze).replace(/\{\{c1::(.*?)\}\}/g, '<span class="blank">________</span>');
}

document.getElementById('card').onclick = () => {
  if (!flipped) { flipped = true; showBack(); }
};

const GRADES = { again: 0, hard: 3, good: 5 };
document.querySelectorAll('#actions button').forEach((btn) => {
  btn.onclick = async () => {
    const w = queue[idx];
    await api.reviewAnswer(w.word, GRADES[btn.id]);
    if (btn.id === 'again') againCount++;
    doneCount++;
    idx++;
    if (idx >= queue.length) {
      document.getElementById('card').classList.add('hidden');
      document.getElementById('actions').classList.add('hidden');
      document.getElementById('done').classList.remove('hidden');
      document.getElementById('done-sub').textContent =
        `本次复习 ${doneCount} 个，其中 ${againCount} 个标记为忘记（稍后会再出现）`;
    } else {
      render();
    }
  };
});

document.getElementById('close').onclick = () => window.close();

function el(tag, cls, html) {
  const e = document.createElement('div');
  e.className = cls;
  e.innerHTML = html;
  return e;
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

load();
