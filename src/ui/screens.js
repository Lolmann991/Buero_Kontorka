// Экраны итога ночи: «6 AM» -> зарплатный чек со «шпилькой» про стажёров, или «Game Over» после скримера.
// Только рисует. Итог (номер ночи, монеты, зарплату) считает main.js и присылает событием night:result.
// Скример рисует ui/desk.js; когда он доигран, desk.js шлёт ui:scareDone, и только тогда показываем «Game Over».
// Кнопки возвращают в меню событием ui:menu (меню — стартовый экран в desk.js).

import * as audio from '../audio.js';

const SIX_AM_SEC = 4.2;      // сколько показывается «6 AM» до чека
const ROLL_AT = 1.3;         // когда «5» сменяется на «6»
const JOKES = 12;            // check.joke.1 … check.joke.12
const JABS = 6;              // over.jab.1 … over.jab.6

let els = {};
let offs = [];
let pending = null;          // итог проигранной ночи, ждёт конца скримера
let six = null;              // { t, result } пока идёт «6 AM»
let noiseTimer = null;

function el(tag, className, parent) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (parent) parent.appendChild(e);
  return e;
}

const pick = (n) => 1 + Math.floor(Math.random() * n);
const euro = (cents) => (cents / 100).toFixed(2).replace('.', ',');

function hideAll() {
  els.six.hidden = true;
  els.check.hidden = true;
  els.over.hidden = true;
  stopNoise();
  six = null;
}

// ---------- 6 AM ----------
function startSix(result) {
  hideAll();
  six = { t: 0, result, rolled: false };
  els.six.hidden = false;
  els.six.classList.remove('is-rolled');
  els.sixHour.textContent = '5';
  els.sixNight.textContent = els.T('end.survived', { n: result.n });
}

function updateSix(dt) {
  if (!six) return;
  six.t += dt;
  if (!six.rolled && six.t >= ROLL_AT) {
    six.rolled = true;
    els.sixHour.textContent = '6';
    els.six.classList.add('is-rolled');
  }
  if (six.t >= SIX_AM_SEC) {
    const r = six.result;
    six = null;
    els.six.hidden = true;
    showCheck(r);
  }
}

// ---------- чек ----------
function showCheck(r) {
  const T = els.T;
  const base = r.pay - r.coinPay;
  els.checkNo.textContent = T('check.no', { no: `${String(r.n).padStart(2, '0')}-${1000 + Math.floor(Math.random() * 9000)}` });
  els.checkDate.textContent = T('check.dateValue', { n: r.n });
  els.checkAmount.textContent = euro(r.pay);
  els.checkLines.textContent = T('check.lines', { base: euro(base), c: r.coins, per: euro(r.coinUnit) });
  els.checkMemo.textContent = r.week ? T('check.week') : T(`check.joke.${pick(JOKES)}`);
  els.checkTotal.textContent = T('check.total', { coins: r.totalCoins, money: euro(r.totalMoney) });
  els.checkNext.textContent = r.week ? T('check.weekDone') : T('check.next', { n: r.n + 1 });
  els.check.hidden = false;
  els.check.classList.remove('is-stamped');
  void els.check.offsetWidth;
  els.check.classList.add('is-in');
  setTimeout(() => {
    if (els.check.hidden) return;
    els.check.classList.add('is-stamped');
    audio.play('stamp');
  }, 900);
}

// ---------- Game Over ----------
function drawNoise() {
  const { g, img, buf } = els.noise;
  for (let i = 0; i < buf.length; i++) {
    const v = (Math.random() * 255) | 0;
    buf[i] = 0xff000000 | (v << 16) | (v << 8) | v;
  }
  g.putImageData(img, 0, 0);
}
function startNoise() { if (noiseTimer === null) { drawNoise(); noiseTimer = setInterval(drawNoise, 70); } }
function stopNoise() { if (noiseTimer !== null) { clearInterval(noiseTimer); noiseTimer = null; } }

function showOver(r) {
  hideAll();
  const T = els.T;
  const hour = Math.min(5, Math.floor((r.time || 0) / 60));
  els.overSub.textContent = T('over.sub', { n: r.n, h: hour === 0 ? 12 : hour });
  els.overJab.textContent = T(`over.jab.${pick(JABS)}`);
  els.over.hidden = false;
  startNoise();
  audio.play('cam_static');
}

// ---------- модуль ----------
export function mount(root, ctx) {
  const { t, emit, on } = ctx;
  els.T = t;

  // 6 AM
  els.six = el('div', 'end-six', root);
  els.six.hidden = true;
  const clock = el('div', 'end-six__clock', els.six);
  els.sixHour = el('span', 'end-six__h', clock);
  el('span', 'end-six__am', clock).textContent = 'AM';
  els.sixNight = el('div', 'end-six__night', els.six);

  // чек
  els.check = el('div', 'end-check', root);
  els.check.hidden = true;
  const paper = el('div', 'pc', els.check);
  const head = el('div', 'pc-head', paper);
  el('span', 'pc-bank', head).textContent = t('check.bank');
  els.checkNo = el('span', 'pc-no', head);
  const row = (label, cls = '') => {
    const r = el('div', `pc-row ${cls}`, paper);
    el('span', 'pc-label', r).textContent = t(label);
    return el('b', 'pc-val', r);
  };
  els.checkDate = row('check.date');
  row('check.payee', 'pc-row--payee').textContent = t('check.payeeValue');
  const amount = el('div', 'pc-amount', paper);
  el('span', 'pc-cur', amount).textContent = '€';
  els.checkAmount = el('b', '', amount);
  els.checkLines = el('div', 'pc-lines', paper);
  const memo = el('div', 'pc-memo', paper);
  el('span', 'pc-label', memo).textContent = t('check.memo');
  els.checkMemo = el('span', 'pc-memo__text', memo);
  const foot = el('div', 'pc-foot', paper);
  el('span', 'pc-micr', foot).textContent = '⑆004711⑆ 0815 0000 ⑈ 13';
  el('span', 'pc-sign', foot).textContent = t('check.sign');
  el('div', 'pc-stamp', paper).textContent = t('check.stamp');
  els.checkTotal = el('div', 'end-check__total', els.check);
  els.checkNext = el('div', 'end-check__next', els.check);
  const cont = el('button', 'start-btn', els.check);
  cont.type = 'button';
  cont.textContent = t('check.continue');
  cont.addEventListener('pointerup', (e) => { if (e.button <= 0) { hideAll(); emit('ui:menu'); } });

  // Game Over
  els.over = el('div', 'end-over', root);
  els.over.hidden = true;
  const cv = el('canvas', 'end-over__noise', els.over);
  cv.width = 160; cv.height = 90;
  const g = cv.getContext('2d');
  const img = g.createImageData(160, 90);
  els.noise = { g, img, buf: new Uint32Array(img.data.buffer) };
  el('h1', 'end-over__title', els.over).textContent = t('over.title');
  els.overSub = el('p', 'end-over__sub', els.over);
  els.overJab = el('p', 'end-over__jab', els.over);
  const btns = el('div', 'end-over__btns', els.over);
  const again = el('button', 'start-btn', btns);
  again.type = 'button';
  again.textContent = t('over.retry');
  again.addEventListener('pointerup', (e) => {
    if (e.button > 0) return;
    hideAll();
    emit('intent:startShift');
  });
  const menu = el('button', 'start-btn start-btn--ghost', btns);
  menu.type = 'button';
  menu.textContent = t('over.menu');
  menu.addEventListener('pointerup', (e) => { if (e.button <= 0) { hideAll(); emit('ui:menu'); } });

  offs = [
    on('night:result', (r) => {
      if (r.failed) pending = r;      // сначала доиграет скример
      else startSix(r);
    }),
    on('ui:scareDone', () => {
      if (pending) { showOver(pending); pending = null; } else emit('ui:menu');
    }),
    on('night:start', () => { hideAll(); pending = null; }),
    on('tick', ({ dt }) => updateSix(dt)),
  ];
}

export function unmount() {
  stopNoise();
  offs.forEach((off) => off());
  offs = [];
  els.six?.remove();
  els.check?.remove();
  els.over?.remove();
  els = {};
  pending = null;
  six = null;
}
