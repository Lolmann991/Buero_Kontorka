// Единственный игровой цикл. Другие модули время берут только из события tick.

import { state, set, patch, emit, on, newNight, recalcLoad, tickTokens, save, load } from './state.js';
import { loadLang, t } from './i18n.js';
import * as audio from './audio.js';
import * as desk from './ui/desk.js';
import * as cameras from './ui/cameras.js';
import * as teams from './ui/teams.js';
import * as screens from './ui/screens.js';
import * as tickets from './tickets.js';
import * as glitches from './glitches.js';
import * as calls from './calls.js';
import * as graph from './graph.js';
import * as mr404 from './enemies/mr404.js';
import * as coins from './coins.js';
import { initDebug } from './debug.js';

const ENEMY_MODULES = { mr404 };   // id врага из nights.json -> модуль src/enemies/<id>.js

const MAX_DT = 0.1; // секунды
const NIGHT_SEC = 360;
const CLOCK_333_SEC = 3 * 60 + 33;   // ночь 5: ровно в 3:33 на часах Sony появляются минуты

let last = null;
let lastHour = 0;
let nights = {};   // data/nights.json

function frame(now) {
  requestAnimationFrame(frame);
  if (document.hidden) {
    last = null;
    return;
  }
  if (last === null) {
    last = now;
    return;
  }
  const dt = Math.min((now - last) / 1000, MAX_DT);
  last = now;
  emit('tick', { dt });
}

// После возвращения на вкладку не копим большой dt.
document.addEventListener('visibilitychange', () => {
  last = null;
});

// ---------- время смены ----------
on('tick', ({ dt }) => {
  if (!state.running) return;

  const prev = state.time;
  const time = Math.min(NIGHT_SEC, prev + dt);
  set('time', time);

  // ВРЕМЕННО здесь, позже уйдёт в данные ночей и модуль глюков (этап 9)
  if (state.night === 5 && prev < CLOCK_333_SEC && time >= CLOCK_333_SEC) {
    emit('glitch', { type: 'clock333', source: 'fifth' });
  }

  const hour = Math.floor(time / 60);
  if (hour !== lastHour) {
    lastHour = hour;
    emit('clock:hour', { hour });
  }

  if (time >= NIGHT_SEC) {
    set('running', false);
    emit('night:end', { n: state.night });
  }
});

// ---------- намерения интерфейса ----------
// ---------- ночи, прогресс и сохранение ----------
export const MAX_NIGHT = 5;
const clampNight = (n) => Math.min(MAX_NIGHT, Math.max(1, Math.floor(Number(n) || 1)));

// Новая игра: снова с первой ночи. Звёзды, монеты и заработок остаются (это достижения).
on('intent:newGame', () => {
  if (state.running) return;
  set('night', 1);
  save();
  emit('progress:change');
});

// Зарплата за ночь (центы): оклад стажёра растёт на 25 центов за ночь, монета даёт 10 центов.
const PAY_BASE = 250, PAY_STEP = 25, PAY_COIN = 10;

// Итог ночи считается здесь, ui/desk.js рисует экран «6 AM», чек или «Game Over» по событию night:result.
on('night:end', ({ n, failed } = {}) => {
  const night = n ?? state.night;
  const result = { n: night, failed: !!failed, coins: state.coinsNight, time: state.time, week: false, pay: 0,
    coinPay: PAY_COIN * state.coinsNight, coinUnit: PAY_COIN };
  if (!failed) {
    result.pay = PAY_BASE + PAY_STEP * (night - 1) + result.coinPay;
    set('flags.stars', Math.max(state.flags.stars || 0, night));
    set('flags.money', (state.flags.money || 0) + result.pay);
    if (night >= MAX_NIGHT) { set('flags.weekDone', true); result.week = true; }
    set('night', clampNight(night + 1));
  }
  save();
  result.totalCoins = state.flags.coins || 0;
  result.totalMoney = state.flags.money || 0;
  emit('night:result', result);
});

on('intent:startShift', () => {
  if (state.running) return;
  set('night', clampNight(state.night));
  audio.init();
  overloaded = false;
  warning = false;
  syncAmbient();
  newNight(state.night, nights[state.night] || {});
  lastHour = 0;
  set('running', true);
});

// ---------- кабинет: взгляд, двери, свет ----------
// view: desk (стол, оба монитора) | left / right (дверь слева / справа) | cams (приближение к монитору камер).
const VIEWS = ['desk', 'left', 'right', 'cams'];
const SIDES = ['left', 'right'];
const DOOR_PAN = { left: -0.8, right: 0.8 };

function closeCameraNow() {
  if (state.camera === null) return;
  if (state.repairing) set('repairing', false);
  set('camera', null);
  recalcLoad();
  emit('camera:close');
}

function setLight(side, lit) {
  if (state.lights[side] === lit) return;
  set(`lights.${side}`, lit);
  recalcLoad();
  emit('light:change', { side, on: lit });
}

function setView(view) {
  const prev = state.view;
  if (prev === view) return;
  // Отвернулся от монитора камер: камера закрывается. Отвернулся от двери: свет гаснет (экономия токенов).
  if (prev === 'cams') closeCameraNow();
  if (SIDES.includes(prev)) setLight(prev, false);
  set('view', view);
  emit('view:change', { view, prev });
}

on('intent:view', ({ view } = {}) => {
  if (!state.running || !VIEWS.includes(view)) return;
  if (view === 'cams' && state.tokens <= 0) return;   // монитор без питания: приближаться не к чему
  setView(view);
});

on('intent:door', ({ side, closed } = {}) => {
  if (!state.running || !SIDES.includes(side)) return;
  const want = closed ?? !state.doors[side];
  if (want && state.tokens <= 0) return;              // без токенов двери не держатся
  if (state.doors[side] === want) return;
  set(`doors.${side}`, want);
  recalcLoad();
  audio.play('shutter', { pan: DOOR_PAN[side], volume: want ? 1 : 0.6 });
  emit('door:change', { side, closed: want });
});

on('intent:light', ({ side, on: lit } = {}) => {
  if (!state.running || !SIDES.includes(side)) return;
  const want = lit ?? !state.lights[side];
  if (want && (state.tokens <= 0 || state.view !== side)) return;   // свет только у той двери, на которую смотришь
  setLight(side, want);
});

// Конец смены и новая ночь: взгляд на стол, двери открыты, свет погашен.
on('night:end', () => {
  for (const side of SIDES) {
    if (state.doors[side]) set(`doors.${side}`, false);
    if (state.lights[side]) set(`lights.${side}`, false);
  }
  if (state.view !== 'desk') { set('view', 'desk'); emit('view:change', { view: 'desk' }); }
  recalcLoad();
});

// Открытие камеры: состояние и событие; вид рисует ui/cameras.js.
on('intent:openCamera', ({ id }) => {
  if (!state.running || state.tokens <= 0) return;
  if (state.view !== 'cams') setView('cams');   // камеры смотрят только приблизившись к монитору
  if (state.repairing && state.camera !== id) set('repairing', false);   // кнопка починки осталась на прошлой камере
  set('camera', id);
  recalcLoad();
  emit('camera:open', { id });
});

on('intent:closeCamera', closeCameraNow);

// Конец смены закрывает камеру: на экране итога остаётся стол.
on('night:end', () => {
  if (state.camera === null) return;
  set('camera', null);
  recalcLoad();
  emit('camera:close');
});

// ---------- токены, звонок-приманка, починка (этап 5) ----------
const lureCfg = () => nights[state.night]?.enemies?.mr404?.lure ?? {};

on('tick', ({ dt }) => {
  if (!state.running) return;
  tickTokens(dt);

  if (state.call.active) {
    const left = state.call.left - dt;
    if (left <= 0) endCall();
    else set('call.left', left);
  } else if (state.call.cooldown > 0) {
    set('call.cooldown', Math.max(0, state.call.cooldown - dt));
  }
});

function endCall() {
  set('call.active', false);
  set('call.left', 0);
  set('call.cooldown', lureCfg().cooldownSec ?? 25);
  set('call.at', null);
  recalcLoad();
  emit('call:end', { id: 'lure', kind: 'lure' });
}

on('intent:call', () => {
  if (!state.running || state.tokens <= 0) return;
  // Звонок привязан к месту: звонит телефон в комнате открытой камеры, враг идёт туда сам.
  const at = state.camera !== null ? graph.cameraMeta(state.camera)?.pos : null;
  if (!at) return;
  // В окне атаки (враг на s_hall3 и виден на камерах) перезарядка приманки не действует (раздел 18).
  const dwelling = Object.values(state.enemies).some((e) => e.dwell);
  if (state.call.active || (state.call.cooldown > 0 && !dwelling)) return;
  if (dwelling) set('call.cooldown', 0);
  set('call.active', true);
  set('call.left', lureCfg().callSec ?? 8);
  set('call.at', at);
  recalcLoad();
  emit('call:start', { id: 'lure', kind: 'lure', at });
});

// Удержание кнопки починки даёт +1 к нагрузке. Прогресс тикета считает tickets.js.
on('intent:repairStart', () => {
  if (!state.running || state.tokens <= 0 || state.repairing) return;
  set('repairing', true);
  recalcLoad();
});

on('intent:repairEnd', () => {
  if (!state.repairing) return;
  set('repairing', false);
  recalcLoad();
});

// 0% токенов: камеры, звонок и починка отключаются; тикеты продолжают приходить.
on('tokens:change', ({ value }) => {
  if (value > 0 || !state.running) return;
  if (state.camera !== null) {
    set('camera', null);
    emit('camera:close');
  }
  if (state.call.active) endCall();
  set('repairing', false);
  // Питание кончилось: двери сами открываются, свет гаснет, монитор камер мёртв.
  for (const side of SIDES) {
    if (state.doors[side]) {
      set(`doors.${side}`, false);
      audio.play('door_open', { pan: DOOR_PAN[side], volume: 0.6 });
      emit('door:change', { side, closed: false });
    }
    setLight(side, false);
  }
  if (state.view === 'cams') setView('desk');
  recalcLoad();
});

// Конец смены сбрасывает звонок и починку.
on('night:end', () => {
  set('call.active', false);
  set('call.left', 0);
  set('call.cooldown', 0);
  set('repairing', false);
  recalcLoad();
});

// ---------- враги (этап 6) ----------
// Враг сам решает, куда идти, и сообщает событиями; в state.enemies их отражает main.js.
let enemies = [];

function mirrorEnemy(id, patchObj) {
  const cur = {};
  for (const [k, v] of Object.entries(state.enemies)) cur[k] = { ...v };
  cur[id] = { status: 'idle', ...(cur[id] || {}), ...patchObj };
  set('enemies', cur);
}

on('enemy:moved', ({ id, to }) => {
  if (to === null) {
    const cur = {};
    for (const [k, v] of Object.entries(state.enemies)) if (k !== id) cur[k] = { ...v };
    set('enemies', cur);
    return;
  }
  mirrorEnemy(id, { pos: to });
});

on('enemy:status', ({ id, status, dwell = false, door = null }) => mirrorEnemy(id, { status, dwell, door }));

on('night:start', () => {
  enemies = [];
  const cfgs = nights[state.night]?.enemies ?? {};
  for (const [id, cfg] of Object.entries(cfgs)) {
    const mod = ENEMY_MODULES[id];
    if (!mod) { console.warn(`enemies: нет модуля для «${id}»`); continue; }
    enemies.push(mod.create(cfg, { state, graph, audio, emit, rng: Math.random }));
  }
});

on('tick', ({ dt }) => {
  if (!state.running) return;
  for (const e of enemies) e.update(dt);
});

// Враги получают звонки и команды отладки через onEvent, а не подписываются сами.
for (const name of ['call:start', 'call:end', 'debug:enemy']) {
  on(name, (payload) => enemies.forEach((e) => e.onEvent(name, payload)));
}

// Скример: смена заканчивается провалом. Кадр рисует ui/desk.js, потом стартовый экран «Смена провалена».
on('jumpscare', ({ enemyId }) => {
  console.info(`jumpscare: ${enemyId}`);
  set('running', false);
  emit('night:end', { n: state.night, failed: true });
});

on('night:end', () => { enemies = []; });

// ---------- монеты ----------
on('night:start', () => coins.start(nights[state.night]?.coins ?? {}));
on('tick', () => { if (state.running) coins.update(); });
on('coin:collect', () => audio.play('coin'));

// Прослушанная запись ночи открывает привязанные к ней записи архива (flags.unlocked: 'call:<id>').
// Открывает только запись, прослушанная до конца: call:end story с outcome 'finished' (решено разработчиком).
on('call:end', ({ id, kind, outcome }) => {
  if (kind !== 'story' || outcome !== 'finished') return;
  patch('flags.unlocked', (list) => (list.includes(`call:${id}`) ? list : [...list, `call:${id}`]));
});

// ---------- тикеты (этап 7) ----------
// Создание, рейтинг, поломка камер, починка и перезагрузка живут в tickets.js; здесь только проводка.
on('night:start', () => tickets.start(nights[state.night]?.tickets ?? {}));

on('tick', ({ dt }) => {
  if (!state.running) return;
  tickets.update(dt);
});

// ---------- глюки (этап 9) ----------
// Фантомы Teams (глюки пятого): условия и порядок решает glitches.js, рисует teams.js.
const glitchMod = glitches.create({ state, emit, on, rng: Math.random });
on('night:start', () => glitchMod.start(nights[state.night] ?? {}));
on('tick', () => { if (state.running) glitchMod.update(); });
on('debug:glitch', (p) => glitchMod.debug(p, nights[state.night] ?? nights[1] ?? {}));

// ---------- звуки интерфейса ----------
let alarm = null;
let holdSnd = null;   // петля починки, пока идёт прогресс удержания
let lureSnd = null;   // звонок-приманка
function stopHoldSound() { if (holdSnd) { audio.stop(holdSnd); holdSnd = null; } }
// tickets.js шлёт ticket:progress каждый кадр удержания, а при отпускании — progress 0.
on('ticket:progress', ({ progress }) => {
  if (progress > 0 && progress < 1) { if (!holdSnd) holdSnd = audio.play('repair_hold'); }
  else stopHoldSound();
});
// Звонок слышен там, где звонит телефон (at): громкость, фильтр и панорама по расстоянию до стола.
on('call:start', ({ kind, at }) => {
  if (kind !== 'lure') return;
  audio.stop(lureSnd);
  lureSnd = audio.play('agent_lure', at ? { at } : {});
});
on('call:end', ({ kind }) => { if (kind === 'lure' && lureSnd) { audio.stop(lureSnd); lureSnd = null; } });
on('camera:open', () => audio.play('cam_switch'));
const printerSnds = new Map();   // id тикета -> звук печати
// Принтер печатает на позиции устройства: игрок слышит, с какой стороны тикет (текст тикета места не называет).
on('ticket:new', ({ id }) => {
  const tk = state.tickets.find((x) => x.id === id);
  if (tk?.type !== 'printer') return;
  const at = graph.cameraMeta(tk.cam)?.pos;
  printerSnds.set(id, audio.play('printer_work', at ? { at } : {}));
});
// Звук печати длинный (около 36 с): когда тикет закрыт, принтер затихает.
on('ticket:resolved', ({ id }) => { audio.stop(printerSnds.get(id)); printerSnds.delete(id); });
// Конец смены без провала: куранты.
on('night:end', ({ failed }) => { if (!failed) audio.play('night_end_chime'); });
on('ticket:new', () => audio.play('teams_ping'));
on('ticket:resolved', () => { stopHoldSound(); audio.play('repair_done'); });
// Сообщение-давление: сначала слышна клавиатура на позиции устройства тикета, пока «печатает…», потом звук Teams.
on('ticket:pressure', ({ id, key }) => {
  const tk = state.tickets.find((x) => x.id === id);
  const at = tk ? graph.cameraMeta(tk.cam)?.pos : null;
  const sec = teams.typingSec(t(key));
  const kb = audio.play('keyboard', { ...(at ? { at } : {}), loop: true });
  setTimeout(() => { audio.stop(kb); if (state.running) audio.play('teams_pressure'); }, sec * 1000);
});
on('glitch', ({ source }) => { if (source === 'ai') audio.play('glitch_ai'); });
// ---------- шаги врага рядом: сердцебиение, дыхание за дверью, свет в коридоре ----------
// Уровень угрозы: 0 далеко; 1 в зале у кабинета; 2 стоит и смотрит (окно атаки); 3 у двери или уже внутри.
const NEAR_DESK = new Set(['s_hall1', 's_hall2', 's_hall3']);
const HEART = [null, { volume: 0.3, rate: 0.9 }, { volume: 0.6, rate: 1.1 }, { volume: 1.0, rate: 1.4 }];
let heartSnd = null;
let breathSnd = null;
let stingArmed = false;          // испуг играет один раз за визит к двери
const buzzSnd = { left: null, right: null };

function threat() {
  let lvl = 0;
  for (const e of Object.values(state.enemies)) {
    if (!e) continue;
    if (e.status === 'door' || e.status === 'warning') lvl = Math.max(lvl, 3);
    else if (e.dwell) lvl = Math.max(lvl, 2);
    else if (NEAR_DESK.has(e.pos) && (e.status === 'idle' || e.status === 'dash')) lvl = Math.max(lvl, 1);
  }
  return lvl;
}

on('tick', () => {
  const lvl = state.running ? threat() : 0;
  if (lvl && !heartSnd) heartSnd = audio.play('heartbeat', { loop: true, volume: HEART[lvl].volume });
  else if (!lvl && heartSnd) { audio.stop(heartSnd); heartSnd = null; }
  if (heartSnd && lvl) audio.tune(heartSnd, HEART[lvl]);
});

const enemyAtDoor = (side) => Object.values(state.enemies).some((e) => e?.status === 'door' && e.door === side);

on('enemy:status', ({ status, door }) => {
  if (status === 'door') {
    audio.stop(breathSnd);
    breathSnd = audio.play('breath', { loop: true, pan: DOOR_PAN[door] ?? 0 });
    audio.play('growl', { pan: DOOR_PAN[door] ?? 0, volume: 0.7 });
    stingArmed = true;
    if (state.lights[door] && state.view === door) { audio.play('sting'); stingArmed = false; }
  } else if (breathSnd) {
    audio.stop(breathSnd);
    breathSnd = null;
  }
});

on('light:change', ({ side, on: lit }) => {
  if (lit && !buzzSnd[side]) buzzSnd[side] = audio.play('light_buzz', { loop: true, pan: DOOR_PAN[side] });
  else if (!lit && buzzSnd[side]) { audio.stop(buzzSnd[side]); buzzSnd[side] = null; }
  if (lit && stingArmed && enemyAtDoor(side)) { audio.play('sting'); stingArmed = false; }
});

function stopThreatSounds() {
  audio.stop(heartSnd); heartSnd = null;
  audio.stop(breathSnd); breathSnd = null;
  for (const side of SIDES) { audio.stop(buzzSnd[side]); buzzSnd[side] = null; }
}
on('night:end', stopThreatSounds);

// Фон: гул и ночь всегда; напряжение при перегрузке сети и во время предупреждения об атаке; темнота с ночи 4.
let overloaded = false;
let warning = false;
function syncAmbient() {
  const list = ['amb_pc_hum', 'amb_night'];
  if (overloaded || warning) list.push('amb_tension');
  if (state.night >= 4) list.push('amb_dark');
  audio.setAmbient(list);
}
on('enemy:status', ({ status }) => {
  warning = status === 'warning' || status === 'door';
  if (state.running) syncAmbient();
});
on('load:change', ({ overload }) => {
  overloaded = overload;
  if (state.running) syncAmbient();
  if (overload && !alarm) alarm = audio.play('overload_alarm');
  else if (!overload && alarm) { audio.stop(alarm); alarm = null; }
});
// Шум открытой камеры (amb_cam_feed) и помехи сломанной камеры (cam_static): петли, пока камера открыта.
let feedSnd = null;
let staticSnd = null;
on('tick', () => {
  const open = state.running && state.camera !== null;
  const broken = open && state.brokenCams.includes(state.camera);
  if (open && !feedSnd) feedSnd = audio.play('amb_cam_feed');
  else if (!open && feedSnd) { audio.stop(feedSnd); feedSnd = null; }
  if (broken && !staticSnd) staticSnd = audio.play('cam_static');
  else if (!broken && staticSnd) { audio.stop(staticSnd); staticSnd = null; }
});

// Щелчок интерфейса на любой кнопке.
document.addEventListener('pointerdown', (e) => {
  if (e.target.closest?.('button') && !e.target.closest?.('.dbg-panel, .dbg-toggle')) audio.play('ui_click');
});

on('night:end', () => {
  audio.setAmbient([]);
  stopHoldSound();
  if (lureSnd) { audio.stop(lureSnd); lureSnd = null; }
  if (alarm) { audio.stop(alarm); alarm = null; }
});

// ---------- запуск ----------
async function loadJSON(path) {
  const res = await fetch(new URL(path, document.baseURI));
  if (!res.ok) throw new Error(`Не удалось загрузить ${path} (${res.status})`);
  return res.json();
}

async function boot() {
  load();                          // сохранение: ночь, звёзды, монеты (если есть)
  set('night', clampNight(state.night));
  await loadLang('ru');
  graph.loadGraph(await loadJSON('data/rooms.json'));
  try {
    audio.loadCatalog(await loadJSON('data/sounds.json'));
  } catch (e) {
    console.warn('sounds.json не загружен, звука не будет', e);
  }
  try {
    nights = await loadJSON('data/nights.json');
  } catch (e) {
    console.warn('nights.json не загружен, берутся значения по умолчанию', e);
  }

  try {
    tickets.load(await loadJSON('data/tickets.json'));
  } catch (e) {
    console.warn('tickets.json не загружен, тикеты отключены', e);
  }
  try {
    calls.load(await loadJSON('data/calls.json'));
  } catch (e) {
    console.warn('calls.json не загружен, звонков не будет', e);
  }
  try {
    teams.setArchive(await loadJSON('data/teams-archive.json'));
  } catch (e) {
    console.warn('teams-archive.json не загружен, архив пуст', e);
  }

  const ctx = { state, t, emit, on };
  desk.mount(document.getElementById('app'), ctx);
  cameras.mount(document.getElementById('monitor-left'), ctx);
  teams.mount(document.getElementById('monitor-right'), ctx);
  screens.mount(document.getElementById('app'), ctx);
  initDebug();

  requestAnimationFrame(frame);
}

boot().catch((e) => console.error('Не удалось запустить игру:', e));