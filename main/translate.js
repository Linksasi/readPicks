const crypto = require('crypto');
const { load } = require('./config');

const TIMEOUT = 15000;

// 在线翻译结果缓存（10 分钟），避免反复请求同一文本；上限 200 条，超限淘汰最旧
const cache = new Map();
const CACHE_TTL = 10 * 60 * 1000;
const CACHE_MAX = 200;
function withCache(fn) {
  return async function (...args) {
    const key = `${fn.name}:${JSON.stringify(args)}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.value;
    const value = await fn.apply(this, args);
    cache.set(key, { value, ts: Date.now() });
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value); // Map 按插入序，淘汰最旧
    return value;
  };
}

async function fetchJson(url, options = {}, timeout = TIMEOUT) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** 整句/文本翻译。provider 为空则用配置默认。返回 { translation } */
async function translateSentence(text, providerName) {
  const cfg = load();
  const name = providerName || cfg.provider;
  if (name === 'none') throw new Error('翻译已禁用（设置中选择仅本地词典）');
  const p = cfg.providers[name];
  if (name !== 'mymemory' && !p) throw new Error(`未知翻译源: ${name}`);

  switch (name) {
    case 'mymemory': return mymemory(text);
    case 'youdao': return youdao(text, p);
    case 'baidu': return baidu(text, p);
    case 'deepl': return deepl(text, p);
    case 'llm': return llm(text, p, false, 'translate');
    default: throw new Error(`未知翻译源: ${name}`);
  }
}

/** LLM 语境查询：返回 { sentence_translation, word_in_sentence, explain, words[] } */
async function lookupInContext(word, sentence, providerName) {
  const cfg = load();
  const name = providerName || cfg.provider;
  const p = cfg.providers[name];
  if (name !== 'llm' || !p?.apiKey) {
    // 非 LLM：只做整句翻译
    const { translation } = await translateSentence(sentence, name);
    return { sentence_translation: translation, word_in_sentence: null, explain: null, usage: null, words: [], simpleDef: null, source: 'translate' };
  }
  const res = await llm(word + '\n' + sentence, p, true, 'lookup');
  const data = extractJson(res) || {};
  return {
    sentence_translation: data.sentence_translation || null,
    word_in_sentence: data.translation || data.word_in_sentence || null,
    explain: data.explain || null,
    usage: data.usage || null,
    words: Array.isArray(data.words) ? data.words : [],
    simpleDef: data.simple_def || data.simpleDef || null,
    source: 'llm',
  };
}

// ---------- LLM 文本清洗 ----------

/** 剥离 <think> 推理块与 ```json 代码围栏，返回干净的文本 */
function cleanLlmText(text) {
  let t = String(text || '');
  // 反复剥离 <think>...</think>（兼容嵌套）；deepseek-reasoner 类模型强制输出推理块
  while (/<think>[\s\S]*?<\/think>/i.test(t)) t = t.replace(/<think>[\s\S]*?<\/think>/gi, '');
  t = t.replace(/```(?:json)?/gi, '').replace(/```/g, ''); // 代码围栏
  return t.trim();
}

/**
 * 从 LLM 返回中提取 JSON：整体解析失败则取「最后一个」{...} 片段。
 * think 块已剥离，其中夹杂的示例 JSON 不再干扰；真实返回通常是最后的 JSON 对象。
 */
function extractJson(text) {
  const t = cleanLlmText(text);
  try { return JSON.parse(t); } catch { /* fallthrough */ }
  const start = t.lastIndexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(t.slice(start, end + 1)); } catch { /* 返回 null */ }
  }
  return null;
}

// ---------- providers ----------

async function mymemory(text) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|zh-CN`;
  const data = await fetchJson(url);
  const t = data?.responseData?.translatedText;
  if (!t) throw new Error('MyMemory 无返回（可能超限）');
  return { translation: t };
}

async function youdao(text, p) {
  if (!p.appKey || !p.appSecret) throw new Error('有道需要 appKey/appSecret（设置中填写）');
  const salt = String(Date.now());
  const curtime = String(Math.floor(Date.now() / 1000));
  const sign = crypto.createHash('sha256')
    .update(p.appKey + text + salt + curtime + p.appSecret).digest('hex');
  const body = new URLSearchParams({
    q: text, from: 'auto', to: 'zh-CHS',
    appKey: p.appKey, salt, sign, signType: 'v3', curtime,
  });
  const data = await fetchJson('https://openapi.youdao.com/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (data.errorCode !== '0') throw new Error(`有道错误码 ${data.errorCode}`);
  return { translation: data.translation?.[0] || '' };
}

async function baidu(text, p) {
  if (!p.appId || !p.appKey) throw new Error('百度需要 appId/appKey（设置中填写）');
  const salt = String(Date.now());
  const sign = crypto.createHash('md5')
    .update(p.appId + text + salt + p.appKey).digest('hex');
  const body = new URLSearchParams({
    q: text, from: 'auto', to: 'zh', appid: p.appId, salt, sign,
  });
  const data = await fetchJson('https://fanyi-api.baidu.com/api/trans/vip/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (data.error_code) throw new Error(`百度错误码 ${data.error_code}`);
  return { translation: data.trans_result?.map((r) => r.dst).join('；') || '' };
}

async function deepl(text, p) {
  if (!p.apiKey) throw new Error('DeepL 需要 apiKey（设置中填写）');
  const host = p.free ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
  const body = new URLSearchParams({ text, target_lang: 'ZH' });
  const data = await fetchJson(`${host}/v2/translate`, {
    method: 'POST',
    headers: { Authorization: `DeepL-Auth-Key ${p.apiKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  return { translation: data.translations?.[0]?.text || '' };
}

// 句译专用 prompt：查词模板（要求返回查词 JSON）会把句译带偏（如反问"要查哪个词"），必须独立
const TRANSLATE_PROMPT =
  '你是专业英语翻译。用户给你一段英文文本，请只输出对应的简体中文翻译：' +
  '不要解释、不要 JSON、不要 Markdown 标记、不要输出思考过程，翻译之外不要有任何内容。';

async function llm(text, p, wantJson = false, task = 'lookup') {
  if (!p.apiKey) throw new Error('LLM 需要 apiKey（设置中填写）');
  const base = String(p.baseUrl || '').replace(/\/+$/, '');
  let sys = p.systemPrompt || '你是英语学习助手，输出 JSON。';
  if (task === 'translate') {
    sys = TRANSLATE_PROMPT; // 句译：覆盖查词模板
  } else {
    // 查词/释义：追加约束，避免 <think> 推理块污染 JSON 解析
    sys += '\n\n直接输出要求的 JSON，不要输出任何思考过程、解释或 Markdown 代码块。';
  }
  // 已测词汇量 → 注入用词难度约束（只影响解释类任务，不影响整句翻译）
  try {
    const vl = load().vocabLevel;
    if (vl && vl.score) {
      sys += `\n\n【重要】用户的英语词汇量约为 ${vl.score}（CEFR ${vl.cefr}）。` +
        '请在解释、说明和 simple_def 中使用不超过该水平的简单英语词汇——' +
        '宁可换更简单的说法，不要使用生僻词；释义应像柯林斯词典那样用一句简单的英语（COBUILD 风格）写。' +
        '如果任务包含查词，请在返回 JSON 中额外提供 simple_def 字段：' +
        '用简单英语、一句话解释这个词在本句语境中的含义（不翻译成中文）。';
    }
  } catch { /* 配置读取失败则不加约束 */ }
  const body = {
    model: p.model || 'deepseek-chat',
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: text },
    ],
    temperature: 0.3,
  };
  if (wantJson) body.response_format = { type: 'json_object' };
  const data = await fetchJson(`${base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${p.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error(`LLM 无返回：${data?.error?.message || ''}`);
  if (wantJson) return content;
  // 句译：清洗 think/围栏；若模型仍按 JSON 包装返回则解出 translation
  const clean = cleanLlmText(content);
  const wrapped = extractJson(clean);
  if (wrapped && typeof wrapped.translation === 'string') return { translation: wrapped.translation };
  return { translation: clean };
}

/** 单独生成某个词的简单英语释义（LLM，COBUILD 风格一句话）。返回 { simpleDef } 或 null */
async function simpleDefinition(word) {
  const cfg = load();
  const p = cfg.providers.llm;
  if (!p?.apiKey) return null;
  const res = await llm(
    '请用一句简单的英语解释这个单词（不要翻译成中文），按 JSON 返回：{"simple_def":"..."}\n' + word,
    p,
    true,
    'lookup'
  );
  const data = extractJson(res) || {};
  const def = data.simple_def || data.simpleDef || data.translation || null;
  return def ? { simpleDef: String(def) } : null;
}

module.exports = {
  translateSentence: withCache(translateSentence),
  lookupInContext: withCache(lookupInContext),
  simpleDefinition: withCache(simpleDefinition),
};
