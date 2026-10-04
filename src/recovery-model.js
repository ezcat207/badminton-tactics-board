(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./court-rules.js'));
  else root.BadmintonRecoveryModel = factory(root.BadmintonCourtRules);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (CourtRules) {
  'use strict';
  if (!CourtRules) throw new Error($t('请先加载 court-rules.js'));
  var X = CourtRules.GEOMETRY.halfWidth, Y = CourtRules.GEOMETRY.halfLength;
  // Uncalibrated game coefficients, NOT measured athlete limits. These rules
  // apply identically to both players. Every invocation represents one stroke.
  // Recovery is a short repositioning window, not another unrestricted chase.
  // Lower acceleration also limits short-flight recovery before the cap matters.
  var PARAMETERS = Object.freeze({ hardDistanceCap: 1.8, staminaPerMeter: 2.5,
    baseAcceleration: 2.35, staminaAcceleration: 1.05, brakingAcceleration: 5.8,
    baseSpeed: 2.05, staminaSpeed: 0.9, restingStaminaPerSecond: 3,
    restingBalancePerSecond: 18, movementBalancePerMeter: 2.1, settlingBalancePerSecond: 6 });
  function finite(n) { return typeof n === 'number' && Number.isFinite(n); }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function point(p) { return !!p && !Array.isArray(p) && finite(p.x) && finite(p.y) && Math.abs(p.x) <= 10 && Math.abs(p.y) <= 10; }
  function unbrakedDistance(time, acceleration, speed) {
    var ramp = speed / acceleration;
    return time <= ramp ? acceleration * time * time / 2 : speed * (time - ramp / 2);
  }
  function movementAt(distance, time, acceleration, braking, maximumSpeed) {
    if (distance <= 0) return { distance: 0, speed: 0, duration: 0, movingTime: 0 };
    var peak = Math.min(maximumSpeed, Math.sqrt(2 * distance / (1 / acceleration + 1 / braking)));
    var ta = peak / acceleration, tb = peak / braking;
    var da = peak * ta / 2, db = peak * tb / 2, dc = Math.max(0, distance - da - db), tc = dc / peak;
    var duration = ta + tc + tb, t = Math.min(time, duration), traveled, speed;
    if (t < ta) { traveled = acceleration * t * t / 2; speed = acceleration * t; }
    else if (t < ta + tc) { traveled = da + (t - ta) * peak; speed = peak; }
    else if (t < duration) {
      var decelerating = t - ta - tc;
      traveled = da + dc + peak * decelerating - braking * decelerating * decelerating / 2;
      speed = Math.max(0, peak - braking * decelerating);
    } else { traveled = distance; speed = 0; }
    return { distance: clamp(traveled, 0, distance), speed: speed, duration: duration, movingTime: t };
  }
  function evaluate(player, target, elapsed, options) {
    options = options || {};
    var strokeDelay = options.strokeDelay === undefined ? 0 : options.strokeDelay;
    if (!point(player) || !point(target) || !finite(player.stamina) || player.stamina < 0 || player.stamina > 100 ||
      !finite(player.balance) || player.balance < 0 || player.balance > 100 ||
      (player.vx !== undefined && (!finite(player.vx) || Math.abs(player.vx) > 100)) ||
      (player.vy !== undefined && (!finite(player.vy) || Math.abs(player.vy) > 100)) ||
      !finite(elapsed) || elapsed < 0 || elapsed > 60 || !finite(strokeDelay) || strokeDelay < 0 || strokeDelay > 120) {
      return { ok: false, error: $t('回动需要有效身体状态、目标坐标及非负的有限时长') };
    }
    var dx = (target.x - player.x) * X, dy = (target.y - player.y) * Y, distance = Math.hypot(dx, dy);
    var nx = distance > 0 ? dx / distance : 0, ny = distance > 0 ? dy / distance : 0;
    var vx = player.vx || 0, vy = player.vy || 0, ux = vx * X, uy = vy * Y, inertia = Math.hypot(ux, uy);
    var bodyHeight = Math.max(0, finite(player.heightBoost) ? player.heightBoost : finite(player.z) ? player.z : 0);
    var bodyVerticalSpeed = finite(player.verticalSpeed) ? player.verticalSpeed : finite(player.vz) ? player.vz : 0;
    var airborne = player.support === 'airborne' && bodyHeight > 0;
    var landingDelay = airborne ? (bodyVerticalSpeed + Math.sqrt(bodyVerticalSpeed * bodyVerticalSpeed + 2 * 9.81 * bodyHeight)) / 9.81 : 0;
    var cosine = distance > 1e-9 && inertia > 1e-9 ? clamp((ux * nx + uy * ny) / inertia, -1, 1) : -1;
    // The existing prototype treats unreleased stroke/turn motion as a stance
    // delay, not a free translation. Residual velocity decays continuously there;
    // active recovery then starts from rest. This is not full-body dynamics.
    var turnDelay = inertia / PARAMETERS.brakingAcceleration * (0.35 + 0.65 * (1 - cosine) / 2);
    var effectiveStrokeDelay = Math.max(strokeDelay, landingDelay);
    var delay = effectiveStrokeDelay + turnDelay, available = Math.max(0, elapsed - delay);
    var acceleration = PARAMETERS.baseAcceleration + PARAMETERS.staminaAcceleration * player.stamina / 100;
    var speed = PARAMETERS.baseSpeed + PARAMETERS.staminaSpeed * player.stamina / 100;
    var energyLimit = player.stamina / PARAMETERS.staminaPerMeter;
    var frozenBudget = Math.min(distance, PARAMETERS.hardDistanceCap, energyLimit);
    var motion = movementAt(frozenBudget, available, acceleration, PARAMETERS.brakingAcceleration, speed);
    var moved = motion.distance, resting = Math.max(0, available - motion.duration);
    var cost = Math.min(player.stamina, moved * PARAMETERS.staminaPerMeter), afterDebit = player.stamina - cost;
    var recovered = Math.min(100 - afterDebit, resting * PARAMETERS.restingStaminaPerSecond);
    var finalState = Object.assign({}, player), to = { x: player.x + nx * moved / X, y: player.y + ny * moved / Y };
    finalState.x = to.x; finalState.y = to.y;
    if (elapsed < delay) {
      var remainingInertia = 1 - elapsed / delay;
      finalState.vx = vx * remainingInertia; finalState.vy = vy * remainingInertia;
    } else { finalState.vx = nx * motion.speed / X || 0; finalState.vy = ny * motion.speed / Y || 0; }
    finalState.stamina = afterDebit + recovered;
    finalState.balance = elapsed === 0 ? player.balance : clamp(player.balance + Math.min(elapsed, delay) * PARAMETERS.settlingBalancePerSecond +
      resting * PARAMETERS.restingBalancePerSecond - moved * PARAMETERS.movementBalancePerMeter, 0, 100);
    if (elapsed > 0) {
      var stillAirborne = airborne && elapsed < landingDelay - 1e-9;
      var nextHeight = stillAirborne ? Math.max(0, bodyHeight + bodyVerticalSpeed * elapsed - 9.81 * elapsed * elapsed / 2) : 0;
      var nextVerticalSpeed = stillAirborne ? bodyVerticalSpeed - 9.81 * elapsed : 0;
      finalState.support = stillAirborne ? 'airborne' : 'open';
      // These describe the current body, not the historical shot contact.
      // The engine retains that history separately in lastFootwork/shotContext.
      ['heightBoost', 'z'].forEach(function (key) { if (Object.prototype.hasOwnProperty.call(player, key)) finalState[key] = nextHeight; });
      ['verticalSpeed', 'vz'].forEach(function (key) { if (Object.prototype.hasOwnProperty.call(player, key)) finalState[key] = nextVerticalSpeed; });
      if (!stillAirborne && Object.prototype.hasOwnProperty.call(player, 'contactMode')) finalState.contactMode = null;
    }
    var timeLimit = unbrakedDistance(available, acceleration, speed);
    var maximum = Math.min(PARAMETERS.hardDistanceCap, energyLimit, timeLimit);
    var isotropic = Math.min(PARAMETERS.hardDistanceCap, energyLimit, unbrakedDistance(Math.max(0, elapsed - effectiveStrokeDelay), acceleration, speed));
    var factors = [];
    if (distance < 1e-9) factors.push('stay');
    else {
      if (elapsed === 0) factors.push('no_time');
      else if (elapsed <= delay) factors.push('recovery_delay');
      if (player.stamina === 0) factors.push('no_stamina');
      if (distance > PARAMETERS.hardDistanceCap + 1e-9) factors.push('hard_distance_cap');
      if (energyLimit < Math.min(distance, PARAMETERS.hardDistanceCap) - 1e-9) factors.push('stamina_budget');
      if (available < motion.duration - 1e-9) factors.push('time_limit');
      if (!factors.length) factors.push('target_reached');
    }
    var labels = { stay: $t('原地停留'), no_time: $t('尚无场内回动时间'), recovery_delay: $t('击球恢复或转向尚未完成'),
      no_stamina: $t('击球后体力为零，本拍不能主动回动'), hard_distance_cap: $t('受单拍 ') + PARAMETERS.hardDistanceCap + $t(' 米距离上限限制'),
      stamina_budget: $t('受击球后冻结的体力预算限制'), time_limit: $t('可用时间不足以完成这段加速与制动'), target_reached: $t('在该时长条件下可以回到所选目标') };
    return { ok: true, from: { x: player.x, y: player.y }, target: { x: target.x, y: target.y },
      direction: { x: nx, y: ny }, to: to, moved: moved, elapsed: elapsed, targetDistance: distance,
      reached: moved >= distance - 1e-9, hardDistanceCap: PARAMETERS.hardDistanceCap,
      staminaDistanceCap: energyLimit, timeDistanceCap: timeLimit, maxDistance: maximum, isotropicRadius: isotropic,
      movementBudget: frozenBudget, strokeDelay: strokeDelay, landingDelay: landingDelay, turnDelay: turnDelay, delay: delay,
      movementDuration: motion.duration, movingTime: motion.movingTime, stationaryTime: resting,
      postStrokeStamina: player.stamina, staminaSpent: cost, staminaRecovered: recovered,
      limitingFactors: factors, reason: factors.map(function (id) { return labels[id]; }).join($t('；')), finalState: finalState };
  }
  return { evaluate: evaluate, PARAMETERS: PARAMETERS };
}));
