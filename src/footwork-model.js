(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./court-rules.js'));
  else root.BadmintonFootworkModel = factory(root.BadmintonCourtRules);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (CourtRules) {
  'use strict';
  if (!CourtRules) throw new Error($t('请先加载 court-rules.js'));
  // Uncalibrated game primitives, not measured athlete biomechanics. Movement
  // is integrated sequentially; nobody snaps to a ball or receives a route buff.
  var X = CourtRules.GEOMETRY.halfWidth, Y = CourtRules.GEOMETRY.halfLength, DT = 0.015, REACH = 0.62, MAX_ACTIONS = 12;
  var START_TIME = 0.065, START_COST = 0.45, TRAVEL_SPEED = 5.0, HOP_SPEED = 2.65;
  var WRONG_ALIGNMENT = -0.25, REACTION_LIGHT = 0.075, REACTION_STRONG = 0.15;
  var CONTACT_LIMITS = { groundMin: 0.28, groundMax: 2.95, jumpBoost: 0.45, jumpMin: 0.73, jumpMax: 3.40 };
  var JUMP_ASCENT = Math.sqrt(2 * CONTACT_LIMITS.jumpBoost / 9.81);
  var ACTIONS = [
    { id: 'start', label: $t('调整启动'), description: $t('必选起点，结算预判与回动惯性；原地可触球时可跳过移动行') },
    { id: 'shuffle', label: $t('并步'), description: $t('短中距调整，省力且支撑稳定；动作内完成减速') },
    { id: 'cross', label: $t('交叉步'), description: $t('长跨步覆盖远处，较耗力、姿态较不稳；末段可伸拍抢点，较远触距降低回球质量，接并步可再贴近调整') },
    { id: 'hop', label: $t('小跳偷距'), description: $t('短时短距抢位，较费体力；起跳、落地和刹停已合并') },
    { id: 'ground', label: $t('地面击球'), description: $t('原地整理支撑、增加稳定；地面击球范围 0.28–2.95 米') },
    { id: 'jump', label: $t('跳跃击球'), description: $t('原地蓄势后起跳，较耗时耗力、稳定下降；触及范围上移 0.45 米') },
    { id: 'ready', label: $t('挥拍'), description: $t('必选终点，不另扣时间或体力；显示截击球速与球速对应的基础命中率') }
  ];
  var COMBOS = [
    { id: 'shuffle_chain', label: $t('并步连贯'), sequence: ['shuffle', 'shuffle'], summary: $t('连续同向前进，下一并步缩短换脚；折扣不累乘。') },
    { id: 'cross_chain', label: $t('交叉连贯'), sequence: ['cross', 'cross'], summary: $t('连续同向交叉省换脚时间，但多耗体力、稳定再降。') },
    { id: 'shuffle_hop', label: $t('并跳衔接'), sequence: ['shuffle', 'hop'], summary: $t('并步后以较低跳高抢短距，完整计入起落；用体力换时间。') },
    { id: 'cross_shuffle', label: $t('解交叉调整'), sequence: ['cross', 'shuffle'], summary: $t('继续补距并解开交叉支撑，缩短换脚调整时间。') },
    { id: 'cross_ground', label: $t('交叉收势'), sequence: ['cross', 'ground'], summary: $t('交叉后专门整理支撑；比普通稳身更快，但额外耗力。') },
    { id: 'hop_shuffle', label: $t('落地续步'), sequence: ['hop', 'shuffle'], summary: $t('小跳已完成落地，接并步缩短换脚衔接；跳跃耗力不返还。') }
  ];
  var GUIDE = { title: $t('步伐特色与组合'),
    actions: ACTIONS.map(function (a) { return { id: a.id, label: a.label, summary: a.description }; }),
    combos: COMBOS,
    note: $t('调整启动 → 移动（可跳过或连续选择）→ 地面击球或跳跃击球 → 挥拍。启动与挥拍必选，击球姿态二选一；挥拍不另扣时间，跳跃节点已计入完整上升。已停稳且在触及范围内可直接选姿态，距离不足仍须移动。连携取决于前一步步型、同向净前进和换脚，折扣不叠乘；以节点实时数值为准。') };
  function comboFor(s, id, window) {
    var d = direction(s, window), forward = s.lastDirectionX * d.x + s.lastDirectionY * d.y;
    var moving = s.lastProgress > 0.08 && forward > 0.8 && separation(s, window) > 0.30;
    var comboId = s.prior === 'shuffle' && id === 'shuffle' && moving ? 'shuffle_chain'
      : s.prior === 'cross' && id === 'cross' && moving ? 'cross_chain'
      : s.prior === 'shuffle' && id === 'hop' && moving ? 'shuffle_hop'
      : s.prior === 'cross' && id === 'shuffle' && moving ? 'cross_shuffle'
      : s.prior === 'cross' && id === 'ground' && s.lastProgress > 0.08 ? 'cross_ground'
      : s.prior === 'hop' && id === 'shuffle' && moving ? 'hop_shuffle' : null;
    var item = COMBOS.find(function (c) { return c.id === comboId; });
    return item ? { id: item.id, label: item.label, description: item.summary } : null;
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function copy(v) { return JSON.parse(JSON.stringify(v)); }
  function label(id) { return ACTIONS.find(function (a) { return a.id === id; }).label; }
  function known(id) { return typeof id === 'string' && ACTIONS.some(function (a) { return a.id === id; }); }
  function separation(state, window) { return Math.hypot((window.point.x - state.x) * X, (window.point.y - state.y) * Y); }
  function balance(s) { return clamp(s.control - 1.08 * (s.ux * s.ux + s.uy * s.uy) - (s.support === 'airborne' ? 12 : 0), 5, 98); }
  function initial(player, options) {
    var ux = player.vx * X, uy = player.vy * Y;
    return { x: player.x, y: player.y, ux: ux, uy: uy,
      control: clamp(player.balance + 1.08 * (ux * ux + uy * uy), 5, 100),
      stamina: player.stamina, support: player.support === 'airborne' ? 'airborne' : 'open',
      prior: null, elapsed: 0, preparation: 0, stancePreparation: 0, z: 0, vz: 0, error: '',
      movementCount: 0, contactMode: null, lastProgress: 0, lastDirectionX: 0, lastDirectionY: 0,
      anticipation: options && options.anticipation || null };
  }
  function external(s) { return { x: s.x, y: s.y, vx: s.ux / X, vy: s.uy / Y, balance: balance(s), stamina: s.stamina, support: s.support,
    heightBoost: s.z, verticalSpeed: s.vz, contactMode: s.contactMode }; }
  function direction(s, window) {
    var dx = (window.point.x - s.x) * X, dy = (window.point.y - s.y) * Y, d = Math.hypot(dx, dy);
    return d > 0.015 ? { x: dx / d, y: dy / d } : { x: 0, y: 0 };
  }
  function directionLabel(dx, dy) {
    if (Math.hypot(dx, dy) < 0.025) return $t('原地');
    var horizontal = Math.abs(dx) > Math.abs(dy) * 0.35 ? (dx > 0 ? $t('右') : $t('左')) : '';
    var vertical = Math.abs(dy) > Math.abs(dx) * 0.35 ? (dy > 0 ? $t('后') : $t('前')) : '';
    return $t('向') + horizontal + vertical;
  }
  function pay(s, amount) {
    if (s.stamina + 1e-9 < amount) { s.error = $t('体力不足，不能继续执行动作'); return false; }
    s.stamina = Math.max(0, s.stamina - amount); return true;
  }
  function bounds(s) {
    if (Math.abs(s.x) > 1.08 || s.y < 0.012 || s.y > 1.08) s.error = $t('身体路径越过本半场的可移动边界');
  }
  function move(s, dt, targetUx, targetUy, acceleration, airborne) {
    var oldUx = s.ux, oldUy = s.uy, changeX = targetUx - oldUx, changeY = targetUy - oldUy;
    var change = Math.hypot(changeX, changeY), limit = acceleration * dt;
    if (change > limit && change > 0) { changeX *= limit / change; changeY *= limit / change; }
    var newUx = oldUx + changeX, newUy = oldUy + changeY;
    var dx = (oldUx + newUx) * 0.5 * dt, dy = (oldUy + newUy) * 0.5 * dt;
    var effort = Math.hypot(changeX, changeY) * 0.13 + Math.hypot(dx, dy) * 0.35 + 0.035 * dt;
    if (!pay(s, effort)) return;
    s.x += dx / X; s.y += dy / Y; s.ux = newUx; s.uy = newUy;
    s.elapsed += dt;
    // Active footwork never regenerates posture or energy. Recovery belongs to
    // the mandatory stance and available waiting time; movement loops cannot farm it.
    s.control = clamp(s.control - Math.hypot(changeX, changeY) * 0.55 - Math.hypot(dx, dy) * 0.35, 5, 100);
    if (airborne) { s.z += s.vz * dt - 4.905 * dt * dt; s.vz -= 9.81 * dt; }
    bounds(s);
    if (s.trace && (!s.trace.length || s.elapsed - s.trace[s.trace.length - 1].t >= 0.029)) {
      s.trace.push({ t: s.elapsed, x: s.x, y: s.y, balance: balance(s), stamina: s.stamina, z: s.z, heightBoost: s.z, support: s.support });
    }
  }
  function integrate(s, duration, ux, uy, acceleration, airborne) {
    var remaining = duration;
    while (remaining > 1e-8 && !s.error) { var dt = Math.min(DT, remaining); move(s, dt, ux, uy, acceleration, airborne); remaining -= dt; }
  }
  function allowed(s) {
    if (s.error || s.prior === 'ready') return [];
    if (s.prior === null) return ['start'];
    if (s.contactMode) return ['ready'];
    // Movement is optional. apply() still requires physical support, reach,
    // height, time and energy before a stationary stance can be selected.
    return ['shuffle', 'cross', 'hop', 'ground', 'jump'];
  }
  function startMotion(s, window, minimumDuration) {
    var t = s.elapsed, d = direction(s, window), fatigue = 0.73 + 0.27 * s.stamina / 100;
    if (pay(s, START_COST)) {
      integrate(s, START_TIME, s.ux * 0.85, s.uy * 0.85, 3, false);
      // Correct the inherited backwards component HERE. The next movement
      // therefore does not pay a second direction-change fine. Braking still
      // translates the body and spends energy through the normal integrator.
      var opposite = Math.min(0, s.ux * d.x + s.uy * d.y);
      if (!s.error && opposite < -1e-9) {
        integrate(s, -opposite / (12 * fatigue), s.ux - d.x * opposite, s.uy - d.y * opposite, 12 * fatigue, false);
      }
      var physicalDuration = s.elapsed - t;
      // Recognition and braking OVERLAP. Only the uncovered portion of the
      // minimum reaction window remains; it is not added after all braking.
      if (!s.error && physicalDuration < minimumDuration) integrate(s, minimumDuration - physicalDuration, 0, 0, 12 * fatigue, false);
    }
    s.support = 'open';
  }
  function startTiming(s, window) {
    var intent = s.anticipation, neutral = intent && intent.neutralPlayer;
    var directionVector = intent && intent.vector, d = direction(s, window), alignment = null, outcome = 'neutral';
    var baseline = initial(neutral || external(s)); baseline.trace = null;
    startMotion(baseline, window, 0);
    if (intent && intent.direction !== 'neutral' && directionVector && Math.hypot(d.x, d.y) > 0) {
      alignment = clamp(directionVector.x * d.x + directionVector.y * d.y, -1, 1);
      outcome = alignment <= WRONG_ALIGNMENT ? 'wrong' : alignment >= 0.25 ? 'aligned' : 'uncertain';
    }
    var reaction = outcome === 'wrong' ? (intent.commitment === 'strong' ? REACTION_STRONG : REACTION_LIGHT) * (0.5 + 0.5 * -alignment) : 0;
    return { baselineDuration: baseline.elapsed, baselineComparable: !baseline.error,
      anticipationOutcome: outcome, anticipationAlignment: alignment, wrongAlignmentThreshold: WRONG_ALIGNMENT,
      reactionMinimumSeconds: reaction, minimumDuration: outcome === 'wrong' ? baseline.elapsed + reaction : 0 };
  }
  function apply(previous, id, window, recordPath) {
    var s = Object.assign({}, previous), startX = s.x, startY = s.y, startTime = s.elapsed, startStamina = s.stamina;
    var distanceBefore = separation(s, window);
    s.trace = recordPath ? [] : null;
    if (allowed(s).indexOf(id) < 0) {
      s.error = id === 'start' ? $t('启动只能是路径的第一个节点')
        : s.prior === null ? $t('请先选择调整启动，再连接其他步伐')
        : s.prior === 'ready' ? $t('挥拍是路径终点')
        : s.contactMode ? $t('击球姿态已选定，请连接挥拍；要继续移动请先撤销姿态')
        : id === 'ready' ? $t('请先选择地面击球或跳跃击球，再挥拍')
        : $t('当前支撑不能连接此动作');
      return { state: s };
    }
    var d = direction(s, window), fatigue = 0.73 + 0.27 * s.stamina / 100;
    var timing = null, combo = comboFor(s, id, window), transitionSeconds = 0;
    if (id === 'start') {
      timing = startTiming(s, window);
      startMotion(s, window, timing.minimumDuration);
    } else if (id === 'shuffle' || id === 'cross') {
      var crossing = id === 'cross', nominalSpan = crossing ? 1.42 : 0.64;
      var speed = (crossing ? TRAVEL_SPEED : 2.6) * fatigue, acceleration = (crossing ? 21 : 18) * fatigue;
      var entry = crossing ? 0.060 : (s.support === 'crossed' ? 0.070 : 0.040);
      if (combo && combo.id === 'shuffle_chain') entry = 0.014;
      if (combo && combo.id === 'cross_chain') entry = 0.022;
      if (combo && combo.id === 'cross_shuffle') entry = 0.030;
      if (combo && combo.id === 'hop_shuffle') entry = 0.016;
      // A final cross may brake within the existing racket reach rather than
      // force the body unnecessarily close. The actual reach distance still
      // enters stroke quality; shuffle remains available for a closer contact.
      // This changes neither nominal stride length nor acceleration/braking.
      var approachDistance = Math.max(0, separation(s, window) - (crossing ? 0.48 : 0.24));
      var span = Math.min(nominalSpan, approachDistance), guard = 0, braking = approachDistance < 0.045;
      var paid = pay(s, crossing ? 1.12 + (combo && combo.id === 'cross_chain' ? 0.18 : 0) : 0.56);
      if (paid) {
        if (crossing) s.control = Math.max(5, s.control - (combo && combo.id === 'cross_chain' ? 2.4 : 1.7));
        var forwardEntry = Math.max(0, s.ux * d.x + s.uy * d.y);
        var coasting = approachDistance > forwardEntry * forwardEntry / (2 * acceleration) + forwardEntry * entry / fatigue + 0.06;
        var beforeEntry = s.elapsed;
        integrate(s, entry / fatigue, coasting ? s.ux : 0, coasting ? s.uy : 0, acceleration, false);
        transitionSeconds = s.elapsed - beforeEntry;
      }
      // Every movement owns its deceleration and every meter it creates. A
      // later zero-distance stance never erases momentum or relocates the body.
      while (paid && !s.error && guard++ < 160) {
        var progress = (s.x - startX) * X * d.x + (s.y - startY) * Y * d.y;
        var current = Math.hypot(s.ux, s.uy), remaining = Math.max(0, span - progress);
        if (braking && current < 1e-8) break;
        var forward = Math.max(0, s.ux * d.x + s.uy * d.y);
        if (remaining <= forward * forward / (2 * acceleration) + forward * DT + 0.020) braking = true;
        var command = braking ? 0 : Math.min(speed, Math.sqrt(2 * acceleration * 0.82 * Math.max(0, remaining - 0.018)));
        var step = braking && current > 0 ? Math.min(DT, current / acceleration) : DT;
        move(s, step, d.x * command, d.y * command, acceleration, false);
      }
      if (guard >= 160 && !s.error) s.error = $t('动作未能在有限时间内完成');
      s.support = crossing ? 'crossed' : 'open';
      s.movementCount++;
    } else if (id === 'hop') {
      var hopSpace = Math.max(0, separation(s, window) - 0.28);
      var linkedHop = combo && combo.id === 'shuffle_hop', verticalImpulse = linkedHop ? 0.83 : 1.05;
      var airDuration = 2 * verticalImpulse / 9.81, landingAcceleration = 23 * fatigue;
      // Reserve landing stopping distance; inherited velocity is physically
      // reduced before take-off, not discarded at the next stance node.
      var preHopGuard = 0;
      while (Math.hypot(s.ux, s.uy) > 1e-8 && !s.error && preHopGuard++ < 100) {
        move(s, Math.min(DT, Math.hypot(s.ux, s.uy) / landingAcceleration), 0, 0, landingAcceleration, false);
      }
      hopSpace = Math.max(0, separation(s, window) - 0.28);
      var impulse = Math.min(HOP_SPEED * fatigue,
        landingAcceleration * (Math.sqrt(airDuration * airDuration + 2 * Math.min(0.48, hopSpace) / landingAcceleration) - airDuration));
      if (pay(s, 1.8 + impulse * 0.22)) {
        s.ux = d.x * impulse; s.uy = d.y * impulse; s.z = 0; s.vz = verticalImpulse;
        s.control = Math.max(5, s.control - (linkedHop ? 1.8 : 2.5)); s.support = 'airborne';
        integrate(s, airDuration, s.ux, s.uy, 0, true);
        if (!s.error) { s.z = 0; s.vz = 0; s.support = 'landed'; }
        if (!s.error && pay(s, 0.88 + impulse * 0.15)) {
          s.control = Math.max(5, s.control - 1.5);
          var landingGuard = 0;
          while (Math.hypot(s.ux, s.uy) > 1e-8 && !s.error && landingGuard++ < 100) {
            move(s, Math.min(DT, Math.hypot(s.ux, s.uy) / landingAcceleration), 0, 0, landingAcceleration, false);
          }
          if (!s.error) integrate(s, 0.025, 0, 0, 0, false);
        }
      }
      s.movementCount++;
    } else if (id === 'ground' || id === 'jump') {
      var modeMin = id === 'jump' ? CONTACT_LIMITS.jumpMin : CONTACT_LIMITS.groundMin;
      var modeMax = id === 'jump' ? CONTACT_LIMITS.jumpMax : CONTACT_LIMITS.groundMax;
      if (window.height < modeMin - 1e-9 || window.height > modeMax + 1e-9) {
        s.error = label(id) + $t('允许击球高度为 ') + modeMin.toFixed(2) + '–' + modeMax.toFixed(2) + $t(' 米，请调整截击位置或更换姿态');
      } else if (Math.hypot(s.ux, s.uy) > 1e-8) s.error = $t('移动尚未完成减速，不能原地选择击球姿态');
      else if (separation(s, window) > REACH + 1e-9) s.error = $t('距离仍不足，请先补足移动再选择击球姿态');
      else if (id === 'ground') {
        var crossGround = combo && combo.id === 'cross_ground';
        if (pay(s, crossGround ? 0.82 : 0.60)) {
          integrate(s, crossGround ? 0.072 : 0.10, 0, 0, 0, false);
          if (!s.error) s.control = Math.min(100, s.control + (crossGround ? 2.5 : 3.2));
        }
        // Only paid support-settling time counts as stance preparation. The
        // terminal swing adds no time, posture bonus or preparation of its own.
        s.preparation = s.elapsed - startTime; s.stancePreparation = s.preparation;
        s.contactMode = 'ground'; s.support = 'planted';
      } else {
        if (pay(s, 2.75)) {
          integrate(s, 0.075, 0, 0, 0, false);
          if (!s.error) {
            s.control = Math.max(5, s.control - 3.5);
            s.support = 'airborne'; s.z = 0; s.vz = JUMP_ASCENT * 9.81;
            // The stance owns the entire physical ascent, including the final
            // 0.080s formerly charged by ready. Swing cannot create free height.
            integrate(s, JUMP_ASCENT, 0, 0, 0, true);
            if (!s.error) { s.z = CONTACT_LIMITS.jumpBoost; s.vz = 0; }
          }
        }
        s.preparation = Math.min(0.075, s.elapsed - startTime); s.stancePreparation = s.preparation;
        s.contactMode = 'jump';
      }
    } else if (id === 'ready') {
      var reach = separation(s, window);
      var allowedMin = s.contactMode === 'jump' ? CONTACT_LIMITS.jumpMin : CONTACT_LIMITS.groundMin;
      var allowedMax = s.contactMode === 'jump' ? CONTACT_LIMITS.jumpMax : CONTACT_LIMITS.groundMax;
      if (reach > REACH + 1e-9) s.error = $t('尚未进入球拍触及范围，不能直接挥拍');
      else if (window.height < allowedMin - 1e-9 || window.height > allowedMax + 1e-9) s.error = $t('所选击球姿态无法触及当前球高');
      else if (s.contactMode === 'ground') s.support = 'ready';
    }
    if (id === 'shuffle' || id === 'cross' || id === 'hop') {
      s.lastProgress = distanceBefore - separation(s, window);
      s.lastDirectionX = d.x; s.lastDirectionY = d.y;
    }
    var actionError = s.error;
    if (!s.error && s.elapsed > window.time + 1e-9) s.error = $t('动作总时长超过该接触窗口');
    s.prior = id;
    var result = { id: id, label: timing && timing.anticipationOutcome === 'wrong' ? $t('二次启动') : label(id), duration: s.elapsed - startTime,
      startTime: startTime, endTime: s.elapsed, executionStatus: actionError ? 'partial' : s.error ? 'late' : 'completed',
      from: { x: startX, y: startY }, to: { x: s.x, y: s.y }, reason: s.error || '',
      cumulativeTime: s.elapsed, distance: Math.hypot((s.x - startX) * X, (s.y - startY) * Y),
      distanceBefore: distanceBefore, distanceAfter: separation(s, window), progress: distanceBefore - separation(s, window),
      staminaCost: startStamina - s.stamina, balance: balance(s), stamina: s.stamina,
      point: { x: s.x, y: s.y }, support: s.support, combo: s.elapsed > startTime ? combo : null, transitionSeconds: transitionSeconds,
      directionLabel: directionLabel((s.x - startX) * X, (s.y - startY) * Y) };
    if (timing) {
      Object.assign(result, timing);
      delete result.minimumDuration;
      var complete = !actionError && timing.baselineComparable;
      result.anticipationPenaltySeconds = complete ? Math.max(0, result.duration - timing.baselineDuration) : null;
      result.anticipationBonusSeconds = complete ? Math.max(0, timing.baselineDuration - result.duration) : null;
    }
    return { state: s, trace: s.trace, result: result };
  }
  function waitPrepared(state, duration) {
    var s = Object.assign({}, state), time = Math.max(0, duration);
    if (s.contactMode === 'jump') return s;
    s.control = Math.min(100, s.control + Math.min(3.5, time * 4));
    s.stamina = Math.min(100, s.stamina + Math.min(1, time * 0.5));
    s.ux *= Math.exp(-time * 0.7); s.uy *= Math.exp(-time * 0.7);
    return s;
  }
  function validate(actions) {
    if (!Array.isArray(actions) || actions.some(function (id) { return !known(id); })) return $t('动作路径必须是有效节点 ID 的数组');
    return '';
  }
  function preview(player, window, actions, options) {
    var invalid = validate(actions); if (invalid) return { ok: false, error: invalid };
    var s = initial(player, options), results = [], path = [{ t: 0, x: s.x, y: s.y, balance: player.balance, stamina: player.stamina,
      actionIndex: null, phase: 'initial' }];
    if (actions.length > MAX_ACTIONS) s.error = $t('路径最多包含 ') + MAX_ACTIONS + $t(' 个动作节点');
    for (var i = 0; i < actions.length && !s.error; i++) {
      var moved = apply(s, actions[i], window, true); s = moved.state;
      if (moved.result) {
        moved.result.requestIndex = i; moved.result.pathStartIndex = path.length - 1;
        results.push(moved.result);
        if (moved.trace) moved.trace.forEach(function (point) {
          if (point.t > path[path.length - 1].t + 1e-9) path.push(Object.assign({}, point, { actionIndex: i, phase: 'action' }));
        });
        var endpoint = { t: s.elapsed, x: s.x, y: s.y, balance: balance(s), stamina: s.stamina,
          z: s.z, heightBoost: s.z, support: s.support, actionIndex: i, phase: 'action_end' };
        if (s.elapsed > path[path.length - 1].t + 1e-9) path.push(endpoint);
        else if (s.elapsed > moved.result.startTime + 1e-9) path[path.length - 1] = endpoint;
        moved.result.pathEndIndex = path.length - 1;
      }
    }
    var valid = !s.error, canHit = valid && s.prior === 'ready' && !!s.contactMode &&
      (s.support === 'ready' || s.support === 'airborne') && separation(s, window) <= REACH + 1e-9;
    var reason = s.error || (canHit ? s.contactMode === 'jump' ? $t('路径可接球；余量在地面等球，临近接触起跳，不获得空中等待恢复') : $t('路径可接球；挥拍不另耗时，到位后的余量可用于准备并提供少量恢复')
      : actions.length === 0 ? $t('从调整启动开始绘制路径')
      : !s.contactMode ? separation(s, window) > REACH + 1e-9 ? $t('距离不足，请先移动，再选择击球姿态和挥拍')
        : Math.hypot(s.ux, s.uy) > 1e-8 ? $t('尚有水平惯性，请用步伐完成减速，再选择击球姿态')
        : $t('已在触及范围内，可跳过移动，选择击球姿态后连接挥拍') : $t('请连接必选终点：挥拍'));
    var activeCost = player.stamina - s.stamina;
    var atContact = canHit ? waitPrepared(s, window.time - s.elapsed) : s;
    results.forEach(function (row) { row.scheduledStartTime = row.startTime; row.scheduledEndTime = row.endTime; });
    if (canHit && window.time > s.elapsed + 1e-9) {
      var spare = window.time - s.elapsed;
      if (s.contactMode === 'jump') {
        var jumpIndex = results.findIndex(function (row) { return row.id === 'jump'; });
        var insertAt = results[jumpIndex].pathStartIndex + 1, anchor = path[insertAt - 1];
        for (var pi = insertAt; pi < path.length; pi++) path[pi].t += spare;
        path.splice(insertAt, 0, Object.assign({}, anchor, { t: anchor.t + spare, z: 0, heightBoost: 0, actionIndex: null, phase: 'waiting_before_jump' }));
        for (var ri = jumpIndex; ri < results.length; ri++) {
          results[ri].scheduledStartTime += spare; results[ri].scheduledEndTime += spare;
          results[ri].pathStartIndex++; results[ri].pathEndIndex++;
        }
      } else path.push({ t: window.time, x: atContact.x, y: atContact.y, balance: balance(atContact), stamina: atContact.stamina,
        z: 0, heightBoost: 0, support: 'ready', actionIndex: null, phase: 'waiting' });
    }
    if (canHit && s.contactMode === 'ground') {
      // Swing occurs when the ball arrives, after any genuine waiting time.
      // Keep its active clock/cost at zero; replay attaches the instantaneous
      // event to the existing contact endpoint without a duplicate path sample.
      var swing = results[results.length - 1];
      swing.scheduledStartTime = window.time; swing.scheduledEndTime = window.time;
      swing.pathStartIndex = path.length - 1; swing.pathEndIndex = path.length - 1;
    }
    var next = valid && actions.length < MAX_ACTIONS ? allowed(s).filter(function (id) { return !apply(s, id, window).state.error; }) : [];
    return { ok: true, valid: valid, canHit: canHit, reason: reason,
      contactId: window.id, actions: actions.slice(), nextActions: next,
      requestedActionCount: actions.length, executedActionCount: results.length,
      unexecutedActions: actions.slice(results.length).map(function (id, index) { return { id: id, requestIndex: results.length + index, executionStatus: 'unexecuted' }; }),
      totalTime: s.elapsed, contactTime: window.time, remainingTime: window.time - s.elapsed,
      preparationTime: s.preparation, stancePreparationTime: s.stancePreparation, staminaBefore: player.stamina, staminaCost: activeCost,
      staminaAfter: atContact.stamina, balanceBefore: player.balance, balance: balance(atContact),
      distanceBefore: separation(initial(player), window),
      distanceRemaining: Math.max(0, separation(atContact, window) - REACH), reachDistance: separation(atContact, window),
      contact: { point: copy(window.point), height: window.height, speed: window.speed,
        verticalSpeed: typeof window.verticalSpeed === 'number' ? window.verticalSpeed : 0, time: window.time,
        mode: s.contactMode, heightBoost: s.contactMode === 'jump' ? CONTACT_LIMITS.jumpBoost : 0,
        allowedMinHeight: s.contactMode === 'jump' ? CONTACT_LIMITS.jumpMin : CONTACT_LIMITS.groundMin,
        allowedMaxHeight: s.contactMode === 'ground' ? CONTACT_LIMITS.groundMax : CONTACT_LIMITS.jumpMax,
        preparationBonusEligible: s.contactMode !== 'jump', landingRecoveryTime: s.contactMode === 'jump' ? JUMP_ASCENT : 0 },
      finalState: external(atContact), actionResults: results, bodyPath: path,
      terminalState: { support: atContact.support, priorAction: atContact.prior, activeStamina: s.stamina,
        recoveredStamina: atContact.stamina - s.stamina, racketReach: REACH, stancePreparationTime: s.stancePreparation,
        contactMode: s.contactMode, heightBoost: atContact.z, waitingOnGround: s.contactMode === 'jump' && canHit ? Math.max(0, window.time - s.elapsed) : 0 } };
  }

  function windowsFor(flight) {
    var eligible = flight.samples.filter(function (p) { return p.y >= 0.025 && p.y <= 1 && Math.abs(p.x) <= 1 && p.z >= CONTACT_LIMITS.groundMin && p.z <= CONTACT_LIMITS.jumpMax && p.t > 0.14; });
    var chosen = [], fractions = [0.08, 0.37, 0.65, 0.91];
    fractions.forEach(function (f) {
      if (!eligible.length) return;
      var sample = eligible[Math.round((eligible.length - 1) * f)];
      if (chosen.some(function (w) { return w.time === sample.t; })) return;
      chosen.push({ id: 'contact' + chosen.length, time: sample.t, point: { x: sample.x, y: sample.y }, height: sample.z,
        speed: sample.speed, verticalSpeed: sample.vz, available: false });
    });
    return chosen;
  }
  function assessReachability(player, intervals, pointAt, options) {
    options = options || {};
    var budget = Number.isInteger(options.maxChecks) ? clamp(options.maxChecks, 0, 1024) : 256;
    var result = { status: 'unknown', method: 'optimistic_motion_envelope', reasonCode: 'not_proven',
      reason: $t('尚不能证明所有接触时刻均不可达，可继续手动规划。'),
      intervalCount: Array.isArray(intervals) ? intervals.length : 0, checkedRanges: 0,
      budgetExhausted: false, unresolvedRanges: 0,
      evidence: { horizontalModel: options.horizontalModel || null, maxChecks: budget,
        maxSpeedMps: null, initialSpeedMps: null, racketReachMeters: REACH,
        minimumStartSeconds: START_TIME, minimumPreparationSeconds: 0,
        minimumFixedStamina: START_COST, certifiedRanges: [] } };
    function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
    function prove(code, reason) { result.status = 'unreachable'; result.reasonCode = code; result.reason = reason; return result; }
    if (!player || !['x', 'y', 'vx', 'vy', 'stamina', 'balance'].every(function (key) { return finite(player[key]); }) ||
        player.stamina < 0 || player.stamina > 100 || !Array.isArray(intervals) ||
        intervals.some(function (range) { return !range || !finite(range.start) || !finite(range.end) || range.start < 0 || range.end < range.start; })) {
      result.reasonCode = 'invalid_boundary'; return result;
    }
    if (!intervals.length) return prove('no_contact_interval', $t('实际弹道没有进入可接触的高度与场区。'));
    if (player.stamina < START_COST - 1e-9) {
      result.evidence.availableStamina = player.stamina;
      return prove('insufficient_minimum_stamina', $t('当前体力连最短启动动作也无法完成，本拍无法接球。'));
    }
    // A move integrates a convex velocity change; hop also takes a convex
    // combination of inherited speed and <= HOP_SPEED. Thus this is an upper
    // bound for every sequence, even with optimistic instant turns, no fatigue,
    // unlimited action count and zero movement costs. Swing costs no time;
    // ignoring stance time makes this envelope conservative for either stance.
    var initialSpeed = Math.hypot(player.vx * X, player.vy * Y), maxSpeed = Math.max(initialSpeed, TRAVEL_SPEED, HOP_SPEED);
    result.evidence.initialSpeedMps = initialSpeed; result.evidence.maxSpeedMps = maxSpeed;
    // Endpoint line-segment containment is exact ONLY for the current shuttle
    // model's straight horizontal path with one scalar drag factor. Callers
    // must explicitly attest this, using analytic points, not drawing samples.
    if (options.horizontalModel !== 'linear_drag_straight' || typeof pointAt !== 'function') {
      result.reasonCode = 'unsupported_horizontal_model'; return result;
    }
    function radius(time) { return REACH + maxSpeed * Math.max(0, time); }
    function distance(point) { return Math.hypot((point.x - player.x) * X, (point.y - player.y) * Y); }
    function segmentDistance(a, b) {
      var dx = (b.x - a.x) * X, dy = (b.y - a.y) * Y;
      var px = (player.x - a.x) * X, py = (player.y - a.y) * Y, lengthSquared = dx * dx + dy * dy;
      var fraction = lengthSquared > 0 ? clamp((px * dx + py * dy) / lengthSquared, 0, 1) : 0;
      return Math.hypot(px - fraction * dx, py - fraction * dy);
    }
    var pending = intervals.map(function (range) { return { start: range.start, end: range.end }; });
    while (pending.length && result.checkedRanges < budget) {
      var range = pending.pop(); result.checkedRanges++;
      if (range.end < START_TIME - 1e-9) {
        result.evidence.certifiedRanges.push({ start: range.start, end: range.end, kind: 'minimum_action_time' }); continue;
      }
      var a = null, b = null;
      try { a = pointAt(range.start); b = pointAt(range.end); } catch (ignored) {}
      if (!a || !b || !finite(a.x) || !finite(a.y) || !finite(b.x) || !finite(b.y)) {
        result.reasonCode = 'invalid_analytic_point'; result.unresolvedRanges = pending.length + 1; return result;
      }
      var lower = segmentDistance(a, b), upper = radius(range.end);
      if (lower > upper + 1e-7) {
        result.evidence.certifiedRanges.push({ start: range.start, end: range.end, kind: 'distance_bound',
          minimumDistanceMeters: lower, maximumReachMeters: upper, gapMeters: lower - upper }); continue;
      }
      // An optimistic endpoint opportunity already defeats this proof method;
      // it is NOT an actual feasible-path witness. Keep it explicitly unknown.
      if ((range.start >= START_TIME - 1e-9 && distance(a) <= radius(range.start) + 1e-7) ||
          (range.end >= START_TIME - 1e-9 && distance(b) <= upper + 1e-7)) {
        result.reasonCode = 'upper_bound_allows_contact'; result.unresolvedRanges = pending.length + 1; return result;
      }
      if (range.end - range.start <= 1e-5) { result.unresolvedRanges++; continue; }
      var middle = range.start + (range.end - range.start) / 2;
      pending.push({ start: range.start, end: middle }, { start: middle, end: range.end });
    }
    result.budgetExhausted = pending.length > 0;
    result.unresolvedRanges += pending.length;
    if (result.unresolvedRanges) {
      result.reasonCode = result.budgetExhausted ? 'proof_budget_exhausted' : 'proof_resolution_limit'; return result;
    }
    return prove('all_contact_intervals_unreachable', $t('全部可接触时段都超出当前移动与准备能力，即使按最快可达上界也无法触球。'));
  }
  function search(player, window, options) {
    // Deterministic bounded beam search over EXACTLY the public primitives.
    // UI previews never run this search. The engine caches per-window results.
    var beam = [{ state: initial(player, options), actions: [] }], best = null, expanded = 0;
    for (var depth = 0; depth < MAX_ACTIONS && beam.length && expanded < 620; depth++) {
      var next = [], seen = Object.create(null);
      beam.forEach(function (node) {
        allowed(node.state).forEach(function (id) {
          if (expanded++ >= 620) return;
          var moved = apply(node.state, id, window), s = moved.state;
          if (s.error) return;
          var actions = node.actions.concat(id);
          if (id === 'ready') {
            var final = waitPrepared(s, window.time - s.elapsed);
            var cost = s.elapsed * 0.65 + (100 - balance(final)) * 0.018 + (player.stamina - s.stamina) * 0.06;
            if (!best || cost < best.cost) best = { actions: actions, cost: cost };
            return;
          }
          // Preserve the finite graph stage, support and continuity state, plus
          // posture/energy/time; distinct future opportunities must not merge.
          var key = Math.round(s.x * 35) + ',' + Math.round(s.y * 55) + ',' + Math.round(s.ux * 2) + ',' + Math.round(s.uy * 2) + ',' + s.support + ',' + id + ',' + Math.round(s.z * 100) + ',' + Math.round(s.vz * 100)
            + ',' + s.contactMode + ',' + s.movementCount + ',' + Math.round(s.lastProgress * 50)
            + ',' + Math.round(s.control * 2) + ',' + Math.round(s.stamina * 2) + ',' + Math.round(s.elapsed * 50);
          var score = Math.max(0, separation(s, window) - REACH) * 2.0 + s.elapsed * 0.82 + Math.hypot(s.ux, s.uy) * 0.10 + (player.stamina - s.stamina) * 0.035;
          if (seen[key] !== undefined && seen[key] <= score) return;
          seen[key] = score; next.push({ state: s, actions: actions, score: score });
        });
      });
      next.sort(function (a, b) { return a.score - b.score; });
      beam = next.slice(0, 14);
    }
    if (!best) return { ok: false, error: $t('有限搜索未找到该窗口的可行路径') };
    var result = preview(player, window, best.actions, options);
    return result.canHit ? { ok: true, contactId: window.id, actions: best.actions, preview: result } : { ok: false, error: $t('未找到可行路径') };
  }
  return { ACTIONS: ACTIONS, GUIDE: GUIDE, MAX_ACTIONS: MAX_ACTIONS, REACH: REACH, CONTACT_LIMITS: CONTACT_LIMITS,
    windowsFor: windowsFor, preview: preview, search: search, assessReachability: assessReachability };
}));
