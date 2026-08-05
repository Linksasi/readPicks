// UIA 取词集成测试：验证常驻 PowerShell 命令通道 + UIA 脚本执行 + 回退逻辑
// npx electron scripts/uia-test.js
const { app } = require('electron');

app.whenReady().then(async () => {
  const hotkey = require('../main/hotkey');
  try {
    // 1. 命令通道：向常驻 PowerShell 发一条简单命令并取回输出
    const out = await hotkey.sendCommand(`[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Output 'hello-tranen'`);
    if (!out.includes('hello-tranen')) throw new Error(`命令通道异常: ${JSON.stringify(out)}`);
    console.log('PASS 命令通道（常驻 PowerShell 往返）');

    // 2. UIA 脚本加载并执行（无选中文本时 ok=true / selected 空，或 ok=false 均合法）
    const r = await hotkey.grabViaUia();
    console.log('PASS UIA 执行结果:', JSON.stringify(r));
    if (r && !Array.isArray(r.selected) && typeof r.selected !== 'string') {
      throw new Error('UIA 返回结构异常');
    }

    // 3. grabSelection 不崩溃（当前环境无选中文本 → UIA 空 → 回退剪贴板 → 空）
    const picked = await hotkey.grabSelection();
    console.log('PASS grabSelection 回退链路:', JSON.stringify(picked));

    console.log('UIA TEST DONE');
  } catch (e) {
    console.error('UIA TEST FAIL:', e.message);
    process.exitCode = 1;
  }
  app.exit(0);
});
