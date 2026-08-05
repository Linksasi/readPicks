const api = window.tranen;

// ---------- Tabs ----------
document.querySelectorAll('.tabs button').forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.pane').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  };
});

// ---------- 常规 ----------
let cfg = null;

async function loadConfig() {
  cfg = await api.configGet();
  document.getElementById('hotkey').value = cfg.hotkey;
  document.getElementById('autoPopup').value = String(cfg.autoPopup);
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

document.getElementById('save-general').onclick = async () => {
  const hotkey = document.getElementById('hotkey').value.trim();
  if (!hotkey) { msg(document.getElementById('general-msg'), '热键不能为空', 'err'); return; }
  const c = await api.configSet({
    hotkey,
    autoPopup: document.getElementById('autoPopup').value === 'true',
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
    msg(box, `✅ 本地词典已安装（${st.sizeMB} MB）· 76 万词条离线可用`, 'ok');
    document.getElementById('dict-download').textContent = '重新下载词典';
  } else {
    msg(box, '⚠️ 本地词典未安装 — 单词查询将依赖在线翻译', 'err');
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
  document.getElementById('words-stats').textContent = `共 ${stats.total} 个生词 · ${stats.due} 个待复习`;
  const list = document.getElementById('words-list');
  list.innerHTML = '';
  const words = await api.wordsList();
  if (!words.length) {
    list.appendChild(Object.assign(document.createElement('div'), { className: 'empty', textContent: '还没有生词 — 阅读时选中单词按热键即可积累' }));
    return;
  }
  for (const w of words) {
    const row = document.createElement('div');
    row.className = 'word-row';
    const left = document.createElement('div');
    const name = document.createElement('span');
    name.className = 'w';
    name.textContent = w.word;
    const info = document.createElement('span');
    info.className = 'info';
    info.textContent = `  · 查询 ${w.query_count} 次 · ${new Date(w.last_seen).toLocaleDateString('zh-CN')}`;
    left.appendChild(name); left.appendChild(info);
    const del = document.createElement('button');
    del.textContent = '删除';
    del.onclick = async () => { await api.wordsRemove(w.word); refreshWords(); };
    row.appendChild(left); row.appendChild(del);
    list.appendChild(row);
  }
}

// 切到生词本 tab 时刷新
document.querySelector('[data-tab="words"]').onclick = () => setTimeout(refreshWords, 50);

loadConfig().then(() => { refreshDict(); refreshWords(); });
