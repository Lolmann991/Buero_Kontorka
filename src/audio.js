// Звук (этап 8, раздел 12 мастер-промпта): каталог data/sounds.json, MP3 через Web Audio.
// Громкость, фильтр и панорама считаются по расстоянию позиции звука до игрока (graph.distance).

import { distance, panOf, PLAYER_POS } from './graph.js';

let ctx = null;
let master = null;
const catalog = {};     // id -> { file, kind, loop, volume }
const buffers = {};     // id -> AudioBuffer
let ambient = [];       // [{ id, handle }]
let loading = null;

// Вызывать только из обработчика касания.
export function init() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) {
    console.warn('audio: Web Audio недоступен');
    return null;
  }
  ctx = new AC();
  ctx.resume();
  master = ctx.createGain();
  master.gain.value = 1;
  master.connect(ctx.destination);
  // Тихий буфер: страховка для iOS, чтобы контекст точно проснулся.
  const buf = ctx.createBuffer(1, 1, 22050);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start(0);
  decodeAll();
  return ctx;
}

export function getContext() {
  return ctx;
}

// Читает каталог звуков (вызывается при загрузке игры, до касания).
export function loadCatalog(list) {
  list.forEach((s) => { catalog[s.id] = s; });
  if (ctx) decodeAll();
}

// Загрузка и декодирование MP3. Начинается после первого касания (нужен ctx).
function decodeAll() {
  if (loading || !ctx) return loading;
  loading = Promise.all(Object.values(catalog).map(async (s) => {
    try {
      const res = await fetch(new URL(s.file, document.baseURI));
      if (!res.ok) throw new Error(res.status);
      buffers[s.id] = await ctx.decodeAudioData(await res.arrayBuffer());
    } catch (e) {
      console.warn(`audio: не загрузился звук «${s.id}» (${s.file})`, e);
    }
  }));
  return loading;
}

const stopped = new WeakSet();

// play(soundId, { at, loop, volume }) -> handle { stop() } | null.
// at: позиция графа; без at звук играет «в голове» игрока.
export function play(soundId, opts = {}) {
  // Скример: свой MP3 из каталога; синтез только как запасной вариант, если файл не загрузился.
  if (soundId === 'jumpscare' && !buffers.jumpscare) return playJumpscare();
  const def = catalog[soundId];
  if (!def) {
    console.warn(`audio.play: звука «${soundId}» нет в каталоге`);
    return null;
  }
  if (!ctx) return null;
  if (ctx.state === 'suspended') ctx.resume();

  const handle = { stop() { stopHandle(handle); } };
  handle._id = soundId;
  handle._opts = opts;
  handle._def = def;
  const buf = buffers[soundId];
  if (!buf) {
    // ещё декодируется: стартуем, когда будет готово (петли и недавние звуки не теряются)
    (loading || Promise.resolve()).then(() => {
      if (!stopped.has(handle) && buffers[soundId]) startHandle(handle, buffers[soundId]);
    });
    return handle;
  }
  startHandle(handle, buf);
  return handle;
}

function startHandle(handle, buf) {
  const { at, loop, volume } = handle._opts;
  const def = handle._def;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = loop ?? def.loop;

  let node = src;
  let gainVal = (volume ?? 1) * (def.volume ?? 1);
  if (at) {
    const d = distance(at, PLAYER_POS);
    const steps = Number.isFinite(d) ? d : 6;
    gainVal *= Math.max(0.1, 1 - 0.2 * steps);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.max(500, 8000 - 1300 * steps);
    node.connect(lp);
    node = lp;
    if (ctx.createStereoPanner) {
      const pan = ctx.createStereoPanner();
      pan.pan.value = panOf(at) || 0;
      node.connect(pan);
      node = pan;
    }
  }
  const g = ctx.createGain();
  g.gain.value = gainVal;
  node.connect(g);
  g.connect(master);
  src.onended = () => { try { g.disconnect(); } catch (e) { /* уже отключён */ } };
  src.start(0);
  handle._src = src;
  handle._gain = g;
}

function stopHandle(handle) {
  stopped.add(handle);
  try { handle._src?.stop(); } catch (e) { /* уже остановлен */ }
}

export function stop(handle) {
  handle?.stop?.();
}

// Фон: список id (петли). Меняет набор: лишнее гасит, недостающее запускает.
export function setAmbient(list) {
  const want = new Set(list);
  ambient = ambient.filter((a) => {
    if (want.has(a.id)) return true;
    stop(a.handle);
    return false;
  });
  list.forEach((id) => {
    if (ambient.some((a) => a.id === id)) return;
    const handle = play(id, { loop: true });
    if (handle) ambient.push({ id, handle });
  });
}

// Звонки (запись + субтитры): появятся вместе с calls.json.
export function playCall(callId) {
  console.warn(`audio.playCall: звонок «${callId}» пока не реализован`);
  return null;
}

// ---------- запасной синтез скримера (если jumpscare.mp3 не загрузился) ----------
function playJumpscare() {
  if (!ctx) return null;
  if (ctx.state === 'suspended') ctx.resume();
  const t0 = ctx.currentTime;
  const DUR = 1.95;   // обрыв совпадает с чёрным экраном скримера

  const out = ctx.createGain();
  out.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor();
  out.connect(comp);
  comp.connect(master);

  // жёсткое искажение
  const shaper = ctx.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) { const x = (i / 512) - 1; curve[i] = Math.tanh(x * 6); }
  shaper.curve = curve;
  shaper.connect(out);

  // визг: две пилы с тритоновым интервалом, глиссандо вверх, дрожание частоты
  const screechGain = ctx.createGain();
  screechGain.gain.setValueAtTime(0.0001, t0);
  screechGain.gain.exponentialRampToValueAtTime(0.7, t0 + 0.03);
  screechGain.gain.setValueAtTime(0.7, t0 + DUR - 0.02);
  screechGain.gain.linearRampToValueAtTime(0, t0 + DUR);
  screechGain.connect(shaper);
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.frequency.value = 23;
  lfoGain.gain.value = 60;
  lfo.connect(lfoGain);
  const oscs = [lfo];
  [1, 1.414].forEach((ratio) => {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(520 * ratio, t0);
    o.frequency.exponentialRampToValueAtTime(1500 * ratio, t0 + DUR);
    lfoGain.connect(o.frequency);
    o.connect(screechGain);
    oscs.push(o);
  });

  // удар: суб-бас
  const boom = ctx.createOscillator();
  const boomGain = ctx.createGain();
  boom.type = 'sine';
  boom.frequency.setValueAtTime(110, t0);
  boom.frequency.exponentialRampToValueAtTime(32, t0 + 0.7);
  boomGain.gain.setValueAtTime(1, t0);
  boomGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.9);
  boom.connect(boomGain);
  boomGain.connect(out);
  oscs.push(boom);

  // шумовой всплеск
  const len = Math.floor(ctx.sampleRate * DUR);
  const nb = ctx.createBuffer(1, len, ctx.sampleRate);
  const nd = nb.getChannelData(0);
  for (let i = 0; i < len; i++) nd[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource();
  noise.buffer = nb;
  const nf = ctx.createBiquadFilter();
  nf.type = 'bandpass';
  nf.frequency.setValueAtTime(3000, t0);
  nf.frequency.exponentialRampToValueAtTime(800, t0 + 0.6);
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.9, t0);
  ng.gain.exponentialRampToValueAtTime(0.12, t0 + 0.5);
  ng.gain.setValueAtTime(0.12, t0 + DUR - 0.02);
  ng.gain.linearRampToValueAtTime(0, t0 + DUR);
  noise.connect(nf);
  nf.connect(ng);
  ng.connect(out);

  oscs.forEach((o) => { o.start(t0); o.stop(t0 + DUR + 0.05); });
  noise.start(t0);
  noise.stop(t0 + DUR + 0.05);
  return { stop() { try { out.gain.setValueAtTime(0, ctx.currentTime); } catch (e) { /* уже остановлен */ } } };
}