// Звук. На этапе 1 здесь только разблокировка AudioContext по первому касанию.
// Полная версия (позиции, панорама, фильтр, звонки) — этап 8.

let ctx = null;

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
  // Тихий буфер: страховка для iOS, чтобы контекст точно проснулся.
  const buf = ctx.createBuffer(1, 1, 22050);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start(0);
  return ctx;
}

export function getContext() {
  return ctx;
}

// ---------- минимальный синтез для скримера (до этапа 8 с настоящими MP3) ----------
// play(soundId, opts) -> { stop() } | null. Пока знает только 'jumpscare' (без позиции, «в голове» игрока).
export function play(soundId) {
  if (soundId !== 'jumpscare') {
    console.warn(`audio.play: звук «${soundId}» пока не реализован`);
    return null;
  }
  if (!ctx) return null;
  if (ctx.state === 'suspended') ctx.resume();
  const t0 = ctx.currentTime;
  const DUR = 1.95;   // обрыв совпадает с чёрным экраном скримера

  const out = ctx.createGain();
  out.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor();
  out.connect(comp);
  comp.connect(ctx.destination);

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