// mobile/www/boot.js — 启动诊断（最先加载，ES5 语法确保任何 WebView 都能运行）
// 职责：1) 未捕获错误上屏（白屏自诊断） 2) WebView 过旧探测提示 3) UUID 回退（randomUUID 需 Chrome 92+）
(function () {
  function show(text) {
    var box = document.getElementById('boot-error');
    if (!box) {
      try { window.alert('拾词启动出错：' + text); } catch (e2) { /* 忽略 */ }
      return;
    }
    box.textContent = '拾词：' + text;
    box.classList.remove('hidden');
  }

  window.addEventListener('error', function (e) {
    // 资源加载错误（img/script）不走这里的核心分支
    if (e && e.target && e.target.tagName) return;
    var msg = (e && e.message) || '脚本错误';
    show(msg + (e && e.lineno ? ('（第 ' + e.lineno + ' 行）') : '') + '。若反复出现，请到应用市场更新「Android System WebView」');
  });

  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    show('Promise 错误：' + ((r && r.message) || r || '未知'));
  });

  // WebView 新旧探测：randomUUID 于 Chrome 92（2020-07）引入
  window.addEventListener('load', function () {
    var modern = window.crypto && typeof window.crypto.randomUUID === 'function';
    if (!modern) show('检测到 WebView 版本较旧（Chrome < 92），建议到应用市场更新「Android System WebView」以获得最佳体验');
  });

  // UUID v4：randomUUID 不可用时回退（getRandomValues → Math.random）
  window.rpuuid = function () {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      try { return window.crypto.randomUUID(); } catch (e) { /* 非安全上下文，继续走回退 */ }
    }
    var b = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(b);
    } else {
      for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    }
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var hex = '';
    for (var j = 0; j < 16; j++) hex += (b[j] + 256).toString(16).slice(1);
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  };
})();
