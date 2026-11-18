// Монеты: за ночь в случайные моменты появляются несколько монет — на камерах, на полу у дверей или на столе.
// Нажал на монету, когда её видно: +1 к монетам ночи и к общему счёту (flags.coins, сохраняется).
// Только логика: рисуют ui/cameras.js (монеты на камерах) и ui/desk.js (кабинет).

import { state, set, patch, emit, on } from './state.js';
import * as graph from './graph.js';

const DEFAULTS = { count: 3, fromSec: 20, toSec: 330 };
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

// Где на кадре можно лежать монете (в % кадра или стены), чтобы она не висела в воздухе и не пряталась под кнопками.
const SPOTS = {
  cam: () => ({ x: rand(15, 75), y: rand(56, 72) }),            // кадр камеры: выше кнопки звонка и HUD
  left: () => ({ x: rand(30, 66), y: rand(89, 95) }),           // пол у левой двери (левый низ закрыт плашкой токенов)
  right: () => ({ x: rand(34, 92), y: rand(89, 95) }),          // пол у правой двери
  desk: () => (Math.random() < 0.5 ? { x: rand(44, 56), y: rand(74, 78) } : { x: rand(87, 95), y: rand(85, 94) }),
};

let plan = [];   // моменты появления (секунды ночи)
let seq = 0;

export function start(cfg = {}) {
  const c = { ...DEFAULTS, ...cfg };
  plan = Array.from({ length: c.count }, () => rand(c.fromSec, c.toSec)).sort((a, b) => a - b);
}

function spawn() {
  const r = Math.random();
  const where = r < 0.55 ? 'cam' : r < 0.85 ? pick(['left', 'right']) : 'desk';
  const coin = { id: ++seq, where, cam: where === 'cam' ? pick(graph.cameraIds()) : null, ...SPOTS[where]() };
  patch('coins', (list) => [...list, coin]);
  emit('coin:spawn', coin);
}

export function update() {
  while (plan.length && state.time >= plan[0]) {
    plan.shift();
    spawn();
  }
}

// Подобрать можно только ту монету, которую сейчас видно.
function visible(c) {
  if (c.where === 'cam') return state.view === 'cams' && state.camera === c.cam && !state.brokenCams.includes(c.cam);
  return state.view === c.where;
}

on('intent:coin', ({ id } = {}) => {
  if (!state.running) return;
  const c = state.coins.find((x) => x.id === id);
  if (!c || !visible(c)) return;
  set('coins', state.coins.filter((x) => x.id !== id).map((x) => ({ ...x })));
  set('coinsNight', state.coinsNight + 1);
  set('flags.coins', (state.flags.coins || 0) + 1);
  emit('coin:collect', { id, where: c.where });
});

on('night:end', () => { plan = []; });
