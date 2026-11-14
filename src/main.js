// Единственный игровой цикл. Другие модули время берут только из события tick.

import { state, set, emit, on, newNight } from './state.js';
import { loadLang, t } from './i18n.js';
import * as audio from './audio.js';
import * as desk from './ui/desk.js';

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

// ---------- запуск ----------
async function boot() {
  await loadLang('ru');

  const ctx = { state, t, emit, on };
  desk.mount(document.getElementById('app'), ctx);

  if (new URLSearchParams(location.search).get('debug') === '1') {
    // Временно, для проверки в консоли. Полноценная панель — этап 2.
    window.__kontorka = { state, set, emit, on, t };
  }

  requestAnimationFrame(frame);
}

boot().catch((e) => console.error('Не удалось запустить игру:', e));
