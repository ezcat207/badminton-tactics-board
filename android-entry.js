(function () {
  'use strict';
  var canvas = document.getElementById('game'), storageKey = 'badminton-strategy.profile.v1', profile;
  var helpStorageKey = 'badminton-strategy.footwork-help.v1', footworkHelpDismissed = false;
  if (!window.BadmintonEngine || !window.BadmintonView) {
    canvas.outerHTML = $t('<p id="fallback">游戏资源未完整加载。请重新安装安装包，或更新 Android 系统 WebView。</p>'); return;
  }
  try { profile = JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch (ignored) {}
  try { footworkHelpDismissed = localStorage.getItem(helpStorageKey) === 'true'; } catch (ignored) {}
  var match = BadmintonEngine.createMatch({ seed: 1234, profile: profile });
  function viewport() { return { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight, pixelRatio: devicePixelRatio || 1, topInset: 0, rightInset: 0, bottomInset: 0, leftInset: 0 }; }
  function point(event) { var r = canvas.getBoundingClientRect(); return { x: event.clientX - r.left, y: event.clientY - r.top }; }
  function listen(name, callback) { canvas.addEventListener(name, callback); return function () { canvas.removeEventListener(name, callback); }; }
  var size = viewport();
  window.badmintonMatch = match;
  window.badmintonGame = BadmintonView.mount({
    canvas: canvas, match: match, width: size.width, height: size.height, pixelRatio: size.pixelRatio, chooseTimeMode: true,
    footworkHelpDismissed: footworkHelpDismissed,
    onFootworkHelpDismissedChange: function (value) { try { localStorage.setItem(helpStorageKey, value ? 'true' : 'false'); } catch (ignored) {} },
    requestFrame: requestAnimationFrame.bind(window), cancelFrame: cancelAnimationFrame.bind(window),
    onProfileChange: function (value) { try { localStorage.setItem(storageKey, JSON.stringify(value)); } catch (ignored) {} },
    onSuspend: function (callback) {
      var hidden = function () { if (document.hidden) callback(); };
      document.addEventListener('visibilitychange', hidden); window.addEventListener('badminton-native-pause', callback); window.addEventListener('blur', callback);
      return function () { document.removeEventListener('visibilitychange', hidden); window.removeEventListener('badminton-native-pause', callback); window.removeEventListener('blur', callback); };
    },
    onPointer: function (callback) { return listen('pointerdown', function (event) { if (event.isPrimary === false) return; try { canvas.setPointerCapture(event.pointerId); } catch (ignored) {} callback(point(event)); }); },
    onPointerMove: function (callback) { return listen('pointermove', function (event) { if (event.isPrimary !== false) callback(point(event)); }); },
    onPointerUp: function (callback) {
      var up = function (event) { if (event.isPrimary !== false) callback(point(event)); }, cancel = function () { callback(); };
      canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', cancel); canvas.addEventListener('lostpointercapture', cancel);
      return function () { canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', cancel); canvas.removeEventListener('lostpointercapture', cancel); };
    },
    onResize: function (callback) { var resized = function () { callback(viewport()); }; window.addEventListener('resize', resized); return function () { window.removeEventListener('resize', resized); }; }
  });
  console.log('BADMINTON_READY ' + match.getView().phase);
}());
