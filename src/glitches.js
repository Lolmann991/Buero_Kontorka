// Модуль глюков (этап 9). Пока только фантомы Teams: «печатает…» без сообщения и уведомление без сообщения.
// Игровая логика здесь; рисует teams.js. Время берётся из state.time (секунды ночи), своих таймеров нет.
// Источник обоих глюков: 'fifth' (зелёно-белый, «человеческий»).
//
// Связка на ночь (порядок выбирается случайно или задаётся в nights.json):
//   notifyFirst: уведомление -> игрок открывает чат, там пусто -> остаётся в чате -> фантомное «печатает…»
//   typingFirst: фантомное «печатает…» -> пауза -> уведомление -> игрок открывает чат, там пусто
// Подключение в main.js:
//   const glitches = createGlitches({ state, emit, on, rng });
//   on('night:start', ({ n }) => glitches.start(nightsCfg[n]));
//   on('tick', () => glitches.update());
//   on('debug:glitch', (p) => glitches.debug(p, nightsCfg[state.night]));
//   (на night:end модуль останавливается сам)

import { play } from './audio.js';

export function create(ctx) {
  const { state: S, emit, on } = ctx;
  const rng = ctx.rng ?? Math.random;
  const between = ([a, b]) => a + (b - a) * rng();

  let cfg = null;
  let offs = [];
  let running = false;
  let plan = [];           // порядок шагов: 'notify' | 'typing'
  let idx = 0;             // текущий шаг
  let readyAt = 0;         // раньше этого времени ночи шаг не начинаем
  let deadline = 0;        // позже этого времени шаг пропускаем и связку заканчиваем
  let midpoint = 0;        // до этого момента ждём, что игрок уйдёт со вкладки «Поддержка»
  let endAt = 0;           // последний допустимый момент ночи
  let busyUntil = 0;       // пока идёт фантомная печать, следующий шаг не начинаем
  let waitingSeen = false; // уведомление показано, ждём ответ от teams.js
  let teamsTab = 'support';
  let repairing = false;
  let quietUntil = 0;      // недавно было настоящее сообщение или тикет

  // ---- условия «игрок гарантированно заметит» ----
  const enemyAlert = () => Object.values(S.enemies ?? {}).some((e) => e && (e.status === 'warning' || e.status === 'attack' || e.status === 'door'));

  function canShow(kind) {
    const t = S.time;
    if (!S.running || !(S.tokens > 0)) return false;        // мониторы выключены
    if (S.view && S.view !== 'desk') return false;         // игрок не смотрит на монитор Teams
    if (t < quietUntil) return false;                       // рядом настоящее сообщение
    if (repairing) return false;                            // игрок держит кнопку починки
    if (S.phone && S.phone.status !== 'idle') return false; // звонок и субтитры отвлекают
    if (enemyAlert()) return false;                         // предупреждение об атаке
    if (kind === 'typing') return teamsTab === 'support';   // печать видна только в живом чате
    // Уведомление первым шагом имеет смысл, только если игрок не в чате (в архиве или звонках).
    if (idx === 0 && plan[0] === 'notify') return teamsTab !== 'support';
    return true;
  }

  // ---- показ ----
  function trigger(kind) {
    const t = S.time;
    if (kind === 'typing') {
      const dur = cfg.typingSec;
      emit('glitch', { type: 'phantomTyping', source: 'fifth', durationSec: dur });
      busyUntil = t + dur;
    } else {
      emit('glitch', { type: 'phantomNotify', source: 'fifth', ttlSec: cfg.notifyTtlSec });
      try { play(cfg.notifySound, { volume: cfg.notifyVolume }); } catch (e) { /* звука может не быть */ }
      waitingSeen = true;
    }
  }

  function advance(afterGap) {
    idx += 1;
    if (idx >= plan.length) { running = false; return; }
    readyAt = S.time + afterGap;
    deadline = Math.min(S.time + afterGap + cfg.stepDeadlineSec, endAt);
  }

  function update() {
    if (!running || waitingSeen) return;
    const t = S.time;
    if (t < busyUntil || t < readyAt) return;
    if (t > deadline) { running = false; return; }
    // Игрок так и не уходил с «Поддержки»: уведомление первым не получится, меняем порядок.
    if (idx === 0 && plan[0] === 'notify' && t > midpoint) plan = ['typing', 'notify'];
    const kind = plan[idx];
    if (!canShow(kind)) return;
    trigger(kind);
    if (kind === 'typing') advance(cfg.typingSec + between(cfg.gapAfterTypingSec));
  }

  // ---- события ----
  function onSeen({ type, seen }) {
    if (type !== 'phantomNotify' || !waitingSeen) return;
    waitingSeen = false;
    // Уведомление истекло незамеченным: связка не имеет смысла, заканчиваем.
    if (!seen) { running = false; return; }
    advance(between(cfg.gapAfterSeenSec));
  }

  function start(nightCfg) {
    stop();
    cfg = nightCfg?.glitches?.phantom ?? null;
    if (!cfg) return;
    endAt = (nightCfg.durationSec ?? 360) - 15;
    const variant = cfg.variant === 'random' ? (rng() < 0.5 ? 'notifyFirst' : 'typingFirst') : cfg.variant;
    plan = variant === 'typingFirst' ? ['typing', 'notify'] : ['notify', 'typing'];
    idx = 0;
    const [a, b] = cfg.windowSec;
    readyAt = a;
    deadline = Math.min(b, endAt);
    midpoint = (a + b) / 2;
    busyUntil = 0;
    waitingSeen = false;
    teamsTab = 'support';
    repairing = false;
    quietUntil = 0;
    running = true;
    const quiet = () => { quietUntil = S.time + cfg.quietAfterMessageSec; };
    offs = [
      on('intent:teamsTab', ({ tab }) => { teamsTab = tab; }),
      on('intent:repairStart', () => { repairing = true; }),
      on('intent:repairEnd', () => { repairing = false; }),
      on('ticket:pressure', quiet),
      on('ticket:new', quiet),
      on('intent:glitchSeen', onSeen),
      on('night:end', stop),
    ];
  }

  function stop() {
    running = false;
    offs.forEach((off) => off());
    offs = [];
  }

  // Отладка (событие debug:glitch из debug.js):
  //   {action:'typing'|'notify'}            показать глюк сразу, без проверки условий
  //   {action:'chain', variant:'notifyFirst'|'typingFirst'}  запустить связку сейчас с обычной проверкой условий
  function debug({ action, variant } = {}, nightCfg = null) {
    if (action === 'chain') {
      start(nightCfg);
      if (!cfg) return;
      plan = variant === 'typingFirst' ? ['typing', 'notify'] : ['notify', 'typing'];
      readyAt = S.time;
      deadline = S.time + 90;
      midpoint = Infinity;   // порядок не меняем: тестируем именно выбранный
      return;
    }
    if (!cfg) cfg = nightCfg?.glitches?.phantom ?? null;
    if (cfg && (action === 'typing' || action === 'notify')) trigger(action);
  }

  // update() вызывается из tick; время берётся из state.time
  return { start, stop, update, debug, trigger: (kind) => { if (cfg) trigger(kind); } };
}