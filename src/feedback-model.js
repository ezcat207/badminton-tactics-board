(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./court-rules.js'));
  else root.BadmintonFeedbackModel = factory(root.BadmintonCourtRules);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (CourtRules) {
  'use strict';
  if (!CourtRules) throw new Error($t('请先加载 court-rules.js'));
  // Presentation data only. This module does not evaluate movement, debit
  // stamina, select actions, read a clock, or consume randomness.
  var START_COLORS = Object.freeze({
    correct: Object.freeze({ color: '#63D29A', previewColor: '#AEDCCA' }),
    wrong: Object.freeze({ color: '#F08282', previewColor: '#E2B1B5' }),
    neutral: Object.freeze({ color: '#9AAFC8', previewColor: '#B2C0D1' })
  });
  var ACTION_STYLES = Object.freeze({
    start: Object.freeze({ id: 'start', label: $t('调整启动'), color: START_COLORS.neutral.color, category: 'start' }),
    shuffle: Object.freeze({ id: 'shuffle', label: $t('并步'), color: '#57C6E4', category: 'movement' }),
    cross: Object.freeze({ id: 'cross', label: $t('交叉步'), color: '#7CA8FF', category: 'movement' }),
    hop: Object.freeze({ id: 'hop', label: $t('小跳偷距'), color: '#B599F3', category: 'airborne' }),
    ground: Object.freeze({ id: 'ground', label: $t('地面击球'), color: '#E5BE74', category: 'support' }),
    jump: Object.freeze({ id: 'jump', label: $t('跳跃击球'), color: '#D38FD4', category: 'airborne' }),
    ready: Object.freeze({ id: 'ready', label: $t('挥拍'), color: '#D3DDE8', category: 'preparation' })
  });
  var STATE_COLORS = Object.freeze({ retained: '#68B8BF', loss: '#F07989', gain: '#61D7A5', unreached: '#24364A' });
  var REMAINING_COLOR = '#3B5871', OVERTIME_COLOR = '#F1667C', AFTER_CONTACT_COLOR = '#24364A', DISPLAY_ZERO = 1e-10;
  function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
  function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }
  function nonnegative(value, fallback) { return finite(value) ? Math.max(0, value) : fallback; }
  function safeAdd(a, b) { var total = a + b; return Number.isFinite(total) ? total : Number.MAX_VALUE; }
  function secondsText(value) {
    var magnitude = Math.abs(value);
    return magnitude > 0 && magnitude < 0.005 ? magnitude.toPrecision(2) : magnitude.toFixed(2);
  }
  function spanGeometry(start, end, axis) {
    var visibleStart = clamp(start, 0, axis), visibleEnd = clamp(end, 0, axis);
    var startRatio = axis > 0 ? visibleStart / axis : 0;
    var widthRatio = axis > 0 ? (visibleEnd - visibleStart) / axis : 0;
    return { start: start, end: end, center: start + (end - start) / 2,
      visibleStart: visibleStart, visibleEnd: visibleEnd, startRatio: startRatio, widthRatio: widthRatio,
      // Use the visible span's midpoint. Labels may be laid out elsewhere, but
      // their leader must stay here; never inflate a narrow or zero-width span.
      anchorRatio: startRatio + widthRatio / 2, clipped: start < 0 || end > axis,
      placement: widthRatio > 0 ? 'segment' : start > axis || end > axis ? 'off_axis' : 'endpoint',
      overflowSeconds: Math.max(0, end - axis) - Math.max(0, start - axis) };
  }
  function marginGeometry(time) {
    var output = { available: false, kind: null, seconds: null, start: null, end: null, center: null,
      visibleStart: null, visibleEnd: null, startRatio: 0, widthRatio: 0, anchorRatio: 0,
      clipped: false, placement: 'endpoint', overflowSeconds: 0, label: $t('暂无余量'),
      zeroTolerance: DISPLAY_ZERO, displayZero: false };
    if (!time.available || !finite(time.totalTime) || !finite(time.contactDeadline)) return output;
    var seconds = time.contactDeadline - time.totalTime;
    var geometry = spanGeometry(Math.min(time.totalTime, time.contactDeadline), Math.max(time.totalTime, time.contactDeadline), time.axisMax);
    var displayZero = Math.abs(seconds) <= DISPLAY_ZERO;
    if (displayZero) {
      // Screen coordinates can round-trip to a ~1e-17s difference. Preserve
      // raw times and seconds, but display that numerical noise as one point.
      geometry.startRatio = time.axisMax > 0 ? clamp(time.contactDeadline / time.axisMax, 0, 1) : 0;
      geometry.widthRatio = 0; geometry.anchorRatio = geometry.startRatio;
      geometry.placement = time.contactDeadline > time.axisMax ? 'off_axis' : 'endpoint';
    }
    return Object.assign(output, geometry, { available: true,
      kind: displayZero ? 'zero' : seconds > 0 ? 'remaining' : 'overtime', seconds: seconds, displayZero: displayZero,
      label: displayZero ? $t('余量 0.00s') : seconds < 0 ? $t('超时 ') + secondsText(seconds) + 's' : $t('余量 +') + secondsText(seconds) + 's' });
  }
  function modeFor(preview) {
    if (!preview || preview.ok !== true) return 'unavailable';
    if (preview.valid === true && preview.canHit === true) return 'projected';
    return preview.valid === true ? 'draft' : 'partial';
  }
  function comparisonLabel(mode) {
    return mode === 'projected' ? $t('当前 → 预计接球') : mode === 'draft' ? $t('当前 → 路径阶段值')
      : mode === 'partial' ? $t('当前 → 无效路径的阶段值') : $t('当前状态');
  }
  function styleFor(id) {
    return typeof id === 'string' && Object.prototype.hasOwnProperty.call(ACTION_STYLES, id)
      ? ACTION_STYLES[id] : { id: 'unknown', label: $t('动作'), color: '#9AAFC8', category: 'other' };
  }

  function buildStartAnticipation(startRow) {
    var row = startRow && startRow.id === 'start' ? startRow : null;
    var sourceOutcome = row && row.anticipationOutcome || null;
    var outcome = sourceOutcome === 'aligned' ? 'correct' : sourceOutcome === 'wrong' ? 'wrong' : 'neutral';
    var colors = START_COLORS[outcome];
    var actual = row && finite(row.duration) && row.duration >= 0 ? row.duration : null;
    var baseline = row && finite(row.baselineDuration) && row.baselineDuration >= 0 ? row.baselineDuration : null;
    var output = { available: false, outcome: outcome, sourceOutcome: sourceOutcome,
      actualDuration: actual, baselineDuration: null, deltaSeconds: null,
      bonusSeconds: null, penaltySeconds: null, color: colors.color, previewColor: colors.previewColor,
      label: $t('启动用时待计算'), reason: $t('尚无可比较的启动节点。') };
    var prefix = outcome === 'correct' ? $t('预判正确') : outcome === 'wrong' ? $t('预判错误')
      : sourceOutcome === 'uncertain' ? $t('侧向预判') : $t('中性预判');
    if (actual !== null) output.label = prefix + $t('，启动阶段 ') + secondsText(actual) + 's';
    if (!row || actual === null || baseline === null || row.baselineComparable === false ||
        row.executionStatus === 'partial' || !finite(row.anticipationBonusSeconds) ||
        !finite(row.anticipationPenaltySeconds) || row.anticipationBonusSeconds < 0 || row.anticipationPenaltySeconds < 0) {
      if (row && row.executionStatus === 'partial') {
        output.label = prefix + $t('，启动未完成');
        output.reason = $t('启动动作中断，阶段耗时不能与完整的中性启动比较。');
      }
      return output;
    }
    // These are the first node's actual and neutral timings. The whole-path
    // comparison may also include displaced movement, so it is not a start cost.
    var delta = actual - baseline, bonus = Math.max(0, -delta), penalty = Math.max(0, delta);
    if (Math.abs(bonus - row.anticipationBonusSeconds) > 1e-7 ||
        Math.abs(penalty - row.anticipationPenaltySeconds) > 1e-7) {
      output.reason = $t('启动对照与节点耗时不一致，请重新计算。');
      return output;
    }
    Object.assign(output, { available: true, baselineDuration: baseline, deltaSeconds: delta,
      bonusSeconds: bonus, penaltySeconds: penalty,
      reason: $t('相对中性启动的首节点差值；已包含在启动耗时内，不另加减时间。') });
    if (outcome === 'wrong' && penalty > DISPLAY_ZERO) {
      output.label = $t('预判错误，二次启动 +') + secondsText(penalty) + 's';
    } else if (outcome === 'correct' && bonus > DISPLAY_ZERO) {
      output.label = $t('预判正确，启动省 ') + secondsText(bonus) + 's';
    } else if (penalty > DISPLAY_ZERO) {
      output.label = prefix + $t('，启动多耗 ') + secondsText(penalty) + 's';
    } else if (bonus > DISPLAY_ZERO) {
      output.label = prefix + $t('，启动省 ') + secondsText(bonus) + 's';
    } else {
      output.label = prefix + $t('，启动 ') + secondsText(actual) + 's' + (outcome === 'correct' ? $t('（无额外耗时）') : '');
    }
    return output;
  }

  function buildTimeBar(preview, incomingDuration) {
    var mode = modeFor(preview), axis = nonnegative(incomingDuration, 0);
    var output = { available: mode !== 'unavailable', mode: mode, axisMax: axis,
      totalTime: null, contactDeadline: null, signedRemaining: null, overrunSeconds: 0,
      overflowSeconds: 0, pathOverflowSeconds: 0, deadlineOverflowSeconds: 0,
      deadlineRatio: null, deadlineClipped: false, segments: [],
      remainingMeaning: mode === 'projected' ? 'waiting' : mode === 'unavailable' ? null : 'budget',
      dataAdjusted: !finite(incomingDuration) || incomingDuration < 0 };
    output.margin = marginGeometry(output);
    if (!output.available) return output;
    var deadlineSource = finite(preview.contactTime) ? preview.contactTime : preview.contact && preview.contact.time;
    if (!finite(deadlineSource) || deadlineSource < 0) { output.available = false; output.dataAdjusted = true; return output; }
    var deadline = deadlineSource, cursor = 0, actions = Array.isArray(preview.actionResults) ? preview.actionResults : [];
    function segment(start, end, source, index, overtime, afterContact) {
      if (!(end > start)) return;
      var style = styleFor(source && source.id), kind = afterContact ? 'after_contact' : overtime ? 'overtime' : source ? 'action' : 'remaining';
      var actionColor = source && source.id === 'start' ? buildStartAnticipation(source).color : style.color;
      var visibleStart = clamp(start, 0, axis), visibleEnd = clamp(end, 0, axis);
      output.segments.push({ id: (source ? String(index) + ':' + style.id : kind) + (overtime ? ':late' : ''),
        actionId: source ? source.id : null, actionIndex: source ? index : null,
        kind: kind, category: source ? style.category : kind,
        label: afterContact ? $t('所选触球之后') : overtime ? $t('超过触球时刻') : source ? source.label || style.label : mode === 'projected' ? $t('等待余量') : $t('尚余时间'),
        actionLabel: source ? source.label || style.label : null,
        requestIndex: source && Number.isInteger(source.requestIndex) ? source.requestIndex : source ? index : null,
        executionStatus: source ? source.executionStatus || 'completed' : null,
        baselineDuration: source && finite(source.baselineDuration) ? source.baselineDuration : null,
        anticipationPenaltySeconds: source && finite(source.anticipationPenaltySeconds) ? source.anticipationPenaltySeconds : null,
        anticipationBonusSeconds: source && finite(source.anticipationBonusSeconds) ? source.anticipationBonusSeconds : null,
        anticipationOutcome: source && source.anticipationOutcome || null,
        meaning: afterContact ? 'after_contact' : kind === 'remaining' ? output.remainingMeaning : kind,
        color: afterContact ? AFTER_CONTACT_COLOR : overtime ? OVERTIME_COLOR : source ? actionColor : REMAINING_COLOR,
        start: start, end: end, duration: end - start,
        visibleStart: visibleStart, visibleEnd: visibleEnd,
        startRatio: axis > 0 ? clamp(visibleStart / axis, 0, 1) : 0,
        widthRatio: axis > 0 ? clamp((visibleEnd - visibleStart) / axis, 0, 1) : 0,
        clipped: end > axis || start < 0,
        overflowSeconds: Math.max(0, end - axis) - Math.max(0, start - axis) });
    }
    function actionSpan(start, end, action, index) {
      if (start < deadline) segment(start, Math.min(end, deadline), action, index, false);
      if (end > deadline) segment(Math.max(start, deadline), end, action, index, true);
    }
    actions.forEach(function (action, index) {
      if (!action || typeof action !== 'object') { output.dataAdjusted = true; return; }
      var duration = nonnegative(action.duration, 0), end;
      if (finite(action.cumulativeTime) && action.cumulativeTime >= cursor) end = action.cumulativeTime;
      else { end = safeAdd(cursor, duration); output.dataAdjusted = true; }
      if (!finite(action.duration) || action.duration < 0 || Math.abs((end - cursor) - duration) > 1e-7) output.dataAdjusted = true;
      // Cumulative event times are authoritative for drawing. Returned duration
      // is that exact span, so labels and widths cannot describe different data.
      actionSpan(cursor, end, action, index); cursor = end;
    });
    var reportedTotal = nonnegative(preview.totalTime, cursor), total = Math.max(cursor, reportedTotal);
    if (!finite(preview.totalTime) || preview.totalTime < cursor - 1e-7) output.dataAdjusted = true;
    if (total > cursor) {
      output.dataAdjusted = true;
      actionSpan(cursor, total, { id: 'unknown' }, actions.length);
    }
    if (deadline > total) segment(total, deadline, null, null, false);
    // Late actions remain red; only the unoccupied tail is the post-contact
    // background. This is never part of the player's remaining time budget.
    segment(Math.max(deadline, total), axis, null, null, false, true);
    output.totalTime = total;
    output.contactDeadline = deadline;
    // Never add opponent-recovery denial, a prediction bonus, or wall time.
    output.signedRemaining = deadline - total;
    output.overrunSeconds = Math.max(0, total - deadline);
    output.pathOverflowSeconds = Math.max(0, total - axis);
    output.deadlineOverflowSeconds = Math.max(0, deadline - axis);
    output.overflowSeconds = Math.max(output.pathOverflowSeconds, output.deadlineOverflowSeconds);
    output.deadlineRatio = axis > 0 ? clamp(deadline / axis, 0, 1) : 0;
    output.deadlineClipped = deadline > axis;
    output.margin = marginGeometry(output);
    return output;
  }

  function buildStateBar(beforeValue, afterValue, mode) {
    mode = mode || 'projected';
    var before = finite(beforeValue) ? clamp(beforeValue, 0, 100) : null;
    var after = mode !== 'unavailable' && finite(afterValue) ? clamp(afterValue, 0, 100) : null;
    var output = { available: before !== null && after !== null, mode: mode, axisMax: 100,
      before: before, after: after, delta: before !== null && after !== null ? after - before : null,
      comparisonLabel: comparisonLabel(mode), afterLabel: mode === 'projected' ? $t('预计接球值') : mode === 'unavailable' ? $t('暂无路径值') : $t('路径阶段值'),
      beforeRatio: before === null ? null : before / 100, afterRatio: after === null ? null : after / 100,
      retained: null, loss: null, gain: null, unreached: null, segments: [],
      dataAdjusted: before !== beforeValue || (after !== null && after !== afterValue) };
    if (!output.available) return output;
    var retained = Math.min(before, after), top = Math.max(before, after);
    output.retained = retained; output.loss = Math.max(0, before - after);
    output.gain = Math.max(0, after - before); output.unreached = 100 - top;
    [
      { kind: 'retained', start: 0, end: retained, label: $t('保留部分') },
      { kind: 'loss', start: retained, end: before, label: mode === 'projected' ? $t('预计净减少') : $t('阶段净减少') },
      { kind: 'gain', start: retained, end: after, label: mode === 'projected' ? $t('预计净增加') : $t('阶段净增加') },
      { kind: 'unreached', start: top, end: 100, label: $t('未达到部分') }
    ].forEach(function (part) {
      var value = part.end - part.start;
      output.segments.push({ id: part.kind, kind: part.kind, label: part.label, color: STATE_COLORS[part.kind],
        start: part.start, end: part.end, value: value, startRatio: part.start / 100, widthRatio: value / 100 });
    });
    // These are NET state differences. They deliberately do not claim to be
    // cumulative action costs: execution receipts retain spent/recovered totals.
    return output;
  }

  function buildDistanceBar(preview, current) {
    var p = preview || {}, mode = modeFor(preview), point = p.contact && p.contact.point;
    var start = current || (p.bodyPath && p.bodyPath[0]), before = p.distanceBefore;
    if (!finite(before) && start && point && [start.x, start.y, point.x, point.y].every(finite)) {
      before = CourtRules.distance(point, start);
    }
    var after = p.reachDistance, reach = p.terminalState && p.terminalState.racketReach;
    var output = { available: false, mode: mode, axisMax: 0, before: null, after: null,
      racketReach: null, requiredMovement: null, netProgress: null, gap: null,
      withinReach: false, bodyRatio: 0, targetRatio: 0, reachStartRatio: 0,
      retreatDistance: 0, segments: [] };
    if (mode === 'unavailable' || !finite(before) || before < 0 || !finite(after) || after < 0 || !finite(reach) || reach <= 0) return output;
    // One radial-distance scale per selected contact point. Walking a detour
    // does not fill the progress bar. The racket band is reach, not movement.
    var axis = Math.max(before, reach), required = Math.max(0, before - reach);
    var net = before - after, covered = clamp(net, 0, required);
    Object.assign(output, { available: true, axisMax: axis, before: before, after: after,
      racketReach: reach, requiredMovement: required, netProgress: net,
      gap: Math.max(0, after - reach), withinReach: after <= reach + 1e-9,
      bodyRatio: clamp(net, 0, before) / axis, targetRatio: before / axis,
      reachStartRatio: required / axis, retreatDistance: Math.max(0, -net) });
    [
      { kind: 'covered', start: 0, end: covered, color: '#53D6D2', label: $t('已净接近') },
      { kind: 'gap', start: covered, end: required, color: '#3B5871', label: $t('仍需接近') },
      { kind: 'reach', start: required, end: before, color: '#B8E580', label: $t('球拍触及范围') },
      { kind: 'unused', start: before, end: axis, color: '#24364A', label: $t('刻度余段') }
    ].forEach(function (part) {
      output.segments.push(Object.assign({ id: part.kind }, part, {
        value: part.end - part.start, startRatio: part.start / axis, widthRatio: (part.end - part.start) / axis }));
    });
    return output;
  }

  function buildAnticipationComparison(preview, incomingDuration) {
    var p = preview || {}, source = p.anticipation || {}, axis = nonnegative(incomingDuration, 0);
    var actual = finite(p.totalTime) && p.totalTime >= 0 ? p.totalTime : null;
    var output = { available: false, comparisonStage: source.comparisonStage || null,
      actualTime: actual, neutralTime: null, deltaSeconds: null, axisMax: axis,
      actualRatio: actual === null || axis <= 0 ? 0 : clamp(actual / axis, 0, 1),
      neutralRatio: null, spanStartRatio: null, spanWidthRatio: null,
      spanStart: null, spanEnd: null, spanCenter: null, spanCenterRatio: null,
      effect: null, direction: null, placement: null, overflowSeconds: 0,
      zeroTolerance: DISPLAY_ZERO, displayZero: false,
      clipped: false, color: '#B599F3', label: $t('预判对照待计算'), reason: source.reason || $t('添加动作后，与同一路径的中性启动比较。') };
    if (source.available !== true || actual === null || !finite(source.actualTime) ||
        !finite(source.neutralTime) || source.neutralTime < 0 || !finite(source.deltaSeconds)) return output;
    // Compare equal action prefixes supplied by the engine. This marker never
    // becomes a charged time segment and cannot change the interception budget.
    var delta = actual - source.neutralTime;
    if (Math.abs(actual - source.actualTime) > 1e-7 || Math.abs(delta - source.deltaSeconds) > 1e-7) {
      output.reason = $t('对照与当前路径不一致，请重新计算。'); return output;
    }
    if (source.comparisonStage !== 'prefix' && source.comparisonStage !== 'complete') {
      output.reason = $t('对照尚未确认执行了相同动作段。'); return output;
    }
    output.available = true; output.neutralTime = source.neutralTime; output.deltaSeconds = delta;
    output.neutralRatio = axis > 0 ? clamp(source.neutralTime / axis, 0, 1) : 0;
    output.spanStartRatio = Math.min(output.actualRatio, output.neutralRatio);
    output.spanWidthRatio = Math.abs(output.actualRatio - output.neutralRatio);
    var geometry = spanGeometry(Math.min(actual, source.neutralTime), Math.max(actual, source.neutralTime), axis);
    output.spanStart = geometry.start; output.spanEnd = geometry.end; output.spanCenter = geometry.center;
    output.spanCenterRatio = geometry.anchorRatio; output.overflowSeconds = geometry.overflowSeconds;
    output.clipped = geometry.clipped; output.placement = geometry.placement;
    output.displayZero = Math.abs(delta) <= DISPLAY_ZERO;
    if (output.displayZero) {
      output.spanStartRatio = output.actualRatio; output.spanWidthRatio = 0; output.spanCenterRatio = output.actualRatio;
      output.placement = actual > axis ? 'off_axis' : 'endpoint';
    }
    output.direction = output.displayZero ? 0 : delta > 0 ? 1 : -1;
    output.effect = output.displayZero ? 'same' : delta > 0 ? 'increase' : 'saving';
    output.color = output.direction < 0 ? '#61D7A5' : output.direction > 0 ? '#F07989' : '#B599F3';
    var scope = source.comparisonStage === 'prefix' ? $t('已选段') : $t('同路径');
    output.label = $t('预判') + scope + (output.displayZero ? $t('耗时相同') : delta < 0 ? $t('省 ') + secondsText(delta) + 's' : $t('多耗 ') + secondsText(delta) + 's');
    output.reason = source.reason || $t('与相同触球时刻、相同动作顺序的中性启动对照；差异已包含在路径耗时中。');
    return output;
  }

  function buildFootworkFeedback(preview, incomingDuration, current) {
    var mode = modeFor(preview), p = preview || {}, baseline = current || {}, final = p.finalState || {};
    var beforeBalance = finite(p.balanceBefore) ? p.balanceBefore : baseline.balance;
    var beforeStamina = finite(p.staminaBefore) ? p.staminaBefore : baseline.stamina;
    var afterBalance = finite(p.balance) ? p.balance : final.balance;
    var afterStamina = finite(p.staminaAfter) ? p.staminaAfter : final.stamina;
    return { mode: mode, comparisonLabel: comparisonLabel(mode),
      time: buildTimeBar(preview, incomingDuration),
      anticipation: buildAnticipationComparison(preview, incomingDuration),
      distance: buildDistanceBar(preview, current),
      stability: buildStateBar(beforeBalance, afterBalance, mode),
      stamina: buildStateBar(beforeStamina, afterStamina, mode) };
  }
  return { ACTION_STYLES: ACTION_STYLES, STATE_COLORS: STATE_COLORS, START_COLORS: START_COLORS,
    buildStartAnticipation: buildStartAnticipation,
    buildTimeBar: buildTimeBar, buildStateBar: buildStateBar, buildDistanceBar: buildDistanceBar, buildAnticipationComparison: buildAnticipationComparison,
    buildFootworkFeedback: buildFootworkFeedback };
}));
