// Левый монитор. На этапе 3: карта камер в стиле FNaF. Вид камеры на весь экран добавится на этапе 4.
// Только рисует и шлёт намерения. Игровой логики здесь нет.

import { cameraIds, cameraMeta, mapOf, mapView, positionIds, isBlind, PLAYER_POS } from '../graph.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const HALLS = ['s_hall1', 's_hall2', 's_hall3'];   // сегменты одного зала: границы рисуем пунктиром

let offs = [];
let root = null;
let els = {};

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

export function mount(rootEl, ctx) {
  root = rootEl;
  const { state, t, emit, on } = ctx;
  const view = mapView();
  if (!view) {
    console.warn('cameras: в rooms.json нет mapView');
    return;
  }
  const [W, H] = view.size;

  const map = el('div', 'cam-map', root);
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
      wc.textContent = t('cams.map.wc');
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
  you.textContent = t('cams.map.you');

  // Кнопки камер
  els.buttons = {};
  for (const cam of cameraIds()) {
    const meta = cameraMeta(cam);
    if (!meta.btn) continue;
    const btn = el('button', 'cam-btn', map);
    btn.type = 'button';
    btn.style.left = `${meta.btn.x}px`;
    btn.style.top = `${meta.btn.y}px`;
    el('small', '', btn).textContent = t('cams.map.cam');
    el('span', '', btn).textContent = String(cam);
    btn.setAttribute('aria-label', t('cams.caption', { n: cam, name: t(meta.name) }));
    btn.addEventListener('pointerup', (e) => {
      if (e.button > 0) return;
      emit('intent:openCamera', { id: cam });
    });
    els.buttons[cam] = btn;
  }

  els.caption = el('div', 'cam-caption', map);

  const refresh = () => {
    const open = state.camera;
    for (const [cam, btn] of Object.entries(els.buttons)) {
      btn.classList.toggle('cam-btn--active', Number(cam) === open);
    }
    if (open) {
      const meta = cameraMeta(open);
      els.caption.textContent = t('cams.caption', { n: open, name: meta ? t(meta.name) : '' });
    } else {
      els.caption.textContent = t('cams.map.hint');
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
  ];
}

export function unmount() {
  offs.forEach((off) => off());
  offs = [];
  if (root) root.replaceChildren();
  root = null;
  els = {};
}
