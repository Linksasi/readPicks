const { app } = require('electron');
const fs = require('fs');
const path = require('path');

// 数据目录固定为 %APPDATA%/tran-en，不依赖 app.name 解析
// （electron scripts/xxx.js 等入口方式下 app.name 可能为 "Electron"，导致数据错位）
const APP_DIR = 'tran-en';
let dataDir = null;

function getDataDir() {
  if (!dataDir) {
    dataDir = path.join(app.getPath('appData'), APP_DIR);
  }
  return dataDir;
}

const configPath = () => path.join(getDataDir(), 'config.json');

const DEFAULTS = {
  hotkey: 'Alt+Q',
  autoCopy: true,          // 热键触发时自动模拟 Ctrl+C 抓取选中内容
  autoPopup: false,        // 监听剪贴板变化自动弹窗（划词即弹）
  provider: 'mymemory',    // mymemory | youdao | baidu | deepl | llm | none
  providers: {
    youdao: { appKey: '', appSecret: '' },
    baidu: { appId: '', appKey: '' },
    deepl: { apiKey: '', free: true },
    llm: {
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: '',
      model: 'deepseek-chat',
      systemPrompt:
        '你是英语学习助手。用户给出一个英语单词和它所在的句子，请返回严格 JSON：' +
        '{"phonetic":"","translation":"该单词在本句中的含义，中文","explain":"一句话解释为什么在这里这么译",' +
        '"usage":"该词在此句中的用法说明，中文，包含词性、搭配、语法角色，一到两句话",' +
        '"sentence_translation":"整句中文翻译","words":[{"word":"句中其他值得学习的单词","meaning":"中文含义"}]}',
    },
  },
  dict: {
    enabled: true,
  },
};

let cache = null;

function getConfigPath() {
  return configPath();
}

function load() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    cache = deepMerge(structuredClone(DEFAULTS), JSON.parse(raw));
  } catch {
    cache = structuredClone(DEFAULTS);
  }
  return cache;
}

function save(cfg) {
  cache = cfg;
  fs.mkdirSync(getDataDir(), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf8');
}

function update(patch) {
  const cfg = deepMerge(load(), patch);
  save(cfg);
  return cfg;
}

function deepMerge(base, patch) {
  if (Array.isArray(base) || Array.isArray(patch)) return patch ?? base;
  if (patch && typeof patch === 'object' && base && typeof base === 'object') {
    const out = { ...base };
    for (const k of Object.keys(patch)) {
      out[k] = deepMerge(base[k], patch[k]);
    }
    return out;
  }
  return patch ?? base;
}

module.exports = { load, save, update, getConfigPath, getDataDir, DEFAULTS };
