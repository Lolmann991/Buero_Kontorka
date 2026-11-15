// Мистер 404: единственный враг демо (раздел 8 и 18 мастер-промпта).
// Не трогает DOM и state: решает, куда идти, и сообщает событиями enemy:moved, enemy:status, jumpscare.
// Читает из state: sla, load, appetite, time, tickets. Реакции на звонок получает через onEvent('call:start').
//
// ID звуков, которые этот враг просит у audio.play() (появятся на этапе 8; пока audio.play нет, вызовы пропускаются):
// mr404.step, mr404.whistle, mr404.laugh, mr404.warning, door.knock, door.open, toilet.flush
//
// Допущение до этапа 7: тикет в state.tickets считается открытым, если у него нет done: true;
// возраст в секундах берётся из tk.age или считается как state.time - tk.openedAt.

export const id = 'mr404';

const DEFAULTS = {
  startDelaySec: 35, pauseSec: [20, 35], minPauseSec: 8,
  dashSteps: [2, 3], stepIntervalSec: [1.0, 1.8],
  hourFactor: [1.0, 0.85, 0.7], overloadFactor: 0.8, openTicketFactor: 0.9,
  appetiteFactorMax: 0.3,
  toiletStaySec: [15, 25], breakChance: 0.05, breakSec: [20, 30],
  lure: { callSec: 8, cooldownSec: 25, retreatGood: 2, retreatMid: 1, addPauseGoodSec: 12, addPauseMidSec: 6 },
  attack: { dwellSec: 10, warningToJumpscareSec: [3, 5] },
  slaGood: 60, slaBad: 40, whistleChancePer10s: 0.1,
};

const KNOCK_BEFORE_SEC = 6;          // стук в стеклянную дверь за 6 с до появления
const TICKET_AGED_SEC = 30;          // тикет старше этого повышает активность врага
const BREAK_FROM = new Set(['n_floor', 'front', 'n_hall']);   // откуда он может уйти на перерыв
const LAUGH_REARM_SLA = 50;          // смех снова только после того, как рейтинг поднимется выше этого

export function create(cfg, ctx) {
  const { state, graph, audio, emit, rng } = ctx;
  const C = {
    ...DEFAULTS, ...cfg,
    lure: { ...DEFAULTS.lure, ...(cfg?.lure || {}) },
    attack: { ...DEFAULTS.attack, ...(cfg?.attack || {}) },
  };

  const R = (a, b) => a + rng() * (b - a);
  const range = (pair) => R(pair[0], pair[1]);
  const rint = (a, b) => a + Math.floor(rng() * (b - a + 1));
  const play = (sound, at) => audio.play?.(sound, at ? { at } : {});

  const enemy = { id, pos: null, status: 'idle', update, onEvent, forceMove };

  // 'absent' (ещё не пришёл) | 'pause' | 'dash' | 'dwell' | 'toilet' | 'break' | 'warning' | 'dead'
  let mode = 'absent';
  let frozen = false;       // отладка: остановить ИИ, пока подбираются спрайты
  let timer = 0;            // обратный отсчёт текущего режима
  let stepTimer = 0;        // до следующего шага рывка
  let dashLeft = 0;
  let appearT = 0;
  let knocked = false;
  let trail = [];           // пройденный путь, нужен приманке (отступить назад по маршруту)
  let returning = false;    // идёт из туалета обратно: s_floor → s_hall3 (транзитом) → s_hall2
  let goFloor = false;      // на s_hall3 выпало «идти в туалет», а не атаковать
  let pauseMul = 1;         // 0,9 после звонка при плохом рейтинге, действует на следующую паузу
  let whistleAcc = 0;
  let laughArmed = true;

  // ---------- вспомогательное ----------
  function setStatus(status, dwell = false) {
    enemy.status = status;
    emit('enemy:status', { id, status, dwell });
  }

  function moveTo(to) {
    const from = enemy.pos;
    enemy.pos = to;
    emit('enemy:moved', { id, from, to });
  }

  function walkTo(to) {
    trail.push(to);
    if (trail.length > 32) trail.shift();
    moveTo(to);
    play('mr404.step', to);
  }

  function trimTrailTo(pos) {
    const i = trail.lastIndexOf(pos);
    if (i >= 0) trail.length = i + 1;
    else trail.push(pos);
  }

  function ticketAge(tk) {
    if (typeof tk.age === 'number') return tk.age;
    if (typeof tk.openedAt === 'number') return state.time - tk.openedAt;
    return 0;
  }

  // Пауза между рывками (раздел 18): базовая 20–35 с с коэффициентами, минимум 8 с, плюс добавка от приманки.
  function calcPause(add = 0) {
    const hour = Math.min(5, Math.floor(state.time / 60));
    let m = C.hourFactor[Math.min(C.hourFactor.length - 1, Math.floor(hour / 2))];
    if (state.load >= 5) m *= C.overloadFactor;
    const aged = state.tickets.filter((tk) => !tk.done && ticketAge(tk) > TICKET_AGED_SEC).length;
    m *= Math.pow(C.openTicketFactor, Math.min(2, aged));
    m *= 1 - Math.min(state.appetite / 500, C.appetiteFactorMax);
    const p = Math.max(C.minPauseSec, range(C.pauseSec) * m * pauseMul);
    pauseMul = 1;
    return p + add;
  }

  // ---------- режимы ----------
  function startPause(add = 0) {
    mode = 'pause';
    timer = calcPause(add);
    whistleAcc = 0;
    setStatus('idle');
  }

  function startDash() {
    dashLeft = rint(C.dashSteps[0], C.dashSteps[1]);
    mode = 'dash';
    setStatus('dash');
    stepNow();
  }

  function endDash() {
    startPause(0);
  }

  function enterDwell() {
    mode = 'dwell';
    timer = C.attack.dwellSec;
    goFloor = false;
    setStatus('idle', true);   // виден на камере 8 (и 7): последний шанс отогнать приманкой
  }

  function enterWarning() {
    mode = 'warning';
    timer = range(C.attack.warningToJumpscareSec);
    moveTo('desk');            // за спиной игрока; для камер он пропадает (статус warning)
    setStatus('warning');
    play('mr404.warning', 'desk');
  }

  function enterToilet() {
    mode = 'toilet';
    timer = range(C.toiletStaySec);
    setStatus('hidden');
    play('door.open', 's_toilet');
  }

  function leaveToilet() {
    play('toilet.flush', 's_toilet');
    play('door.open', 's_toilet');
    walkTo('s_floor');
    returning = true;
    dashLeft = 2;              // s_floor → s_hall3 → s_hall2
    mode = 'dash';
    stepTimer = range(C.stepIntervalSec);
    setStatus('dash');
  }

  function enterBreak() {
    mode = 'break';
    timer = range(C.breakSec);
    trail = ['n_stairs'];
    moveTo('n_stairs');
    setStatus('break');
    play('door.open', 'n_stairs');
  }

  function leaveBreak() {
    walkTo('n_floor');
    startPause(0);
  }

  // ---------- маршрут ----------
  function pickNext(pos) {
    if (returning) {
      if (pos === 's_floor') return 's_hall3';
      if (pos === 's_hall3') { returning = false; return 's_hall2'; }
    }
    switch (pos) {
      case 'n_stairs': return 'n_floor';
      case 'n_floor': return 'front';
      case 'front': return rng() < 0.8 ? 'n_hall' : 'n_kitchen';
      case 'n_kitchen': return 'front';
      case 'n_hall': return 's_hall1';
      case 's_hall1': return 's_hall2';
      case 's_hall2': return rng() < 0.75 ? 's_hall3' : 's_kitchen';
      case 's_kitchen': return rng() < 0.5 ? 's_hall2' : 's_hall3';
      case 's_hall3': return 's_floor';
      case 's_floor': return rng() < 0.8 ? 's_toilet' : 's_hall3';
      default: return null;
    }
  }

  function stepNow() {
    const pos = enemy.pos;
    if (!returning && BREAK_FROM.has(pos) && rng() < C.breakChance) { enterBreak(); return; }
    if (pos === 's_hall3' && !returning && !goFloor) { enterDwell(); return; }
    const to = pickNext(pos);
    if (!to) { endDash(); return; }
    if (!graph.neighbors(pos).includes(to)) console.warn(`mr404: нет ребра ${pos} → ${to}`);
    if (pos === 's_hall3') goFloor = false;
    walkTo(to);
    dashLeft -= 1;
    arrive(to);
    if (mode !== 'dash') return;
    if (dashLeft <= 0) endDash();
    else stepTimer = range(C.stepIntervalSec);
  }

  function arrive(pos) {
    if (pos === 's_toilet') { enterToilet(); return; }
    // s_hall3 это последний шанс: 75% атака, 25% идёт дальше в туалет. Транзитом (из туалета) атаки нет.
    if (pos === 's_hall3' && !returning) {
      if (rng() < 0.25) goFloor = true;
      else enterDwell();
    }
  }

  // ---------- приманка ----------
  function onLure() {
    if (mode === 'absent' || mode === 'toilet' || mode === 'break' || mode === 'warning' || mode === 'dead') return;
    const sla = state.sla;
    const good = sla >= C.slaGood;
    const mid = !good && sla >= C.slaBad;
    if (!good && !mid) { pauseMul = 0.9; return; }   // не отвлекает, но следующая пауза короче на 10%

    const add = good ? C.lure.addPauseGoodSec : C.lure.addPauseMidSec;
    if (mode === 'dwell') {
      trimTrailTo('s_hall2');
      moveTo('s_hall2');
    } else {
      const steps = good ? C.lure.retreatGood : C.lure.retreatMid;
      for (let i = 0; i < steps && trail.length > 1; i++) trail.pop();
      const to = trail[trail.length - 1];
      if (to && to !== enemy.pos) moveTo(to);
    }
    returning = false;
    goFloor = false;
    startPause(add);
  }

  // ---------- публичное ----------
  function forceMove(posId) {
    returning = false;
    goFloor = false;
    if (enemy.pos === null) trail = [posId];
    else trimTrailTo(posId);
    moveTo(posId);
    if (posId === 's_hall3') enterDwell();
    else if (posId === 's_toilet') enterToilet();
    else startPause(0);
  }

  function onEvent(name, payload) {
    if (name === 'call:start' && payload?.kind === 'lure') { onLure(); return; }
    if (name !== 'debug:enemy') return;
    switch (payload?.action) {
      case 'freeze':
        frozen = !!payload.value;
        if (!frozen && enemy.pos) {   // вернуть на экран то, где враг на самом деле
          emit('enemy:moved', { id, from: null, to: enemy.pos });
          setStatus(enemy.status, mode === 'dwell');
        }
        break;
      case 'move': if (payload.pos) forceMove(payload.pos); break;
      case 'dashNow': if (mode === 'pause') startDash(); break;
      case 'attackNow': forceMove('s_hall3'); break;
      default: break;
    }
  }

  function update(dt) {
    if (frozen || mode === 'dead') return;

    // Смех: один раз, когда рейтинг падает ниже порога; снова после подъёма выше 50.
    if (mode !== 'absent') {
      if (laughArmed && state.sla < C.slaBad) { play('mr404.laugh', enemy.pos); laughArmed = false; }
      else if (!laughArmed && state.sla > LAUGH_REARM_SLA) laughArmed = true;
    }

    switch (mode) {
      case 'absent':
        appearT += dt;
        if (!knocked && appearT >= C.startDelaySec - KNOCK_BEFORE_SEC) {
          knocked = true;
          play('door.knock', 'front');
        }
        if (appearT >= C.startDelaySec) {
          trail = ['n_stairs'];
          moveTo('n_stairs');
          play('mr404.step', 'n_stairs');
          startPause(0);
        }
        break;
      case 'pause':
        timer -= dt;
        whistleAcc += dt;
        if (whistleAcc >= 10) {
          whistleAcc -= 10;
          if (rng() < C.whistleChancePer10s) play('mr404.whistle', enemy.pos);
        }
        if (timer <= 0) startDash();
        break;
      case 'dash':
        stepTimer -= dt;
        if (stepTimer <= 0) stepNow();
        break;
      case 'dwell':
        timer -= dt;
        if (timer <= 0) enterWarning();
        break;
      case 'warning':
        timer -= dt;
        if (timer <= 0) {
          mode = 'dead';
          setStatus('attack');
          emit('jumpscare', { enemyId: id });
        }
        break;
      case 'toilet':
        timer -= dt;
        if (timer <= 0) leaveToilet();
        break;
      case 'break':
        timer -= dt;
        if (timer <= 0) leaveBreak();
        break;
      default: break;
    }
  }

  return enemy;
}