// mobile/www/llm.js — LLM 直连客户端（外出/未配对时的简单释义与语境句译）
// 请求走 CapacitorHttp（APK 内原生层，不受 CORS 限制）；浏览器 PWA 回退 fetch（部分 API 域不支持跨域时不可用）
// 提示词与 PC 端 translate.js 同语义：简单释义 COBUILD 风格 + 词汇量水平注入
'use strict';

(function () {
  const CONFIG_KEY = 'rp-llm';

  function getConfig() {
    try { return JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}'); } catch { return {}; }
  }
  function saveConfig(patch) {
    localStorage.setItem(CONFIG_KEY, JSON.stringify({ ...getConfig(), ...patch }));
  }
  function isConfigured() {
    const c = getConfig();
    return !!(c.enabled && c.baseUrl && c.apiKey);
  }

  /** 单次 chat 请求：CapacitorHttp 原生优先，fetch 回退；20 秒超时。返回 content 字符串 */
  async function chat(baseUrl, apiKey, model, system, user) {
    const base = String(baseUrl || '').replace(/\/+$/, '');
    const body = {
      model: model || 'deepseek-chat',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.3,
    };
    const headers = { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' };

    const Http = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp;
    let content;
    if (Http && Http.request) {
      const res = await Http.request({
        url: base + '/chat/completions',
        method: 'POST',
        headers,
        data: body,
        connectTimeout: 20000,
        readTimeout: 30000,
      });
      content = res && res.data && res.data.choices && res.data.choices[0] && res.data.choices[0].message && res.data.choices[0].message.content;
    } else {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 30000);
      try {
        const r = await fetch(base + '/chat/completions', {
          method: 'POST', headers,
          body: JSON.stringify({ ...body, response_format: { type: 'json_object' } }),
          signal: ctrl.signal,
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const data = await r.json();
        content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      } finally {
        clearTimeout(timer);
      }
    }
    if (!content) throw new Error('LLM 无返回');
    return String(content);
  }

  /** 宽容 JSON 解析（清洗 think 块/围栏后取最后一个 {...}），与 PC extractJson 同语义 */
  function extractJson(text) {
    const t = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```(?:json)?/gi, '').trim();
    try { return JSON.parse(t); } catch { /* fallthrough */ }
    const start = t.lastIndexOf('{');
    const end = t.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { return JSON.parse(t.slice(start, end + 1)); } catch { return null; }
    }
    return null;
  }

  function levelClause(vocabLevel) {
    const lvl = vocabLevel && vocabLevel.score ? vocabLevel : null;
    if (!lvl) return '';
    return `\n\n【重要】用户的英语词汇量约为 ${lvl.score}（CEFR ${lvl.cefr}）。请用不超过该水平的简单英语词汇解释——宁可换更简单的说法，像柯林斯词典那样用一句简单的英语（COBUILD 风格）写。`;
  }

  /** 简单英语释义（一句话，不翻译成中文）。返回 { simpleDef } 或 null */
  async function simpleDefinition(word, vocabLevel) {
    const c = getConfig();
    if (!isConfigured()) return null;
    const sys = '你是英语学习助手。直接输出要求的 JSON，不要输出任何思考过程、解释或 Markdown 代码块。' + levelClause(vocabLevel);
    const user = '请用一句简单的英语解释这个单词（不要翻译成中文），按 JSON 返回：{"simple_def":"..."}\n' + word;
    const data = extractJson(await chat(c.baseUrl, c.apiKey, c.model, sys, user));
    const def = data && (data.simple_def || data.simpleDef || data.translation);
    return def ? { simpleDef: String(def) } : null;
  }

  /** 语境查询：整句翻译 + 该词在本句的译法。返回 { sentenceTranslation, wordInSentence } 或 null */
  async function lookupInContext(word, sentence, vocabLevel) {
    const c = getConfig();
    if (!isConfigured()) return null;
    const sys = '你是英语学习助手。用户给出一个英语单词和它所在的句子，直接输出严格 JSON，' +
      '不要思考过程、不要解释、不要 Markdown 代码块：' +
      '{"sentence_translation":"整句中文翻译","word_in_sentence":"该单词在本句中的含义，中文"}' +
      levelClause(vocabLevel);
    const data = extractJson(await chat(c.baseUrl, c.apiKey, c.model, sys, '单词：' + word + '\n句子：' + sentence));
    if (!data) return null;
    const st = data.sentence_translation || data.sentenceTranslation || '';
    const wis = data.word_in_sentence || data.wordInSentence || '';
    return (st || wis) ? { sentenceTranslation: st, wordInSentence: wis } : null;
  }

  window.rpllm = { getConfig, saveConfig, isConfigured, simpleDefinition, lookupInContext };
})();
