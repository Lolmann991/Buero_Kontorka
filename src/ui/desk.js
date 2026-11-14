// Стол, мониторы-слоты, часы Sony, стартовый экран и подсказка поворота.
// Только рисует и шлёт намерения. Игровой логики здесь нет.

let root = null;
let offs = [];
let els = {};
let shownText = '';

function el(tag, className, parent) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (parent) parent.appendChild(e);
  return e;
}

// Время смены (секунды ночи) -> «12:00», « 1:05». 1 секунда игры = 1 минута на часах.
export function formatClock(timeSec) {
  const totalMin = Math.min(360, Math.floor(timeSec));
  const hour = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  const h12 = hour === 0 ? 12 : hour;
  return `${String(h12).padStart(2, ' ')}:${String(min).padStart(2, '0')}`;
}

function renderClock(state) {
  const text = formatClock(state.time);
  if (text === shownText) return;
  shownText = text;
  els.digits.textContent = text;
}

function showStart(titleKey, ctx) {
  els.startTitle.textContent = ctx.t(titleKey);
  els.start.hidden = false;
}

export function mount(rootEl, ctx) {
  root = rootEl;
  const { state, t, emit, on } = ctx;

  // Сцена
  els.stage = el('div', 'stage', root);
  const img = el('img', 'desk-photo', els.stage);
  img.src = 'assets/img/desk/desk.webp';
  img.alt = '';
  img.draggable = false;

  els.monLeft = el('div', 'layer monitor-left', els.stage);
  els.monLeft.id = 'monitor-left';
  els.monRight = el('div', 'layer monitor-right', els.stage);
  els.monRight.id = 'monitor-right';

  els.plate = el('div', 'layer clock-plate', els.stage);
  els.digits = el('div', 'clock-digits', els.plate);
  renderClock(state);

  // Стартовый экран
  els.start = el('div', 'start-screen', root);
  els.startTitle = el('h1', 'start-title', els.start);
  els.startHint = el('p', 'start-hint', els.start);
  els.startHint.textContent = t('ui.headphones');
  els.startBtn = el('button', 'start-btn', els.start);
  els.startBtn.type = 'button';
  els.startBtn.textContent = t('ui.startShift');
  els.startTitle.textContent = t('ui.title');

  // pointerup от касания — это жест, после которого браузер разрешает звук.
  els.startBtn.addEventListener('pointerup', (e) => {
    if (e.button > 0) return;
    emit('intent:startShift');
  });

  // Подсказка поворота (показывается CSS-ом в портретной ориентации)
  els.rotate = el('div', 'rotate-hint', root);
  els.rotate.textContent = t('ui.rotateHint');

  offs = [
    on('tick', () => renderClock(state)),
    on('night:start', () => {
      shownText = '';
      renderClock(state);
      els.start.hidden = true;
    }),
    // Временно: полноценный экран итога появится на этапе 10.
    on('night:end', () => showStart('ui.shiftOver', ctx)),
  ];
}

export function unmount() {
  offs.forEach((off) => off());
  offs = [];
  if (root) root.replaceChildren();
  root = null;
  els = {};
  shownText = '';
}
