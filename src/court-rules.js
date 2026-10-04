(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BadmintonCourtRules = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  // BWF Laws 5.0 (2), in force 2025-04-26. The announced 3x15 system starts
  // 2027-01-04 and is deliberately NOT this ruleset. All dimensions are metres.
  var GEOMETRY = Object.freeze({ halfWidth: 2.59, halfLength: 6.70, singlesWidth: 5.18,
    courtLength: 13.40, doublesWidth: 6.10, lineWidth: 0.04,
    shortServiceDistance: 1.98, doublesLongServiceDistance: 5.94,
    netCentreHeight: 1.524, netPostHeight: 1.55, postHalfWidth: 3.05 });
  var RULES = Object.freeze({ asOf: '2026-09-30', effectiveDate: '2025-04-26', version: '5.0 (2)',
    pointsToWin: 21, cap: 30, winBy: 2, bestOf: 3, gamesToWin: 2,
    changeEndsDeciderAt: 11, intervalAt: 11, intervalSeconds: 60, betweenGamesSeconds: 120,
    serviceHeight: 1.15, futureScoringEffectiveDate: '2027-01-04' });
  // Explicit game approximations, not measurements or additional BWF rules.
  var MODEL = Object.freeze({ serviceShuttleTopOffset: 0.05, serviceFootMargin: 0.08,
    netHeightProfile: 'piecewise_linear_between_centre_and_doubles_posts' });
  var X = GEOMETRY.halfWidth, Y = GEOMETRY.halfLength, W = GEOMETRY.lineWidth, EPS = 1e-10;
  function finite(v) { return typeof v === 'number' && Number.isFinite(v); }
  function point(p) { return !!p && !Array.isArray(p) && finite(p.x) && finite(p.y); }
  function validWho(who) { return who === 'human' || who === 'ai'; }
  function validSide(side) { return side === 'right' || side === 'left'; }
  function validEnd(end) { return end === 'near' || end === 'far'; }
  function courtEnd(who, humanEnd) {
    humanEnd = humanEnd === undefined ? 'near' : humanEnd;
    if (!validWho(who) || !validEnd(humanEnd)) return null;
    return who === 'human' ? humanEnd : humanEnd === 'near' ? 'far' : 'near';
  }
  function sideSign(who, side, humanEnd) {
    var end = courtEnd(who, humanEnd);
    return !end || !validSide(side) ? null : (end === 'near' ? 1 : -1) * (side === 'right' ? 1 : -1);
  }
  function serverSide(score) {
    return Number.isInteger(score) && score >= 0 ? (score % 2 ? 'left' : 'right') : null;
  }
  function serviceRegion(who, side, humanEnd) {
    var sign = sideSign(who, side, humanEnd);
    if (sign === null) return null;
    // Diagram A dimensions include the complete painted boundary lines. The
    // centre stripe belongs to both service courts; the short line's near edge
    // is 1.98m from the net and its other edge is 2.02m.
    return { xMin: sign > 0 ? -W / (2 * X) : -1,
      xMax: sign > 0 ? 1 : W / (2 * X), yMin: GEOMETRY.shortServiceDistance / Y, yMax: 1 };
  }
  function servicePositionLegal(p, side, who, humanEnd, footMarginMeters) {
    who = who === undefined ? 'human' : who;
    var sign = sideSign(who, side, humanEnd), margin = footMarginMeters === undefined ? 0 : footMarginMeters;
    if (!point(p) || sign === null || !finite(margin) || margin < 0) return false;
    var lateral = sign * p.x * X, depth = p.y * Y;
    // A point stands for the supported foot position. Callers may request a
    // larger footprint margin; touching any painted line is never permitted.
    return lateral > W / 2 + margin + EPS && lateral < X - W - margin - EPS &&
      depth > GEOMETRY.shortServiceDistance + W + margin + EPS && depth < Y - W - margin - EPS;
  }
  function isInSingles(p) {
    return point(p) && p.x >= -1 - EPS && p.x <= 1 + EPS && p.y >= -EPS && p.y <= 1 + EPS;
  }
  function landingLegal(p, side, server, humanEnd) {
    server = server === undefined ? 'human' : server;
    if (!validWho(server)) return false;
    var receiver = server === 'human' ? 'ai' : 'human', area = serviceRegion(receiver, side, humanEnd);
    return !!area && isInSingles(p) && p.x >= area.xMin - EPS && p.x <= area.xMax + EPS &&
      p.y >= area.yMin - EPS && p.y <= area.yMax + EPS;
  }
  function serviceHeightLegal(wholeShuttleTop) { return finite(wholeShuttleTop) && wholeShuttleTop > 0 && wholeShuttleTop < RULES.serviceHeight; }
  function netHeightAt(normalizedX) {
    if (!finite(normalizedX)) return NaN;
    // The Laws specify centre and doubles-post heights, not an interpolating
    // curve. This symmetric linear profile is an explicit simulation choice.
    var fraction = Math.min(1, Math.abs(normalizedX) * X / GEOMETRY.postHalfWidth);
    return GEOMETRY.netCentreHeight + (GEOMETRY.netPostHeight - GEOMETRY.netCentreHeight) * fraction;
  }
  function distance(a, b) { return point(a) && point(b) ? Math.hypot((a.x - b.x) * X, (a.y - b.y) * Y) : NaN; }
  function validScore(score, maximum) {
    return !!score && Number.isInteger(score.human) && Number.isInteger(score.ai) && score.human >= 0 && score.ai >= 0 &&
      score.human <= maximum && score.ai <= maximum;
  }
  function gameWinner(score) {
    if (!validScore(score, RULES.cap) || score.human === score.ai) return null;
    var who = score.human > score.ai ? 'human' : 'ai', other = who === 'human' ? 'ai' : 'human';
    return score[who] >= RULES.pointsToWin && (score[who] - score[other] >= RULES.winBy || score[who] === RULES.cap) ? who : null;
  }
  function matchWinner(wins) {
    if (!validScore(wins, RULES.gamesToWin) || wins.human === wins.ai) return null;
    return wins.human === RULES.gamesToWin ? 'human' : wins.ai === RULES.gamesToWin ? 'ai' : null;
  }
  function shouldChangeEnds(event) {
    if (!event || event.matchEnded || !Number.isInteger(event.gameNumber)) return false;
    if (event.gameEnded) return event.gameNumber === 1 || event.gameNumber === 2;
    return event.gameNumber === 3 && !event.deciderChanged && validScore(event.score, RULES.cap) &&
      Math.max(event.score.human, event.score.ai) >= RULES.changeEndsDeciderAt;
  }
  function lineRects(includeDoubles) {
    var lines = [];
    function add(id, x0, x1, y0, y1) { lines.push({ id: id, xMin: x0 / X, xMax: x1 / X, yMin: y0 / Y, yMax: y1 / Y }); }
    [-1, 1].forEach(function (sign) {
      var x0 = sign > 0 ? X - W : -X, y0 = sign > 0 ? Y - W : -Y;
      add('singles-side-' + sign, x0, x0 + W, -Y, Y);
      add('back-' + sign, includeDoubles ? -GEOMETRY.postHalfWidth : -X, includeDoubles ? GEOMETRY.postHalfWidth : X, y0, y0 + W);
      var short0 = sign > 0 ? GEOMETRY.shortServiceDistance : -GEOMETRY.shortServiceDistance - W;
      add('short-service-' + sign, includeDoubles ? -GEOMETRY.postHalfWidth : -X, includeDoubles ? GEOMETRY.postHalfWidth : X, short0, short0 + W);
      add('centre-' + sign, -W / 2, W / 2, sign > 0 ? GEOMETRY.shortServiceDistance : -Y, sign > 0 ? Y : -GEOMETRY.shortServiceDistance);
      if (includeDoubles) {
        var outer0 = sign > 0 ? GEOMETRY.postHalfWidth - W : -GEOMETRY.postHalfWidth;
        add('doubles-side-' + sign, outer0, outer0 + W, -Y, Y);
        var long0 = sign > 0 ? GEOMETRY.doublesLongServiceDistance - W : -GEOMETRY.doublesLongServiceDistance;
        add('doubles-long-' + sign, -GEOMETRY.postHalfWidth, GEOMETRY.postHalfWidth, long0, long0 + W);
      }
    });
    return lines;
  }
  return { GEOMETRY: GEOMETRY, RULES: RULES, MODEL: MODEL,
    HALF_WIDTH: X, HALF_LENGTH: Y, SHORT_SERVICE_Y: GEOMETRY.shortServiceDistance / Y,
    SERVICE_SHUTTLE_TOP_OFFSET: MODEL.serviceShuttleTopOffset,
    courtEnd: courtEnd, sideSign: sideSign, serverSide: serverSide, serviceRegion: serviceRegion,
    servicePositionLegal: servicePositionLegal, landingLegal: landingLegal, isInSingles: isInSingles,
    serviceHeightLegal: serviceHeightLegal, netHeightAt: netHeightAt, distance: distance, lineRects: lineRects,
    gameWinner: gameWinner, matchWinner: matchWinner, shouldChangeEnds: shouldChangeEnds };
}));
