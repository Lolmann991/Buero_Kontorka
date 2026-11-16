// Звонки в Teams (этап 8, раздел 12.3): запись ночи (kind story) приходит как входящий звонок,
// плюс вызов «Ночного коллеги» (kind dial), который никто не берёт (в ночь 5 берут и молчат).
// Логика только здесь: интерфейс шлёт intent:answerCall, intent:declineCall, intent:hangUpCall, intent:dial
// и читает state.phone. Время берётся только из tick. Звук записи играет audio.playCall, субтитры шлёт этот модуль.
//
// state.phone: { status, kind, id, name, t, sub }
//   story: incoming (звонит ringSec, потом автоответ) -> playing (запись идёт) -> конец
//   dial:  ringing (гудки) -> noanswer | open (только ночь 5: взяли трубку и молчат, пока игрок не завершит)
//
// События: call:incoming {id}; call:start {id, kind}; call:end {id, kind, outcome}
// (outcome только у story: 'finished' | 'hungup' | 'declined'); subtitle {key | null}.

import { state, set, emit, on } from './state.js';
import * as audio from './audio.js';

let calls = {};      // data/calls.json -> calls
let contacts = {};   // data/calls.json -> contacts
let started = new Set();
let ringSnd = null;  // рингтон Teams или гудки
let rec = null;      // handle записи
let scale = 1;       // подгонка субтитров под длину mp3

// data/calls.json: записи по id (call_n1…) и ключ contacts (кому можно позвонить из вкладки «Звонки»).
export function load(data) {
  const { contacts: c, ...rest } = data ?? {};
  calls = rest;
  contacts = c ?? {};
  audio.loadCalls(calls);
}

const phone = () => ({ ...state.phone });
function setPhone(patchObj) {
  set('phone', { ...phone(), ...patchObj });
}

function stopSounds() {
  if (ringSnd) { audio.stop(ringSnd); ringSnd = null; }
  if (rec) { audio.stop(rec); rec = null; }
}

function setSub(key) {
  if ((state.phone.sub ?? null) === key) return;
  setPhone({ sub: key });
  emit('subtitle', { key });
}

// Завершение любого звонка. outcome нужен для story; silent: без сигнала «положили трубку».
function endPhone(outcome, { silent = false } = {}) {
  const p = phone();
  if (p.status === 'idle') return;
  stopSounds();
  if (!silent && p.kind === 'dial') audio.play('call_hangup');
  if (p.sub) emit('subtitle', { key: null });
  set('phone', { status: 'idle', kind: null, id: null, name: null, t: 0, sub: null });
  if (p.kind === 'story') emit('call:end', { id: p.id, kind: 'story', outcome });
  else emit('call:end', { id: p.id, kind: 'dial' });
}

// ---------- запись ночи ----------
function startIncoming(id) {
  const def = calls[id];
  started.add(id);
  if (state.phone.status !== 'idle') endPhone('declined', { silent: true });
  scale = 1;
  set('phone', { status: 'incoming', kind: 'story', id, name: def.caller, t: 0, sub: null });
  ringSnd = audio.play('teams_call', { loop: true });
  emit('call:incoming', { id });
}

function answerStory() {
  const p = state.phone;
  if (ringSnd) { audio.stop(ringSnd); ringSnd = null; }
  rec = audio.playCall(p.id);
  setPhone({ status: 'playing', t: 0 });
  emit('call:start', { id: p.id, kind: 'story' });
}

function tickStory(dt) {
  const p = state.phone;
  const def = calls[p.id];
  const t = p.t + dt;
  setPhone({ t });
  const lines = def.lines ?? [];
  const lastTo = lines.length ? lines[lines.length - 1].to : 0;
  // Когда mp3 загружен, тайминги субтитров подтягиваются под его длину (def.fit === false отключает).
  if (def.fit !== false && rec?.duration && lastTo > 0) scale = Math.max(0.5, Math.min(2, (rec.duration - 0.5) / lastTo));
  const line = lines.find((l) => t >= l.from * scale && t < l.to * scale);
  setSub(line ? line.key : null);
  if (t >= Math.max(rec?.duration ?? 0, lastTo * scale) + 0.6) endPhone('finished');
}

// ---------- вызов «Ночного коллеги» ----------
function tickDial(dt) {
  const p = state.phone;
  const c = contacts[p.id.replace(/^dial_/, '')] ?? {};
  const t = p.t + dt;
  setPhone({ t });
  if (p.status === 'ringing') {
    // Ночь 5: через несколько гудков кто-то берёт трубку и молчит.
    if (c.answerNight && state.night === c.answerNight && t >= (c.answerAfterSec ?? 9)) {
      stopSounds();
      audio.play('call_pickup');
      set('flags.fifthAnswered', true);
      setPhone({ status: 'open', t: 0 });
    } else if (t >= (c.ringSec ?? 20)) {
      stopSounds();
      setPhone({ status: 'noanswer', t: 0 });
    }
  } else if (p.status === 'noanswer' && t >= (c.noAnswerSec ?? 2.5)) {
    endPhone();
  }
  // status 'open': ждём intent:hangUpCall
}

on('tick', ({ dt }) => {
  if (!state.running) return;
  const p = state.phone;
  if (p.status === 'idle' || p.kind === 'dial') {
    // Запись ночи важнее вызова: прерывает его.
    for (const [id, def] of Object.entries(calls)) {
      if (def.night !== state.night || def.kind !== 'story' || !def.autoplay || started.has(id)) continue;
      if (state.time >= (def.startAtSec ?? 0)) { startIncoming(id); return; }
    }
  }
  if (p.kind === 'story') {
    if (p.status === 'incoming') {
      const def = calls[p.id];
      const t = p.t + dt;
      setPhone({ t });
      if (t >= (def.ringSec ?? 20) && def.autoAnswer !== false) answerStory();
      else if (t >= (def.ringSec ?? 20)) endPhone('declined');
    } else if (p.status === 'playing') tickStory(dt);
  } else if (p.kind === 'dial') tickDial(dt);
});

// ---------- намерения интерфейса ----------
on('intent:answerCall', ({ id } = {}) => {
  const p = state.phone;
  if (p.kind === 'story' && p.status === 'incoming' && (!id || id === p.id)) answerStory();
});
on('intent:declineCall', ({ id } = {}) => {
  const p = state.phone;
  if (p.kind === 'story' && p.status === 'incoming' && (!id || id === p.id)) endPhone('declined');
});
on('intent:hangUpCall', () => {
  const p = state.phone;
  if (p.kind === 'story' && p.status === 'playing') endPhone('hungup');
  else if (p.kind === 'dial') endPhone();
});

on('intent:dial', ({ contact }) => {
  const c = contacts[contact];
  if (!c || !state.running || state.tokens <= 0 || state.phone.status !== 'idle') return;
  const id = `dial_${contact}`;
  set('phone', { status: 'ringing', kind: 'dial', id, name: c.name, t: 0, sub: null });
  ringSnd = audio.play('call_ringback', { loop: true });
  emit('call:start', { id, kind: 'dial' });
});

// ---------- смена ночи, токены ----------
on('night:start', () => {
  stopSounds();
  started = new Set();
});
on('night:end', () => endPhone('hungup', { silent: true }));
// Монитор погас: вызов в Teams обрывается. Запись ночи это не сеть, она доиграет.
on('tokens:change', ({ value }) => {
  if (value <= 0 && state.phone.kind === 'dial') endPhone(undefined, { silent: true });
});
