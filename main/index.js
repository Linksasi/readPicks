const { app, ipcMain, Tray, Menu, dialog, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

const config = require('./config');
const db = require('./db');
const ecdict = require('./ecdict');
const translate = require('./translate');
const hotkey = require('./hotkey');
const clipboardWatch = require('./clipboard-watch');
const context = require('./context');
const windowMgr = require('./window');
const { downloadDict } = require('../scripts/download-dict');

let tray = null;

// ---------- 查询管线 ----------

async function handleQuery(raw) {
  const text = hotkey.cleanText(raw);
  if (!text) return null;
  context.push(text);
  const kind = hotkey.classify(text);
  // 立即弹出「查询中」窗口，查询在后台进行（感知零延迟）
  windowMgr.showPopup({ kind, raw: text, loading: true });
  const payload = kind === 'word' ? await lookupWord(text) : await translateText(text);
  windowMgr.showPopup(payload);
  return payload;
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
      payload.words = ctx.words || [];
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

function registerIpc() {
  ipcMain.handle('query', (_e, text) => handleQuery(text));

  ipcMain.on('popup:hide', () => windowMgr.hidePopup());
  ipcMain.on('popup:pin', (_e, v) => windowMgr.setPinned(!!v));

  ipcMain.handle('open-settings', () => windowMgr.createSettings());

  ipcMain.handle('note:set', (_e, word, note) => { db.setNote(word, note); return true; });

  ipcMain.handle('export-anki', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: '导出 Anki 生词本',
      defaultPath: path.join(app.getPath('documents'), 'TranEn-生词本.txt'),
      filters: [{ name: 'Anki 文本', extensions: ['txt'] }],
    });
    if (canceled || !filePath) return { canceled: true };
    const count = db.exportAnki(filePath);
    return { ok: true, count, filePath };
  });

  ipcMain.handle('dict:status', () => {
    const p = ecdict.DB_PATH();
    return {
      installed: ecdict.isInstalled(),
      path: p,
      exists: fs.existsSync(p),
      sizeMB: fs.existsSync(p) ? Math.round(fs.statSync(p).size / 1048576) : 0,
    };
  });

  ipcMain.handle('dict:download', async () => {
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

  ipcMain.handle('dict:install-file', async () => {
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

  ipcMain.handle('config:get', () => config.load());
  ipcMain.handle('config:set', (_e, patch) => {
    const cfg = config.update(patch);
    hotkey.register(handleQuery, () =>
      windowMgr.showPopup({ kind: 'unknown', raw: '', loading: true })); // 热键热更新
    clipboardWatch.start(handleQuery);
    return cfg;
  });

  ipcMain.handle('review:due', () => db.dueWords(20).map((w) => ({
    word: w.word, phonetic: w.phonetic, definition: w.definition,
    note: w.note, history: db.getHistory(w.word, 1)[0] || null,
  })));
  ipcMain.handle('review:answer', (_e, word, grade) => db.reviewWord(word, grade));
  ipcMain.handle('review:count', () => db.dueCount());

  ipcMain.handle('open-external', (_e, url) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) require('electron').shell.openExternal(url);
  });

  ipcMain.handle('words:list', () => db.allWords(2000));
  ipcMain.handle('words:recent', () => db.recentWords(12));
  ipcMain.handle('words:remove', (_e, word) => db.removeWord(word));
  ipcMain.handle('words:stats', () => ({ total: db.stats(), due: db.dueCount() }));
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
    tray.setToolTip('TranEn 划词查词');
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
    registerIpc();
    createTray();
    windowMgr.createPopup(); // 预创建悬浮窗，热键首次触发零等待
    const ok = hotkey.register(handleQuery, () =>
      windowMgr.showPopup({ kind: 'unknown', raw: '', loading: true }));
    if (!ok) console.warn('[hotkey] 注册失败，可能与其他应用冲突');
    hotkey.setWatchSync((t) => clipboardWatch.sync(t));
    clipboardWatch.start(handleQuery);
    console.log('[tranen] ready. hotkey =', config.load().hotkey, '| dict installed =', ecdict.isInstalled());
  });

  app.on('window-all-closed', (e) => {
    // 托盘常驻，不退出
  });
  app.on('before-quit', () => hotkey.unregister());
}
