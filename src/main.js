// Единственный игровой цикл. Другие модули время берут только из события tick.

import { state, set, patch, emit, on, newNight, recalcLoad, tickTokens } from './state.js';
import { loadLang, t } from './i18n.js';
import * as audio from './audio.js';
import * as desk from './ui/desk.js';
import * as cameras from './ui/cameras.js';
import * as teams from './ui/teams.js';
import * as tickets from './tickets.js';
import * as graph from './graph.js';
import * as mr404 from './enemies/mr404.js';
import { initDebug } from './debug.js';

const ENEMY_MODULES = { mr404 };   // id врага из nights.json -> модуль src/enemies/<id>.js

const MAX_DT = 0.1; // секунды
const NIGHT_SEC = 360;
const CLOCK_333_SEC = 3 * 60 + 33;   // ночь 5: ровно в 3:33 на часах Sony появляются минуты

let last = null;
let lastHour = 0;
let nights = {};   // data/nights.json

function frame(now) {
  requestAnimationFrame(frame);
  if (document.hidden) {
    last = null;
    return;
  }
  if (last === null) {
    last = now;
    return;
  }
  const dt = Math.min((now - last) / 1000, MAX_DT);
  last = now;
  emit('tick', { dt });
}

// После возвращения на вкладку не копим большой dt.
document.addEventListener('visibilitychange', () => {
  last = null;
});

// ---------- время смены ----------
on('tick', ({ dt }) => {
  if (!state.running) return;

  const prev = state.time;
  const time = Math.min(NIGHT_SEC, prev + dt);
  set('time', time);

  // ВРЕМЕННО здесь, позже уйдёт в данные ночей и модуль глюков (этап 9)
  if (state.night === 5 && prev < CLOCK_333_SEC && time >= CLOCK_333_SEC) {
    emit('glitch', { type: 'clock333', source: 'fifth' });
  }

  const hour = Math.floor(time / 60);
  if (hour !== lastHour) {
    lastHour = hour;
    emit('clock:hour', { hour });
  }

  if (time >= NIGHT_SEC) {
    set('running', false);
    emit('night:end', { n: state.night });
  }
});

// ---------- намерения интерфейса ----------
on('intent:startShift', () => {
  if (state.running) return;
  audio.init();
  newNight(state.night, nights[state.night] || {});
  lastHour = 0;
  set('running', true);
});

// Открытие камеры: состояние и событие; вид рисует ui/cameras.js.
on('intent:openCamera', ({ id }) => {
  if (!state.running || state.tokens <= 0) return;
  if (state.repairing && state.camera !== id) set('repairing', false);   // кнопка починки осталась на прошлой камере
  set('camera', id);
  recalcLoad();
  emit('camera:open', { id });
});

on('intent:closeCamera', () => {
  if (state.camera === null) return;
  if (state.repairing) set('repairing', false);
  set('camera', null);
  recalcLoad();
  emit('camera:close');
});

// Конец смены закрывает камеру: на экране итога остаётся стол.
on('night:end', () => {
  if (state.camera === null) return;
  set('camera', null);
  recalcLoad();
  emit('camera:close');
});

// ---------- токены, звонок-приманка, починка (этап 5) ----------
const lureCfg = () => nights[state.night]?.enemies?.mr404?.lure ?? {};

on('tick', ({ dt }) => {
  if (!state.running) return;
  tickTokens(dt);

  if (state.call.active) {
    const left = state.call.left - dt;
    if (left <= 0) endCall();
    else set('call.left', left);
  } else if (state.call.cooldown > 0) {
    set('call.cooldown', Math.max(0, state.call.cooldown - dt));
  }
});

function endCall() {
  set('call.active', false);
  set('call.left', 0);
  set('call.cooldown', lureCfg().cooldownSec ?? 25);
  recalcLoad();
  emit('call:end', { id: 'lure', kind: 'lure' });
}

on('intent:call', () => {
  if (!state.running || state.tokens <= 0) return;
  // В окне атаки (враг на s_hall3 и виден на камерах) перезарядка приманки не действует (раздел 18).
  const dwelling = Object.values(state.enemies).some((e) => e.dwell);
  if (state.call.active || (state.call.cooldown > 0 && !dwelling)) return;
  if (dwelling) set('call.cooldown', 0);
  set('call.active', true);
  set('call.left', lureCfg().callSec ?? 8);
  recalcLoad();
  emit('call:start', { id: 'lure', kind: 'lure' });
});

// Удержание кнопки починки даёт +1 к нагрузке. Прогресс тикета считает tickets.js.
on('intent:repairStart', () => {
  if (!state.running || state.tokens <= 0 || state.repairing) return;
  set('repairing', true);
  recalcLoad();
});

on('intent:repairEnd', () => {
  if (!state.repairing) return;
  set('repairing', false);
  recalcLoad();
});

// 0% токенов: камеры, звонок и починка отключаются; тикеты продолжают приходить.
on('tokens:change', ({ value }) => {
  if (value > 0 || !state.running) return;
  if (state.camera !== null) {
    set('camera', null);
    emit('camera:close');
  }
  if (state.call.active) endCall();
  set('repairing', false);
  recalcLoad();
});

// Конец смены сбрасывает звонок и починку.
on('night:end', () => {
  set('call.active', false);
  set('call.left', 0);
  set('call.cooldown', 0);
  set('repairing', false);
  recalcLoad();
});

// ---------- враги (этап 6) ----------
// Враг сам решает, куда идти, и сообщает событиями; в state.enemies их отражает main.js.
let enemies = [];

function mirrorEnemy(id, patchObj) {
  const cur = {};
  for (const [k, v] of Object.entries(state.enemies)) cur[k] = { ...v };
  cur[id] = { status: 'idle', ...(cur[id] || {}), ...patchObj };
  set('enemies', cur);
}

on('enemy:moved', ({ id, to }) => {
  if (to === null) {
    const cur = {};
    for (const [k, v] of Object.entries(state.enemies)) if (k !== id) cur[k] = { ...v };
    set('enemies', cur);
    return;
  }
  mirrorEnemy(id, { pos: to });
});

on('enemy:status', ({ id, status, dwell = false }) => mirrorEnemy(id, { status, dwell }));

on('night:start', () => {
  enemies = [];
  const cfgs = nights[state.night]?.enemies ?? {};
  for (const [id, cfg] of Object.entries(cfgs)) {
    const mod = ENEMY_MODULES[id];
    if (!mod) { console.warn(`enemies: нет модуля для «${id}»`); continue; }
    enemies.push(mod.create(cfg, { state, graph, audio, emit, rng: Math.random }));
  }
});

on('tick', ({ dt }) => {
  if (!state.running) return;
  for (const e of enemies) e.update(dt);
});

// Враги получают звонки и команды отладки через onEvent, а не подписываются сами.
for (const name of ['call:start', 'call:end', 'debug:enemy']) {
  on(name, (payload) => enemies.forEach((e) => e.onEvent(name, payload)));
}

// Скример: смена заканчивается провалом. Кадр рисует ui/desk.js, потом стартовый экран «Смена провалена».
on('jumpscare', ({ enemyId }) => {
  console.info(`jumpscare: ${enemyId}`);
  set('running', false);
  emit('night:end', { n: state.night, failed: true });
});

on('night:end', () => { enemies = []; });

// Прослушанная запись ночи открывает привязанные к ней записи архива (flags.unlocked: 'call:<id>').
// call:end для kind 'story' должен приходить и при выключении записи кнопкой (intent:muteCall).
on('call:end', ({ id, kind }) => {
  if (kind !== 'story') return;
  patch('flags.unlocked', (list) => (list.includes(`call:${id}`) ? list : [...list, `call:${id}`]));
});

// ---------- тикеты (этап 7) ----------
// Создание, рейтинг, поломка камер, починка и перезагрузка живут в tickets.js; здесь только проводка.
on('night:start', () => tickets.start(nights[state.night]?.tickets ?? {}));

on('tick', ({ dt }) => {
  if (!state.running) return;
  tickets.update(dt);
});

// ---------- запуск ----------
async function loadJSON(path) {
  const res = await fetch(new URL(path, document.baseURI));
  if (!res.ok) throw new Error(`Не удалось загрузить ${path} (${res.status})`);
  return res.json();
}

async function boot() {
  await loadLang('ru');
  graph.loadGraph(await loadJSON('data/rooms.json'));
  try {
    nights = await loadJSON('data/nights.json');
  } catch (e) {
    console.warn('nights.json не загружен, берутся значения по умолчанию', e);
  }

  try {
    tickets.load(await loadJSON('data/tickets.json'));
  } catch (e) {
    console.warn('tickets.json не загружен, тикеты отключены', e);
  }
  try {
    teams.setArchive(await loadJSON('data/teams-archive.json'));
  } catch (e) {
    console.warn('teams-archive.json не загружен, архив пуст', e);
  }

  const ctx = { state, t, emit, on };
  desk.mount(document.getElementById('app'), ctx);
  cameras.mount(document.getElementById('monitor-left'), ctx);
  teams.mount(document.getElementById('monitor-right'), ctx);
  initDebug();

  requestAnimationFrame(frame);
}

boot().catch((e) => console.error('Не удалось запустить игру:', e));