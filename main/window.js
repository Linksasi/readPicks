const { BrowserWindow, screen } = require('electron');
const path = require('path');

// 悬浮窗：无边框置顶、跟随鼠标、失焦隐藏、可钉住
let popup = null;
let settingsWin = null;
let reviewWin = null;
let pinned = false;
let busy = false; // 查询进行中：结果未出前禁止自动隐藏（blur/mouseleave），避免"等结果时窗口消失"
let busyTimer = null; // 查询悬挂兜底：20s 后自动复位 busy

// 用户拖拽窗口后 2 秒内抑制自动隐藏（blur / mouseleave），避免"拖完窗口马上消失"
const DRAG_SUPPRESS_MS = 2000;
function recentUserDrag(win) {
  return Date.now() - (win._lastUserMoveAt || 0) < DRAG_SUPPRESS_MS;
}

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
    webPreferences: { preload: preloadPath(), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  popup.setAlwaysOnTop(true, 'screen-saver');
  popup.loadFile(path.join(__dirname, '..', 'renderer', 'popup.html'));
  // 窗口移动：区分「程序定位」（showPopup 的 setPosition，吞掉）与「用户拖拽」（记录时间）
  popup.on('move', () => {
    const now = Date.now();
    popup._lastMoveAt = now;
    if (popup._programmaticMove) popup._programmaticMove = false;
    else popup._lastUserMoveAt = now;
  });
  popup.on('blur', () => {
    if (pinned || busy) return;
    if (Date.now() - (popup._shownAt || 0) > 400 && !recentUserDrag(popup)) popup.hide();
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
  // 标记本次移动为程序定位（move 事件异步触发，短暂保留标志吞掉它）
  popup._programmaticMove = true;
  win.setPosition(Math.round(x), Math.round(y));
  setTimeout(() => { popup._programmaticMove = false; }, 100);
  win._shownAt = Date.now();
  win.webContents.send('lookup-result', payload);
  win.showInactive(); // 不抢焦点，不打断阅读
}

function setPinned(v) {
  pinned = !!v;
}

/** 查询进行中标志：true 时悬浮窗不自动隐藏（等结果），false 恢复。
 *  兜底：查询悬挂（如取词失败无结果下发）时 20s 后自动复位，避免窗口永远不隐藏。 */
function setBusy(v) {
  busy = !!v;
  if (busyTimer) { clearTimeout(busyTimer); busyTimer = null; }
  if (busy) busyTimer = setTimeout(() => { busy = false; busyTimer = null; }, 20000);
}

function isPinned() {
  return pinned;
}

function hidePopup() {
  // 自动隐藏（blur / mouseleave）：拖拽刚结束时不执行，避免窗口凭空消失；查询中也不隐藏
  if (popup && popup.isVisible() && !recentUserDrag(popup) && !busy) popup.hide();
}

/** 主动关闭（关闭按钮 / Esc）：不受拖拽保护限制，总是生效 */
function forceHidePopup() {
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
    webPreferences: { preload: preloadPath(), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
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
    webPreferences: { preload: preloadPath(), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  reviewWin.loadFile(path.join(__dirname, '..', 'renderer', 'review.html'));
  reviewWin.on('closed', () => { reviewWin = null; });
  return reviewWin;
}

module.exports = { createPopup, showPopup, hidePopup, forceHidePopup, setPinned, setBusy, isPinned, getPopup, getSettingsWindow, createSettings, createReview };
