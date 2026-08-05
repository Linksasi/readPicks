const { clipboard } = require('electron');
const hotkey = require('./hotkey');
const { load } = require('./config');

// 可选「复制即弹」：轮询剪贴板，文本变化且非自身模拟操作时回调。
// 默认关闭；开启后用户在任意应用 Ctrl+C 复制 → 弹查询。

let timer = null;
let last = '';

function sync(text) {
  last = text;
}

function start(onText) {
  stop();
  last = clipboard.readText();
  timer = setInterval(() => {
    if (!load().autoPopup) return;
    if (hotkey.isBusy()) return; // 防递归：自身模拟复制期间跳过
    const t = clipboard.readText();
    if (t && t !== last) {
      last = t;
      onText(t);
    }
  }, 800);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, sync };
