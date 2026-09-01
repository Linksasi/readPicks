// DevTools 驱动：在模拟器 WebView 里执行 JS（诊断/测试用）
// 需先 adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
// 用法：node scripts/rp-eval.js "<js expression>"
const expr = process.argv[2];
if (!expr) { console.error('usage: node rp-eval.js "<js expression>"'); process.exit(1); }

const timer0 = setTimeout(() => { console.error('timeout'); process.exit(2); }, 15000);

fetch('http://127.0.0.1:9222/json/list')
  .then((r) => r.json())
  .then((targets) => {
    const page = targets.find((t) => t.type === 'page');
    if (!page) throw new Error('no page target');
    return page.webSocketDebuggerUrl;
  })
  .then((url) => new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onopen = () => {
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } }));
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === 1) {
        if (msg.result && msg.result.exceptionDetails) {
          console.log('EXCEPTION:', JSON.stringify(msg.result.exceptionDetails.exception || msg.result.exceptionDetails, null, 1));
        } else {
          console.log(JSON.stringify(msg.result.result.value, null, 1));
        }
        ws.close();
        resolve();
      }
    };
    ws.onerror = () => reject(new Error('ws error'));
  }))
  .then(() => { clearTimeout(timer0); process.exit(0); })
  .catch((e) => { console.error('FAIL:', e.message); process.exit(3); });
