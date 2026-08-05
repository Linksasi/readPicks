const crypto = require('crypto');
const { load } = require('./config');

const TIMEOUT = 15000;

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
    case 'llm': return llm(text, p);
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
    return { sentence_translation: translation, word_in_sentence: null, explain: null, words: [], source: 'translate' };
  }
  const res = await llm(word + '\n' + sentence, p, true);
  let data = {};
  try {
    data = typeof res === 'string' ? JSON.parse(res) : res;
  } catch {
    const m = String(res).match(/\{[\s\S]*\}/);
    if (m) data = JSON.parse(m[0]);
  }
  return {
    sentence_translation: data.sentence_translation || null,
    word_in_sentence: data.translation || data.word_in_sentence || null,
    explain: data.explain || null,
    words: Array.isArray(data.words) ? data.words : [],
    source: 'llm',
  };
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

async function llm(text, p, wantJson = false) {
  if (!p.apiKey) throw new Error('LLM 需要 apiKey（设置中填写）');
  const base = String(p.baseUrl || '').replace(/\/+$/, '');
  const body = {
    model: p.model || 'deepseek-chat',
    messages: [
      { role: 'system', content: p.systemPrompt || '你是英语学习助手，输出 JSON。' },
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
  return wantJson ? content : { translation: content };
}

module.exports = { translateSentence, lookupInContext };
