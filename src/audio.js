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
