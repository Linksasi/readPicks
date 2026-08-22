const { app, ipcMain, Tray, Menu, dialog, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

const config = require('./config');
const db = require('./db');
const ecdict = require('./ecdict');
const translate = require('./translate');
const vocab = require('./vocabtest');
const hotkey = require('./hotkey');
const clipboardWatch = require('./clipboard-watch');
const context = require('./context');
const windowMgr = require('./window');
const { downloadDict } = require('../scripts/download-dict');

let tray = null;

// ---------- 查询管线 ----------

let querySeq = 0; // 查询序号：慢查询结果过期后丢弃，避免旧结果覆盖新查询

async function handleQuery(raw) {
  const seq = ++querySeq;
  try {
    const text = hotkey.cleanText(raw);
    if (!text) return null;
    const kind = hotkey.classify(text);
    // 单词/短语统一小写（"Apple"/"apple" 合并为一条记录；专名显示以语境句为准）
    const query = kind === 'word' ? text.toLowerCase() : text;
    context.push(text); // 原文入语境历史（大小写敏感匹配不依赖原文）
    // 立即弹出「查询中」窗口，查询在后台进行（感知零延迟）
    windowMgr.showPopup({ kind, raw: query, loading: true });
    const payload = kind === 'word' ? await lookupWord(query) : await translateText(query);
    if (seq !== querySeq) return payload; // 已有更新的查询，丢弃过期结果
    windowMgr.showPopup(payload);
    return payload;
  } catch (e) {
    console.error('[query] 失败:', e);
    const err = {
      kind: 'word',
      word: String(raw || ''),
      raw: String(raw || ''),
      error: e.message || String(e),
      defs: [],
      tags: [],
      words: [],
      dictInstalled: ecdict.isInstalled(),
      matched: false,
      history: [],
    };
    if (seq === querySeq) windowMgr.showPopup(err);
    return err;
  }
}

/**
 * 英英释义构建（查词/复习共用）：WordNet 义项拆分 + 按用户词汇水平标注难词 + 就地化解提示。
 * 未测词汇量或词典无英文释义时返回 null。
 */
function buildEnDefinition(dict) {
  const lvl = vocab.currentLevel();
  if (!lvl || !lvl.score || !dict || !dict.definition) return null;
  const { maxBnc } = vocab.levelInfo(lvl.score);
  const { hard } = vocab.annotateHardWords(dict.definition, maxBnc);
  return {
    senses: ecdict.parseDefinition(dict.definition),
    hard,
    hints: vocab.hardWordHints(hard),
    vocabLevel: { score: lvl.score, cefr: lvl.cefr },
  };
}

async function lookupWord(word) {
  const payload = {
    kind: 'word',
    word,
    raw: word,
    phonetic: '',
    defs: [],
    tags: [],
    collins: 0,
    oxford: 0,
    dictInstalled: ecdict.isInstalled(),
    matched: false,
    enDefinition: null,   // { text, hard: [word] } 按用户词汇水平标注的英英释义（测过词汇量才有）
    simpleDef: null,      // LLM 用简单英语生成的本句释义
    vocabLevel: null,     // 当前词汇量 { score, cefr }（提示用）
    context: null,
    contextCloze: null,
    sentenceTranslation: null,
    wordInSentence: null,
    explain: null,
    words: [],
    source: 'dict',
    error: null,
  };

  const dict = ecdict.lookup(word);
  if (dict) {
    payload.matched = true;
    payload.phonetic = dict.phonetic;
    payload.defs = ecdict.parseTranslation(dict.translation);
    payload.tags = dict.tags;
    payload.collins = dict.collins;
    payload.oxford = dict.oxford;
    // 已测词汇量 → 附英英释义并按用户水平标注难词
    const en = buildEnDefinition(dict);
    if (en) {
      payload.enDefinition = { senses: en.senses, hard: en.hard, hints: en.hints };
      payload.vocabLevel = en.vocabLevel;
      payload.wordLevel = vocab.wordLevel(dict.bnc, en.vocabLevel.score); // 该词对你的难度
    }
  } else if (ecdict.isInstalled()) {
    payload.error = '本地词典未收录，尝试在线翻译';
  }

  // 剪贴板历史回溯：自动找语境句子
  const sentence = context.findContext(word);
  let definition = dict ? dict.translation : '';
  if (sentence) {
    payload.context = sentence;
    payload.contextCloze = context.makeCloze(sentence, word);
    try {
      const ctx = await translate.lookupInContext(word, sentence);
      payload.sentenceTranslation = ctx.sentence_translation;
      payload.wordInSentence = ctx.word_in_sentence;
      payload.explain = ctx.explain;
      payload.usage = ctx.usage;
      payload.words = ctx.words || [];
      payload.simpleDef = ctx.simpleDef || null;
      if (ctx.word_in_sentence && !definition) definition = ctx.word_in_sentence;
      if (ctx.sentence_translation) payload.source = ctx.source || 'translate';
    } catch (e) {
      payload.error = payload.error || `语境翻译失败：${e.message}`;
    }
  } else if (!dict) {
    // 无本地释义也无语境：在线翻译该词兜底
    try {
      const r = await translate.translateSentence(word);
      if (r.translation) {
        definition = r.translation;
        payload.defs = [{ pos: '', def: r.translation }];
        payload.source = 'translate';
      }
    } catch (e) {
      payload.error = payload.error || `在线翻译失败：${e.message}`;
    }
  }

  // 无语境时：LLM 单独生成简单英语释义（覆盖「没复制句子」的查词场景）
  if (!payload.simpleDef && !sentence) {
    const cfg = config.load();
    if (cfg.vocabLevel && cfg.vocabLevel.score && cfg.provider === 'llm' && cfg.providers.llm?.apiKey) {
      try {
        const sd = await translate.simpleDefinition(word);
        if (sd) payload.simpleDef = sd.simpleDef;
      } catch { /* 简单释义失败不影响主流程 */ }
    }
  }

  // 至少有一个释义来源才入库（专有名词/乱码不污染生词本）
  if (dict || definition || payload.wordInSentence) {
    const rec = db.recordLookup({
      word,
      phonetic: payload.phonetic,
      definition,
      context: payload.context || undefined,
      contextCloze: payload.contextCloze || undefined,
      sentenceTranslation: payload.sentenceTranslation || undefined,
      wordInSentence: payload.wordInSentence || undefined,
      simpleDef: payload.simpleDef || undefined, // 简单释义持久化，复习卡复用
      source: payload.source,
    });
    payload.queryCount = rec.queryCount;
    payload.firstSeen = rec.firstSeen;
    payload.lastSeen = rec.lastSeen;
    payload.history = rec.history;
  } else {
    payload.queryCount = 0;
    payload.history = [];
  }
  return payload;
}

async function translateText(sentence) {
  const payload = {
    kind: 'sentence',
    raw: sentence,
    translation: null,
    error: null,
  };
  try {
    const r = await translate.translateSentence(sentence);
    payload.translation = r.translation;
  } catch (e) {
    payload.error = e.message;
  }
  return payload;
}

// ---------- IPC ----------

/** 只信任来自本应用 renderer 页面（file://.../renderer/）的调用，防止 XSS 或其他窗口滥用主进程能力 */
function isTrustedSender(event) {
  let url = '';
  try { url = event?.senderFrame?.url || ''; } catch { url = ''; }
  return url.startsWith('file://') && url.includes('/renderer/');
}

function handleIpc(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedSender(event)) {
      console.warn('[ipc] 拒绝不受信调用方:', channel);
      return null;
    }
    return fn(event, ...args);
  });
}

function onIpc(channel, fn) {
  ipcMain.on(channel, (event, ...args) => {
    if (!isTrustedSender(event)) {
      console.warn('[ipc] 拒绝不受信调用方:', channel);
      return;
    }
    fn(event, ...args);
  });
}

function registerIpc() {
  handleIpc('query', (_e, text) => handleQuery(text));

  onIpc('popup:hide', () => windowMgr.hidePopup());
  onIpc('popup:hide-force', () => windowMgr.forceHidePopup());
  onIpc('popup:pin', (_e, v) => windowMgr.setPinned(!!v));
  onIpc('popup:busy', (_e, v) => windowMgr.setBusy(!!v));

  handleIpc('open-settings', () => windowMgr.createSettings());

  handleIpc('note:set', (_e, word, note) => { db.setNote(word, note); return true; });

  handleIpc('export-anki', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: '导出 Anki 生词本',
      defaultPath: path.join(app.getPath('documents'), 'ReadPicks-生词本.txt'),
      filters: [{ name: 'Anki 文本', extensions: ['txt'] }],
    });
    if (canceled || !filePath) return { canceled: true };
    const count = db.exportAnki(filePath);
    return { ok: true, count, filePath };
  });

  handleIpc('dict:status', () => {
    const p = ecdict.DB_PATH();
    return {
      installed: ecdict.isInstalled(),
      path: p,
      exists: fs.existsSync(p),
      sizeMB: fs.existsSync(p) ? Math.round(fs.statSync(p).size / 1048576) : 0,
    };
  });

  handleIpc('dict:download', async () => {
    const win = windowMgr.getSettingsWindow ? windowMgr.getSettingsWindow() : null;
    const emit = (p) => { if (win && !win.isDestroyed()) win.webContents.send('dict:progress', p); };
    try {
      await downloadDict(emit);
      ecdict.init();
      emit({ phase: 'done', message: '词典安装完成' });
      return { ok: true };
    } catch (e) {
      emit({ phase: 'error', message: e.message });
      return { ok: false, error: e.message };
    }
  });

  handleIpc('dict:install-file', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: '选择 ECDICT 词典压缩包（ecdict-sqlite-*.zip）',
      properties: ['openFile'],
      filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }],
    });
    if (canceled || !filePaths?.length) return { canceled: true };
    const win = windowMgr.getSettingsWindow();
    const emit = (p) => { if (win && !win.isDestroyed()) win.webContents.send('dict:progress', p); };
    try {
      await downloadDict(emit, filePaths[0]);
      ecdict.init();
      emit({ phase: 'done', message: '词典安装完成' });
      return { ok: true };
    } catch (e) {
      emit({ phase: 'error', message: e.message });
      return { ok: false, error: e.message };
    }
  });

  handleIpc('config:get', () => config.load());
  handleIpc('config:set', (_e, patch) => {
    const cfg = config.update(patch);
    hotkey.register(handleQuery, () =>
      windowMgr.showPopup({ kind: 'unknown', raw: '', loading: true })); // 热键热更新
    clipboardWatch.start(handleQuery);
    return cfg;
  });

  // 词汇量自测
  handleIpc('vocab:start', () => vocab.startTest());
  handleIpc('vocab:finish', (_e, answers) => vocab.finishTest(answers));
  handleIpc('vocab:level', () => vocab.currentLevel());

  handleIpc('review:due', () => {
    const words = db.dueWords(20);
    const ctxs = db.getRecentContexts(words.map((w) => w.word));
    // 复习卡同样贯彻理念：附英英释义（本地 SQLite 同步查询，毫秒级）+ 持久化的 LLM 简单释义
    return words.map((w) => {
      const ctx = ctxs.get(w.word);
      const en = buildEnDefinition(ecdict.lookup(w.word));
      return {
        word: w.word, phonetic: w.phonetic, definition: w.definition,
        note: w.note, history: ctx ? [ctx] : null,
        enDefinition: en ? { senses: en.senses, hard: en.hard, hints: en.hints } : null,
        simpleDef: (ctx && ctx.simple_def) || null,
      };
    });
  });
  handleIpc('review:answer', (_e, word, grade) => db.reviewWord(word, grade));
  handleIpc('review:count', () => db.dueCount());

  handleIpc('open-external', (_e, url) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) require('electron').shell.openExternal(url);
  });

  handleIpc('words:list', () => db.allWords(2000));
  handleIpc('words:recent', () => db.recentWords(12));
  handleIpc('words:remove', (_e, word) => db.removeWord(word));
  handleIpc('words:stats', () => ({ total: db.stats(), due: db.dueCount() }));
}

// ---------- 托盘 ----------

function trayIcon() {
  const p = path.join(__dirname, '..', 'assets', 'tray.png');
  if (fs.existsSync(p)) return nativeImage.createFromPath(p);
  // 兜底：1x1 透明
  return nativeImage.createEmpty();
}

function createTray() {
  tray = new Tray(trayIcon());
  const rebuild = () => {
    const menu = Menu.buildFromTemplate([
      { label: '查询剪贴板内容', click: () => handleQuery(clipboardText()) },
      { label: `今日复习（${db.dueCount()}）`, click: () => windowMgr.createReview() },
      { label: '设置', click: () => windowMgr.createSettings() },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() },
    ]);
    tray.setContextMenu(menu);
    tray.setToolTip('ReadPicks 拾词 — 划词查词');
  };
  rebuild();
  // 复习数量变化时刷新菜单（简单定时）
  setInterval(rebuild, 60 * 1000);
  tray.on('click', () => windowMgr.createSettings());
}

function clipboardText() {
  return require('electron').clipboard.readText();
}

// ---------- 生命周期 ----------

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => windowMgr.createSettings());

  app.whenReady().then(() => {
    db.init();
    ecdict.init();
    context.init(); // 加载上次复制的语境句子
    registerIpc();
    createTray();
    windowMgr.createPopup(); // 预创建悬浮窗，热键首次触发零等待
    const ok = hotkey.register(handleQuery, () =>
      windowMgr.showPopup({ kind: 'unknown', raw: '', loading: true }));
    if (!ok) console.warn('[hotkey] 注册失败，可能与其他应用冲突');
    hotkey.setWatchSync((t) => clipboardWatch.sync(t));
    clipboardWatch.start(handleQuery);
    console.log('[readpicks] ready. hotkey =', config.load().hotkey, '| dict installed =', ecdict.isInstalled());
  });

  app.on('window-all-closed', (e) => {
    // 托盘常驻，不退出
  });
  app.on('before-quit', () => hotkey.unregister());
}
