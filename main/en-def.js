// 英英释义构建（查词/复习/同步端点共用）：WordNet 义项拆分 + 按用户词汇水平标注难词 + 就地化解提示。
// 独立成模块：main/index.js 与 main/sync.js 都要用（后者为手机端 /api/lookup 服务），避免循环依赖。
const ecdict = require('./ecdict');
const vocab = require('./vocabtest');

/**
 * @returns {object|null} { senses, hard, hints, vocabLevel } — 未测词汇量或词典无英文释义时返回 null
 */
function buildEnDefinition(dict) {
  const lvl = vocab.currentLevel();
  if (!lvl || !lvl.score || !dict || !dict.definition) return null;
  const { maxBnc } = vocab.levelInfo(lvl.score);
  const { hard } = vocab.annotateHardWords(dict.definition, maxBnc);
  return {
    senses: ecdict.parseDefinition(dict.definition),
    hard,
    hints: vocab.hardWordHints(hard),
    vocabLevel: { score: lvl.score, cefr: lvl.cefr },
  };
}

module.exports = { buildEnDefinition };
