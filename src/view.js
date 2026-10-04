(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./shot-model.js'), require('./feedback-model.js'), require('./court-rules.js'));
  else root.BadmintonView = factory(root.BadmintonShotModel, root.BadmintonFeedbackModel, root.BadmintonCourtRules);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ShotModel, FeedbackModel, CourtRules) {
  'use strict';

  var C = {
    bg: '#09131f', panel: '#111f30', raised: '#172a3c', line: '#2b4154',
    ink: '#eff7fb', muted: '#8ea7ba', dim: '#536b80', teal: '#54e0c0',
    tealDark: '#143e3d', gold: '#f4d27b', danger: '#f59190', court: '#174940', recovery: '#9eb3ff', aiRecovery: '#A7B8CD'
  };
  var FONT = '"PingFang SC", "Microsoft YaHei", sans-serif';
  var DIRS = { front: [0, -1], back: [0, 1], left: [-1, 0], right: [1, 0] };
  var PHASES = { toss:$t('掷签选择'), serve: $t('准备发球'), predict: $t('预判启动'), route: $t('选择步伐'), shot: $t('组织回球'), pointEnd: $t('这一分结束'), gameEnd: $t('本局结束'), matchEnd: $t('比赛结束') };
  var DECISION_SECONDS = { toss:15, serve:20, predict:8, route:25, shot:20 };
  var SHOT_BANDS = {
    comfortable: { label: $t('顺手'), color: '#54e0c0' },
    strained: { label: $t('吃力'), color: '#f4d27b' },
    heavy: { label: $t('高负担'), color: '#bb96ed' }
  };
  var SHOT_OUTCOMES = { in:$t('预计入场'), net:$t('预计触网'), short:$t('预计未过网'), out:$t('预计出界') };
  var G=CourtRules.GEOMETRY;

  function mount(options) {
    var canvas = options.canvas, ctx = canvas.getContext('2d'), match = options.match;
    var width = options.width, height = options.height, ratio = options.pixelRatio || 1;
    var viewportWidth = width, viewportHeight = height, topInset = options.topInset || 0, bottomInset = options.bottomInset || 0,
      leftInset = options.leftInset || 0, rightInset = options.rightInset || 0, contentScale = 1;
    var layoutWidth=width,layoutHeight=height,leftWidth=0,rightX=0,rightWidth=0,landscape=false;
    var desktopLayout=false,drawOffsetX=leftInset,drawOffsetY=topInset,hoverPoint=null;
    var regions = [], frame, disposed = false, view = match.getView();
    var remaining = 8, paused = true, lastTick = Date.now(), error = '';
    var timingMode=options.chooseTimeMode?null:'practice',timedLastTick=Date.now(),systemPaused=false,concedeOpen=false,expiring=false;
    var direction = 'neutral', commitment = 'light', recoveryMode = 'center', recoveryTarget = { x: 0, y: 0.52 };
    var footContactTime = 0, footActions = [], footPreview = null, footNodes = [], detailsOpen = false, detailPage = 0, replay = null, lastReplay = null;
    var contactDirty = false, lastContactPreviewAt = 0, trialOpen = false, footStartPreview = null;
    var controls = null, shotPreview = null, aimNote = '', manualShotAngle = false, dragging = null, trainingOpen = false, lastProfileJSON = '';
    var shotScan = null, scanSignature = '', shotFactorsOpen = false;
    var recoveryPreview=null,recoverySignature='',recoveryDirty=false,lastRecoveryAt=0;
    var previewDirty = false, lastPreviewAt = 0;
    var oldPhase = '', scrollY = 0, maxScroll = 0, bodyTop = 142, bodyOffset = 44, scrollScene = '';
    var scrollPositions = {}, footCandidates = {}, routeChainOpen = false, reasonDialog = null;
    var footHelpOpen=false,footHelpAutomatic=false,footHelpDismissed=options.footworkHelpDismissed===true;
    var footHelpScroll=0,footHelpMaxScroll=0,footHelpViewport=null;
    var servePosition=null,receivePosition=null,serveHeight=1.05,serveCourtMode='stance';
    var settledSource=null,settledFlight=null;
    var raf = options.requestFrame || function (fn) { return setTimeout(fn, 30); };

    function resize(size) {
      debitTimedClock();
      viewportWidth = Math.max(280, Number(size.width) || viewportWidth);
      viewportHeight = Math.max(240, Number(size.height) || viewportHeight);
      if (typeof size.topInset === 'number') topInset = Math.max(0, size.topInset);
      if (typeof size.bottomInset === 'number') bottomInset = Math.max(0, size.bottomInset);
      if (typeof size.leftInset === 'number') leftInset = Math.max(0, size.leftInset);
      if (typeof size.rightInset === 'number') rightInset = Math.max(0, size.rightInset);
      var usableHeight = Math.max(220, viewportHeight - topInset - bottomInset);
      var usableWidth=Math.max(280,viewportWidth-leftInset-rightInset);
      desktopLayout=options.desktop===true&&usableWidth>=900&&usableHeight>=580;
      contentScale = desktopLayout?Math.min((usableWidth-24)/1040,(usableHeight-24)/660):1;
      width = desktopLayout?1040:usableWidth; height = desktopLayout?660:usableHeight;
      drawOffsetX=leftInset+(usableWidth-width*contentScale)/2;drawOffsetY=topInset+(usableHeight-height*contentScale)/2;
      layoutWidth=width;layoutHeight=height;landscape=viewportWidth>viewportHeight;
      if(!landscape){dragging=null;hoverPoint=null;if(timingMode==='timed'&&decisionActive())systemPaused=true;}
      timedLastTick=Date.now();
      leftWidth=Math.round(width*(desktopLayout?.57:.54));rightX=leftWidth+(desktopLayout?14:8);rightWidth=width-rightX;
      hoverPoint=null;
      ratio = Math.max(1, Math.min(3, Number(size.pixelRatio) || ratio));
      canvas.width = Math.round(viewportWidth * ratio);
      canvas.height = Math.round(viewportHeight * ratio);
      if (canvas.style) { canvas.style.width = viewportWidth + 'px'; canvas.style.height = viewportHeight + 'px'; }
      render();
    }
    function fontSize(size){return desktopLayout?Math.max(13.7,size*1.1):size;}
    function text(value, x, y, size, color, weight, align, exactSize) {
      ctx.font = (weight || '400') + ' ' + (exactSize?size:fontSize(size)) + 'px ' + FONT;
      ctx.fillStyle = color || C.ink;
      ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(String(value), x, y);
    }
    function rounded(x, y, w, h, r) {
      r = Math.max(0, Math.min(r, w / 2, h / 2));
      ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
    }
    function box(x, y, w, h, fill, stroke, r) {
      rounded(x, y, w, h, r === undefined ? 10 : r);
      ctx.fillStyle = fill; ctx.fill();
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
    }
    function line(x1, y1, x2, y2, color, thickness) {
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      ctx.strokeStyle = color; ctx.lineWidth = thickness || 1; ctx.stroke();
    }
    function wrap(value, x, y, maxWidth, size, color, maxLines, spacing) {
      ctx.font = '400 ' + fontSize(size) + 'px ' + FONT;
      if ($lang === 'en') { var wrapped = $lines(function (v) { return ctx.measureText(v).width; }, value, maxWidth), lines = wrapped, s = ''; } else {
      var chars = Array.from(String(value || '')), lines = [], s = '';
      chars.forEach(function (char) {
        if (ctx.measureText(s + char).width > maxWidth && s) { lines.push(s); s = char; }
        else s += char;
      });
      if (s) lines.push(s); }
      if (lines.length > maxLines) {
        lines = lines.slice(0, maxLines);
        var last = lines[maxLines - 1];
        while (ctx.measureText(last + '…').width > maxWidth) last = last.slice(0, -1);
        lines[maxLines - 1] = last + '…';
      }
      lines.forEach(function (ln, i) { text(ln, x, y + i * (desktopLayout?Math.max(spacing||0,fontSize(size)+5):spacing||size+5), size, color); });
      return lines.length;
    }
    function button(label, x, y, w, h, action, opt) {
      opt = opt || {};
      var fill = opt.danger ? '#38252d' : opt.primary ? C.teal : opt.selected ? C.tealDark : C.raised;
      var stroke = opt.danger ? '#82515e' : opt.selected ? C.teal : opt.primary ? null : C.line;
      if (opt.disabled) { fill = '#111c29'; stroke = '#223142'; }
      box(x, y, w, h, fill, stroke, opt.radius || 9);
      text(label, x + w / 2, y + h / 2, opt.size || 13,
        opt.disabled ? C.dim : opt.danger ? C.danger : opt.primary ? '#092a26' : opt.selected ? C.teal : C.ink,
        opt.primary || opt.selected ? '600' : '400', 'center');
      if (!opt.disabled) regions.push({ x: x, y: y, w: w, h: h, action: action, label: label });
    }
    function persistProfile() {
      if (typeof match.getProfile !== 'function') return;
      var profile = match.getProfile(), serialized = JSON.stringify(profile);
      if (serialized !== lastProfileJSON) {
        lastProfileJSON = serialized;
        if (options.onProfileChange) { try { options.onProfileChange(profile); } catch (ignored) {} }
      }
    }
    function phaseBudget() { return timingMode==='timed'?DECISION_SECONDS[view.phase]||0:view.phase === 'route' ? 20 : 8; }
    function decisionActive(){return Object.prototype.hasOwnProperty.call(DECISION_SECONDS,view.phase);}
    function debitTimedClock() {
      var now=Date.now(),elapsed=Math.max(0,(now-timedLastTick)/1000);timedLastTick=now;
      if(timingMode!=='timed'||systemPaused||!landscape||replay||footHelpOpen&&footHelpAutomatic||!decisionActive()||expiring)return false;
      // This clock is independent of drag/preview timestamps. Reading a panel,
      // dragging a slider, or trying a route never grants extra decision time.
      remaining=Math.max(0,remaining-elapsed);
      if(remaining>0)return false;
      expiring=true;dragging=null;reasonDialog=null;concedeOpen=false;footHelpOpen=false;footHelpAutomatic=false;
      act(function(){return match.expireDecision();},true);
      expiring=false;return true;
    }
    function chooseTimingMode(mode) {
      if(timingMode!==null||['timed','untimed'].indexOf(mode)===-1)return;
      timingMode=mode;systemPaused=false;paused=false;remaining=phaseBudget();
      timedLastTick=lastTick=Date.now();error='';render();
    }
    function timingState(){return{mode:timingMode,phase:view.phase,budgetSeconds:timingMode==='timed'?phaseBudget():null,
      remainingSeconds:timingMode==='untimed'||timingMode===null?null:remaining,paused:timingMode==='timed'?systemPaused||!!replay||!landscape||footHelpOpen&&footHelpAutomatic:paused,
      choosingMode:timingMode===null,helpOpen:footHelpOpen,helpAutomatic:footHelpAutomatic,helpDismissed:footHelpDismissed};}
    function openFootworkHelp(automatic) {
      if(view.phase!=='route'||!view.footwork||!view.footwork.guide)return;
      if(!automatic&&debitTimedClock())return;
      footHelpOpen=true;footHelpAutomatic=!!automatic;footHelpScroll=0;footHelpMaxScroll=0;footHelpViewport=null;dragging=null;
      timedLastTick=lastTick=Date.now();
    }
    function closeFootworkHelp() {
      footHelpOpen=false;footHelpAutomatic=false;footHelpViewport=null;dragging=null;timedLastTick=lastTick=Date.now();
    }
    function serveSelection() {
      return Object.assign({},controls||{}, { serverPosition:servePosition&&{x:servePosition.x,y:servePosition.y},contactHeight:serveHeight });
    }
    function footPlan() { return { contactTime: footContactTime, actions: footActions.slice() }; }
    function incomingSample(time) {
      var trajectory = view.incoming && view.incoming.trajectory;
      if (!trajectory) return null;
      return ShotModel && ShotModel.sampleTrajectory ? ShotModel.sampleTrajectory(trajectory, time) : sampleAt(trajectory.samples, time);
    }
    function verticalSpeed(sample) {
      return sample ? Number(typeof sample.verticalSpeed === 'number' ? sample.verticalSpeed : sample.vz || 0) : 0;
    }
    function flightTrend(speed) { return speed > 0.12 ? $t('上升') : speed < -0.12 ? $t('下降') : $t('弧顶附近'); }
    function setContactTime(time, finalUpdate) {
      var duration = view.incoming && view.incoming.trajectory && view.incoming.trajectory.duration || 0;
      footContactTime = Math.max(0, Math.min(duration, time)); error = ''; contactDirty = true;
      if (finalUpdate || Date.now() - lastContactPreviewAt >= 33) refreshFootwork();
    }
    function updateContactDrag(point, finalUpdate) {
      if (!dragging) return;
      if (dragging.kind === 'contactSlider') {
        setContactTime(dragging.duration * Math.max(0, Math.min(1, (point.x - dragging.x) / dragging.w)), finalUpdate); return;
      }
      var points = dragging.points || [], bestDistance = Infinity, bestTime = footContactTime;
      for (var i = 1; i < points.length; i++) {
        var a = points[i - 1], b = points[i], dx = b.x - a.x, dy = b.y - a.y;
        var fraction = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / Math.max(0.000001, dx * dx + dy * dy)));
        var distance = Math.pow(point.x - a.x - dx * fraction, 2) + Math.pow(point.y - a.y - dy * fraction, 2);
        if (distance < bestDistance) { bestDistance = distance; bestTime = a.t + (b.t - a.t) * fraction; }
      }
      setContactTime(bestTime, finalUpdate);
    }
    function contactRegion(geometry, label) {
      if (!geometry || !geometry.points || !geometry.points.length) return;
      regions.push({ x: geometry.x, y: geometry.y, w: geometry.w, h: geometry.h, label: label, action: function (point) {
        dragging = { kind: 'contactTrace', points: geometry.points }; lastTick = Date.now(); updateContactDrag(point, true);
      } });
    }
    function refreshFootwork() {
      if (view.phase !== 'route') { footPreview = null; footStartPreview = null; return; }
      var result = match.previewFootwork(footPlan());
      contactDirty = false; lastContactPreviewAt = Date.now();
      footPreview = result && result.ok ? result : null;
      footStartPreview = !footActions.length ? match.previewFootwork({contactTime:footContactTime,actions:['start']}) : null;
      if (!footPreview) error = result && result.error || $t('路径暂时无法计算');
      footCandidates = {};
      if (footPreview) (view.footwork.actions || []).forEach(function (action) {
        var candidate = action.id==='start'&&footStartPreview ? footStartPreview : match.previewFootwork({ contactTime: footContactTime, actions: footActions.concat([action.id]) });
        var rows = candidate.actionResults || [], previousRows = footPreview.actionResults || [];
        var last = rows[rows.length - 1], appended = rows.length === previousRows.length + 1 && last && last.id === action.id;
        var permitted=(footPreview.nextActions || []).indexOf(action.id)!==-1,priced=permitted&&appended;
        footCandidates[action.id] = { allowed: permitted,
          label: last && last.id === action.id ? last.label : action.label,
          anticipationPenaltySeconds: last && last.id === action.id ? last.anticipationPenaltySeconds : null,
          duration: priced ? last.duration : null,
          balanceDelta: priced ? last.balance - (rows.length > 1 ? rows[rows.length - 2].balance : candidate.balanceBefore) : null,
          distance: priced && Number.isFinite(last.distance) ? last.distance : null,
          progress: priced && Number.isFinite(last.progress) ? last.progress : null,
          combo: priced && last.combo ? last.combo : null,
          reason: candidate.reason || candidate.error || $t('当前无法衔接') };
      });
      if (footPreview && footPreview.canHit) {
        if (controls) refreshPreview(); else aimAt({ x: 0.20, y: 0.65 });
      } else { shotPreview = null; shotScan = null; scanSignature = '';recoveryPreview=null;recoverySignature=''; }
    }
    function appendFootAction(id, explain) {
      if (contactDirty) refreshFootwork();
      if (!footPreview || view.phase !== 'route') return false;
      if ((footPreview.nextActions || []).indexOf(id) === -1) {
        var rejected = footCandidates[id] || {};
        error = rejected.reason || $t('当前动作无法衔接，请先撤销或选择相连节点。');
        if(explain){reasonDialog={title:$t('无法选择')+footLabel(id),reason:error};dragging=null;lastTick=Date.now();}
        return false;
      }
      footActions.push(id); error = ''; refreshFootwork();return true;
    }
    function beginReplay(plan, trajectory, mode, beforePlayers) {
      if (!plan || !trajectory || !plan.bodyPath || !plan.bodyPath.length) return;
      replay = { plan: plan, trajectory: trajectory, mode: mode || $t('回放'), players: beforePlayers || view.players,
        start: Date.now(), duration: Math.max(1, plan.contactTime || trajectory.duration), wallDuration: 2900 };
      lastTick = Date.now(); dragging = null; detailsOpen = false;
    }
    function endReplay() { replay = null; timedLastTick=lastTick = Date.now(); }
    function sampleAt(samples, time) {
      if (!samples || !samples.length) return null;
      if (time <= samples[0].t) return samples[0];
      for (var i = 1; i < samples.length; i++) {
        if (time <= samples[i].t) {
          var a = samples[i - 1], b = samples[i], f = (time - a.t) / Math.max(0.000001, b.t - a.t), out = { t: time };
          ['x', 'y', 'z', 'speed', 'vx', 'vy', 'vz', 'verticalSpeed', 'balance', 'stamina'].forEach(function (key) {
            if (typeof a[key] === 'number' && typeof b[key] === 'number') out[key] = a[key] + (b[key] - a[key]) * f;
          });
          return out;
        }
      }
      return samples[samples.length - 1];
    }
    function currentReplayTime() {
      return replay ? Math.min(replay.duration, Math.max(0, (Date.now() - replay.start) / replay.wallDuration * replay.duration)) : 0;
    }
    function refreshPreview() {
      if (!controls || (view.phase !== 'shot' && view.phase !== 'route' && view.phase !== 'serve')) { shotPreview = null; return; }
      if (view.phase === 'route' && (!footPreview || !footPreview.canHit)) { shotPreview = null; return; }
      var result = view.phase === 'serve' ? match.previewServe(serveSelection()) : view.phase === 'route' ? match.previewShotAfterFootwork(footPlan(), controls) : match.previewShot(controls);
      if(result&&result.ok&&result.controls&&Number.isFinite(result.controls.power)&&Math.abs(result.controls.power-controls.power)>1e-10){
        controls.power=result.controls.power;
        result=view.phase==='serve'?match.previewServe(serveSelection()):view.phase==='route'?match.previewShotAfterFootwork(footPlan(),controls):match.previewShot(controls);
      }
      previewDirty = false; lastPreviewAt = Date.now();
      shotPreview = result && result.ok ? result : null;
      if (!shotPreview) error = result && result.error || $t('当前发射参数无法计算，请重新点选目标。');
      refreshShotScan();
      refreshRecoveryPreview();
    }
    function refreshShotScan() {
      if(!controls || !shotPreview || (view.phase==='route'&&(!footPreview||!footPreview.canHit))){shotScan=null;scanSignature='';return;}
      var scan=view.phase==='serve'?match.scanServeControls:view.phase==='route'?match.scanShotControlsAfterFootwork:match.scanShotControls;
      if(typeof scan!=='function'){shotScan=null;return;}
      var key=JSON.stringify({phase:view.phase,controls:controls,plan:view.phase==='route'?footPlan():null,
        context:view.shotContext||null,service:view.phase==='serve'?{position:servePosition,height:serveHeight}:null,human:view.players.human,profile:lastProfileJSON});
      if(key===scanSignature&&shotScan)return;
      var result=view.phase==='serve'?scan.call(match,serveSelection()):view.phase==='route'?scan.call(match,footPlan(),controls):scan.call(match,controls);
      shotScan=result&&result.ok?result:null;
      scanSignature=shotScan?key:'';
    }
    function aimAt(target) {
      var preferred=manualShotAngle&&controls?controls.angle:undefined,aimOptions=manualShotAngle?{lockAngle:true}:undefined;
      var result = view.phase === 'serve' ? match.assistServe({serverPosition:servePosition,contactHeight:serveHeight},target,preferred,aimOptions) : view.phase === 'route' ? match.assistAimAfterFootwork(footPlan(), target,preferred,aimOptions) : match.assistAim(target,preferred,aimOptions);
      if (!result || !result.ok) { error = result && result.error || $t('此处暂时无法瞄准'); return; }
      controls = { target: { x: result.controls.target.x, y: result.controls.target.y }, angle: result.controls.angle, power: result.controls.power };
      shotPreview = result.preview && result.preview.ok !== false ? result.preview : null;
      if(shotPreview&&shotPreview.controls&&Number.isFinite(shotPreview.controls.power)&&Math.abs(shotPreview.controls.power-controls.power)>1e-10){controls.power=shotPreview.controls.power;shotPreview=null;}
      if (!shotPreview) refreshPreview();
      else {refreshShotScan();refreshRecoveryPreview();}
      error = ''; aimNote = result.preview&&result.preview.aimWarning||result.preview&&result.preview.warning||(manualShotAngle?$t('已保留手动角度，为落点重新匹配力度。'):$t('已为目标配好初始角度和力度，可继续微调。'));
    }
    function recoveryOrigin() {
      var body = view.phase === 'serve' && servePosition ? servePosition : view.phase === 'route' && footPreview ? footPreview.finalState : view.players.human;
      return { x: body.x, y: body.y };
    }
    function currentPowerLimit() {
      var limit=shotPreview&&shotPreview.powerLimit||shotScan&&shotScan.current&&shotScan.current.powerLimit;
      return limit&&Number.isFinite(limit.maxPower)?Math.max(.05,Math.min(1,limit.maxPower)):1;
    }
    function shotRiskText() {
      var risk=shotPreview&&shotPreview.risk||shotScan&&shotScan.current&&shotScan.current.risk;
      if(!risk)return '';
      if(Number.isFinite(risk.lower)&&Number.isFinite(risk.upper))return $t('模拟失误 ')+Math.round(risk.lower*100)+'–'+Math.round(risk.upper*100)+'%';
      return Number.isFinite(risk.estimate)?$t('模拟失误约 ')+(risk.estimate*100).toFixed(1)+'%':'';
    }
    function selectedContactAccuracy() {
      // Read the actual instantaneous 3-D arrival speed, even before any node
      // is selected. Moving the interception slider must update this preview
      // without consuming match randomness or charging footwork time.
      var sample=incomingSample(footContactTime),speed=sample&&sample.speed;
      return Number.isFinite(speed)?ShotModel.contactAccuracy(speed):null;
    }
    function accuracyColor(accuracy) {
      return !accuracy?C.muted:accuracy.hitProbability>=.9?C.teal:accuracy.hitProbability>=.75?C.gold:C.danger;
    }
    function shotImpactItems() {
      var items=shotScan&&shotScan.impacts&&shotScan.impacts.items||[];
      return ['balance','preparation','stamina'].map(function(id){return items.find(function(item){return item.id===id;});});
    }
    function drawShotImpactRow(x,y,w,kind) {
      var items=shotImpactItems(),size=desktopLayout?11:8.5,prefixW=desktopLayout?98:74,cellW=(w-prefixW)/3;
      var titles={circle:$t('长轴半径差·m'),power:$t('上限差·百分点'),risk:$t('失误率差·百分点')};
      text(titles[kind],x,y,size,C.muted,'400','left',true);
      items.forEach(function(item,i){
        var value=item&&(kind==='circle'?item.circleDelta:kind==='power'?item.powerDelta*100:item.riskDelta*100),places=kind==='circle'?2:1;
        var number=Number.isFinite(value)?(Math.abs(value)<Math.pow(10,-places)/2?0:value):null;
        var label=[$t('稳定'),$t('准备'),$t('体力')][i]+' '+(number===null?'—':(number>0?'+':'')+number.toFixed(places));
        var font=size;ctx.font='500 '+font+'px '+FONT;var measured=ctx.measureText(label).width;
        if(measured>cellW-4)font*=Math.max(.8,(cellW-4)/measured);
        text(label,x+prefixW+i*cellW,y,font,['#B599F3',C.teal,'#F4BA80'][i],'500','left',true);
      });
    }
    function drawShotImpactReference(x,y,w) {
      var item=shotImpactItems()[1],seconds=item&&Number.isFinite(item.referenceValue)?item.referenceValue.toFixed(2):'—';
      var label=$t('当前−单项参照：稳/体100、准备')+seconds+$t('s；不相加'),size=desktopLayout?11:8;
      ctx.font='400 '+size+'px '+FONT;var measured=ctx.measureText(label).width;
      text(label,x,y,Math.min(size,size*w/Math.max(w,measured)),C.dim,'400','left',true);
    }
    function recoveryValue(plan,key) {
      return plan&&plan[key]!==undefined?plan[key]:plan&&plan.limits?plan.limits[key]:undefined;
    }
    function appendRecoveryDetails(lines,plan,label) {
      if(!plan)return;
      var max=recoveryValue(plan,'maxDistance');if(!Number.isFinite(max))return;
      function metres(key){var n=Number(recoveryValue(plan,key));return Number.isFinite(n)?n.toFixed(2)+'m':'—';}
      function seconds(key){var n=Number(recoveryValue(plan,key));return Number.isFinite(n)?n.toFixed(2)+'s':'—';}
      lines.push(label+$t('回动：本方向最多 ')+max.toFixed(2)+$t('m，目标距离 ')+metres('targetDistance'));
      lines.push($t('硬上限 ')+metres('hardDistanceCap')+$t(' / 体力限距 ')+metres('staminaDistanceCap')+$t(' / 时间限距 ')+metres('timeDistanceCap'));
      lines.push($t('动作恢复 ')+seconds('strokeDelay')+$t(' + 转向 ')+seconds('turnDelay'));
      var spent=Number(recoveryValue(plan,'staminaSpent')),restored=Number(recoveryValue(plan,'staminaRecovered'));
      if(Number.isFinite(spent)&&Number.isFinite(restored))lines.push($t('回动耗力 −')+spent.toFixed(2)+$t(' / 间歇恢复 +')+restored.toFixed(2));
      var reason=recoveryValue(plan,'reason');if(reason)lines.push($t('限制原因：')+reason);
      if(plan.status==='completed')lines.push($t('已完成回动 ')+Number(plan.moved||0).toFixed(2)+'m / '+Number(plan.elapsed||0).toFixed(2)+'s');
      else lines.push($t('按完整飞行估计，对方提前截击时回动会更短。'));
      lines.push(label===$t('对手')?$t('淡灰蓝虚线箭头表示受限回动；已完成时表示本拍走过的方向。'):$t('实线与小端点表示受限回动；淡虚线与空心目标只表示意图。'));
    }
    function selectedRecoveryTarget() {
      var target = recoveryMode === 'stay' ? recoveryOrigin() : recoveryTarget;
      return recoveryMode === 'stay' ? target : { x: Math.max(-1, Math.min(1, target.x)), y: Math.max(0.025, Math.min(1, target.y)) };
    }
    function recoverySelection() {
      var selection=view.phase==='serve'?serveSelection():Object.assign({},controls||{});
      if(recoveryMode==='stay')selection.recovery='stay';else selection.recoveryTarget=selectedRecoveryTarget();
      return selection;
    }
    function refreshRecoveryPreview() {
      recoveryDirty=false;lastRecoveryAt=Date.now();
      if(!controls||!shotPreview||(view.phase==='route'&&(!footPreview||!footPreview.canHit))){recoveryPreview=null;recoverySignature='';return;}
      var api=view.phase==='route'?match.previewRecoveryAfterFootwork:match.previewRecovery;
      if(typeof api!=='function'){recoveryPreview=null;return;}
      var selection=recoverySelection(),key=JSON.stringify({phase:view.phase,selection:selection,plan:view.phase==='route'?footPlan():null,
        context:view.shotContext||null,human:view.players.human,profile:lastProfileJSON});
      if(key===recoverySignature&&recoveryPreview)return;
      var result=view.phase==='route'?api.call(match,footPlan(),selection):api.call(match,selection);
      recoveryPreview=result&&result.ok?result:null;recoverySignature=recoveryPreview?key:'';
    }
    function selectRecovery(mode) {
      recoveryMode=mode;if(mode==='center')recoveryTarget={x:0,y:.52};
      refreshRecoveryPreview();
    }
    function updateRecoveryDrag(point) {
      if (!dragging || dragging.kind !== 'recovery') return;
      recoveryTarget = dragging.horizontal ? {x:Math.max(-1,Math.min(1,(point.y-dragging.centerY)/dragging.halfWidth)),y:Math.max(.025,Math.min(1,(dragging.netX-point.x)/dragging.halfLength))} :
        { x: Math.max(-1, Math.min(1, (point.x - dragging.centerX) / dragging.halfWidth)), y: Math.max(0.025, Math.min(1, (point.y - dragging.netY) / dragging.halfHeight)) };
      recoveryMode = 'custom'; error = '';recoveryDirty=true;
      if(Date.now()-lastRecoveryAt>=33)refreshRecoveryPreview();
    }
    function recoveryDirection(plan, who) {
      if (!plan || !plan.from || !plan.target) return '';
      var dx = (plan.target.x - plan.from.x) * G.halfWidth, dy = (plan.target.y - plan.from.y) * G.halfLength;
      if (Math.hypot(dx, dy) < 0.05) return $t('原地停留');
      var screenX=(who==='ai'?1:-1)*dy,screenY=dx;
      var horizontal = Math.abs(screenX) > Math.abs(screenY) * 0.30 ? (screenX < 0 ? $t('左') : $t('右')) : '';
      var vertical = Math.abs(screenY) > Math.abs(screenX) * 0.30 ? (screenY < 0 ? $t('上') : $t('下')) : '';
      return $lang === 'en' ? $t('向') + [horizontal, vertical].filter(Boolean).join('-') : $t('向') + horizontal + vertical;
    }
    function revealedRecovery(who) {
      if (!view.recoveryPlans || who === 'ai' && view.phase === 'predict') return null;
      var plan = view.recoveryPlans[who];
      return plan && plan.from && plan.target ? plan : null;
    }
    function syncSelections(reset) {
      if (reset || oldPhase !== view.phase) {
        var enteringRoute=oldPhase!=='route'&&view.phase==='route';
        var carriedControls = oldPhase === 'route' && view.phase === 'shot' && controls ? JSON.parse(JSON.stringify(controls)) : null;
        var carriedManualAngle=!!carriedControls&&manualShotAngle;
        var carryRecovery = oldPhase === 'route' && view.phase === 'shot';
        direction = 'neutral'; commitment = 'light';
        if (!carryRecovery) { recoveryMode = 'center'; recoveryTarget = { x: 0, y: 0.52 }; }
        if (oldPhase !== view.phase) { scrollY = 0; scrollPositions = {}; scrollScene = ''; routeChainOpen = false;reasonDialog=null;shotFactorsOpen=false;concedeOpen=false;footHelpOpen=false;footHelpAutomatic=false; }
        footActions = []; footPreview = null; detailsOpen = false;
        controls = carriedControls; manualShotAngle=carriedManualAngle; shotPreview = null; shotScan = null; scanSignature = '';recoveryPreview=null;recoverySignature='';recoveryDirty=false; aimNote = ''; dragging = null; previewDirty = false; contactDirty = false; trialOpen = false;
        if (view.phase === 'route' && view.footwork) {
          footContactTime = view.footwork.defaultContactTime;
          refreshFootwork();
          if(enteringRoute&&!footHelpDismissed)openFootworkHelp(true);
        }
        if(view.phase==='serve'&&view.service){
          var service=view.service;servePosition=Object.assign({},service.serverPosition);receivePosition=Object.assign({},service.receiverPosition);
          serveHeight=service.contactHeight||1.05;serveCourtMode='stance';
          if(service.server==='human'){var region=service.receiverRegion;aimAt({x:(region.xMin+region.xMax)/2,y:Math.max(region.yMin+.08,Math.min(region.yMax-.08,.88))});}
        }
        if (view.phase === 'shot') { if (controls) { refreshPreview(); aimNote = $t('已沿用步伐阶段的回球试算参数。'); } else aimAt({ x: 0.20, y: 0.65 }); }
        if (trainingOpen && !(view.training && view.training.canTrain)) trainingOpen = false;
        oldPhase = view.phase;
      }
    }
    function act(fn,fromClock) {
      if(!fromClock&&debitTimedClock())return;
      try {
        var previousPhase=view.phase;
        var result = fn();
        if (result && !result.ok) { error = result.error || $t('此动作暂不可用'); return; }
        view = match.getView(); error = ''; lastTick = Date.now();
        if(options.chooseTimeMode&&previousPhase==='matchEnd'&&view.phase!=='matchEnd'){timingMode=null;systemPaused=false;}
        if(previousPhase!==view.phase||timingMode==='practice')remaining=phaseBudget();
        syncSelections(true); persistProfile();
        if(previousPhase!==view.phase)timedLastTick=Date.now();
        lastTick = Date.now();
      } catch (e) { error = e.message || $t('动作未完成，请重试'); }
      render();
    }
    function arrow(x1, y1, x2, y2, color, dashed) {
      var dx = x2 - x1, dy = y2 - y1, d = Math.sqrt(dx * dx + dy * dy);
      if (d < 1) return;
      var a = Math.atan2(dy, dx), endX = x2 - Math.cos(a) * 8, endY = y2 - Math.sin(a) * 8;
      ctx.save(); if (dashed) ctx.setLineDash([5, 5]);
      line(x1, y1, endX, endY, color, 2); ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(endX, endY);
      ctx.lineTo(endX - Math.cos(a - 0.45) * 8, endY - Math.sin(a - 0.45) * 8);
      ctx.lineTo(endX - Math.cos(a + 0.45) * 8, endY - Math.sin(a + 0.45) * 8);
      ctx.closePath(); ctx.fillStyle = color; ctx.fill(); ctx.restore();
    }
    function shuttle(x, y, color) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(-0.55);
      ctx.beginPath(); ctx.moveTo(-5, -7); ctx.lineTo(5, -7); ctx.lineTo(2.5, 3); ctx.lineTo(-2.5, 3); ctx.closePath();
      ctx.fillStyle = color; ctx.fill();
      ctx.beginPath(); ctx.arc(0, 4, 3, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    function recoveryMarker(point, color, size) {
      var r = size || 7;
      ctx.beginPath(); ctx.moveTo(point.x, point.y - r); ctx.lineTo(point.x + r, point.y);
      ctx.lineTo(point.x, point.y + r); ctx.lineTo(point.x - r, point.y); ctx.closePath();
      ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.stroke();
    }
    function drawRecoveryIntent(plan, who, map) {
      if (!plan || !plan.from || !plan.target) return;
      var from = map(plan.from, who), target = map(plan.target, who), color = who === 'ai' ? C.aiRecovery : C.recovery;
      var limits=plan.limits||plan,estimated=plan.estimatedTo||limits.estimatedTo;
      var completed=plan.status==='completed',endpoint=completed?plan.to:estimated;
      if(who==='ai'){
        // One quiet arrow shows only the attainable/completed displacement.
        // Keep the head outside the player marker; a distant intended target
        // must not look like an extra length of movement or a second ball path.
        if(!endpoint)return;
        var end=map(endpoint,who),dx=end.x-from.x,dy=end.y-from.y,distance=Math.hypot(dx,dy);
        if(distance<=13)return;
        var ux=dx/distance,uy=dy/distance,startGap=completed?0:10,endGap=completed?10:0;
        var ax=from.x+ux*startGap,ay=from.y+uy*startGap,tx=end.x-ux*endGap,ty=end.y-uy*endGap;
        var head=Math.min(5,(distance-startGap-endGap)*.55);
        ctx.save();ctx.globalAlpha=completed?.55:.70;ctx.lineCap='round';ctx.lineJoin='round';ctx.setLineDash([4,4]);
        line(ax,ay,tx,ty,color,1.4);ctx.setLineDash([]);
        ctx.beginPath();ctx.moveTo(tx-ux*head-uy*head*.55,ty-uy*head+ux*head*.55);ctx.lineTo(tx,ty);
        ctx.lineTo(tx-ux*head+uy*head*.55,ty-uy*head-ux*head*.55);ctx.strokeStyle=color;ctx.lineWidth=1.4;ctx.stroke();ctx.restore();
        return;
      }
      // An intention is deliberately quiet. Only the bounded forecast or the
      // completed position gets a solid segment; no all-court reference ring.
      ctx.save();ctx.globalAlpha=completed?.20:.35;ctx.setLineDash([3,4]);
      line(from.x,from.y,target.x,target.y,color,1);ctx.setLineDash([]);
      recoveryMarker(target,color,3.5);ctx.restore();
      if(endpoint){
        var actual=map(endpoint,who),dx=actual.x-from.x,dy=actual.y-from.y,length=Math.hypot(dx,dy);
        ctx.save();ctx.globalAlpha=completed?.7:1;
        line(from.x,from.y,actual.x,actual.y,color,2.2);
        if(length>6){var ux=dx/length,uy=dy/length,head=Math.min(5,length*.3),tipX=actual.x-ux*3,tipY=actual.y-uy*3;
          ctx.beginPath();ctx.moveTo(tipX,tipY);ctx.lineTo(tipX-ux*head-uy*head*.5,tipY-uy*head+ux*head*.5);ctx.lineTo(tipX-ux*head+uy*head*.5,tipY-uy*head-ux*head*.5);ctx.closePath();ctx.fillStyle=color;ctx.fill();}
        ctx.beginPath();ctx.arc(actual.x,actual.y,3,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();ctx.strokeStyle=C.bg;ctx.lineWidth=1;ctx.stroke();ctx.restore();
      }
    }
    function player(p, who, map) {
      var pt = map(p, who), color = who === 'human' ? C.teal : C.gold;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, 13, 0, Math.PI * 2); ctx.fillStyle = '#091b22'; ctx.fill();
      ctx.beginPath(); ctx.arc(pt.x, pt.y, 9, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
      text(who === 'human' ? $t('你') : 'AI', pt.x, pt.y, 9, '#08281f', '700', 'center');
      var vx = Number(p.vx) || 0, vy = Number(p.vy) || 0, speed = Math.sqrt(vx * vx + vy * vy);
      if (speed > 0.06) {
        var sign = who === 'human' ? 1 : -1;
        arrow(pt.x + vx / speed * 13, pt.y + sign * vy / speed * 13,
          pt.x + vx / speed * 25, pt.y + sign * vy / speed * 25, color, false);
      }
    }
    function drawCourt(y, h) {
      var pad = width < 350 ? 14 : 18;
      box(pad, y, width - pad * 2, h, '#102b2c', '#204745', 14);
      var courtW = view.phase === 'shot' ? width - 104 : Math.min(width - 112, h * 1.2), courtH = h - 34;
      var left = (width - courtW) / 2, top = y + 17, netY = top + courtH / 2;
      box(left, top, courtW, courtH, C.court, '#99c6b3', 0);
      var map = function (p, who) {
        return { x: width / 2 + Math.max(-1, Math.min(1, p.x)) * courtW / 2,
          y: netY + (who === 'human' ? 1 : -1) * Math.max(0, Math.min(1, p.y)) * courtH / 2 };
      };
      var innerX = courtW * 0.075;
      line(left + innerX, top, left + innerX, top + courtH, '#6c9e8b');
      line(left + courtW - innerX, top, left + courtW - innerX, top + courtH, '#6c9e8b');
      line(left, netY - courtH * 0.15, left + courtW, netY - courtH * 0.15, '#6c9e8b');
      line(left, netY + courtH * 0.15, left + courtW, netY + courtH * 0.15, '#6c9e8b');
      line(width / 2, top, width / 2, netY - courtH * 0.15, '#6c9e8b');
      line(width / 2, netY + courtH * 0.15, width / 2, top + courtH, '#6c9e8b');
      var hp = map(view.players.human, 'human');
      if (view.phase === 'predict' || (view.phase === 'route' && view.prediction)) {
        var shownDirection = view.phase === 'predict' ? direction : view.prediction.direction;
        var shownCommitment = view.phase === 'predict' ? commitment : view.prediction.commitment;
        ctx.save(); ctx.beginPath(); ctx.rect(left, netY, courtW, courtH / 2); ctx.clip();
        if (shownDirection !== 'neutral' && DIRS[shownDirection]) {
          var v = DIRS[shownDirection], a = Math.atan2(v[1], v[0]);
          var radius = Math.min(courtW * 0.67, 70), spread = shownCommitment === 'strong' ? 0.45 : 0.75;
          [[spread * 1.7, 'rgba(84,224,192,.07)'], [spread, 'rgba(84,224,192,.16)'], [spread * 0.42, 'rgba(84,224,192,.19)']].forEach(function (band) {
            ctx.beginPath(); ctx.moveTo(hp.x, hp.y); ctx.arc(hp.x, hp.y, radius, a - band[0], a + band[0]);
            ctx.closePath(); ctx.fillStyle = band[1]; ctx.fill();
          });
          arrow(hp.x, hp.y, hp.x + v[0] * radius * 0.8, hp.y + v[1] * radius * 0.8, C.teal, true);
        } else {
          ctx.beginPath(); ctx.arc(hp.x, hp.y, 23, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(84,224,192,.4)'; ctx.setLineDash([3, 4]); ctx.stroke(); ctx.setLineDash([]);
        }
        ctx.restore();
      }
      function project(sample, hitter) {
        return { x: width / 2 + sample.x * courtW / 2, y: netY + (hitter === 'ai' ? 1 : -1) * sample.y * courtH / 2 };
      }
      function trace(trajectory, hitter, color) {
        if (!trajectory || !trajectory.samples || !trajectory.samples.length) return;
        ctx.save(); ctx.beginPath(); ctx.rect(pad + 2, y + 2, width - pad * 2 - 4, h - 4); ctx.clip();
        ctx.beginPath();
        trajectory.samples.forEach(function (sample, i) {
          var p = project(sample, hitter); if (!i) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        });
        ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash(hitter === 'human' ? [] : [4, 4]); ctx.stroke(); ctx.restore();
      }
      if (view.incoming && view.phase !== 'predict' && view.phase !== 'shot') {
        trace(view.incoming.trajectory, 'ai', C.gold);
      }
      if (view.phase === 'shot' && controls) {
        trace(shotPreview && shotPreview.trajectory, 'human', C.teal);
        if (shotPreview && shotPreview.trajectory) {
          var actual = project(shotPreview.trajectory.landing, 'human');
          var marker = { x: Math.max(pad + 9, Math.min(width - pad - 9, actual.x)), y: Math.max(y + 8, Math.min(y + h - 9, actual.y)) };
          var dispersion = shotPreview.dispersion || { x: 0, y: 0 };
          ctx.save(); ctx.beginPath(); ctx.rect(pad + 2, y + 2, width - pad * 2 - 4, h - 4); ctx.clip();
          ctx.translate(actual.x, actual.y); ctx.scale(Math.max(2, dispersion.x * courtW / 2), Math.max(2, dispersion.y * courtH / 2));
          ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.fillStyle = 'rgba(84,224,192,.20)'; ctx.fill(); ctx.restore();
          ctx.beginPath(); ctx.arc(marker.x, marker.y, 4.5, 0, Math.PI * 2); ctx.fillStyle = shotPreview.valid ? C.teal : C.danger; ctx.fill();
          if (actual.x !== marker.x || actual.y !== marker.y) text($t('界外'), marker.x, marker.y > netY ? marker.y - 12 : marker.y + 12, 9, C.danger, '600', 'center');
        }
        regions.push({ x: left, y: top, w: courtW, h: courtH / 2, label: $t('场地连续瞄准'), action: function (point) {
          aimAt({ x: Math.max(-1, Math.min(1, (point.x - width / 2) / (courtW / 2))), y: Math.max(0, Math.min(1, (netY - point.y) / (courtH / 2))) });
        } });
        regions.push({ x: left, y: netY + 1, w: courtW, h: courtH / 2 - 1, label: $t('本方半场自由回动'), action: function (point) {
          dragging = { kind: 'recovery', centerX: width / 2, halfWidth: courtW / 2, netY: netY, halfHeight: courtH / 2 };
          lastTick = Date.now(); updateRecoveryDrag(point);
        } });
      }
      var aiRecovery = revealedRecovery('ai');
      var humanRecovery = view.phase === 'shot' && controls ? { from: recoveryOrigin(), target: selectedRecoveryTarget(), status: 'intent' } : revealedRecovery('human');
      drawRecoveryIntent(aiRecovery, 'ai', map); drawRecoveryIntent(humanRecovery, 'human', map);
      line(left - 7, netY, left + courtW + 7, netY, '#e2eee5', 2);
      for (var nx = left; nx <= left + courtW; nx += 8) line(nx, netY - 3, nx, netY + 3, '#ddeade', 0.7);
      player(view.players.ai, 'ai', map); player(view.players.human, 'human', map);
      if (humanRecovery) recoveryMarker(map(humanRecovery.target, 'human'), C.recovery,
        Math.hypot(humanRecovery.target.x-humanRecovery.from.x,humanRecovery.target.y-humanRecovery.from.y)<0.01?14:7);
      if (view.phase === 'shot' && controls) {
        if (marker) {
          ctx.beginPath(); ctx.arc(marker.x, marker.y, 4.5, 0, Math.PI * 2); ctx.fillStyle = shotPreview.valid ? C.teal : C.danger; ctx.fill();
        }
      }
      text($t('对手'), pad + 9, y + 18, 10, C.gold);
      text(view.phase === 'shot' ? $t('回动') : $t('你的'), pad + 10, y + h - 41, 10, view.phase === 'shot' ? C.recovery : C.teal);
      text(view.phase === 'shot' ? $t('目标') : $t('半场'), pad + 10, y + h - 27, 10, view.phase === 'shot' ? C.recovery : C.teal);
      if (aiRecovery) text((aiRecovery.status === 'completed' ? $t('对手已回动 · ') : $t('对手回动意图 · ')) + recoveryDirection(aiRecovery,'ai'), width-pad-9, y+8, 9, C.aiRecovery, '500', 'right');
      if (view.phase !== 'shot') {
        text($t('球场'), width - pad - 10, y + 18, 9, '#6a9a90', '400', 'right');
        text($t('示意'), width - pad - 10, y + 30, 9, '#6a9a90', '400', 'right');
      }
      if (view.phase === 'predict') {
        text($t('球路待揭晓'), width - pad - 10, y + h - 13, 9, '#a6bdb5', '400', 'right');
      } else if (view.phase === 'shot') {
        text($t('上半场瞄准 · 下半场回动（虚线◇为意图）'), width / 2, y + h - 8, 9, '#b1cdbd', '400', 'center');

      } else if (view.incoming) {
        text($t('来球 ') + Number(view.incoming.duration || 0).toFixed(2) + 's', width - pad - 10, y + h - 13, 9, '#c9d5bd', '400', 'right');
      }
    }
    function drawCurrentHUD(pad) {
      var gap = 8, half = (width - pad * 2 - gap) / 2;
      ['human', 'ai'].forEach(function (id, i) {
        var p = view.players[id], x = pad + i * (half + gap), color = id === 'human' ? C.teal : C.gold;
        box(x, 64, half, 70, C.panel, C.line, 10);
        text(id === 'human' ? $t('你 · 当前') : $t('对手 · 当前'), x + 10, 76, 11, color, '600');
        [[$t('体力'), p.stamina, 93], [$t('稳定度'), p.balance, 118]].forEach(function (row) {
          text(row[0] + ' ' + Number(row[1]).toFixed(1), x + 10, row[2], 11, C.ink, '500');
          box(x + 10, row[2] + 8, half - 20, 4, '#283c4c', null, 2);
          box(x + 10, row[2] + 8, Math.max(0.1, (half - 20) * Math.max(0, Math.min(100, row[1])) / 100), 4, color, null, 2);
        });
      });
    }
    function segmentBar(data, x, y, w, h) {
      box(x, y, w, h, '#24364a', null, 4);
      ctx.save(); rounded(x, y, w, h, 4); ctx.clip();
      (data.segments || []).forEach(function (segment) {
        if (segment.widthRatio <= 0) return;
        ctx.fillStyle = segment.color;
        ctx.fillRect(x + segment.startRatio * w, y, segment.widthRatio * w, h);
        if (segment.startRatio > 0) line(x + segment.startRatio * w, y + 1, x + segment.startRatio * w, y + h - 1, C.bg, 1);
      });
      ctx.restore();
    }
    function drawRouteFeedback(pad) {
      if(!footPreview||!FeedbackModel)return;
      var feedback=FeedbackModel.buildFootworkFeedback(footPreview,view.incoming.duration,view.players.human);
      var t=feedback.time,state=feedback.stability,comparison=feedback.anticipation,w=width-pad*2,margin=t.margin;
      ctx.fillStyle=C.bg;ctx.fillRect(0,138,width,166);
      text($t('完整飞行 ')+t.axisMax.toFixed(2)+'s',pad,148,12,C.gold,'700');
      text($t('触球截止 ')+t.contactDeadline.toFixed(2)+'s',width-pad,148,12,C.ink,'700','right');
      var barY=177,barH=24;
      segmentBar(t,pad,barY,w,barH);
      var deadlineX=pad+t.deadlineRatio*w;
      line(deadlineX,barY-4,deadlineX,barY+barH+4,C.ink,1.8);
      if(margin&&margin.available){
        var label=margin.label,color=margin.kind==='overtime'?C.danger:margin.kind==='remaining'?C.teal:C.ink;
        var centerX=pad+margin.anchorRatio*w,segmentW=margin.widthRatio*w;
        ctx.font='700 11px '+FONT;var labelW=ctx.measureText(label).width;
        var inside=margin.kind!=='zero'&&!margin.clipped&&segmentW>=labelW+12;
        if(inside){
          text(label,centerX,barY+barH/2,11,margin.kind==='overtime'?'#36131b':C.ink,'700','center');
          text($t('路径 ')+t.totalTime.toFixed(2)+'s',pad,165,11,C.muted);
        }else{
          var labelX=Math.max(pad+labelW/2,Math.min(width-pad-labelW/2,centerX));
          text(label,labelX,164,11,color,'700','center');
          line(labelX,170,centerX,barY-2,color,1.7);
          ctx.beginPath();ctx.arc(centerX,barY-2,2,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();
          var leftSide=centerX<width/2;
          text($t('路径 ')+t.totalTime.toFixed(2)+'s',leftSide?width-pad:pad,165,11,C.muted,'400',leftSide?'right':'left');
        }
      }
      if(comparison.available){
        var actualX=pad+comparison.actualRatio*w,neutralX=pad+comparison.neutralRatio*w,spanW=Math.abs(actualX-neutralX),compareY=211;
        // Keep the reference outside the cost bar so it cannot cross its margin label.
        line(neutralX,barY-4,neutralX,barY-1,'#B599F3',2);
        line(neutralX,compareY-6,neutralX,compareY+6,'#B599F3',2);
        if(comparison.direction!==0&&spanW>0){
          var arrowSize=Math.min(9,spanW),sign=comparison.direction,bodyEnd=actualX-sign*arrowSize;
          ctx.fillStyle=comparison.color;ctx.fillRect(Math.min(bodyEnd,neutralX),compareY-4,Math.abs(bodyEnd-neutralX),8);
          ctx.beginPath();ctx.moveTo(actualX,compareY);ctx.lineTo(actualX-sign*arrowSize,compareY-arrowSize*.75);ctx.lineTo(actualX-sign*arrowSize,compareY+arrowSize*.75);ctx.closePath();ctx.fillStyle=comparison.color;ctx.fill();
        }else if(comparison.direction===0){
          ctx.beginPath();ctx.arc(actualX,compareY,3,0,Math.PI*2);ctx.strokeStyle='#B599F3';ctx.lineWidth=2;ctx.stroke();
        }
        var symbol=comparison.direction>0?'→ ':comparison.direction<0?'← ':'· ';
        text(symbol+comparison.label,pad,226,12,comparison.color,'700');
        text($t('中性对照'),width-pad,226,9,C.muted,'400','right');
      }else text(footActions.length?$t('预判：当前动作段不可比，明细可查看原因'):$t('预判：先添加动作，再与中性启动比较'),pad,225,10,C.muted);
      var label=feedback.mode==='projected'?$t('预计接球'):$t('路径阶段值');
      text(label+$t(' · 稳定度 ')+state.before.toFixed(1)+'→'+state.after.toFixed(1),pad,245,11,C.ink,'500');
      text((state.delta>=0?'+':'')+state.delta.toFixed(1),width-pad,245,11,state.delta<0?C.danger:C.teal,'600','right');
      segmentBar(state,pad,255,w,10);
      var distance=FeedbackModel.buildDistanceBar&&FeedbackModel.buildDistanceBar(footPreview,view.players.human);
      if(distance&&distance.available){
        text($t('距球 ')+distance.after.toFixed(2)+'m',pad,277,11,C.ink,'500');
        var distanceLabel=distance.retreatDistance>0.000001?$t('远离 +')+distance.retreatDistance.toFixed(2)+$t('m · 还需 ')+distance.gap.toFixed(2)+'m':distance.withinReach?$t('已进触及范围'):$t('还需接近 ')+distance.gap.toFixed(2)+'m';
        text(distanceLabel,width-pad,277,distance.retreatDistance>0.000001?10:11,distance.retreatDistance>0.000001?C.danger:distance.withinReach?C.teal:C.gold,'500','right');
        segmentBar(distance,pad,287,w,10);
        line(pad+distance.bodyRatio*w,284,pad+distance.bodyRatio*w,300,C.ink,1.7);
        line(pad+distance.reachStartRatio*w,285,pad+distance.reachStartRatio*w,299,C.gold,1.1);
        ctx.beginPath();ctx.arc(pad+distance.targetRatio*w,292,3,0,Math.PI*2);ctx.fillStyle=C.gold;ctx.fill();
      }else text($t('移动距离待计算'),pad,277,10,C.muted);
    }
    function receiptText(receipt) {
      if (!receipt) return '';
      return receipt.label + $t(' · 实扣 ') + Number(receipt.spent).toFixed(1) + $t(' / 恢复 ') + Number(receipt.recovered).toFixed(1) + '  ' + Number(receipt.before).toFixed(1) + '→' + Number(receipt.after).toFixed(1);
    }
    function drawShotFlight(pad, trial) {
      var flight=shotPreview&&shotPreview.trajectory,net=flight&&flight.terminal==='net';
      box(pad,142,width-pad*2,77,C.panel,net?'#72464c':'#31534f',11);
      text(net?$t('至触网'):$t('预计完整飞行'),pad+12,159,12,net?C.danger:C.teal,'700');
      text(flight?flight.duration.toFixed(2)+'s':'—',width-pad-12,172,28,net?C.danger:C.ink,'700','right');
      text(trial?$t('你的回球 · 未执行试算'):$t('你的回球 · 当前参数'),pad+12,181,10,C.muted);
      text(net?$t('当前轨迹以触网为终点'):$t('预测至落地 · 对手可以提前截击'),pad+12,205,10,net?C.danger:C.muted);
    }
    function drawHeader(pad) {
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, width, 140);
      shuttle(pad + 6, 17, C.teal);
      text($lang==='en'?'Tactics Board':$t('羽毛球战术棋盘'), pad + 21, 17, 14, C.ink, '600');
      var training = view.training || { canTrain: false, points: 0 };
      button(training.canTrain ? $t('训练 · ') + training.points + $t('点') : $t('训练仅局外'), width - pad - 82, 5, 82, 25,
        function () { trainingOpen = true; dragging = null; }, { size: 10, disabled: !training.canTrain });
      text($t('你'), pad, 45, 11, C.teal, '600');
      text(String(view.score.human).padStart(2, '0') + ' : ' + String(view.score.ai).padStart(2, '0'), pad + 22, 44, 23, C.ink, '700');
      text('AI', pad + 114, 45, 11, C.gold, '600');
      var tx = width - pad - 112, ty = 33;
      var timerHeld = paused || trainingOpen || detailsOpen || trialOpen || !!replay || !!dragging || !!reasonDialog;
      box(tx, ty, 112, 26, timerHeld ? '#24303e' : '#172b36', timerHeld ? C.line : '#28554f', 13);
      text(timerHeld ? '▶' : 'Ⅱ', tx + 13, ty + 13, 10, C.teal, '600', 'center');
      var active = ['predict', 'route', 'shot'].indexOf(view.phase) !== -1;
      text(reasonDialog ? $t('提示暂停') : trainingOpen ? $t('训练暂停') : trialOpen ? $t('试算暂停') : detailsOpen || replay ? $t('回看暂停') : dragging ? $t('调整暂停') : paused ? $t('练习暂停') : active ? $t('思考 ') + remaining.toFixed(1) + 's' : $t('已结算'), tx + 27, ty + 13, 11,
        !timerHeld && remaining < 2 && active ? C.gold : C.ink, '500');
      if (!trialOpen) regions.push({ x: tx, y: ty, w: 112, h: 26, label: $t('切换练习暂停'), action: function () { paused = !paused; lastTick = Date.now(); } });
      if (active && !timerHeld) box(pad, 61, (width - pad * 2) * Math.max(0.001, remaining / phaseBudget()), 2, remaining < 2 ? C.gold : C.teal, null, 1);
      drawCurrentHUD(pad);
    }
    function drawPredict(y, pad, available) {
      var gap = desktopLayout?12:7, bw = (width - pad * 2 - gap * 2) / 3;
      var bh = desktopLayout?52:Math.min(37, Math.max(30, (available - 83) / 3));
      var entries = [
        ['front', $t('近网 →'), 2, 1], ['left', $t('上侧 ↑'), 1, 0], ['neutral', $t('中性准备'), 1, 1],
        ['right', $t('下侧 ↓'), 1, 2], ['back', $t('← 后场'), 0, 1]
      ];
      entries.forEach(function (it) {
        button(it[1], pad + it[2] * (bw + gap), y + it[3] * (bh + gap), bw, bh,
          function () { direction = it[0]; }, { selected: direction === it[0], size: 12 });
      });
      text($t('根据左侧球场的画面方向选择'),pad,y-17,10,C.dim);
      var cy = y + 3 * (bh + gap) + 1, cw = (width - pad * 2 - 7) / 2;
      button($t('轻度偏向 · 易调整'), pad, cy, cw, desktopLayout?44:30, function () { commitment = 'light'; },
        { selected: commitment === 'light', disabled: direction === 'neutral', size: 11 });
      button($t('提前启动 · 高风险'), pad + cw + 7, cy, cw, desktopLayout?44:30, function () { commitment = 'strong'; },
        { selected: commitment === 'strong', disabled: direction === 'neutral', size: 11 });
      button($t('锁定预判 · 揭晓来球'), pad, cy + (desktopLayout?60:39), width - pad * 2, desktopLayout?54:41,
        function () { act(function () { return match.predict(direction, commitment); }); }, { primary: true });
      return cy + 80;
    }
    function drawMovementCourt(x, y, w, h, plan, trajectory, replayTime, players, selectedTime) {
      players = players || view.players;
      box(x, y, w, h, '#102b2c', '#204745', 10);
      var left = x + 9, top = y + 9, cw = w - 18, ch = h - 18, netY = y + h / 2;
      box(left, top, cw, ch, C.court, '#89b4a2', 0);
      line(left, netY, left + cw, netY, '#d5e8dc', 2);
      line(left, netY - ch * 0.15, left + cw, netY - ch * 0.15, '#688f7f');
      line(left, netY + ch * 0.15, left + cw, netY + ch * 0.15, '#688f7f');
      line(left + cw / 2, top, left + cw / 2, netY - ch * 0.15, '#688f7f');
      line(left + cw / 2, netY + ch * 0.15, left + cw / 2, top + ch, '#688f7f');
      function body(p, who) { return { x: left + cw / 2 + p.x * cw / 2, y: netY + (who === 'ai' ? -1 : 1) * p.y * ch / 2 }; }
      function ball(p) { return { x: left + cw / 2 + p.x * cw / 2, y: netY + p.y * ch / 2 }; }
      var samples = trajectory && trajectory.samples || [];
      ctx.save(); ctx.beginPath(); ctx.rect(x + 1, y + 1, w - 2, h - 2); ctx.clip();
      ctx.beginPath(); samples.forEach(function (p, i) { var q = ball(p); if (!i) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y); });
      ctx.strokeStyle = 'rgba(244,210,123,.6)'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
      if (plan && plan.bodyPath) {
        ctx.beginPath(); plan.bodyPath.forEach(function (p, i) { var q = body(p); if (!i) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y); });
        ctx.strokeStyle = C.teal; ctx.lineWidth = 2; ctx.stroke();
        (plan.actionResults || []).forEach(function (step, i) {
          var q = body(step.point); ctx.beginPath(); ctx.arc(q.x, q.y, 3, 0, Math.PI * 2); ctx.fillStyle = C.teal; ctx.fill();
          if (replayTime === undefined) text(i + 1, q.x + 6, q.y - 5, 8, C.ink, '600');
        });
      }
      drawRecoveryIntent(revealedRecovery('ai'), 'ai', body);
      var human = replayTime === undefined ? plan && plan.finalState || players.human : sampleAt(plan.bodyPath, replayTime) || players.human;
      var hp = body(human), ap = body(players.ai, 'ai');
      [ [hp, C.teal, $t('你')], [ap, C.gold, 'AI'] ].forEach(function (p) {
        ctx.beginPath(); ctx.arc(p[0].x, p[0].y, 8, 0, Math.PI * 2); ctx.fillStyle = p[1]; ctx.fill();
        text(p[2], p[0].x, p[0].y, 8, '#09261f', '600', 'center');
      });
      if (plan && plan.contact) {
        var cp = body(plan.contact.point);
        ctx.beginPath(); ctx.arc(cp.x, cp.y, 6, 0, Math.PI * 2); ctx.strokeStyle = C.gold; ctx.lineWidth = 1.5; ctx.stroke();
        if (replayTime === undefined) { ctx.setLineDash([2, 3]); line(hp.x, hp.y, cp.x, cp.y, C.gold, 1); ctx.setLineDash([]); }
      }
      var markTime = replayTime !== undefined ? replayTime : selectedTime;
      if (markTime !== undefined) {
        var sample = ShotModel && ShotModel.sampleTrajectory ? ShotModel.sampleTrajectory(trajectory, markTime) : sampleAt(samples, markTime);
        if (sample) { var bp = ball(sample); shuttle(bp.x, bp.y, replayTime === undefined ? C.gold : C.ink); }
      }
      ctx.restore();
      return { x: x, y: y, w: w, h: h, points: samples.map(function (sample) { var p = ball(sample); p.t = sample.t; return p; }) };
    }
    function footLabel(id) {
      if(id==='start'){
        var selected=footResultAt(footPreview,0),candidate=footCandidates.start;
        if(selected&&selected.id==='start')return selected.label;
        if(candidate&&candidate.label)return candidate.label;
      }
      var list = view.footwork && view.footwork.actions || [];
      var found = list.filter(function (a) { return a.id === id; })[0]; return found ? found.label : id;
    }
    function startAnticipationDisplay() {
      return FeedbackModel.buildStartAnticipation(footResultAt(footPreview,0)||footResultAt(footStartPreview,0));
    }
    function footActionColor(id,row) {
      if(id==='start'){var info=row?FeedbackModel.buildStartAnticipation(row):startAnticipationDisplay();if(info.color)return info.color;}
      return (FeedbackModel.ACTION_STYLES[id]||{}).color||C.muted;
    }
    function footResultAt(plan,index) {
      var rows=plan&&plan.actionResults||[];
      for(var i=0;i<rows.length;i++)if((Number.isInteger(rows[i].requestIndex)?rows[i].requestIndex:i)===index)return rows[i];
      return null;
    }
    function footResultStatus(result) {
      return !result?'unexecuted':result.executionStatus||'completed';
    }
    function footStatusText(result) {
      var status=footResultStatus(result);
      return status==='unexecuted'?$t('未计算到此步'):status==='partial'?$t('本步中断'):status==='late'?$t('本步超时'):$t('模拟完成');
    }
    function drawFootworkMotion(plan,map,time) {
      var path=plan&&plan.bodyPath||[],markers=[];
      (plan&&plan.actionResults||[]).forEach(function(step,index){
        var order=(Number.isInteger(step.requestIndex)?step.requestIndex:index)+1;
        var start=Number.isFinite(step.scheduledStartTime)?step.scheduledStartTime:Number.isFinite(step.startTime)?step.startTime:step.cumulativeTime-step.duration,end=Number.isFinite(step.scheduledEndTime)?step.scheduledEndTime:Number.isFinite(step.endTime)?step.endTime:step.cumulativeTime;
        var status=footResultStatus(step),color=footActionColor(step.id,step);
        if(time!==null&&time<start-1e-8)return;
        var cutoff=time===null?end:Math.min(time,end),points;
        if(Number.isInteger(step.pathStartIndex)&&Number.isInteger(step.pathEndIndex))points=path.slice(step.pathStartIndex,step.pathEndIndex+1);
        else points=path.filter(function(point){return point.t>=start-1e-8&&point.t<=end+1e-8;});
        var visible=[];
        points.forEach(function(point){if(point.t<=cutoff+1e-8)visible.push(point);});
        if(points.length&&cutoff<end-1e-8){var current=sampleAt(points,cutoff);if(current)visible.push(current);}
        // Zero-displacement and waiting actions receive a number, never a
        // fabricated movement segment. Integrator samples remain authoritative.
        if(visible.length>1){ctx.save();ctx.beginPath();visible.forEach(function(point,i){var q=map(point,'human');if(i)ctx.lineTo(q.x,q.y);else ctx.moveTo(q.x,q.y);});ctx.strokeStyle=status==='completed'?color:C.danger;ctx.lineWidth=2.4;if(status!=='completed')ctx.setLineDash([2,2]);ctx.stroke();ctx.restore();}
        if(cutoff>=end-1e-8){var endpoint=step.to||step.point,performed=step.duration>1e-9||step.distance>1e-9;
          markers.push({order:order,point:endpoint&&performed?map(endpoint,'human'):null,color:color,status:status});}
      });
      return markers;
    }
    function drawFootworkMarkers(markers,x,y,w,h) {
      if(!markers.length)return;
      var pitch=Math.min(desktopLayout?26:17,(w-12)/markers.length),start=x+w/2-(markers.length-1)*pitch/2,base=y+h-(desktopLayout?12:8);
      // The numbered annotation rail separates repeated/coincident endpoints.
      // Leaders are not a second movement path and never change court positions.
      markers.forEach(function(marker,index){var mx=start+index*pitch,p=marker.point,color=marker.status==='completed'?marker.color:C.danger;
        if(p){ctx.save();ctx.globalAlpha=.48;ctx.setLineDash([1,3]);line(p.x,p.y,mx,base-(desktopLayout?9:6),color,.7);ctx.restore();ctx.beginPath();ctx.arc(p.x,p.y,2,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();}
        ctx.beginPath();ctx.arc(mx,base,desktopLayout?9:6,0,Math.PI*2);ctx.fillStyle=marker.status==='completed'?color:C.bg;ctx.fill();ctx.strokeStyle=color;ctx.lineWidth=1;ctx.stroke();
        text(marker.order,mx,base,9,marker.status==='completed'?C.bg:color,'700','center');
      });
    }
    function drawRoutes(pad, controlsOnly) {
      var footwork = view.footwork, plan = footPreview;
      if (!footwork || !plan) { wrap(error || $t('步伐数据准备中'), pad, 160, width - pad * 2, 13, C.muted, 2); return 200; }
      var arenaH = Math.max(132, Math.min(190, height - 458)), contentW = width - pad * 2;
      var mapW = contentW * 0.59, sideX = pad + mapW + 8, sideW = contentW - mapW - 8;
      var incoming = view.incoming && view.incoming.trajectory;
      if(!controlsOnly){
      var topGeometry = drawMovementCourt(pad, 98, mapW, arenaH, plan, incoming, undefined, undefined, footContactTime);
      var sideGeometry = drawSideProfile(sideX, 98, sideW, Math.max(60, arenaH - 59), { valid: true, trajectory: incoming, hitter: 'ai' }, footContactTime);
      contactRegion(topGeometry, $t('顶视球路连续截击')); contactRegion(sideGeometry, $t('侧视球路连续截击'));
      var mY = 98 + arenaH - 46;
      var selectedBall = incomingSample(footContactTime), vertical = verticalSpeed(selectedBall);
      text($t('选点速 ') + Number(selectedBall && selectedBall.speed || 0).toFixed(1) + ' m/s', sideX, mY, 10, C.gold);
      text($t('高 ') + Number(selectedBall && selectedBall.z || 0).toFixed(2) + 'm · ' + flightTrend(vertical), sideX, mY + 15, 10, C.muted);
      text($t('垂直 ') + (vertical > 0 ? '+' : '') + vertical.toFixed(1) + ' m/s', sideX, mY + 30, 10, C.muted);
      var opponentRecovery = revealedRecovery('ai');
      text(opponentRecovery ? $t('对手回动方向 · ') + recoveryDirection(opponentRecovery,'ai') + $t('（虚线箭头）') : $t('对手回动意图尚未揭露'),pad,98+arenaH+11,10,opponentRecovery?C.aiRecovery:C.dim);
      }
      var cy = controlsOnly?74:98 + arenaH + 28, windows = footwork.contactWindows || [], sliderX = pad + 87, sliderW = contentW - 95, duration = incoming && incoming.duration || 1;
      if(!controlsOnly){
      text($t('截击 ') + footContactTime.toFixed(2) + 's', pad, cy + 13, 11, C.teal, '600');
      box(sliderX, cy + 11, sliderW, 4, '#334253', null, 2);
      (footwork.contactIntervals || []).forEach(function (interval) {
        box(sliderX + interval.start / duration * sliderW, cy + 11, Math.max(1, (interval.end - interval.start) / duration * sliderW), 4, '#509d83', null, 2);
      });
      var sliderPoint = sliderX + footContactTime / duration * sliderW;
      ctx.beginPath(); ctx.arc(sliderPoint, cy + 13, 6, 0, Math.PI * 2); ctx.fillStyle = plan.valid ? C.teal : C.danger; ctx.fill();
      regions.push({ x: sliderX - 7, y: cy, w: sliderW + 14, h: 27, label: $t('连续截击时间滑条'), action: function (point) {
        dragging = { kind: 'contactSlider', x: sliderX, w: sliderW, duration: duration }; lastTick = Date.now(); updateContactDrag(point, true);
      } });
      }
      var recovered = plan.terminalState && plan.terminalState.recoveredStamina || Math.max(0, plan.staminaAfter - plan.staminaBefore + plan.staminaCost);
      var statusLabel = plan.valid && plan.canHit ? $t('预计接球') : $t('路径阶段值');
      text(statusLabel + $t(' · 体力 ') + plan.staminaBefore.toFixed(1) + '→' + plan.staminaAfter.toFixed(1), pad, cy + 42, 11, C.ink);
      text($t('消耗 −') + plan.staminaCost.toFixed(1) + $t(' / 等待恢复 +') + recovered.toFixed(1), pad, cy + 60, 10, C.gold);
      text($t('稳定条：保留 / 净损失 / 净恢复；距离末段为触及范围'),pad,cy+81,9,C.muted);
      text($t('动作池 · 手划/点选'),pad,cy+104,11,C.muted);
      button($t('查看路径 · ')+footActions.length+$t('步'),width-pad-122,cy+89,122,30,function(){routeChainOpen=true;scrollY=Math.max(0,sequenceY-98-12);},{size:11});
      var graphY=cy+124,gap=20,third=(contentW-gap*2)/3,half=(contentW-gap)/2,rows=plan.actionResults||[],ordersById={};
      footActions.forEach(function(id,i){if(!ordersById[id])ordersById[id]=[];ordersById[id].push(i+1);});
      function middleBase(id){var candidate=footCandidates[id]||{};return Number.isFinite(candidate.distance)||(ordersById[id]||[]).length?112:72;}
      function middleHeight(id,w){var count=(ordersById[id]||[]).length,cols=Math.max(1,Math.min(3,Math.floor((w-16)/32))),base=middleBase(id);return count?base+Math.ceil(count/cols)*47+6:base+4;}
      var row1Y=graphY+88,row1H=Math.max(middleHeight('shuffle',third),middleHeight('cross',third),middleHeight('hop',third));
      var row2Y=row1Y+row1H+20,row2H=Math.max(middleHeight('ground',half),middleHeight('jump',half)),readyY=row2Y+row2H+20;
      var layouts={start:[pad,graphY,contentW,68],shuffle:[pad,row1Y,third,middleHeight('shuffle',third)],cross:[pad+third+gap,row1Y,third,middleHeight('cross',third)],hop:[pad+2*(third+gap),row1Y,third,middleHeight('hop',third)],ground:[pad,row2Y,half,middleHeight('ground',half)],jump:[pad+half+gap,row2Y,half,middleHeight('jump',half)],ready:[pad,readyY,contentW,68]};
      footNodes=(footwork.actions||[]).map(function(action){var position=layouts[action.id];return{id:action.id,label:action.label,x:position[0],y:position[1],w:position[2],h:position[3]};});
      function badge(order,x,y,r,color){
        ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();
        if(order===footActions.length){ctx.strokeStyle=C.ink;ctx.lineWidth=2.5;ctx.stroke();}
        text(order,x,y,order>9?18:21,C.bg,'700','center');
      }
      function gapArrow(x1,y1,x2,y2,color){
        var dx=x2-x1,dy=y2-y1,len=Math.hypot(dx,dy);if(len<5)return;
        var ux=dx/len,uy=dy/len,head=Math.min(7,len*.4);
        line(x1,y1,x2-ux*head,y2-uy*head,color,3);
        ctx.beginPath();ctx.moveTo(x2,y2);ctx.lineTo(x2-ux*head-uy*4,y2-uy*head+ux*4);ctx.lineTo(x2-ux*head+uy*4,y2-uy*head-ux*4);ctx.closePath();ctx.fillStyle=color;ctx.fill();
      }
      // Only bridge clear gaps between real successive rows. Repeated/backward
      // occurrences remain explicit in the numbered nodes and expanded chain.
      var arrowsDrawn={};
      for(var edge=1;edge<footActions.length;edge++){
        var source=footNodes.find(function(n){return n.id===footActions[edge-1];}),target=footNodes.find(function(n){return n.id===footActions[edge];});
        var key=source&&target&&source.id+'>'+target.id;
        if(source&&target&&!arrowsDrawn[key]&&target.y>=source.y+source.h&&target.y-source.y-source.h<=24){
          var sx=source.id==='start'?target.x+target.w/2:source.x+source.w/2,tx=target.id==='ready'?sx:target.x+target.w/2;
          gapArrow(sx,source.y+source.h+2,tx,target.y-3,'#b7ead9');arrowsDrawn[key]=true;
        }
      }
      if(footActions.length===1&&footActions[0]==='start')footNodes.forEach(function(node){
        if((node.id==='shuffle'||node.id==='cross'||node.id==='hop')&&footCandidates[node.id]&&footCandidates[node.id].allowed)
          gapArrow(node.x+node.w/2,graphY+70,node.x+node.w/2,node.y-3,'#739d96');
      });
      footNodes.forEach(function(node){
        var candidate=footCandidates[node.id]||{},legal=candidate.allowed,orders=ordersById[node.id]||[],count=orders.length;
        var color=footActionColor(node.id),full=node.id==='start'||node.id==='ready';
        box(node.x,node.y,node.w,node.h,legal?'#19303d':count?'#182e3a':C.panel,legal?color:C.line,full?14:10);
        box(node.x+6,node.y+9,3,node.h-18,color,null,2);
        if(full&&node.id==='ready'){
          var accuracy=selectedContactAccuracy();
          if(count)badge(orders[0],node.x+30,node.y+25,18,color);
          text(node.label,node.x+57,node.y+16,13,legal||count?C.ink:C.muted,'600');
          text($t('0.00s · 末项必选'),node.x+node.w-10,node.y+16,11,C.muted,'400','right');
          text($t('截击球速 ')+(accuracy?accuracy.speed.toFixed(1)+' m/s':'—'),node.x+57,node.y+37,11,C.gold);
          text($t('命中率 ')+(accuracy?(accuracy.hitProbability*100).toFixed(1)+'%':'—'),node.x+node.w-10,node.y+37,11,accuracyColor(accuracy),'600','right');
          text($t('命中后仍需过网、界内；点击只完成路径'),node.x+57,node.y+56,10,C.muted);
        }else if(full){
          if(count)badge(orders[0],node.x+30,node.y+25,18,color);
          else text(legal?$t('下一步'):$t('待选择'),node.x+30,node.y+25,9,legal?color:C.dim,'500','center');
          text(node.label,node.x+57,node.y+15,13,legal||count?C.ink:C.muted,'600');
          var step=count?rows[orders[0]-1]:null,before=step?(orders[0]>1?rows[orders[0]-2].balance:plan.balanceBefore):0;
          if(step){
            text($t('已选 ')+step.duration.toFixed(2)+'s',node.x+57,node.y+35,11,C.muted);
            text($t('稳定 ')+(step.balance-before>=0?'+':'')+(step.balance-before).toFixed(1),node.x+node.w-10,node.y+35,11,step.balance-before<0?C.danger:C.teal,'400','right');
          }else if(candidate.duration!==null&&candidate.duration!==undefined){
            text('+'+candidate.duration.toFixed(2)+'s',node.x+57,node.y+35,11,color,'500');
            text($t('稳定 ')+(candidate.balanceDelta>=0?'+':'')+candidate.balanceDelta.toFixed(1),node.x+node.w-10,node.y+35,11,candidate.balanceDelta<0?C.danger:C.teal,'400','right');
          }else wrap(candidate.reason||$t('当前无法衔接'),node.x+57,node.y+35,node.w-67,10,C.dim,1);
          var fullDistance=step&&Number.isFinite(step.distance)?step.distance:candidate.distance,fullProgress=step&&Number.isFinite(step.progress)?step.progress:candidate.progress;
          if(Number.isFinite(fullDistance))text($t('位移 ')+fullDistance.toFixed(2)+$t('m · 净接近 ')+(Number.isFinite(fullProgress)?(fullProgress>=0?'+':'')+fullProgress.toFixed(2)+'m':$t('待计算')),node.x+57,node.y+55,10,fullProgress<0?C.danger:C.muted);
        }else{
          text(node.label,node.x+node.w/2+2,node.y+16,13,legal||count?C.ink:C.muted,'600','center');
          if(candidate.duration!==null&&candidate.duration!==undefined){
            text('+'+candidate.duration.toFixed(2)+'s',node.x+node.w/2+2,node.y+37,11,color,'500','center');
            text($t('稳定 ')+(candidate.balanceDelta>=0?'+':'')+candidate.balanceDelta.toFixed(1),node.x+node.w/2+2,node.y+56,10,candidate.balanceDelta<0?C.danger:C.teal,'400','center');
          }else wrap(candidate.reason||$t('当前无法衔接'),node.x+14,node.y+36,node.w-22,10,C.dim,2,15);
          var lastSelected=count?rows[orders[count-1]-1]:null;
          var moveDistance=Number.isFinite(candidate.distance)?candidate.distance:lastSelected&&lastSelected.distance;
          var netProgress=Number.isFinite(candidate.progress)?candidate.progress:lastSelected&&lastSelected.progress;
          if(Number.isFinite(moveDistance)){
            text((legal?$t('位移 '):$t('上次位移'))+moveDistance.toFixed(2)+'m',node.x+node.w/2+2,node.y+76,10,C.muted,'400','center');
            text(Number.isFinite(netProgress)?$t('接近 ')+(netProgress>=0?'+':'')+netProgress.toFixed(2)+'m':$t('净接近待计算'),node.x+node.w/2+2,node.y+95,10,netProgress<0?C.danger:C.teal,'400','center');
          }
          var cols=Math.max(1,Math.min(3,Math.floor((node.w-16)/32))),cellW=(node.w-16)/cols;
          orders.forEach(function(order,i){
            var bx=node.x+8+cellW*(i%cols+.5),by=node.y+middleBase(node.id)+13+Math.floor(i/cols)*47,step=rows[order-1];
            badge(order,bx,by,14,color);
            text(step?step.duration.toFixed(2)+'s':$t('未执行'),bx,by+24,10,C.muted,'400','center');
          });
          if(!count&&legal)text($t('可选'),node.x+node.w-5,node.y+node.h-5,8,color,'500','right');
        }
        regions.push({x:node.x,y:node.y,w:node.w,h:node.h,label:node.label,action:function(point){if(appendFootAction(node.id,true)){dragging={kind:'footwork',lastNode:node.id,lastPoint:point};lastTick=Date.now();}}});
      });
      var toolsY=readyY+84,toolW=(contentW-16)/3;
      button($t('撤销一步'),pad,toolsY,toolW,36,function(){footActions.pop();error='';refreshFootwork();},{size:11,disabled:!footActions.length});
      button($t('清空路径'),pad+toolW+8,toolsY,toolW,36,function(){footActions=[];routeChainOpen=false;error='';refreshFootwork();},{size:11,disabled:!footActions.length});
      button($t('逐步明细'),pad+2*(toolW+8),toolsY,toolW,36,function(){detailsOpen=true;detailPage=0;},{size:11});
      var sequenceY=toolsY+60,rowY=sequenceY+28;
      if(!routeChainOpen){
        button($t('展开路径 · ')+footActions.length+$t('步'),pad,sequenceY-14,contentW,34,function(){routeChainOpen=true;},{size:12});
      }else{
        text($t('路径 · ')+footActions.length+$t('步'),pad,sequenceY,13,C.ink,'600');
        button($t('收起路径'),width-pad-104,sequenceY-15,104,30,function(){routeChainOpen=false;},{size:11});
        if(!rows.length){text($t('点击动作块后，序号会直接留在块内。'),pad,rowY+6,11,C.muted);rowY+=35;}
        rows.forEach(function(step,i){
          var style=FeedbackModel.ACTION_STYLES[step.id]||{color:C.muted};
          var before=i?rows[i-1].balance:plan.balanceBefore,delta=step.balance-before;
          box(pad,rowY,contentW,70,C.panel,style.color,12);
          ctx.beginPath();ctx.arc(pad+28,rowY+35,20,0,Math.PI*2);ctx.fillStyle=style.color;ctx.fill();text(i+1,pad+28,rowY+35,25,C.bg,'700','center');
          text($t('步骤 ')+(i+1)+' · '+step.label,pad+60,rowY+17,13,C.ink,'600');
          text($t('用时 ')+step.duration.toFixed(2)+$t('s · 累计 ')+step.cumulativeTime.toFixed(2)+'s',pad+60,rowY+38,11,C.muted);
          text($t('稳定 ')+(delta>=0?'+':'')+delta.toFixed(1)+$t(' · 体力−')+step.staminaCost.toFixed(1),pad+60,rowY+56,11,delta<0?C.danger:C.teal);
          if(i<rows.length-1){var ax=width/2,at=rowY+75,ab=rowY+94;line(ax,at,ax,ab-7,'#b7ead9',4);ctx.beginPath();ctx.moveTo(ax,ab);ctx.lineTo(ax-7,ab-10);ctx.lineTo(ax+7,ab-10);ctx.closePath();ctx.fillStyle='#b7ead9';ctx.fill();}
          rowY+=100;
        });
      }
      var noAutoPlan=windows.length&&windows.every(function(window){return !window.available;});
      var trialSummary=shotPreview?$t('伸拍 ')+plan.reachDistance.toFixed(2)+$t('m · 匹配 ')+(shotPreview.stateFit*100).toFixed(1)+$t('% · 击球预计耗力 ')+shotPreview.staminaCost.toFixed(1):$t('可击球 · 可进入后续回球试算');
      var stateText=error||(noAutoPlan&&!footActions.length?$t('自动搜索未找到，可手动尝试；明细可放弃。'):plan.canHit?trialSummary:plan.reason||$t('继续连线，最后接“挥拍”。'));
      wrap(stateText,pad,rowY+8,contentW,11,error||!plan.valid?C.danger:plan.canHit?C.teal:C.muted,2,17);
      var buttonY=rowY+43;
      button(plan.canHit?$t('后续回球试算'):$t('完成可接路径后试算'),pad,buttonY,contentW,39,function(){trialOpen=true;lastTick=Date.now();},{size:12,disabled:!plan.canHit});
      button($t('执行路径 · 进入击球'),pad,buttonY+48,contentW,43,function(){
        if(contactDirty)refreshFootwork();
        var capture={plan:footPreview,trajectory:incoming,players:JSON.parse(JSON.stringify(view.players))};
        act(function(){return match.commitFootwork(footPlan());});
        if(view.phase==='shot'){capture.plan=view.lastFootwork||capture.plan;lastReplay=capture;beginReplay(capture.plan,capture.trajectory,$t('步伐回放'),capture.players);}
      },{primary:true,disabled:!plan.canHit,size:13});
      text($t('彩色=对应动作 · 灰蓝=余量 · 红色=超时'),pad,buttonY+110,10,C.muted);
      return buttonY+126;
    }
    function drawFootworkDetails(pad) {
      if (!footPreview) return 160;
      var plan=footPreview,rows=plan.actionResults||[],trajectory=view.incoming.trajectory,vz=Number(plan.contact.verticalSpeed||0);
      text($t('逐步明细'),pad,113,21,C.ink,'600');
      text($t('路径 ')+plan.totalTime.toFixed(2)+$t('s · 触球 ')+plan.contactTime.toFixed(2)+$t('s · 余量 ')+plan.remainingTime.toFixed(2)+'s',pad,147,11,plan.remainingTime<0?C.danger:C.teal);
      text($t('选点高 ')+plan.contact.height.toFixed(2)+$t('m · 球速 ')+plan.contact.speed.toFixed(1)+'m/s · '+flightTrend(vz),pad,169,11,C.muted);
      text($t('垂直 ')+(vz>0?'+':'')+vz.toFixed(2)+$t('m/s · 出球初速 ')+trajectory.initialSpeed.toFixed(1)+'m/s',pad,190,11,C.muted);
      text($t('弧顶 ')+trajectory.apex.toFixed(2)+$t('m · 过网余高 ')+(trajectory.netClearance===null?'—':trajectory.netClearance.toFixed(2)+'m'),pad,211,11,C.muted);
      text((trajectory.terminal==='net'?$t('末端触网'):$t('末端落地'))+' '+trajectory.duration.toFixed(2)+$t('s · 选点 ')+footContactTime.toFixed(2)+'s',pad,232,11,C.muted);
      text($t('仍需接近 ')+plan.distanceRemaining.toFixed(2)+$t('m · 伸拍 ')+plan.reachDistance.toFixed(2)+$t('m · 准备 ')+plan.preparationTime.toFixed(2)+'s',pad,253,10,C.muted);
      var denied=plan.opponentRecoveryDenied;
      wrap(typeof denied!=='number'?$t('此点不可接，暂不比较对手回位时间。'):denied>=0?$t('比最晚合法截击少给对手回位 ')+denied.toFixed(2)+'s':$t('已晚于最晚合法截击 ')+(-denied).toFixed(2)+$t('s，当前不可接'),pad,276,width-pad*2,10,typeof denied==='number'&&denied>=0?C.gold:C.danger,2,15);
      var comparison=FeedbackModel.buildAnticipationComparison(plan,view.incoming.duration);
      text(comparison.available?comparison.label:$t('预判中性对照暂不可比'),pad,310,12,comparison.available?comparison.color:C.muted,'600');
      var y=334;
      if(comparison.available){
        text($t('当前 ')+comparison.actualTime.toFixed(2)+$t('s / 中性 ')+comparison.neutralTime.toFixed(2)+'s',pad,y,11,C.muted);y+=23;
        wrap(comparison.comparisonStage==='prefix'?$t('仅比较已选动作段，后续组合仍会改变完整路径差异。'):$t('同一触球时刻、相同动作顺序，只替换为中性启动状态。'),pad,y,width-pad*2,11,C.muted,2,17);y+=42;
        text($t('该差异已包含在路径用时中，不再次加减。'),pad,y,11,C.gold);y+=30;
      }else {
        var reasonLines=wrap(comparison.reason,pad,y,width-pad*2,11,C.muted,3,17);y+=reasonLines*17+25;
      }
      if(!rows.length){text($t('路径为空，从启动节点开始逐个连接。'),pad,y,12,C.muted);y+=40;}
      rows.forEach(function(step,i){
        var style=FeedbackModel.ACTION_STYLES[step.id]||{color:C.muted};
        text((i+1)+'. '+step.label+' · '+step.directionLabel,pad,y,12,style.color,'500');
        text(step.duration.toFixed(2)+$t('s / 累计')+step.cumulativeTime.toFixed(2)+$t('s  体力−')+step.staminaCost.toFixed(1)+'→'+step.stamina.toFixed(1),pad,y+18,10,C.muted);
        text($t('执行后稳定度 ')+step.balance.toFixed(1),pad,y+34,10,C.muted);
        text($t('本步位移 ')+step.distance.toFixed(2)+$t('m · 净接近 ')+(Number.isFinite(step.progress)?(step.progress>=0?'+':'')+step.progress.toFixed(2)+'m':$t('待计算')),pad,y+50,10,step.progress<0?C.danger:C.muted);y+=74;
      });
      var half=(width-pad*2-8)/2;
      button($t('播放路径预演'),pad,y,half,40,function(){beginReplay(plan,view.incoming.trajectory,$t('路径预演'));},{size:12,disabled:!footActions.length});
      button($t('返回连线路径'),pad+half+8,y,half,40,function(){detailsOpen=false;lastTick=Date.now();},{primary:true,size:12});y+=53;
      var windows=view.footwork&&view.footwork.contactWindows||[];
      if(windows.length&&windows.every(function(window){return !window.available;})) {button($t('放弃此球'),pad,y,width-pad*2,36,function(){act(function(){return match.concedePoint();});},{size:12});y+=46;}
      wrap($t('每步费用来自实际动作顺序；顶栏始终为尚未或已经执行的真实当前状态。'),pad,y+10,width-pad*2,10,C.dim,2,16);
      return y+40;
    }
    function drawReplay(pad) {
      if(!replay)return 160;
      var time=currentReplayTime(),plan=replay.plan;
      text(replay.mode,pad,113,21,C.ink,'600');
      text($t('仅播放已经算好的轨迹 · 顶栏保持实际状态'),pad,139,11,C.muted);
      text(time.toFixed(2)+' / '+replay.duration.toFixed(2)+'s',width-pad,113,12,C.teal,'600','right');
      button($t('跳过回放'),pad,155,width-pad*2,38,function(){endReplay();},{primary:true,size:12});
      var courtH=Math.max(180,Math.min(300,height-420)),courtY=208;
      drawMovementCourt(pad,courtY,width-pad*2,courtH,plan,replay.trajectory,time,replay.players);
      drawSideProfile(pad,courtY+courtH+10,width-pad*2,62,{valid:true,trajectory:replay.trajectory,hitter:'ai'},time);
      var sy=courtY+courtH+91,body=sampleAt(plan.bodyPath,time)||plan.finalState,ball=sampleAt(replay.trajectory.samples,time);
      text($t('触球倒计时 ')+Math.max(0,plan.contactTime-time).toFixed(2)+'s',pad,sy,13,C.teal,'600');
      text($t('回放稳定度 ')+Number(body.balance).toFixed(1)+$t(' · 体力 ')+Number(body.stamina).toFixed(1),pad,sy+25,12,C.muted);
      text($t('球高 ')+Number(ball&&ball.z||0).toFixed(2)+$t('m · 球速 ')+Number(ball&&ball.speed||0).toFixed(1)+'m/s',pad,sy+49,12,C.gold);
      if(view.energyReceipt&&replay.mode!==$t('路径预演'))wrap(receiptText(view.energyReceipt),pad,sy+73,width-pad*2,10,C.muted,2);
      return sy+102;
    }
    function updateSlider(point, finalUpdate) {
      if (!dragging || !controls) return;
      var f = Math.max(0, Math.min(1, (point.x - dragging.x) / dragging.w));
      if(dragging.kind==='serveHeight')serveHeight=dragging.min+f*(dragging.max-dragging.min);
      else controls[dragging.kind] = dragging.kind==='power'?Math.min(currentPowerLimit(),dragging.min+f*(dragging.max-dragging.min)):dragging.min + f * (dragging.max - dragging.min);
      if(dragging.kind==='angle')manualShotAngle=true;
      error = ''; aimNote = $t('实心落点与浅蓝误差范围随角度、力度和身体状态更新。');
      previewDirty = true;
      if (finalUpdate || Date.now() - lastPreviewAt >= 33) refreshPreview();
    }
    function updateFootDrag(point) {
      if (!dragging || dragging.kind !== 'footwork') return;
      var from = dragging.lastPoint || point, dx = point.x - from.x, dy = point.y - from.y;
      var parts = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dy * dy) / 6));
      for (var i = 1; i <= parts; i++) {
        var x = from.x + dx * i / parts, y = from.y + dy * i / parts;
        var node = footNodes.filter(function (n) { return x >= n.x && x <= n.x + n.w && y >= n.y && y <= n.y + n.h; })[0];
        var id = node ? node.id : null;
        if (id && id !== dragging.lastNode) appendFootAction(id);
        dragging.lastNode = id;
      }
      dragging.lastPoint = point;
    }
    function drawSlider(kind, label, y, pad, min, max) {
      var value=controls?controls[kind]:min,axis=shotScan&&shotScan[kind];
      text(label,pad,y,12,C.ink,'500');
      text(kind==='angle'?(value>0?'+':'')+value.toFixed(1)+'°':Math.round(value*100)+'%',width-pad,y,13,C.teal,'600','right');
      var x=pad+8,w=width-pad*2-16,trackY=y+19;
      box(x,trackY-5,w,10,'#2a3f50',null,4);
      if(axis){
        ctx.save();rounded(x,trackY-5,w,10,4);ctx.clip();
        (axis.segments||[]).forEach(function(part){var start=Math.max(0,Math.min(1,(part.from-min)/(max-min))),end=Math.max(0,Math.min(1,(part.to-min)/(max-min)));ctx.fillStyle=(SHOT_BANDS[part.category]||SHOT_BANDS.heavy).color;ctx.fillRect(x+start*w,trackY-5,Math.max(0,(end-start)*w),10);});
        ctx.restore();
        (axis.physicalSegments||[]).forEach(function(part){var start=Math.max(0,Math.min(1,(part.from-min)/(max-min))),end=Math.max(0,Math.min(1,(part.to-min)/(max-min)));ctx.fillStyle=part.outcome==='in'?'#365967':C.danger;ctx.fillRect(x+start*w,trackY+9,Math.max(0,(end-start)*w),3);});
      }
      var fillW=w*Math.max(0,Math.min(1,(value-min)/(max-min))),currentBand=shotScan&&SHOT_BANDS[shotScan.current.category];
      ctx.beginPath();ctx.arc(x+fillW,trackY,8,0,Math.PI*2);ctx.fillStyle=C.ink;ctx.fill();
      ctx.beginPath();ctx.arc(x+fillW,trackY,4,0,Math.PI*2);ctx.fillStyle=currentBand?currentBand.color:C.teal;ctx.fill();
      var fixed=controls?(kind==='angle'?$t('固定力度 ')+Math.round(controls.power*100)+'%':$t('固定角度 ')+controls.angle.toFixed(1)+'°'):$t('等待参数');
      text(kind==='angle'?min+'°':Math.round(min*100)+'%',pad,y+43,10,C.dim);
      text($t('同目标 · ')+fixed,width/2,y+43,10,C.muted,'400','center');
      text(kind==='angle'?max+'°':Math.round(max*100)+'%',width-pad,y+43,10,C.dim,'400','right');
      if(controls)regions.push({x:pad,y:y-7,w:width-pad*2,h:42,label:label+$t('滑杆'),action:function(point){dragging={kind:kind,x:x,w:w,min:min,max:max};lastTick=Date.now();updateSlider(point,true);}});
    }
    function drawSideProfile(x, y, w, h, preview, playbackTime) {
      box(x, y, w, h, C.panel, C.line, 9);
      preview = preview || shotPreview;
      if (!preview || !preview.trajectory) return;
      var trajectory = preview.trajectory, samples = trajectory.samples || [];
      if (!samples.length) return;
      // Match the court's fixed camera: the player stays on the left.
      // Flight samples are hitter-relative, so an incoming shot is mirrored.
      var flightDirection = preview.hitter === 'ai' ? -1 : 1;
      var minY = -1, maxY = 1, maxZ = 2.5, netHeight = 1.52;
      var heightGuide = preview.contactHeightGuide && view.footwork && view.footwork.contactHeightLimits;
      var jumpSelected = heightGuide && footActions.indexOf('jump') !== -1;
      var live = playbackTime === undefined ? null : ShotModel && ShotModel.sampleTrajectory ? ShotModel.sampleTrajectory(trajectory, playbackTime) : sampleAt(samples, playbackTime);
      // Keep one scale while toggling stance; only the selected envelope is painted.
      if (heightGuide) maxZ = Math.max(maxZ, heightGuide.jumpMax);
      samples.forEach(function (p, i) {
        var screenY = flightDirection * p.y;
        minY = Math.min(minY, screenY); maxY = Math.max(maxY, screenY); maxZ = Math.max(maxZ, p.z);
        if (i && samples[i - 1].y < 0 && p.y >= 0 && trajectory.netClearance !== null) {
          var before = samples[i - 1], f = -before.y / (p.y - before.y);
          netHeight = before.z + f * (p.z - before.z) - trajectory.netClearance;
        }
      });
      // Compact mobile scenes reserve a real chart slot before sizing the
      // court. Keep its caption above the plot, never over the flight curve.
      var captionH = preview.caption ? 16 : 0;
      if (preview.caption) {
        text(preview.caption,x+8,y+10,10,C.teal,'600');
        text($t('初速 ')+Number(trajectory.initialSpeed||0).toFixed(1)+$t('m/s · 弧顶 ')+Number(trajectory.apex||0).toFixed(2)+'m',x+w-8,y+10,9,C.muted,'400','right');
      }
      var plotX = x + 8, plotY = y + 8 + captionH, plotW = w - 16, plotH = h - 23 - captionH;
      function px(p) { return plotX + (flightDirection * p.y - minY) / (maxY - minY) * plotW; }
      function pz(p) { return plotY + plotH - p.z / (maxZ * 1.08) * plotH; }
      var netX = px({ y: 0 });
      if (heightGuide) {
        // The receiver's shaded reach envelope describes player height only;
        // the shuttle keeps its actual simulated height throughout the preview.
        // Use the model's receiving-court limits, not the edge of the plot:
        // a long outgoing trajectory may extend that edge beyond the baseline.
        var receiveNear = px({ y: 0.025 }), receiveFar = px({ y: 1 });
        var receiveX = Math.min(receiveNear, receiveFar), receiveRight = Math.max(receiveNear, receiveFar);
        var receiveW = receiveRight - receiveX;
        var allowedLow = jumpSelected ? heightGuide.jumpMin : heightGuide.groundMin;
        ctx.fillStyle = '#21473D'; ctx.fillRect(receiveX,pz({z:heightGuide.groundMax}),receiveW,pz({z:allowedLow})-pz({z:heightGuide.groundMax}));
        if(jumpSelected){ctx.fillStyle = '#365C4E'; ctx.fillRect(receiveX,pz({z:heightGuide.jumpMax}),receiveW,pz({z:heightGuide.groundMax})-pz({z:heightGuide.jumpMax}));}
        ctx.save(); ctx.setLineDash([]);
        line(receiveX,pz({z:heightGuide.groundMax}),receiveRight,pz({z:heightGuide.groundMax}),'#68B999',1);
        if(jumpSelected)line(receiveX,pz({z:heightGuide.jumpMax}),receiveRight,pz({z:heightGuide.jumpMax}),'#A9E7C8',1);
        line(receiveX,pz({z:allowedLow}),receiveRight,pz({z:allowedLow}),'#68B999',.8);
        ctx.restore();
      }
      line(plotX, plotY + plotH, plotX + plotW, plotY + plotH, '#526678');
      line(netX, plotY + plotH, netX, pz({ z: netHeight }), C.gold, 2);
      ctx.beginPath(); samples.forEach(function (p, i) { if (!i) ctx.moveTo(px(p), pz(p)); else ctx.lineTo(px(p), pz(p)); });
      ctx.strokeStyle = preview.color || (preview.valid ? C.teal : C.danger); ctx.lineWidth = 2; ctx.stroke();
      if(preview.settled)drawFlightDirection(samples.map(function(p){return{x:px(p),y:pz(p)};}),preview.color||C.teal,{x:plotX,y:plotY,w:plotW,h:plotH},false);
      if (playbackTime !== undefined) {
        if (live) {
          if(heightGuide){ctx.save();ctx.setLineDash([2,3]);line(receiveX,pz(live),receiveRight,pz(live),C.gold,1);ctx.restore();}
          ctx.beginPath(); ctx.arc(px(live), pz(live), 4, 0, Math.PI * 2); ctx.fillStyle = C.gold; ctx.fill();
        }
      }
      text($t('你'), plotX, y + h - 7, 9, C.dim);
      text($t('网'), netX, y + h - 7, 9, C.gold, '400', 'center');
      text($t('对手'), plotX + plotW, y + h - 7, 9, C.dim, '400', 'right');
      return { x: x, y: y, w: w, h: h, points: samples.map(function (sample) { return { x: px(sample), y: pz(sample), t: sample.t }; }) };
    }
    function drawContactHeightSlider(sx,sy,sw,duration,pad,legendY) {
      var fw=view.footwork||{},limits=fw.contactHeightLimits||{groundMin:.28,groundMax:2.95,jumpMin:.73,jumpMax:3.40,jumpBoost:.45};
      var jumpSelected=footActions.indexOf('jump')!==-1;
      var ground=fw.groundContactIntervals||[],jump=jumpSelected?fw.jumpContactIntervals||[]:[],extra=[],base=ground;
      if(jumpSelected){base=[];ground.forEach(function(g){jump.forEach(function(j){var start=Math.max(g.start,j.start),end=Math.min(g.end,j.end);if(end>start)base.push({start:start,end:end});});});}
      // Subtract overlapping ground intervals so light green denotes only the
      // extra height window, never a fabricated amount of additional time.
      jump.forEach(function(interval){
        var parts=[{start:interval.start,end:interval.end}];
        ground.forEach(function(g){var next=[];parts.forEach(function(p){if(g.end<=p.start||g.start>=p.end)next.push(p);else{if(g.start>p.start)next.push({start:p.start,end:g.start});if(g.end<p.end)next.push({start:g.end,end:p.end});}});parts=next;});
        extra=extra.concat(parts);
      });
      var thick=desktopLayout?14:10;
      box(sx,sy-thick/2,sw,thick,'#334253',null,3);
      function spans(intervals,color,label){intervals.forEach(function(i){var px=sx+i.start/duration*sw,pw=(i.end-i.start)/duration*sw;if(pw<=0)return;ctx.fillStyle=color;ctx.fillRect(px,sy-thick/2,pw,thick);if(pw>72)text(label,px+pw/2,sy,9,'#102D25','600','center',true);});}
      spans(base,'#68B999',$t('身高允许'));spans(extra,'#A9E7C8',$t('跳跃补偿'));
      var min=jumpSelected?limits.jumpMin:limits.groundMin,max=jumpSelected?limits.jumpMax:limits.groundMax;
      var ball=incomingSample(footContactTime),heightLabel=$t('触球高 ')+Number(ball&&ball.z||0).toFixed(2)+'m',legendFont=desktopLayout?11:9;
      text(heightLabel,pad,legendY,legendFont,C.gold,'600');
      ctx.font='600 '+fontSize(legendFont)+'px '+FONT;var rangeX=pad+ctx.measureText(heightLabel).width+12;
      box(rangeX,legendY-4,8,8,'#68B999',null,2);
      text($t('身高允许范围 ')+min.toFixed(2)+'–'+max.toFixed(2)+'m',rangeX+13,legendY,legendFont,'#89CDB0');
      if(jumpSelected){var jumpLabel=$t('跳跃 +')+limits.jumpBoost.toFixed(2)+'m',font=desktopLayout?11:9;
        ctx.font='400 '+fontSize(font)+'px '+FONT;var labelW=ctx.measureText(jumpLabel).width;
        box(leftWidth-pad-labelW-14,legendY-4,8,8,'#A9E7C8',null,2);text(jumpLabel,leftWidth-pad,legendY,font,'#A9E7C8','400','right');}
      text($t('截击 ')+footContactTime.toFixed(2)+'s',pad,sy,desktopLayout?13:11,C.teal,'600');
      var heightOK=ball&&ball.z>=min-1e-8&&ball.z<=max+1e-8;
      ctx.beginPath();ctx.arc(sx+footContactTime/duration*sw,sy,desktopLayout?8:6,0,Math.PI*2);ctx.fillStyle=footPreview.valid&&heightOK?C.teal:C.danger;ctx.fill();ctx.strokeStyle=C.ink;ctx.lineWidth=1;ctx.stroke();
      regions.push({x:sx-5,y:sy-13,w:sw+10,h:26,label:$t('连续截击时间滑条'),action:function(point){dragging={kind:'contactSlider',x:sx,w:sw,duration:duration};lastTick=Date.now();updateContactDrag(point,true);}});
    }
    function drawShot(y, pad, trial) {
      box(pad,y-8,26,23,'#173930',null,6);text(trial?$t('试'):view.phase==='serve'?$t('发'):$t('击'),pad+13,y+4,11,C.teal,'600','center');
      text(trial?$t('后续击球试算'):view.phase==='serve'?$t('连续发球'):$t('连续击球'),pad+35,y+4,15,C.ink,'600');
      var sc=view.shotContext||view.service||{},current=shotScan&&shotScan.current;
      if(view.phase!=='serve')text($t('余量 ')+Number(sc.remainingTime||0).toFixed(2)+'s',width-pad,y+4,11,C.teal,'500','right');
      var physicalWarning=shotPreview&&!shotPreview.valid&&shotPreview.trajectory&&shotPreview.trajectory.warning;
      var warning=error||physicalWarning||(shotPreview&&shotPreview.warning)||$t('对方半场选落点，本方半场选回动。');
      wrap(warning,pad,y+28,width-pad*2,11,error||(shotPreview&&!shotPreview.valid)?C.danger:C.muted,2,15);
      var height=current?current.contactHeight:Number(sc.contactHeight||0),stamina=current?current.stamina:view.players.human.stamina,balance=current?current.balance:view.players.human.balance;
      text((trial?$t('预计'):$t('当前'))+$t('高 ')+height.toFixed(2)+$t('m · 体力 ')+stamina.toFixed(1)+$t(' · 稳定 ')+balance.toFixed(1),pad,y+58,11,C.ink,'500');
      drawSlider('angle',$t('发射角度'),y+90,pad,sc.angleMin===undefined?-30:sc.angleMin,sc.angleMax===undefined?75:sc.angleMax);
      drawSlider('power',$t('发力程度'),y+153,pad,sc.powerMin===undefined?.05:sc.powerMin,sc.powerMax===undefined?1:sc.powerMax);
      ['comfortable','strained','heavy'].forEach(function(id,i){var style=SHOT_BANDS[id],x=pad+i*(width-pad*2)/3;box(x,y+216,10,10,style.color,null,3);text(style.label,x+16,y+221,11,C.muted);});
      ctx.fillStyle=C.danger;ctx.fillRect(pad,y+240,15,3);text($t('细红带：预计触网、未过网或出界'),pad+21,y+242,10,C.muted);
      text($t('主色=身体适配约段；不保证入场，可自由选。'),pad,y+263,10,C.dim);
      var category=current&&SHOT_BANDS[current.category],outcome=view.phase==='serve'&&shotPreview&&shotPreview.service&&!shotPreview.service.legal?$t('发球违例'):current&&SHOT_OUTCOMES[current.physicalOutcome];
      text($t('当前组合 · ')+(category?category.label:$t('计算中'))+' / '+(outcome||$t('等待预测')),pad,y+291,12,category?category.color:C.muted,'600');
      text($t('混合熟练 ')+(shotPreview?Math.round(shotPreview.proficiency):'—')+$t(' · 匹配 ')+(shotPreview?(shotPreview.stateFit*100).toFixed(1)+'%':'—'),pad,y+314,11,C.muted);
      text($t('预计耗力 ')+(shotPreview?shotPreview.staminaCost.toFixed(1):'—'),width-pad,y+314,11,current&&current.costExceedsStamina?C.danger:C.gold,'500','right');
      if(current&&current.costExceedsStamina)text($t('当前预计耗力高于现有体力。'),pad,y+335,11,C.danger);
      var factors=shotScan&&shotScan.factors,items=factors&&factors.items||[];
      var sectionEnd=y+383;
      button(shotFactorsOpen?$t('收起状态影响'):$t('查看状态影响'),pad,y+349,width-pad*2,34,function(){shotFactorsOpen=!shotFactorsOpen;},{size:12,selected:shotFactorsOpen});
      if(shotFactorsOpen){
        var panelY=sectionEnd+12,panelH=items.length?items.length*57+86:78;
        box(pad,panelY,width-pad*2,panelH,C.panel,C.line,11);
        text($t('这些状态怎样影响当前组合'),pad+12,panelY+19,12,C.ink,'600');
        if(items.length)items.forEach(function(item,i){
          var rowY=panelY+45+i*57,unit=item.unit==='m'?'m':'',value=Number(item.actualValue),reference=Number(item.referenceValue),delta=Number(item.fitDelta)*100;
          var label=item.id==='height'?$t('触球高度'):item.id==='stamina'?$t('体力'):$t('稳定度');
          text(label+' '+value.toFixed(item.unit==='m'?2:1)+unit,pad+12,rowY,12,C.ink,'500');
          text($t('只改为 ')+reference.toFixed(item.unit==='m'?1:0)+unit+$t('：匹配 ')+(delta>=0?'+':'')+delta.toFixed(1)+$t(' 个百分点'),pad+12,rowY+20,11,C.muted);
        });else text($t('状态参考区间计算中。'),pad+12,panelY+46,11,C.muted);
        if(items.length){
          text($t('逐项参考，其余不变；这些影响不能相加。'),pad+12,panelY+panelH-43,10,C.dim);
          wrap($t('熟练度影响执行散布和耗力，身体分色不代表全部能力。'),pad+12,panelY+panelH-23,width-pad*2-24,10,C.muted,2,14);
        }
        sectionEnd=panelY+panelH;
      }
      var chartY=sectionEnd+17,chartW=Math.max(155,(width-pad*2)*.60);
      drawSideProfile(pad,chartY,chartW,66);
      var trajectory=shotPreview&&shotPreview.trajectory;
      text($t('初速 ')+(trajectory?trajectory.initialSpeed.toFixed(1):'—')+'m/s',pad+chartW+10,chartY+12,10,C.muted);
      text($t('弧顶 ')+(trajectory?trajectory.apex.toFixed(2):'—')+'m',pad+chartW+10,chartY+33,10,C.muted);
      text(trajectory&&trajectory.terminal==='net'?$t('终点：触网'):$t('终点：落地'),pad+chartW+10,chartY+54,10,trajectory&&trajectory.terminal==='net'?C.danger:C.muted);
      var dispersion=shotPreview&&shotPreview.dispersion,constants=ShotModel.constants;
      text(dispersion?$t('散布约 横')+(dispersion.x*constants.xScale).toFixed(2)+$t('m / 深')+(dispersion.y*constants.yScale).toFixed(2)+'m':$t('散布待计算'),pad,chartY+83,11,C.muted);
      text($t('散布受熟练与状态共同影响，非保证圈。'),pad,chartY+103,10,C.dim);
      var recoveryY=chartY+129,rw=(width-pad*2-8)/2,selectedTarget=selectedRecoveryTarget();
      text($t('击球后回动 · ')+recoveryDirection({from:recoveryOrigin(),target:selectedTarget}),pad,recoveryY,12,C.recovery,'600');
      var recoveryFrom=recoveryOrigin(),recoveryDistance=Math.hypot((selectedTarget.x-recoveryFrom.x)*G.halfWidth,(selectedTarget.y-recoveryFrom.y)*G.halfLength);
      text($t('目标距当前位置 ')+recoveryDistance.toFixed(2)+'m',pad,recoveryY+22,11,C.muted);
      button($t('回中'),pad,recoveryY+40,rw,34,function(){selectRecovery('center');},{selected:recoveryMode==='center',size:12});
      button($t('原地停留'),pad+rw+8,recoveryY+40,rw,34,function(){selectRecovery('stay');},{selected:recoveryMode==='stay',size:12});
      button(view.phase==='serve'?$t('在球场选择回动目标'):$t('在左侧球场选择回动目标'),pad,recoveryY+83,width-pad*2,33,function(){if(view.phase==='serve')serveCourtMode='recovery';},{size:11});
      text($t('目标为意图；实际回动受对方截击时刻限制。'),pad,recoveryY+134,10,C.dim);
      var submitY=recoveryY+153;
      button(trial?$t('保留试算 · 返回步伐'):view.phase==='serve'?(shotPreview&&!shotPreview.valid?$t('确认发球 · 接受当前风险'):$t('确认发球 · 开始对抗')):shotPreview&&!shotPreview.valid?$t('确认击球 · 接受当前风险'):$t('确认击球 · 同时回位'),pad,submitY,width-pad*2,43,function(){
        if(trial){if(previewDirty)refreshPreview();trialOpen=false;lastTick=Date.now();return;}
        act(function(){refreshPreview();var selection=view.phase==='serve'?serveSelection():{target:{x:controls.target.x,y:controls.target.y},angle:controls.angle,power:controls.power};
          if(recoveryMode==='stay')selection.recovery='stay';else selection.recoveryTarget=selectedRecoveryTarget();
          return view.phase==='serve'?match.commitServe(selection):match.shoot(selection);});
      },{primary:true,disabled:!controls||!shotPreview});
      return submitY+43;
    }
    function drawShotTrial(pad) {
      var originalView = view, plan = footPreview;
      if (!plan || !plan.canHit) { trialOpen = false; return; }
      var shadow = Object.assign({}, originalView, { phase: 'shot', energyReceipt: null,
        players: { human: plan.finalState, ai: originalView.players.ai },
        shotContext: { contactHeight: plan.contact.height, origin: plan.contact.point, remainingTime: plan.remainingTime,
          preparationTime: plan.preparationTime, reachDistance: plan.reachDistance, angleMin: -30, angleMax: 75, powerMin: 0.05, powerMax: 1 } });
      view = shadow;
      var courtH = Math.max(146, Math.min(244, height - 414));
      drawCourt(98, courtH);
      var end = drawShot(98 + courtH + 12, pad, true);
      var dispersion = shotPreview && shotPreview.dispersion, constants = ShotModel && ShotModel.constants || { xScale: G.halfWidth, yScale: G.halfLength };
      var dispersionText = dispersion ? $t('散布半径约 横') + (dispersion.x * constants.xScale).toFixed(2) + $t('m / 深') + (dispersion.y * constants.yScale).toFixed(2) + 'm' : $t('完成可接路径后试算');
      text($t('仅试算，尚未执行步伐或击球。'),pad,end+23,12,C.gold);
      text($t('预计接球稳定度 ')+plan.balance.toFixed(1)+$t(' · 体力 ')+plan.staminaAfter.toFixed(1),pad,end+47,11,C.teal);
      wrap(dispersionText,pad,end+70,width-pad*2,11,C.muted,2);
      wrap($t('返回拖动截击时刻，可比较同一参数。执行路径后沿用击球参数与回动目标。'),pad,end+98,width-pad*2,10,C.muted,2,17);
      view=originalView;
      return end+135;
    }
    function drawTraining(pad) {
      var y = 98, h = 440, w = width - pad * 2;
      box(pad, y, w, h, C.panel, C.line, 15);
      text($t('局外训练'), pad + 17, y + 29, 20, C.ink, '600');
      var training = view.training || { skills: [], points: 0 };
      text($t('剩余 ') + training.points + $t(' 点'), width - pad - 17, y + 29, 12, C.teal, '600', 'right');
      wrap($t('同一次击球会混合使用多项能力。训练提升控制，无法改变触球高度或穿过球网。'), pad + 17, y + 62, w - 34, 11, C.muted, 2, 18);
      (training.skills || []).forEach(function (skill, i) {
        var sy = y + 106 + i * 65, bx = pad + 17, bw = w - 34;
        text(skill.label, bx, sy + 7, 13, C.ink, '500');
        text(String(Math.round(skill.value)), bx + bw - 91, sy + 7, 12, C.teal, '600', 'right');
        box(bx, sy + 26, bw - 92, 4, '#2a4050', null, 2);
        box(bx, sy + 26, Math.max(1, (bw - 92) * skill.value / 100), 4, C.teal, null, 2);
        button($t('＋训练'), bx + bw - 76, sy - 1, 76, 33, function () { act(function () { return match.trainSkill(skill.id); }); },
          { size: 11, selected: skill.canUpgrade, disabled: !skill.canUpgrade || !training.canTrain });
      });
      if (error) wrap(error, pad + 17, y + 370, w - 34, 10, C.danger, 1);
      else text($t('训练点来自练习赛结算 · 本地保存'), width / 2, y + 370, 10, C.dim, '400', 'center');
      button($t('完成训练 · 返回球场'), pad + 17, y + 391, w - 34, 35,
        function () { trainingOpen = false; lastTick = Date.now(); error = ''; }, { primary: true, size: 12 });
      return y + h;
    }
    function drawEnd(y, pad, available) {
      var result = view.lastResult || {}, isMatch = view.phase === 'matchEnd',isGame=view.phase==='gameEnd';
      var won = isMatch ? (view.gameWins?view.gameWins.human>view.gameWins.ai:view.score.human > view.score.ai) : result.winner === 'human';
      var unreachable = !isMatch && view.lastReachability && view.lastReachability.status === 'unreachable';
      var h = 145;
      box(pad, y, width - pad * 2, h, C.panel, won ? '#316d5f' : C.line, 12);
      text(unreachable ? $t('无法接到球') : isGame?$t('本局结束'):won ? (isMatch ? $t('比赛获胜') : $t('你拿下了这一分')) : (isMatch ? $t('比赛结束，调整战术再来') : $t('这一分，对手得分')), width / 2, y + 29, 17, won ? C.teal : C.gold, '600', 'center');
      wrap(result.reason || view.message, pad + 16, y + 60, width - pad * 2 - 32, 12, C.muted, 3, 20);
      if (isMatch||isGame) text(view.mode==='training'?$t('训练赛'):($t('局分 ')+(view.gameWins?view.gameWins.human+' : '+view.gameWins.ai:'—')+$t(' · 三局两胜')), width / 2, y + h - 16, 11, C.dim, '400', 'center');
      button(isMatch ? $t('重新开局') : isGame?$t('下一局'):$t('下一分'), pad, y + h + 11, width - pad * 2, 42,
        function () { act(function () { return isMatch ? match.reset() : match.advance(); }); }, { primary: true });
      return y + h + 53;
    }
    function drawNodeReason(pad) {
      if(!reasonDialog)return;
      ctx.fillStyle='rgba(3,10,18,.82)';ctx.fillRect(0,140,width,Math.max(0,height-140));
      var h=Math.min(218,height-158),y=140+Math.max(9,(height-140-h)/2),w=width-pad*2;
      box(pad,y,w,h,C.panel,'#8b6265',14);
      text(reasonDialog.title,pad+16,y+27,17,C.ink,'600');
      wrap(reasonDialog.reason,pad+16,y+65,w-32,13,C.gold,4,19);
      if(h>=210)text($t('路径未改变，可撤销后重新选择。'),pad+16,y+h-65,11,C.muted);
      // A modal consumes the complete canvas, including visible header buttons.
      regions=[{x:0,y:0,w:width,h:height,label:$t('原因提示遮罩'),action:function(){}}];
      button($t('知道了 · 继续选步'),pad+16,y+h-49,w-32,35,function(){reasonDialog=null;dragging=null;lastTick=Date.now();},{primary:true,size:12});
    }
    function updateServePosition(point, finalUpdate) {
      if(!dragging||dragging.kind!=='servePosition'||!view.service)return;
      var service=view.service,server=service.server==='human',region=server?service.serverRegion:service.receiverRegion;
      var candidate={x:Math.max(-1,Math.min(1,(point.y-dragging.centerY)/dragging.halfWidth)),y:Math.max(0,Math.min(1,(dragging.netX-point.x)/dragging.halfLength))};
      var centre={x:(region.xMin+region.xMax)/2,y:(region.yMin+region.yMax)/2};
      var side=server?service.side:service.receiverSide,ownEnd=view.ends&&view.ends.human||'near',margin=CourtRules.MODEL.serviceFootMargin;
      if(!CourtRules.servicePositionLegal(candidate,side,'human',ownEnd,margin)){
        var low=0,high=1;
        for(var i=0;i<26;i++){var f=(low+high)/2,p={x:centre.x+(candidate.x-centre.x)*f,y:centre.y+(candidate.y-centre.y)*f};if(CourtRules.servicePositionLegal(p,side,'human',ownEnd,margin))low=f;else high=f;}
        candidate={x:centre.x+(candidate.x-centre.x)*low,y:centre.y+(candidate.y-centre.y)*low};
      }
      if(server){servePosition=candidate;previewDirty=true;if(finalUpdate||Date.now()-lastPreviewAt>=40)refreshPreview();}
      else receivePosition=candidate;
      error='';
    }
    function drawLandscapeHUD() {
      var pad=10,gap=8,cardW=(leftWidth-pad*2-gap)/2;
      text($lang==='en'?'Tactics Board':$t('羽毛球战术棋盘'),pad,13,12,C.ink,'600');
      text(view.score.human+' : '+view.score.ai,Math.min(155,leftWidth*.40),13,19,C.ink,'700');
      var games=view.gameWins;
      text(games?(leftWidth<440&&$lang==='en'?'':$t('局 '))+games.human+':'+games.ai+' · '+(view.ends&&view.ends.human==='far'?$t('你远端'):$t('你近端')):$t('本地对抗'),leftWidth-88,13,10,C.muted,'400','right');
      var training=view.training||{};
      button($t('训练'),leftWidth-72,2,62,23,function(){trainingOpen=true;dragging=null;},{disabled:!training.canTrain||timingMode==='timed'&&decisionActive(),size:11});
      ['human','ai'].forEach(function(id,i){
        var p=view.players[id],x=pad+i*(cardW+gap),color=id==='human'?C.teal:C.gold;
        box(x,29,cardW,51,C.panel,C.line,7);
        text(id==='human'?$t('你 · 当前'):$t('对手 · 当前'),x+8,39,10,color,'600');
        [[$t('体力'),p.stamina,54],[$t('稳定度'),p.balance,69]].forEach(function(row){
          text(row[0]+' '+Number(row[1]).toFixed(1),x+8,row[2],10,C.ink,'500');
          var bx=x+Math.min(desktopLayout?113:86,cardW*.54),bw=cardW-(bx-x)-9;
          box(bx,row[2]-2,bw,4,'#2a3c4c',null,2);box(bx,row[2]-2,bw*Math.max(0,Math.min(100,row[1]))/100,4,color,null,2);
        });
      });
    }
    function drawLandscapeFeedback() {
      if(!footPreview||!view.incoming)return;
      var f=FeedbackModel.buildFootworkFeedback(footPreview,view.incoming.duration,view.players.human);
      var ghost=!footActions.length&&footStartPreview&&footStartPreview.ok,info=startAnticipationDisplay();
      var t=ghost?FeedbackModel.buildTimeBar(footStartPreview,view.incoming.duration):f.time,m=t.margin;
      if(ghost)t.segments=t.segments.map(function(segment){return segment.actionId==='start'&&segment.kind==='action'?Object.assign({},segment,{color:info.previewColor}):segment;});
      var tight=!desktopLayout&&height<320;
      var x=10,w=leftWidth-20,barY=desktopLayout?122:tight?105:112,barH=desktopLayout?26:tight?16:22,headingY=desktopLayout?96:tight?87:91,metaY=desktopLayout?113:tight?98:104;
      text($t('完整飞行 ')+t.axisMax.toFixed(2)+'s',x,headingY,11,C.gold,'700');
      text($t('触球截止 ')+t.contactDeadline.toFixed(2)+'s',leftWidth-10,headingY,12,C.ink,'700','right');
      segmentBar(t,x,barY,w,barH);line(x+t.deadlineRatio*w,barY-3,x+t.deadlineRatio*w,barY+barH+3,C.ink,1.7);
      if(info.available&&info.penaltySeconds>1e-10&&t.axisMax>0){
        var ps=x+Math.max(0,Math.min(1,info.baselineDuration/t.axisMax))*w,pe=x+Math.max(0,Math.min(1,info.actualDuration/t.axisMax))*w;
        // This accent identifies the excess inside the start span, never an extra charge.
        if(pe>ps){ctx.fillStyle=info.color;ctx.fillRect(ps,barY+barH-3,pe-ps,3);line(ps,barY,ps,barY+barH,C.ink,1);}
      }
      var pathLabel=ghost?$t('启动预占 ')+t.totalTime.toFixed(2)+$t('s · 待选'):$t('路径 ')+t.totalTime.toFixed(2)+'s';
      if(m&&m.available){
        ctx.font='700 '+fontSize(10)+'px '+FONT;var lw=ctx.measureText(m.label).width,anchor=x+m.anchorRatio*w,inside=m.kind!=='zero'&&!m.clipped&&m.widthRatio*w>lw+10;
        if(inside){text(m.label,anchor,barY+barH/2,10,C.ink,'700','center');text(pathLabel,x,metaY,10,C.muted);}
        else{var lx=Math.max(x+lw/2,Math.min(x+w-lw/2,anchor)),color=m.kind==='overtime'?C.danger:m.kind==='remaining'?C.teal:C.ink;
          text(m.label,lx,metaY-1,10,color,'700','center');line(lx,metaY+5,anchor,barY-1,color,1.5);
          text(pathLabel,anchor<leftWidth/2?leftWidth-10:x,metaY,10,C.muted,'400',anchor<leftWidth/2?'right':'left');}
      }
      var comparisonLabelY=barY+barH+(desktopLayout?11:8);
      text(info.label||$t('启动时间暂不可比，原因见明细'),x,comparisonLabelY,10,info.color||C.muted,'700');
      var half=(w-12)/2,s=f.stability,d=FeedbackModel.buildDistanceBar(footPreview,view.players.human);
      var stateY=desktopLayout?209:tight?149:159,stateBarY=desktopLayout?223:tight?159:169;
      text((f.mode==='projected'?$t('预计稳定 '):$t('阶段稳定 '))+s.before.toFixed(1)+'→'+s.after.toFixed(1),x,stateY,10,C.ink);
      segmentBar(s,x,stateBarY,half,desktopLayout?9:7);
      if(d&&d.available){
        var dx=x+half+12,label=$t('距球 ')+d.after.toFixed(2)+'m · '+(d.retreatDistance>1e-6?$t('远离 ')+d.retreatDistance.toFixed(2)+'m':d.withinReach?$t('进入拍长'):$t('还需 ')+d.gap.toFixed(2)+'m');
        text(label,dx,stateY,9,d.retreatDistance>1e-6?C.danger:d.withinReach?C.teal:C.gold);
        segmentBar(d,dx,stateBarY,half,desktopLayout?9:7);line(dx+d.bodyRatio*half,stateBarY-3,dx+d.bodyRatio*half,stateBarY+10,C.ink,1.5);
        line(dx+d.reachStartRatio*half,stateBarY-2,dx+d.reachStartRatio*half,stateBarY+9,C.gold,1);ctx.beginPath();ctx.arc(dx+d.targetRatio*half,stateBarY+3.5,2.5,0,Math.PI*2);ctx.fillStyle=C.gold;ctx.fill();
      }
    }
    function isSettlement() { return ['pointEnd','gameEnd','matchEnd'].indexOf(view.phase)!==-1; }
    function finalFlight() {
      if(!isSettlement())return null;
      var source=view.lastResult&&view.lastResult.finalFlight;
      if(source===settledSource)return settledFlight;
      settledSource=source;settledFlight=null;
      if(!source||!source.trajectory||!source.trajectory.samples||!source.trajectory.samples.length)return null;
      var trajectory=source.trajectory,endTime=Math.max(0,Math.min(trajectory.duration,source.endTime));
      var end=ShotModel.sampleTrajectory(trajectory,endTime),samples=trajectory.samples.filter(function(p){return p.t<endTime-1e-8;});
      if(!end)return null;
      samples.push(end);
      var label=source.endReason==='contact'?$t('结算位置'):trajectory.terminal==='net'?$t('触网'):$t('落地');
      var clipped=Object.assign({},trajectory,{samples:samples,duration:endTime,landing:end,apex:Math.max.apply(null,samples.map(function(p){return p.z;}))});
      settledFlight={trajectory:clipped,hitter:source.hitter,end:end,endLabel:label,color:source.hitter==='ai'?C.gold:C.teal};
      return settledFlight;
    }
    function drawFlightDirection(points,color,bounds,labels) {
      if(points.length<2)return;
      var first=points[0],last=points[points.length-1],i=points.length-2;
      while(i>0&&Math.hypot(last.x-points[i].x,last.y-points[i].y)<10)i--;
      var before=points[i],length=Math.hypot(last.x-before.x,last.y-before.y);
      if(length>1){
        var dx=(last.x-before.x)/length,dy=(last.y-before.y)/length,size=labels?8:6;
        ctx.beginPath();ctx.moveTo(last.x,last.y);ctx.lineTo(last.x-dx*size-dy*size*.48,last.y-dy*size+dx*size*.48);ctx.lineTo(last.x-dx*size+dy*size*.48,last.y-dy*size-dx*size*.48);ctx.closePath();ctx.fillStyle=color;ctx.fill();
      }
      ctx.beginPath();ctx.arc(first.x,first.y,3,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();
      if(labels){
        [[first,$t('起')],[last,$t('终')]].forEach(function(item){
          var lx=Math.max(bounds.x+10,Math.min(bounds.x+bounds.w-10,item[0].x)),ly=item[0].y-15;
          if(ly<bounds.y+23)ly=item[0].y+15;
          ly=Math.max(bounds.y+23,Math.min(bounds.y+bounds.h-10,ly));
          box(lx-8,ly-7,16,14,'#091e24',color,4);text(item[1],lx,ly,9,color,'600','center',true);
        });
      }
    }
    function drawSettlementLeft(scene) {
      var pad=10,w=leftWidth-pad*2,flight=finalFlight(),top=desktopLayout?94:86,headerH=desktopLayout?56:44;
      box(pad,top,w,headerH,C.panel,C.line,9);
      text(flight?$t('最后一球 · ')+(flight.hitter==='human'?$t('你击出'):$t('对手击出')):$t('这一分尚未出球'),pad+10,top+14,desktopLayout?15:12,flight?flight.color:C.muted,'600');
      if(flight){
        text(flight.trajectory.duration.toFixed(2)+'s',leftWidth-pad-10,top+19,desktopLayout?30:25,C.ink,'700','right');
        text($t('起点 → ')+flight.endLabel+$t(' · 实际飞行'),pad+10,top+headerH-10,desktopLayout?12:10,C.muted);
      }else text($t('未产生实际球路，无末球曲线'),pad+10,top+headerH-10,desktopLayout?12:10,C.muted);
      var courtY=top+headerH+8,profileH=desktopLayout?148:Math.max(64,Math.min(86,Math.round(height*.23)));
      var courtH=Math.max(52,height-courtY-(flight?profileH+30:30));
      drawLandscapeCourt(pad,courtY,w,courtH,scene);
      if(flight){
        var sideY=courtY+courtH+6;
        drawSideProfile(pad,sideY,w,profileH,{valid:true,trajectory:flight.trajectory,hitter:flight.hitter,caption:$t('最后一球侧视'),color:flight.color,settled:true});
        text($t('末速 ')+Number(flight.end.speed||0).toFixed(1)+$t('m/s · 末高 ')+Number(flight.end.z||0).toFixed(2)+'m · '+flight.endLabel,pad,height-9,desktopLayout?12:10,C.muted);
      }else text($t('下一分开始后，将显示新的发接球信息'),pad,height-12,desktopLayout?12:10,C.muted);
    }
    function drawLandscapeCourt(x,y,w,h,scene) {
      var route=scene==='route'||scene==='details',isReplay=scene==='replay',trial=scene==='trial',service=view.phase==='serve'&&view.service;
      var isShot=view.phase==='shot'||trial||service&&service.server==='human';
      var plan=isReplay?replay.plan:route?footPreview:null,railH=route||isReplay?(desktopLayout?25:12):0;
      var settled=isSettlement()&&!isReplay?finalFlight():null;
      var scale=Math.max(1,Math.min((w-14)/G.courtLength,(h-railH-14)/G.singlesWidth));
      var cw=G.courtLength*scale,ch=G.singlesWidth*scale,left=x+(w-cw)/2,top=y+(h-railH-ch)/2,nx=left+cw/2,cy=top+ch/2;
      if(settled){
        // Fit out-of-court terminal points without distorting the official court.
        var minDepth=-1,maxDepth=1,minAcross=-1,maxAcross=1;
        settled.trajectory.samples.forEach(function(p){var d=(settled.hitter==='ai'?-1:1)*p.y;minDepth=Math.min(minDepth,d);maxDepth=Math.max(maxDepth,d);minAcross=Math.min(minAcross,p.x);maxAcross=Math.max(maxAcross,p.x);});
        var spanDepth=(maxDepth-minDepth)*G.courtLength/2,spanAcross=(maxAcross-minAcross)*G.singlesWidth/2;
        scale=Math.min((w-30)/spanDepth,(h-24)/spanAcross);cw=G.courtLength*scale;ch=G.singlesWidth*scale;
        nx=x+15+(w-30-spanDepth*scale)/2-minDepth*cw/2;cy=y+12+(h-24-spanAcross*scale)/2-minAcross*ch/2;left=nx-cw/2;top=cy-ch/2;
      }
      box(x,y,w,h,'#102b2c','#214640',8);box(left,top,cw,ch,C.court,null,0);
      function body(p,who){return{x:nx+(who==='ai'?1:-1)*p.y*cw/2,y:cy+p.x*ch/2};}
      function flight(p,hitter){return{x:nx+(hitter==='ai'?-1:1)*p.y*cw/2,y:cy+p.x*ch/2};}
      function zone(area,who,color){if(!area)return;var a=body({x:area.xMin,y:area.yMin},who),b=body({x:area.xMax,y:area.yMax},who);ctx.fillStyle=color;ctx.fillRect(Math.min(a.x,b.x),Math.min(a.y,b.y),Math.abs(b.x-a.x),Math.abs(b.y-a.y));}
      if(service){zone(service.serverRegion,service.server,'rgba(84,224,192,.20)');zone(service.receiverRegion,service.receiver,'rgba(244,210,123,.30)');}
      (CourtRules.lineRects(false)||[]).forEach(function(r){
        var rx=nx-r.yMax*cw/2,ry=cy+r.xMin*ch/2;ctx.fillStyle=r.id.indexOf('doubles')!==-1?'#578475':'#c6dfcf';
        ctx.fillRect(rx,ry,(r.yMax-r.yMin)*cw/2,(r.xMax-r.xMin)*ch/2);
      });
      line(nx,y+3,nx,y+h-3,C.ink,1.5);
      var human=trial&&footPreview?footPreview.finalState:view.players.human,ai=view.players.ai;
      if(service){if(service.server==='human'){human=servePosition;ai=service.receiverPosition;}else{human=receivePosition;ai=service.serverPosition;}}
      var trajectory=isReplay?replay.trajectory:isSettlement()?settled&&settled.trajectory:route?view.incoming&&view.incoming.trajectory:isShot?shotPreview&&shotPreview.trajectory:view.phase==='predict'?null:view.incoming&&view.incoming.trajectory;
      var sampleTime=isReplay?currentReplayTime():route?footContactTime:null,hitter=settled?settled.hitter:route||isReplay?'ai':'human',samples=trajectory&&trajectory.samples||[];
      if(isReplay)human=sampleAt(plan.bodyPath,sampleTime)||human;else if(route&&plan)human=plan.finalState;
      ctx.save();ctx.beginPath();ctx.rect(x+2,y+2,w-4,h-4);ctx.clip();
      if(view.phase==='predict'){
        var hp=body(human,'human'),vector=DIRS[direction];
        if(vector){var angle=Math.atan2(vector[0],-vector[1]),radius=Math.min(62,cw*.23),spread=commitment==='strong'?.45:.75;
          [[spread*1.7,'rgba(84,224,192,.08)'],[spread,'rgba(84,224,192,.16)'],[spread*.42,'rgba(84,224,192,.20)']].forEach(function(band){ctx.beginPath();ctx.moveTo(hp.x,hp.y);ctx.arc(hp.x,hp.y,radius,angle-band[0],angle+band[0]);ctx.closePath();ctx.fillStyle=band[1];ctx.fill();});
          arrow(hp.x,hp.y,hp.x-vector[1]*radius*.75,hp.y+vector[0]*radius*.75,C.teal,true);
        }else{ctx.beginPath();ctx.arc(hp.x,hp.y,18,0,Math.PI*2);ctx.strokeStyle=C.teal;ctx.setLineDash([3,4]);ctx.stroke();ctx.setLineDash([]);}
      }
      if(samples.length){ctx.beginPath();samples.forEach(function(p,i){var q=flight(p,hitter);if(!i)ctx.moveTo(q.x,q.y);else ctx.lineTo(q.x,q.y);});ctx.strokeStyle=settled?settled.color:route||isReplay?C.gold:C.teal;ctx.lineWidth=2;ctx.stroke();}
      var stepMarkers=plan?drawFootworkMotion(plan,body,isReplay?sampleTime:null):[];
      if(!isSettlement())drawRecoveryIntent(revealedRecovery('ai'),'ai',body);
      var selfPlan=isShot?Object.assign({},recoveryPreview||{from:recoveryOrigin()},{target:selectedRecoveryTarget()}):route||isReplay||isSettlement()?null:revealedRecovery('human');drawRecoveryIntent(selfPlan,'human',body);
      if(isShot&&controls){
        if(shotPreview&&trajectory){var end=flight(trajectory.landing,'human'),envelope=shotPreview.landingEnvelope;
          if(envelope&&envelope.drawable&&envelope.points&&envelope.points.length){ctx.save();ctx.beginPath();envelope.points.forEach(function(p,i){var q=flight(p,'human');if(i)ctx.lineTo(q.x,q.y);else ctx.moveTo(q.x,q.y);});ctx.closePath();ctx.fillStyle='rgba(109,212,237,.18)';ctx.fill();ctx.strokeStyle='#8ad4e6';ctx.lineWidth=1.2;ctx.stroke();ctx.restore();}
          ctx.beginPath();ctx.arc(end.x,end.y,3,0,Math.PI*2);ctx.fillStyle=shotPreview.valid?C.teal:C.danger;ctx.fill();}
      }
      [[human,'human',C.teal],[ai,'ai',C.gold]].forEach(function(item){var p=body(item[0],item[1]);ctx.beginPath();ctx.arc(p.x,p.y,9,0,Math.PI*2);ctx.fillStyle='#0a2026';ctx.fill();ctx.beginPath();ctx.arc(p.x,p.y,7,0,Math.PI*2);ctx.fillStyle=item[2];ctx.fill();text(item[1]==='human'?$t('你'):'AI',p.x,p.y,8,'#08281f','700','center');});
      if(selfPlan){ctx.save();ctx.globalAlpha=.65;recoveryMarker(body(selfPlan.target,'human'),C.recovery,3.5);ctx.restore();}
      if(sampleTime!==null&&trajectory){var sample=ShotModel.sampleTrajectory(trajectory,sampleTime);if(sample){var bp=flight(sample,hitter);shuttle(bp.x,bp.y,C.ink);}}
      if(settled)drawFlightDirection(samples.map(function(p){return flight(p,hitter);}),settled.color,{x:x,y:y,w:w,h:h},true);
      drawFootworkMarkers(stepMarkers,x,y,w,h);
      ctx.restore();
      text($t('你 · ')+(view.ends&&view.ends.human==='far'?$t('远端'):$t('近端')),x+5,y+7,8,C.teal,'600');
      text('AI · '+(view.ends&&view.ends.ai==='near'?$t('近端'):$t('远端')),x+w-5,y+7,8,C.gold,'600','right');
      var interactive=scene!=='training'&&scene!=='replay'&&scene!=='details';
      if(route&&interactive)contactRegion({x:x,y:y,w:w,h:h,points:samples.map(function(p){var q=flight(p,'ai');q.t=p.t;return q;})},$t('顶视球路连续截击'));
      if(isShot&&controls&&interactive)regions.push({x:nx+1,y:top,w:cw/2-1,h:ch,label:$t('场地连续瞄准'),action:function(point){aimAt({x:Math.max(-1,Math.min(1,(point.y-cy)/(ch/2))),y:Math.max(0,Math.min(1,(point.x-nx)/(cw/2)))});}});
      if((isShot||service)&&interactive)regions.push({x:left,y:top,w:cw/2,h:ch,label:service&&serveCourtMode==='stance'?$t('发接球站位选择'):$t('本方半场自由回动'),action:function(point){
        dragging={kind:service&&(service.server!=='human'||serveCourtMode==='stance')?'servePosition':'recovery',horizontal:true,netX:nx,centerY:cy,halfWidth:ch/2,halfLength:cw/2};lastTick=Date.now();
        if(dragging.kind==='servePosition')updateServePosition(point,true);else updateRecoveryDrag(point);
      }});
      return {x:left,y:top,w:cw,h:ch,netX:nx,centerY:cy};
    }
    function drawDesktopLeftScene(scene) {
      var pad=10,w=leftWidth-pad*2,route=scene==='route'||scene==='details',shot=scene==='shot'||scene==='trial'||view.phase==='serve'&&view.service&&view.service.server==='human';
      drawLandscapeHUD();
      if(isSettlement()){drawSettlementLeft(scene);return;}
      if(route){
        drawLandscapeFeedback();
        drawLandscapeCourt(pad,245,w,258,scene);
        var tr=view.incoming&&view.incoming.trajectory,side=drawSideProfile(pad,514,w,76,{valid:true,trajectory:tr,hitter:'ai',contactHeightGuide:true},footContactTime);
        contactRegion(side,$t('侧视球路连续截击'));
        var sample=incomingSample(footContactTime),aiPlan=revealedRecovery('ai');
        text($t('球速 ')+Number(sample&&sample.speed||0).toFixed(1)+'m/s · '+flightTrend(verticalSpeed(sample)),pad,607,12,C.gold);
        if(aiPlan)text($t('对手回动 ≤')+Number(recoveryValue(aiPlan,'maxDistance')||0).toFixed(2)+'m',leftWidth-pad,607,11,C.aiRecovery,'400','right');
        var sx=pad+132,sw=leftWidth-pad-sx,duration=tr&&tr.duration||1,sy=646;
        drawContactHeightSlider(sx,sy,sw,duration,pad,627);return;
      }
      var tr=scene==='replay'?replay.trajectory:shot?shotPreview&&shotPreview.trajectory:null,net=tr&&tr.terminal==='net';
      if(shot){box(pad,92,w,64,C.panel,net?'#764a4e':'#31534f',10);text(net?$t('至触网'):$t('预计完整飞行'),pad+14,112,15,net?C.danger:C.teal,'700');text(tr?tr.duration.toFixed(2)+'s':'—',leftWidth-pad-14,121,32,C.ink,'700','right');text(scene==='trial'?$t('未执行试算 · 对手可提前截击'):$t('预测至终点 · 对手可提前截击'),pad+14,138,12,C.muted);}
      else text(scene==='replay'?$t('步伐与来球回放'):view.phase==='predict'?$t('预判启动 · 来球尚未揭露'):view.phase==='serve'?$t('选择接发站位'):PHASES[view.phase]||$t('球场'),pad,113,17,C.teal,'600');
      var courtY=shot?171:140,courtH=shot?270:292;
      drawLandscapeCourt(pad,courtY,w,courtH,scene);
      var noteY=courtY+courtH+22,envelope=shotPreview&&shotPreview.landingEnvelope,ai=revealedRecovery('ai'),impact=shot&&view.phase!=='serve';
      if(shot){
        text(envelope&&envelope.drawable?$t('误差参考圈 横±')+envelope.radiusAcrossMeters.toFixed(2)+$t('m / 深±')+envelope.radiusDepthMeters.toFixed(2)+'m':$t('预计触网：不显示落点误差圈'),pad,noteY,13,'#8ad4e6');
        if(impact)drawShotImpactRow(pad,noteY+18,w,'circle');
        text($t('左半场回动 ≤')+Number(recoveryValue(recoveryPreview,'maxDistance')||0).toFixed(2)+$t('m · 右半场瞄准'),pad,noteY+(impact?38:25),12,C.recovery);
        if(ai)text(ai.status==='completed'?$t('对手已回动 ')+Number(ai.moved||0).toFixed(2)+'m':$t('对手预计 ≤')+Number(recoveryValue(ai,'maxDistance')||0).toFixed(2)+'m',leftWidth-pad,noteY+(impact?38:25),11,C.aiRecovery,'400','right');
      }else text($t('左侧是你 · 固定镜头 · 场地保持正式单打比例'),pad,noteY,12,C.muted);
      if(tr){var sideY=shot?(impact?526:515):480;drawSideProfile(pad,sideY,w,height-sideY-10,{valid:shotPreview?shotPreview.valid:true,trajectory:tr,hitter:scene==='replay'?'ai':'human'},scene==='replay'?currentReplayTime():undefined);}
      else{var helpY=493;box(pad,helpY,w,137,C.panel,C.line,10);text(view.phase==='predict'?$t('先选方向，再揭晓来球'):$t('在右侧完成当前选择'),pad+17,helpY+29,15,C.ink,'600');wrap(view.phase==='predict'?$t('方向按钮与球场画面一致。预判会改变启动用时，来球揭露后可沿球路选择触球点。'):$t('体力与稳定度始终显示当前值；规划与试算不会提前扣除。'),pad+17,helpY+64,w-34,13,C.muted,3,23);}
    }
    function drawLeftScene(scene) {
      if(desktopLayout){drawDesktopLeftScene(scene);return;}
      var pad=10,route=scene==='route'||scene==='details',shot=scene==='shot'||scene==='trial'||view.phase==='serve'&&view.service&&view.service.server==='human';
      drawLandscapeHUD();
      if(isSettlement()){drawSettlementLeft(scene);return;}
      if(route){
        drawLandscapeFeedback();
        var arenaY=height<320?172:181,arenaH=Math.max(49,height-arenaY-50),mapW=(leftWidth-pad*2-7)*.72;
        drawLandscapeCourt(pad,arenaY,mapW,arenaH,scene);
        var sx=pad+mapW+7,sw=leftWidth-sx-pad,tr=view.incoming&&view.incoming.trajectory;
        var side=drawSideProfile(sx,arenaY,sw,arenaH,{valid:true,trajectory:tr,hitter:'ai',contactHeightGuide:true},footContactTime);contactRegion(side,$t('侧视球路连续截击'));
        var sample=incomingSample(footContactTime),aiPlan=revealedRecovery('ai');
        text($t('球速 ')+Number(sample&&sample.speed||0).toFixed(1)+'m/s · '+flightTrend(verticalSpeed(sample)),pad,height-41,10,C.gold);
        var aiMax=recoveryValue(aiPlan,'maxDistance');
        text(aiPlan?'AI '+recoveryDirection(aiPlan,'ai')+(Number.isFinite(aiMax)?$t(' · 最多')+aiMax.toFixed(2)+'m':''):'',leftWidth-pad,height-41,9,C.aiRecovery,'400','right');
        var sliderX=pad+88,sliderW=leftWidth-pad-sliderX,duration=tr&&tr.duration||1;
        drawContactHeightSlider(sliderX,height-10,sliderW,duration,pad,height-26);
      }else{
        var startY=94;
        if(shot){var trajectory=shotPreview&&shotPreview.trajectory,net=trajectory&&trajectory.terminal==='net';
          box(pad,86,leftWidth-pad*2,38,C.panel,net?'#764a4e':'#31534f',8);
          text(net?$t('至触网'):$t('预计完整飞行'),pad+9,98,12,net?C.danger:C.teal,'700');text(trajectory?trajectory.duration.toFixed(2)+'s':'—',leftWidth-pad-10,105,27,C.ink,'700','right');
          text(scene==='trial'?$t('未执行试算 · 对手可提前截击'):$t('预测至终点 · 对手可提前截击'),pad+9,114,9,C.muted);startY=130;
        }else{text(view.phase==='serve'?$t('点左侧本方发球区选择接发站位'):scene==='replay'?$t('步伐与球路回放'):view.phase==='predict'?$t('预判启动 · 来球仍未揭露'):PHASES[view.phase]||'',pad,96,12,C.teal,'600');startY=110;}
        var flight=scene==='replay'?replay.trajectory:shot?shotPreview&&shotPreview.trajectory:null;
        var hasFlightPanel=shot||scene==='replay',profileH=Math.max(54,Math.min(66,Math.round(height*.16)));
        // Reserve the curve and both information rows first. The previous
        // court-first layout left only 22px and silently omitted the chart.
        var impact=shot&&view.phase!=='serve',reservedH=hasFlightPanel?profileH+34+(impact?13:0):45;
        var courtH=Math.max(56,Math.min((leftWidth-24)*G.doublesWidth/G.courtLength+14,height-startY-reservedH));
        drawLandscapeCourt(pad,startY,leftWidth-pad*2,courtH,scene);
        var noteY=startY+courtH+14,aiRecovery=revealedRecovery('ai'),envelope=shot&&shotPreview&&shotPreview.landingEnvelope;
        if(hasFlightPanel){
          var sideY=startY+courtH+6;
          drawSideProfile(pad,sideY,leftWidth-pad*2,profileH,{valid:scene==='replay'||!!(shotPreview&&shotPreview.valid),trajectory:flight,hitter:scene==='replay'?'ai':'human',caption:scene==='replay'?$t('来球侧视'):view.phase==='serve'?$t('发球侧视'):$t('击球侧视')},scene==='replay'?currentReplayTime():undefined);
          noteY=sideY+profileH+8;
        }
        var ownMax=recoveryValue(recoveryPreview,'maxDistance');
        var envelopeText=envelope&&envelope.drawable?$t('误差参考圈 横±')+envelope.radiusAcrossMeters.toFixed(2)+$t('m / 深±')+envelope.radiusDepthMeters.toFixed(2)+'m':shot&&envelope?$t('预计触网：不显示落点误差圈'):'';
        text(envelopeText||(shot&&Number.isFinite(ownMax)?$t('左半场回动最多 ')+ownMax.toFixed(2)+$t('m · 右半场瞄准'):view.phase==='serve'?(view.service&&view.service.server==='human'?$t('发球区与合法对角区域已标亮'):$t('对手发球 · 黄色区域为你的接发区')):shot?$t('左侧本方半场：回动 · 右侧对手半场：瞄准'):$t('左侧是你 · 球场按真实长宽比绘制')),pad,noteY,10,envelopeText?'#8ad4e6':C.muted);
        if(impact)drawShotImpactRow(pad,noteY+13,leftWidth-pad*2,'circle');
        if(shot&&recoveryPreview)text($t('左回动 ≤')+Number(ownMax||0).toFixed(2)+$t('m · 右瞄准'),pad,noteY+(impact?26:13),9,C.recovery);
        if(aiRecovery){var limit=recoveryValue(aiRecovery,'maxDistance'),aiText=aiRecovery.status==='completed'?$t('对手已回动 ')+Number(aiRecovery.moved||0).toFixed(2)+'m':$t('对手预计 ≤')+Number(limit||0).toFixed(2)+'m';text(aiText,shot?leftWidth-pad:pad,noteY+(impact?26:13),9,C.aiRecovery,'400',shot?'right':'left');}
      }
    }
    function drawServeControls(pad) {
      var s=view.service;if(!s)return 200;
      text(s.server==='human'?$t('你发球 · ')+(s.side==='right'?$t('右'):$t('左'))+$t('发球区'):$t('对手发球 · 选择接发站位'),pad,113,16,C.ink,'600');
      wrap($t('发球区由比分决定，发向斜对角区域。'),pad,139,width-pad*2,11,C.muted,2,17);
      if(s.server!=='human'){
        wrap($t('在左侧本方半场点选或拖动站位，然后进入预判。'),pad,177,width-pad*2,12,C.gold,3,19);
        button($t('站位确定 · 进入预判'),pad,241,width-pad*2,44,function(){act(function(){return match.confirmReceive({receiverPosition:receivePosition});});},{primary:true});return 302;
      }
      var half=(width-pad*2-8)/2;
      button($t('点选发球站位'),pad,163,half,36,function(){serveCourtMode='stance';},{selected:serveCourtMode==='stance',size:12});
      button($t('点选回动目标'),pad+half+8,163,half,36,function(){serveCourtMode='recovery';},{selected:serveCourtMode==='recovery',size:12});
      text($t('发球高度（整只球最高点）'),pad,222,12,C.ink);text(serveHeight.toFixed(3)+'m',width-pad,222,13,C.teal,'600','right');
      var x=pad+8,w=width-pad*2-16,min=s.contactHeightMin||.25,max=s.contactHeightMax||1.149;
      box(x,239,w,8,'#28534d',null,4);ctx.beginPath();ctx.arc(x+(serveHeight-min)/(max-min)*w,243,6,0,Math.PI*2);ctx.fillStyle=C.teal;ctx.fill();
      regions.push({x:pad,y:224,w:width-pad*2,h:39,label:$t('发球高度滑杆'),action:function(point){dragging={kind:'serveHeight',x:x,w:w,min:min,max:max};lastTick=Date.now();updateSlider(point,true);}});
      text($t('整只球须低于1.15m，击出后先向上飞行。'),pad,271,10,C.gold);
      return drawShot(303,pad,false);
    }
    function drawRightScene(scene,pad) {
      if(scene==='training')return drawTraining(pad);
      if(scene==='details')return drawFootworkDetails(pad);
      if(scene==='route')return drawRoutes(pad,true);
      if(scene==='replay'){
        var time=currentReplayTime(),body=sampleAt(replay.plan.bodyPath,time)||replay.plan.finalState;
        text(replay.mode,pad,115,20,C.ink,'600');text(time.toFixed(2)+' / '+replay.duration.toFixed(2)+'s',pad,146,13,C.teal);
        button($t('跳过回放'),pad,169,width-pad*2,42,function(){endReplay();},{primary:true});
        text($t('回放稳定度 ')+body.balance.toFixed(1)+$t(' · 体力 ')+body.stamina.toFixed(1),pad,241,12,C.muted);return 285;
      }
      if(scene==='trial'){
        var original=view,p=footPreview;if(!p||!p.canHit){trialOpen=false;return 120;}
        view=Object.assign({},original,{phase:'shot',players:{human:p.finalState,ai:original.players.ai},shotContext:{contactHeight:p.contact.height,remainingTime:p.remainingTime,preparationTime:p.preparationTime,reachDistance:p.reachDistance}});
        var trialEnd=drawShot(112,pad,true);view=original;return trialEnd+12;
      }
      if(scene==='shot'){var end=drawShot(112,pad,false);if(view.energyReceipt){wrap(receiptText(view.energyReceipt),pad,end+25,width-pad*2,11,C.gold,3,17);end+=75;}
        if(lastReplay){button($t('回放步伐'),pad,end+12,112,36,function(){beginReplay(lastReplay.plan,lastReplay.trajectory,$t('步伐回放'),lastReplay.players);},{size:12});end+=55;}return end;}
      if(scene==='serve')return drawServeControls(pad);
      if(scene==='toss'){
        var toss=view.toss||{};text(toss.winner==='human'?$t('你赢得掷签'):$t('对手赢得掷签'),pad,115,20,C.ink,'600');
        wrap(toss.winner==='human'?$t('选择先发、先接或场地，对手选择另一项。'):$t('对手选择先发球，请选择场地。'),pad,150,width-pad*2,12,C.muted,3,19);
        var names={serve:$t('选择先发球'),receive:$t('选择先接球'),near:$t('选择近端场地'),far:$t('选择远端场地')};
        (toss.availableChoices||[]).forEach(function(choice,i){button(names[choice]||choice,pad,206+i*52,width-pad*2,42,function(){act(function(){return match.chooseToss(choice);});},{primary:i===0,size:13});});return 216+(toss.availableChoices||[]).length*52;
      }
      if(scene==='predict'){text($t('选择预启动方向'),pad,116,17,C.ink,'600');wrap($t('先判断方向，再锁定预判。球路揭露后规划接球。'),pad,145,width-pad*2,11,C.muted,2,17);return drawPredict(183,pad,260);}
      return drawEnd(115,pad,240);
    }
function drawCompactRoutes(pad) {
  var fw = view.footwork, plan = footPreview;
  if (!fw || !plan) {
    wrap(error || $t('步伐数据准备中'), pad, 64, width - pad * 2, 12, C.muted, 3, 17);
    return height - 4;
  }
  var contentW = width - pad * 2, gap = desktopLayout?14:7, top = desktopLayout?51:36, fullH = desktopLayout?54:32;
  var primaryH = desktopLayout?48:34, primaryY = height - (desktopLayout?8:4) - primaryH;
  var toolsH = desktopLayout?40:25, toolsY = primaryY - (desktopLayout?8:5) - toolsH;
  var graphBottom = toolsY - (desktopLayout?14:6);
  var middleH = Math.min(desktopLayout?180:84, (graphBottom - top - fullH * 2 - gap * 3) / 2);
  var row1 = top + fullH + gap, row2 = row1 + middleH + gap;
  var readyY = row2 + middleH + gap;
  var third = (contentW - gap * 2) / 3, half = (contentW - gap) / 2;
  var rows = plan.actionResults || [], ordersById = {};
  footActions.forEach(function (id, i) {
    if (!ordersById[id]) ordersById[id] = [];
    ordersById[id].push(i + 1);
  });
  var layouts = {
    start: [pad, top, contentW, fullH],
    shuffle: [pad, row1, third, middleH],
    cross: [pad + third + gap, row1, third, middleH],
    hop: [pad + (third + gap) * 2, row1, third, middleH],
    ground: [pad, row2, half, middleH],
    jump: [pad + half + gap, row2, half, middleH],
    ready: [pad, readyY, contentW, fullH]
  };
  footNodes = (fw.actions || []).map(function (a) {
    var r = layouts[a.id];
    return { id: a.id, label: footLabel(a.id), x: r[0], y: r[1], w: r[2], h: r[3] };
  });
  function signed(value) { return (value >= 0 ? '+' : '') + value.toFixed(1); }
  function shortText(value, x, y, available, size, color, align, weight) {
    ctx.font = (weight || '400') + ' ' + fontSize(size) + 'px ' + FONT;
    var measured = ctx.measureText(value).width;
    text(value, x, y, measured > available ? fontSize(size) * available / measured : fontSize(size), color, weight || '400', align || 'left',true);
  }
function selectedConnector(a, b, lane, latest, status) {
  if (!a || !b) return;
  var points = [], shift = (lane - 1) * 4;
  var ax = a.x + a.w / 2, bx = b.x + b.w / 2;
  var rightGap = 2 + lane * 1.6, channel = 1.35 + lane * 2.0;
  if (a.id === b.id) {
    // A self-loop lives wholly in the right inter-card/outer gutter.
    var loopX = a.x + a.w + rightGap;
    var fromY = a.y + a.h * 0.30 + shift * 0.35;
    var toY = a.y + a.h * 0.73 + shift * 0.35;
    points = [{ x: a.x + a.w + 0.7, y: fromY }, { x: loopX, y: fromY },
      { x: loopX, y: toY }, { x: a.x + a.w + 0.7, y: toY }];
  } else if (Math.abs(a.y - b.y) < 0.1) {
    var rightward = b.x > a.x;
    var separation = rightward ? b.x - a.x - a.w : a.x - b.x - b.w;
    if (separation <= gap + 0.1) {
      // Opposite/repeated horizontal edges use separate vertical lanes.
      var edgeY = a.y + a.h * 0.55 + shift;
      points = [{ x: rightward ? a.x + a.w + 0.7 : a.x - 0.7, y: edgeY },
        { x: rightward ? b.x - 0.7 : b.x + b.w + 0.7, y: edgeY }];
    } else {
      // Non-adjacent cards route above their row, never through the middle card.
      var overY = a.y - channel;
      points = [{ x: ax + shift, y: a.y - 0.7 }, { x: ax + shift, y: overY },
        { x: bx + shift, y: overY }, { x: bx + shift, y: b.y - 0.7 }];
    }
  } else {
    var down = b.y > a.y;
    var rowGap = down ? b.y - a.y - a.h : a.y - b.y - b.h;
    if (a.id === 'start') ax = bx;
    if (b.id === 'ready') bx = ax;
    ax = Math.max(a.x + 10, Math.min(a.x + a.w - 10, ax + shift));
    bx = Math.max(b.x + 10, Math.min(b.x + b.w - 10, bx + shift));
    var exitY = down ? a.y + a.h + 0.7 : a.y - 0.7;
    var entryY = down ? b.y - 0.7 : b.y + b.h + 0.7;
    if (rowGap <= gap + 0.1) {
      var betweenY = down ? a.y + a.h + channel : a.y - channel;
      points = [{ x: ax, y: exitY }, { x: ax, y: betweenY },
        { x: bx, y: betweenY }, { x: bx, y: entryY }];
    } else {
      // A skipped row uses the outer pad gutter, with three distinct lanes.
      var gutterX = (ax + bx) / 2 < width / 2 ? pad - rightGap : width - pad + rightGap;
      var leaveY = down ? a.y + a.h + channel : a.y - channel;
      var arriveY = down ? b.y - channel : b.y + b.h + channel;
      points = [{ x: ax, y: exitY }, { x: ax, y: leaveY }, { x: gutterX, y: leaveY },
        { x: gutterX, y: arriveY }, { x: bx, y: arriveY }, { x: bx, y: entryY }];
    }
  }
  points = points.filter(function (p, i) {
    return !i || Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y) > 0.01;
  });
  if (points.length < 2) return;
  var color = status==='unexecuted'?C.dim:status!=='completed'?C.danger:latest ? '#dcfff3' : lane === 1 ? '#a3cabe' : '#6e958b';
  ctx.save();if(status!=='completed')ctx.setLineDash([2,3]);
  ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
  for (var pi = 1; pi < points.length; pi++) ctx.lineTo(points[pi].x, points[pi].y);
  ctx.strokeStyle = color; ctx.lineWidth = latest ? 2.5 : 2; ctx.stroke();
  var end = points[points.length - 1], prior = points[points.length - 2];
  var dx = end.x - prior.x, dy = end.y - prior.y, length = Math.hypot(dx, dy);
  var ux = dx / length, uy = dy / length, head = 4;
  ctx.beginPath(); ctx.moveTo(end.x, end.y);
  ctx.lineTo(end.x - ux * head - uy * 2.4, end.y - uy * head + ux * 2.4);
  ctx.lineTo(end.x - ux * head + uy * 2.4, end.y - uy * head - ux * 2.4);
  ctx.closePath(); ctx.fillStyle = color; ctx.fill();ctx.restore();
}
var recentStart = Math.max(1, footActions.length - 3);
for (var edgeIndex = recentStart; edgeIndex < footActions.length; edgeIndex++) {
  var sourceNode = footNodes.find(function (n) { return n.id === footActions[edgeIndex - 1]; });
  var targetNode = footNodes.find(function (n) { return n.id === footActions[edgeIndex]; });
  selectedConnector(sourceNode, targetNode, edgeIndex - recentStart, edgeIndex === footActions.length - 1,footResultStatus(footResultAt(plan,edgeIndex)));
}

  footNodes.forEach(function (node) {
    var candidate = footCandidates[node.id] || {}, orders = ordersById[node.id] || [];
    var legal = candidate.allowed, full = node.id === 'start' || node.id === 'ready';
    var style = FeedbackModel.ACTION_STYLES[node.id] || { color: C.muted }, color = footActionColor(node.id);
    var lastOrder = orders.length ? orders[orders.length - 1] : 0, last = lastOrder ? footResultAt(plan,lastOrder-1) : null;
    var prior=last&&lastOrder>1?footResultAt(plan,lastOrder-2):null;
    var priced = legal && Number.isFinite(candidate.duration), duration = priced ? candidate.duration : last && last.duration;
    var nodeCombo=priced?candidate.combo:last&&last.combo;
    var balanceDelta = priced ? candidate.balanceDelta : last ? last.balance - (prior?prior.balance:plan.balanceBefore) : null;
    var distance = priced ? candidate.distance : last && last.distance;
    var progress = priced ? candidate.progress : last && last.progress;
    var timing = Number.isFinite(duration) ? (priced ? '+' : footResultStatus(last)==='partial'?$t('中断'):footResultStatus(last)==='late'?$t('超时'):$t('已选')) + duration.toFixed(2) + $t('s  稳') + signed(balanceDelta) : orders.length?$t('未计算到此步'):$t('暂不可选');
    var movement = Number.isFinite(distance) && Number.isFinite(progress) ? $t('移') + distance.toFixed(2).replace(/^0\./,'.') + $t('m 近') + (progress >= 0 ? '+' : '') + progress.toFixed(2).replace(/^(-?)0\./,'$1.') : '';
    if(node.id==='ground'||node.id==='jump')movement=$t('移0.00m · ')+(node.id==='ground'?$t('地面击球'):$t('增高')+Number((fw.contactHeightLimits||{}).jumpBoost||.45).toFixed(2)+'m');
    var stroke = legal ? color : orders.length ? '#627f85' : C.line;
    if (lastOrder === footActions.length && !plan.valid) stroke = C.danger;
    var startInfo=node.id==='start'?startAnticipationDisplay():null;
    var fill=startInfo?(startInfo.outcome==='wrong'?'#352530':startInfo.outcome==='correct'?'#183A32':'#203044'):legal ? '#173b3c' : orders.length ? '#192f38' : C.panel;
    box(node.x, node.y, node.w, node.h, fill, stroke, 7);
    box(node.x + 3, node.y + 5, 2, node.h - 10, color, null, 1);
    if (full&&node.id==='ready') {
      var prefixW=orders.length?(desktopLayout?43:30):(desktopLayout?13:8),accuracy=selectedContactAccuracy();
      text(node.label,node.x+prefixW,node.y+(desktopLayout?17:10),desktopLayout?14:11,legal||orders.length?C.ink:C.muted,'600');
      shortText($t('0.00s · 末项必选'),node.x+node.w-8,node.y+(desktopLayout?17:10),node.w-prefixW-(desktopLayout?74:42),10,C.muted,'right');
      var metricsW=node.w-prefixW-16,speedW=metricsW*.58;
      shortText($t('截击球速 ')+(accuracy?accuracy.speed.toFixed(1)+' m/s':'—'),node.x+prefixW,node.y+(desktopLayout?39:24),speedW,9.5,C.gold);
      shortText($t('命中率 ')+(accuracy?(accuracy.hitProbability*100).toFixed(1)+'%':'—'),node.x+node.w-8,node.y+(desktopLayout?39:24),metricsW-speedW,10,accuracyColor(accuracy),'right','600');
    } else if (full) {
      var prefixW = orders.length ? desktopLayout?43:30 : desktopLayout?13:8;
      text(node.label, node.x + prefixW, node.y + (desktopLayout?17:10), desktopLayout?14:11, node.id==='start'?color:legal || orders.length ? C.ink : C.muted, '600');
      shortText(timing, node.x + node.w - 8, node.y + (desktopLayout?17:10), node.w - prefixW - (desktopLayout?93:60), 10, priced ? color : C.muted, 'right', '500');
      var penaltySeconds=priced?candidate.anticipationPenaltySeconds:last&&last.anticipationPenaltySeconds;
      var secondLine=node.id==='start'&&node.label===$t('二次启动')&&Number.isFinite(penaltySeconds)?$t('含失误 +')+penaltySeconds.toFixed(2)+'s · '+movement:movement || candidate.reason || $t('按步骤连接，最后以挥拍结束');
      if(node.id==='start'&&node.label!==$t('二次启动'))secondLine=$t('首项必选 · ')+secondLine;
      if(node.id==='ready')secondLine=$t('末项必选 · ')+secondLine;
      shortText(secondLine, node.x + prefixW, node.y + (desktopLayout?39:24), node.w - prefixW - 8, 9.5, node.label===$t('二次启动')||progress < 0 ? C.danger : C.muted);
    } else {
      text(node.label, node.x + node.w / 2, node.y + (desktopLayout?21:9), desktopLayout?14:11, legal || orders.length ? C.ink : C.muted, '600', 'center');
      shortText(timing, node.x + node.w / 2, node.y + (desktopLayout?49:22), node.w - 11, 9.5, priced ? color : C.muted, 'center', '500');
      shortText(movement, node.x + node.w / 2, node.y + (desktopLayout?74:33), node.w - 10, 9.2, progress < 0 ? C.danger : C.muted, 'center');
      if(nodeCombo){box(node.x+node.w-(desktopLayout?25:17),node.y+3,desktopLayout?21:14,desktopLayout?18:12,'#4b4230',null,3);text($t('连'),node.x+node.w-(desktopLayout?14.5:10),node.y+(desktopLayout?12:9),desktopLayout?11:9,C.gold,'600','center',true);}
    }
    // The entire node remains a click/drag target; an invalid click opens the
    // existing complete explanation dialog without executing anything.
    regions.push({ x: node.x, y: node.y, w: node.w, h: node.h, label: node.label, action: function (point) {
      if (appendFootAction(node.id, true)) { dragging = { kind: 'footwork', lastNode: node.id, lastPoint: point }; lastTick = Date.now(); }
    } });
    if (orders.length) {
      var cols = full ? 1 : Math.min(6, orders.length), rowCount = Math.ceil(orders.length / cols);
      var rowPitch = rowCount > 1 ? (node.h - (desktopLayout?125:49)) / (rowCount - 1) : 0;
      var cellW = full ? 20 : (node.w - 12) / cols, numberY = full ? node.y + (desktopLayout?27:16) : node.y + (desktopLayout?104:43);
      orders.forEach(function (order, i) {
        var result=footResultAt(plan,order-1),status=footResultStatus(result),completed=status==='completed';
        var badgeColor=completed?color:status==='unexecuted'?C.muted:C.danger,badgeFill=completed?color:C.bg;
        var x = full ? node.x + (desktopLayout?23:16) : node.x + 6 + cellW * (i % cols + 0.5);
        var y = numberY + Math.floor(i / cols) * rowPitch;
        if (!full && rowCount > 1) y = Math.min(node.y + node.h - 6, y);
        if (!full && rowCount > 1) {
          var badgeH = Math.min(desktopLayout?20:12, rowPitch - 1), badgeW = Math.min(desktopLayout?24:16, cellW - 1);
          box(x - badgeW / 2, y - badgeH / 2, badgeW, badgeH, badgeFill,completed&&order===footActions.length?C.ink:badgeColor, 2);
        } else {
          var radius = full ? desktopLayout?14:10 : Math.min(desktopLayout?11:7, cellW * 0.46);
          ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fillStyle = badgeFill; ctx.fill();
          if (!completed||order === footActions.length) { ctx.strokeStyle = !completed?badgeColor:C.ink; ctx.lineWidth = 1.7; ctx.stroke(); }
        }
        text(order, x, y, full ? 12 : 10, completed?C.bg:badgeColor, '700', 'center');
        var numberRadius=full?(desktopLayout?14:10):(desktopLayout?11:7);
        regions.push({x:x-numberRadius,y:y-numberRadius,w:numberRadius*2,h:numberRadius*2,label:$t('步骤序号 ')+order,action:function(){dragging=null;}});
        if(result&&result.combo){ctx.beginPath();ctx.arc(x+(desktopLayout?8:5),y-(desktopLayout?8:5),desktopLayout?3.5:2.5,0,Math.PI*2);ctx.fillStyle=C.gold;ctx.fill();}
      });
      // Numbers are annotations inside the action button; they never navigate.
    } else if (!full) shortText(nodeCombo?$t('连携 · ')+nodeCombo.label:legal ? $t('可追加') : $t('点按看原因'), node.x + node.w / 2, node.y + node.h - (desktopLayout?20:10),node.w-10,9,nodeCombo?C.gold:legal ? color : C.dim,'center');
  });
  var toolW = (contentW - 10) / 3;
  button($t('撤销一步'), pad, toolsY, toolW, toolsH, function () { footActions.pop(); error = ''; refreshFootwork(); }, { size: 10, disabled: !footActions.length });
  button($t('清空路径'), pad + toolW + 5, toolsY, toolW, toolsH, function () { footActions = []; error = ''; routeChainOpen = false; refreshFootwork(); }, { size: 10, disabled: !footActions.length });
  button($t('明细 / 原因'), pad + (toolW + 5) * 2, toolsY, toolW, toolsH, function () { detailsOpen = true; detailPage = 0; lastTick = Date.now(); }, { size: 10 });
  var trialW = Math.floor(contentW * 0.40);
  button($t('回球试算'), pad, primaryY, trialW, primaryH, function () { trialOpen = true; lastTick = Date.now(); }, { size: 11, disabled: !plan.canHit });
  button($t('执行路径'), pad + trialW + 6, primaryY, contentW - trialW - 6, primaryH, function () {
    if (contactDirty) refreshFootwork();
    var capture = { plan: footPreview, trajectory: view.incoming.trajectory, players: JSON.parse(JSON.stringify(view.players)) };
    act(function () { return match.commitFootwork(footPlan()); });
    if (view.phase === 'shot') { capture.plan = view.lastFootwork || capture.plan; lastReplay = capture; beginReplay(capture.plan, capture.trajectory, $t('步伐回放'), capture.players); }
  }, { primary: true, size: 12, disabled: !plan.canHit });
  return height - 4;
}

    function drawCompactSlider(kind,label,y,pad,min,max) {
      var value=controls?controls[kind]:min,axis=shotScan&&shotScan[kind],x=pad+8,w=width-pad*2-16,limit=currentPowerLimit();
      text(label,pad,y,12,C.ink,'500');text(kind==='angle'?(value>0?'+':'')+value.toFixed(1)+'°':Math.round(value*100)+$t('% · 上限')+Math.round(limit*100)+'%',width-pad,y,kind==='power'?11:13,C.teal,'600','right');
      ctx.font='500 '+fontSize(12)+'px '+FONT;var labelWidth=ctx.measureText(label).width;
      if(kind==='angle')text(manualShotAngle?$t('保留角度'):$t('自动配角'),pad+labelWidth+7,y,8.5,manualShotAngle?C.gold:C.muted);
      if(kind==='power')text('5–100%',pad+Math.max(66,labelWidth+18),y,9,C.dim);
      box(x,y+13,w,10,'#2a3f50',null,4);
      if(axis){ctx.save();rounded(x,y+13,w,10,4);ctx.clip();(axis.segments||[]).forEach(function(s){ctx.fillStyle=(SHOT_BANDS[s.category]||SHOT_BANDS.heavy).color;ctx.fillRect(x+(s.from-min)/(max-min)*w,y+13,(s.to-s.from)/(max-min)*w,10);});ctx.restore();
        (axis.physicalSegments||[]).forEach(function(s){ctx.fillStyle=s.outcome==='in'?'#365967':C.danger;ctx.fillRect(x+(s.from-min)/(max-min)*w,y+26,(s.to-s.from)/(max-min)*w,3);});}
      if(kind==='power'&&limit<max-1e-9){
        var capX=x+(limit-min)/(max-min)*w,lockedW=x+w-capX;
        ctx.fillStyle='#293440';ctx.fillRect(capX,y+13,lockedW,10);ctx.fillStyle='#1c2935';ctx.fillRect(capX,y+26,lockedW,3);
        line(capX,y+10,capX,y+31,'#b6c2cb',1.3);
        if(lockedW>=21){var lx=capX+lockedW/2;ctx.strokeStyle='#738496';ctx.lineWidth=1.4;ctx.beginPath();ctx.arc(lx,y+17,2.5,Math.PI,0);ctx.stroke();box(lx-3.5,y+17,7,5,'#738496',null,1);}
      }
      var band=shotScan&&SHOT_BANDS[shotScan.current.category],px=x+Math.max(0,Math.min(1,(value-min)/(max-min)))*w;
      ctx.beginPath();ctx.arc(px,y+18,7,0,Math.PI*2);ctx.fillStyle=C.ink;ctx.fill();ctx.beginPath();ctx.arc(px,y+18,3.5,0,Math.PI*2);ctx.fillStyle=band?band.color:C.teal;ctx.fill();
      regions.push({x:pad,y:y-6,w:width-pad*2,h:40,label:label+$t('滑杆'),action:function(p){dragging={kind:kind,x:x,w:w,min:min,max:max};lastTick=Date.now();updateSlider(p,true);}});
    }
    function compactShotSubmit(trial) {
      if(trial){if(previewDirty)refreshPreview();trialOpen=false;lastTick=Date.now();return;}
      act(function(){refreshPreview();var selection=recoverySelection();return view.phase==='serve'?match.commitServe(selection):match.shoot(selection);});
    }
    function drawCompactShot(pad,trial,serving) {
      var tight=!desktopLayout&&height<320;
      var current=shotScan&&shotScan.current,context=view.shotContext||{},setup=view.service||{},angleY=desktopLayout?130:tight?74:78,powerY=desktopLayout?216:tight?121:129;
      if(serving){
        var half=(width-pad*2-7)/2;
        var serveY=desktopLayout?54:40,serveH=desktopLayout?43:30,heightY=desktopLayout?128:tight?84:88,heightTrackY=desktopLayout?149:tight?98:102;
        button($t('点选发球站位'),pad,serveY,half,serveH,function(){serveCourtMode='stance';},{selected:serveCourtMode==='stance',size:11});
        button($t('点选回动目标'),pad+half+7,serveY,half,serveH,function(){serveCourtMode='recovery';},{selected:serveCourtMode==='recovery',size:11});
        text($t('发球高度（整球最高点）'),pad,heightY,11,C.ink);text(serveHeight.toFixed(3)+'m',width-pad,heightY,12,C.teal,'600','right');
        var hx=pad+8,hw=width-pad*2-16,hmin=setup.contactHeightMin||.25,hmax=setup.contactHeightMax||1.149;
        box(hx,heightTrackY,hw,7,'#28534d',null,4);ctx.beginPath();ctx.arc(hx+(serveHeight-hmin)/(hmax-hmin)*hw,heightTrackY+3.5,6,0,Math.PI*2);ctx.fillStyle=C.teal;ctx.fill();
        regions.push({x:pad,y:heightY-9,w:width-pad*2,h:desktopLayout?50:37,label:$t('发球高度滑杆'),action:function(point){dragging={kind:'serveHeight',x:hx,w:hw,min:hmin,max:hmax};lastTick=Date.now();updateSlider(point,true);}});
        angleY=desktopLayout?207:tight?118:height<325?124:130;powerY=angleY+(desktopLayout?84:tight?40:44);
      }else{
        text((trial?$t('预计触球 '):$t('触球 '))+(current?current.contactHeight:Number(context.contactHeight||0)).toFixed(2)+$t('m · 体力 ')+(current?current.stamina:view.players.human.stamina).toFixed(1)+$t(' · 稳定 ')+(current?current.balance:view.players.human.balance).toFixed(1),pad,desktopLayout?63:47,11,C.muted);
        var contactState=trial?footPreview:context,readyTime=Number(contactState&&contactState.remainingTime||0),reach=Number(contactState&&contactState.reachDistance||0);
        var jumpContact=trial?footPreview&&footPreview.contact&&footPreview.contact.mode==='jump':context.contactMode==='jump';
        text((jumpContact?$t('起跳前等待 '):$t('准备余量 '))+readyTime.toFixed(2)+$t('s · 伸拍 ')+reach.toFixed(2)+'m',pad,desktopLayout?89:62,10,readyTime<0?C.danger:C.teal);
      }
      drawCompactSlider('angle',$t('发射角度'),angleY,pad,-30,75);drawCompactSlider('power',$t('发力程度'),powerY,pad,.05,1);
      var infoY=powerY+(desktopLayout?(serving?55:75):serving?40:54),styles=['comfortable','strained','heavy'];
      if(!serving){var legendY=angleY+(desktopLayout?42:35);
        styles.forEach(function(id,i){var style=SHOT_BANDS[id],x=pad+i*(width-pad*2)/3;box(x,legendY-3,6,6,style.color,null,2);text(style.label,x+10,legendY,desktopLayout?12:8.5,C.muted,'400','left',true);});
        drawShotImpactRow(pad,powerY+(desktopLayout?44:40),width-pad*2,'power');
      }
      var fit=shotPreview?(shotPreview.stateFit*100).toFixed(1)+'%':'—',skill=shotPreview?shotPreview.proficiency.toFixed(0):'—',category=current&&SHOT_BANDS[current.category];
      wrap(error||((category?category.label+' · ':'')+$t('匹配 ')+fit+$t(' · 熟练 ')+skill+$t(' · 耗力 ')+(shotPreview?shotPreview.staminaCost.toFixed(1):'—')),pad,infoY,width-pad*2,serving?10:9.5,error?C.danger:C.muted,1,13);
      var warning=error||shotPreview&&!shotPreview.valid&&(shotPreview.warning||shotPreview.trajectory&&shotPreview.trajectory.warning)||'';
      var outcome=current&&SHOT_OUTCOMES[current.physicalOutcome]||$t('预测计算中'),riskLabel=shotRiskText(),limit=shotPreview&&shotPreview.powerLimit;
      var serviceFault=serving&&shotPreview&&shotPreview.service&&!shotPreview.service.legal;
      var landing=shotPreview&&shotPreview.trajectory&&shotPreview.trajectory.freeLanding;
      var aimMiss=landing&&controls?Math.hypot((landing.x-controls.target.x)*G.halfWidth,(landing.y-controls.target.y)*G.halfLength):0;
      var landingStatus=shotPreview&&shotPreview.valid&&aimMiss>.30?(landing.y<controls.target.y-.04?$t('落点偏短'):landing.y>controls.target.y+.04?$t('落点偏长'):$t('偏离目标')):outcome;
      var validText=riskLabel?riskLabel+' · '+(serviceFault?$t('发球违例'):landingStatus):serving?outcome+$t(' · 整球<1.15m，向上发往对角区'):outcome+$t(' · 主色身体适配 / 细红风险');
      var risk=shotPreview&&shotPreview.risk,riskColor=warning||risk&&risk.upper>=.35?C.danger:risk&&risk.upper>=.12?C.gold:C.ink;
      wrap(serving&&warning&&!riskLabel?warning:validText,pad,infoY+(desktopLayout?26:serving?18:14),width-pad*2,serving?11:10,riskLabel?riskColor:warning?C.danger:C.muted,1,13);
      if(!serving){
        drawShotImpactRow(pad,powerY+(desktopLayout?124:82),width-pad*2,'risk');
        drawShotImpactReference(pad,powerY+(desktopLayout?146:96),width-pad*2);
      }
      if(desktopLayout){var noteY=serving?425:407;box(pad,noteY,width-pad*2,97,C.panel,C.line,9);text($t('主色：身体适配 · 细红带：物理风险'),pad+12,noteY+22,12,C.ink);wrap($t('手调角度后，点对方落点会保留角度并重新配力。单独抬高角度不自动加力；请看实心实际落点。'),pad+12,noteY+48,width-pad*2-24,12,C.muted,3,20);}
      var toolsY=height-(desktopLayout?112:80),tw=(width-pad*2-12)/3,toolH=desktopLayout?40:29;
      button($t('回中'),pad,toolsY,tw,toolH,function(){selectRecovery('center');},{selected:recoveryMode==='center',size:11});
      button($t('原地停留'),pad+tw+6,toolsY,tw,toolH,function(){selectRecovery('stay');},{selected:recoveryMode==='stay',size:11});
      button($t('状态详情'),pad+2*(tw+6),toolsY,tw,toolH,function(){shotFactorsOpen=true;detailPage=0;lastTick=Date.now();},{size:11});
      var label=trial?$t('保留试算 · 返回步伐'):serving?(shotPreview&&!shotPreview.valid?$t('确认发球 · 接受当前风险'):$t('确认发球 · 开始对抗')):shotPreview&&!shotPreview.valid?$t('确认击球 · 接受当前风险'):$t('确认击球 · 同时回位');
      button(label,pad,height-(desktopLayout?62:43),width-pad*2,desktopLayout?50:36,function(){compactShotSubmit(trial);},{primary:true,size:12,disabled:!controls||!shotPreview});
    }
    function pageLines(lines,maxWidth) {
      var output=[];ctx.font='400 '+fontSize(11)+'px '+FONT;
      lines.forEach(function(value){if($lang==='en'){$lines(function(v){return ctx.measureText(v).width;},value,maxWidth).forEach(function(l){output.push(l||' ');});return;}var chars=Array.from(String(value)),part='';chars.forEach(function(ch){if(part&&ctx.measureText(part+ch).width>maxWidth){output.push(part);part=ch;}else part+=ch;});output.push(part||' ');});return output;
    }
    function drawInfoPages(title,lines,pad,onClose,concede) {
      text(title,pad,desktopLayout?70:48,16,C.ink,'600');button($t('返回操作'),width-pad-(desktopLayout?106:88),desktopLayout?52:35,desktopLayout?106:88,desktopLayout?38:29,onClose,{size:11,selected:true});
      var linePitch=desktopLayout?25:21,firstLine=desktopLayout?115:81;
      var flattened=pageLines(lines,width-pad*2),perPage=Math.max(5,Math.floor((height-(desktopLayout?180:128))/linePitch)),pages=Math.max(1,Math.ceil(flattened.length/perPage));detailPage=Math.max(0,Math.min(pages-1,detailPage));
      flattened.slice(detailPage*perPage,(detailPage+1)*perPage).forEach(function(ln,i){text(ln,pad,firstLine+i*linePitch,11,i===0?C.gold:C.muted);});
      var navY=height-(desktopLayout?54:42),navH=desktopLayout?42:32,bw=concede?(width-pad*2-12)/3:(width-pad*2-88)/2;
      button($t('上一页'),pad,navY,bw,navH,function(){detailPage--;},{size:11,disabled:detailPage===0});
      if(concede){button($t('放弃此球'),pad+bw+6,navY,bw,navH,function(){detailsOpen=false;act(function(){return match.concedePoint();});},{size:11});button($t('下一页'),pad+2*(bw+6),navY,bw,navH,function(){detailPage++;},{size:11,disabled:detailPage===pages-1});text((detailPage+1)+' / '+pages,width/2,navY-14,10,C.dim,'400','center');}
      else{button($t('下一页'),width-pad-bw,navY,bw,navH,function(){detailPage++;},{size:11,disabled:detailPage===pages-1});text((detailPage+1)+' / '+pages,width/2,navY+navH/2,11,C.dim,'400','center');}
    }
    function detailScale(n) { return desktopLayout ? n * 1.32 : n; }
    function detailAvailableHeight() { return height-(desktopLayout?54:42)-(desktopLayout?103:73)-9; }
    function detailLines(values,maxWidth,size) {
      var output=[];ctx.font='400 '+fontSize(size||10)+'px '+FONT;
      values.forEach(function(value){var part='';Array.from(String(value)).forEach(function(ch){if(part&&ctx.measureText(part+ch).width>maxWidth){output.push(part);part=ch;}else part+=ch;});output.push(part||' ');});return output;
    }
    function detailTextCards(cards,title,values,color,cardWidth) {
      var lines=detailLines(values,cardWidth-22,10),limit=Math.max(1,Math.min(desktopLayout?10:6,Math.floor((detailAvailableHeight()/detailScale(1)-27)/14)));
      for(var first=0;first<lines.length;first+=limit)(function(group,continued){
        cards.push({height:detailScale(27+group.length*14),paint:function(x,y,w){
          box(x,y,w,this.height,C.panel,C.line,7);box(x,y+8,3,this.height-16,color||C.teal,null,1);
          text(title+(continued?$t(' · 续'):''),x+10,y+detailScale(13),11,color||C.teal,'600');
          group.forEach(function(ln,i){text(ln,x+10,y+detailScale(31+i*14),10,C.muted);});
        }});
      })(lines.slice(first,first+limit),first>0);
    }
    function detailMetricCard(items) {
      return {height:detailScale(72),paint:function(x,y,w){var gap=5,cw=(w-gap*2)/3,ch=detailScale(33);
        items.forEach(function(item,i){var cx=x+(i%3)*(cw+gap),cy=y+Math.floor(i/3)*(ch+detailScale(5));
          box(cx,cy,cw,ch,C.panel,item.color,6);text(item.label,cx+7,cy+detailScale(10),9,C.muted);
          text(item.value,cx+7,cy+detailScale(24),item.small?10:12,item.color,'600');
        });
      }};
    }
    function detailStateBar(x,y,w,before,after,color) {
      var a=Math.max(0,Math.min(100,Number(before)||0)),b=Math.max(0,Math.min(100,Number(after)||0));
      box(x,y,w,5,'#293c4d',null,2);box(x,y,w*Math.min(a,b)/100,5,color||C.teal,null,2);
      if(a!==b)box(x+w*Math.min(a,b)/100,y,w*Math.abs(a-b)/100,5,b>a?C.teal:C.danger,null,1);
      line(x+w*a/100,y-2,x+w*a/100,y+7,C.ink,1);ctx.beginPath();ctx.arc(x+w*b/100,y+2.5,3.1,0,Math.PI*2);ctx.fillStyle=color||C.teal;ctx.fill();
    }
    function drawDetailCards(title,cards,pad,onClose,concede,replayAction) {
      var top=desktopLayout?103:73,navY=height-(desktopLayout?54:42),navH=desktopLayout?42:32,gap=detailScale(6),available=navY-top-9,pages=[[]],used=0;
      cards.forEach(function(card){if(used&&used+card.height>available){pages.push([]);used=0;}pages[pages.length-1].push(card);used+=card.height+gap;});
      detailPage=Math.max(0,Math.min(pages.length-1,detailPage));
      text(title,pad,desktopLayout?70:49,14,C.ink,'600');
      button($t('返回操作'),width-pad-(desktopLayout?106:82),desktopLayout?52:35,desktopLayout?106:82,desktopLayout?38:29,onClose,{size:11,selected:true});
      if(replayAction)button(replayAction.label,width-pad-(desktopLayout?170:135),desktopLayout?52:35,desktopLayout?56:47,desktopLayout?38:29,replayAction.action,{size:11,disabled:replayAction.disabled});
      var cursor=top;pages[detailPage].forEach(function(card){card.paint(pad,cursor,width-pad*2);cursor+=card.height+gap;});
      var bw=concede?(width-pad*2-12)/3:(width-pad*2-72)/2;
      button($t('上一页'),pad,navY,bw,navH,function(){detailPage--;},{size:11,disabled:detailPage===0});
      button($t('下一页'),width-pad-bw,navY,bw,navH,function(){detailPage++;},{size:11,disabled:detailPage===pages.length-1});
      if(concede){button($t('放弃此球'),pad+bw+6,navY,bw,navH,function(){detailsOpen=false;act(function(){return match.concedePoint();});},{size:11});text((detailPage+1)+' / '+pages.length,width/2,navY-9,9,C.dim,'400','center');}
      else text((detailPage+1)+' / '+pages.length,width/2,navY+navH/2,11,C.muted,'400','center');
    }
    function drawCompactFootDetails(pad) {
      var p=footPreview,t=view.incoming.trajectory,a=FeedbackModel.buildAnticipationComparison(p,t.duration),cards=[],cw=width-pad*2;
      var contact=p.contact||{},metric=function(label,value,color,small){return{label:label,value:value,color:color,small:small};};
      cards.push(detailMetricCard([
        metric($t('路径用时'),p.totalTime.toFixed(2)+'s','#7ca8ff'),metric($t('截击时刻'),p.contactTime.toFixed(2)+'s',C.gold),metric($t('剩余时间'),p.remainingTime.toFixed(2)+'s',p.remainingTime>=0?C.teal:C.danger),
        metric($t('稳定度'),p.balanceBefore.toFixed(1)+'→'+p.balance.toFixed(1),'#b599f3',true),metric($t('体力'),p.staminaBefore.toFixed(1)+'→'+p.staminaAfter.toFixed(1),'#f4ba80',true),metric($t('实际触球高'),contact.height.toFixed(2)+'m',C.teal)
      ]));
      cards.push({height:detailScale(39),paint:function(x,y,w){
        var bar=FeedbackModel.buildTimeBar(p,t.duration),bx=x+8,bw=w-16,by=y+detailScale(22);
        box(x,y,w,this.height,C.panel,C.line,7);text($t('来球飞行 ')+t.duration.toFixed(2)+'s',bx,y+detailScale(11),10,C.ink);text($t('同色对应下方动作'),x+w-8,y+detailScale(11),9,C.muted,'400','right');
        box(bx,by,bw,7,'#293c4d',null,2);bar.segments.forEach(function(s){if(s.widthRatio>0)box(bx+bw*s.startRatio,by,bw*s.widthRatio,7,s.color,null,1);});
        if(Number.isFinite(bar.deadlineRatio))line(bx+bw*bar.deadlineRatio,by-3,bx+bw*bar.deadlineRatio,by+10,C.gold,1.5);
        if(bar.margin&&bar.margin.widthRatio>.15)text(bar.margin.seconds>=0?$t('余量'):$t('超时'),bx+bw*(bar.margin.startRatio+bar.margin.widthRatio/2),by+3.5,8,C.ink,'600','center');
      }});
      detailTextCards(cards,$t('截击状态'),[
        (contact.mode==='jump'?$t('跳跃击球'):contact.mode==='ground'?$t('地面击球'):$t('击球姿态待选'))+$t(' · 球速 ')+contact.speed.toFixed(1)+'m/s · '+flightTrend(Number(contact.verticalSpeed||0)),
        $t('伸拍 ')+p.reachDistance.toFixed(2)+$t('m · 准备 ')+p.preparationTime.toFixed(2)+$t('s · 耗力 ')+p.staminaCost.toFixed(1)
      ],C.teal,cw);
      var anticipation=[a.available?a.label:$t('预判对照不可比：')+a.reason,$t('预判差异已包含在路径用时内，不重复扣除。')];
      if(typeof p.opponentRecoveryDenied==='number')anticipation.push($t('比最晚合法截击少给对手回位 ')+p.opponentRecoveryDenied.toFixed(2)+$t('s。'));
      else anticipation.push($t('此点不可接，暂不比较对手回位。'));
      if(p.reason)anticipation.push(p.reason);
      detailTextCards(cards,$t('预判 → 用时 → 对手回动'),anticipation,C.gold,cw);
      (p.actions||footActions).forEach(function(id,index){
        var s=footResultAt(p,index),style={color:footActionColor(id,s)},previous=index?footResultAt(p,index-1):null,before=previous?previous.balance:p.balanceBefore;
        if(!s){detailTextCards(cards,(index+1)+' · '+footLabel(id),[$t('未计算到此步，无移动轨迹。')],C.muted,cw);return;}
        var notes=[];if(s.combo)notes.push($t('连携 ')+s.combo.label+$t('：')+s.combo.description);
        if(s.anticipationOutcome==='wrong'&&Number.isFinite(s.anticipationPenaltySeconds))notes.push($t('预判失误 +')+s.anticipationPenaltySeconds.toFixed(3)+$t('s 已计入；中性启动 ')+s.baselineDuration.toFixed(3)+$t('s。'));
        if(s.reason)notes.push(s.reason);
        var notesWrapped=detailLines(notes,cw-20,10),maxNotes=Math.max(0,Math.floor((detailAvailableHeight()/detailScale(1)-74)/14)),extraNotes=notesWrapped.slice(maxNotes);notesWrapped=notesWrapped.slice(0,maxNotes);
        cards.push({height:detailScale(74+notesWrapped.length*14),paint:function(x,y,w){
          box(x,y,w,this.height,C.panel,C.line,7);box(x,y+7,3,this.height-14,style.color,null,1);
          box(x+8,y+detailScale(7),detailScale(18),detailScale(18),style.color,null,5);text(index+1,x+8+detailScale(9),y+detailScale(16),10,C.bg,'700','center');
          text(s.label,x+13+detailScale(18),y+detailScale(16),11,C.ink,'600');text(footStatusText(s),x+w-9,y+detailScale(16),9,s.executionStatus==='completed'?C.muted:C.danger,'400','right');
          var values=[[$t('用时 ')+s.duration.toFixed(2)+'s','#7ca8ff'],[$t('耗力 −')+s.staminaCost.toFixed(1),'#f4ba80'],[$t('位移 ')+s.distance.toFixed(2)+'m',style.color]],pw=(w-24)/3;
          values.forEach(function(value,i){var px=x+8+i*(pw+4);box(px,y+detailScale(29),pw,detailScale(16),'#1b3042',null,3);text(value[0],px+pw/2,y+detailScale(37),9,value[1],'500','center');});
          text($t('稳定 ')+before.toFixed(1)+' → '+s.balance.toFixed(1),x+9,y+detailScale(53),9,'#cfb7f5');
          var gaugeX=x+detailScale(122),gaugeW=Math.max(30,w-detailScale(179));detailStateBar(gaugeX,y+detailScale(50),gaugeW,before,s.balance,'#b599f3');
          text((s.balance-before>=0?'+':'')+(s.balance-before).toFixed(1),x+w-9,y+detailScale(53),10,s.balance>=before?C.teal:C.danger,'600','right');
          text($t('累计 ')+s.cumulativeTime.toFixed(2)+$t('s · 净接近 ')+(s.progress>=0?'+':'')+s.progress.toFixed(2)+'m'+(s.distance<1e-8?$t(' · 原地'):''),x+9,y+detailScale(65),9,C.muted);
          notesWrapped.forEach(function(ln,i){text(ln,x+9,y+detailScale(79+i*14),10,s.combo?C.gold:C.danger);});
        }});
        if(extraNotes.length)detailTextCards(cards,(index+1)+' · '+s.label+$t(' · 衔接与原因'),extraNotes,s.combo?C.gold:C.danger,cw);
      });
      detailTextCards(cards,$t('来球参数'),[
        $t('初速 ')+t.initialSpeed.toFixed(1)+$t('m/s · 弧顶 ')+t.apex.toFixed(2)+$t('m · 垂速 ')+Number(contact.verticalSpeed||0).toFixed(2)+'m/s',
        $t('过网余高 ')+(t.netClearance===null?'—':t.netClearance.toFixed(2)+'m')+' · '+(t.terminal==='net'?$t('触网'):$t('落地'))+' '+t.duration.toFixed(2)+'s'
      ],'#7ca8ff',cw);
      var recovery=[];appendRecoveryDetails(recovery,revealedRecovery('ai'),$t('对手'));detailTextCards(cards,$t('对手回动'),recovery,C.aiRecovery,cw);
      detailTextCards(cards,$t('图形阅读'),[
        $t('彩色实线为真实跑动；细虚线只连接端点和序号。实心序号已完成；空心红号中断或超时；灰号未计算。'),
        $t('金色“连”和序号金点表示连携。稳定条统一为 0–100：白线是动作前，圆点是动作后，绿段增加、红段减少。')
      ],C.muted,cw);
      var windows=view.footwork&&view.footwork.contactWindows||[],concede=windows.length&&windows.every(function(w){return!w.available;});
      if(concede)detailTextCards(cards,$t('路径提示'),[$t('自动搜索未找到路径，仍可手动尝试；当前路径无效不代表整拍无解。')],C.danger,cw);
      drawDetailCards($t('逐步明细'),cards,pad,function(){detailsOpen=false;lastTick=Date.now();},concede,{label:$t('预演'),disabled:!footActions.length,action:function(){beginReplay(footPreview,view.incoming.trajectory,$t('路径预演'));}});
    }
    function drawCompactShotDetails(pad) {
      var p=shotPreview,t=p&&p.trajectory,current=shotScan&&shotScan.current,cards=[],cw=width-pad*2,cap=p&&p.powerLimit,risk=p&&p.risk;
      if(p){
        cards.push(detailMetricCard([
          {label:$t('身体匹配'),value:(p.stateFit*100).toFixed(1)+'%',color:C.teal},{label:$t('混合熟练'),value:p.proficiency.toFixed(1),color:'#b599f3'},{label:$t('击球耗力'),value:'−'+p.staminaCost.toFixed(2),color:'#f4ba80'},
          {label:$t('发力上限'),value:cap?(cap.maxPower*100).toFixed(1)+'%':'—',color:'#7ca8ff'},{label:$t('模拟失误'),value:risk?(risk.estimate*100).toFixed(1)+'%':'—',color:C.danger},{label:$t('飞行总时'),value:t?t.duration.toFixed(2)+'s':'—',color:C.gold}
        ]));
        if(cap)cards.push({height:detailScale(43),paint:function(x,y,w){
          var bx=x+9,bw=w-18,by=y+detailScale(26),value=Number(controls&&controls.power||0),max=Math.max(0,Math.min(1,cap.maxPower));
          box(x,y,w,this.height,C.panel,C.line,7);text($t('发力 ')+(value*100).toFixed(1)+$t('% → 上限 ')+(max*100).toFixed(1)+'%',bx,y+detailScale(12),10,'#7ca8ff');
          box(bx,by,bw,7,'#293c4d',null,2);box(bx,by,bw*max,7,'#345f7e',null,2);box(bx,by,bw*Math.min(value,max),7,'#7ca8ff',null,2);line(bx+bw*max,by-3,bx+bw*max,by+10,C.ink,1.3);
        }});
        var concise=[];
        if(t)concise.push($t('初速 ')+t.initialSpeed.toFixed(1)+$t('m/s · 弧顶 ')+t.apex.toFixed(2)+'m');
        if(t&&controls)concise.push($t('目标距网 ')+(controls.target.y*G.halfLength).toFixed(2)+$t('m → 实算落点距网 ')+(t.freeLanding.y*G.halfLength).toFixed(2)+$t('m；过网前落地、出界或发球区限制仍按实际轨迹判定。'));
        if(manualShotAngle)concise.push($t('已保留手调角度；点击对方落点可重新配力。只抬高角度不自动增加力度，实际落点可能变短。'));
        if(p.warning)concise.push(p.warning);
        if(cap)concise.push($t('上限原因：')+(cap.reasons&&cap.reasons.length?cap.reasons.join($t('；')):$t('当前状态允许充分发力')));
        detailTextCards(cards,$t('当前击球'),concise,'#7ca8ff',cw);
      }
      var factorItems=shotScan&&shotScan.factors&&shotScan.factors.items||[],factorRange=5;
      factorItems.forEach(function(item){['fitDelta','maxPowerDelta','riskDelta'].forEach(function(key){if(Number.isFinite(item[key]))factorRange=Math.max(factorRange,Math.ceil(Math.abs(item[key])*100/5)*5);});});
      detailTextCards(cards,$t('状态变化如何影响击球'),[$t('逐项替换为参考值，其余条件不变。差值 = 参考状态 − 当前状态，不能相加。'),$t('条带统一为 −')+factorRange+$t(' 至 +')+factorRange+$t(' 个百分点，中央为 0。')],C.gold,cw);
      factorItems.forEach(function(item){
        var label=item.id==='height'?$t('触球高度'):item.id==='stamina'?$t('体力'):item.id==='preparation'?$t('准备时间'):$t('稳定度'),unit=item.unit==='m'?'m':item.unit==='s'?'s':'',values=[{label:$t('匹配'),value:item.fitDelta*100,good:true,color:C.teal}];
        if(Number.isFinite(item.maxPowerDelta))values.push({label:$t('发力上限'),value:item.maxPowerDelta*100,good:true,color:'#7ca8ff'});
        if(Number.isFinite(item.riskDelta))values.push({label:$t('失误估计'),value:item.riskDelta*100,good:false,color:C.danger});
        cards.push({height:detailScale(30+values.length*18),paint:function(x,y,w){
          box(x,y,w,this.height,C.panel,C.line,7);box(x,y+7,3,this.height-14,C.gold,null,1);
          text(label,x+10,y+detailScale(13),11,C.gold,'600');text(Number(item.actualValue).toFixed(unit?2:1)+unit+' → '+item.referenceValue+unit,x+w-10,y+detailScale(13),10,C.ink,'400','right');
          var bx=x+detailScale(70),bw=Math.max(60,w-detailScale(138)),mid=bx+bw/2;
          values.forEach(function(value,i){var sy=y+detailScale(34+i*18),f=Math.max(-1,Math.min(1,value.value/factorRange)),positive=value.value>=0,color=positive===value.good?value.color:C.gold;
            text(value.label,x+10,sy,9,C.muted);box(bx,sy-2.5,bw,5,'#293c4d',null,2);line(mid,sy-5,mid,sy+5,C.muted,1);if(f)box(mid+(f<0?f*bw/2:0),sy-2.5,Math.abs(f)*bw/2,5,color,null,1);
            text((positive?'+':'')+value.value.toFixed(1)+$t('点'),x+w-10,sy,10,color,'600','right');
          });
        }});
      });
      if(cap){var jumpContact=trialOpen?footPreview&&footPreview.contact&&footPreview.contact.mode==='jump':view.shotContext&&view.shotContext.contactMode==='jump';
        detailTextCards(cards,$t('准备时间 → 发力上限'),jumpContact?[
          $t('可用准备 ')+cap.availablePreparation.toFixed(3)+$t('s，来自起跳前地面蓄势。余量 ')+cap.remainingTime.toFixed(2)+$t('s 在起跳前等待，不计入发力准备。')
        ]:[$t('可用准备 ')+cap.availablePreparation.toFixed(2)+$t('s；停稳准备 ')+cap.stancePreparationTime.toFixed(2)+$t('s、余量 ')+cap.remainingTime.toFixed(2)+$t('s。')],C.teal,cw);
      }
      var accuracy=p&&p.contactAccuracy;if(accuracy)detailTextCards(cards,$t('球速 → 触球命中率'),[
        $t('截击 ')+accuracy.speed.toFixed(1)+$t(' m/s · 命中 ')+(accuracy.hitProbability*100).toFixed(1)+$t('% · 挥空 ')+(accuracy.missProbability*100).toFixed(1)+$t('%。'),
        $t('命中率 = 1 ÷ [1 + (球速 ÷ 60)²]；游戏平衡曲线，非赛事统计。命中不保证过网、界内或得分。')
      ],C.teal,cw);
      if(risk)detailTextCards(cards,$t('失误估计与范围'),[
        $t('总失误 ')+(risk.estimate*100).toFixed(1)+$t('% · 区间 ')+(risk.lower*100).toFixed(1)+'–'+(risk.upper*100).toFixed(1)+$t('%：挥空概率与 ')+risk.sampleCount+$t(' 次命中后弹道采样合并。'),
        $t('含挥空、触网、未过网和出界，不含发球站位或高度违例。挥空判定只进行一次；命中后的误差仍由熟练度与状态决定。')
      ],C.danger,cw);
      var envelope=p&&p.landingEnvelope;if(envelope)detailTextCards(cards,$t('稳定度 → 落点范围'),[
        envelope.drawable?$t('横向 ±')+envelope.radiusAcrossMeters.toFixed(2)+$t('m · 深度 ±')+envelope.radiusDepthMeters.toFixed(2)+'m':$t('预计触网，不绘制假想落点范围。'),
        $t('参考圈是发射误差的局部 2σ 近似，随稳定度与熟练度变化；不是保证范围或 95% 入场率。')
      ],'#b599f3',cw);else if(p&&p.dispersion)detailTextCards(cards,$t('落点散布'),[$t('横向 ')+(p.dispersion.x*G.halfWidth).toFixed(2)+$t('m · 深度 ')+(p.dispersion.y*G.halfLength).toFixed(2)+'m'],C.teal,cw);
      detailTextCards(cards,$t('分色与读数'),[$t('顺手 / 吃力 / 高负担：固定另一参数逐段估计身体适配，不保证入场。细红带表示预计触网、未过网或出界。因素条向右增加、向左减少，所有因素共用 ±')+factorRange+$t(' 个百分点刻度。')],C.muted,cw);
      if(view.energyReceipt)detailTextCards(cards,$t('体力结算'),[receiptText(view.energyReceipt)],'#f4ba80',cw);
      var target=selectedRecoveryTarget(),origin=recoveryOrigin(),recovery=[$t('目标距当前位置 ')+Math.hypot((target.x-origin.x)*G.halfWidth,(target.y-origin.y)*G.halfLength).toFixed(2)+$t('m；回动是意图，实际距离由对手截击时刻决定。')];
      appendRecoveryDetails(recovery,recoveryPreview,$t('本方'));detailTextCards(cards,$t('本方回动'),recovery,C.recovery,cw);
      var other=[];appendRecoveryDetails(other,revealedRecovery('ai'),$t('对手'));detailTextCards(cards,$t('对手回动'),other,C.aiRecovery,cw);
      drawDetailCards($t('状态详情'),cards,pad,function(){shotFactorsOpen=false;lastTick=Date.now();},false,lastReplay&&view.phase==='shot'?{label:$t('回放'),action:function(){shotFactorsOpen=false;beginReplay(lastReplay.plan,lastReplay.trajectory,$t('步伐回放'),lastReplay.players);}}:null);
    }
    function drawCompactTraining(pad) {
      var training=view.training||{skills:[],points:0};text($t('训练点 ')+training.points,pad,desktopLayout?70:50,16,C.ink,'600');
      var rh=Math.min(desktopLayout?101:51,(height-130)/4);
      (training.skills||[]).forEach(function(s,i){var y=(desktopLayout?108:78)+i*rh;box(pad,y,width-pad*2,rh-6,C.panel,C.line,8);text(s.label+' '+Math.round(s.value),pad+10,y+(rh-6)/2,12,C.ink);button($t('＋训练'),width-pad-(desktopLayout?100:74),y+3,desktopLayout?93:67,rh-12,function(){act(function(){return match.trainSkill(s.id);});},{disabled:!s.canUpgrade||!training.canTrain,size:11});});
      button($t('完成训练 · 返回球场'),pad,height-(desktopLayout?62:43),width-pad*2,desktopLayout?50:36,function(){trainingOpen=false;lastTick=Date.now();},{primary:true,size:12});
    }
    function drawCompactRight(scene,pad) {
      if(scene==='training'){drawCompactTraining(pad);return;}
      if(scene==='details'){drawCompactFootDetails(pad);return;}
      if(shotFactorsOpen&&(scene==='shot'||scene==='trial'||scene==='serve')){drawCompactShotDetails(pad);return;}
      if(scene==='route'){drawCompactRoutes(pad);return;}
      if(scene==='shot'||scene==='trial'){drawCompactShot(pad,scene==='trial',false);return;}
      if(scene==='serve'){
        if(view.service.server==='human')drawCompactShot(pad,false,true);
        else{text($t('对手发球'),pad,58,19,C.ink,'600');wrap($t('在左侧本方区域选择接发站位。'),pad,95,width-pad*2,13,C.muted,3,20);wrap($t('确认后先预判，来球随后揭晓。'),pad,153,width-pad*2,12,C.gold,3,19);button($t('站位确定 · 进入预判'),pad,height-43,width-pad*2,36,function(){act(function(){return match.confirmReceive({receiverPosition:receivePosition});});},{primary:true,size:12});}return;
      }
      if(scene==='predict'){drawPredict(desktopLayout?127:77,pad,260);if(desktopLayout)wrap($t('方向与左侧球场一致。提前启动的收益更大，预判失误会增加二次启动用时。'),pad,479,width-pad*2,13,C.muted,3,23);return;}
      if(scene==='toss'){var toss=view.toss||{},choices=toss.availableChoices||[],names={serve:$t('选择先发球'),receive:$t('选择先接球'),near:$t('选择近端场地'),far:$t('选择远端场地')};
        text(toss.winner==='human'?$t('你赢得掷签'):$t('对手先发，请选场地'),pad,desktopLayout?79:50,16,C.ink,'600');
        var bh=Math.min(desktopLayout?66:44,(height-87-choices.length*8)/Math.max(1,choices.length));choices.forEach(function(choice,i){button(names[choice],pad,(desktopLayout?137:76)+i*(bh+(desktopLayout?20:8)),width-pad*2,bh,function(){act(function(){return match.chooseToss(choice);});},{primary:i===0,size:13});});return;}
      if(scene==='replay'){var time=currentReplayTime(),b=sampleAt(replay.plan.bodyPath,time)||replay.plan.finalState;text(replay.mode,pad,57,19,C.ink,'600');text(time.toFixed(2)+' / '+replay.duration.toFixed(2)+'s',pad,91,14,C.teal);text($t('回放稳定度 ')+b.balance.toFixed(1),pad,136,13,C.muted);text($t('回放体力 ')+b.stamina.toFixed(1),pad,164,13,C.muted);button($t('跳过回放'),pad,height-43,width-pad*2,36,function(){endReplay();},{primary:true});return;}
      drawEnd(desktopLayout?131:46,pad,240);
    }
    function drawTimingPicker() {
      var compact=height<300,w=Math.min(720,width-32),h=Math.min(308,height-(compact?16:24)),x=(width-w)/2,y=(height-h)/2,gap=14,cw=(w-gap)/2,cy=y+(compact?49:70),ch=h-(compact?82:116);
      text($t('选择本局节奏'),x,y+(compact?16:20),compact?21:24,C.ink,'700');
      text($t('场内跑动与球飞行时间照常计算，只改变你的思考时限。'),x,y+(compact?36:49),compact?10:11,C.muted);
      if(view.training&&view.training.canTrain)button($t('局外训练'),x+w-82,y+3,82,29,function(){trainingOpen=true;},{size:11});
      box(x,cy,cw,ch,C.panel,'#315c54',12);box(x+cw+gap,cy,cw,ch,C.panel,'#655d42',12);
      text($t('慢慢规划'),x+16,cy+(compact?19:24),17,C.teal,'600');
      text($t('无限思考时间，自由尝试动作组合。'),x+16,cy+(compact?44:52),11,C.muted);
      if(!compact)text($t('适合熟悉步伐、曲线与身体状态。'),x+16,cy+74,11,C.muted);
      text($t('每一拍都由你主动确认。'),x+16,cy+(compact?63:96),11,C.muted);
      var tx=x+cw+gap;
      text($t('限时挑战'),tx+16,cy+(compact?19:24),17,C.gold,'600');
      text($t('掷签 15秒 · 发球 / 接发 20秒'),tx+16,cy+(compact?44:51),11,C.muted);
      text($t('预判 8秒 · 步伐 25秒 · 击球 20秒'),tx+16,cy+(compact?63:73),11,C.muted);
      if(!compact)text($t('试算和详情占用当前阶段时间。'),tx+16,cy+95,11,C.muted);
      button($t('不限时间'),x+12,cy+ch-43,cw-24,34,function(){chooseTimingMode('untimed');},{primary:true,size:13});
      button($t('限时模式'),tx+12,cy+ch-43,cw-24,34,function(){chooseTimingMode('timed');},{size:13});
      text($t('限时超时：对抗阶段对手得分；掷签阶段自动选择。'),x,y+h-25,11,C.gold);
      text(compact?$t('试算 / 详情继续计时 · 回放不计时 · 切后台暂停'):$t('回放和结算不计时 · 切到后台暂停，返回后点击继续。'),x,y+h-7,10,C.muted);
    }
    function drawDecisionHeader(scene) {
      var showHelp=view.phase==='route'&&!trainingOpen&&!replay,compactRoute=showHelp&&!desktopLayout;
      var timerW=desktopLayout?118:compactRoute?(rightWidth<290?76:86):93,timerX=rightX+rightWidth-timerW-(compactRoute?8:12);
      var title=scene==='trial'?$t('击球试算'):scene==='details'?$t('路径明细'):scene==='training'?$t('局外训练'):scene==='replay'?$t('动作回放'):PHASES[view.phase]||view.phase;
      if(compactRoute&&rightWidth<240&&scene==='route')title=$t('选步');
      var titleSize=desktopLayout?14:compactRoute?11:12;text(title,rightX+12,18,titleSize,C.ink,'600');
      ctx.font='600 '+fontSize(titleSize)+'px '+FONT;var helpX=Math.max(rightX+(desktopLayout?88:rightWidth<240?39:60),rightX+12+ctx.measureText(title).width+8);
      if(showHelp)button($t('说明'),helpX,4,desktopLayout?44:32,desktopLayout?33:29,function(){openFootworkHelp(false);},{size:11,selected:footHelpOpen});
      var held=paused||trainingOpen||detailsOpen||trialOpen||shotFactorsOpen||!!replay||!!dragging||!!reasonDialog||concedeOpen||footHelpOpen;
      if(timingMode==='practice')button(held?$t('练习暂停'):$t('思考 ')+remaining.toFixed(1)+'s',timerX,4,timerW,desktopLayout?33:29,function(){togglePause();},{size:11,selected:!held});
      else{
        var label=timingMode===null?$t('等待开始'):timingMode==='untimed'?$t('不限时间'):systemPaused?$t('已暂停'):replay?$t('回放暂停'):footHelpOpen&&footHelpAutomatic?$t('教学暂停'):!decisionActive()?$t('已结算'):$t('剩余 ')+remaining.toFixed(1)+'s';
        var urgent=timingMode==='timed'&&decisionActive()&&!systemPaused&&!replay&&!(footHelpOpen&&footHelpAutomatic)&&remaining<=5;
        box(timerX,4,timerW,desktopLayout?33:29,C.panel,urgent?C.danger:C.line,7);
        text(label,timerX+timerW/2,desktopLayout?20.5:18.5,11,urgent?C.danger:C.teal,'600','center');
        if(timingMode==='timed'&&decisionActive())box(timerX+4,desktopLayout?34:30,(timerW-8)*Math.max(0,remaining/phaseBudget()),2,urgent?C.danger:C.teal,null,1);
      }
      if(!trainingOpen&&!replay&&['predict','route','shot'].indexOf(view.phase)!==-1){
        var concedeW=desktopLayout?94:compactRoute?(rightWidth<240?48:rightWidth<290?58:68):76;
        button(compactRoute&&rightWidth<240?$t('放弃'):$t('放弃回球'),timerX-concedeW-(compactRoute?5:desktopLayout?8:7),4,concedeW,desktopLayout?33:29,function(){concedeOpen=true;dragging=null;},{size:11,danger:true});
      }
    }
    function drawFootworkHelp() {
      var guide=view.footwork&&view.footwork.guide;if(!guide){closeFootworkHelp();return;}
      ctx.fillStyle='rgba(3,10,18,.68)';ctx.fillRect(0,0,layoutWidth,height);
      regions=[{x:0,y:0,w:layoutWidth,h:height,label:$t('步伐说明遮罩'),action:function(){}}];
      var w=Math.min(820,layoutWidth-64),h=Math.min(desktopLayout?544:438,height-48),x=(layoutWidth-w)/2,y=(height-h)/2;
      var proseSize=desktopLayout?13:12,leading=desktopLayout?18:17,smallSize=desktopLayout?11.5:10.5;
      var groundColor='#68b999',jumpColor='#a9e7c8',violet='#bea6f4',blue='#8db5ff';
      // Every paragraph is measured before layout. The scroll viewport is the
      // only clipping boundary; no action or combo explanation is truncated.
      function helpLines(value,maxWidth,size,weight){
        ctx.font=(weight||'400')+' '+size+'px '+FONT;var lines=[],current='';if($lang==='en')return $lines(function(v){return ctx.measureText(v).width;},value,maxWidth);
        Array.from(String(value||'')).forEach(function(character){
          if(character==='\n'){lines.push(current);current='';}
          else if(current&&ctx.measureText(current+character).width>maxWidth){
            if(/[，。；：！？、）》」』]/.test(character)&&current.length>1){var carry=Array.from(current);current=carry.pop()+character;lines.push(carry.join(''));}
            else{lines.push(current);current=character;}
          }
          else current+=character;
        });if(current)lines.push(current);return lines;
      }
      function helpText(lines,tx,ty,size,color,weight,lineHeight){
        lines.forEach(function(value,index){text(value,tx,ty+index*lineHeight,size,color,weight||'400','left',true);});
      }
      var timingText=footHelpAutomatic?$t('教学暂停计时 · 关闭后继续'):timingMode==='timed'?$t('查看时继续计时 · 剩余 ')+remaining.toFixed(1)+$t(' 秒'):$t('自由查看 · 已选路径保持不变');
      var timingLines=helpLines(timingText,w-100,11),headerH=50,footerH=35;
      var bodyY=y+headerH,bodyH=h-headerH-footerH,bodyX=x+14,bodyW=w-38,footerY=y+h-footerH;
      if(footHelpViewport&&(footHelpViewport.w!==bodyW||footHelpViewport.h!==bodyH)&&dragging&&/^help/.test(dragging.kind))dragging=null;
      footHelpViewport={x:bodyX,y:bodyY,w:bodyW,h:bodyH};
      var blocks=[],contentH=6,actionLabels={};(guide.actions||[]).forEach(function(action){actionLabels[action.id]=action.id==='ground'?$t('地面击球'):action.label;});
      function addBlock(block){block.top=contentH;blocks.push(block);contentH+=block.height;}
      function section(number,title,color,subtitle){
        var titleSize=desktopLayout?15:14,titleLeading=desktopLayout?21:19,headings=helpLines(title,bodyW-33,titleSize,'600');
        var titleExtra=Math.max(0,headings.length-1)*titleLeading,lines=subtitle?helpLines(subtitle,bodyW-8,proseSize):[];
        addBlock({height:30+titleExtra+lines.length*leading,draw:function(tx,ty){
          box(tx,ty+3,24,21,color,null,6);text(number,tx+12,ty+13.5,10.5,'#102b2b','700','center',true);
          helpText(headings,tx+33,ty+14,titleSize,C.ink,'600',titleLeading);
          helpText(lines,tx+2,ty+34+titleExtra,proseSize,C.muted,'400',leading);
        }});
      }
      function paragraph(value,color,fill){
        var lines=helpLines(value,bodyW-22,proseSize),ph=lines.length*leading+14;
        addBlock({height:ph+7,draw:function(tx,ty){box(tx,ty,bodyW,ph,fill||'#142a30',null,7);helpText(lines,tx+11,ty+15,proseSize,color||C.muted,'400',leading);}});
      }
      section('01',$t('先选在哪里截击'),C.teal);
      paragraph($t('点场地来球线或抛物线，也可拖动截击条选击球位置；余量、球高与身体状态同步更新。'),C.ink,'#17343a');
      var legendLabels=[$t('绿色：身高允许范围'),$t('浅绿：选中跳跃后增加的范围')],legendCols=bodyW>=440?2:1;
      var legendW=bodyW/legendCols,legendLines=legendLabels.map(function(value){return helpLines(value,legendW-42,proseSize);});
      var legendH=14+(legendCols===2?Math.max(legendLines[0].length,legendLines[1].length):legendLines[0].length+legendLines[1].length)*leading;
      addBlock({height:legendH+7,draw:function(tx,ty){
        box(tx,ty,bodyW,legendH,'#122c2c','#315a50',7);var ly=ty+15;
        legendLines.forEach(function(lines,index){var lx=tx+(legendCols===2?index*legendW:0);box(lx+11,ly-5,14,9,index?jumpColor:groundColor,null,3);helpText(lines,lx+33,ly,proseSize,index?jumpColor:groundColor,'500',leading);if(legendCols===1)ly+=lines.length*leading;});
      }});
      paragraph($t('默认显示地面触及范围；选中「跳跃击球」才显示高度补偿。高度允许，还要赶得上：移动与姿态需要时间；挥拍不再额外扣时。'),C.gold,'#2b2b25');
      section('02',$t('启动与挥拍必选，移动按需'),blue);
      var stages=[{name:$t('调整启动'),detail:$t('第一行 · 必选'),color:'#9aafc8'},
        {name:$t('选择移动'),detail:$t('第二行 · 可跳过'),color:FeedbackModel.ACTION_STYLES.shuffle.color},
        {name:$t('地面 / 空中'),detail:$t('第三行 · 二选一'),color:violet},
        {name:$t('挥拍'),detail:$t('第四行 · 必选 · 0秒'),color:FeedbackModel.ACTION_STYLES.ready.color}];
      var flowHorizontal=bodyW>=430,flowGap=16,stageH=48,stageW=flowHorizontal?(bodyW-flowGap*3)/4:bodyW;
      addBlock({height:flowHorizontal?stageH+7:stages.length*(stageH+16),draw:function(tx,ty){
        stages.forEach(function(stage,index){var sx=tx+(flowHorizontal?index*(stageW+flowGap):0),sy=ty+(flowHorizontal?0:index*(stageH+16));
          box(sx,sy,stageW,stageH,'#172c3e',stage.color,7);
          text((index+1)+' '+stage.name,sx+stageW/2,sy+16,flowHorizontal?12:13,stage.color,'600','center',true);
          text(stage.detail,sx+stageW/2,sy+34,smallSize,C.muted,'400','center',true);
          if(index<stages.length-1){var ax=flowHorizontal?sx+stageW+flowGap/2:sx+stageW/2,ay=flowHorizontal?sy+stageH/2:sy+stageH+8;
            if(flowHorizontal){line(ax-6,ay,ax+6,ay,stage.color,2);line(ax+6,ay,ax+2,ay-4,stage.color,2);line(ax+6,ay,ax+2,ay+4,stage.color,2);}
            else{line(ax,ay-5,ax,ay+5,stage.color,2);line(ax,ay+5,ax-4,ay+1,stage.color,2);line(ax,ay+5,ax+4,ay+1,stage.color,2);}
          }
        });
      }});
      paragraph($t('启动 → 按需移动（可跳过或连选）→ 地面击球／跳跃击球（二选一）→ 挥拍。球在触及范围内且身体停稳时，可直接选第三行；仍要满足高度、时间和体力。'),C.ink);
      paragraph($t('进页即显示首步预判：绿色正确、红色错误、灰蓝中性；浅色时间段为待选启动预占，点击后计入路径。变化秒数来自真实启动对照；正确预判也可能只带来提前位移优势。'),C.muted,'#172c3e');
      paragraph($t('挥拍框实时显示截击球速与触球命中率。球越快，越难击中：10 m/s 约97%、20 m/s 约90%、30 m/s 约80%。移动截击点可比较速度与命中率；命中后仍需过网并落在界内。'),C.ink,'#17343a');
      paragraph($t('挥拍是0秒的必选终点，点击只完成路径；确认击球时双方按同一球速曲线判定一次。发球不作接来球判定，稳定度、准备余量和体力继续影响回球质量。'),C.muted);
      section('03',$t('动作特色'),C.teal);
      var cols=bodyW>=440?2:1,gap=7,cardW=(bodyW-gap*(cols-1))/cols;
      function addActionRows(entries){
        entries.forEach(function(entry){
          var style=FeedbackModel.ACTION_STYLES[entry.id],accent=style?style.color:entry.id==='jump'?jumpColor:groundColor;
          var label=entry.id==='ground'?$t('地面击球'):entry.label,labelW=desktopLayout?102:88;
          var lines=helpLines(entry.summary||entry.description,bodyW-labelW-21,proseSize),rowH=Math.max(32,lines.length*leading+12);
          addBlock({height:rowH+5,draw:function(tx,ty){
            box(tx,ty,bodyW,rowH,'#172b3c','#2c4353',7);box(tx,ty,labelW,rowH,'#203749',null,7);
            box(tx+2,ty+7,3,rowH-14,accent,null,2);text(label,tx+labelW/2,ty+rowH/2,proseSize,accent,'600','center',true);
            helpText(lines,tx+labelW+10,ty+rowH/2-(lines.length-1)*leading/2,proseSize,C.muted,'400',leading);
          }});
        });
      }
      function addCards(entries,isCombo){
        for(var index=0;index<entries.length;index+=cols){
          var cards=entries.slice(index,index+cols).map(function(entry){
            var style=FeedbackModel.ACTION_STYLES[entry.id],accent=isCombo?C.gold:style?style.color:entry.id==='jump'?jumpColor:groundColor;
            var heading=helpLines(entry.label,cardW-22,desktopLayout?14:13,'600');
            var sequence=entry.sequence&&entry.sequence.length?helpLines(entry.sequence.map(function(id){return actionLabels[id]||id;}).join(' → '),cardW-22,smallSize,'600'):[];
            var summary=helpLines(entry.summary||entry.description,cardW-22,proseSize);
            return{entry:entry,accent:accent,heading:heading,sequence:sequence,summary:summary,height:14+heading.length*leading+sequence.length*leading+summary.length*leading+5};
          });
          (function(rowCards){var rowH=Math.max.apply(null,rowCards.map(function(card){return card.height;}));
            addBlock({height:rowH+gap,draw:function(tx,ty){rowCards.forEach(function(card,column){var cx=tx+column*(cardW+gap);
              box(cx,ty,cardW,rowH,isCombo?'#242c37':'#172b3c',isCombo?'#625337':'#314a5c',7);box(cx+1,ty+8,3,rowH-16,card.accent,null,2);
              var cy=ty+15;helpText(card.heading,cx+11,cy,desktopLayout?14:13,card.accent,'600',leading);cy+=card.heading.length*leading;
              if(card.sequence.length){helpText(card.sequence,cx+11,cy,smallSize,'#f7de9e','600',leading);cy+=card.sequence.length*leading;}
              helpText(card.summary,cx+11,cy,proseSize,C.muted,'400',leading);
            });}});
          })(cards);
        }
      }
      addActionRows(guide.actions||[]);
      section('04',$t('地面击球，还是跳跃击球？'),jumpColor);
      var limits=view.footwork.contactHeightLimits||{};
      var groundMin=Number.isFinite(limits.groundMin)?limits.groundMin:.28,groundMax=Number.isFinite(limits.groundMax)?limits.groundMax:2.95;
      var jumpMin=Number.isFinite(limits.jumpMin)?limits.jumpMin:.73,jumpMax=Number.isFinite(limits.jumpMax)?limits.jumpMax:3.40;
      var compensation=Number.isFinite(limits.jumpBoost)?limits.jumpBoost:Math.max(0,jumpMax-groundMax);
      paragraph($t('两种姿态都不增加水平距离。地面击球：整理支撑、提高稳定，范围 ')+groundMin.toFixed(2)+'–'+groundMax.toFixed(2)+$t(' 米；跳跃击球：多花时间和体力换高度，上移 ')+compensation.toFixed(2)+$t(' 米，范围 ')+jumpMin.toFixed(2)+'–'+jumpMax.toFixed(2)+$t(' 米。'),C.ink,'#17352f');
      paragraph($t('跳跃补偿提高人的触及范围，来球高度不变。小跳偷距已包含起落，之后仍要选第三行姿态。'),jumpColor,'#142e2d');
      section('05',$t('顺序不同，衔接也不同'),C.gold);
      addCards(guide.combos||[],true);
      if(guide.note)paragraph(guide.note,C.gold,'#2b2b25');
      paragraph($t('满足连携条件，效果会计入节点数值。先定截击位置 → 比路径与余量 → 选姿态 → 挥拍；「选择步伐」旁可随时打开说明。'),C.teal,'#17343a');
      contentH+=4;footHelpMaxScroll=Math.max(0,contentH-bodyH);footHelpScroll=Math.max(0,Math.min(footHelpMaxScroll,footHelpScroll));
      box(x,y,w,h,C.panel,'#426d69',13);
      // Header and footer remain fixed while only the explanation scrolls.
      ctx.save();ctx.beginPath();ctx.rect(bodyX-2,bodyY,bodyW+4,bodyH);ctx.clip();
      blocks.forEach(function(block){if(block.top+block.height>=footHelpScroll&&block.top<=footHelpScroll+bodyH)block.draw(bodyX,bodyY+block.top-footHelpScroll);});ctx.restore();
      regions.push({x:bodyX-4,y:bodyY,w:bodyW+8,h:bodyH,label:$t('上下滑动步伐说明'),action:function(point){dragging={kind:'helpScroll',startY:point.y,startScroll:footHelpScroll};}});
      var trackX=x+w-17,trackY=bodyY+4,trackH=bodyH-8,thumbH=Math.min(trackH,Math.max(28,trackH*bodyH/Math.max(bodyH,contentH)));
      if(footHelpMaxScroll>0){
        box(trackX,trackY,4,trackH,'#213849',null,2);
        box(trackX-1,trackY+(trackH-thumbH)*footHelpScroll/footHelpMaxScroll,6,thumbH,'#6caba1',null,3);
        regions.push({x:trackX-8,y:trackY,w:20,h:trackH,label:$t('拖动说明滚动条'),action:function(point){
          footHelpScroll=Math.max(0,Math.min(footHelpMaxScroll,(point.y-trackY-thumbH/2)/Math.max(1,trackH-thumbH)*footHelpMaxScroll));
          dragging={kind:'helpScrollbar',startY:point.y,startScroll:footHelpScroll,trackTravel:Math.max(1,trackH-thumbH)};
        }});
      }
      line(x+16,bodyY-1,x+w-16,bodyY-1,'#2e4b56',1);line(x+16,footerY,x+w-16,footerY,'#2e4b56',1);
      text(guide.title||$t('步伐特色与组合'),x+14,y+18,w<400?14:16,C.ink,'600','left',true);
      helpText(timingLines,x+14,y+37,11,footHelpAutomatic?C.teal:timingMode==='timed'?C.gold:C.muted,'400',15);
      button($t('关闭'),x+w-66,y+10,52,29,function(){closeFootworkHelp();},{primary:true,size:12});
      var checkX=x+14,checkY=footerY+8;
      box(checkX,checkY,18,18,footHelpDismissed?C.teal:C.bg,footHelpDismissed?C.teal:C.muted,4);
      if(footHelpDismissed){line(checkX+4,checkY+9,checkX+8,checkY+13,'#092a26',2);line(checkX+8,checkY+13,checkX+14,checkY+5,'#092a26',2);}
      text($t('不再自动弹出'),checkX+26,checkY+9,11.5,C.ink,'400','left',true);
      regions.push({x:checkX-3,y:footerY+2,w:155,h:31,label:$t('不再自动弹出'),action:function(){
        footHelpDismissed=!footHelpDismissed;
        if(typeof options.onFootworkHelpDismissedChange==='function'){try{options.onFootworkHelpDismissedChange(footHelpDismissed);}catch(ignored){}}
      }});
      var endReached=footHelpScroll>=footHelpMaxScroll-1,progress=footHelpMaxScroll?Math.round(footHelpScroll/footHelpMaxScroll*100):100;
      text(w<390?(endReached?$t('已读到底'):$t('上滑继续')):endReached?$t('已读到底 · 可关闭返回'):$t('上滑继续阅读 / 鼠标滚轮  ')+progress+'%',x+w-17,checkY+9,w<390?10.5:11,C.muted,'400','right',true);
    }
    function drawConcedeDialog() {
      ctx.fillStyle='rgba(3,10,18,.82)';ctx.fillRect(0,0,layoutWidth,height);
      regions=[{x:0,y:0,w:layoutWidth,h:height,label:$t('放弃确认遮罩'),action:function(){}}];
      var w=Math.min(390,layoutWidth-32),h=204,x=(layoutWidth-w)/2,y=(height-h)/2;
      box(x,y,w,h,C.panel,'#8b6265',12);text($t('放弃这次回球？'),x+20,y+28,19,C.ink,'600');
      text($t('对手获得这一分，随后继续比赛。'),x+20,y+65,12,C.muted);
      text(timingMode==='timed'?$t('剩余 ')+remaining.toFixed(1)+$t('秒 · 确认期间继续计时'):$t('当前路径不会在取消后丢失。'),x+20,y+95,11,timingMode==='timed'?C.gold:C.muted);
      var bw=(w-52)/2;
      button($t('继续回球'),x+20,y+h-54,bw,36,function(){concedeOpen=false;},{primary:true,size:12});
      button($t('确认放弃'),x+32+bw,y+h-54,bw,36,function(){concedeOpen=false;act(function(){return match.concedePoint();});},{size:12,danger:true});
    }
    function drawSystemPause() {
      ctx.fillStyle='rgba(3,10,18,.96)';ctx.fillRect(0,0,layoutWidth,height);
      regions=[{x:0,y:0,w:layoutWidth,h:height,label:$t('暂停遮罩'),action:function(){}}];
      var w=Math.min(390,layoutWidth-32),h=186,x=(layoutWidth-w)/2,y=(height-h)/2;
      box(x,y,w,h,C.panel,C.line,12);text($t('对局已暂停'),x+20,y+30,20,C.ink,'600');
      text($t('返回后继续本阶段，不会重置倒计时。'),x+20,y+67,12,C.muted);
      text($t('剩余 ')+remaining.toFixed(1)+$t('秒'),x+20,y+95,14,C.teal,'600');
      button($t('继续对局'),x+20,y+h-53,w-40,35,function(){systemPaused=false;timedLastTick=lastTick=Date.now();},{primary:true,size:13});
    }
    function render() {
      if(disposed||!ctx)return;
      width=layoutWidth;height=layoutHeight;regions=[];
      ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,viewportWidth,viewportHeight);ctx.fillStyle=C.bg;ctx.fillRect(0,0,viewportWidth,viewportHeight);
      ctx.setTransform(ratio*contentScale,0,0,ratio*contentScale,drawOffsetX*ratio,drawOffsetY*ratio);
      if(desktopLayout)box(0,0,layoutWidth,layoutHeight,C.bg,C.line,13);
      if(!landscape){
        var py=height/2;box(width/2-57,py-95,114,65,C.panel,C.teal,12);line(width/2-37,py-80,width/2+37,py-80,C.dim,2);
        text($t('请将设备横过来'),width/2,py+2,22,C.ink,'600','center');text($t('左侧看球场与状态，右侧选择动作'),width/2,py+37,12,C.muted,'400','center');
        text($t('对局已暂停，横屏后继续'),width/2,py+65,11,C.teal,'400','center');return;
      }
      if(timingMode===null&&!trainingOpen){drawTimingPicker();return;}
      var scene=trainingOpen?'training':replay?'replay':trialOpen&&view.phase==='route'?'trial':detailsOpen&&view.phase==='route'?'details':view.phase;
      if(scene!==scrollScene){if(scrollScene)scrollPositions[scrollScene]=scrollY;scrollY=scrollPositions[scene]||0;scrollScene=scene;}
      bodyTop=desktopLayout?43:34;bodyOffset=0;scrollY=0;maxScroll=0;
      line(leftWidth+3,0,leftWidth+3,height,C.line,1);
      width=rightWidth;var pad=12,end=180;
      ctx.save();ctx.beginPath();ctx.rect(rightX,bodyTop,rightWidth,height-bodyTop);ctx.clip();ctx.translate(rightX,0);
      drawCompactRight(scene,pad);ctx.restore();
      var bottom=height;
      regions=regions.map(function(region){var r=Object.assign({},region);r.x+=rightX;r.content=true;return r;}).filter(function(r){return r.y+r.h>bodyTop&&r.y<bottom;}).map(function(r){var b=Math.min(bottom,r.y+r.h);r.y=Math.max(bodyTop,r.y);r.h=b-r.y;return r;});
      width=leftWidth;drawLeftScene(scene);width=layoutWidth;
      drawDecisionHeader(scene);
      if(reasonDialog){
        ctx.fillStyle='rgba(3,10,18,.76)';ctx.fillRect(0,83,layoutWidth,height-83);ctx.fillRect(rightX,0,rightWidth,83);
        regions=[{x:0,y:0,w:layoutWidth,h:height,label:$t('原因提示遮罩'),action:function(){}}];
        var mw=Math.min(desktopLayout?400:340,rightWidth-20),mh=Math.min(desktopLayout?270:218,height-30),mx=rightX+(rightWidth-mw)/2,my=(height-mh)/2;
        box(mx,my,mw,mh,C.panel,'#8b6265',12);text(reasonDialog.title,mx+16,my+25,16,C.ink,'600');wrap(reasonDialog.reason,mx+16,my+61,mw-32,12,C.gold,5,18);
        button($t('知道了 · 继续选步'),mx+14,my+mh-48,mw-28,35,function(){reasonDialog=null;dragging=null;lastTick=Date.now();},{primary:true,size:12});
      }
      if(concedeOpen)drawConcedeDialog();
      if(footHelpOpen&&view.phase==='route')drawFootworkHelp();
      if(systemPaused&&timingMode==='timed')drawSystemPause();
      if(desktopLayout&&canvas.style){var hover=null;if(hoverPoint&&!dragging)for(var hi=regions.length-1;hi>=0;hi--){var candidate=regions[hi];if(hoverPoint.x>=candidate.x&&hoverPoint.x<=candidate.x+candidate.w&&hoverPoint.y>=candidate.y&&hoverPoint.y<=candidate.y+candidate.h){hover=candidate;break;}}
        canvas.style.cursor=hover&&hover.label!==$t('原因提示遮罩')?/球路|滑条|滑杆|瞄准|回动|站位/.test($zh(hover.label))?'crosshair':'pointer':dragging?'grabbing':'default';
        if(hover&&hover.label!==$t('原因提示遮罩')){ctx.save();rounded(hover.x+1,hover.y+1,hover.w-2,hover.h-2,6);ctx.strokeStyle='rgba(239,247,251,.45)';ctx.lineWidth=1.2;ctx.stroke();ctx.restore();}}
    }
    function tick() {
      if (disposed) return;
      debitTimedClock();
      var now = Date.now(), elapsed = Math.max(0, (now - lastTick) / 1000); lastTick = now;
      var wasReplaying = !!replay;
      if (replay && now - replay.start >= replay.wallDuration) endReplay();
      if (contactDirty && now - lastContactPreviewAt >= 33) refreshFootwork();
      if (previewDirty && now - lastPreviewAt >= 33) refreshPreview();
      if (recoveryDirty && now-lastRecoveryAt>=33)refreshRecoveryPreview();
      var active = ['serve', 'predict', 'route', 'shot'].indexOf(view.phase) !== -1;
      if (timingMode==='practice' && landscape && !paused && !footHelpOpen && !concedeOpen && !reasonDialog && !trainingOpen && !detailsOpen && !trialOpen && !shotFactorsOpen && !dragging && !wasReplaying && active) {
        remaining = Math.max(0, remaining - elapsed);
        if (remaining <= 0) act(function () { return match.timeout(); });
      }
      render(); frame = raf(tick);
    }
    function localPoint(point) { return { x:(point.x-drawOffsetX)/contentScale,y:(point.y-drawOffsetY)/contentScale }; }
    function interactionBlocked(){return disposed||timingMode===null||systemPaused||concedeOpen||footHelpOpen||!landscape||!!reasonDialog||trainingOpen||detailsOpen||trialOpen||shotFactorsOpen||!!replay||!!dragging;}
    function togglePause(){if(interactionBlocked()||timingMode!=='practice')return false;paused=!paused;lastTick=Date.now();render();return true;}
    function undo(){if(debitTimedClock()||interactionBlocked()||view.phase!=='route'||!footActions.length)return false;footActions.pop();error='';refreshFootwork();lastTick=Date.now();render();return true;}
    function moveDrag(point, finalUpdate) {
      if(!dragging)return;
      if(dragging.kind==='scroll') {
        scrollY=Math.max(0,Math.min(maxScroll,dragging.startScroll+dragging.startY-point.y));return;
      }
      if(dragging.kind==='footwork' && (point.y<bodyTop || point.y>=height-16 || point.x<rightX || point.x>layoutWidth)) {
        dragging.lastPoint=null;dragging.lastNode=null;return;
      }
      if(dragging.content)point={x:point.x-rightX,y:point.y-bodyOffset};
      if(dragging.kind==='footwork')updateFootDrag(point);
      else if(dragging.kind==='contactTrace'||dragging.kind==='contactSlider')updateContactDrag(point,finalUpdate);
      else if(dragging.kind==='recovery')updateRecoveryDrag(point);
      else if(dragging.kind==='servePosition')updateServePosition(point,finalUpdate);
      else updateSlider(point,finalUpdate);
    }
    function moveHelpDrag(point) {
      if(!footHelpOpen||!dragging)return false;
      if(dragging.kind==='helpScroll')footHelpScroll=Math.max(0,Math.min(footHelpMaxScroll,dragging.startScroll+dragging.startY-point.y));
      else if(dragging.kind==='helpScrollbar')footHelpScroll=Math.max(0,Math.min(footHelpMaxScroll,dragging.startScroll+(point.y-dragging.startY)/dragging.trackTravel*footHelpMaxScroll));
      else return false;
      return true;
    }
    var unsubscribePointer=options.onPointer(function(point){
      if(debitTimedClock()){render();return;}
      point=localPoint(point);
      for(var i=regions.length-1;i>=0;i--){
        var region=regions[i];
        if(point.x>=region.x&&point.x<=region.x+region.w&&point.y>=region.y&&point.y<=region.y+region.h){
          region.action(region.content?{x:point.x-rightX,y:point.y-bodyOffset}:point);
          if(dragging)dragging.content=!!region.content;
          if(dragging&&!options.onPointerUp){if(previewDirty)refreshPreview();if(contactDirty)refreshFootwork();if(recoveryDirty)refreshRecoveryPreview();dragging=null;}
          render();return;
        }
      }
      if(point.x>=rightX&&point.x<layoutWidth&&point.y>=bodyTop&&point.y<height-16&&maxScroll>0){dragging={kind:'scroll',startY:point.y,startScroll:scrollY};lastTick=Date.now();render();}
    });
    var unsubscribeMove=options.onPointerMove?options.onPointerMove(function(point){
      if(debitTimedClock()){render();return;}if(!landscape||systemPaused){dragging=null;return;}if(!point)return;
      var local=localPoint(point);if(desktopLayout)hoverPoint=local;
      if(!dragging){if(desktopLayout)render();return;}
      if(!moveHelpDrag(local))moveDrag(local,false);render();
    }):null;
    var unsubscribeUp=options.onPointerUp?options.onPointerUp(function(point){
      if(debitTimedClock()){render();return;}
      if(!landscape||systemPaused){dragging=null;return;}
      if(!dragging)return;
      if(dragging.kind==='helpScroll'||dragging.kind==='helpScrollbar'){
        if(point&&Number.isFinite(point.x))moveHelpDrag(localPoint(point));
        dragging=null;lastTick=Date.now();render();return;
      }
      if(point&&Number.isFinite(point.x))moveDrag(localPoint(point),true);
      if(previewDirty)refreshPreview();if(contactDirty)refreshFootwork();if(recoveryDirty)refreshRecoveryPreview();
      dragging=null;lastTick=Date.now();render();
    }):null;
    var unsubscribeWheel=options.onWheel?options.onWheel(function(point){
      if(debitTimedClock()){render();return;}
      if(!landscape||systemPaused)return;
      var local=localPoint(point);
      if(footHelpOpen){
        var vp=footHelpViewport;
        if(vp&&local.x>=vp.x-4&&local.x<=vp.x+vp.w+24&&local.y>=vp.y&&local.y<vp.y+vp.h){
          footHelpScroll=Math.max(0,Math.min(footHelpMaxScroll,footHelpScroll+(Number(point.deltaY)||0)/contentScale));render();
        }
        return;
      }
      if(reasonDialog||local.x<rightX||local.y<bodyTop||local.y>=height||dragging&&dragging.kind!=='scroll')return;
      scrollY=Math.max(0,Math.min(maxScroll,scrollY+(Number(point.deltaY)||0)));render();
    }):null;
    var unsubscribeResize = options.onResize ? options.onResize(resize) : null;
    var unsubscribeSuspend = options.onSuspend ? options.onSuspend(function () {
      debitTimedClock();if(timingMode==='timed'&&decisionActive())systemPaused=true;
      paused = true; dragging = null;hoverPoint=null; if (replay) endReplay(); timedLastTick=lastTick = Date.now(); render();
    }) : null;
    syncSelections(true); remaining = phaseBudget(); persistProfile(); resize({ width: width, height: height, pixelRatio: ratio });
    frame = raf(tick);
    return {
      togglePause:togglePause,
      undo:undo,
      getTimingState:timingState,
      destroy: function () {
        disposed = true;
        if(canvas.style)canvas.style.cursor='default';
        if (options.cancelFrame && frame !== undefined) options.cancelFrame(frame);
        if (typeof unsubscribePointer === 'function') unsubscribePointer();
        if (typeof unsubscribeMove === 'function') unsubscribeMove();
        if (typeof unsubscribeUp === 'function') unsubscribeUp();
        if (typeof unsubscribeResize === 'function') unsubscribeResize();
        if (typeof unsubscribeSuspend === 'function') unsubscribeSuspend();
        if (typeof unsubscribeWheel === 'function') unsubscribeWheel();
      }
    };
  }
  return { mount: mount };
});
