// mobile/www/en-def.js — 英英释义工具（与 PC 端 ecdict.parseDefinition / vocabtest 同语义移植）
// 数据源是 mini 词典（词条 d=英文释义 b=bnc 词频排名），难词判定依赖同步来的 vocabLevel
// 全部包在 IIFE 里：经典脚本共享全局作用域，顶层 const 重复声明会直接 SyntaxError 白屏
'use strict';

(function () {
  const POS_SHORT = '(n|v|a|s|r|vt|vi|ad|u|c)';
  const POS_LABEL = {
    n: '名词', v: '动词', a: '形容词', s: '形容词', r: '副词',
    vt: '及物动词', vi: '不及物动词', ad: '副词', u: '感叹', c: '连词',
  };

/** ECDICT definition 字段 → [{pos, text}]：按行切 + 行内多义项二次切分，上限 8 条（与 PC 一致） */
function parseDefinition(def) {
  const lines = String(def || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const senses = [];
  for (const line of lines) {
    const parts = line.split(new RegExp(`\\s+(?=${POS_SHORT}\\.\\s)`));
    for (let part of parts) {
      part = part.trim();
      const m = part.match(new RegExp(`^${POS_SHORT}\\.?\\s+(.*)$`));
      senses.push(m ? { pos: m[1].toLowerCase(), text: m[2] } : { pos: '', text: part });
      if (senses.length >= 8) break;
    }
    if (senses.length >= 8) break;
  }
  return senses.map((s) => ({ pos: s.pos, text: String(s.text).slice(0, 140) }));
}

function toCefr(score) {
  if (score < 2000) return 'A1';
  if (score < 3500) return 'A2';
  if (score < 5000) return 'B1';
  if (score < 8000) return 'B2';
  if (score < 12000) return 'C1';
  return 'C2';
}

/** 词汇量 → 释义用词难度上限（bnc 排名），与 PC vocabtest.levelInfo 同式 */
function levelInfo(score) {
  const maxBnc = Math.max(1000, Math.min(40000, Math.round((score || 0) * 0.8)));
  return { cefr: toCefr(score || 0), maxBnc };
}

/** mini 词典里的 bnc：未收录 = -1（视为难词），收录无频 = 0（视为难词） */
function miniBnc(mini, word) {
  const e = mini && mini.words[word];
  return e ? (e.b || 0) : -1;
}

/** 标注释义文本中超出用户水平的难词（与 PC annotateHardWords 同语义） */
function annotateHardWords(defText, maxBnc, mini) {
  const words = String(defText || '').toLowerCase().match(/[a-z][a-z'-]{2,}/g) || [];
  const hard = new Set();
  for (const w of words) {
    const b = miniBnc(mini, w);
    if (b === -1 || b === 0 || b > maxBnc) hard.add(w);
  }
  return { hard: [...hard] };
}

/** ECDICT 释义第一个义项（WordNet 格式），用于难词浮层的英文简释 */
function firstSense(def) {
  const d = String(def || '').trim();
  if (!d) return '';
  const posRe = '(?:n|v|a|s|r|vt|vi|ad)\\.';
  const m = d.match(new RegExp(`^${posRe}\\s*(.*)$`, 's'));
  if (!m) return d.slice(0, 90);
  const nxt = m[1].match(new RegExp(`\\s+${posRe}\\s`));
  const sense = nxt ? m[1].slice(0, nxt.index) : m[1];
  return sense.trim().slice(0, 90);
}

/** 难词就地化解提示：mini 词典中文首义 + 英文首义 */
function hardWordHints(hardWords, mini) {
  return (hardWords || []).map((w) => {
    const e = mini && mini.words[w];
    if (!e) return { word: w, zh: '', en: '' };
    const tline = String(e.t || '').split('\n').map((s) => s.trim()).find(Boolean) || '';
    const tm = tline.match(/^[a-z]+\.\s*(.*)$/i);
    return { word: w, zh: (tm ? tm[1] : tline).slice(0, 60), en: firstSense(e.d) };
  });
}

/**
 * 由 mini 词典词条构建英英释义区数据（与 PC buildEnDefinition 同构）。
 * @returns {senses, hard, hints, vocabLevel} | null
 */
function buildEnDefinition(entry, vocabLevel, mini) {
  if (!entry || !entry.d) return null;
  const lvl = vocabLevel && vocabLevel.score ? vocabLevel : null;
  if (!lvl) {
    // 未测词汇量：只拆义项，不标难词（与 PC 行为一致）
    return { senses: parseDefinition(entry.d), hard: [], hints: [], vocabLevel: null };
  }
  const { maxBnc } = levelInfo(lvl.score);
  const { hard } = annotateHardWords(entry.d, maxBnc, mini);
  return {
    senses: parseDefinition(entry.d),
    hard,
    hints: hardWordHints(hard, mini),
    vocabLevel: { score: lvl.score, cefr: lvl.cefr },
  };
}

  window.rpend = { parseDefinition, toCefr, levelInfo, annotateHardWords, hardWordHints, firstSense, buildEnDefinition, POS_LABEL };
})();
