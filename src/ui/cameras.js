// Левый монитор: карта камер (этап 3) и вид камеры (этап 4).
// Только рисует и шлёт намерения. Игровой логики здесь нет.

import { cameraIds, cameraMeta, mapOf, mapView, positionIds, isBlind, PLAYER_POS } from '../graph.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const HALLS = ['s_hall1', 's_hall2', 's_hall3'];   // сегменты одного зала: границы рисуем пунктиром
const NOISE_W = 128;
const NOISE_H = 96;
const NOISE_MS = 90;   // единственное исключение из правила про таймеры: шум на canvas раз в 80–100 мс

let offs = [];
let root = null;
let els = {};
let S = null;          // state
let T = null;          // t()
let shown = null;      // номер камеры на экране или null (карта)
let noiseTimer = null;
let preload = [];
let last = {};         // последние тексты HUD, чтобы не трогать DOM зря

function el(tag, className, parent) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (parent) parent.appendChild(e);
  return e;
}

function svg(tag, attrs, parent) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

function onPress(node, fn) {
  node.addEventListener('pointerup', (e) => {
    if (e.button > 0) return;
    fn(e);
  });
}

// ---------- карта ----------
function buildMap(parent, ctx) {
  const { emit } = ctx;
  const view = mapView();
  if (!view) {
    console.warn('cameras: в rooms.json нет mapView');
    return null;
  }
  const [W, H] = view.size;

  const map = el('div', 'cam-map', parent);
  const canvas = svg('svg', { class: 'cam-svg', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none' }, map);

  // Контуры комнат
  els.rooms = {};
  for (const id of positionIds()) {
    const m = mapOf(id);
    if (!m) continue;
    const cls = HALLS.includes(id) ? 'room room--hall' : 'room';
    const shapes = [m, ...m.extra].map((r) =>
      svg('rect', { class: cls, x: r.x, y: r.y, width: r.w, height: r.h }, canvas));
    els.rooms[id] = shapes;
    if (isBlind(id) && id !== PLAYER_POS) {
      const wc = svg('text', { class: 'wc', x: m.x + m.w / 2, y: m.y + m.h / 2 }, canvas);
      wc.textContent = T('cams.map.wc');
    }
  }
  // Общий контур южного зала поверх пунктирных сегментов
  for (const poly of view.outlines) {
    svg('polygon', { class: 'outline', points: poly.map(([x, y]) => `${x},${y}`).join(' ') }, canvas);
  }
  // Двери: разрывы в стенах
  for (const d of view.doors) {
    svg('rect', { class: 'door', x: d.x, y: d.y, width: d.w, height: d.h }, canvas);
  }
  // Место игрока
  svg('rect', { class: 'you-box', x: view.you.x - 4, y: view.you.y - 4, width: 8, height: 8 }, canvas);
  const you = svg('text', { class: 'you-text', x: view.you.x, y: view.you.y - 9 }, canvas);
  you.textContent = T('cams.map.you');

  // Кнопки камер
  els.buttons = {};
  for (const cam of cameraIds()) {
    const meta = cameraMeta(cam);
    if (!meta.btn) continue;
    const btn = el('button', 'cam-btn', map);
    btn.type = 'button';
    btn.style.left = `${meta.btn.x}px`;
    btn.style.top = `${meta.btn.y}px`;
    el('small', '', btn).textContent = T('cams.map.cam');
    el('span', '', btn).textContent = String(cam);
    btn.setAttribute('aria-label', T('cams.caption', { n: cam, name: T(meta.name) }));
    onPress(btn, () => emit('intent:openCamera', { id: cam }));
    els.buttons[cam] = btn;
  }

  els.caption = el('div', 'cam-caption', map);
  return map;
}

// ---------- вид камеры ----------
function buildView(parent, ctx) {
  const { emit } = ctx;
  const view = el('div', 'cam-view', parent);

  els.frame = el('div', 'cam-frame', view);
  const feed = el('div', 'cam-feed', els.frame);           // фильтр действует на всё внутри
  els.img = el('img', 'cam-img', feed);
  els.img.alt = '';
  els.img.draggable = false;
  els.img.addEventListener('error', () => console.warn(`cameras: не загрузился кадр камеры ${shown}`));
  els.sprites = el('div', 'cam-sprites', feed);            // этап 6

  els.noise = el('canvas', 'cam-noise', els.frame);
  els.noise.width = NOISE_W;
  els.noise.height = NOISE_H;
  els.noiseCtx = els.noise.getContext('2d');
  els.noiseData = els.noiseCtx.createImageData(NOISE_W, NOISE_H);
  els.noise32 = new Uint32Array(els.noiseData.data.buffer);
  els.noise.addEventListener('animationend', (e) => {
    if (e.animationName === 'cam-flash') els.frame.classList.remove('is-flash');
  });

  el('div', 'cam-scan', els.frame);

  // Сломанная камера
  els.error = el('div', 'cam-error', els.frame);
  els.error.hidden = true;
  el('div', 'cam-error__title', els.error).textContent = T('cams.broken.error');
  els.reboot = el('button', 'cam-error__btn', els.error);
  els.reboot.type = 'button';
  els.reboot.textContent = T('cams.broken.reboot');
  onPress(els.reboot, () => {
    if (shown === null || els.reboot.disabled) return;
    els.reboot.disabled = true;
    els.reboot.textContent = T('cams.broken.rebooting');
    emit('intent:reboot', { cam: shown });
  });

  // HUD
  const hud = el('div', 'cam-hud', els.frame);
  el('div', 'hud-rec', hud).textContent = T('cams.hud.rec');
  els.hudTime = el('div', 'hud-time', hud);
  els.hudName = el('div', 'hud-name', hud);
  const stat = el('div', 'hud-stat', hud);
  els.hudTokens = el('div', '', stat);
  els.hudLoad = el('div', '', stat);

  // Колонка справа: переключение камер и возврат на карту
  const side = el('div', 'cam-side', view);
  const grid = el('div', 'cam-grid', side);
  els.sbtns = {};
  for (const cam of cameraIds()) {
    const meta = cameraMeta(cam);
    const btn = el('button', 'cam-sbtn', grid);
    btn.type = 'button';
    el('small', '', btn).textContent = T('cams.map.cam');
    el('span', '', btn).textContent = String(cam);
    btn.setAttribute('aria-label', T('cams.caption', { n: cam, name: T(meta.name) }));
    onPress(btn, () => emit('intent:openCamera', { id: cam }));
    els.sbtns[cam] = btn;
  }
  const back = el('button', 'cam-back', side);
  back.type = 'button';
  back.textContent = T('cams.back');
  onPress(back, () => emit('intent:closeCamera'));

  return view;
}

function drawNoise() {
  const buf = els.noise32;
  for (let i = 0; i < buf.length; i++) {
    const v = (Math.random() * 256) | 0;
    buf[i] = 0xff000000 | (v << 16) | (v << 8) | v;
  }
  els.noiseCtx.putImageData(els.noiseData, 0, 0);
}

function startNoise() {
  if (noiseTimer !== null) return;
  drawNoise();
  noiseTimer = setInterval(drawNoise, NOISE_MS);
}

function stopNoise() {
  if (noiseTimer === null) return;
  clearInterval(noiseTimer);
  noiseTimer = null;
}

function flash() {
  if (!els.frame) return;
  els.frame.classList.remove('is-flash');
  void els.frame.offsetWidth;           // перезапуск CSS-анимации
  els.frame.classList.add('is-flash');
}

const isBroken = (cam) => S.brokenCams.includes(cam);

function applyBroken(broken, resetBtn) {
  els.frame.classList.toggle('is-broken', broken);
  els.error.hidden = !broken;
  if (resetBtn || !broken) {
    els.reboot.disabled = false;
    els.reboot.textContent = T('cams.broken.reboot');
  }
}

function setText(key, node, text) {
  if (last[key] === text) return;
  last[key] = text;
  node.textContent = text;
}

function syncHud() {
  const m = Math.min(360, Math.floor(S.time));
  const hour = Math.floor(m / 60);
  setText('time', els.hudTime,
    T('cams.hud.time', { h: hour === 0 ? 12 : hour, m: String(m % 60).padStart(2, '0') }));
  setText('tokens', els.hudTokens, T('cams.hud.tokens', { v: Math.ceil(S.tokens) }));
  const over = S.load >= 5;
  setText('load', els.hudLoad, over ? T('cams.hud.overload') : T('cams.hud.load', { v: S.load }));
  els.hudLoad.classList.toggle('is-over', over);
}

function showView(cam) {
  const meta = cameraMeta(cam);
  if (!meta) return;
  const changed = shown !== cam;
  shown = cam;
  els.map.classList.add('is-hidden');
  els.view.classList.add('is-open');
  if (changed) {
    if (meta.img) els.img.src = meta.img;
    else {
      els.img.removeAttribute('src');
      console.warn(`cameras: у камеры ${cam} нет img в rooms.json`);
    }
    last = {};
    setText('name', els.hudName, T('cams.caption', { n: cam, name: T(meta.name) }));
    for (const [c, b] of Object.entries(els.sbtns)) b.classList.toggle('cam-sbtn--active', Number(c) === cam);
    els.broken = isBroken(cam);
    applyBroken(els.broken, true);
    syncHud();
    flash();
  }
  startNoise();
}

function hideView() {
  shown = null;
  els.map?.classList.remove('is-hidden');
  els.view?.classList.remove('is-open');
  stopNoise();
}

// ---------- модуль ----------
export function mount(rootEl, ctx) {
  root = rootEl;
  S = ctx.state;
  T = ctx.t;
  const { on } = ctx;

  els.map = buildMap(root, ctx);
  if (!els.map) return;
  els.view = buildView(root, ctx);

  // Кадры камер подгружаем заранее, чтобы переключение не мигало пустотой
  preload = cameraIds().map((cam) => {
    const src = cameraMeta(cam)?.img;
    if (!src) return null;
    const im = new Image();
    im.src = src;
    return im;
  });

  const refresh = () => {
    const open = S.camera;
    for (const [cam, btn] of Object.entries(els.buttons)) {
      btn.classList.toggle('cam-btn--active', Number(cam) === open);
    }
    if (open) {
      const meta = cameraMeta(open);
      els.caption.textContent = T('cams.caption', { n: open, name: meta ? T(meta.name) : '' });
      showView(open);
    } else {
      els.caption.textContent = T('cams.map.hint');
      hideView();
    }
  };
  refresh();

  // Подсветка позиции из отладочной панели
  const highlight = ({ pos, neighbors = [] } = {}) => {
    for (const [id, shapes] of Object.entries(els.rooms)) {
      for (const r of shapes) {
        r.classList.toggle('room--hl', id === pos);
        r.classList.toggle('room--nb', id !== pos && neighbors.includes(id));
      }
    }
  };

  offs = [
    on('camera:open', refresh),
    on('camera:close', refresh),
    on('night:start', refresh),
    on('debug:highlight', highlight),
    on('debug:flash', () => { if (shown !== null) flash(); }),
    // Поломка камеры и HUD читаются из state раз в кадр; своих игровых таймеров нет.
    on('tick', () => {
      if (shown === null) return;
      syncHud();
      const broken = isBroken(shown);
      if (broken !== els.broken) {
        els.broken = broken;
        applyBroken(broken, false);
      }
    }),
  ];
}

export function unmount() {
  stopNoise();
  offs.forEach((off) => off());
  offs = [];
  preload = [];
  if (root) root.replaceChildren();
  root = null;
  els = {};
  shown = null;
  last = {};
}