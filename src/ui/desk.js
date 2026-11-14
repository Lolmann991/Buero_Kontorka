// Стол, мониторы-слоты, часы Sony, стартовый экран и подсказка поворота.
// Только рисует и шлёт намерения. Игровой логики здесь нет.

const SVG_NS = 'http://www.w3.org/2000/svg';

// ---------- часы Sony ----------
// Всё в координатах фото (1672x941). Параметры подобраны по цифрам «12:02» на снимке.
const CLOCK = {
  rotate: 5.25,   // базовая линия идёт вниз вправо
  skew: 5.5,      // наклон цифр (курсив)
  w: 23, h: 41.5, t: 3.1, gap: 0.2, // размеры цифры и толщина сегмента
  cells: [        // левый нижний угол каждой ячейки: d1 d2 d3 d4
    [1428.0, 714.2],
    [1458.6, 717.0],
    [1500.6, 720.0],
    [1532.6, 723.0],
  ],
  colon: [1491.0, 720.0],
};

const DIGIT_SEGMENTS = {
  '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc',
  '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg',
};

// Шесть точек сегмента в локальных координатах (y вверх) -> строка для SVG (y вниз).
function segmentPoints() {
  const { w, h, t, gap: g } = CLOCK;
  const c = t / 2;
  const L = c, R = w - c, B = c, M = h / 2, T = h - c;
  const horiz = (y) => [
    [L + c + g, y], [L + 2 * c + g, y + c], [R - 2 * c - g, y + c],
    [R - c - g, y], [R - 2 * c - g, y - c], [L + 2 * c + g, y - c],
  ];
  const vert = (x, ya, yb) => [
    [x, yb - c - g], [x + c, yb - 2 * c - g], [x + c, ya + 2 * c + g],
    [x, ya + c + g], [x - c, ya + 2 * c + g], [x - c, yb - 2 * c - g],
  ];
  const str = (pts) => pts.map(([x, y]) => `${x.toFixed(2)},${(-y).toFixed(2)}`).join(' ');
  return {
    a: str(horiz(T)), g: str(horiz(M)), d: str(horiz(B)),
    f: str(vert(L, M, T)), b: str(vert(R, M, T)),
    e: str(vert(L, B, M)), c: str(vert(R, B, M)),
  };
}

function svgEl(tag, attrs, parent) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

function buildClock(parent) {
  const svg = svgEl('svg', { viewBox: '0 0 1672 941', preserveAspectRatio: 'none', class: 'clock-svg' }, parent);

  const defs = svgEl('defs', {}, svg);
  const filter = svgEl('filter', { id: 'clock-glow', x: '-20%', y: '-40%', width: '140%', height: '180%' }, defs);
  svgEl('feGaussianBlur', { stdDeviation: '1.8', result: 'blur' }, filter);
  const merge = svgEl('feMerge', {}, filter);
  svgEl('feMergeNode', { in: 'blur' }, merge);
  svgEl('feMergeNode', { in: 'SourceGraphic' }, merge);

  const root = svgEl('g', { filter: 'url(#clock-glow)' }, svg);
  const pts = segmentPoints();
  const { rotate, skew } = CLOCK;
  const cells = CLOCK.cells.map(([x, y]) => {
    const g = svgEl('g', { transform: `translate(${x} ${y}) rotate(${rotate}) skewX(${-skew})` }, root);
    const segs = {};
    for (const key of 'abcdefg') segs[key] = svgEl('polygon', { class: 'seg', points: pts[key] }, g);
    return segs;
  });

  const [cx, cy] = CLOCK.colon;
  const cg = svgEl('g', { transform: `translate(${cx} ${cy}) rotate(${rotate}) skewX(${-skew})` }, root);
  const { h, t } = CLOCK;
  for (const k of [0.30, 0.68]) {
    svgEl('rect', { class: 'seg', x: 0, y: -(h * k + t / 2), width: t, height: t }, cg);
  }
  return cells;
}

// Время смены (секунды ночи) -> « 1:05», «12:00». 1 секунда игры = 1 минута на часах.
export function formatClock(timeSec) {
  const totalMin = Math.min(360, Math.floor(timeSec));
  const hour = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  const h12 = hour === 0 ? 12 : hour;
  return `${String(h12).padStart(2, ' ')}:${String(min).padStart(2, '0')}`;
}

// ---------- модуль ----------
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

function renderClock(state) {
  const text = formatClock(state.time);
  if (text === shownText) return;
  shownText = text;
  const chars = [text[0], text[1], text[3], text[4]];
  chars.forEach((ch, i) => {
    const lit = DIGIT_SEGMENTS[ch] || '';
    for (const key of 'abcdefg') {
      els.cells[i][key].setAttribute('visibility', lit.includes(key) ? 'visible' : 'hidden');
    }
  });
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

  els.cells = buildClock(els.stage);
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