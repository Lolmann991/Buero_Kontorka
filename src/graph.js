// Граф физических позиций. Сервис без игрового состояния: только данные из rooms.json.
// Позиции это места, где может стоять НПС; камеры только показывают их.

export const PLAYER_POS = 'desk';

let positions = {};   // id -> { id, label, next, pan, cams, map, walkable }
let cameras = {};     // номер камеры -> { id, name, pos, btn }
let mapViewData = null; // схема карты камер: размер холста, контуры, двери, место игрока
let distCache = new Map();

export function loadGraph(rooms) {
  positions = {};
  cameras = {};
  mapViewData = rooms.mapView ? JSON.parse(JSON.stringify(rooms.mapView)) : null;
  distCache = new Map();
  for (const [id, p] of Object.entries(rooms.positions || {})) {
    positions[id] = {
      id,
      label: p.label,
      next: [...(p.next || [])],
      pan: p.pan ?? 0,
      walkable: p.walkable !== false,
      blind: p.blind,
      cams: (p.cams || []).map((c) => ({ ...c })),
      map: p.map ? { ...p.map } : null,
      mapExtra: (p.mapExtra || []).map((r) => ({ ...r })),
    };
  }
  for (const [k, c] of Object.entries(rooms.cameras || {})) {
    cameras[Number(k)] = {
      id: Number(k), name: c.name, pos: c.pos, img: c.img, tune: c.tune ? { ...c.tune } : {},
      btn: c.btn ? { ...c.btn } : null,
    };
  }
}

export function positionIds() {
  return Object.keys(positions);
}

export function labelOf(posId) {
  return positions[posId]?.label ?? posId;
}

export function neighbors(posId) {
  return positions[posId] ? [...positions[posId].next] : [];
}

// Число шагов по рёбрам (поиск в ширину). Если пути нет, Infinity.
export function distance(a, b) {
  if (!positions[a] || !positions[b]) return Infinity;
  if (!distCache.has(a)) {
    const dist = { [a]: 0 };
    const queue = [a];
    while (queue.length) {
      const cur = queue.shift();
      for (const n of positions[cur].next) {
        if (positions[n] && dist[n] === undefined) {
          dist[n] = dist[cur] + 1;
          queue.push(n);
        }
      }
    }
    distCache.set(a, dist);
  }
  return distCache.get(a)[b] ?? Infinity;
}

// [{cam, slot, x, y, scale, pose}] — на каких камерах виден НПС в этой позиции.
export function camerasFor(posId) {
  return (positions[posId]?.cams ?? []).map((c) => ({ ...c }));
}

// true, если нет ни одной камеры
export function isBlind(posId) {
  return camerasFor(posId).length === 0;
}

// -1..1 для стерео
export function panOf(posId) {
  return positions[posId]?.pan ?? 0;
}

// Прямоугольник позиции на карте камер {x, y, w, h, extra} в px холста монитора (или null).
// extra: дополнительные прямоугольники той же комнаты (например, гардероб у парадной).
export function mapOf(posId) {
  const p = positions[posId];
  if (!p?.map) return null;
  return { ...p.map, extra: p.mapExtra.map((r) => ({ ...r })) };
}

// Общая схема карты: { size: [w, h], you: {x, y}, outlines: [[[x, y], ...]], doors: [{x, y, w, h}] }
export function mapView() {
  return mapViewData ? JSON.parse(JSON.stringify(mapViewData)) : null;
}

export function cameraIds() {
  return Object.keys(cameras).map(Number).sort((a, b) => a - b);
}

// { id, name (ключ словаря), pos, img (путь к кадру), tune ({brightness, contrast}, необязательно), btn: {x, y} } или undefined; btn это центр кнопки на карте
export function cameraMeta(cam) {
  return cameras[cam] ? { ...cameras[cam] } : undefined;
}

// Проверка данных. Возвращает список замечаний (пустой список = всё хорошо).
export function validateGraph() {
  const issues = [];
  const ids = positionIds();

  for (const id of ids) {
    const p = positions[id];
    for (const n of p.next) {
      if (!positions[n]) issues.push(`${id}: сосед «${n}» не существует`);
      else if (!positions[n].next.includes(id)) issues.push(`${id} → ${n}: нет обратной связи`);
    }
    for (const c of p.cams) {
      if (!cameras[c.cam]) issues.push(`${id}: камеры ${c.cam} нет в списке камер`);
    }
    if (p.blind !== undefined && p.blind !== (p.cams.length === 0)) {
      issues.push(`${id}: поле blind не совпадает со списком камер`);
    }
    if (distance(PLAYER_POS, id) === Infinity) issues.push(`${id}: не достижима от стола`);
  }

  for (const cam of cameraIds()) {
    if (mapViewData && !cameras[cam].btn) issues.push(`камера ${cam}: нет положения кнопки на карте`);
    if (!cameras[cam].img) issues.push(`камера ${cam}: нет пути к кадру (img)`);
    const own = cameras[cam].pos;
    if (!positions[own]) issues.push(`камера ${cam}: позиции «${own}» нет`);
    else if (!positions[own].cams.some((c) => c.cam === cam)) {
      issues.push(`камера ${cam} не видит свою позицию «${own}»`);
    }
  }

  // Один слот камеры у двух позиций: два НПС могут встать друг на друга.
  const used = {};
  for (const id of ids) {
    for (const c of positions[id].cams) {
      const key = `${c.cam}:${c.slot}`;
      (used[key] ||= []).push(id);
    }
  }
  for (const [key, list] of Object.entries(used)) {
    if (list.length > 1) {
      const [cam, slot] = key.split(':');
      issues.push(`камера ${cam}, слот ${slot}: ${list.join(', ')}`);
    }
  }
  return issues;
}