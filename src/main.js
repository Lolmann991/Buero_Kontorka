// Единственный игровой цикл. Другие модули время берут только из события tick.

import { state, set, patch, emit, on, newNight, recalcLoad, tickTokens } from './state.js';
import { loadLang, t } from './i18n.js';
import * as audio from './audio.js';
import * as desk from './ui/desk.js';
import * as cameras from './ui/cameras.js';
import { loadGraph } from './graph.js';
import { initDebug } from './debug.js';

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
  if (!state.running) return;
  set('camera', id);
  recalcLoad();
  emit('camera:open', { id });
});

on('intent:closeCamera', () => {
  if (state.camera === null) return;
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
  if (state.call.active || state.call.cooldown > 0) return;
  set('call.active', true);
  set('call.left', lureCfg().callSec ?? 8);
  recalcLoad();
  emit('call:start', { id: 'lure', kind: 'lure' });
});

// Удержание кнопки починки даёт +1 к нагрузке. Прогресс тикета считает tickets.js (этап 7).
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

// ВРЕМЕННО, до этапа 7 (tickets.js): перезагрузка сломанной камеры занимает 2 с игрового времени.
const REBOOT_SEC = 2;
const rebooting = new Map(); // номер камеры -> сколько секунд осталось

on('intent:reboot', ({ cam }) => {
  if (!state.running || rebooting.has(cam) || !state.brokenCams.includes(cam)) return;
  rebooting.set(cam, REBOOT_SEC);
});

on('night:start', () => rebooting.clear());

on('tick', ({ dt }) => {
  if (!state.running || !rebooting.size) return;
  for (const [cam, left] of rebooting) {
    if (left - dt > 0) {
      rebooting.set(cam, left - dt);
      continue;
    }
    rebooting.delete(cam);
    patch('brokenCams', (list) => list.filter((c) => c !== cam));
  }
});

// ---------- запуск ----------
async function loadJSON(path) {
  const res = await fetch(new URL(path, document.baseURI));
  if (!res.ok) throw new Error(`Не удалось загрузить ${path} (${res.status})`);
  return res.json();
}

async function boot() {
  await loadLang('ru');
  loadGraph(await loadJSON('data/rooms.json'));
  try {
    nights = await loadJSON('data/nights.json');
  } catch (e) {
    console.warn('nights.json не загружен, берутся значения по умолчанию', e);
  }

  const ctx = { state, t, emit, on };
  desk.mount(document.getElementById('app'), ctx);
  cameras.mount(document.getElementById('monitor-left'), ctx);
  initDebug();

  requestAnimationFrame(frame);
}

boot().catch((e) => console.error('Не удалось запустить игру:', e));