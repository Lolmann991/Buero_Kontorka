// Левый монитор. На этапе 3: карта камер. Вид камеры на весь экран добавится на этапе 4.
// Только рисует и шлёт намерения. Игровой логики здесь нет.

import { cameraIds, cameraMeta, mapOf, positionIds, isBlind, PLAYER_POS } from '../graph.js';

let offs = [];
let root = null;
let els = {};

function el(tag, className, parent) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (parent) parent.appendChild(e);
  return e;
}

export function mount(rootEl, ctx) {
  root = rootEl;
  const { state, t, emit, on } = ctx;

  const map = el('div', 'cam-map', root);

  // Комнаты (контуры). Позиции без прямоугольника на карте пропускаем.
  els.rooms = {};
  for (const id of positionIds()) {
    const m = mapOf(id);
    if (!m) continue;
    const room = el('div', 'cam-room', map);
    if (id === PLAYER_POS) {
      room.classList.add('cam-room--desk');
      room.textContent = t('cams.map.you');
    } else if (isBlind(id)) {
      room.classList.add('cam-room--blind');
    }
    room.style.left = `${m.x}%`;
    room.style.top = `${m.y}%`;
    room.style.width = `${m.w}%`;
    room.style.height = `${m.h}%`;
    els.rooms[id] = room;
  }

  // Кнопки камер в центре своей комнаты
  els.buttons = {};
  for (const cam of cameraIds()) {
    const meta = cameraMeta(cam);
    const m = mapOf(meta.pos);
    if (!m) continue;
    const btn = el('button', 'cam-btn', map);
    btn.type = 'button';
    btn.textContent = String(cam);
    btn.setAttribute('aria-label', t('cams.caption', { n: cam, name: t(meta.name) }));
    btn.style.left = `${m.x + m.w / 2}%`;
    btn.style.top = `${m.y + m.h / 2}%`;
    btn.addEventListener('pointerup', (e) => {
      if (e.button > 0) return;
      emit('intent:openCamera', { id: cam });
    });
    els.buttons[cam] = btn;
  }

  els.caption = el('div', 'cam-caption', root);

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
    for (const [id, room] of Object.entries(els.rooms)) {
      room.classList.toggle('cam-room--hl', id === pos);
      room.classList.toggle('cam-room--nb', id !== pos && neighbors.includes(id));
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
