(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./shot-model.js'), require('./footwork-model.js'), require('./court-rules.js'), require('./recovery-model.js'));
  else root.BadmintonEngine = factory(root.BadmintonShotModel, root.BadmintonFootworkModel, root.BadmintonCourtRules, root.BadmintonRecoveryModel);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (ShotModel, Footwork, CourtRules, RecoveryModel) {
  'use strict';
  if (!ShotModel) throw new Error($t('请先加载 shot-model.js'));
  if (!Footwork) throw new Error($t('请先加载 footwork-model.js'));
  if (!RecoveryModel || typeof RecoveryModel.evaluate !== 'function') throw new Error($t('请先加载 recovery-model.js'));
  // Prototype coefficients are uncalibrated game tuning, not athlete measurements.
  var SKILL_LABELS = { touch: $t('轻触控制'), drive: $t('平击衔接'), lift: $t('上扬控制'), attack: $t('下压发力') };
  var AI_SKILLS = { touch: 50, drive: 50, lift: 50, attack: 50 };
  var RECOVERIES = [{ id: 'center', label: $t('回中准备') }, { id: 'front', label: $t('回位偏前') }, { id: 'back', label: $t('回位偏后') }, { id: 'stay', label: $t('原地停留') }];
  var DIRECTIONS = { neutral: { x: 0, y: 0 }, front: { x: 0, y: -1 }, back: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
  var X_SCALE = ShotModel.constants.xScale, Y_SCALE = ShotModel.constants.yScale;
  var SHUTTLE_TOP_OFFSET = 0.05; // Explicit point-shuttle approximation, not an official shuttle dimension.
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function own(o, key) { return typeof key === 'string' && Object.prototype.hasOwnProperty.call(o, key); }
  function initialPlayer(stamina) { return { x: 0, y: 0.52, vx: 0, vy: 0, balance: 94, stamina: stamina === undefined ? 100 : stamina, support: 'open' }; }
  function sanitizeProfile(input) {
    input = input && typeof input === 'object' ? input : {};
    var skills = {}, values = input.skills && typeof input.skills === 'object' ? input.skills : {};
    Object.keys(SKILL_LABELS).forEach(function (id) {
      skills[id] = typeof values[id] === 'number' && Number.isFinite(values[id]) ? clamp(values[id], 0, 100) : 50;
    });
    return { skills: skills, points: typeof input.points === 'number' && Number.isFinite(input.points) ? clamp(Math.floor(input.points), 0, 999) : 4 };
  }
  function seedValue(seed) {
    if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0;
    var text = String(seed === undefined ? 1234 : seed), h = 2166136261;
    for (var i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    return h >>> 0;
  }

  function createMatch(options) {
    options = options || {};
    var seed = seedValue(options.seed), profile = sanitizeProfile(options.profile);
    var mode = options.mode === 'training' ? 'training' : 'singles';
    if (mode === 'singles' && (!CourtRules || !CourtRules.RULES)) throw new Error($t('正式单打需要 court-rules.js'));
    var rules = CourtRules && CourtRules.RULES;
    var winningScore = Number.isInteger(options.winningScore) ? clamp(options.winningScore, 1, 99) : 5;
    var rngState, state, pendingReply, humanContact, footworkCache, humanPrePrediction, lastPublicFlight;
    function random() {
      rngState = (rngState + 0x6D2B79F5) >>> 0;
      var t = rngState;
      t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    function pick(list) { return list[Math.floor(random() * list.length)]; }
    function good() { return { ok: true }; }
    function bad(error) { return { ok: false, error: error }; }
    function note(message) { state.message = message; state.log.push(message); state.log = state.log.slice(-8); }
    function contextFor(who, contact, hypotheticalPlayer) {
      var p = hypotheticalPlayer || state.players[who];
      var stance = Math.max(0, contact.stancePreparationTime === undefined ? contact.preparationTime || 0 : contact.stancePreparationTime);
      var remaining = typeof contact.remainingTime === 'number' ? contact.remainingTime : 0;
      var preparationBonusEligible = contact.preparationBonusEligible !== false && contact.mode !== 'jump';
      var waiting = preparationBonusEligible ? Math.max(0, remaining) : 0;
      return { origin: contact.point ? clone(contact.point) : { x: p.x, y: p.y }, contactHeight: contact.height, balance: p.balance,
        stamina: p.stamina, vx: p.vx, vy: p.vy, waitingTime: waiting,
        preparationTime: stance, stancePreparationTime: stance, remainingTime: remaining,
        availablePreparation: stance + waiting, preparationBonusEligible: preparationBonusEligible,
        contactMode: contact.mode || 'ground', heightBoost: contact.heightBoost || 0,
        allowedMinHeight: contact.allowedMinHeight, allowedMaxHeight: contact.allowedMaxHeight,
        landingRecoveryTime: contact.landingRecoveryTime || 0,
        reachDistance: contact.reachDistance || 0, incomingSpeed: contact.speed || 0,
        incomingVerticalSpeed: contact.verticalSpeed || 0, skills: who === 'human' ? profile.skills : AI_SKILLS };
    }
    function canTrain() { return !state.actionStarted || state.phase === 'matchEnd'; }
    function trainingView() {
      var allowed = canTrain();
      return { canTrain: allowed, points: profile.points, skills: Object.keys(SKILL_LABELS).map(function (id) {
        return { id: id, label: SKILL_LABELS[id], value: profile.skills[id], canUpgrade: allowed && profile.points > 0 && profile.skills[id] < 95 };
      }) };
    }

    function preload(player, prediction) {
      // Anticipation changes boundary-state velocity only, never wall-clock time.
      if (prediction.direction === 'neutral') { player.vx *= 0.56; player.vy *= 0.56; return; }
      var v = DIRECTIONS[prediction.direction], impulse = prediction.commitment === 'strong' ? 1.65 : 0.76;
      player.vx = clamp(player.vx * 0.78 + v.x * impulse / X_SCALE, -1.6, 1.6);
      player.vy = clamp(player.vy * 0.78 + v.y * impulse / Y_SCALE, -0.7, 0.7);
    }

    function footworkOptions(beforePrediction, prediction) {
      var neutral = clone(beforePrediction);
      preload(neutral, { direction: 'neutral', commitment: 'light' });
      return { anticipation: { direction: prediction.direction, commitment: prediction.commitment,
        vector: clone(DIRECTIONS[prediction.direction]), neutralPlayer: neutral } };
    }
    function buildFootwork(player, flight, movementOptions) {
      var limits = Footwork.CONTACT_LIMITS;
      var groundIntervals = ShotModel.contactIntervals(flight, limits.groundMin, limits.groundMax);
      var jumpIntervals = ShotModel.contactIntervals(flight, limits.jumpMin, limits.jumpMax);
      var intervals = [];
      groundIntervals.concat(jumpIntervals).sort(function (a, b) { return a.start - b.start; }).forEach(function (range) {
        var prior = intervals[intervals.length - 1];
        if (prior && range.start <= prior.end + 1e-9) prior.end = Math.max(prior.end, range.end);
        else intervals.push({ start: range.start, end: range.end });
      });
      var windows = Footwork.windowsFor(flight), solutions = Object.create(null), feasible = [];
      // A narrow legal interval may fall between the drawing samples. Preserve
      // that opportunity with an exact analytic fallback, never sample snapping.
      // Test exact representatives for both stances as well as the existing
      // drawing windows, including a jump-only portion above ground reach.
      var extraRanges = groundIntervals.concat(jumpIntervals);
      jumpIntervals.forEach(function (range) {
        var cursor = range.start;
        groundIntervals.forEach(function (ground) {
          if (ground.end <= cursor || ground.start >= range.end) return;
          if (ground.start > cursor) extraRanges.push({ start: cursor, end: Math.min(range.end, ground.start) });
          cursor = Math.max(cursor, ground.end);
        });
        if (cursor < range.end) extraRanges.push({ start: cursor, end: range.end });
      });
      function addContactWindow(time) {
        var point = ShotModel.sampleTrajectory(flight, time);
        if (windows.some(function (window) { return Math.abs(window.time - time) < 1e-9; })) return;
        windows.push({ id: 'contact' + windows.length, time: time, point: { x: point.x, y: point.y },
          height: point.z, speed: point.speed, verticalSpeed: point.vz, available: false });
      }
      extraRanges.forEach(function (range) {
        addContactWindow((range.start + range.end) / 2);
        // A player under pressure may only arrive near the end of a legal
        // height interval. Coarse render samples and a midpoint can miss that
        // real chance. Keep an analytic point just INSIDE the boundary, and
        // subject it to exactly the same movement/height/cost checks for both
        // players. This witness is not a proof that every other time is lost.
        addContactWindow(range.end - Math.min(0.0001, (range.end - range.start) * 0.01));
      });
      windows.forEach(function (window) {
        var found = Footwork.search(player, window, movementOptions);
        window.available = found.ok;
        if (found.ok) { solutions[window.id] = found; feasible.push(found); }
      });
      feasible.sort(function (a, b) { return (b.preview.balance + b.preview.contact.height * 5 - b.preview.staminaCost) - (a.preview.balance + a.preview.contact.height * 5 - a.preview.staminaCost); });
      // This cached result concerns the entire incoming trajectory. It never
      // depends on an edited prefix, selected contact, or failure of the beam.
      var reachability = feasible.length ? { status: 'reachable', method: 'action_witness', reasonCode: 'feasible_action_path',
        reason: $t('至少一个接触时刻已有完整可行动作路径。'), intervalCount: intervals.length,
        checkedRanges: 0, budgetExhausted: false, unresolvedRanges: 0,
        evidence: { contactTime: feasible[0].preview.contactTime, actions: feasible[0].actions.slice() } }
        : Footwork.assessReachability(player, intervals, function (time) { return ShotModel.sampleTrajectory(flight, time); },
          { horizontalModel: 'linear_drag_straight', maxChecks: 256 });
      return { windows: windows, intervals: intervals, unionIntervals: intervals, groundIntervals: groundIntervals, jumpIntervals: jumpIntervals,
        flight: flight, movementOptions: movementOptions,
        solutions: solutions, feasible: feasible, reachability: reachability, continuousSuggestions: Object.create(null),
        defaultId: feasible.length ? feasible[0].contactId : windows.length ? windows[0].id : '' };
    }
    function contactFromPreview(preview) {
      return { height: preview.contact.height, time: preview.contactTime, point: clone(preview.contact.point),
        mode: preview.contact.mode, heightBoost: preview.contact.heightBoost,
        allowedMinHeight: preview.contact.allowedMinHeight, allowedMaxHeight: preview.contact.allowedMaxHeight,
        preparationBonusEligible: preview.contact.preparationBonusEligible,
        landingRecoveryTime: preview.contact.landingRecoveryTime || 0,
        speed: preview.contact.speed, verticalSpeed: preview.contact.verticalSpeed,
        preparationTime: preview.preparationTime, reachDistance: preview.reachDistance,
        stancePreparationTime: preview.stancePreparationTime,
        remainingTime: preview.remainingTime, waitingTime: Math.max(0, preview.remainingTime) };
    }
    function takeFootwork(player, preview) {
      Object.assign(player, preview.finalState);
      return contactFromPreview(preview);
    }
    function receipt(label, before, items, after) {
      var spent = 0, recovered = 0;
      items.forEach(function (item) { if (item.delta < 0) spent -= item.delta; else recovered += item.delta; });
      state.energyReceipt = { label: label, before: before, spent: spent, recovered: recovered, after: after, items: items };
    }
    function applyStroke(player, execution) {
      player.balance = clamp(player.balance - execution.balanceCost, 5, 100);
      player.stamina = clamp(player.stamina - execution.staminaCost, 0, 100);
    }
    function resolveRecovery(selection, player) {
      if (own(selection, 'recovery') && !RECOVERIES.some(function (r) { return r.id === selection.recovery; })) return bad($t('无效的回动指令'));
      if (own(selection, 'recoveryTarget')) {
        var target = selection.recoveryTarget;
        if (!target || typeof target !== 'object' || Array.isArray(target) ||
          !own(target, 'x') || !own(target, 'y') || Object.keys(target).some(function (key) { return key !== 'x' && key !== 'y'; }) ||
          typeof target.x !== 'number' || !Number.isFinite(target.x) || typeof target.y !== 'number' || !Number.isFinite(target.y) ||
          target.x < -1 || target.x > 1 || target.y < 0.025 || target.y > 1) return bad($t('回动目标必须是本人半场内的有效坐标：横向 -1 至 1，纵向 0.025 至 1'));
        return { ok: true, target: { x: target.x, y: target.y }, source: 'custom' };
      }
      if (!own(selection, 'recovery')) return bad($t('请选择回动目标或原地停留'));
      return { ok: true, source: selection.recovery, target: selection.recovery === 'stay' ? { x: player.x, y: player.y }
        : { x: 0, y: selection.recovery === 'front' ? 0.30 : selection.recovery === 'back' ? 0.73 : 0.52 } };
    }
    function recoveryPlan(player, selected, flightDuration) {
      var dx = (selected.target.x - player.x) * X_SCALE, dy = (selected.target.y - player.y) * Y_SCALE, distance = Math.hypot(dx, dy);
      var label = $t('原地停留');
      if (distance > 1e-9) {
        var sector = (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8;
        label = [$t('向右'), $t('向右后'), $t('向后'), $t('向左后'), $t('向左'), $t('向左前'), $t('向前'), $t('向右前')][sector];
      }
      return { from: { x: player.x, y: player.y }, target: clone(selected.target),
        direction: { x: distance > 0 ? dx / distance : 0, y: distance > 0 ? dy / distance : 0 },
        label: label, source: selected.source, status: 'revealed', to: null, elapsed: null, moved: null, reached: null,
        distance: distance, fullFlightDuration: flightDuration };
    }
    function forecastRecovery(player, target, duration, execution, basis) {
      var result = RecoveryModel.evaluate(player, target, duration, { strokeDelay: execution.recoveryTime });
      if (!result.ok) return result;
      result.estimatedTo = result.to; result.estimatedDistance = result.moved; result.estimatedReached = result.reached;
      result.expectedStaminaAfter = result.finalState.stamina;
      result.expectedBalanceAfter = result.finalState.balance;
      result.fullFlightDuration = duration; result.basis = basis || 'predicted_full_flight';
      result.notice = $t('按完整飞行时长估计；对手提前截击会缩短回动，参考圈不保证各方向可达。');
      delete result.to; delete result.moved; delete result.reached; delete result.finalState;
      return result;
    }
    function annotateRecoveryPlan(plan, player, execution) {
      var forecast = forecastRecovery(player, plan.target, plan.fullFlightDuration, execution, 'revealed_full_flight');
      if (!forecast.ok) throw new Error(forecast.error);
      Object.assign(plan, forecast);
      // A forecast must never masquerade as an already executed endpoint.
      plan.status = 'revealed'; plan.to = null; plan.elapsed = null; plan.moved = null; plan.reached = null;
    }
    function recover(player, plan, elapsed, execution) {
      if (!plan.estimatedTo) annotateRecoveryPlan(plan, player, execution);
      var result = RecoveryModel.evaluate(player, plan.target, elapsed, { strokeDelay: execution.recoveryTime });
      if (!result.ok) throw new Error(result.error);
      Object.assign(player, result.finalState);
      var estimatedTo = plan.estimatedTo, estimatedDistance = plan.estimatedDistance;
      Object.assign(plan, result, { status: 'completed', estimatedTo: estimatedTo, estimatedDistance: estimatedDistance });
      delete plan.finalState;
      return Object.assign({}, result, { choice: plan.source, label: plan.label, fullFlightDuration: plan.fullFlightDuration,
        estimatedTo: clone(estimatedTo), estimatedDistance: estimatedDistance });
    }

    function changeEnds(reason) {
      state.ends.human = state.ends.human === 'near' ? 'far' : 'near';
      state.ends.ai = state.ends.human === 'near' ? 'far' : 'near';
      state.ends.changes++;
      state.ends.reason = reason;
    }
    function rememberFlight(hitter, trajectory) {
      // Result graphics describe the last released, public stroke. Incoming
      // and lastMotion are transient and may instead hold a previous stroke,
      // no trajectory, or a receiver path. Never inspect a hidden AI reply.
      lastPublicFlight = { hitter: hitter, receiver: other(hitter), trajectory: clone(trajectory),
        endTime: trajectory.duration, endReason: 'terminal' };
    }
    function rememberContact(time) {
      if (!lastPublicFlight) return;
      lastPublicFlight.endTime = clamp(time, 0, lastPublicFlight.trajectory.duration);
      lastPublicFlight.endReason = 'contact';
    }
    function finishPoint(winner, reason) {
      state.score[winner]++;
      state.lastResult = { winner: winner, reason: reason, finalFlight: lastPublicFlight ? clone(lastPublicFlight) : null };
      if (mode === 'training') state.phase = state.score[winner] >= winningScore ? 'matchEnd' : 'pointEnd';
      else {
        state.server = winner;
        var gameWinner = CourtRules.gameWinner(state.score);
        if (gameWinner) {
          state.gameWins[gameWinner]++;
          state.completedGames.push({ game: state.gameNumber, winner: gameWinner, score: clone(state.score) });
          state.lastResult.gameWinner = gameWinner;
          state.phase = CourtRules.matchWinner(state.gameWins) ? 'matchEnd' : 'gameEnd';
        } else {
          state.phase = 'pointEnd';
          if (state.gameNumber === rules.bestOf && !state.deciderChanged && Math.max(state.score.human, state.score.ai) >= rules.changeEndsDeciderAt) {
            changeEnds($t('决胜局领先方达到 ') + rules.changeEndsDeciderAt + $t(' 分')); state.deciderChanged = true;
          }
        }
      }
      if (state.phase === 'matchEnd' && !state.rewarded) { profile.points = Math.min(999, profile.points + 2); state.rewarded = true; }
      pendingReply = null; footworkCache = null; humanContact = null; humanPrePrediction = null;
      note((winner === 'human' ? $t('你得分：') : $t('对手得分：')) + reason + (state.phase === 'matchEnd' ? $t(' 完成本局，获得 2 点练习点。') : ''));
    }
    function failureReason(flight) {
      return flight.terminal === 'net' ? $t('球路触网，按实际碰网时刻结算。') : flight.netClearance === null ? $t('球未越过球网，落在己方半场。') : $t('球的实际落点出界。');
    }
    function finishContactMiss(who, execution) {
      // The incoming flight, receiver path and opponent recovery have already
      // advanced to this exact interception. A missed swing ends the attempt
      // here; it creates no new flight or extra recovery/time budget.
      var player = state.players[who], staminaBefore = player.stamina;
      applyStroke(player, execution);
      var spent = staminaBefore - player.stamina;
      state.recoveryPlans[who] = null; state.incoming = null;
      state.lastMotion = { receiver: other(who), hitter: who, contactMiss: true, contactHit: false,
        duration: 0, trajectory: null, contactAccuracy: clone(execution.contactAccuracy),
        strokeStaminaCost: spent, balanceCost: execution.balanceCost };
      if (who === 'human') receipt($t('挥拍未命中'), staminaBefore, [{ label: $t('挥拍'), delta: -spent }], player.stamina);
      var accuracy = execution.contactAccuracy;
      finishPoint(other(who), (who === 'human' ? $t('你') : $t('对手')) + $t('挥拍未命中：截击球速 ') + accuracy.speed.toFixed(1)
        + $t(' 米/秒，本次命中率 ') + (accuracy.hitProbability * 100).toFixed(1) + $t('%。'));
      state.lastResult.reasonCode = 'contact_miss'; state.lastResult.hitter = who;
      state.lastResult.elapsedAdded = 0; state.lastResult.contactAccuracy = clone(accuracy);
    }
    function aiPrediction() {
      // No current shot/control argument. Only already-public preparation state.
      var roll = random(), direction = 'neutral';
      if (roll > 0.3) direction = roll > 0.82 ? pick(['left', 'right']) : random() < (state.players.human.y < 0.38 ? 0.53 : 0.50) ? 'front' : 'back';
      return { direction: direction, commitment: random() < 0.28 ? 'strong' : 'light' };
    }
    function chooseAiReply(contact) {
      var context = contextFor('ai', contact), candidates = [];
      for (var i = 0; i < 3; i++) {
        var side = random() < 0.65 ? (state.players.human.x >= 0 ? -1 : 1) : (random() < 0.5 ? -1 : 1);
        var depth = random(), target = { x: side * (0.28 + random() * 0.42), y: depth < 0.34 ? 0.15 + random() * 0.17 : depth < 0.64 ? 0.43 + random() * 0.18 : 0.70 + random() * 0.17 };
        // One candidate exploits a high contact with a flatter launch; the
        // others retain lift/touch variety. No categorical shot switch.
        var preferred = i === 0 ? clamp(7 - 12 * (contact.height - 1.5) + (random() - 0.5) * 8, -24, 30)
          : i === 1 ? 38 + random() * 28 : 3 + random() * 30;
        var assisted = ShotModel.assist(context, target, preferred);
        if (assisted.ok) candidates.push(assisted);
      }
      candidates.sort(function (a, b) {
        var distanceA = Math.hypot((a.controls.target.x - state.players.human.x) * X_SCALE, (a.controls.target.y - state.players.human.y) * Y_SCALE);
        var distanceB = Math.hypot((b.controls.target.x - state.players.human.x) * X_SCALE, (b.controls.target.y - state.players.human.y) * Y_SCALE);
        var timePressure = 1.25 + clamp(contact.height - 1.6, 0, 1.4) * 0.60;
        var scoreA = (a.preview.valid ? 20 : 0) + distanceA - a.preview.trajectory.duration * timePressure;
        var scoreB = (b.preview.valid ? 20 : 0) + distanceB - b.preview.trajectory.duration * timePressure;
        return scoreB - scoreA;
      });
      var selected = random() < 0.70 ? candidates[0] : pick(candidates);
      // One execution sample only. No reroll after seeing where the ball went.
      var execution = ShotModel.execute(context, selected.controls, random), recoveryRoll = random();
      // A continuous coverage target, fixed with the reply but kept private
      // until its stroke is revealed. This is prototype strategy, not coaching.
      return { execution: execution, recovery: { source: 'ai', target: {
        x: clamp(selected.controls.target.x * 0.25 + (recoveryRoll - 0.5) * 0.70, -0.55, 0.55),
        y: 0.34 + recoveryRoll * 0.36 } } };
    }

    function other(who) { return who === 'human' ? 'ai' : 'human'; }
    function defaultServicePosition(who, side, depth) {
      var region = CourtRules.serviceRegion(who, side, state.ends.human);
      return { x: (region.xMin + region.xMax) / 2, y: depth };
    }
    function beginService() {
      var server = state.server, receiver = other(server), side = CourtRules.serverSide(state.score[server]);
      var serverPosition = defaultServicePosition(server, side, 0.40), receiverPosition = defaultServicePosition(receiver, side, 0.62);
      Object.assign(state.players[server], serverPosition, { vx: 0, vy: 0 });
      Object.assign(state.players[receiver], receiverPosition, { vx: 0, vy: 0 });
      state.service = { server: server, receiver: receiver, side: side, receiverSide: side,
        serverPosition: serverPosition, receiverPosition: receiverPosition,
        serverRegion: CourtRules.serviceRegion(server, side, state.ends.human), receiverRegion: CourtRules.serviceRegion(receiver, side, state.ends.human),
        contactHeight: 1.05, contactHeightMin: 0.25, contactHeightMax: 1.149, shuttleTopOffset: SHUTTLE_TOP_OFFSET,
        footMargin: CourtRules.MODEL.serviceFootMargin, angleMin: -30, angleMax: 75, powerMin: 0.05, powerMax: 1,
        status: 'ready', fault: null, feetLockedUntilRelease: true, stancePreparationTime: 0.80, remainingTime: 0, availablePreparation: 0.80 };
      state.phase = 'serve'; pendingReply = null;
      if (server === 'ai') {
        var short = random() < 0.30;
        var target = defaultServicePosition(receiver, side, short ? 0.44 : 0.78);
        var context = servingContext('ai', state.service);
        var aim = ShotModel.assist(context, target, short ? 31 : 51);
        var execution = ShotModel.execute(context, aim.controls, random);
        pendingReply = { execution: execution, recovery: { source: 'ai', target: { x: target.x * 0.20, y: 0.52 } },
          service: { serverPosition: clone(serverPosition), contactHeight: state.service.contactHeight, angle: execution.launch.angle } };
      }
      note((server === 'human' ? $t('你') : $t('对手')) + $t('在') + (side === 'right' ? $t('右') : $t('左')) + $t('发球区发球；') +
        (server === 'human' ? $t('选择站位、整球高度和连续球路，发球须进入对角区。') : $t('先选择合法接发站位，再锁定预判；来球尚未揭露。')));
    }
    function validServiceSetup(selection) {
      var p = selection && selection.serverPosition;
      if (!p || typeof p !== 'object' || Array.isArray(p) || !own(p, 'x') || !own(p, 'y') ||
        typeof p.x !== 'number' || !Number.isFinite(p.x) || typeof p.y !== 'number' || !Number.isFinite(p.y) ||
        Math.abs(p.x) > 10 || Math.abs(p.y) > 10) return $t('请选择有效的发球站位坐标');
      if (typeof selection.contactHeight !== 'number' || !Number.isFinite(selection.contactHeight) ||
        selection.contactHeight <= SHUTTLE_TOP_OFFSET || selection.contactHeight > 3) return $t('整球最高点高度必须是大于 0.05 米的有效数值');
      return '';
    }
    function servingContext(who, setup) {
      var player = Object.assign({}, state.players[who], setup.serverPosition, { vx: 0, vy: 0 });
      return contextFor(who, { point: setup.serverPosition, height: setup.contactHeight - SHUTTLE_TOP_OFFSET,
        preparationTime: 0.80, stancePreparationTime: 0.80, remainingTime: 0, waitingTime: 0 }, player);
    }
    function serviceFaults(setup, server, trajectory) {
      var faults = [], side = state.service.side;
      if (!CourtRules.servicePositionLegal(setup.serverPosition, side, server, state.ends.human, CourtRules.MODEL.serviceFootMargin)) faults.push($t('发球站位必须在正确发球区内，双脚支撑范围不能触及边线'));
      if (!CourtRules.serviceHeightLegal(setup.contactHeight)) faults.push($t('击球瞬间整只球必须低于 1.15 米'));
      var angle = trajectory ? trajectory.launch.angle : setup.angle;
      if (angle !== undefined && angle <= 0) faults.push($t('发球离拍时必须向上飞行'));
      if (trajectory) {
        if (!trajectory.valid) faults.push(failureReason(trajectory));
        else if (!CourtRules.landingLegal(trajectory.landing, side, server, state.ends.human)) faults.push($t('发球必须落入对角接发球区，不能落在同侧或短发球线之前'));
      }
      return faults;
    }
    function previewServe(selection) {
      if (state.phase !== 'serve' || state.server !== 'human') return bad($t('当前不是你的发球准备阶段'));
      var invalid = validServiceSetup(selection) || ShotModel.validateControls(selection);
      if (invalid) return bad(invalid);
      var preview = ShotModel.preview(servingContext('human', selection), selection);
      if (!preview.ok) return preview;
      var faults = serviceFaults(selection, 'human', preview.trajectory);
      preview.service = { legal: faults.length === 0, faults: faults, wholeShuttleTop: selection.contactHeight,
        launchPointHeight: selection.contactHeight - SHUTTLE_TOP_OFFSET, side: state.service.side };
      preview.valid = preview.valid && !faults.length;
      if (faults.length) preview.warning = $t('发球违例：') + faults.join($t('；'));
      return preview;
    }
    function scanServeControls(selection) {
      if (state.phase !== 'serve' || state.server !== 'human') return bad($t('当前不是你的发球准备阶段'));
      var invalid = validServiceSetup(selection) || ShotModel.validateControls(selection);
      if (invalid) return bad(invalid);
      var scan = ShotModel.scanControls(servingContext('human', selection), selection);
      if (scan.ok) scan.service = previewServe(selection).service;
      return scan;
    }
    function assistServe(setup, target, preferredAngle, assistOptions) {
      if (state.phase !== 'serve' || state.server !== 'human') return bad($t('当前不是你的发球准备阶段'));
      var invalid = validServiceSetup(setup);
      if (invalid) return bad(invalid);
      if (!ShotModel.validTarget(target)) return bad($t('落点意图必须在对方半场内'));
      if (assistOptions && assistOptions.lockAngle === true && preferredAngle === undefined) return bad($t('锁定角度时须指定 -30° 至 75° 的有效角度'));
      if (preferredAngle === undefined) {
        // A deep service target starts as a high serve. Smooth interpolation
        // retains continuous controls and leaves explicit AI preferences alone.
        var depth = clamp((target.y - 0.30) / 0.52, 0, 1);
        preferredAngle = 12 + 50 * depth * depth * (3 - 2 * depth);
      }
      var assisted = ShotModel.assist(servingContext('human', setup), target, preferredAngle, assistOptions);
      if (!assisted.ok) return assisted;
      assisted.controls = Object.assign({}, assisted.controls, { serverPosition: clone(setup.serverPosition), contactHeight: setup.contactHeight });
      assisted.preview = previewServe(assisted.controls);
      if (assisted.aimWarning) assisted.preview.warning = assisted.aimWarning + assisted.preview.warning;
      return assisted;
    }
    function commitServe(selection) {
      if (state.phase !== 'serve' || state.server !== 'human') return bad($t('当前不能由你发球'));
      var invalid = validServiceSetup(selection) || ShotModel.validateControls(selection);
      if (invalid) return bad(invalid);
      var recovery = resolveRecovery(selection, Object.assign({}, state.players.human, selection.serverPosition));
      if (!recovery.ok) return recovery;
      // From here a complete, well-formed command is an attempted service.
      state.actionStarted = true;
      state.service.serverPosition = clone(selection.serverPosition); state.service.contactHeight = selection.contactHeight;
      state.service.status = 'released';
      Object.assign(state.players.human, selection.serverPosition, { vx: 0, vy: 0 });
      var faults = serviceFaults(selection, 'human');
      if (faults.length) {
        state.service.status = 'fault'; state.service.fault = faults.join($t('；'));
        state.lastMotion = { receiver: 'ai', serviceFault: true, duration: 0, trajectory: null };
        finishPoint('ai', $t('发球违例：') + state.service.fault); return good();
      }
      return playHumanStroke(selection, servingContext('human', selection), selection);
    }
    function confirmReceive(selection) {
      if (state.phase !== 'serve' || state.server !== 'ai') return bad($t('当前不是等待对手发球的阶段'));
      var position = selection && selection.receiverPosition;
      if (!CourtRules.servicePositionLegal(position, state.service.side, 'human', state.ends.human, CourtRules.MODEL.serviceFootMargin)) return bad($t('接发站位必须在对角接发球区内，双脚支撑范围不能触线'));
      state.service.receiverPosition = { x: position.x, y: position.y }; state.service.status = 'awaiting_prediction';
      Object.assign(state.players.human, state.service.receiverPosition, { vx: 0, vy: 0 });
      state.phase = 'predict'; state.actionStarted = true;
      note($t('接发站位已固定。锁定预判后才揭露发球，双方在离拍前保持静止。')); return good();
    }

    function beginRally() {
      lastPublicFlight = null;
      var hs = state.players ? clamp(state.players.human.stamina + 42, 72, 100) : 100;
      var as = state.players ? clamp(state.players.ai.stamina + 42, 72, 100) : 100;
      state.players = { human: initialPlayer(hs), ai: initialPlayer(as) }; state.players.ai.y = 0.45;
      state.phase = 'predict'; state.incoming = null; state.prediction = null; footworkCache = null;
      state.recoveryPlans = { human: null, ai: null };
      state.lastResult = null; state.lastMotion = null; state.lastReachability = null; state.rallyHits = 0; humanContact = null;
      if (mode === 'singles') { beginService(); return; }
      var context = contextFor('ai', { height: 1.8, stancePreparationTime: 0.80, remainingTime: 0 });
      var serve = ShotModel.assist(context, { x: random() < 0.5 ? -0.48 : 0.48, y: 0.82 }, 51);
      // Mean-only teaching serve still uses the same model and reveal-time costs.
      pendingReply = { execution: ShotModel.execute(context, serve.controls, random, true), recovery: { source: 'center', target: { x: 0, y: 0.52 } } };
      note($t('训练发球：先锁定启动方向，揭露后选择接触窗口。思考不消耗场内时间。'));
    }
    function reset() {
      rngState = seed; lastPublicFlight = null;
      state = { phase: 'predict', score: { human: 0, ai: 0 }, simTime: 0, players: null,
        message: '', log: [], incoming: null, prediction: null, lastResult: null, lastFootwork: null, energyReceipt: null,
        rallyHits: 0, actionStarted: false, rewarded: false };
      if (mode === 'singles') {
        var tossWinner = random() < 0.5 ? 'human' : 'ai';
        var firstServer = options.firstServer === 'human' || options.firstServer === 'ai' ? options.firstServer : tossWinner;
        var end = options.humanEnd === 'near' || options.humanEnd === 'far' ? options.humanEnd : 'near';
        state.server = firstServer; state.gameNumber = 1; state.gameWins = { human: 0, ai: 0 }; state.completedGames = []; state.deciderChanged = false;
        state.ends = { human: end, ai: end === 'near' ? 'far' : 'near', changes: 0, reason: $t('开局场地') };
        var configured = options.firstServer === 'human' || options.firstServer === 'ai';
        state.toss = { winner: tossWinner, choice: configured ? 'configured' : null, firstServer: configured ? firstServer : null,
          initialHumanEnd: configured ? end : null, automatic: false, configured: configured,
          aiChoice: !configured && tossWinner === 'ai' ? 'serve' : null,
          availableChoices: configured ? [] : tossWinner === 'human' ? ['serve', 'receive', 'near', 'far'] : ['near', 'far'] };
        if (!configured) {
          state.phase = 'toss'; state.players = { human: initialPlayer(), ai: initialPlayer() };
          state.recoveryPlans = { human: null, ai: null }; state.service = null;
          note(tossWinner === 'human' ? $t('你赢得掷签：可选择先发、先接，或优先选择场地。') : $t('对手赢得掷签并选择先发；请选择你的起始场地。'));
          return good();
        }
      }
      beginRally(); return good();
    }
    function chooseToss(choice) {
      if (state.phase !== 'toss' || mode !== 'singles') return bad($t('当前不能选择掷签结果'));
      if (state.toss.availableChoices.indexOf(choice) < 0) return bad($t('请选择当前可用的先发、先接或场地选项'));
      state.toss.choice = choice;
      if (choice === 'serve' || choice === 'receive') {
        state.server = choice === 'serve' ? 'human' : 'ai';
        state.ends.human = random() < 0.5 ? 'near' : 'far';
        state.toss.aiChoice = state.ends.human === 'near' ? 'far' : 'near';
      } else { state.ends.human = choice; state.server = 'ai'; state.toss.aiChoice = 'serve'; }
      state.ends.ai = state.ends.human === 'near' ? 'far' : 'near';
      state.toss.firstServer = state.server; state.toss.initialHumanEnd = state.ends.human; state.toss.availableChoices = [];
      beginRally(); return good();
    }
    function getView() {
      var liveContext = state.phase === 'shot' ? contextFor('human', humanContact) : null;
      var context = state.phase === 'shot' ? { contactHeight: humanContact.height,
        contactMode: liveContext.contactMode, heightBoost: liveContext.heightBoost,
        allowedMinHeight: liveContext.allowedMinHeight, allowedMaxHeight: liveContext.allowedMaxHeight,
        landingRecoveryTime: liveContext.landingRecoveryTime, preparationBonusEligible: liveContext.preparationBonusEligible,
        origin: clone(humanContact.point), bodyPosition: { x: state.players.human.x, y: state.players.human.y },
        remainingTime: humanContact.remainingTime, preparationTime: humanContact.preparationTime,
        stancePreparationTime: humanContact.stancePreparationTime, reachDistance: humanContact.reachDistance,
        availablePreparation: liveContext.availablePreparation,
        incomingSpeed: humanContact.speed || 0, incomingVerticalSpeed: humanContact.verticalSpeed || 0,
        contactAccuracy: ShotModel.contactAccuracy(humanContact.speed || 0),
        angleMin: -30, angleMax: 75, powerMin: 0.05, powerMax: 1 } : null;
      var footwork = state.phase === 'route' && footworkCache ? { actions: Footwork.ACTIONS, guide: Footwork.GUIDE,
        contactWindows: footworkCache.windows, contactIntervals: footworkCache.intervals,
        groundContactIntervals: footworkCache.groundIntervals, jumpContactIntervals: footworkCache.jumpIntervals,
        contactHeightLimits: Footwork.CONTACT_LIMITS,
        defaultContactId: footworkCache.defaultId,
        defaultContactTime: footworkCache.windows.find(function (w) { return w.id === footworkCache.defaultId; }).time,
        maxActions: Footwork.MAX_ACTIONS, reachability: footworkCache.reachability } : null;
      return clone({ mode: mode, directionFrame: 'world_x_own_depth', phase: state.phase, score: state.score, simTime: state.simTime, players: state.players,
        message: state.message, log: state.log, incoming: state.incoming, prediction: state.prediction,
        routeOptions: [], shotOptions: [], targetOptions: [], recoveryOptions: RECOVERIES, recoveryPlans: state.recoveryPlans,
        lastResult: state.lastResult, lastMotion: state.lastMotion, rallyHits: state.rallyHits,
        winningScore: mode === 'training' ? winningScore : rules.pointsToWin, shotContext: context, training: trainingView(), footwork: footwork,
        rules: mode === 'singles' ? rules : null, service: state.service || null, server: state.server || null,
        toss: state.toss || null, ends: state.ends || { human: 'near', ai: 'far', changes: 0 },
        gameNumber: state.gameNumber || 1, gameWins: state.gameWins || { human: 0, ai: 0 }, completedGames: state.completedGames || [],
        lastFootwork: state.lastFootwork, energyReceipt: state.energyReceipt, lastReachability: state.lastReachability });
    }
    function getProfile() { return clone(profile); }
    function trainSkill(id) {
      if (!own(SKILL_LABELS, id)) return bad($t('无效的练习项目'));
      if (!canTrain()) return bad($t('练习仅能在开局前或整场结束后进行'));
      if (profile.points < 1) return bad($t('练习点不足'));
      if (profile.skills[id] >= 95) return bad($t('该技能已达到演示版练习上限'));
      var increase = Math.min(5, 95 - profile.skills[id]);
      profile.points--; profile.skills[id] += increase;
      note(SKILL_LABELS[id] + $t('提升 ') + increase + $t(' 点：改善控制精度与动作效率，不改变接触高度。'));
      return good();
    }
    function previewShot(controls) {
      if (state.phase !== 'shot') return bad($t('当前没有可击球的接触状态'));
      return ShotModel.preview(contextFor('human', humanContact), controls);
    }
    function scanShotControls(controls) {
      if (state.phase !== 'shot') return bad($t('当前没有可击球的接触状态'));
      return ShotModel.scanControls(contextFor('human', humanContact), controls);
    }
    function assistAim(target, preferredAngle, assistOptions) {
      if (state.phase !== 'shot') return bad($t('当前没有可击球的接触状态'));
      return ShotModel.assist(contextFor('human', humanContact), target, preferredAngle, assistOptions);
    }
    function recoveryPreviewFrom(player, selection, shotPreview, noFlight) {
      if (!shotPreview || !shotPreview.ok) return shotPreview || bad($t('当前没有可用的击球预测'));
      var selected = resolveRecovery(selection, player);
      if (!selected.ok) return selected;
      if (!Number.isFinite(shotPreview.balanceCost)) return bad($t('当前击球模型缺少同源的后坐力预测'));
      var postStroke = Object.assign({}, player), execution = { staminaCost: shotPreview.staminaCost,
        balanceCost: shotPreview.balanceCost, recoveryTime: shotPreview.recoveryTime };
      // A pre-release service fault produces neither stroke nor recovery time.
      if (!noFlight) applyStroke(postStroke, execution);
      var forecast = forecastRecovery(postStroke, selected.target, noFlight ? 0 : shotPreview.trajectory.duration, execution);
      if (forecast.ok) {
        forecast.source = selected.source;
        if (noFlight) forecast.reason = $t('发球准备违例，不产生飞行或回动时间');
      }
      return forecast;
    }
    function previewRecovery(selection) {
      if (state.phase === 'shot') return recoveryPreviewFrom(state.players.human, selection, previewShot(selection), false);
      if (state.phase === 'serve' && state.server === 'human') {
        var preview = previewServe(selection);
        if (!preview.ok) return preview;
        var player = Object.assign({}, state.players.human, selection.serverPosition, { vx: 0, vy: 0 });
        return recoveryPreviewFrom(player, selection, preview, serviceFaults(selection, 'human').length > 0);
      }
      return bad($t('仅能在击球或本人发球准备阶段预览回动'));
    }
    function previewRecoveryAfterFootwork(plan, selection) {
      var preview = previewFootwork(plan);
      if (!preview.ok) return preview;
      if (!preview.valid || !preview.canHit) return bad(preview.reason);
      var shot = ShotModel.preview(contextFor('human', contactFromPreview(preview), preview.finalState), selection);
      return recoveryPreviewFrom(preview.finalState, selection, shot, false);
    }
    function previewShotAfterFootwork(plan, controls) {
      var preview = previewFootwork(plan);
      if (!preview.ok) return preview;
      if (!preview.valid || !preview.canHit) return bad(preview.reason);
      return ShotModel.preview(contextFor('human', contactFromPreview(preview), preview.finalState), controls);
    }
    function scanShotControlsAfterFootwork(plan, controls) {
      var preview = previewFootwork(plan);
      if (!preview.ok) return preview;
      if (!preview.valid || !preview.canHit) return bad(preview.reason);
      return ShotModel.scanControls(contextFor('human', contactFromPreview(preview), preview.finalState), controls);
    }
    function assistAimAfterFootwork(plan, target, preferredAngle, assistOptions) {
      var preview = previewFootwork(plan);
      if (!preview.ok) return preview;
      if (!preview.valid || !preview.canHit) return bad(preview.reason);
      return ShotModel.assist(contextFor('human', contactFromPreview(preview), preview.finalState), target, preferredAngle, assistOptions);
    }
    function predict(direction, commitment) {
      commitment = commitment === undefined ? 'light' : commitment;
      if (state.phase !== 'predict') return bad($t('当前不能预判'));
      if (!own(DIRECTIONS, direction)) return bad($t('无效的启动方向'));
      if (commitment !== 'light' && commitment !== 'strong') return bad($t('无效的承诺强度'));
      // Keep the boundary BEFORE this choice. A neutral comparison must retain
      // prior rally/recovery momentum instead of zeroing an already biased one.
      humanPrePrediction = clone(state.players.human);
      state.actionStarted = true; state.prediction = { direction: direction, commitment: direction === 'neutral' ? 'light' : commitment };
      preload(state.players.human, state.prediction);
      var execution = pendingReply.execution, flight = execution.trajectory;
      // The hidden reply already sampled contact once. Revealing it must not
      // reroll that result or charge the just-completed incoming flight twice.
      if (execution.contactHit === false) { finishContactMiss('ai', execution); return good(); }
      rememberFlight('ai', flight);
      var serveFaults = pendingReply.service ? serviceFaults(pendingReply.service, 'ai', flight) : [];
      if (pendingReply.service) { state.service.status = serveFaults.length ? 'fault' : 'released'; state.service.fault = serveFaults.length ? serveFaults.join($t('；')) : null; }
      state.incoming = { description: $t('连续球路'), target: clone(flight.landing), duration: flight.duration,
        initialSpeed: flight.initialSpeed, apex: flight.apex, netClearance: flight.netClearance, trajectory: clone(flight) };
      state.recoveryPlans.ai = recoveryPlan(state.players.ai, pendingReply.recovery, flight.duration);
      // No costs or recoil were exposed until anticipation was locked.
      applyStroke(state.players.ai, execution);
      annotateRecoveryPlan(state.recoveryPlans.ai, state.players.ai, execution);
      if (serveFaults.length) {
        state.simTime += flight.duration;
        var serveRecovery = recover(state.players.ai, state.recoveryPlans.ai, flight.duration, execution);
        state.lastMotion = { receiver: 'human', serviceFault: true, duration: flight.duration, trajectory: clone(flight), recovery: serveRecovery };
        finishPoint('human', $t('发球违例：') + serveFaults.join($t('；'))); return good();
      }
      if (!flight.valid) {
        state.simTime += flight.duration; recover(state.players.ai, state.recoveryPlans.ai, flight.duration, execution);
        finishPoint('human', failureReason(flight)); return good();
      }
      footworkCache = buildFootwork(state.players.human, flight, footworkOptions(humanPrePrediction, state.prediction)); state.phase = 'route';
      state.lastReachability = clone(footworkCache.reachability);
      note($t('球路揭露：初速 ') + flight.initialSpeed.toFixed(1) + $t(' 米/秒，最高 ') + flight.apex.toFixed(1) + $t(' 米。选择接触窗口，再连接步伐节点。'));
      if (!footworkCache.intervals.length) {
        state.simTime += flight.duration; recover(state.players.ai, state.recoveryPlans.ai, flight.duration, execution);
        finishPoint('ai', $t('实际弹道没有进入原型可接触的高度与位置范围。'));
      } else if (footworkCache.reachability.status === 'unreachable') {
        var proof = clone(footworkCache.reachability);
        state.simTime += flight.duration;
        var recovery = recover(state.players.ai, state.recoveryPlans.ai, flight.duration, execution);
        state.lastMotion = { receiver: 'human', automaticMiss: true, duration: flight.duration,
          recovery: recovery, trajectory: clone(flight), reachability: proof };
        finishPoint('ai', proof.reason);
      } else if (!footworkCache.feasible.length) {
        note($t('有限搜索未找到路径；你仍可尝试手动构图，或放弃本拍。'));
      }
      return good();
    }
    function resolveContact(plan) {
      if (state.phase !== 'route' || !footworkCache) return bad($t('当前不能规划步伐'));
      if (!plan || typeof plan !== 'object') return bad($t('请选择接触时刻和动作路径'));
      var time, legacy;
      if (Object.prototype.hasOwnProperty.call(plan, 'contactTime')) {
        if (typeof plan.contactTime !== 'number' || !Number.isFinite(plan.contactTime) || plan.contactTime < 0 || plan.contactTime > footworkCache.flight.duration) return bad($t('接触时间必须位于本次实际飞行时段内'));
        time = plan.contactTime;
        legacy = footworkCache.windows.find(function (w) { return Math.abs(w.time - time) < 1e-10; });
      } else {
        legacy = footworkCache.windows.find(function (w) { return w.id === plan.contactId; });
        if (!legacy) return bad($t('无效的接触窗口'));
        time = legacy.time;
      }
      var sample = ShotModel.sampleTrajectory(footworkCache.flight, time);
      if (!sample) return bad($t('该时刻没有实际弹道数据'));
      var usable = footworkCache.intervals.some(function (range) { return time >= range.start - 1e-9 && time <= range.end + 1e-9; });
      var reason = '';
      if (!usable) reason = sample.y < 0.025 ? $t('球尚未进入可截击半场') : Math.abs(sample.x) > 1 || sample.y > 1 ? $t('球已超出可截击场区')
        : sample.z > Footwork.CONTACT_LIMITS.jumpMax ? $t('球过高，已超出跳跃击球触及高度') : sample.z < Footwork.CONTACT_LIMITS.groundMin ? $t('球过低，已错过有效击球高度') : $t('尚未到可接球的时间范围');
      return { ok: true, usable: usable, reason: reason, window: {
        id: legacy ? legacy.id : 'continuous', time: time, point: { x: sample.x, y: sample.y },
        height: sample.z, speed: sample.speed, verticalSpeed: sample.vz, available: usable } };
    }
    function previewFootwork(plan) {
      var resolved = resolveContact(plan);
      if (!resolved.ok) return resolved;
      var preview = Footwork.preview(state.players.human, resolved.window, plan.actions, footworkCache.movementOptions);
      if (!preview.ok) return preview;
      preview.contact.isUsable = resolved.usable && preview.contact.height >= preview.contact.allowedMinHeight - 1e-9
        && preview.contact.height <= preview.contact.allowedMaxHeight + 1e-9;
      var ranges = footworkCache.intervals;
      preview.latestContactTime = ranges.length ? ranges[ranges.length - 1].end : null;
      preview.opponentRecoveryDenied = resolved.usable && preview.latestContactTime !== null ? Math.max(0, preview.latestContactTime - resolved.window.time) : null;
      if (!resolved.usable) { preview.valid = false; preview.canHit = false; preview.reason = resolved.reason; }
      preview.anticipation = compareAnticipation(preview, resolved.window);
      return preview;
    }
    function compareAnticipation(actual, window) {
      var prediction = state.prediction || { direction: 'neutral', commitment: 'light' };
      var comparison = { available: false, actualTime: actual.totalTime, neutralTime: null, deltaSeconds: null,
        comparisonStage: null, direction: prediction.direction, commitment: prediction.commitment,
        baseline: 'same_path_neutral', reason: '' };
      if (!actual.actions.length) { comparison.reason = $t('选动作后可对照同一段路径'); return comparison; }
      if (!actual.valid || actual.actionResults.length !== actual.actions.length) {
        comparison.reason = $t('当前路径未完整执行，不能对照耗时'); return comparison;
      }
      if (!humanPrePrediction) { comparison.reason = $t('本拍缺少预判前状态，不能对照'); return comparison; }
      var neutralStart = clone(humanPrePrediction);
      preload(neutralStart, { direction: 'neutral', commitment: 'light' });
      var neutral = prediction.direction === 'neutral' ? actual : Footwork.preview(neutralStart, window, actual.actions);
      if (!neutral.ok || !neutral.valid || neutral.actionResults.length !== actual.actions.length) {
        comparison.reason = $t('中性预判下同一路径无法完整执行，不能对照耗时'); return comparison;
      }
      comparison.available = true;
      comparison.neutralTime = neutral.totalTime;
      comparison.deltaSeconds = actual.totalTime - neutral.totalTime;
      comparison.comparisonStage = actual.canHit && neutral.canHit ? 'complete' : 'prefix';
      comparison.reason = comparison.comparisonStage === 'complete' ? $t('同一接球时刻、同一路径的中性预判对照') : $t('仅比较双方完整执行的已选动作段');
      return comparison;
    }
    function previewAnticipation(plan) {
      var preview = previewFootwork(plan);
      return preview.ok ? Object.assign({ ok: true }, preview.anticipation) : preview;
    }
    function suggestFootwork(selection) {
      if (state.phase !== 'route' || !footworkCache) return bad($t('当前不能搜索步伐'));
      var plan = selection && typeof selection === 'object' ? selection : { contactId: selection === undefined ? footworkCache.defaultId : selection };
      var resolved = resolveContact(plan);
      if (!resolved.ok) return resolved;
      if (!resolved.usable) return bad(resolved.reason);
      var key = String(resolved.window.time), found = footworkCache.solutions[resolved.window.id];
      if (!found) {
        if (!own(footworkCache.continuousSuggestions, key)) footworkCache.continuousSuggestions[key] = Footwork.search(state.players.human, resolved.window, footworkCache.movementOptions);
        found = footworkCache.continuousSuggestions[key];
      }
      if (!found || !found.ok) return bad($t('有限搜索未找到该时刻的可行路径'));
      var result = clone(found);
      result.contactTime = resolved.window.time;
      result.preview = previewFootwork({ contactTime: resolved.window.time, actions: result.actions });
      return result;
    }
    function commitFootwork(plan) {
      var preview = previewFootwork(plan);
      if (!preview.ok) return preview;
      if (!preview.valid || !preview.canHit) return bad(preview.reason);
      var before = clone(state.players.human);
      humanContact = takeFootwork(state.players.human, preview);
      var recovery = recover(state.players.ai, state.recoveryPlans.ai, preview.contactTime, pendingReply.execution);
      state.simTime += preview.contactTime; state.rallyHits++;
      rememberContact(preview.contactTime);
      state.lastFootwork = clone(preview);
      var items = preview.actionResults.map(function (a) { return { label: a.label, delta: -a.staminaCost }; });
      if (preview.terminalState.recoveredStamina > 0) items.push({ label: $t('准备后等待恢复'), delta: preview.terminalState.recoveredStamina });
      receipt($t('步伐与准备'), before.stamina, items, state.players.human.stamina);
      state.lastMotion = { receiver: 'human', from: { x: before.x, y: before.y }, to: { x: state.players.human.x, y: state.players.human.y },
        duration: preview.contactTime, recovery: recovery, bodyPath: clone(preview.bodyPath), contactPoint: clone(preview.contact.point) };
      state.phase = 'shot';
      note($t('完成 ') + plan.actions.length + $t(' 个节点：在 ') + preview.contactTime.toFixed(2) + $t(' 秒、') + preview.contact.height.toFixed(2) + $t(' 米处接球，准备 ') + preview.preparationTime.toFixed(2) + $t(' 秒。'));
      return good();
    }
    function forfeitDecision(kind) {
      var phase = state.phase, expired = kind === 'decision_timeout';
      var allowed = expired ? ['serve', 'predict', 'route', 'shot'] : ['predict', 'route', 'shot'];
      if (allowed.indexOf(phase) < 0) return bad(expired ? $t('当前阶段没有可超时的场内决策') : $t('只能在预判、接球规划或击球阶段放弃回球'));
      if (phase === 'route' && (!pendingReply || !state.incoming)) return bad($t('当前缺少已揭露的来球，不能结算接球放弃'));
      var elapsed = 0;
      if (phase === 'route') {
        // This flight is already public but no contact interval has yet been
        // resolved. Preserve the original route concession: let it land and
        // recover its hitter for that ONE real flight interval.
        var execution = pendingReply.execution;
        elapsed = execution.trajectory.duration;
        state.simTime += elapsed;
        var recovery = recover(state.players.ai, state.recoveryPlans.ai, elapsed, execution);
        state.lastMotion = { receiver: 'human', conceded: !expired, decisionExpired: expired,
          duration: elapsed, recovery: recovery, trajectory: clone(execution.trajectory) };
      }
      // Serve/predict have not released a public flight. Do not inspect or
      // execute the hidden pending reply, debit its stroke, or draw randomness.
      // Shot already resolved contact and opponent recovery; preserve its
      // existing motion/energy receipt rather than simulating that time twice.
      state.actionStarted = true;
      var labels = { serve: $t('发接球准备'), predict: $t('预判'), route: $t('接球规划'), shot: $t('击球选择') };
      var reason = expired ? $t('决策超时：') + labels[phase] + $t('未完成，对手得分。')
        : phase === 'route' ? $t('放弃本拍接球，按实际落地时刻结算。') : $t('主动放弃回球，对手得分。');
      finishPoint('ai', reason);
      state.lastResult.reasonCode = kind;
      state.lastResult.fromPhase = phase;
      state.lastResult.elapsedAdded = elapsed;
      return good();
    }
    function concedePoint() { return forfeitDecision('conceded'); }
    function expireDecision() {
      // Toss is not a played rally: its expiry accepts the same default choice
      // as the retained automatic-demonstration API, without awarding a point.
      if (state.phase === 'toss') return timeout();
      return forfeitDecision('decision_timeout');
    }
    function shoot(selection) {
      if (state.phase !== 'shot') return bad($t('当前不能击球'));
      return playHumanStroke(selection, contextFor('human', humanContact), null);
    }
    function playHumanStroke(selection, context, serviceSetup) {
      var invalid = ShotModel.validateControls(selection);
      if (invalid) return bad(invalid);
      var selectedRecovery = resolveRecovery(selection, state.players.human);
      if (!selectedRecovery.ok) return selectedRecovery;
      // All validation precedes ANY random draw or state mutation.
      var anticipation = aiPrediction();
      var execution = ShotModel.execute(context, selection, random), flight = execution.trajectory;
      if (execution.contactHit === false) { finishContactMiss('human', execution); return good(); }
      rememberFlight('human', flight);
      var human = state.players.human, ai = state.players.ai;
      state.recoveryPlans.human = recoveryPlan(human, selectedRecovery, flight.duration);
      var staminaBefore = human.stamina;
      applyStroke(human, execution);
      var strokeDebit = staminaBefore - human.stamina;
      function recoverHuman(duration) {
        var recovered = recover(human, state.recoveryPlans.human, duration, execution);
        receipt($t('击球与回位'), staminaBefore, [{ label: $t('击球'), delta: -strokeDebit },
          { label: $t('回位移动'), delta: -recovered.staminaSpent }, { label: $t('间歇恢复'), delta: recovered.staminaRecovered }], human.stamina);
        return recovered;
      }
      state.lastMotion = { receiver: 'ai', trajectory: clone(flight), duration: flight.duration };
      var serveFaults = serviceSetup ? serviceFaults(serviceSetup, 'human', flight) : [];
      if (serveFaults.length) {
        state.service.status = 'fault'; state.service.fault = serveFaults.join($t('；'));
        state.lastMotion.serviceFault = true; state.simTime += flight.duration; state.lastMotion.recovery = recoverHuman(flight.duration);
        finishPoint('ai', $t('发球违例：') + serveFaults.join($t('；'))); return good();
      }
      if (!flight.valid) {
        state.simTime += flight.duration; state.lastMotion.recovery = recoverHuman(flight.duration);
        finishPoint('ai', failureReason(flight)); return good();
      }
      var aiBeforePrediction = clone(ai);
      preload(ai, anticipation);
      var aiFootwork = buildFootwork(ai, flight, footworkOptions(aiBeforePrediction, anticipation));
      if (!aiFootwork.feasible.length) {
        state.simTime += flight.duration; state.lastMotion.recovery = recoverHuman(flight.duration);
        finishPoint('human', $t('对手没能赶上实际弹道的有效接触窗口。')); return good();
      }
      var selected = random() < 0.72 ? aiFootwork.feasible[0] : pick(aiFootwork.feasible), before = clone(ai);
      var contact = takeFootwork(ai, selected.preview);
      var recovery = recoverHuman(contact.time);
      state.simTime += contact.time; state.rallyHits++;
      rememberContact(contact.time);
      state.lastMotion = { receiver: 'ai', from: { x: before.x, y: before.y }, to: { x: ai.x, y: ai.y },
        duration: contact.time, recovery: recovery, receiverState: clone(ai), trajectory: clone(flight), contactHeight: contact.height };
      pendingReply = chooseAiReply(contact);
      state.phase = 'predict'; state.incoming = null; state.prediction = null; footworkCache = null; humanContact = null; state.lastReachability = null;
      state.recoveryPlans.ai = null;
      note($t('回球已被接到。实际接触时长决定你的回位；对手下一拍仍未揭露。'));
      return good();
    }
    function advance() {
      if (state.phase !== 'pointEnd' && state.phase !== 'gameEnd') return bad($t('当前不能开始下一分'));
      if (state.phase === 'gameEnd') {
        changeEnds($t('局间交换场地')); state.gameNumber++; state.score = { human: 0, ai: 0 }; state.deciderChanged = false;
      }
      beginRally(); return good();
    }
    function timeout() {
      if (state.phase === 'toss') return chooseToss(state.toss.availableChoices[0]);
      if (state.phase === 'serve') {
        if (state.server === 'ai') return confirmReceive({ receiverPosition: state.service.receiverPosition });
        var servingAim = assistServe(state.service, defaultServicePosition('ai', state.service.side, 0.76), 51);
        return servingAim.ok ? commitServe(Object.assign({}, servingAim.controls, { recovery: 'center' })) : servingAim;
      }
      if (state.phase === 'predict') return predict('neutral', 'light');
      if (state.phase === 'route') {
        var found = suggestFootwork();
        return found.ok ? commitFootwork({ contactId: found.contactId, actions: found.actions }) : concedePoint();
      }
      if (state.phase === 'shot') {
        var assisted = assistAim({ x: state.players.ai.x > 0 ? -0.30 : 0.30, y: 0.72 }, 51);
        if (!assisted.ok) return assisted;
        return shoot({ target: assisted.controls.target, angle: assisted.controls.angle, power: assisted.controls.power, recovery: 'center' });
      }
      return bad($t('当前阶段没有自动操作'));
    }
    reset();
    return { getView: getView, getProfile: getProfile, trainSkill: trainSkill,
      chooseToss: chooseToss, previewServe: previewServe, scanServeControls: scanServeControls, assistServe: assistServe, commitServe: commitServe, confirmReceive: confirmReceive,
      previewRecovery: previewRecovery, previewRecoveryAfterFootwork: previewRecoveryAfterFootwork,
      assistAim: assistAim, previewShot: previewShot, scanShotControls: scanShotControls, predict: predict,
      previewShotAfterFootwork: previewShotAfterFootwork, scanShotControlsAfterFootwork: scanShotControlsAfterFootwork, assistAimAfterFootwork: assistAimAfterFootwork,
      previewFootwork: previewFootwork, previewAnticipation: previewAnticipation, commitFootwork: commitFootwork, suggestFootwork: suggestFootwork, concedePoint: concedePoint,
      shoot: shoot, advance: advance, reset: reset, timeout: timeout, expireDecision: expireDecision };
  }
  return { createMatch: createMatch };
}));
