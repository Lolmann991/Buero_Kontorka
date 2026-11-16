// Правый монитор: Teams (этап 7). Только рисует и слушает события, игровой логики здесь нет.
// Вкладки: «Поддержка» (тикеты, сообщения-давление, рейтинг) и «Архив» (лор, открывается по ночам).
// Холст монитора 640×376 px; о перспективе этот модуль ничего не знает.

const MAX_ITEMS = 30;         // сколько карточек держим в ленте
const TYPING_MIN = 1.2;       // сек печати для самого короткого сообщения
const TYPING_MAX = 3.5;
const TYPING_PER_CHAR = 0.06; // длительность печати соответствует длине текста

// Сколько секунд «печатается» сообщение (её же использует main.js для звука клавиатуры).
export function typingSec(text) {
  return Math.min(TYPING_MAX, Math.max(TYPING_MIN, text.length * TYPING_PER_CHAR));
}
const REFRESH_SEC = 0.2;      // как часто обновляем возраст карточек
const AGE_FULL_SEC = 120;     // полоса возраста заполняется к моменту пропуска тикета

let root = null;
let els = {};
let S = null;
let T = null;
let offs = [];
let archive = [];
let items = new Map();        // id тикета -> { node, badge, bar }
let stickBottom = true;       // лента прижата к низу (новые сообщения прокручивают её)
let pending = [];             // сообщения-давление, которые ещё «печатаются»: { left, total, ticketId, key }
let acc = 0;
let tab = 'support';

function el(tag, className, parent) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (parent) parent.appendChild(e);
  return e;
}

function onPress(node, fn) {
  node.addEventListener('pointerup', (e) => {
    if (e.button > 0) return;
    fn(e);
  });
}

const hourLabel = (timeSec) => {
  const h = Math.min(6, Math.floor(timeSec / 60));
  return T('teams.hour', { h: h === 0 ? 12 : h });
};

const initial = (name) => (name || '?').trim().charAt(0).toUpperCase();

// Тексты архива и сообщений приходят ключами словаря.
export function setArchive(list) {
  archive = Array.isArray(list) ? list : [];
  if (els.arch) renderArchive();
}

// ---------- построение ----------
function build(ctx) {
  const { emit } = ctx;
  els.root = el('div', 'tm', root);

  const top = el('div', 'tm-top', els.root);
  el('div', 'tm-logo', top).textContent = 'T';
  el('div', 'tm-title', top).textContent = T('teams.title');
  els.overload = el('div', 'tm-overload', top);
  els.overload.textContent = T('teams.overload');
  els.overload.hidden = true;
  const sla = el('div', 'tm-sla', top);
  el('span', 'tm-sla__label', sla).textContent = T('teams.sla');
  const bar = el('span', 'tm-sla__bar', sla);
  els.slaFill = el('i', '', bar);
  els.slaNum = el('b', 'tm-sla__num', sla);

  const body = el('div', 'tm-body', els.root);
  const side = el('div', 'tm-side', body);
  els.tabs = {};
  for (const [id, key] of [['support', 'teams.channel.support'], ['archive', 'teams.channel.archive']]) {
    const b = el('button', 'tm-tab', side);
    b.type = 'button';
    el('span', '', b).textContent = T(key);
    els.tabs[id] = b;
    onPress(b, () => setTab(id));
  }
  els.dot = el('i', 'tm-dot', els.tabs.support);
  els.dot.hidden = true;

  const main = el('div', 'tm-main', body);
  els.feed = el('div', 'tm-feed', main);
  // Автопрокрутка вниз только пока игрок не отлистал ленту вверх.
  els.feed.addEventListener('scroll', () => {
    stickBottom = els.feed.scrollHeight - els.feed.scrollTop - els.feed.clientHeight < 40;
  });
  els.empty = el('div', 'tm-empty', els.feed);
  els.empty.textContent = T('teams.empty');
  els.typing = el('div', 'tm-typing', main);
  els.typing.hidden = true;
  els.typingText = el('span', '', els.typing);
  const dots = el('span', 'tm-dots', els.typing);
  el('i', '', dots); el('i', '', dots); el('i', '', dots);

  els.arch = el('div', 'tm-arch', main);
  els.arch.hidden = true;
  void emit;
}

function setTab(id) {
  tab = id;
  for (const [k, b] of Object.entries(els.tabs)) b.classList.toggle('is-active', k === id);
  els.feed.hidden = id !== 'support';
  els.arch.hidden = id !== 'archive';
  if (id === 'support') els.dot.hidden = true;
  syncTyping();
  if (id === 'archive') renderArchive();
}

// ---------- лента поддержки ----------
function trimFeed() {
  while (els.feed.querySelectorAll('.tm-card, .tm-msg').length > MAX_ITEMS) {
    const first = els.feed.querySelector('.tm-card, .tm-msg');
    for (const [id, rec] of items) if (rec.node === first) items.delete(id);
    first.remove();
  }
}

function markUnread() {
  if (tab !== 'support') els.dot.hidden = false;
}

function addCard(tk) {
  if (items.has(tk.id)) return;
  els.empty.hidden = true;
  const name = T(tk.senderKey);
  const node = el('div', 'tm-card is-open', els.feed);
  el('div', 'tm-avatar', node).textContent = initial(name);
  const body = el('div', 'tm-card__body', node);
  const head = el('div', 'tm-card__head', body);
  el('span', 'tm-name', head).textContent = name;
  el('span', 'tm-time', head).textContent = hourLabel(tk.openedAt);
  el('div', 'tm-text', body).textContent = T(tk.textKey);
  const foot = el('div', 'tm-card__foot', body);
  const badge = el('span', 'tm-badge', foot);
  badge.textContent = T('teams.status.open');
  const bar = el('span', 'tm-age', foot);
  const fill = el('i', '', bar);
  items.set(tk.id, { node, badge, fill, status: 'open' });
  trimFeed();
  markUnread();
  if (stickBottom) els.feed.scrollTop = els.feed.scrollHeight;
}

function addMessage(ticketId, key) {
  const tk = S.tickets.find((x) => x.id === ticketId);
  const name = tk ? T(tk.senderKey) : '';
  const node = el('div', 'tm-msg', els.feed);
  el('div', 'tm-avatar', node).textContent = initial(name);
  const body = el('div', 'tm-card__body', node);
  const head = el('div', 'tm-card__head', body);
  el('span', 'tm-name', head).textContent = name;
  el('span', 'tm-time', head).textContent = hourLabel(S.time);
  el('div', 'tm-text', body).textContent = T(key);
  els.empty.hidden = true;
  trimFeed();
  markUnread();
  if (stickBottom) els.feed.scrollTop = els.feed.scrollHeight;
}

// Карточки показывают статус и возраст; читаем state раз в REFRESH_SEC.
function refreshCards() {
  for (const [id, rec] of items) {
    const tk = S.tickets.find((x) => x.id === id);
    if (!tk) continue;
    const status = tk.done ? (tk.outcome === 'resolved' ? 'done' : 'missed') : 'open';
    if (rec.status !== status) {
      rec.status = status;
      rec.node.classList.remove('is-open', 'is-done', 'is-missed');
      rec.node.classList.add(`is-${status}`);
      rec.badge.textContent = T(`teams.status.${status}`);
    }
    let k;
    if (tk.done) k = 1;
    else k = Math.min(1, Math.max(0, (S.time - tk.openedAt) / AGE_FULL_SEC));
    rec.fill.style.width = `${(k * 100).toFixed(1)}%`;
    rec.fill.className = status !== 'open' ? '' : k > 0.75 ? 'is-hot' : k > 0.5 ? 'is-warm' : '';
  }
}

// «печатает…» перед сообщением; длительность зависит от длины текста
function syncTyping() {
  const cur = pending[0];
  const show = !!cur && tab === 'support';
  els.typing.hidden = !show;
  if (show) {
    const tk = S.tickets.find((x) => x.id === cur.ticketId);
    els.typingText.textContent = T('teams.typing', { name: tk ? T(tk.senderKey) : '' });
  }
}

function updateTyping(dt) {
  const cur = pending[0];
  if (!cur) return;
  cur.left -= dt;
  if (cur.left > 0) return;
  pending.shift();
  addMessage(cur.ticketId, cur.key);
  syncTyping();
}

// ---------- рейтинг и перегрузка ----------
function syncSla() {
  const v = Math.max(0, Math.min(100, S.sla));
  els.slaNum.textContent = String(Math.round(v));
  els.slaFill.style.width = `${v}%`;
  els.slaFill.className = v >= 60 ? 'is-good' : v >= 40 ? 'is-mid' : 'is-bad';
}

function syncOverload() {
  els.overload.hidden = !(S.running && S.load >= 5);
}

// ---------- архив ----------
// Дата записи архива (ISO, например 2025-03-11) в формате языка интерфейса.
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(document.documentElement.lang || 'ru', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function renderArchive() {
  if (!els.arch) return;
  els.arch.replaceChildren();
  const unlocked = S.flags?.unlocked ?? [];
  const isOpen = (a) => (a.unlockNight ?? 1) <= S.night && (!a.unlockAfterCall || unlocked.includes(`call:${a.unlockAfterCall}`));
  const shown = archive.filter(isOpen);
  const locked = archive.length - shown.length;
  el('div', 'tm-arch__hint', els.arch).textContent = T('teams.archive.hint');
  for (const a of shown) {
    const node = el('div', 'tm-arch__item', els.arch);
    const head = el('div', 'tm-arch__head', node);
    el('span', 'tm-chip', head).textContent = T(a.channel);
    if (Array.isArray(a.messages)) {
      // Переписка: несколько реплик подряд, у каждой своё время.
      if (a.title) el('span', 'tm-name', head).textContent = T(a.title);
      for (const m of a.messages) {
        const row = el('div', 'tm-arch__msg', node);
        el('span', 'tm-time', row).textContent = m.time ?? '';
        el('b', 'tm-name', row).textContent = T(m.author);
        el('span', 'tm-text', row).textContent = T(m.text);
      }
      continue;
    }
    el('span', 'tm-name', head).textContent = T(a.author);
    el('span', 'tm-time', head).textContent = [fmtDate(a.date), a.time].filter(Boolean).join(' ');
    el('div', 'tm-text', node).textContent = T(a.text);
  }
  if (locked > 0) {
    el('div', 'tm-arch__locked', els.arch).textContent = T('teams.archive.locked', { n: locked });
  }
}

function reset() {
  items.clear();
  pending = [];
  els.feed.replaceChildren(els.empty);
  stickBottom = true;
  els.empty.hidden = false;
  els.dot.hidden = true;
  syncTyping();
  syncSla();
  syncOverload();
  renderArchive();
}

// ---------- модуль ----------
export function mount(rootEl, ctx) {
  root = rootEl;
  S = ctx.state;
  T = ctx.t;
  const { on } = ctx;
  build(ctx);
  setTab('support');
  reset();

  offs = [
    on('night:start', reset),
    on('ticket:new', ({ id }) => {
      const tk = S.tickets.find((x) => x.id === id);
      if (tk) addCard(tk);
    }),
    on('ticket:pressure', ({ id, key }) => {
      const text = T(key);
      const total = typingSec(text);
      pending.push({ left: total, total, ticketId: id, key });
      syncTyping();
    }),
    on('ticket:resolved', refreshCards),
    on('ticket:missed', refreshCards),
    on('call:end', renderArchive),
    on('sla:change', syncSla),
    on('load:change', syncOverload),
    on('night:end', syncOverload),
    on('tick', ({ dt }) => {
      updateTyping(dt);
      acc += dt;
      if (acc < REFRESH_SEC) return;
      acc = 0;
      refreshCards();
    }),
  ];
}

export function unmount() {
  offs.forEach((off) => off());
  offs = [];
  if (root) root.replaceChildren();
  root = null;
  els = {};
  items = new Map();
  pending = [];
}