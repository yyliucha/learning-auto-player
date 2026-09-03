// ==UserScript==
// @name         AL 自检（30 秒排查用）
// @namespace    local.auto-learn
// @version      1.0.0
// @description  只做一件事：在目标页面运行并往 trace 日志写一条 [tm-selftest] 记录
// @match        *://*/*
// @run-at       document-end
// @grant        none
// @noframes
// ==/UserScript==

(function () {
  'use strict';
  try {
    const KEY = 'autoLearn.trace.' + location.hostname;
    let arr = [];
    try { arr = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) {}
    arr = arr.slice(-100);
    arr.push(new Date().toLocaleTimeString() + ' [tm-selftest] 运行了（' + location.href.slice(0, 80) + '）');
    localStorage.setItem(KEY, JSON.stringify(arr));
  } catch (e) {
    console.log('[tm-selftest] 写入失败：' + e.message);
  }
  console.log('[tm-selftest] OK ' + location.href);
})();
