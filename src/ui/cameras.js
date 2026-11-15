// Левый монитор: карта камер (этап 3) и вид камеры (этап 4).
// Только рисует и шлёт намерения. Игровой логики здесь нет.

import {
  cameraIds, cameraMeta, mapOf, mapView, positionIds, isBlind, PLAYER_POS, camerasFor, spriteDef,
} from '../graph.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const HALLS = ['s_hall1', 's_hall2', 's_hall3'];   // сегменты одного зала: границы рисуем пунктиром
const NOISE_W = 128;
const NOISE_H = 96;
const NOISE_MS = 90;
const LOAD_SEGMENTS = 5;     // максимум нагрузки по правилам: фон 1 + камера 1 + звонок 2 + починка 1
const LOAD_OVERLOAD = 5;
const AUTO_LUMA = 0.22;      // к какой средней яркости подтягиваются тёмные кадры (0..1)
const AUTO_GAIN_MAX = 2.2;   // во сколько раз максимум можно осветлить кадр   // единственное исключение из правила про таймеры: шум на canvas раз в 80–100 мс

let offs = [];
let root = null;
let els = {};
let S = null;          // state
let T = null;          // t()
let shown = null;      // номер камеры на экране или null (карта)
let noiseTimer = null;
let preload = [];
let last = {};         // последние тексты HUD, чтобы не трогать DOM зря
let gains = {};        // автояркость по камерам (из средней яркости кадра)
let tunes = {};        // ручная подстройка из отладочной панели
let sprOver = {};      // подстройка спрайтов из отладки: `${pos}:${cam}` -> {x, y, scale, pose}
let sprSig = '';       // что сейчас нарисовано в слое спрайтов
const VISIBLE = new Set(['idle', 'dash']);   // в других статусах враг пропадает с камер
const warned = new Set();

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
  const feed = (els.feed = el('div', 'cam-feed', els.frame));           // фильтр действует на всё внутри
  const world = el('div', 'cam-world', feed);              // плавный дрейф «камеры»
  els.img = el('img', 'cam-img', world);
  els.img.alt = '';
  els.img.draggable = false;
  els.img.addEventListener('error', () => console.warn(`cameras: не загрузился кадр камеры ${shown}`));
  els.sprites = el('div', 'cam-sprites', world);            // этап 6

  els.noise = el('canvas', 'cam-noise', els.frame);
  els.noise.width = NOISE_W;
  els.noise.height = NOISE_H;
  els.noiseCtx = els.noise.getContext('2d');
  els.noiseData = els.noiseCtx.createImageData(NOISE_W, NOISE_H);
  els.noise32 = new Uint32Array(els.noiseData.data.buffer);
  els.noise.addEventListener('animationend', (e) => {
    if (e.animationName === 'cam-flash') els.frame.classList.remove('is-flash');
  });

  el('div', 'cam-roll', els.frame);
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
  const load = el('div', 'hud-load', stat);
  els.hudLoadLabel = el('span', 'hud-load__label', load);
  const bar = el('span', 'hud-load__bar', load);
  els.loadSegs = [];
  for (let i = 0; i < LOAD_SEGMENTS; i++) {
    // 1–2 зелёные, 3–4 жёлтые, 5 красная
    els.loadSegs.push(el('i', i < 2 ? 'lv-g' : i < 4 ? 'lv-y' : 'lv-r', bar));
  }

  // Панель ИИ-агента: звонок-приманка
  els.call = el('button', 'cam-call', els.frame);
  els.call.type = 'button';
  onPress(els.call, () => {
    if (!els.call.disabled) emit('intent:call');
  });

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
  const hour = Math.min(6, Math.floor(S.time / 60));
  setText('time', els.hudTime, T('cams.hud.time', { h: hour === 0 ? 12 : hour }));
  setText('tokens', els.hudTokens, T('cams.hud.tokens', { v: Math.ceil(S.tokens) }));
  const over = S.load >= LOAD_OVERLOAD;
  setText('load', els.hudLoadLabel, over ? T('cams.hud.overload') : T('cams.hud.load'));
  els.hudLoadLabel.classList.toggle('is-over', over);
  const lit = Math.min(LOAD_SEGMENTS, Math.max(0, Math.round(S.load)));
  if (last.lit !== lit) {
    last.lit = lit;
    els.loadSegs.forEach((seg, i) => seg.classList.toggle('is-lit', i < lit));
  }
  syncCall();
}

function syncCall() {
  const c = S.call;
  const text = c.active ? T('agent.calling')
    : c.cooldown > 0 ? T('agent.cooldown', { s: Math.ceil(c.cooldown) })
    : T('agent.callButton');
  setText('call', els.call, text);
  const off = !S.running || S.tokens <= 0 || c.active || c.cooldown > 0;
  if (els.call.disabled !== off) els.call.disabled = off;
  els.call.classList.toggle('is-active', c.active);
}

// Яркость кадра: автоподтяжка тёмных кадров и ручная подстройка (rooms.json → tune, отладка)
function applyLook(cam) {
  if (!els.feed) return;
  const tune = { ...(cameraMeta(cam)?.tune || {}), ...(tunes[cam] || {}) };
  const b = (gains[cam] ?? 1) * (tune.brightness ?? 1);
  const c = tune.contrast ?? 1;
  els.feed.style.setProperty('--cam-b', b.toFixed(3));
  els.feed.style.setProperty('--cam-c', c.toFixed(3));
}

function measureGain(cam, im) {
  try {
    const cv = document.createElement('canvas');
    cv.width = 32;
    cv.height = 24;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(im, 0, 0, 32, 24);
    const d = cx.getImageData(0, 0, 32, 24).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
    const mean = sum / (d.length / 4);
    gains[cam] = Math.min(AUTO_GAIN_MAX, Math.max(1, AUTO_LUMA / Math.max(mean, 0.01)));
  } catch (e) {
    console.warn(`cameras: не удалось измерить яркость кадра ${cam}`, e);
  }
  if (shown === cam) applyLook(cam);
}

// ---------- спрайты врагов ----------
// Кто виден на открытой камере, решают state.enemies и graph.camerasFor(); здесь только рисуем.
function renderSprites() {
  if (shown === null || !els.sprites) return;
  const list = [];
  for (const [eid, e] of Object.entries(S.enemies)) {
    if (!e || !VISIBLE.has(e.status ?? 'idle')) continue;
    const entry = camerasFor(e.pos).find((c) => c.cam === shown);
    if (!entry) continue;
    list.push({ eid, ...entry, ...(sprOver[`${e.pos}:${shown}`] || {}) });
  }
  const sig = shown + '|' + JSON.stringify(list);
  if (sig === sprSig) return;
  sprSig = sig;
  els.sprites.replaceChildren();
  for (const s of list) {
    const def = spriteDef(s.eid, s.pose);
    if (!def) {
      const key = `${s.eid}:${s.pose}`;
      if (!warned.has(key)) { warned.add(key); console.warn(`cameras: нет описания позы «${s.pose}» для ${s.eid}`); }
      continue;
    }
    const wrap = el('div', 'cam-spr', els.sprites);
    if (s.clip) {
      const { x1, y1, x2, y2 } = s.clip;
      wrap.style.clipPath = `inset(${y1}% ${100 - x2}% ${100 - y2}% ${x1}%)`;
    }
    const im = el('img', '', wrap);
    im.alt = '';
    im.draggable = false;
    im.src = def.img;
    im.style.left = `${s.x}%`;
    im.style.top = `${s.y}%`;
    im.style.height = `${def.h * s.scale}%`;
    im.style.transform = `translate(${-(def.ax ?? 0.5) * 100}%, -100%)`;
    // дальние фигуры темнее
    im.style.filter = `brightness(${(0.6 + 0.4 * Math.min(1, s.scale)).toFixed(2)})`;
  }
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
    applyLook(cam);
    last = {};
    setText('name', els.hudName, T('cams.caption', { n: cam, name: T(meta.name) }));
    for (const [c, b] of Object.entries(els.sbtns)) b.classList.toggle('cam-sbtn--active', Number(c) === cam);
    els.broken = isBroken(cam);
    applyBroken(els.broken, true);
    syncHud();
    flash();
  }
  renderSprites();
  startNoise();
}

function hideView() {
  shown = null;
  els.map?.classList.remove('is-hidden');
  els.view?.classList.remove('is-open');
  els.sprites?.replaceChildren();
  sprSig = '';
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
    im.onload = () => measureGain(cam, im);
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
    on('debug:sprite', ({ pos, cam, x, y, scale, pose }) => {
      sprOver[`${pos}:${cam}`] = { x, y, scale, pose };
      renderSprites();
    }),
    on('debug:tune', ({ cam, brightness, contrast }) => {
      tunes[cam] = { brightness, contrast };
      if (shown === cam) applyLook(cam);
    }),
    // Поломка камеры и HUD читаются из state раз в кадр; своих игровых таймеров нет.
    on('tick', () => {
      if (shown === null) return;
      syncHud();
      renderSprites();
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
  gains = {};
  tunes = {};
  sprOver = {};
  sprSig = '';
}