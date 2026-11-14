// Единственный игровой цикл. Другие модули время берут только из события tick.

import { state, emit, on } from './state.js';
import { loadLang, t } from './i18n.js';

const MAX_DT = 0.1; // секунды
let last = null;

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

// Пауза при скрытой вкладке: после возвращения не накапливаем большой dt.
document.addEventListener('visibilitychange', () => {
  last = null;
});

// ---------- временная проверка этапа 0 (убрать на этапе 1) ----------
function mountBootCheck() {
  const title = document.getElementById('boot-title');
  const tickEl = document.getElementById('boot-tick');
  title.textContent = `${t('ui.title')}: ${t('ui.boot')}`;
  let ticks = 0;
  let acc = 0;
  on('tick', ({ dt }) => {
    ticks++;
    acc += dt;
    if (acc >= 0.25) {
      acc = 0;
      tickEl.textContent = t('ui.tickCounter', { n: ticks });
    }
  });
}

async function boot() {
  await loadLang('ru');
  mountBootCheck();

  if (new URLSearchParams(location.search).get('debug') === '1') {
    // Временно, для проверки в консоли. Полноценная панель — этап 2.
    window.__kontorka = { state, emit, on, t };
  }

  requestAnimationFrame(frame);
}

boot().catch((e) => console.error('Не удалось запустить игру:', e));
