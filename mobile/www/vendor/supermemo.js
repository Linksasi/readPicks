// mobile/www/vendor/supermemo.js — SM-2 算法（内嵌自 npm supermemo@2.0.23，MIT）
// PC 端与手机端必须用同一实现，复习状态跨端一致
(function (global) {
  'use strict';
  function supermemo(item, grade) {
    let nextInterval;
    let nextRepetition;
    let nextEfactor;
    if (grade >= 3) {
      if (item.repetition === 0) {
        nextInterval = 1;
        nextRepetition = 1;
      } else if (item.repetition === 1) {
        nextInterval = 6;
        nextRepetition = 2;
      } else {
        nextInterval = Math.round(item.interval * item.efactor);
        nextRepetition = item.repetition + 1;
      }
    } else {
      nextInterval = 1;
      nextRepetition = 0;
    }
    nextEfactor = item.efactor + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02));
    if (nextEfactor < 1.3) nextEfactor = 1.3;
    return { interval: nextInterval, repetition: nextRepetition, efactor: nextEfactor };
  }
  global.supermemo = supermemo;
})(window);
