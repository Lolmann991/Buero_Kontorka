// Украшения кабинета за монеты: каталог, покупка, убрать/поставить. Рисует ui/deco.js.
// Купленное лежит в flags.deco, убранное в flags.decoOff (оба сохраняются вместе с монетами).

import { state, set, emit, on, save } from './state.js';

// layer: где стоит (desk — на столе/над мониторами, left/right — у стены с дверью)
export const ITEMS = [
  { id: 'duck', price: 5, layer: 'desk' },
  { id: 'mug', price: 8, layer: 'desk' },
  { id: 'poster', price: 10, layer: 'right' },
  { id: 'plant', price: 12, layer: 'right' },
  { id: 'lights', price: 15, layer: 'desk' },
  { id: 'lava', price: 20, layer: 'desk' },
];

export const owned = (id) => (state.flags.deco || []).includes(id);
export const placed = (id) => owned(id) && !(state.flags.decoOff || []).includes(id);

on('intent:buyDeco', ({ id } = {}) => {
  const item = ITEMS.find((x) => x.id === id);
  if (!item || owned(id) || state.running) return;
  const coins = state.flags.coins || 0;
  if (coins < item.price) { emit('deco:denied', { id }); return; }
  set('flags.coins', coins - item.price);
  set('flags.deco', [...(state.flags.deco || []), id]);
  save();
  emit('deco:change', { id, bought: true });
  emit('progress:change');
});

on('intent:toggleDeco', ({ id } = {}) => {
  if (!owned(id)) return;
  const off = [...(state.flags.decoOff || [])];
  set('flags.decoOff', off.includes(id) ? off.filter((x) => x !== id) : [...off, id]);
  save();
  emit('deco:change', { id });
});
