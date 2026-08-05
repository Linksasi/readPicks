const { BrowserWindow, screen } = require('electron');
const path = require('path');

// 悬浮窗：无边框置顶、跟随鼠标、失焦隐藏、可钉住
let popup = null;
let settingsWin = null;
let reviewWin = null;
let pinned = false;

function preloadPath() {
  return path.join(__dirname, '..', 'preload.js');
}

function createPopup() {
  if (popup) return popup;
  popup = new BrowserWindow({
    width: 470,
    height: 580,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: true,
    backgroundColor: '#00000000',
    webPreferences: { preload: preloadPath(), contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  popup.setAlwaysOnTop(true, 'screen-saver');
  popup.loadFile(path.join(__dirname, '..', 'renderer', 'popup.html'));
  popup.on('blur', () => {
    if (pinned) return;
    if (Date.now() - (popup._shownAt || 0) > 400) popup.hide();
  });
  popup.on('closed', () => { popup = null; });
  return popup;
}

/** 在鼠标附近显示悬浮窗并发送查询结果 */
function showPopup(payload) {
  const win = createPopup();
  const [w, h] = win.getSize();
  const pt = screen.getCursorScreenPoint();
  const wa = screen.getDisplayNearestPoint(pt).workArea;
  // 默认鼠标右下方，越界则翻转到左侧/上方
  let x = pt.x + 14;
  let y = pt.y + 14;
  if (x + w > wa.x + wa.width) x = pt.x - w - 14;
  if (y + h > wa.y + wa.height) y = pt.y - h - 14;
  x = Math.max(wa.x, Math.min(x, wa.x + wa.width - w));
  y = Math.max(wa.y, Math.min(y, wa.y + wa.height - h));
  win.setPosition(Math.round(x), Math.round(y));
  win._shownAt = Date.now();
  win.webContents.send('lookup-result', payload);
  win.showInactive(); // 不抢焦点，不打断阅读
}

function setPinned(v) {
  pinned = !!v;
}

function isPinned() {
  return pinned;
}

function hidePopup() {
  if (popup && popup.isVisible()) popup.hide();
}

function getPopup() {
  return popup;
}

function createSettings() {
  if (settingsWin) { settingsWin.show(); settingsWin.focus(); return settingsWin; }
  settingsWin = new BrowserWindow({
    width: 560,
    height: 700,
    title: 'TranEn 设置',
    autoHideMenuBar: true,
    webPreferences: { preload: preloadPath(), contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  settingsWin.loadFile(path.join(__dirname, '..', 'renderer', 'settings.html'));
  settingsWin.on('closed', () => { settingsWin = null; });
  return settingsWin;
}

function getSettingsWindow() {
  return settingsWin;
}

function createReview() {
  if (reviewWin) { reviewWin.show(); reviewWin.focus(); return reviewWin; }
  reviewWin = new BrowserWindow({
    width: 500,
    height: 380,
    title: 'TranEn 今日复习',
    autoHideMenuBar: true,
    webPreferences: { preload: preloadPath(), contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  reviewWin.loadFile(path.join(__dirname, '..', 'renderer', 'review.html'));
  reviewWin.on('closed', () => { reviewWin = null; });
  return reviewWin;
}

module.exports = { createPopup, showPopup, hidePopup, setPinned, isPinned, getPopup, getSettingsWindow, createSettings, createReview };
