// 手机端脚本顶层声明冲突检查：经典 <script> 共享全局作用域，
// 跨文件重复的顶层 const/let/function 声明会直接 SyntaxError 白屏（POS_LABEL 事故的防回归）
// 用法：node scripts/check-mobile-globals.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'mobile', 'www');
const FILES = ['boot.js', 'vendor/supermemo.js', 'en-def.js', 'llm.js', 'vocab.js', 'db.js', 'sync.js', 'app.js'];

// 粗略剥离字符串/注释/模板串，避免把内容里的 "const x" 误报
function stripNoise(src) {
  let out = '';
  let i = 0;
  let mode = null; // "'", '"', '`', '//', '/*'
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (mode === null) {
      if (c === "'" || c === '"' || c === '`') { mode = c; i++; continue; }
      if (c === '/' && next === '/') { mode = '//'; i += 2; continue; }
      if (c === '/' && next === '*') { mode = '/*'; i += 2; continue; }
      if (c === '/' && /(?:^|[\s(=,:[!&|?;{}])/.test(src.slice(Math.max(0, i - 3), i) + ' ')) { mode = '/'; i++; continue; } // 正则字面量（粗略）
      out += c; i++; continue;
    }
    if (mode === "'" && c === "'") mode = null;
    else if (mode === '"' && c === '"') mode = null;
    else if (mode === '`' && c === '`') mode = null;
    else if (mode === '//' && c === '\n') { mode = null; out += '\n'; }
    else if (mode === '/*' && c === '*' && next === '/') { mode = null; i += 2; continue; }
    else if (mode === '/' && c === '\\') i++;
    i++;
  }
  return out;
}

function topLevelDecls(src) {
  const names = new Map(); // name -> kind
  const lines = src.split('\n');
  for (const line of lines) {
    // 只认列 0 起始的声明（本项目风格：顶层声明不缩进；函数内声明必有缩进）
    if (!/^(?:const|let|function|class)\b/.test(line)) continue;
    let m;
    if ((m = line.match(/^(?:const|let)\s+([A-Za-z_$][\w$]*)/))) {
      names.set(m[1], 'const');
    } else if ((m = line.match(/^function\s+\*?\s*([A-Za-z_$][\w$]*)/))) {
      names.set(m[1], 'function');
    } else if ((m = line.match(/^class\s+([A-Za-z_$][\w$]*)/))) {
      names.set(m[1], 'class');
    }
  }
  return names;
}

const globals = new Map(); // name -> [{file, kind}]
for (const rel of FILES) {
  const file = path.join(ROOT, rel);
  const src = stripNoise(fs.readFileSync(file, 'utf8'));
  const decls = topLevelDecls(src);
  for (const [name, kind] of decls) {
    if (!globals.has(name)) globals.set(name, []);
    globals.get(name).push({ file: rel, kind });
  }
}

// 跨文件出现、且其中至少一个是 const/let/class → SyntaxError 白屏
// （同名 function 跨文件重复是合法的覆盖，不算）
const fatal = [...globals.entries()].filter(([name, sites]) => {
  const files = new Set(sites.map((s) => s.file));
  const hasConstLike = sites.some((s) => s.kind !== 'function');
  return files.size > 1 && hasConstLike;
});
void globals;

if (fatal.length) {
  console.error('发现跨文件顶层声明冲突（会白屏）:');
  for (const [name, sites] of fatal) {
    console.error(`  ${name}: ${sites.map((s) => `${s.file}(${s.kind})`).join(', ')}`);
  }
  process.exit(1);
}
console.log('OK：', FILES.length, '个脚本无跨文件顶层声明冲突');
