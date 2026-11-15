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

// ---------- мониторы ----------
// Экран каждого монитора на фото это четырёхугольник (мониторы стоят чуть V-образно).
// Холст 640x376 растягивается на него матрицей matrix3d (перспективное преобразование).
// Углы (в px фото 1672x941): левый верх, правый верх, правый низ, левый низ.
export const PHOTO_W = 1672;
const CLOCK_GLITCH_SEC = 3;   // сколько секунд минуты на часах видны в глюке 3:33
export const MONITOR_SIZE = [640, 376];
export const MONITOR_QUADS = {
  left:  [[55.3, 138.6], [832.0, 149.4], [832.0, 593.3], [69.0, 601.6]],
  right: [[847.0, 149.5], [1614.2, 139.0], [1607.0, 600.7], [847.0, 593.6]],
};

// Прямоугольник w x h -> четырёхугольник quad, масштаб k (px сцены на px фото).
// Возвращает 16 чисел для CSS matrix3d (по столбцам).
export function monitorMatrix(quad, w, h, k = 1) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = quad;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / den;
  const hh = (dx1 * dy3 - dx3 * dy1) / den;
  const a = x1 - x0 + g * x1, b = x3 - x0 + hh * x3, c = x0;
  const d = y1 - y0 + g * y1, e = y3 - y0 + hh * y3, f = y0;
  // единичный квадрат -> холст w x h, затем масштаб k для координат на выходе
  return [
    (k * a) / w, (k * d) / w, 0, g / w,
    (k * b) / h, (k * e) / h, 0, hh / h,
    0, 0, 1, 0,
    k * c, k * f, 0, 1,
  ];
}

function layoutMonitors() {
  if (!els.stage) return;
  const k = els.stage.clientWidth / PHOTO_W;
  if (!k) return;
  const [w, h] = MONITOR_SIZE;
  for (const [side, node] of [['left', els.monLeft], ['right', els.monRight]]) {
    node.style.transform = `matrix3d(${monitorMatrix(MONITOR_QUADS[side], w, h, k).join(',')})`;
    node.classList.add('is-ready');
  }
}

const DIGIT_SEGMENTS = {
  '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc',
  '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg',
  A: 'abcefg', M: 'abcefm',   // m: добавочный центральный сегмент, нужен для буквы M
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
    m: str(vert((L + R) / 2, M, T)),
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
    for (const key of 'abcdefgm') segs[key] = svgEl('polygon', { class: 'seg', points: pts[key] }, g);
    return segs;
  });

  const [cx, cy] = CLOCK.colon;
  const cg = svgEl('g', { transform: `translate(${cx} ${cy}) rotate(${rotate}) skewX(${-skew})` }, root);
  const { h, t } = CLOCK;
  for (const k of [0.30, 0.68]) {
    svgEl('rect', { class: 'seg', x: 0, y: -(h * k + t / 2), width: t, height: t }, cg);
  }
  return { cells, colon: cg };
}

// Лицо часов Sony: «12AM», « 1AM» … « 6AM». Минут и двоеточия нет.
// На время глюка (ночь 5, 3:33) загораются минуты: « 3:33».
export function clockFace(timeSec, glitch = false) {
  if (glitch) return { chars: [' ', '3', '3', '3'], colon: true };
  const hour = Math.min(6, Math.floor(timeSec / 60));
  const s = String(hour === 0 ? 12 : hour).padStart(2, ' ');
  return { chars: [s[0], s[1], 'A', 'M'], colon: false };
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
  const face = clockFace(state.time, els.clockGlitch > 0);
  const key = face.chars.join('') + (face.colon ? ':' : '');
  if (key === shownText) return;
  shownText = key;
  face.chars.forEach((ch, i) => {
    const lit = DIGIT_SEGMENTS[ch] || '';
    for (const k of 'abcdefgm') {
      els.cells[i][k].setAttribute('visibility', lit.includes(k) ? 'visible' : 'hidden');
    }
  });
  els.colon.setAttribute('visibility', face.colon ? 'visible' : 'hidden');
}

// Напряжение сцены 0..1: растёт к утру и при перегрузке сети. Только оформление (виньетка).
function updateTension(state) {
  const raw = state.running ? Math.min(1, (state.time / 360) * 0.7 + (state.load >= 5 ? 0.3 : 0)) : 0;
  const v = Math.round(raw * 50) / 50;
  if (v === els.tension) return;
  els.tension = v;
  els.stage.style.setProperty('--tension', String(v));
}

// Слои атмосферы. Всё в процентах сцены, поверх фото ничего не запекается.
function buildFxBelow(stage) {
  el('div', 'fx fx-grade', stage);
  const win = el('div', 'fx fx-window', stage);          // свет с улицы сквозь жалюзи
  el('div', 'fx-window__pass', win);                      // тень «проходит» за окном
  el('div', 'fx fx-spill', stage);                        // свет мониторов на клавиатуре
  el('div', 'fx fx-vignette', stage);
}

function buildFxAbove(stage) {
  el('div', 'fx fx-led', stage);                          // индикатор веб-камеры сам горит красным
  el('div', 'fx fx-dim', stage);                          // редкие провалы света
  el('div', 'fx fx-grain', stage);
}

function showStart(titleKey, ctx) {
  els.startTitle.textContent = ctx.t(titleKey);
  els.start.hidden = false;
}

export function mount(rootEl, ctx) {
  root = rootEl;
  const { state, t, emit, on } = ctx;

  // Фон-подложка для полей по бокам
  const backdrop = el('img', 'backdrop', root);
  backdrop.src = 'assets/img/desk/desk.webp';
  backdrop.alt = '';
  backdrop.draggable = false;

  // Сцена
  els.stage = el('div', 'stage', root);
  const img = el('img', 'desk-photo', els.stage);
  img.src = 'assets/img/desk/desk.webp';
  img.alt = '';
  img.draggable = false;

  buildFxBelow(els.stage);

  els.monLeft = el('div', 'mon', els.stage);
  els.monLeft.id = 'monitor-left';
  els.monRight = el('div', 'mon', els.stage);
  els.monRight.id = 'monitor-right';
  layoutMonitors();
  if (typeof ResizeObserver !== 'undefined') {
    els.resizeObserver = new ResizeObserver(layoutMonitors);
    els.resizeObserver.observe(els.stage);
  } else {
    window.addEventListener('resize', layoutMonitors);
  }

  const clock = buildClock(els.stage);
  els.cells = clock.cells;
  els.colon = clock.colon;
  els.clockGlitch = 0;
  buildFxAbove(els.stage);
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

  const syncCam = () => els.stage.classList.toggle('is-cam', state.camera !== null);
  offs = [
    on('tick', ({ dt }) => {
      if (els.clockGlitch > 0) els.clockGlitch = Math.max(0, els.clockGlitch - dt);
      renderClock(state);
      updateTension(state);
    }),
    on('glitch', ({ type }) => {
      if (type !== 'clock333') return;
      els.clockGlitch = CLOCK_GLITCH_SEC;
      renderClock(state);
    }),
    on('camera:open', syncCam),
    on('camera:close', syncCam),
    on('night:start', () => {
      shownText = '';
      els.clockGlitch = 0;
      renderClock(state);
      syncCam();
      els.start.hidden = true;
    }),
    // Временно: полноценный экран итога появится на этапе 10.
    on('night:end', () => showStart('ui.shiftOver', ctx)),
  ];
}

export function unmount() {
  els.resizeObserver?.disconnect();
  offs.forEach((off) => off());
  offs = [];
  if (root) root.replaceChildren();
  root = null;
  els = {};
  shownText = '';
}