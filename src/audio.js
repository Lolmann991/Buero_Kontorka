// Звук (этап 8, раздел 12 мастер-промпта): каталог data/sounds.json, MP3 через Web Audio.
// Громкость, фильтр и панорама считаются по расстоянию позиции звука до игрока (graph.distance).

import { distance, panOf, PLAYER_POS } from './graph.js';

let ctx = null;
let master = null;
const catalog = {};     // id -> { file, kind, loop, volume }
const buffers = {};     // id -> AudioBuffer
let ambient = [];       // [{ id, handle }]
let loading = Promise.resolve();

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
  src.start(0, offset, dur);
  decodeAll();
  return ctx;
}

// Все id звуков (каталог + процедурные заглушки) для отладочной панели.
export function soundIds() {
  return [...new Set([...Object.keys(catalog), ...Object.keys(SYNTH)])]
    .map((id) => ({ id, kind: catalog[id]?.kind ?? 'world', loop: !!catalog[id]?.loop }));
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
// Каждый звук грузится один раз; звуки, добавленные в каталог позже, докачиваются.
const failed = [];
const started = new Set();
function decodeAll() {
  if (!ctx) return loading;
  const todo = Object.values(catalog).filter((s) => s.file && !started.has(s.id));
  todo.forEach((s) => started.add(s.id));
  const batch = Promise.all(todo.map(async (s) => {
    try {
      const res = await fetch(new URL(s.file, document.baseURI), { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      buffers[s.id] = await ctx.decodeAudioData(await res.arrayBuffer());
    } catch (e) {
      failed.push(s.id);
      console.error(`audio: не загрузился звук «${s.id}» (${s.file})`, e);
    }
  })).then(() => {
    console.info(`audio: загружено ${Object.keys(buffers).length} из ${Object.keys(catalog).length}`
      + (failed.length ? `, НЕ загрузились: ${failed.join(', ')}` : ''));
  });
  loading = Promise.all([loading, batch]);
  return loading;
}

const stopped = new WeakSet();

// play(soundId, { at, loop, volume }) -> handle { stop() } | null.
// at: позиция графа; без at звук играет «в голове» игрока.
export function play(soundId, opts = {}) {
  // Скример: свой MP3 из каталога; синтез только как запасной вариант, если файл не загрузился.
  if (soundId === 'jumpscare' && !buffers.jumpscare) {
    console.error('audio: jumpscare.mp3 не загружен, играет запасной синтез');
    return playJumpscare();
  }
  ensureSynth(soundId);
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
  // Нарезка: sprite — список [начало, конец] в секундах, играет случайный отрезок (шаги); loopStart/loopEnd — границы петли (клавиатура).
  let offset = 0;
  let dur;
  if (def.sprite?.length) {
    const [a, b] = def.sprite[Math.floor(Math.random() * def.sprite.length)];
    offset = a;
    dur = b - a;
    src.loop = false;
  } else if (src.loop && def.loopEnd) {
    src.loopStart = def.loopStart ?? 0;
    src.loopEnd = def.loopEnd;
  }
  // Шаги: высота меняется на ±5–8% при каждом воспроизведении, чтобы звук не повторялся (раздел 12).
  if (handle._id === 'step') src.playbackRate.value = 1 + (Math.random() < 0.5 ? -1 : 1) * (0.05 + Math.random() * 0.03);

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

// ---------- процедурные заглушки для звуков, которых нет в assets/audio ----------
// Работают как обычные звуки каталога (позиция, фильтр, панорама). Чтобы заменить на свой файл,
// добавь запись с тем же id в data/sounds.json: каталог важнее заглушки.
const SYNTH = {
  whistle_mr404: { volume: 0.5, make: makeWhistle },
  laugh_mr404: { volume: 0.8, make: makeLaugh },
  warning_attack: { volume: 0.9, make: makeWarning },
};

function ensureSynth(id) {
  if (catalog[id] || !SYNTH[id] || !ctx) return;
  const sr = ctx.sampleRate;
  const data = SYNTH[id].make(sr);
  let peak = 0;
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  const buf = ctx.createBuffer(1, data.length, sr);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) ch[i] = data[i] / (peak || 1) * 0.8;
  buffers[id] = buf;
  catalog[id] = { id, file: null, kind: 'world', loop: false, volume: SYNTH[id].volume };
  started.add(id);
}

// Посвист: два наклонных тона с вибрато и лёгким шумом дыхания.
function makeWhistle(sr) {
  const n = Math.floor(sr * 1.6);
  const out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const k = t / 1.6;
    const f = (k < 0.45 ? 1700 + 900 * (k / 0.45) : 2600 - 1100 * ((k - 0.45) / 0.55))
      * (1 + 0.012 * Math.sin(2 * Math.PI * 6 * t));
    ph += 2 * Math.PI * f / sr;
    const env = Math.min(1, t / 0.08) * Math.min(1, (1.6 - t) / 0.25);
    out[i] = (Math.sin(ph) + 0.06 * (Math.random() * 2 - 1)) * env;
  }
  return out;
}

// Смех: пять низких «ха» с затухающим тоном; гармоники с формантами около 700 и 1200 Гц.
function makeLaugh(sr) {
  const n = Math.floor(sr * 2.0);
  const out = new Float32Array(n);
  const bursts = 6;
  for (let b = 0; b < bursts; b++) {
    const start = Math.floor(sr * (0.05 + b * 0.31));
    const len = Math.floor(sr * 0.22);
    const f0 = 150 - b * 7;
    const harm = [];
    for (let h = 1; h <= 24; h++) {
      const f = h * f0;
      const a = (Math.exp(-(((f - 700) / 300) ** 2)) + 0.6 * Math.exp(-(((f - 1200) / 400) ** 2))) / h ** 0.5;
      harm.push([f, a]);
    }
    for (let i = 0; i < len && start + i < n; i++) {
      const t = i / sr;
      const env = Math.min(1, t / 0.015) * Math.exp(-t * 11);
      let v = 0;
      for (const [f, a] of harm) v += a * Math.sin(2 * Math.PI * f * t * (1 - 0.15 * t));
      out[start + i] += (v + 0.15 * (Math.random() * 2 - 1)) * env;
    }
  }
  return out;
}

// Предупреждение: низкий гул с нарастающей пульсацией и поднимающимся тоном.
function makeWarning(sr) {
  const dur = 3.0;
  const n = Math.floor(sr * dur);
  const out = new Float32Array(n);
  let pulsePh = 0;
  let risePh = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const k = t / dur;
    pulsePh += 2 * Math.PI * (2 + 8 * k) / sr;
    const pulse = 0.55 + 0.45 * Math.max(0, Math.sin(pulsePh));
    risePh += 2 * Math.PI * (180 + 520 * k * k) / sr;
    const drone = Math.sin(2 * Math.PI * 55 * t) + 0.6 * Math.sin(2 * Math.PI * 82.5 * t);
    const rise = 0.35 * k * Math.sin(risePh);
    const env = Math.min(1, t / 0.2) * Math.min(1, (dur - t) / 0.1);
    out[i] = (drone * pulse + rise + 0.08 * k * (Math.random() * 2 - 1)) * env;
  }
  return out;
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