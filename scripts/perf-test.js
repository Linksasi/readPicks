// 取词耗时验证：常驻 PowerShell 进程是否生效
// npx electron scripts/perf-test.js
const { app } = require('electron');
const hotkey = require('../main/hotkey');

app.whenReady().then(async () => {
  // 预热：首次调用会启动常驻进程（不算入对比）
  let t0 = Date.now();
  await hotkey.grabSelection();
  const first = Date.now() - t0;
  console.log('首次 grabSelection（含 PowerShell 进程启动）:', first, 'ms');

  t0 = Date.now();
  await hotkey.grabSelection();
  const second = Date.now() - t0;
  console.log('再次 grabSelection（进程已常驻）:', second, 'ms');

  t0 = Date.now();
  await hotkey.grabSelection();
  const third = Date.now() - t0;
  console.log('第三次 grabSelection:', third, 'ms');

  console.log('常驻生效后每次取词节省约:', first - second, 'ms');
  app.exit(0);
});
