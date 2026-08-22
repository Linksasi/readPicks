const api = window.tranen;

// ---------- Tabs ----------
document.querySelectorAll('.tabs button').forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.pane').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'words') setTimeout(refreshWords, 50); // 进入生词本时刷新列表
  };
});

// ---------- 常规 ----------
let cfg = null;

async function loadConfig() {
  cfg = await api.configGet();
  document.getElementById('hotkey').value = cfg.hotkey;
  const ap = document.getElementById('autoPopup');
  ap.checked = !!cfg.autoPopup;
  updateAutoPopupLabel(cfg.autoPopup);
  ap.onchange = () => updateAutoPopupLabel(ap.checked);
  document.getElementById('provider').value = cfg.provider;

  document.getElementById('youdao-appKey').value = cfg.providers.youdao.appKey;
  document.getElementById('youdao-appSecret').value = cfg.providers.youdao.appSecret;
  document.getElementById('baidu-appId').value = cfg.providers.baidu.appId;
  document.getElementById('baidu-appKey').value = cfg.providers.baidu.appKey;
  document.getElementById('deepl-apiKey').value = cfg.providers.deepl.apiKey;
  document.getElementById('deepl-free').value = String(cfg.providers.deepl.free);
  document.getElementById('llm-baseUrl').value = cfg.providers.llm.baseUrl;
  document.getElementById('llm-apiKey').value = cfg.providers.llm.apiKey;
  document.getElementById('llm-model').value = cfg.providers.llm.model;
  document.getElementById('llm-systemPrompt').value = cfg.providers.llm.systemPrompt;

  const type = cfg.provider === 'none' ? 'mymemory' : cfg.provider;
  document.getElementById('p-type').value = type;
  switchProvider(type);
}

function msg(el, text, cls = '') {
  el.textContent = text;
  el.className = 'msg ' + cls;
}

function updateAutoPopupLabel(on) {
  document.getElementById('autoPopup-label').textContent = on ? '开启（Ctrl+C 即弹窗）' : '关闭（仅热键触发）';
}

document.getElementById('save-general').onclick = async () => {
  const hotkey = document.getElementById('hotkey').value.trim();
  if (!hotkey) { msg(document.getElementById('general-msg'), '热键不能为空', 'err'); return; }
  const c = await api.configSet({
    hotkey,
    autoPopup: document.getElementById('autoPopup').checked,
    provider: document.getElementById('provider').value,
  });
  cfg = c;
  msg(document.getElementById('general-msg'), '已保存并生效 ✓', 'ok');
};

// ---------- 翻译源 ----------
function switchProvider(type) {
  document.querySelectorAll('.pcfg').forEach((p) => p.classList.add('hidden'));
  const el2 = document.getElementById('cfg-' + type);
  if (el2) el2.classList.remove('hidden');
}
document.getElementById('p-type').onchange = (e) => switchProvider(e.target.value);

document.getElementById('save-translate').onclick = async () => {
  const type = document.getElementById('p-type').value;
  const providers = JSON.parse(JSON.stringify(cfg.providers));
  providers.youdao = {
    appKey: document.getElementById('youdao-appKey').value.trim(),
    appSecret: document.getElementById('youdao-appSecret').value.trim(),
  };
  providers.baidu = {
    appId: document.getElementById('baidu-appId').value.trim(),
    appKey: document.getElementById('baidu-appKey').value.trim(),
  };
  providers.deepl = {
    apiKey: document.getElementById('deepl-apiKey').value.trim(),
    free: document.getElementById('deepl-free').value === 'true',
  };
  providers.llm = {
    baseUrl: document.getElementById('llm-baseUrl').value.trim(),
    apiKey: document.getElementById('llm-apiKey').value.trim(),
    model: document.getElementById('llm-model').value.trim(),
    systemPrompt: document.getElementById('llm-systemPrompt').value,
  };
  const c = await api.configSet({ provider: type, providers });
  cfg = c;
  msg(document.getElementById('translate-msg'), '已保存 ✓', 'ok');
};

// ---------- 词典 ----------
async function refreshDict() {
  const st = await api.dictStatus();
  const box = document.getElementById('dict-status');
  if (st.installed) {
    box.innerHTML = `<div class="status-box ok">✅ 本地词典已安装（${st.sizeMB} MB）· 76 万词条离线可用</div>`;
    document.getElementById('dict-download').textContent = '重新下载词典';
  } else {
    box.innerHTML = '<div class="status-box warn">⚠️ 本地词典未安装 — 单词查询将依赖在线翻译</div>';
  }
}
document.getElementById('dict-download').onclick = async () => {
  const btn = document.getElementById('dict-download');
  btn.disabled = true;
  const bar = document.getElementById('dict-progress');
  bar.classList.remove('hidden');
  api.onDictProgress((p) => {
    const m = document.getElementById('dict-msg');
    if (p.phase === 'download') {
      bar.firstElementChild.style.width = p.percent + '%';
      msg(m, `下载中… ${p.percent}%`);
    } else if (p.phase === 'info') {
      msg(m, p.message);
    } else if (p.phase === 'done') {
      msg(m, '✅ ' + p.message, 'ok');
      refreshDict();
      btn.disabled = false;
    } else if (p.phase === 'error') {
      msg(m, '❌ ' + p.message, 'err');
      btn.disabled = false;
    }
  });
  await api.dictDownload();
};

document.getElementById('dict-install-file').onclick = async () => {
  const r = await api.dictInstallFile();
  const m = document.getElementById('dict-msg');
  if (r && r.canceled) return;
  if (r && r.ok) msg(m, '✅ 词典安装完成，离线查询已可用', 'ok');
  else if (r && r.error) msg(m, '❌ 安装失败：' + r.error, 'err');
};

document.getElementById('dl-link').onclick = (e) => {
  e.preventDefault();
  api.openExternal('https://github.com/skywind3000/ECDICT/releases/latest');
};

document.getElementById('export-anki').onclick = async () => {
  const r = await api.exportAnki();
  const m = document.getElementById('dict-msg');
  if (r.canceled) return;
  if (r.ok) msg(m, `已导出 ${r.count} 个单词 → ${r.filePath}（用 Anki 导入即可）`, 'ok');
  else msg(m, '导出失败', 'err');
};

// ---------- 生词本 ----------
async function refreshWords() {
  const stats = await api.wordsStats();
  document.getElementById('words-stats').innerHTML =
    `<span class="stat-chip">共 ${stats.total} 个生词</span><span class="stat-chip">${stats.due} 个待复习</span>`;
  const list = document.getElementById('words-list');
  list.innerHTML = '';
  const words = await api.wordsList();
  if (!words.length) {
    list.appendChild(Object.assign(document.createElement('div'), { className: 'empty', textContent: '📭 还没有生词 — 阅读时选中单词按热键即可积累' }));
    return;
  }
  for (const w of words) {
    const row = document.createElement('div');
    row.className = 'word-row';
    const left = document.createElement('div');
    left.className = 'left';
    const name = document.createElement('span');
    name.className = 'w';
    name.textContent = w.word;
    const cnt = document.createElement('span');
    cnt.className = 'count';
    cnt.textContent = `${w.query_count} 次`;
    const info = document.createElement('span');
    info.className = 'info';
    info.textContent = new Date(w.last_seen).toLocaleDateString('zh-CN');
    left.appendChild(name); left.appendChild(cnt); left.appendChild(info);
    const del = document.createElement('button');
    del.textContent = '删除';
    del.onclick = async () => { await api.wordsRemove(w.word); refreshWords(); };
    row.appendChild(left); row.appendChild(del);
    list.appendChild(row);
  }
}

// 生词本刷新入口已合并进 tab 点击处理

// ---------- 词汇量自测 ----------
let vocabSession = null; // { words: [], answers: [], idx: 0 }

async function refreshVocab() {
  const lvl = await api.vocabLevel();
  const box = document.getElementById('vocab-status');
  document.getElementById('vocab-test').classList.add('hidden');
  document.getElementById('vocab-result').classList.add('hidden');
  document.getElementById('vocab-actions').classList.remove('hidden');
  document.getElementById('vocab-quit').classList.add('hidden');
  if (lvl && lvl.score) {
    box.innerHTML =
      `<div class="status-box ok"><span class="sb-icon">✅</span><div class="sb-body">` +
      `<div class="sb-main">已测试：词汇量约 <b>${lvl.score}</b> 词（CEFR ${lvl.cefr}）· ${new Date(lvl.takenAt).toLocaleDateString('zh-CN')}</div>` +
      `<div class="sb-sub">查词将按此水平生成英文释义</div></div></div>`;
    document.getElementById('vocab-start').textContent = '重新测试';
  } else {
    box.innerHTML =
      '<div class="status-box warn"><span class="sb-icon">⚠️</span><div class="sb-body">' +
      '<div class="sb-main">尚未测试</div>' +
      '<div class="sb-sub">测完后查词会显示「适合你词汇水平的简单英语释义」</div></div></div>';
    document.getElementById('vocab-start').textContent = '开始测试';
  }
}

function vocabAnswer(known) {
  if (!vocabSession) return;
  const s = vocabSession;
  s.answers[s.idx] = known;
  s.idx++;
  if (s.idx >= s.words.length) {
    vocabFinish();
    return;
  }
  vocabShowWord();
}

function vocabShowWord() {
  const s = vocabSession;
  document.getElementById('vocab-word').textContent = s.words[s.idx];
  document.getElementById('vocab-progress').textContent = `第 ${s.idx + 1} / ${s.words.length} 题`;
  document.getElementById('vocab-bar').style.width = ((s.idx / s.words.length) * 100).toFixed(1) + '%';
  const m = document.getElementById('vocab-msg');
  if (m.textContent) { m.textContent = ''; m.className = 'msg'; }
}

async function vocabFinish() {
  const s = vocabSession;
  vocabSession = null;
  document.getElementById('vocab-test').classList.add('hidden');
  const res = await api.vocabFinish(s.answers);
  if (!res.ok) {
    document.getElementById('vocab-msg').textContent = '❌ ' + res.error;
    refreshVocab();
    return;
  }
  const r = res.result;
  document.getElementById('vocab-score').innerHTML =
    `词汇量约 <span class="cefr">${r.score}</span> 词 · CEFR ${r.cefr}`;
  document.getElementById('vocab-sub').textContent =
    `测试于 ${new Date(r.takenAt).toLocaleDateString('zh-CN')}` +
    (r.fakeKnown ? ` · 误认伪词 ${r.fakeKnown} 个（已计入惩罚）` : ' · 无伪词误认，结果可信');
  const box = document.getElementById('vocab-buckets');
  box.innerHTML = '';
  for (const b of r.buckets) {
    const row = document.createElement('div');
    row.className = 'vocab-bucket';
    const rng = document.createElement('span');
    rng.className = 'r';
    rng.textContent = `词频 ${b.range}`;
    const bar = document.createElement('div');
    bar.className = 'bar';
    const fill = document.createElement('div');
    fill.style.width = b.rate + '%';
    bar.appendChild(fill);
    const pct = document.createElement('span');
    pct.className = 'p';
    pct.textContent = b.rate + '%';
    row.appendChild(rng); row.appendChild(bar); row.appendChild(pct);
    box.appendChild(row);
  }
  document.getElementById('vocab-result').classList.remove('hidden');
  document.getElementById('vocab-actions').classList.remove('hidden');
  document.getElementById('vocab-start').textContent = '重新测试';
  // 立即更新状态卡片
  const st = document.getElementById('vocab-status');
  st.innerHTML =
    `<div class="status-box ok"><span class="sb-icon">✅</span><div class="sb-body">` +
    `<div class="sb-main">已测试：词汇量约 <b>${r.score}</b> 词（CEFR ${r.cefr}）</div>` +
    `<div class="sb-sub">查词将按此水平生成英文释义</div></div></div>`;
}

document.getElementById('vocab-start').onclick = async () => {
  const r = await api.vocabStart();
  if (!r.ok) {
    document.getElementById('vocab-msg').textContent = '❌ ' + r.error;
    return;
  }
  vocabSession = { words: r.words, answers: new Array(r.total).fill(false), idx: 0 };
  document.getElementById('vocab-actions').classList.add('hidden');
  document.getElementById('vocab-result').classList.add('hidden');
  document.getElementById('vocab-quit').classList.remove('hidden');
  document.getElementById('vocab-test').classList.remove('hidden');
  vocabShowWord();
};

document.getElementById('vocab-known').onclick = () => vocabAnswer(true);
document.getElementById('vocab-unknown').onclick = () => vocabAnswer(false);
document.getElementById('vocab-again').onclick = () =>
  document.getElementById('vocab-start').click();
document.getElementById('vocab-quit').onclick = () => {
  vocabSession = null;
  refreshVocab();
};

// 键盘快捷答题：→ / 空格 = 认识，← / X = 不认识
document.addEventListener('keydown', (e) => {
  if (!vocabSession) return;
  if (e.key === 'ArrowRight' || e.key === ' ' || e.key.toLowerCase() === 'j') {
    e.preventDefault();
    vocabAnswer(true);
  } else if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'x' || e.key.toLowerCase() === 'k') {
    e.preventDefault();
    vocabAnswer(false);
  }
});

loadConfig().then(() => { refreshDict(); refreshWords(); refreshVocab(); });
