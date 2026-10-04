/* Minimal i18n runtime. Source strings are Chinese and double as lookup keys;
   English lives in i18n-en.js. Switching language reloads the page. */
(function (root) {
  'use strict';
  var KEY = 'badminton-strategy.lang', lang = 'zh', reverse = null, chosen = false;
  try {
    var saved = root.localStorage && root.localStorage.getItem(KEY);
    var nav = (root.navigator && (root.navigator.languages && root.navigator.languages[0] || root.navigator.language)) || 'zh';
    var query = /[?&]lang=(zh|en)\b/.exec(root.location && root.location.search || '');
    lang = query ? query[1] : saved === 'zh' || saved === 'en' ? saved : /^zh/i.test(nav) ? 'zh' : 'en';
    chosen = !!query || saved === 'zh' || saved === 'en';
  } catch (ignored) {}
  function dict() { return root.BADMINTON_I18N_EN || {}; }
  function format(text, args) { return args.length ? text.replace(/\{(\d+)\}/g, function (m, i) { return args[i] === undefined ? m : args[i]; }) : text; }
  function t(source) {
    var out = source;
    if (lang === 'en') { var hit = dict()[source]; if (hit !== undefined) out = hit; }
    return arguments.length > 1 ? format(out, Array.prototype.slice.call(arguments, 1)) : out;
  }
  // Translated text -> original Chinese (for code that matches on Chinese keywords).
  function zh(text) {
    if (lang === 'zh') return text;
    if (!reverse) { reverse = {}; var d = dict(); for (var k in d) reverse[d[k]] = k; }
    return reverse[text] === undefined ? text : reverse[text];
  }
  // Greedy line breaker: CJK breaks per character, Latin text breaks per word.
  function lines(measure, value, maxWidth) {
    var out = [], units = String(value || '').match(/\n|[　-〿一-鿿＀-￯]|[^\s　-〿一-鿿＀-￯]+\s*|\s+/g) || [], cur = '';
    units.forEach(function (u) {
      if (u === '\n') { out.push(cur); cur = ''; return; }
      if (!cur) { cur = u.replace(/^\s+/, ''); }
      else if (measure(cur + u.replace(/\s+$/, '')) <= maxWidth) cur += u;
      else { out.push(cur.replace(/\s+$/, '')); cur = u.replace(/^\s+/, ''); }
      while (cur.length > 1 && measure(cur.replace(/\s+$/, '')) > maxWidth) { // single overlong word
        var i = cur.length - 1; while (i > 1 && measure(cur.slice(0, i)) > maxWidth) i--;
        out.push(cur.slice(0, i)); cur = cur.slice(i);
      }
    });
    if (cur) out.push(cur.replace(/\s+$/, ''));
    return out;
  }
  function setLang(next) {
    if (next !== 'zh' && next !== 'en') return;
    try { root.localStorage.setItem(KEY, next); } catch (ignored) {}
    root.location.reload();
  }
  root.$t = t; root.$zh = zh; root.$lines = lines; root.$setLang = setLang;
  root.$lang = lang; root.$langChosen = chosen;
  if (root.document) {
    root.document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    root.document.title = t('羽毛球战术棋盘');
  }
}(typeof globalThis !== 'undefined' ? globalThis : this));
