const { clipboard } = require('electron');
const hotkey = require('./hotkey');
const context = require('./context');
const { load } = require('./config');

// 剪贴板监听双职责：
// 1. 始终记录复制内容到 context（供「语境句子」回溯——查词时自动找包含该词的句子）
// 2. autoPopup 开启时，复制内容变化 → 直接触发查询（复制即弹）

let timer = null;
let last = '';

function sync(text) {
  last = text;
}

function start(onText) {
  stop();
  last = clipboard.readText();
  timer = setInterval(() => {
    if (hotkey.isBusy()) return; // 防递归：自身模拟复制期间跳过
    const t = clipboard.readText();
    if (t && t !== last) {
      last = t;
      context.push(t); // 始终记录，供语境回溯
      if (load().autoPopup) onText(t);
    }
  }, 800);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, sync };
