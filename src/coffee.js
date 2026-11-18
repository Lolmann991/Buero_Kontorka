// Усталость и кофемашина.
// Усталость растёт всю ночь (перс. на ночь в nights.json → fatigue). Чем выше, тем чаще игрок моргает,
// на 100 начинается «микросон» (рисует ui/desk.js). Кофе снимает усталость, но кофемашина шумит:
// событие noise зовёт врага к залу у левой двери (s_hall1), и он может оттуда напасть.
// Пока машина варит, нагрузка +2 (state.recalcLoad). Только логика, рисует ui/desk.js.

import { state, set, emit, on, recalcLoad } from './state.js';

const DEFAULTS = { start: 0, perSec: 0.35, coffee: 65, brewSec: 4.5, cooldownSec: 25, noiseAt: 's_hall1' };
let cfg = { ...DEFAULTS };

export function start(c = {}) {
  cfg = { ...DEFAULTS, ...c };
}

function stopBrew(reason) {
  if (!state.coffee.brewing) return;
  set('coffee', { brewing: false, left: 0, cooldown: 0 });
  recalcLoad();
  emit('coffee:cancel', { reason });
}

// Нажать на кофемашину можно, только глядя на левую стену (там она стоит).
on('intent:coffee', () => {
  if (!state.running || state.tokens <= 0 || state.view !== 'left') return;
  const c = state.coffee;
  if (c.brewing || c.cooldown > 0) return;
  set('coffee', { brewing: true, left: cfg.brewSec, cooldown: 0 });
  recalcLoad();
  emit('coffee:start');
  emit('noise', { at: cfg.noiseAt, kind: 'coffee' });
});

export function update(dt) {
  set('fatigue', Math.min(100, state.fatigue + cfg.perSec * dt));
  const c = state.coffee;
  if (c.brewing) {
    const left = c.left - dt;
    if (left > 0) { set('coffee.left', left); return; }
    set('coffee', { brewing: false, left: 0, cooldown: cfg.cooldownSec });
    set('fatigue', Math.max(0, state.fatigue - cfg.coffee));
    recalcLoad();
    emit('coffee:done');
  } else if (c.cooldown > 0) {
    set('coffee.cooldown', Math.max(0, c.cooldown - dt));
  }
}

on('tokens:change', ({ value }) => { if (value <= 0) stopBrew('power'); });
on('night:end', () => stopBrew('end'));
