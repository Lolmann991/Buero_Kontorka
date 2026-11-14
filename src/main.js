// Единственный игровой цикл. Другие модули время берут только из события tick.

import { state, set, emit, on, newNight } from './state.js';
import { loadLang, t } from './i18n.js';
import * as audio from './audio.js';
import * as desk from './ui/desk.js';
import * as cameras from './ui/cameras.js';
import { loadGraph } from './graph.js';
import { initDebug } from './debug.js';

const MAX_DT = 0.1; // секунды
const NIGHT_SEC = 360;

let last = null;
let lastHour = 0;

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

  const time = Math.min(NIGHT_SEC, state.time + dt);
  set('time', time);

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
  newNight(state.night);
  lastHour = 0;
  set('running', true);
});

// Открытие камеры: пока только состояние и событие. Вид камеры — этап 4.
on('intent:openCamera', ({ id }) => {
  if (!state.running) return;
  set('camera', id);
  emit('camera:open', { id });
});

on('intent:closeCamera', () => {
  if (state.camera === null) return;
  set('camera', null);
  emit('camera:close');
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

  const ctx = { state, t, emit, on };
  desk.mount(document.getElementById('app'), ctx);
  cameras.mount(document.getElementById('monitor-left'), ctx);
  initDebug();

  requestAnimationFrame(frame);
}

boot().catch((e) => console.error('Не удалось запустить игру:', e));