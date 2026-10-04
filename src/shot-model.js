(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./court-rules.js'));
  else root.BadmintonShotModel = factory(root.BadmintonCourtRules);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (CourtRules) {
  'use strict';
  if (!CourtRules) throw new Error($t('请先加载 court-rules.js'));
  // UNCALIBRATED GAME MODEL. Linear drag is deliberately simple; constants are
  // prototype tuning, not measured shuttlecock aerodynamics or athlete data.
  var G = 9.81, DRAG = 0.72, NET = CourtRules.GEOMETRY.netCentreHeight,
    X_SCALE = CourtRules.GEOMETRY.halfWidth, Y_SCALE = CourtRules.GEOMETRY.halfLength;
  var RAD = Math.PI / 180;
  var MAX_REFERENCE_SPEED = 33.4, RISK_SAMPLES = 96;
  var SKILLS = ['touch', 'drive', 'lift', 'attack'];
  var CENTERS = {
    touch: [22, 0.22, 0.25], drive: [5, 0.49, 0.58],
    lift: [55, 0.62, 0.84], attack: [-15, 0.87, 0.68]
  };
  function clamp(x, low, high) { return Math.max(low, Math.min(high, x)); }
  function finite(x) { return typeof x === 'number' && Number.isFinite(x); }
  function contactAccuracy(speed) {
    // Deliberate game tuning, NOT a fitted athlete statistic. Only the actual
    // three-dimensional shuttle speed at contact belongs in this gate; body
    // state, training and launch controls still govern the stroke after a hit.
    speed = finite(speed) ? Math.max(0, speed) : 0;
    var ratio = speed / 60, hit = 1 / (1 + ratio * ratio);
    return { speed: speed, speedUnit: 'm/s', hitProbability: hit, missProbability: 1 - hit,
      method: 'instantaneous_speed_contact_curve', referenceSpeed: 60, calibrated: false,
      scope: 'contact_only', label: $t('挥拍命中率') };
  }
  function validTarget(target) { return !!target && finite(target.x) && finite(target.y) && target.x >= -1 && target.x <= 1 && target.y >= 0 && target.y <= 1; }
  function validateControls(c) {
    if (!c || !validTarget(c.target)) return $t('落点意图必须在对方半场内');
    if (!finite(c.angle) || c.angle < -30 || c.angle > 75) return $t('出球角度须为 -30° 至 75°');
    if (!finite(c.power) || c.power < 0.05 || c.power > 1) return $t('力度须为 5% 至 100%');
    return '';
  }
  function pointAt(launch, t) {
    var factor = -Math.expm1(-DRAG * t) / DRAG;
    var angle = launch.angle * RAD, horizontal = launch.speed * Math.cos(angle);
    var decay = Math.exp(-DRAG * t);
    var vx = horizontal * Math.sin(launch.yaw) * decay;
    var vy = horizontal * Math.cos(launch.yaw) * decay;
    var vz = (launch.speed * Math.sin(angle) + G / DRAG) * decay - G / DRAG;
    return {
      t: t,
      x: launch.origin.x + horizontal * Math.sin(launch.yaw) * factor / X_SCALE,
      y: -launch.origin.y + horizontal * Math.cos(launch.yaw) * factor / Y_SCALE,
      z: launch.height + (launch.speed * Math.sin(angle) + G / DRAG) * factor - G * t / DRAG,
      vx: vx, vy: vy, vz: vz, speed: Math.hypot(vx, vy, vz)
    };
  }
  function rawFlight(launch) {
    var lo = 0, hi = 12;
    for (var i = 0; i < 48; i++) {
      var mid = (lo + hi) / 2;
      if (pointAt(launch, mid).z > 0) lo = mid; else hi = mid;
    }
    var groundTime = (lo + hi) / 2, ground = pointAt(launch, groundTime);
    ground.z = 0;
    var forward = launch.speed * Math.cos(launch.angle * RAD) * Math.cos(launch.yaw);
    var ratio = forward > 0 ? DRAG * launch.origin.y * Y_SCALE / forward : 2;
    var netTime = ratio >= 0 && ratio < 1 ? -Math.log1p(-ratio) / DRAG : null;
    if (netTime !== null && netTime > groundTime + 1e-9) netTime = null;
    var netPoint = netTime === null ? null : pointAt(launch, netTime);
    var netHeight = netPoint ? CourtRules.netHeightAt(netPoint.x) : null;
    var clearance = netPoint ? netPoint.z - netHeight : null;
    var blocked = netPoint !== null && clearance <= 0;
    var duration = blocked ? netTime : groundTime;
    var impact = blocked ? netPoint : ground;
    if (blocked) impact.y = 0;
    var vz = launch.speed * Math.sin(launch.angle * RAD);
    var apexTime = vz > 0 ? Math.log1p(vz * DRAG / G) / DRAG : 0;
    var apex = pointAt(launch, Math.min(apexTime, duration)).z;
    var inBounds = CourtRules.isInSingles(ground) && ground.y > 0;
    var valid = !blocked && netPoint !== null && inBounds;
    var warning = blocked ? $t('预计触网：轨迹会在球网处终止') : netPoint === null ? $t('预计未过网，球会落在己方半场') : !inBounds ? $t('预计出界：请重新瞄准或调整角度、力度') : clearance < 0.16 ? $t('过网余量较小，执行偏差可能导致触网') : '';
    return {
      landing: { x: impact.x, y: impact.y }, duration: duration,
      initialSpeed: launch.speed, apex: apex, netClearance: clearance, netHeight: netHeight,
      terminal: blocked ? 'net' : 'ground', valid: valid, warning: warning,
      impact: impact, freeLanding: { x: ground.x, y: ground.y }, freeDuration: groundTime, netTime: netTime
    };
  }
  function simulateLaunch(launch, withSamples) {
    var raw = rawFlight(launch);
    if (withSamples === false) return raw;
    raw.launch = { origin: { x: launch.origin.x, y: launch.origin.y }, height: launch.height,
      speed: launch.speed, angle: launch.angle, yaw: launch.yaw };
    var times = [0, raw.duration];
    for (var t = 0.04; t < raw.duration; t += 0.04) times.push(t);
    if (raw.netTime !== null && raw.netTime < raw.duration) times.push(raw.netTime);
    times.sort(function (a, b) { return a - b; });
    var samples = [];
    times.forEach(function (time) {
      if (samples.length && Math.abs(samples[samples.length - 1].t - time) < 1e-8) return;
      var point = pointAt(launch, time);
      if (Math.abs(time - raw.duration) < 1e-8) { point.x = raw.impact.x; point.y = raw.impact.y; point.z = Math.max(0, raw.impact.z); }
      samples.push(point);
    });
    raw.samples = samples;
    return raw;
  }

  function validLaunch(launch) {
    return !!launch && !!launch.origin && finite(launch.origin.x) && finite(launch.origin.y)
      && finite(launch.height) && finite(launch.speed) && finite(launch.angle) && finite(launch.yaw);
  }
  function sampleTrajectory(trajectory, time) {
    if (!trajectory || !validLaunch(trajectory.launch) || !finite(trajectory.duration) || !finite(time) || time < 0 || time > trajectory.duration) return null;
    var point = pointAt(trajectory.launch, time);
    if (Math.abs(time - trajectory.duration) < 1e-10 && trajectory.impact) {
      point.x = trajectory.impact.x; point.y = trajectory.impact.y; point.z = Math.max(0, trajectory.impact.z);
    }
    return point;
  }

  function contactIntervals(trajectory, minHeight, maxHeight) {
    minHeight = minHeight === undefined ? 0.28 : minHeight;
    maxHeight = maxHeight === undefined ? 2.95 : maxHeight;
    if (!finite(minHeight) || !finite(maxHeight) || minHeight < 0 || maxHeight <= minHeight) return [];
    if (!trajectory || !validLaunch(trajectory.launch) || !finite(trajectory.duration) || !(trajectory.duration > 0.14)) return [];
    var launch = trajectory.launch, minimum = 0.14, maximum = trajectory.duration;
    var times = [minimum, maximum], initial = pointAt(launch, 0);
    function add(time) { if (finite(time) && time > minimum + 1e-10 && time < maximum - 1e-10) times.push(time); }
    function horizontalCrossing(initialCoordinate, velocity, scale, boundary) {
      if (Math.abs(velocity) < 1e-10) return;
      var factor = (boundary - initialCoordinate) * scale / velocity;
      if (factor >= 0 && factor < 1 / DRAG) add(-Math.log1p(-DRAG * factor) / DRAG);
    }
    horizontalCrossing(initial.x, initial.vx, X_SCALE, -1);
    horizontalCrossing(initial.x, initial.vx, X_SCALE, 1);
    horizontalCrossing(initial.y, initial.vy, Y_SCALE, 0.025);
    horizontalCrossing(initial.y, initial.vy, Y_SCALE, 1);
    var apexTime = initial.vz > 0 ? Math.log1p(initial.vz * DRAG / G) / DRAG : 0;
    var turns = [0];
    if (apexTime > 0 && apexTime < maximum) turns.push(apexTime);
    turns.push(maximum);
    [minHeight, maxHeight].forEach(function (height) {
      for (var i = 0; i < turns.length - 1; i++) {
        var a = turns[i], b = turns[i + 1], fa = pointAt(launch, a).z - height, fb = pointAt(launch, b).z - height;
        if (Math.abs(fa) < 1e-10) add(a);
        if (Math.abs(fb) < 1e-10) add(b);
        if (fa * fb >= 0) continue;
        for (var iteration = 0; iteration < 48; iteration++) {
          var mid = (a + b) / 2, fm = pointAt(launch, mid).z - height;
          if (fa * fm <= 0) { b = mid; fb = fm; } else { a = mid; fa = fm; }
        }
        add((a + b) / 2);
      }
    });
    times.sort(function (a, b) { return a - b; });
    var unique = times.filter(function (t, i) { return i === 0 || t - times[i - 1] > 1e-9; });
    var intervals = [];
    for (var j = 0; j < unique.length - 1; j++) {
      var start = unique[j], end = unique[j + 1];
      if (end - start < 1e-8) continue;
      var sample = pointAt(launch, (start + end) / 2);
      if (sample.y < 0.025 || sample.y > 1 || Math.abs(sample.x) > 1 || sample.z < minHeight || sample.z > maxHeight) continue;
      var prior = intervals[intervals.length - 1];
      if (prior && Math.abs(prior.end - start) < 1e-8) prior.end = end;
      else intervals.push({ start: start, end: end });
    }
    return intervals;
  }

  function blend(context, controls, range) {
    // Range is actual free-flight travel, NOT the hollow intended-aim marker.
    // Moving that marker along one ray must not change the same executed stroke.
    var weights = {}, total = 0, proficiency = 0;
    SKILLS.forEach(function (id) {
      var c = CENTERS[id];
      var distance = Math.pow((controls.angle - c[0]) / 39, 2) + Math.pow((controls.power - c[1]) / 0.43, 2) + Math.pow((range - c[2]) / 0.65, 2);
      weights[id] = Math.exp(-distance) + 0.005;
      total += weights[id];
    });
    SKILLS.forEach(function (id) { weights[id] /= total; proficiency += weights[id] * context.skills[id]; });
    return { weights: weights, proficiency: proficiency };
  }

  function powerCapacity(context, requestedPower) {
    var stamina = clamp(finite(context.stamina) ? context.stamina : 0, 0, 100);
    var balance = clamp(finite(context.balance) ? context.balance : 0, 0, 100);
    var stance = Math.max(0, finite(context.stancePreparationTime) ? context.stancePreparationTime
      : finite(context.preparationTime) ? context.preparationTime : finite(context.remainingTime) ? 0 : 0.20);
    var remaining = Math.max(0, finite(context.remainingTime) ? context.remainingTime : 0);
    // Engine contexts explicitly provide both parts of the one simulation clock.
    // waitingTime is only a compatibility fallback for older standalone callers.
    var available = finite(context.availablePreparation) ? Math.max(0, context.availablePreparation)
      : finite(context.remainingTime) || finite(context.stancePreparationTime) || finite(context.preparationTime) ? stance + remaining
      : finite(context.waitingTime) ? Math.max(0, context.waitingTime) : stance;
    if (context.contactMode === 'jump' || context.preparationBonusEligible === false) available = Math.min(available, stance);
    var factors = { stamina: Math.sqrt(stamina / 100),
      balance: 0.35 + 0.65 * Math.pow(balance / 100, 0.65),
      preparation: 0.45 + 0.55 * (1 - Math.exp(-available / 0.20)) };
    // 5% is a deliberately weak passive contact floor, not usable reserve energy.
    // Skill never increases this absolute, common-to-both-players capacity.
    var maxPower = clamp(factors.stamina * factors.balance * factors.preparation, 0.05, 1);
    var applied = Math.min(requestedPower, maxPower), reasons = [];
    if (factors.stamina < 0.99) reasons.push($t('体力 ') + stamina.toFixed(0));
    if (factors.balance < 0.99) reasons.push($t('稳定 ') + balance.toFixed(0));
    if (factors.preparation < 0.99) reasons.push($t('准备 ') + available.toFixed(2) + 's');
    if (!stamina) reasons.push($t('体力耗尽，仅保留最低强度碰挡'));
    return { maxPower: maxPower, requestedPower: requestedPower, appliedPower: applied,
      clamped: requestedPower > maxPower + 1e-12, availablePreparation: available,
      remainingTime: remaining, stancePreparationTime: stance, factors: factors, reasons: reasons,
      method: 'absolute_power_capacity', calibrated: false };
  }
  function parameters(context, requested) {
    var powerLimit = powerCapacity(context, requested.power);
    var controls = { target: requested.target, angle: requested.angle, power: powerLimit.appliedPower };
    var downwardDemand = 1 / (1 + Math.exp((controls.angle + 1) / 10));
    var heightFit = 1 - downwardDemand * (1 / (1 + Math.exp((context.contactHeight - 1.75) * 3.4)));
    var movingSpeed = Math.hypot((context.vx || 0) * X_SCALE, (context.vy || 0) * Y_SCALE);
    var posture = 1 / (1 + movingSpeed * 0.12);
    var dx = (controls.target.x - context.origin.x) * X_SCALE;
    var dy = (controls.target.y + context.origin.y) * Y_SCALE;
    var aimLength = Math.hypot(dx, dy);
    var heading = movingSpeed > 0.001 && aimLength > 0.001 ? clamp(((context.vx || 0) * X_SCALE * dx - (context.vy || 0) * Y_SCALE * dy) / (movingSpeed * aimLength), -1, 1) : 1;
    var inertiaMismatch = (1 - heading) * 0.5 * movingSpeed / (movingSpeed + 2);
    var preparation = 1 / (1 + powerLimit.availablePreparation * 3);
    var powerDemand = controls.power * controls.power;
    var demandPenalty = powerDemand * (0.16 * (1 - context.balance / 100) + 0.10 * (1 - context.stamina / 100) + 0.12 * inertiaMismatch) * preparation;
    var stretch = clamp((context.reachDistance || 0) / 0.62, 0, 1.5);
    var preparationShortfall = Math.exp(-powerLimit.availablePreparation / 0.20);
    var reachPenalty = stretch * stretch * (0.045 + 0.055 * powerDemand);
    var preparationPenalty = preparationShortfall * (0.025 + 0.055 * powerDemand);
    var incomingSpeed = finite(context.incomingSpeed) ? Math.max(0, context.incomingSpeed) : 0;
    var incomingVerticalSpeed = finite(context.incomingVerticalSpeed) ? context.incomingVerticalSpeed : 0;
    // Conditional-on-contact handling load: faster arrival and steep vertical
    // pace are harder to redirect. This changes landing precision after a hit;
    // the separate, disclosed speed-only gate determines whether contact occurs.
    var arrivalLoad = 0.65 * incomingSpeed / (incomingSpeed + 14) + 0.35 * Math.abs(incomingVerticalSpeed) / (Math.abs(incomingVerticalSpeed) + 9);
    var controlDifficulty = arrivalLoad * (1 - 0.25 * context.balance / 100)
      * (1 - 0.20 * clamp(powerLimit.availablePreparation / 0.22, 0, 1));
    var incomingPenalty = 0.075 * controlDifficulty;
    var baseFit = 0.40 * context.balance / 100 + 0.24 * context.stamina / 100 + 0.22 * heightFit + 0.14 * posture;
    var stateFit = clamp(baseFit - demandPenalty - reachPenalty - preparationPenalty - incomingPenalty, 0.08, 1);
    // Capacity limits absolute output once. State-fit no longer secretly scales
    // this speed a second time; it describes control difficulty and economy.
    var initialSpeed = 2.5 + controls.power * (MAX_REFERENCE_SPEED - 2.5);
    var meanLaunch = launchFor(context, controls, { initialSpeed: initialSpeed });
    var meanLanding = rawFlight(meanLaunch).freeLanding;
    var actualRange = Math.hypot((meanLanding.x - context.origin.x) * X_SCALE, (meanLanding.y + context.origin.y) * Y_SCALE) / 12;
    var blended = blend(context, controls, actualRange);
    var skillFactor = 1.25 - blended.proficiency * 0.0075;
    var exertion = controls.power / powerLimit.maxPower;
    var uncertainty = skillFactor * (1 + (1 - context.balance / 100) * 1.10
      + (1 - context.stamina / 100) * 0.55 + preparationShortfall * 0.80
      + inertiaMismatch * 0.40 + stretch * stretch * 0.25 + arrivalLoad * 0.35 + (1 - stateFit) * 0.25);
    var angleSigma = 1.30 * uncertainty * (0.55 + exertion * exertion * 0.80);
    var yawSigma = 1.40 * uncertainty * (0.55 + exertion * exertion * 0.80);
    var speedSigma = 0.025 * uncertainty * (0.65 + exertion * 0.55);
    var efficiency = 1.12 - blended.proficiency * 0.0032;
    var nominalStaminaCost = (2.4 + 8 * controls.power * controls.power + downwardDemand * 1.4) * efficiency * (1.23 - 0.26 * stateFit);
    var staminaCost = Math.min(Math.max(0, context.stamina), nominalStaminaCost);
    // Landing occupies the same outgoing-flight clock as recoil and recovery;
    // a jump never grants a second movement budget before touching the ground.
    var landingRecoveryTime = Math.max(0, finite(context.landingRecoveryTime) ? context.landingRecoveryTime : 0);
    var recoveryTime = (0.11 + 0.30 * controls.power * controls.power + 0.18 * (1 - stateFit) + 0.10 * downwardDemand) * (1.07 - blended.proficiency * 0.0014) + landingRecoveryTime;
    return {
      proficiency: blended.proficiency, skillWeights: blended.weights, stateFit: stateFit,
      contactAccuracy: contactAccuracy(incomingSpeed),
      powerLimit: powerLimit, controls: controls, exertion: exertion, nominalStaminaCost: nominalStaminaCost,
      maxLaunchSpeed: 2.5 + powerLimit.maxPower * (MAX_REFERENCE_SPEED - 2.5),
      initialSpeed: initialSpeed, angleSigma: angleSigma, yawSigma: yawSigma, speedSigma: speedSigma,
      staminaCost: staminaCost, recoveryTime: recoveryTime,
      balanceCost: 3 + controls.power * controls.power * 13 + downwardDemand * (1 - heightFit) * 6,
      shotAssessment: { incomingSpeed: incomingSpeed, incomingVerticalSpeed: incomingVerticalSpeed,
        incomingControlDifficulty: controlDifficulty, baseFit: baseFit, powerDemandPenalty: demandPenalty,
        reachPenalty: reachPenalty, preparationPenalty: preparationPenalty, incomingControlPenalty: incomingPenalty, stateFit: stateFit,
        availablePreparation: powerLimit.availablePreparation, powerLimit: powerLimit, exertion: exertion }
    };
  }
  function launchFor(context, controls, param) {
    return { origin: { x: context.origin.x, y: context.origin.y }, height: context.contactHeight,
      speed: param.initialSpeed, angle: controls.angle,
      yaw: Math.atan2((controls.target.x - context.origin.x) * X_SCALE, (controls.target.y + context.origin.y) * Y_SCALE) };
  }

  function dispersion(launch, param) {
    // Local sensitivity of the unblocked ground landing: an approximate one-sigma
    // ellipse, not a guarantee and not a simulation of net-collision probability.
    var quantities = [
      { key: 'angle', epsilon: 0.08, sigma: param.angleSigma },
      { key: 'yaw', epsilon: 0.08 * RAD, sigma: param.yawSigma * RAD },
      { key: 'speed', epsilon: 0.025, sigma: param.speedSigma * launch.speed }
    ];
    var xx = 0, yy = 0, xy = 0;
    quantities.forEach(function (q) {
      var plus = Object.assign({}, launch), minus = Object.assign({}, launch);
      plus[q.key] += q.epsilon; minus[q.key] -= q.epsilon;
      var p = rawFlight(plus).freeLanding, m = rawFlight(minus).freeLanding;
      var dx = (p.x - m.x) / (2 * q.epsilon) * q.sigma;
      var dy = (p.y - m.y) / (2 * q.epsilon) * q.sigma;
      xx += dx * dx; yy += dy * dy; xy += dx * dy;
    });
    return { x: Math.sqrt(xx), y: Math.sqrt(yy), covariance: xy };
  }
  function landingEnvelope(flight, spread) {
    // A visible two-sigma local sensitivity contour, NOT a guaranteed landing
    // region or a calibrated probability ellipse. Retain the xy covariance and
    // compute in metres so a diagonal shot does not get an axis-swapped circle.
    var xx = spread.x * spread.x * X_SCALE * X_SCALE;
    var yy = spread.y * spread.y * Y_SCALE * Y_SCALE;
    var xy = spread.covariance * X_SCALE * Y_SCALE;
    var delta = Math.sqrt(Math.max(0, (xx - yy) * (xx - yy) + 4 * xy * xy));
    var major = 2 * Math.sqrt(Math.max(0, (xx + yy + delta) / 2));
    var minor = 2 * Math.sqrt(Math.max(0, (xx + yy - delta) / 2));
    var rotation = Math.atan2(2 * xy, xx - yy) / 2, cos = Math.cos(rotation), sin = Math.sin(rotation);
    var center = { x: flight.freeLanding.x, y: flight.freeLanding.y }, points = [];
    for (var i = 0; i <= 48; i++) {
      var theta = i * Math.PI * 2 / 48, a = major * Math.cos(theta), b = minor * Math.sin(theta);
      points.push({ x: center.x + (a * cos - b * sin) / X_SCALE, y: center.y + (a * sin + b * cos) / Y_SCALE });
    }
    return { center: center, points: points, radiusAcrossMeters: 2 * Math.sqrt(xx), radiusDepthMeters: 2 * Math.sqrt(yy),
      majorRadiusMeters: major, minorRadiusMeters: minor, orientationRadians: rotation,
      sigmaLevel: 2, approximate: true, calibrated: false, drawable: flight.terminal === 'ground',
      scope: 'unblocked_landing', method: 'local_launch_sensitivity', label: $t('落点误差参考圈') };
  }

  function preview(context, controls) {
    var invalid = validateControls(controls);
    if (invalid) return { ok: false, error: invalid };
    var param = parameters(context, controls), launch = launchFor(context, controls, param);
    var flight = simulateLaunch(launch), spread = dispersion(launch, param);
    return {
      ok: true, valid: flight.valid, warning: flight.warning,
      trajectory: flight, proficiency: param.proficiency, stateFit: param.stateFit,
      dispersion: spread, landingEnvelope: landingEnvelope(flight, spread), staminaCost: param.staminaCost, recoveryTime: param.recoveryTime,
      balanceCost: param.balanceCost, powerLimit: param.powerLimit,
      controls: { target: { x: controls.target.x, y: controls.target.y }, angle: controls.angle, power: param.powerLimit.appliedPower },
      risk: estimateRisk(launch, param), contactAccuracy: param.contactAccuracy,
      skillWeights: param.skillWeights, shotAssessment: param.shotAssessment,
      execution: { angleSigma: param.angleSigma, yawSigma: param.yawSigma, speedSigma: param.speedSigma }
    };
  }

  function fitCategory(fit) { return fit >= 0.78 ? 'comfortable' : fit >= 0.58 ? 'strained' : 'heavy'; }
  function physicalOutcome(flight) {
    return flight.terminal === 'net' ? 'net' : flight.netClearance === null ? 'short' : flight.valid ? 'in' : 'out';
  }
  function controlCondition(context, controls) {
    var param = parameters(context, controls), flight = rawFlight(launchFor(context, controls, param));
    return { stateFit: param.stateFit, category: fitCategory(param.stateFit), physicalOutcome: physicalOutcome(flight),
      valid: flight.valid, warning: flight.warning, flightDuration: flight.duration, initialSpeed: flight.initialSpeed,
      contactHeight: context.contactHeight, stamina: context.stamina, balance: context.balance,
      proficiency: param.proficiency, staminaCost: param.staminaCost, powerLimit: param.powerLimit,
      contactAccuracy: param.contactAccuracy,
      availablePreparation: param.powerLimit.availablePreparation,
      costExceedsStamina: param.nominalStaminaCost > context.stamina,
      execution: { angleSigma: param.angleSigma, yawSigma: param.yawSigma, speedSigma: param.speedSigma } };
  }
  function scanControls(context, controls) {
    var invalid = validateControls(controls);
    if (invalid) return { ok: false, error: invalid };
    // These are conditional, sampled display bands. Each axis holds the target
    // and other control fixed; they are not a joint feasible region or a lock.
    // A narrow transition can lie within a cell, so the exact selected value is
    // always evaluated separately below. No randomness is consumed here.
    function scanAxis(axis, min, max, count) {
      var fitSegments = [], physicalSegments = [];
      function append(list, from, to, key, value) {
        var previous = list[list.length - 1];
        if (previous && previous[key] === value) previous.to = to;
        else { var part = { from: from, to: to }; part[key] = value; list.push(part); }
      }
      for (var i = 0; i < count; i++) {
        var from = min + (max - min) * i / count, to = i === count - 1 ? max : min + (max - min) * (i + 1) / count;
        var candidate = { target: controls.target, angle: controls.angle, power: controls.power };
        candidate[axis] = (from + to) / 2;
        var condition = controlCondition(context, candidate);
        append(fitSegments, from, to, 'category', condition.category);
        append(physicalSegments, from, to, 'outcome', condition.physicalOutcome);
      }
      var fixed = { target: { x: controls.target.x, y: controls.target.y } };
      fixed[axis === 'angle' ? 'power' : 'angle'] = controls[axis === 'angle' ? 'power' : 'angle'];
      return { min: min, max: max, step: (max - min) / count, sampleCount: count,
        fixed: fixed, approximate: true, segments: fitSegments, physicalSegments: physicalSegments };
    }
    var current = controlCondition(context, controls), currentParam = parameters(context, controls);
    current.risk = estimateRisk(launchFor(context, controls, currentParam), currentParam);
    var factors = { method: 'single_variable_reference', additive: false,
      deltaDefinition: 'referenceStateFit - actualStateFit', items: [] };
    var referenceStates = Object.create(null);
    [
      { id: 'height', field: 'contactHeight', label: $t('触球高度'), reference: 3, unit: 'm' },
      { id: 'stamina', field: 'stamina', label: $t('体力'), reference: 100, unit: 'points' },
      { id: 'balance', field: 'balance', label: $t('稳定度'), reference: 100, unit: 'points' },
      { id: 'preparation', field: 'availablePreparation', label: $t('准备时间'), reference: Math.max(0.80, current.availablePreparation), unit: 's' }
    ].forEach(function (factor) {
      var referenceContext = Object.assign({}, context); referenceContext[factor.field] = factor.reference;
      var referenceParam = parameters(referenceContext, controls), referenceFit = referenceParam.stateFit;
      var referenceRisk = estimateRisk(launchFor(referenceContext, controls, referenceParam), referenceParam);
      referenceStates[factor.id] = { context: referenceContext, param: referenceParam, risk: referenceRisk, factor: factor };
      factors.items.push({ id: factor.id, label: factor.label, unit: factor.unit,
        actualValue: factor.id === 'preparation' ? current.availablePreparation : context[factor.field], referenceValue: factor.reference,
        actualStateFit: current.stateFit, referenceStateFit: referenceFit,
        fitDelta: referenceFit - current.stateFit,
        actualMaxPower: current.powerLimit.maxPower, referenceMaxPower: referenceParam.powerLimit.maxPower,
        maxPowerDelta: referenceParam.powerLimit.maxPower - current.powerLimit.maxPower,
        actualRisk: current.risk.estimate, referenceRisk: referenceRisk.estimate,
        riskDelta: referenceRisk.estimate - current.risk.estimate });
    });
    // The compact outcome comparison keeps this shot's REAL applied power.
    // Improving one body condition may raise its ceiling, but must not also
    // speed up the mean shot and move its landing during the same comparison.
    // Keep the older state-fit factors above unchanged for existing consumers.
    var fixedControls = { target: { x: controls.target.x, y: controls.target.y }, angle: controls.angle,
      power: currentParam.powerLimit.appliedPower };
    var fixedLaunch = launchFor(context, fixedControls, currentParam), fixedFlight = rawFlight(fixedLaunch);
    function circleFor(launch, param, flight) {
      if (flight.terminal !== 'ground') return { drawable: false, majorRadiusMeters: null };
      var envelope = landingEnvelope(flight, dispersion(launch, param));
      return { drawable: true, majorRadiusMeters: envelope.majorRadiusMeters };
    }
    var actualCircle = circleFor(fixedLaunch, currentParam, fixedFlight);
    var impacts = { method: 'single_variable_reference_fixed_effective_power', additive: false,
      deltaDefinition: 'actual - reference', fixedControls: fixedControls, items: [] };
    ['balance', 'stamina', 'preparation'].forEach(function (id) {
      var cached = referenceStates[id], factor = cached.factor;
      // A legacy reference is reusable only when its actual output already
      // equals the fixed power. Otherwise recompute its error law and risk.
      var reusable = cached.param.powerLimit.appliedPower === fixedControls.power;
      var referenceParam = reusable ? cached.param : parameters(cached.context, fixedControls);
      var referenceLaunch = launchFor(cached.context, fixedControls, referenceParam);
      var referenceRisk = reusable ? cached.risk : estimateRisk(referenceLaunch, referenceParam);
      var referenceCircle = circleFor(referenceLaunch, referenceParam, rawFlight(referenceLaunch));
      var circleAvailable = actualCircle.drawable && referenceCircle.drawable;
      var item = { id: id, label: factor.label, unit: factor.unit,
        actualValue: id === 'preparation' ? currentParam.powerLimit.availablePreparation : context[factor.field],
        referenceValue: id === 'preparation' ? referenceParam.powerLimit.availablePreparation : cached.context[factor.field],
        actualMaxPower: currentParam.powerLimit.maxPower, referenceMaxPower: referenceParam.powerLimit.maxPower,
        powerDelta: currentParam.powerLimit.maxPower - referenceParam.powerLimit.maxPower,
        actualRisk: current.risk.estimate, referenceRisk: referenceRisk.estimate,
        riskDelta: current.risk.estimate - referenceRisk.estimate,
        actualMajorRadiusMeters: actualCircle.majorRadiusMeters, referenceMajorRadiusMeters: referenceCircle.majorRadiusMeters,
        actualDrawable: actualCircle.drawable, referenceDrawable: referenceCircle.drawable,
        circleAvailable: circleAvailable,
        circleDelta: circleAvailable ? actualCircle.majorRadiusMeters - referenceCircle.majorRadiusMeters : null };
      if (id === 'preparation') item.referenceRequestedValue = factor.reference;
      impacts.items.push(item);
    });
    var powerAxis = scanAxis('power', 0.05, 1, 95); powerAxis.limit = current.powerLimit.maxPower;
    return { ok: true, approximate: true,
      controls: { target: { x: controls.target.x, y: controls.target.y }, angle: controls.angle, power: controls.power },
      angle: scanAxis('angle', -30, 75, 70), power: powerAxis,
      current: current, factors: factors, impacts: impacts, thresholds: { comfortable: 0.78, strained: 0.58 } };
  }

  function normal(random) {
    var a = Math.max(1e-12, random()), b = random();
    return clamp(Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b), -2.5, 2.5);
  }
  function perturbedLaunch(reference, param, random) {
    var launch = { origin: { x: reference.origin.x, y: reference.origin.y }, height: reference.height,
      angle: clamp(reference.angle + normal(random) * param.angleSigma, -65, 86),
      yaw: reference.yaw + normal(random) * param.yawSigma * RAD,
      speed: clamp(reference.speed * (1 + normal(random) * param.speedSigma), 0.5, param.maxLaunchSpeed) };
    return launch;
  }
  function estimateRisk(launch, param) {
    // Fixed local samples use the EXACT conditional launch-error law without
    // touching match RNG. The analytic contact-miss probability is composed
    // once with this conditional estimate; it is not rerolled in the samples.
    var seed = 0x18acf32d, counts = { net: 0, short: 0, out: 0 }, faults = 0;
    function localRandom() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed + 0.5) / 4294967296; }
    for (var i = 0; i < RISK_SAMPLES; i++) {
      var flight = rawFlight(perturbedLaunch(launch, param, localRandom));
      if (!flight.valid) { faults++; counts[physicalOutcome(flight)]++; }
    }
    var p = faults / RISK_SAMPLES, z2 = 1.96 * 1.96, denominator = 1 + z2 / RISK_SAMPLES;
    var centre = (p + z2 / (2 * RISK_SAMPLES)) / denominator;
    var radius = 1.96 * Math.sqrt(p * (1 - p) / RISK_SAMPLES + z2 / (4 * RISK_SAMPLES * RISK_SAMPLES)) / denominator;
    var conditional = { estimate: p, lower: Math.max(0, centre - radius), upper: Math.min(1, centre + radius),
      sampleCount: RISK_SAMPLES, faultCount: faults, counts: counts,
      method: 'fixed_seed_launch_samples', scope: 'net_short_out', calibrated: false,
      intervalMethod: 'wilson_sampling_interval', label: $t('模拟失误风险') };
    var accuracy = param.contactAccuracy, hit = accuracy.hitProbability, miss = accuracy.missProbability;
    return { estimate: miss + hit * conditional.estimate,
      lower: miss + hit * conditional.lower, upper: miss + hit * conditional.upper,
      sampleCount: RISK_SAMPLES, faultCount: faults, counts: counts,
      countsScope: 'conditional_on_contact', conditional: conditional, contactAccuracy: accuracy,
      components: { contactMiss: miss, net: hit * counts.net / RISK_SAMPLES,
        short: hit * counts.short / RISK_SAMPLES, out: hit * counts.out / RISK_SAMPLES },
      method: 'analytic_contact_with_fixed_seed_launch_samples', scope: 'contact_miss_net_short_out', calibrated: false,
      intervalMethod: 'affine_conditional_wilson_interval', label: $t('模拟失误风险（含挥空）') };
  }
  function execute(context, controls, random, exactMean) {
    var param = parameters(context, controls), launch = launchFor(context, controls, param);
    var accuracy = param.contactAccuracy;
    // Mean-only callers request a drawable conditional trajectory. They bypass
    // every random draw, including contact; services (speed zero) need no gate.
    var sampled = !exactMean && accuracy.missProbability > 0;
    var contactHit = !sampled || random() < accuracy.hitProbability;
    if (!exactMean && contactHit) launch = perturbedLaunch(launch, param, random);
    return { trajectory: contactHit ? simulateLaunch(launch) : null, staminaCost: param.staminaCost,
      contactHit: contactHit, contactAccuracy: accuracy,
      contactCheck: { sampled: sampled, mode: exactMean ? 'mean_contact_bypass' : sampled ? 'speed_probability' : 'certain_contact' },
      recoveryTime: param.recoveryTime, balanceCost: param.balanceCost, launch: contactHit ? launch : null,
      powerLimit: param.powerLimit, maxLaunchSpeed: param.maxLaunchSpeed,
      controls: { target: { x: controls.target.x, y: controls.target.y }, angle: controls.angle, power: param.powerLimit.appliedPower } };
  }

  function assist(context, target, preferredAngle, options) {
    if (!validTarget(target)) return { ok: false, error: $t('落点意图必须在对方半场内') };
    if (preferredAngle !== undefined && (!finite(preferredAngle) || preferredAngle < -30 || preferredAngle > 75)) return { ok: false, error: $t('偏好角度须为 -30° 至 75°') };
    var angleLocked = !!(options && options.lockAngle === true);
    if (angleLocked && preferredAngle === undefined) return { ok: false, error: $t('锁定角度时须指定 -30° 至 75° 的有效角度') };
    var desired = Math.hypot((target.x - context.origin.x) * X_SCALE, (target.y + context.origin.y) * Y_SCALE);
    var preferred = preferredAngle === undefined ? (target.y > 0.55 ? 38 : 12) : preferredAngle;
    // A manually selected angle is an explicit control, not a soft tactic
    // preference. Retargeting may solve power within capacity but never flatten
    // that stroke. Existing three-argument AI/legacy calls remain soft assists.
    var angles = angleLocked ? [preferred] : [preferred, -25, -16, -8, 0, 7, 14, 22, 31, 41, 51, 61, 70, 75];
    var best = null;
    angles.forEach(function (angle) {
      var low = 0.05, high = powerCapacity(context, 1).maxPower;
      for (var i = 0; i < 20; i++) {
        var mid = (low + high) / 2;
        var controls = { target: target, angle: angle, power: mid };
        var param = parameters(context, controls), launch = launchFor(context, controls, param);
        var raw = rawFlight(launch);
        var actual = Math.hypot((raw.freeLanding.x - context.origin.x) * X_SCALE, (raw.freeLanding.y + context.origin.y) * Y_SCALE);
        if (actual < desired) low = mid; else high = mid;
      }
      var power = (low + high) / 2;
      var candidate = { target: { x: target.x, y: target.y }, angle: angle, power: power };
      var p = parameters(context, candidate), l = launchFor(context, candidate, p), f = rawFlight(l);
      var miss = Math.hypot((f.landing.x - target.x) * X_SCALE, (f.landing.y - target.y) * Y_SCALE);
      var score = miss * 6 + (f.valid ? 0 : 40) + Math.max(0, 0.24 - (f.netClearance === null ? -1 : f.netClearance)) * 4
        + Math.abs(angle - preferred) * 0.012 + power * 0.12;
      if (!best || score < best.score) best = { controls: candidate, score: score, miss: miss };
    });
    var result = preview(context, best.controls);
    var aimWarning = '';
    if (best.miss > 0.30) aimWarning = angleLocked ? $t('保持所选角度，当前可用力度无法到达意图点，显示的是实际预测落点。')
      : $t('当前状态难以到达意图点，显示的是最接近的预测结果。');
    else if (preferredAngle !== undefined && Math.abs(best.controls.angle - preferredAngle) > 0.1) aimWarning = $t('辅助瞄准采用了更适合当前状态的角度。');
    result.warning = aimWarning + result.warning;
    return { ok: true, controls: best.controls, preview: result, aimWarning: aimWarning };
  }

  return { preview: preview, scanControls: scanControls, execute: execute, assist: assist, simulateLaunch: simulateLaunch,
    sampleTrajectory: sampleTrajectory, contactIntervals: contactIntervals,
    pointAt: pointAt, validateControls: validateControls, validTarget: validTarget, powerCapacity: powerCapacity,
    contactAccuracy: contactAccuracy,
    constants: { gravity: G, drag: DRAG, netHeight: NET, netPostHeight: CourtRules.GEOMETRY.netPostHeight,
      netHeightProfile: CourtRules.MODEL.netHeightProfile, xScale: X_SCALE, yScale: Y_SCALE } };
}));
