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
    if (ctx.state !== 'running') ctx.resume();
    return ctx;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) {
    console.warn('audio: Web Audio недоступен');
    return null;
  }
  ctx = new AC();
  ctx.resume();
  watchContext();
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

// Полный экран, поворот экрана, сворачивание и звонки в телефоне могут остановить контекст
// (suspended, а на iPhone ещё interrupted). Будим его при любом таком событии и при любом касании.
function watchContext() {
  const wake = () => {
    if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
  };
  ctx.addEventListener?.('statechange', () => {
    console.info(`audio: состояние ${ctx.state}`);
    wake();
  });
  for (const ev of ['fullscreenchange', 'webkitfullscreenchange']) document.addEventListener(ev, wake);
  for (const ev of ['orientationchange', 'pageshow', 'resize']) window.addEventListener(ev, wake);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
  document.addEventListener('pointerdown', wake, true);
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

// play(soundId, { at, loop, volume, pan }) -> handle { stop() } | null.
// at: позиция графа; без at звук играет «в голове» игрока. pan (-1..1): сторона в кабинете, если at не задан.
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
  if (ctx.state !== 'running') ctx.resume();

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
  const { at, loop, volume, pan } = handle._opts;
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
  } else if (typeof pan === 'number' && ctx.createStereoPanner) {
    // Звук в кабинете с явной стороной (двери слева и справа): только панорама, без затухания по расстоянию.
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    node.connect(p);
    node = p;
  }
  const g = ctx.createGain();
  g.gain.value = gainVal;
  // Нарезка с плавным входом и выходом (def.fade, сек), чтобы обрезок не щёлкал.
  if (def.sprite?.length && def.fade) {
    const now = ctx.currentTime;
    const len = dur / src.playbackRate.value;
    const f = Math.min(def.fade, len / 2);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(gainVal, now + 0.02);
    g.gain.setValueAtTime(gainVal, now + len - f);
    g.gain.linearRampToValueAtTime(0, now + len);
  }
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

// Подстройка уже играющего звука (петли): громкость относительно каталога и скорость.
export function tune(handle, { volume, rate } = {}) {
  if (!handle || !ctx) return;
  const now = ctx.currentTime;
  if (typeof volume === 'number' && handle._gain) {
    const v = volume * (handle._def?.volume ?? 1);
    handle._gain.gain.cancelScheduledValues(now);
    handle._gain.gain.setTargetAtTime(v, now, 0.3);
  }
  if (typeof rate === 'number' && handle._src) handle._src.playbackRate.setTargetAtTime(rate, now, 0.3);
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
  // Звуки мессенджера в духе Teams: мягкая «маримба» с лёгким эхом (свои мелодии, не записи Microsoft).
  teams_ping: { volume: 0.6, make: makeTeamsPing },       // новое сообщение / тикет
  teams_pressure: { volume: 0.75, make: makeTeamsUrgent },// срочное сообщение (давление)
  teams_call: { volume: 0.5, make: makeRingtone },        // входящий звонок (петля)
  call_ringback: { volume: 0.45, make: makeRingback },    // исходящий звонок: «идёт вызов» (петля)
  call_pickup: { volume: 0.6, make: makePickup },         // соединение
  call_hangup: { volume: 0.55, make: makeHangup },        // звонок завершён
  whistle_mr404: { volume: 0.5, make: makeWhistle },
  laugh_mr404: { volume: 0.8, make: makeLaugh },
  warning_attack: { volume: 0.9, make: makeWarning },
  // кабинет: приближение врага, двери, свет, монеты, итог ночи
  heartbeat: { volume: 0.9, make: makeHeartbeat },      // петля: враг совсем рядом (зал у кабинета / у двери)
  breath: { volume: 0.7, make: makeBreath },            // петля: дыхание за дверью
  growl: { volume: 0.8, make: makeGrowl },              // низкий рык, когда он встаёт в проём
  sting: { volume: 1.0, make: makeSting },              // резкий аккорд: включил свет, а он там
  light_buzz: { volume: 0.25, make: makeBuzz },         // петля: гудение лампы в коридоре
  shutter: { volume: 0.8, make: makeShutter },          // рольставня двери
  coin: { volume: 0.7, make: makeCoin },                // монета подобрана
  stamp: { volume: 0.9, make: makeStamp },              // штамп на чеке
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

// ---------- кабинет ----------
const noise = () => Math.random() * 2 - 1;

// Сердцебиение «тук-тук», 0,9 с на удар (петля).
function makeHeartbeat(sr) {
  const n = Math.floor(sr * 0.9);
  const out = new Float32Array(n);
  for (const [at, amp] of [[0, 1], [0.24, 0.7]]) {
    const a = Math.floor(at * sr);
    for (let i = 0; i < sr * 0.22 && a + i < n; i++) {
      const t = i / sr;
      const f = 62 - 30 * t;
      out[a + i] += amp * Math.sin(2 * Math.PI * f * t) * Math.min(1, t / 0.006) * Math.exp(-t * 18);
    }
  }
  return out;
}

// Дыхание: вдох и выдох шумом через простой фильтр, 3,2 с (петля).
function makeBreath(sr) {
  const dur = 3.2;
  const n = Math.floor(sr * dur);
  const out = new Float32Array(n);
  let lp = 0, lp2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const inhale = t < 1.2 ? Math.sin(Math.PI * t / 1.2) : 0;
    const exhale = t > 1.5 && t < 3.0 ? Math.sin(Math.PI * (t - 1.5) / 1.5) : 0;
    const k = t < 1.4 ? 0.08 : 0.04;              // вдох выше, выдох глуше
    lp += k * (noise() - lp);
    lp2 += 0.3 * (lp - lp2);
    out[i] = (lp - lp2 * 0.5) * (0.6 * inhale ** 1.5 + exhale ** 1.2);
  }
  return out;
}

// Рык: низкий шум с дрожанием и подголоском 70 Гц.
function makeGrowl(sr) {
  const dur = 1.6;
  const n = Math.floor(sr * dur);
  const out = new Float32Array(n);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    lp += 0.03 * (noise() - lp);
    const trem = 0.6 + 0.4 * Math.sin(2 * Math.PI * 23 * t);
    const env = Math.min(1, t / 0.15) * Math.min(1, (dur - t) / 0.4);
    out[i] = (lp * 6 * trem + 0.5 * Math.sin(2 * Math.PI * (70 - 15 * t) * t) * trem) * env;
  }
  return out;
}

// Испуг: диссонансный аккорд с резкой атакой и шумом.
function makeSting(sr) {
  const dur = 1.4;
  const n = Math.floor(sr * dur);
  const out = new Float32Array(n);
  const fr = [233, 247, 349, 370, 494, 523, 740];
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let v = 0;
    for (const f of fr) v += Math.sin(2 * Math.PI * f * t * (1 + 0.004 * Math.sin(40 * t)));
    const env = Math.min(1, t / 0.005) * Math.exp(-t * 2.4);
    out[i] = (v / fr.length + 0.4 * noise() * Math.exp(-t * 14)) * env;
  }
  return out;
}

// Гудение лампы: 100 Гц с обертонами и треском (петля 1 с).
function makeBuzz(sr) {
  const n = sr;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let v = 0;
    for (let h = 1; h <= 8; h++) v += Math.sin(2 * Math.PI * 100 * h * t) / h;
    out[i] = v * 0.5 + 0.08 * noise();
  }
  return out;
}

// Рольставня: металлический дребезг ламелей и удар в конце.
function makeShutter(sr) {
  const dur = 0.7;
  const n = Math.floor(sr * dur);
  const out = new Float32Array(n);
  let hp = 0, prev = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const x = noise();
    hp = 0.9 * (hp + x - prev);
    prev = x;
    const rattle = 0.5 + 0.5 * Math.sign(Math.sin(2 * Math.PI * 38 * t));
    out[i] = hp * rattle * 0.35 * Math.min(1, t / 0.02) * (t < 0.45 ? 1 : 0.3);
    if (t > 0.45) {
      const u = t - 0.45;
      out[i] += Math.exp(-u * 20) * (Math.sin(2 * Math.PI * 90 * u) + 0.5 * Math.sin(2 * Math.PI * 410 * u) + 0.4 * x);
    }
  }
  return out;
}

// Монета: два звонких тона.
function makeCoin(sr) {
  const out = new Float32Array(Math.floor(sr * 0.5));
  for (const [at, f] of [[0, 988], [0.08, 1319]]) {
    const a = Math.floor(at * sr);
    for (let i = 0; a + i < out.length; i++) {
      const t = i / sr;
      out[a + i] += (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * f * 2 * t)) * Math.exp(-t * (at ? 7 : 30));
    }
  }
  return out;
}

// Штамп: глухой удар по столу.
function makeStamp(sr) {
  const out = new Float32Array(Math.floor(sr * 0.35));
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    out[i] = (Math.sin(2 * Math.PI * (110 - 120 * t) * t) + 0.5 * noise() * Math.exp(-t * 60)) * Math.exp(-t * 16);
  }
  return out;
}

// ---------- мессенджер (в духе Teams) ----------
const NOTE = { G4: 392, A4: 440, C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880, C6: 1046.5, E6: 1318.5 };

// Удар «маримбы»: основной тон и два быстро гаснущих обертона, мягкая атака без щелчка.
function mallet(out, sr, at, f, amp = 1, decay = 1) {
  const a = Math.floor(at * sr);
  const len = Math.floor(sr * 1.4 * decay);
  for (let i = 0; i < len && a + i < out.length; i++) {
    const t = i / sr;
    const v = Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 4.5 / decay)
      + 0.32 * Math.sin(2 * Math.PI * f * 3.93 * t) * Math.exp(-t * 16)
      + 0.1 * Math.sin(2 * Math.PI * f * 9.2 * t) * Math.exp(-t * 34);
    out[a + i] += amp * v * Math.min(1, t / 0.004);
  }
}

// Короткое «комнатное» эхо, чтобы звук был не голым синтезом, а как из приложения.
function roomy(out, sr, wet = 0.22) {
  const dry = Float32Array.from(out);
  for (const [d, g] of [[0.071, wet], [0.113, wet * 0.7], [0.167, wet * 0.45]]) {
    const k = Math.floor(d * sr);
    for (let i = k; i < out.length; i++) out[i] += g * dry[i - k];
  }
  return out;
}

const seq = (sec, notes, sr, decay = 1) => {
  const out = new Float32Array(Math.floor(sr * sec));
  for (const [at, n, amp = 1] of notes) mallet(out, sr, at, NOTE[n], amp, decay);
  return roomy(out, sr);
};

// Новое сообщение: два мягких тона вверх.
function makeTeamsPing(sr) { return seq(1.0, [[0, 'G5', 0.8], [0.11, 'C6']], sr); }
// Срочное: три быстрых тона, дважды.
function makeTeamsUrgent(sr) {
  return seq(1.1, [[0, 'E6', 0.8], [0.08, 'C6', 0.8], [0.16, 'E6'], [0.45, 'E6', 0.7], [0.53, 'C6', 0.7], [0.61, 'E6', 0.9]], sr, 0.7);
}
// Входящий звонок: мелодичная фраза из двух частей и пауза, 4 с (петля).
function makeRingtone(sr) {
  return seq(4.0, [
    [0, 'C5'], [0.17, 'E5'], [0.34, 'G5'], [0.51, 'E5', 0.8], [0.85, 'A5'], [1.02, 'G5', 0.8],
    [1.6, 'C5'], [1.77, 'E5'], [1.94, 'G5'], [2.11, 'C6', 1.1],
  ], sr);
}
// Исходящий звонок: два тихих тона каждые 3 с (петля).
function makeRingback(sr) { return seq(3.0, [[0, 'A4', 0.9], [0.24, 'E5', 0.8]], sr, 1.3); }
// Соединение: быстро вверх. Конец звонка: вниз.
function makePickup(sr) { return seq(0.8, [[0, 'C5', 0.8], [0.08, 'G5']], sr, 0.6); }
function makeHangup(sr) { return seq(0.9, [[0, 'G5'], [0.12, 'C5', 0.8]], sr, 0.6); }

// Записи звонков (data/calls.json): audio.loadCalls(список) при загрузке игры.
const callDefs = {};
export function loadCalls(map) {
  Object.assign(callDefs, map);
}
// playCall(callId) -> handle { stop(), duration } | null. Субтитры шлёт calls.js (время только из tick).
// Нет файла или он ещё грузится: звонок идёт без звука, handle.duration появится после загрузки.
export function playCall(callId) {
  const def = callDefs[callId];
  if (!def?.audio || !ctx) return null;
  if (ctx.state !== 'running') ctx.resume();
  const handle = { duration: null, _stopped: false, _src: null, stop() { this._stopped = true; try { this._src?.stop(); } catch (e) { /* уже остановлен */ } } };
  (async () => {
    try {
      if (!buffers[`call:${callId}`]) {
        const res = await fetch(new URL(def.audio, document.baseURI));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        buffers[`call:${callId}`] = await ctx.decodeAudioData(await res.arrayBuffer());
      }
      const buf = buffers[`call:${callId}`];
      handle.duration = buf.duration;
      if (handle._stopped) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = def.volume ?? 1;
      src.connect(g);
      g.connect(master);
      src.start(0);
      handle._src = src;
    } catch (e) {
      console.warn(`audio.playCall: запись «${def.audio}» не загрузилась, звонок идёт без звука`, e);
    }
  })();
  return handle;
}

// ---------- запасной синтез скримера (если jumpscare.mp3 не загрузился) ----------
function playJumpscare() {
  if (!ctx) return null;
  if (ctx.state !== 'running') ctx.resume();
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