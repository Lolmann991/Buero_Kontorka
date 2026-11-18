// Украшения кабинета (рисунок) и магазин в меню. Покупку и «убрать/поставить» решает src/deco.js.
// Каждое украшение рисуется SVG в координатах своего слоя: desk — фото стола (1672×941), right — правая стена (1170×941).
// Тот же рисунок идёт в превью магазина (viewBox = box украшения).

import { ITEMS, owned, placed } from '../deco.js';

const NS = 'http://www.w3.org/2000/svg';
const LAYER_VIEW = { desk: '0 0 1672 941', right: '0 0 1170 941' };

function svg(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}
function el(tag, className, parent) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (parent) parent.appendChild(e);
  return e;
}

let gradSeq = 0;
function grad(defs, type, stops, attrs = {}) {
  const id = `deco-g${++gradSeq}`;
  const g = svg(type, { id, ...attrs }, defs);
  for (const [o, c] of stops) svg('stop', { offset: o, 'stop-color': c }, g);
  return `url(#${id})`;
}

const MARKER = '"Marker Felt", "Segoe Print", "Comic Sans MS", cursive';

// box: [x, y, w, h] — для превью; draw(g, defs, t)
const ART = {
  duck: {
    box: [785, 672, 110, 82],
    draw(g, defs) {
      svg('ellipse', { cx: 840, cy: 748, rx: 46, ry: 6, fill: 'rgba(0,0,0,0.5)' }, g);
      svg('ellipse', { cx: 836, cy: 726, rx: 40, ry: 24, fill: grad(defs, 'radialGradient', [[0, '#f6d860'], [1, '#a8811a']], { cx: 0.4, cy: 0.3 }) }, g);
      svg('path', { d: 'M800,720 q-10,-14 4,-16 q4,8 6,14 z', fill: '#c99c22' }, g);                // хвост
      svg('circle', { cx: 860, cy: 700, r: 19, fill: grad(defs, 'radialGradient', [[0, '#f8de6a'], [1, '#b08a1c']], { cx: 0.4, cy: 0.3 }) }, g);
      svg('path', { d: 'M874,700 q16,1 16,7 q-8,5 -18,1 z', fill: '#e07a1c' }, g);                 // клюв
      svg('circle', { cx: 866, cy: 695, r: 3, fill: '#111' }, g);
      svg('path', { d: 'M820,726 q14,10 30,0', fill: 'none', stroke: '#b8901c', 'stroke-width': 3 }, g); // крыло
      svg('circle', { cx: 846, cy: 734, r: 4, fill: 'rgba(60,40,10,0.35)' }, g);                     // пятно
    },
  },
  mug: {
    box: [1412, 776, 136, 112],
    draw(g, defs, t) {
      svg('ellipse', { cx: 1470, cy: 880, rx: 44, ry: 7, fill: 'rgba(0,0,0,0.55)' }, g);
      svg('path', { d: 'M1508,800 q30,4 28,30 q-2,24 -28,24', fill: 'none', stroke: '#c9c3b2', 'stroke-width': 10 }, g);
      svg('rect', { x: 1432, y: 792, width: 78, height: 88, rx: 8, fill: grad(defs, 'linearGradient', [[0, '#8a867b'], [0.35, '#e2ddcd'], [1, '#77736a']]) }, g);
      svg('ellipse', { cx: 1471, cy: 794, rx: 39, ry: 7, fill: '#2a170b', stroke: '#d8d2c2', 'stroke-width': 3 }, g);
      svg('path', { d: 'M1446,796 q2,22 -2,40', stroke: 'rgba(80,45,15,0.6)', 'stroke-width': 4, fill: 'none' }, g);  // кофейный потёк
      const tx = svg('text', { x: 1471, y: 830, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 800, fill: '#2b3d7a',
        'font-family': 'system-ui, sans-serif' }, g);
      t('deco.mug.text').split('\n').forEach((line, i) => { svg('tspan', { x: 1471, dy: i ? 15 : 0 }, tx).textContent = line; });
      svg('path', { d: 'M1432,808 l8,-6 l-2,10 z', fill: '#4a463e' }, g);                          // скол
    },
  },
  poster: {
    box: [915, 40, 205, 200],
    draw(g, defs, t) {
      const r = svg('g', { transform: 'rotate(-2 1018 140)' }, g);
      svg('rect', { x: 930, y: 55, width: 175, height: 170, fill: grad(defs, 'linearGradient', [[0, '#3c5a7a'], [0.6, '#9a6a4a'], [1, '#c7925a']], { x1: 0, y1: 0, x2: 0, y2: 1 }), opacity: 0.8 }, r);
      svg('line', { x1: 940, y1: 92, x2: 1095, y2: 84, stroke: '#2b1d10', 'stroke-width': 6 }, r);       // ветка
      svg('path', { d: 'M1004,88 q-3,22 2,34', stroke: '#141414', 'stroke-width': 5, fill: 'none' }, r);  // лапы
      svg('path', { d: 'M1022,87 q3,22 -2,34', stroke: '#141414', 'stroke-width': 5, fill: 'none' }, r);
      svg('ellipse', { cx: 1013, cy: 140, rx: 18, ry: 26, fill: '#141414' }, r);                        // кот висит
      svg('circle', { cx: 1013, cy: 112, r: 13, fill: '#141414' }, r);
      svg('path', { d: 'M1002,104 l2,-12 l7,8 z M1024,104 l-2,-12 l-7,8 z', fill: '#141414' }, r);
      svg('path', { d: 'M1013,164 q14,12 6,28', stroke: '#141414', 'stroke-width': 5, fill: 'none' }, r);
      const tx = svg('text', { x: 1018, y: 210, 'text-anchor': 'middle', 'font-size': 20, 'font-weight': 900, fill: '#f3ead2',
        'font-family': 'Impact, "Arial Black", system-ui, sans-serif', 'letter-spacing': 1 }, r);
      tx.textContent = t('deco.poster.text');
      svg('path', { d: 'M1105,225 l-26,0 l26,-24 z', fill: '#0e100f' }, r);                            // оторванный угол
      for (const [x, y, a] of [[932, 52, -20], [1086, 50, 25]]) {
        svg('rect', { x, y, width: 26, height: 10, fill: 'rgba(210,200,160,0.55)', transform: `rotate(${a} ${x + 13} ${y + 5})` }, r);
      }
      svg('rect', { x: 930, y: 55, width: 175, height: 170, fill: 'rgba(30,25,15,0.3)' }, r);           // пыль
    },
  },
  plant: {
    box: [925, 500, 210, 325],
    draw(g, defs) {
      svg('ellipse', { cx: 1022, cy: 815, rx: 70, ry: 9, fill: 'rgba(0,0,0,0.55)' }, g);
      const leaf = (x, y, rot, len, col) => svg('ellipse', { cx: x, cy: y - len / 2, rx: len * 0.18, ry: len / 2, fill: col,
        transform: `rotate(${rot} ${x} ${y})` }, g);
      const c1 = '#1f3a1e', c2 = '#2b4d24', dry = '#5a4a22';
      for (const [rot, len, col] of [[-55, 150, c1], [-30, 190, c2], [-8, 230, c1], [12, 210, c2], [34, 180, c1], [58, 140, c2], [-70, 110, dry], [75, 100, c1]]) {
        leaf(1022, 728, rot, len, col);
      }
      svg('path', { d: 'M1022,728 l-6,-120 M1022,728 l18,-150', stroke: '#2a3a20', 'stroke-width': 4 }, g);
      svg('path', { d: 'M972,722 h100 l-14,92 h-72 z', fill: grad(defs, 'linearGradient', [[0, '#7a3e22'], [0.5, '#a3593a'], [1, '#5a2c18']], { x1: 0, y1: 0, x2: 1, y2: 0 }) }, g);
      svg('rect', { x: 966, y: 714, width: 112, height: 16, rx: 3, fill: '#8a4628' }, g);
      svg('path', { d: 'M990,736 l6,30 l-4,26', stroke: 'rgba(30,15,8,0.6)', 'stroke-width': 2, fill: 'none' }, g);   // трещина
      svg('ellipse', { cx: 1040, cy: 760, rx: 16, ry: 22, fill: 'rgba(210,200,170,0.15)' }, g);                       // известь
      svg('ellipse', { cx: 1000, cy: 812, rx: 6, ry: 3, fill: '#3a2414' }, g);                                          // земля рядом
    },
  },
  lights: {
    box: [40, 34, 1600, 110],
    draw(g) {
      const pts = [];
      const path = (x0, y0, x1, y1, sag) => {
        svg('path', { d: `M${x0},${y0} Q${(x0 + x1) / 2},${y0 + sag} ${x1},${y1}`, fill: 'none', stroke: '#0c0d0c', 'stroke-width': 3 }, g);
        for (let k = 0.06; k < 1; k += 0.095) {
          const mx = (x0 + x1) / 2, my = y0 + sag;
          const x = (1 - k) ** 2 * x0 + 2 * (1 - k) * k * mx + k * k * x1;
          const y = (1 - k) ** 2 * y0 + 2 * (1 - k) * k * my + k * k * y1;
          pts.push([x, y]);
        }
      };
      path(60, 50, 830, 60, 70);
      path(830, 60, 1630, 48, 64);
      const cols = ['#ff4a3a', '#ffd23a', '#3ad1ff', '#7dff6a', '#ff6ad9'];
      pts.forEach(([x, y], i) => {
        const b = svg('g', { class: 'deco-bulb', style: `animation-delay:${-(i * 0.37) % 2.4}s` }, g);
        svg('circle', { cx: x, cy: y + 12, r: 16, fill: cols[i % cols.length], opacity: 0.22 }, b);
        svg('ellipse', { cx: x, cy: y + 11, rx: 5, ry: 8, fill: cols[i % cols.length] }, b);
        svg('rect', { x: x - 3, y: y, width: 6, height: 5, fill: '#1a1a1a' }, g);
      });
    },
  },
  lava: {
    box: [140, 580, 130, 180],
    draw(g, defs) {
      svg('ellipse', { cx: 205, cy: 690, rx: 70, ry: 90, fill: grad(defs, 'radialGradient', [[0, 'rgba(255,90,40,0.35)'], [1, 'rgba(255,60,20,0)']]), class: 'deco-lava-glow' }, g);
      svg('ellipse', { cx: 205, cy: 752, rx: 40, ry: 6, fill: 'rgba(0,0,0,0.6)' }, g);
      svg('path', { d: 'M180,700 L230,700 L240,750 L170,750 Z', fill: grad(defs, 'linearGradient', [[0, '#4a4a4c'], [0.5, '#9a9a9e'], [1, '#38383a']], { x1: 0, y1: 0, x2: 1, y2: 0 }) }, g);
      svg('path', { d: 'M188,612 L222,612 L232,700 L178,700 Z', fill: grad(defs, 'linearGradient', [[0, '#ff7a2a'], [1, '#c8261a']], { x1: 0, y1: 0, x2: 0, y2: 1 }), opacity: 0.85 }, g);
      const blobs = svg('g', { 'clip-path': 'none' }, g);
      svg('ellipse', { class: 'deco-blob deco-blob--a', cx: 203, cy: 680, rx: 10, ry: 13, fill: '#ffd04a' }, blobs);
      svg('ellipse', { class: 'deco-blob deco-blob--b', cx: 211, cy: 650, rx: 7, ry: 9, fill: '#ffc23a' }, blobs);
      svg('ellipse', { class: 'deco-blob deco-blob--c', cx: 198, cy: 630, rx: 6, ry: 7, fill: '#ffe06a' }, blobs);
      svg('path', { d: 'M192,600 L218,600 L222,612 L188,612 Z', fill: '#77777a' }, g);
      svg('path', { d: 'M190,616 l6,80', stroke: 'rgba(255,255,255,0.25)', 'stroke-width': 3 }, g);
    },
  },
};

let els = {};
let offs = [];

function render(T) {
  for (const [layer, root] of Object.entries(els.layers)) {
    root.replaceChildren();
    const defs = svg('defs', {}, root);
    for (const item of ITEMS) {
      if (item.layer !== layer || !placed(item.id)) continue;
      ART[item.id].draw(svg('g', { class: `deco deco--${item.id}` }, root), defs, T);
    }
  }
}

function renderShop(ctx) {
  const { t, emit, state } = ctx;
  const coins = state.flags.coins || 0;
  els.shopCoins.textContent = t('shop.coins', { n: coins });
  els.grid.replaceChildren();
  for (const item of ITEMS) {
    const card = el('div', `shop-card${owned(item.id) ? ' is-owned' : ''}`, els.grid);
    const [x, y, w, h] = ART[item.id].box;
    const pv = svg('svg', { class: 'shop-pv', viewBox: `${x} ${y} ${w} ${h}` }, card);
    ART[item.id].draw(svg('g', {}, pv), svg('defs', {}, pv), t);
    el('b', 'shop-name', card).textContent = t(`deco.${item.id}.name`);
    el('p', 'shop-desc', card).textContent = t(`deco.${item.id}.desc`);
    const btn = el('button', 'shop-btn', card);
    btn.type = 'button';
    if (!owned(item.id)) {
      btn.textContent = t('shop.buy', { n: item.price });
      btn.disabled = coins < item.price;
      btn.addEventListener('pointerup', (e) => { if (e.button <= 0 && !btn.disabled) emit('intent:buyDeco', { id: item.id }); });
    } else {
      btn.textContent = placed(item.id) ? t('shop.hide') : t('shop.show');
      btn.classList.add('shop-btn--ghost');
      btn.addEventListener('pointerup', (e) => { if (e.button <= 0) emit('intent:toggleDeco', { id: item.id }); });
    }
  }
}

export function mount(root, ctx) {
  const { t, on, emit } = ctx;
  const scene = root.querySelector('.scene');
  const right = root.querySelector('.side--right');
  els.layers = {
    desk: svg('svg', { class: 'deco-layer', viewBox: LAYER_VIEW.desk, preserveAspectRatio: 'none' }, scene),
    right: svg('svg', { class: 'deco-layer', viewBox: LAYER_VIEW.right, preserveAspectRatio: 'none' }),
  };
  right.insertBefore(els.layers.right, right.querySelector('.door-plate'));

  // магазин
  els.shop = el('div', 'shop', root);
  els.shop.hidden = true;
  const box = el('div', 'shop-box', els.shop);
  const head = el('div', 'shop-head', box);
  el('h2', 'shop-title', head).textContent = t('shop.title');
  els.shopCoins = el('span', 'shop-coins', head);
  el('p', 'shop-hint', box).textContent = t('shop.hint');
  els.grid = el('div', 'shop-grid', box);
  const close = el('button', 'start-btn shop-close', box);
  close.type = 'button';
  close.textContent = t('shop.close');
  close.addEventListener('pointerup', (e) => { if (e.button <= 0) { els.shop.hidden = true; emit('ui:menu'); } });

  render(t);
  offs = [
    on('ui:shop', () => { renderShop(ctx); els.shop.hidden = false; }),
    on('deco:change', () => { render(t); if (!els.shop.hidden) renderShop(ctx); }),
    on('night:start', () => { els.shop.hidden = true; }),
  ];
}

export function unmount() {
  offs.forEach((off) => off());
  offs = [];
  Object.values(els.layers || {}).forEach((n) => n.remove());
  els.shop?.remove();
  els = {};
}
