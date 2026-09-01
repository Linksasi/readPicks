// mobile/www/vocab.js — 词汇量自测（与 PC 端 main/vocabtest.js 同算法移植）
// 分层抽样（6 个 bnc 频段 × 8 真词）+ 假词防作弊（12 个）+ 桶估计计分
// 数据源：mini 词典词条的 b 字段（bnc 词频排名）
'use strict';

(function () {
  const BUCKETS = [
    { lo: 1, hi: 1000, size: 1000, real: 8 },
    { lo: 1001, hi: 2000, size: 1000, real: 8 },
    { lo: 2001, hi: 4000, size: 2000, real: 8 },
    { lo: 4001, hi: 8000, size: 4000, real: 8 },
    { lo: 8001, hi: 15000, size: 7000, real: 8 },
    { lo: 15001, hi: 50000, size: 35000, real: 8 },
  ];

  // 预置假词池（与 PC 同一份，均已对照 ECDICT 校验过不存在）
  const FAKE_WORDS = [
    'worbly', 'flumness', 'prancify', 'crostion', 'blunderse',
    'dravelous', 'splotment', 'quernify', 'thwipish', 'ploritude',
    'vixible', 'froddle', 'clumberous', 'drepplet', 'brizzen',
    'glumph', 'snorkative', 'pliffer', 'crunge', 'draffly',
    'fumblet', 'snurble', 'drenchle', 'plobble', 'flomper',
  ];
  const FAKE_TOTAL = 12;

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /**
   * 生成一次测试：48 真词（按频段）+ 12 假词，混排。
   * @returns {{ok:true, total:number, items:Array<{word,bucketIdx,fake}>}|{ok:false,error:string}}
   * items 含真假标记，只留在 JS 内存里供计分，UI 只展示 word（与 PC 一致防作弊）
   */
  function start(mini) {
    if (!mini || !mini.words) return { ok: false, error: '离线词典未加载，稍后再试' };
    // 一遍扫描按频段分桶（真词：纯小写、3-14 位、有中文释义）
    const cand = BUCKETS.map(() => []);
    for (const [w, e] of Object.entries(mini.words)) {
      if (!e.b || !e.t || w.length < 3 || w.length > 14 || !/^[a-z]+$/.test(w)) continue;
      for (let i = 0; i < BUCKETS.length; i++) {
        const b = BUCKETS[i];
        if (e.b >= b.lo && e.b <= b.hi) { cand[i].push(w); break; }
      }
    }
    const items = [];
    cand.forEach((list, idx) => {
      shuffle(list);
      for (let i = 0; i < Math.min(BUCKETS[idx].real, list.length); i++) {
        items.push({ word: list[i], bucketIdx: idx, fake: false });
      }
    });
    if (items.length < 12) return { ok: false, error: '离线词典数据不足，请先在电脑端重新生成 mini 词典' };
    // 假词：mini 词典里查无此词的才可靠
    const fakes = shuffle(FAKE_WORDS.filter((w) => !mini.words[w])).slice(0, FAKE_TOTAL);
    for (const w of fakes) items.push({ word: w, bucketIdx: -1, fake: true });
    shuffle(items);
    return { ok: true, total: items.length, items };
  }

  function toCefr(score) {
    if (score < 2000) return 'A1';
    if (score < 3500) return 'A2';
    if (score < 5000) return 'B1';
    if (score < 8000) return 'B2';
    if (score < 12000) return 'C1';
    return 'C2';
  }

  /**
   * 桶估计计分（与 PC finishTest 同式）：每段通过率扣假词误认惩罚 × 段大小，累加。
   * @returns {{score, cefr, buckets, fakeKnown, takenAt}}
   */
  function finish(items, answers) {
    const perBucket = BUCKETS.map((b) => ({ ...b, knownReal: 0, realCount: 0 }));
    let fakeKnownTotal = 0;
    items.forEach((it, i) => {
      const known = !!answers[i];
      if (it.fake) {
        if (known) fakeKnownTotal++;
        return;
      }
      perBucket[it.bucketIdx].realCount++;
      if (known) perBucket[it.bucketIdx].knownReal++;
    });
    let score = 0;
    const buckets = [];
    for (const b of perBucket) {
      if (!b.realCount) continue; // 该频段没抽到词（数据缺失）不计
      const rate = Math.max(0, (b.knownReal - fakeKnownTotal / BUCKETS.length) / b.realCount);
      const est = Math.round(b.size * rate);
      score += est;
      buckets.push({ range: `${b.lo}-${b.hi}`, known: b.knownReal, total: b.realCount, rate: Math.round(rate * 100), estimated: est });
    }
    score = Math.min(score, 50000);
    return { score, cefr: toCefr(score), buckets, fakeKnown: fakeKnownTotal, takenAt: Date.now() };
  }

  window.rpvocab = { start, finish, toCefr };
})();
