/* Day planner — core logic. Pure functions, no DOM: runs in the page and in Node tests.
   Data contract: see day-planner-spec.md (schema "day-planner/1"). */
(function (root) {
'use strict';

const SCHEMA = 'day-planner/1';

// ---------- tunables ----------
// Pace = how much of the day (start → back-by) may be busy with visits, meals and travel.
// Must-dos always go in; optional stops are added only while the day stays under this share.
const PACES = {
  less:     { key: 'less',     label: 'Do less',  busy: 0.55 },
  balanced: { key: 'balanced', label: 'Balanced', busy: 0.75 },
  packed:   { key: 'packed',   label: 'Packed',   busy: 1.0 },
};
const PACE_KEYS = ['less', 'balanced', 'packed'];

// Door-to-door public transport estimate from straight-line distance d (km):
//   overhead + d * detour / speed(d) * 60, speed rising from `near` (short urban hops)
//   to `far` (regional rail) as d grows. Deliberately rough — verified legs override it.
const TRANSIT = {
  metro:  { key: 'metro',  label: 'Dense metro',     overhead: 10, near: 22, far: 50, detour: 1.30 },
  city:   { key: 'city',   label: 'City tram & bus', overhead: 12, near: 18, far: 45, detour: 1.35 },
  sparse: { key: 'sparse', label: 'Sparse / rural',  overhead: 20, near: 22, far: 45, detour: 1.35 },
};
const CAR = { overhead: 6, near: 20, far: 60, detour: 1.35 };
const WALK_SPEED = { slow: 4.0, normal: 4.6, brisk: 5.2 };      // km/h
const WALK_LABEL = { slow: 'Slow', normal: 'Normal', brisk: 'Brisk' };
const WALK_DETOUR = 1.3;
const WALK_BIAS = 5;            // walk if at most this many minutes slower than riding
const VALUE = { must: 1000, want: 10, maybe: 3, skip: 0 };
const MODES = ['transit', 'walk', 'car'];
const MODE_WORD = { transit: 'train/bus', walk: 'walk', car: 'taxi' };
const PRIORITIES = ['must', 'want', 'maybe', 'skip'];
const KINDS = ['sight', 'food', 'shop', 'nature', 'museum', 'culture', 'view', 'experience', 'other'];
const DEFAULT_MEALS = [{ id: 'lunch', label: 'Lunch', from: '11:30', to: '13:30', duration: 60 }];

// ---------- small utils ----------
const isNum = (x) => typeof x === 'number' && isFinite(x);
function toNum(x) {
  if (isNum(x)) return x;
  if (typeof x === 'string' && x.trim() !== '' && isFinite(+x)) return +x;
  return null;
}
function str(x, max) {
  if (x == null) return '';
  const s = String(x).trim();
  return max ? s.slice(0, max) : s;
}
const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
const arr = (x) => (Array.isArray(x) ? x : []);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
function slug(x) {
  return str(x).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9._~:@+-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}
function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- time & date ----------
function parseTime(s) {
  if (isNum(s)) return Math.round(s);
  if (typeof s !== 'string') return null;
  const m = s.trim().match(/^(\d{1,2})[:.h](\d{2})$/);
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  if (mi > 59 || h > 47) return null;
  return h * 60 + mi;
}
function hhmm(min) {
  const mm = ((Math.round(min) % 1440) + 1440) % 1440;
  return String(Math.floor(mm / 60)).padStart(2, '0') + ':' + String(mm % 60).padStart(2, '0');
}
function fmtTime(min) {
  if (!isNum(min)) return '';
  const off = Math.floor(Math.round(min) / 1440);
  return hhmm(min) + (off > 0 ? ' (+1)' : off < 0 ? ' (−1)' : '');
}
function fmtDur(min) {
  if (!isNum(min)) return '';
  const m = Math.max(0, Math.round(min));
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60), r = m % 60;
  return r ? h + 'h ' + String(r).padStart(2, '0') : h + 'h';
}
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDateUK(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str(iso));
  if (!m) return str(iso);
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return WD[d.getUTCDay()] + ' ' + (+m[3]) + ' ' + MO[+m[2] - 1];
}

// ---------- geo & travel model ----------
function kmBetween(a, b) {
  const R = 6371.0088, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
function rideMinutes(km, p) {
  const v = p.near + (p.far - p.near) * (1 - Math.exp(-km / 8));
  return p.overhead + (km * p.detour / v) * 60;
}
const walkMinutes = (km, speed) => (km * WALK_DETOUR / speed) * 60;

// ---------- money ----------
function fmtMoney(price, fx) {
  if (!price) return '';
  if (price.text) return price.text;
  const { amount, currency } = price;
  if (amount === 0) return 'Free';
  let orig;
  try {
    orig = currency
      ? new Intl.NumberFormat('en-GB', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).format(amount)
      : String(amount);
  } catch (e) { orig = (currency ? currency + ' ' : '') + amount; }
  let out = orig;
  const rate = currency && fx ? toNum(fx[currency]) : null;
  if (currency && currency !== 'CHF' && rate) {
    const chf = amount * rate;
    const shown = chf >= 10 ? String(Math.round(chf)) : (Math.round(chf * 20) / 20).toFixed(2);
    out += ' (≈ CHF ' + shown + ')';
  }
  return out + (price.per ? ' ' + price.per : '');
}

// ---------- input normalisation ----------
function normSpan(raw) {
  if (raw == null || raw === '') return null;
  let a = null, b = null;
  if (Array.isArray(raw)) { a = raw[0]; b = raw[1]; }
  else if (typeof raw === 'object') { a = raw.from != null ? raw.from : raw.start; b = raw.to != null ? raw.to : raw.end; }
  else if (typeof raw === 'string') { const m = raw.split(/\s*[-–—]\s*/); a = m[0]; b = m[1]; }
  const f = parseTime(a), t = parseTime(b);
  if (f == null && t == null) return null;
  return { from: f, to: t != null && f != null && t < f ? t + 1440 : t };
}
function normHours(raw, issues, name) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'string') {
    const t = raw.trim().toLowerCase();
    if (['24h', '24/7', 'always', 'open', 'always open', 'none'].includes(t)) return null;
    raw = raw.split(/\s*[,;]\s*/);
  }
  const out = [];
  for (const h of arr(Array.isArray(raw) && (raw.length === 0 || typeof raw[0] !== 'string' || /[-–—]/.test(raw[0])) ? raw : [raw])) {
    let o = null, c = null, l = null;
    if (Array.isArray(h)) { o = parseTime(h[0]); c = parseTime(h[1]); l = parseTime(h[2]); }
    else if (h && typeof h === 'object') {
      o = parseTime(h.open); c = parseTime(h.close);
      l = parseTime(h.last != null ? h.last : h.lastEntry);
    } else if (typeof h === 'string') {
      const m = h.split(/\s*[-–—]\s*/); o = parseTime(m[0]); c = parseTime(m[1]);
    }
    if (o == null || c == null) { issues.push({ id: name, text: name + ': unreadable opening hours — treated as always open' }); continue; }
    if (c <= o) c += 1440;
    if (l != null && l < o) l += 1440;
    out.push({ open: o, close: c, last: l });
  }
  out.sort((a, b) => a.open - b.open);
  return out.length ? out : null;
}
function normPrice(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'string') return { text: raw.slice(0, 80) };
  if (isNum(raw)) return { amount: raw, currency: null, per: null };
  if (typeof raw === 'object') {
    const amount = toNum(raw.amount);
    if (amount == null) return raw.text ? { text: str(raw.text, 80) } : null;
    return { amount, currency: str(raw.currency, 3).toUpperCase() || null, per: str(raw.per, 20) || null };
  }
  return null;
}
function normLinks(raw) {
  const out = [];
  for (const l of arr(raw)) {
    const url = str(typeof l === 'string' ? l : obj(l).url, 500);
    if (!/^https?:\/\//i.test(url)) continue;
    let label = str(obj(l).label, 60);
    if (!label) { try { label = new URL(url).hostname.replace(/^www\./, ''); } catch (e) { label = 'Link'; } }
    out.push({ url, label });
    if (out.length >= 6) break;
  }
  return out;
}
const cleanId = (s) => str(s, 80).replace(/[>|\s/]+/g, '-');

function normState(s) {
  s = obj(s);
  const dict = (x, f) => {
    const out = {};
    for (const [k, v] of Object.entries(obj(x))) { const r = f(v, k); if (r != null) out[k] = r; }
    return out;
  };
  const time = (x) => { const t = parseTime(x); return t == null ? null : hhmm(t); };
  return {
    mode: MODES.includes(s.mode) ? s.mode : null,
    pace: PACES[s.pace] ? s.pace : null,
    transit: TRANSIT[s.transit] ? s.transit : null,
    walkSpeed: WALK_SPEED[s.walkSpeed] ? s.walkSpeed : null,
    maxWalk: toNum(s.maxWalk) != null ? clamp(toNum(s.maxWalk), 0, 90) : null,
    fixedBuffer: toNum(s.fixedBuffer) != null ? clamp(toNum(s.fixedBuffer), 0, 60) : null,
    startTime: time(s.startTime),
    endBy: time(s.endBy),
    priority: dict(s.priority, (v) => (PRIORITIES.includes(v) ? v : null)),
    duration: dict(s.duration, (v) => (toNum(v) != null ? clamp(Math.round(toNum(v)), 5, 720) : null)),
    legs: dict(s.legs, (v) => { const m = toNum(obj(v).minutes != null ? v.minutes : v); return m == null ? null : { minutes: clamp(Math.round(m), 0, 600) }; }),
    legPick: dict(s.legPick, (v) => (MODES.includes(v) ? v : null)),
    meals: dict(s.meals, (v) => (v === false ? false : null)),
    order: Array.isArray(s.order) ? s.order.map((x) => str(x, 90)).filter(Boolean).slice(0, 200) : null,
  };
}
function stateIsEmpty(st) {
  const s = normState(st);
  return !s.mode && !s.pace && !s.transit && !s.walkSpeed && s.maxWalk == null && s.fixedBuffer == null &&
    !s.startTime && !s.endBy && !s.order && !Object.keys(s.priority).length && !Object.keys(s.duration).length &&
    !Object.keys(s.legs).length && !Object.keys(s.legPick).length && !Object.keys(s.meals).length;
}

function buildModel(trip, day, rawState) {
  trip = obj(trip); day = obj(day);
  const state = normState(rawState);
  const issues = [];
  const tzLabel = str(day.tzLabel || trip.tzLabel, 12);
  const mode = state.mode || (MODES.includes(day.mode) ? day.mode : 'transit');
  const transitKey = state.transit || (TRANSIT[day.transit] ? day.transit : TRANSIT[trip.transit] ? trip.transit : 'city');
  const transit = TRANSIT[transitKey];
  const walkKey = state.walkSpeed || (WALK_SPEED[day.walkSpeed] ? day.walkSpeed : 'normal');
  const walkSpeed = WALK_SPEED[walkKey];
  const maxWalk = state.maxWalk != null ? state.maxWalk : (toNum(day.maxWalk) != null ? clamp(toNum(day.maxWalk), 0, 90) : 20);
  const fixedBuffer = state.fixedBuffer != null ? state.fixedBuffer : (toNum(day.fixedBuffer) != null ? clamp(toNum(day.fixedBuffer), 0, 60) : 10);
  const pace = state.pace || (PACES[day.pace] ? day.pace : 'balanced');

  // start / end anchors
  const s = obj(day.start);
  const start = { id: 'start', kind: 'anchor', name: str(s.name, 80) || 'Start', lat: toNum(s.lat), lng: toNum(s.lng) };
  let end = null;
  if (day.end !== null) {
    const e = obj(day.end);
    const has = toNum(e.lat) != null && toNum(e.lng) != null;
    end = { id: 'end', kind: 'anchor', name: str(e.name, 80) || (has ? 'End' : start.name), lat: has ? toNum(e.lat) : start.lat, lng: has ? toNum(e.lng) : start.lng, sameAsStart: !has };
  }
  const baseStart = parseTime(s.time) != null ? parseTime(s.time) : 540;
  const startTime = parseTime(state.startTime) != null ? parseTime(state.startTime) : baseStart;
  let baseEnd = parseTime(obj(day.end).time);
  if (baseEnd == null) baseEnd = parseTime(day.endBy);
  if (baseEnd == null) baseEnd = 1260;
  let endBy = parseTime(state.endBy) != null ? parseTime(state.endBy) : baseEnd;
  if (endBy <= startTime) endBy += 1440;

  // meals (floating breaks unless a meal place is chosen)
  const meals = {}, mealList = [];
  for (const m of (Array.isArray(day.meals) ? day.meals : DEFAULT_MEALS)) {
    const mo = obj(m);
    const id = cleanId(mo.id) || slug(mo.label) || 'meal';
    const from = parseTime(mo.from), to0 = parseTime(mo.to);
    if (from == null || to0 == null) { issues.push({ id, text: 'Meal "' + (str(mo.label) || id) + '": needs from/to times' }); continue; }
    if (meals[id]) continue;
    const meal = {
      id, label: str(mo.label, 30) || 'Meal', from, to: to0 < from ? to0 + 1440 : to0,
      duration: clamp(Math.round(toNum(mo.duration) || 60), 10, 240),
      enabled: state.meals[id] !== false && mo.enabled !== false,
    };
    meal.outside = meal.to < startTime || meal.from + meal.duration > endBy;
    if (meal.outside) meal.enabled = false;
    meals[id] = meal; mealList.push(meal);
  }

  // places
  const places = {}, placeList = [], ids = new Set(['start', 'end']);
  arr(day.places).forEach((raw0, i) => {
    const raw = obj(raw0);
    let id = cleanId(raw.id) || slug(raw.name) || 'place-' + (i + 1);
    if (id.startsWith('meal:')) id = id.replace(':', '-');
    if (ids.has(id)) {
      let k = 2; while (ids.has(id + '-' + k)) k++;
      issues.push({ id, text: 'Duplicate id "' + id + '" — renamed to "' + id + '-' + k + '"' });
      id = id + '-' + k;
    }
    ids.add(id);
    const p = { id, raw: raw0 };
    p.name = str(raw.name, 120) || id;
    p.lat = toNum(raw.lat); p.lng = toNum(raw.lng != null ? raw.lng : raw.lon);
    p.bad = p.lat == null || p.lng == null || Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180;
    if (p.bad) issues.push({ id, text: p.name + ': missing or invalid coordinates — not on the map' });
    p.area = str(raw.area, 60);
    p.kind = KINDS.includes(raw.kind) ? raw.kind : 'other';
    p.basePriority = PRIORITIES.includes(raw.priority) ? raw.priority : 'want';
    p.priority = state.priority[id] || p.basePriority;
    p.baseDuration = toNum(raw.duration) != null ? clamp(Math.round(toNum(raw.duration)), 5, 720) : 60;
    p.duration = state.duration[id] != null ? state.duration[id] : p.baseDuration;
    p.fixed = parseTime(raw.fixed);
    p.window = normSpan(raw.window);
    p.prefer = normSpan(raw.prefer);
    p.hours = normHours(raw.hours, issues, p.name);
    p.closed = raw.closed === true;
    p.mealId = cleanId(raw.meal) || null;
    p.group = str(raw.group, 40) || null;
    p.price = normPrice(raw.price);
    p.note = str(raw.note, 600);
    p.check = str(raw.check, 300);
    p.locSource = str(raw.loc, 30);
    p.approx = p.locSource === 'approx';
    p.booked = raw.booked === true;
    p.tags = arr(raw.tags).map((t) => str(t, 24)).filter(Boolean).slice(0, 6);
    p.links = normLinks(raw.links);
    if (raw.fixed != null && p.fixed == null) issues.push({ id, text: p.name + ': unreadable fixed time "' + str(raw.fixed, 12) + '"' });
    if (p.mealId && !meals[p.mealId]) issues.push({ id, text: p.name + ': meal "' + p.mealId + '" is not one of this day\'s meals' });
    const meal = p.mealId && meals[p.mealId] && meals[p.mealId].enabled ? meals[p.mealId] : null;
    p.groupKey = meal ? 'meal:' + meal.id : (p.group ? 'g:' + p.group : null);
    // allowed START intervals: opening hours ∩ window ∩ meal window
    let iv = p.hours ? p.hours.map((h) => [h.open, Math.min(h.last != null ? h.last : Infinity, h.close - p.duration)]) : [[-Infinity, Infinity]];
    const cut = (span) => { if (span) iv = iv.map(([a, b]) => [Math.max(a, span.from != null ? span.from : -Infinity), Math.min(b, span.to != null ? span.to : Infinity)]); };
    cut(p.window);
    if (meal) cut({ from: meal.from, to: meal.to });
    p.iv = p.closed ? [] : iv.filter(([a, b]) => b >= a).sort((x, y) => x[0] - y[0]);
    if (p.fixed != null && p.hours && !p.hours.some((h) => p.fixed >= h.open && p.fixed + p.duration <= h.close)) {
      issues.push({ id, text: p.name + ': the ' + hhmm(p.fixed) + ' slot is outside the listed opening hours' });
    }
    places[id] = p; placeList.push(p);
  });

  // start fallback + outlier guard
  const good = placeList.filter((p) => !p.bad);
  if (start.lat == null || start.lng == null) {
    if (good.length) {
      start.lat = good.reduce((a, p) => a + p.lat, 0) / good.length;
      start.lng = good.reduce((a, p) => a + p.lng, 0) / good.length;
      issues.push({ id: 'start', text: 'No start location — using the middle of the candidates' });
    } else { start.lat = 0; start.lng = 0; }
    if (end && end.sameAsStart) { end.lat = start.lat; end.lng = start.lng; }
  }
  if (good.length >= 3) {
    const med = (xs) => { const v = xs.slice().sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
    const c = { lat: med(good.map((p) => p.lat)), lng: med(good.map((p) => p.lng)) };
    const ds = good.map((p) => kmBetween(p, c));
    const md = med(ds);
    good.forEach((p, i) => {
      if (ds[i] > Math.max(40, 6 * md)) issues.push({ id: p.id, text: p.name + ': ' + Math.round(ds[i]) + ' km from the others — check its coordinates' });
    });
  }

  const landmarks = [];
  for (const l of arr(day.landmarks)) {
    const lo = obj(l), la = toNum(lo.lat), ln = toNum(lo.lng);
    if (la == null || ln == null) continue;
    landmarks.push({ id: 'lm-' + landmarks.length, kind: 'landmark', name: str(lo.name, 60) || 'Landmark', lat: la, lng: ln });
    if (landmarks.length >= 20) break;
  }

  // verified leg times: chat first, then the user's own entries on top
  const verified = new Map();
  for (const l of arr(day.legs)) {
    const lo = obj(l);
    const from = cleanId(lo.from), to = cleanId(lo.to), mn = toNum(lo.minutes);
    const m = MODES.includes(lo.mode) ? lo.mode : 'transit';
    if (!from || !to || mn == null) { issues.push({ id: 'legs', text: 'A leg entry needs from, to and minutes' }); continue; }
    verified.set(from + '>' + to + '|' + m, { minutes: clamp(Math.round(mn), 0, 600), by: 'chat', note: str(lo.note, 200), source: str(lo.source, 300), checked: str(lo.checked, 24) });
  }
  for (const [k, v] of Object.entries(state.legs)) verified.set(k, { minutes: v.minutes, by: 'you', note: '', source: '' });
  const sameStartEnd = !!end && kmBetween(start, end) < 0.05;
  const alias = (x) => (sameStartEnd && x === 'end' ? 'start' : x);
  function lookup(a, b, m) {
    return verified.get(a + '>' + b + '|' + m) || verified.get(b + '>' + a + '|' + m) ||
      verified.get(alias(a) + '>' + alias(b) + '|' + m) || verified.get(alias(b) + '>' + alias(a) + '|' + m) || null;
  }
  function pickFor(a, b) {
    return state.legPick[a + '>' + b] || state.legPick[b + '>' + a] || state.legPick[alias(a) + '>' + alias(b)] || state.legPick[alias(b) + '>' + alias(a)] || null;
  }

  // node index + memoised leg matrix
  const nodes = [start];
  if (end) nodes.push(end);
  for (const p of good) nodes.push(p);
  nodes.forEach((n, i) => { n.ix = i; });
  const N = nodes.length;
  const legCache = new Array(N * N);
  function computeLeg(A, B) {
    const km = kmBetween(A, B);
    const vw = lookup(A.id, B.id, 'walk');
    const walk = vw ? { mode: 'walk', minutes: vw.minutes, estimate: false, by: vw.by, note: vw.note, source: vw.source }
      : { mode: 'walk', minutes: km < 0.02 ? 0 : Math.max(1, Math.round(walkMinutes(km, walkSpeed))), estimate: true };
    let ride = null;
    if (mode !== 'walk') {
      const vr = lookup(A.id, B.id, mode);
      ride = vr ? { mode, minutes: vr.minutes, estimate: false, by: vr.by, note: vr.note, source: vr.source }
        : { mode, minutes: Math.round(rideMinutes(km, mode === 'car' ? CAR : transit)), estimate: true };
    }
    const pick = pickFor(A.id, B.id);
    let chosen, auto = true;
    if (!ride) chosen = walk;
    else if (pick === 'walk') { chosen = walk; auto = false; }
    else if (pick === mode) { chosen = ride; auto = false; }
    else if (km < 0.02 && !vw) chosen = walk;
    else {
      const bias = walk.estimate && !ride.estimate ? 0 : WALK_BIAS;
      chosen = walk.minutes <= maxWalk && walk.minutes <= ride.minutes + bias ? walk : ride;
    }
    return Object.freeze(Object.assign({}, chosen, { km, walk, ride, auto, from: A.id, to: B.id }));
  }
  function leg(A, B) {
    if (A.ix == null || B.ix == null) return computeLeg(A, B);
    const k = A.ix * N + B.ix;
    let r = legCache[k];
    if (r === undefined) { r = computeLeg(A, B); legCache[k] = r; }
    return r;
  }

  const sig = String(hashStr(JSON.stringify([
    mode, transitKey, walkKey, maxWalk, fixedBuffer, startTime, endBy,
    start.lat, start.lng, end ? [end.lat, end.lng] : null,
    mealList.map((m) => [m.id, m.from, m.to, m.duration, m.enabled]),
    placeList.map((p) => [p.id, p.lat, p.lng, p.priority, p.duration, p.fixed, p.iv, p.prefer, p.groupKey, p.closed, p.bad]),
    [...verified.entries()], state.legPick,
  ])));

  return {
    schema: SCHEMA, state, issues, tzLabel, mode, pace, transitKey, walkKey, maxWalk, fixedBuffer,
    date: str(day.date, 10), title: str(day.title, 80), notes: str(day.notes, 2000),
    fx: obj(trip.fx), fxDate: str(trip.fxDate, 24),
    start, end, startTime, endBy, baseStart, baseEnd,
    places, placeList, meals, mealList, landmarks, nodes, leg, lookup, sig,
  };
}

// ---------- schedule simulation ----------
const isMealKey = (k) => k.charCodeAt(0) === 109 && k.startsWith('meal:');
function groupOf(M, key) {
  if (isMealKey(key)) return key;
  const p = M.places[key];
  return p ? p.groupKey : null;
}
const penalty = (sev, minutes) => (sev === 'error' ? 10000 + 100 * minutes : 50 + 5 * minutes);

// Walks a route through the day. full=false skips the per-item detail (used by the optimiser).
function simulate(M, route, full) {
  full = full !== false;
  let t = M.startTime, prev = M.start;
  const items = full ? [] : null, viol = full ? [] : null;
  let travel = 0, wait = 0, visit = 0, meals = 0, pref = 0, violPen = 0;
  const flag = (v) => { violPen += penalty(v.sev, v.minutes); if (full) viol.push(v); };
  for (const key of route) {
    if (isMealKey(key)) {
      const meal = M.meals[key.slice(5)];
      if (!meal) continue;
      const st = Math.max(t, meal.from);
      if (st > meal.to) flag({ key, kind: 'meal-late', minutes: st - meal.to, sev: 'warn' });
      wait += st - t; meals += meal.duration;
      if (full) items.push({ type: 'meal', key, meal, arrive: t, start: st, end: st + meal.duration, wait: st - t, near: prev });
      t = st + meal.duration;
      continue;
    }
    const p = M.places[key];
    if (!p || p.bad) continue;
    const lg = M.leg(prev, p);
    const arrive = t + lg.minutes;
    travel += lg.minutes;
    let st = arrive;
    if (p.closed) flag({ key, kind: 'closed', minutes: 0, sev: 'error' });
    else if (p.fixed != null) {
      st = Math.max(arrive, p.fixed);
      if (arrive > p.fixed) flag({ key, kind: 'late-fixed', minutes: arrive - p.fixed, sev: 'error' });
      else if (arrive + M.fixedBuffer > p.fixed) flag({ key, kind: 'tight-fixed', minutes: arrive + M.fixedBuffer - p.fixed, sev: 'warn' });
    } else if (p.iv.length === 0) flag({ key, kind: 'no-window', minutes: 0, sev: 'error' });
    else {
      let found = false;
      for (const [lo, hi] of p.iv) { if (arrive <= hi) { st = Math.max(arrive, lo); found = true; break; } }
      if (!found) { const hi = p.iv[p.iv.length - 1][1]; flag({ key, kind: 'too-late', minutes: arrive - hi, latest: hi, sev: 'error' }); }
    }
    wait += st - arrive;
    visit += p.duration;
    if (p.prefer) {
      if (p.prefer.from != null && st < p.prefer.from) pref += p.prefer.from - st;
      if (p.prefer.to != null && st > p.prefer.to) pref += st - p.prefer.to;
    }
    if (full) items.push({ type: 'visit', key, place: p, leg: lg, arrive, start: st, end: st + p.duration, wait: st - arrive });
    t = st + p.duration; prev = p;
  }
  let finish = t, endLeg = null;
  if (M.end) { endLeg = M.leg(prev, M.end); finish = t + endLeg.minutes; travel += endLeg.minutes; }
  if (finish > M.endBy) flag({ key: 'end', kind: 'late-end', minutes: finish - M.endBy, sev: 'error' });
  return { route, items, endLeg, finish, travel, wait, visit, meals, active: visit + travel + meals, pref, viol, violPen };
}

function valueOf(M, route) {
  let v = 0;
  for (const k of route) { const p = M.places[k]; if (p) v += VALUE[p.priority] || 0; }
  return v;
}
const scoreOf = (M, sim) => valueOf(M, sim.route) - 0.05 * sim.travel - 0.02 * sim.wait - 0.15 * sim.pref - sim.violPen - 0.001 * sim.finish;

// Insert `key` at its best position (fewest violations, then best score). A meal place replaces
// the floating break of its meal. Returns {route, sim (lite), score} or null if `filter` rejects all.
function bestInsert(M, route, key, filter) {
  let base = route;
  const g = groupOf(M, key);
  if (g && g.startsWith('meal:') && !isMealKey(key)) {
    const fi = route.indexOf(g);
    if (fi >= 0) base = route.slice(0, fi).concat(route.slice(fi + 1));
  }
  let best = null;
  for (let i = 0; i <= base.length; i++) {
    const r = base.slice(0, i).concat([key], base.slice(i));
    const sim = simulate(M, r, false);
    const e = { route: r, sim, score: scoreOf(M, sim) };
    if (filter && !filter(e)) continue;
    if (!best || e.sim.violPen < best.sim.violPen || (e.sim.violPen === best.sim.violPen && e.score > best.score)) best = e;
  }
  return best;
}
// Remove `key`; if it was the chosen meal place, the floating meal break comes back in its slot.
function removeKey(M, route, key) {
  const i = route.indexOf(key);
  if (i < 0) return route.slice();
  const r = route.slice(0, i).concat(route.slice(i + 1));
  const g = groupOf(M, key);
  if (g && g.startsWith('meal:') && !isMealKey(key)) {
    const m = M.meals[g.slice(5)];
    if (m && m.enabled && !r.some((k) => groupOf(M, k) === g)) r.splice(i, 0, g);
  }
  return r;
}
const busyBudget = (M, paceKey) => (PACES[paceKey] || PACES.balanced).busy * (M.endBy - M.startTime);

// ---------- optimiser ----------
function optimize(M, paceKey, opts) {
  const budget = busyBudget(M, paceKey);
  const isOptional = (k) => { const p = M.places[k]; return !!p && p.priority !== 'must'; };
  const budgetOk = (route, sim) => sim.active <= budget + 1e-9 || !route.some(isOptional);
  const ev = (route) => { const sim = simulate(M, route, false); return { route, sim, score: scoreOf(M, sim), budget: budgetOk(route, sim) }; };
  const better = (a, b) => (a.sim.violPen !== b.sim.violPen ? a.sim.violPen < b.sim.violPen : a.score > b.score + 1e-9);
  const accept = (e, cur) => {
    if (!e.budget && cur.budget) return false;
    if (e.sim.violPen !== cur.sim.violPen) return e.sim.violPen < cur.sim.violPen;
    return e.score > cur.score + 1e-6;
  };

  const cands = M.placeList.filter((p) => !p.bad && p.priority !== 'skip');
  const musts = cands.filter((p) => p.priority === 'must').map((p) => p.id);
  const usable = (p) => !p.closed && (p.fixed != null || p.iv.length > 0);
  const wants = cands.filter((p) => p.priority === 'want' && usable(p)).map((p) => p.id);
  const maybes = cands.filter((p) => p.priority === 'maybe' && usable(p)).map((p) => p.id);
  const floats = M.mealList.filter((m) => m.enabled).map((m) => 'meal:' + m.id);
  const anchorOf = (id) => { const p = M.places[id]; return p.fixed != null ? p.fixed : (p.window && p.window.from != null ? p.window.from : null); };
  const slack = (id) => M.places[id].iv.reduce((a, [lo, hi]) => a + Math.min(hi, 3000) - Math.max(lo, -3000), 0);
  const groupTaken = (route, id) => { const g = groupOf(M, id); return !!g && route.some((k) => k !== g && k !== id && groupOf(M, k) === g); };

  // Optional stops: no new violations, stay within the pace budget, at most one per group.
  function fillFrom(route, pool, noise, rng) {
    pool = pool.filter((id) => !route.includes(id));
    for (;;) {
      const cur = ev(route);
      let pick = null;
      for (const id of pool) {
        if (groupTaken(route, id)) continue;
        const e = bestInsert(M, route, id, (x) => x.sim.violPen <= cur.sim.violPen && budgetOk(x.route, x.sim));
        if (!e) continue;
        const gain = e.score - cur.score;
        if (gain <= 0) continue;
        let ratio = gain / Math.max(1, e.sim.active - cur.sim.active);
        if (noise) ratio *= 1 + noise * (rng() - 0.5);
        if (!pick || ratio > pick.ratio) pick = { ratio, e, id };
      }
      if (!pick) return route;
      route = pick.e.route;
      pool = pool.filter((x) => x !== pick.id);
    }
  }
  function construct(noise, rng) {
    // time anchors first (fixed/windowed must-dos and meal breaks, by time), then the other must-dos
    const anchors = musts.filter((id) => anchorOf(id) != null).map((id) => [id, anchorOf(id)]);
    for (const f of floats) if (!musts.some((id) => groupOf(M, id) === f)) anchors.push([f, M.meals[f.slice(5)].from]);
    let route = anchors.sort((a, b) => a[1] - b[1]).map((x) => x[0]);
    let rest = musts.filter((id) => anchorOf(id) == null).sort((a, b) => slack(a) - slack(b));
    if (noise) rest = rest.map((id) => [id, rng()]).sort((a, b) => a[1] - b[1]).map((x) => x[0]);
    for (const id of rest) route = bestInsert(M, route, id).route;
    route = fillFrom(route, wants, noise, rng);
    return fillFrom(route, maybes, noise, rng);
  }
  function improve(route) {
    let cur = ev(route);
    const pool = wants.concat(maybes);
    for (let pass = 0; pass < 12; pass++) {
      let changed = false;
      for (let i = 0; i < route.length; i++) {          // relocate one stop
        for (let j = 0; j < route.length; j++) {
          if (i === j) continue;
          const r = route.slice(); const [x] = r.splice(i, 1); r.splice(j, 0, x);
          const e = ev(r);
          if (accept(e, cur)) { route = r; cur = e; changed = true; }
        }
      }
      for (let i = 0; i < route.length - 2; i++) {      // reverse a stretch (2-opt)
        for (let j = i + 2; j < route.length; j++) {
          const r = route.slice(0, i).concat(route.slice(i, j + 1).reverse(), route.slice(j + 1));
          const e = ev(r);
          if (accept(e, cur)) { route = r; cur = e; changed = true; }
        }
      }
      for (const o of route.filter(isOptional)) {       // swap an optional stop for a better one
        if (!route.includes(o)) continue;
        const without = removeKey(M, route, o);
        for (const u of pool) {
          if (u === o || route.includes(u) || groupTaken(without, u)) continue;
          const b = bestInsert(M, without, u);
          if (!b) continue;
          const e = ev(b.route);
          if (accept(e, cur)) { route = e.route; cur = e; changed = true; break; }
        }
      }
      const filled = fillFrom(fillFrom(route, wants, 0, null), maybes, 0, null);   // add
      if (filled !== route) { const e = ev(filled); if (accept(e, cur)) { route = filled; cur = e; changed = true; } }
      for (const o of route.filter(isOptional)) {       // drop
        const e = ev(removeKey(M, route, o));
        if (accept(e, cur)) { route = e.route; cur = e; changed = true; }
      }
      if (!changed) break;
    }
    return route;
  }

  const rng = mulberry32(hashStr(M.sig + '|' + paceKey));
  const restarts = opts && opts.restarts ? opts.restarts : cands.length > 20 ? 3 : cands.length > 12 ? 4 : 6;
  let best = null;
  for (let r = 0; r < restarts; r++) {
    const e = ev(improve(construct(r === 0 ? 0 : 0.6, rng)));
    if (!best || better(e, best)) best = e;
  }
  best.sim = simulate(M, best.route, true);
  return best;
}

const variantMemo = new Map();
function variant(M, paceKey) {
  const k = M.sig + '|' + paceKey;
  let v = variantMemo.get(k);
  if (!v) {
    v = optimize(M, paceKey);
    variantMemo.set(k, v);
    if (variantMemo.size > 24) variantMemo.delete(variantMemo.keys().next().value);
  }
  return v;
}
function variants(M) {
  const out = {};
  for (const k of PACE_KEYS) out[k] = variant(M, k);
  return out;
}

// A manual order from the user, made consistent with the current data.
function sanitizeOrder(M, order) {
  const seen = new Set();
  let out = [];
  for (const k of arr(order)) {
    if (seen.has(k)) continue;
    if (isMealKey(k)) { const m = M.meals[k.slice(5)]; if (!m || !m.enabled) continue; }
    else { const p = M.places[k]; if (!p || p.bad || p.priority === 'skip') continue; }
    seen.add(k); out.push(k);
  }
  for (const m of M.mealList) {
    const g = 'meal:' + m.id;
    if (!m.enabled) continue;
    const hasPlace = out.some((k) => !isMealKey(k) && groupOf(M, k) === g);
    if (hasPlace) out = out.filter((k) => k !== g);
    else if (!out.includes(g)) out = bestInsert(M, out, g).route;
  }
  for (const p of M.placeList) {
    if (p.priority === 'must' && !p.bad && !out.includes(p.id)) out = bestInsert(M, out, p.id).route;
  }
  return out;
}

// ---------- explanations & results ----------
function nameOf(M, key) {
  if (key === 'start') return M.start.name;
  if (key === 'end') return M.end ? M.end.name : 'End';
  if (isMealKey(key)) { const m = M.meals[key.slice(5)]; return m ? m.label : key; }
  const p = M.places[key];
  return p ? p.name : key;
}
function joinNames(list) {
  if (list.length <= 1) return list.join('');
  return list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
}
const lcFirst = (s) => (s && /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
function violText(M, v, sim) {
  const name = nameOf(M, v.key), p = M.places[v.key], meal = isMealKey(v.key) ? M.meals[v.key.slice(5)] : null;
  switch (v.kind) {
    case 'late-fixed': return name + ': arrives ' + fmtDur(v.minutes) + ' after the ' + hhmm(p.fixed) + ' start';
    case 'tight-fixed': return name + ': only ' + Math.max(0, M.fixedBuffer - v.minutes) + ' min to spare before ' + hhmm(p.fixed);
    case 'too-late': return name + ': arrives after the last start time (' + hhmm(v.latest) + ')';
    case 'closed': return name + ' is closed this day';
    case 'no-window': return name + ': no opening slot fits a ' + fmtDur(p.duration) + ' visit';
    case 'meal-late': return meal.label + ' starts ' + fmtDur(v.minutes) + ' after ' + hhmm(meal.to);
    case 'late-end': return 'Back at ' + (M.end ? M.end.name : 'the end') + ' ' + fmtTime(sim.finish) + ' — ' + fmtDur(v.minutes) + ' after ' + hhmm(M.endBy);
    default: return name + ': ' + v.kind;
  }
}
// Why adding `key` breaks the day: the first violation the addition introduces.
function whyNot(M, simNew, simBase, key) {
  const had = new Map(simBase.viol.map((v) => [v.key + v.kind, v.minutes]));
  const fresh = simNew.viol.filter((v) => !had.has(v.key + v.kind) || had.get(v.key + v.kind) < v.minutes);
  const v = fresh.find((x) => x.key === key) || fresh.find((x) => x.sev === 'error') || fresh[0];
  if (!v) return 'Doesn\'t fit';
  const p = M.places[v.key];
  switch (v.kind) {
    case 'late-end': return 'Doesn\'t fit: you\'d be back ' + hhmm(simNew.finish) + ', after ' + hhmm(M.endBy);
    case 'too-late': return v.key === key ? 'Doesn\'t fit: last start ' + hhmm(v.latest) : 'Doesn\'t fit: you\'d miss ' + p.name + ' (last start ' + hhmm(v.latest) + ')';
    case 'late-fixed': return 'Doesn\'t fit: clashes with ' + p.name + ' (' + hhmm(p.fixed) + ')';
    case 'tight-fixed': return 'Too tight before ' + p.name + ' (' + hhmm(p.fixed) + ')';
    case 'meal-late': return 'Doesn\'t fit: pushes ' + M.meals[v.key.slice(5)].label.toLowerCase() + ' past ' + hhmm(M.meals[v.key.slice(5)].to);
    case 'closed': return 'Closed this day';
    default: return 'Doesn\'t fit';
  }
}
// Re-plan with `key` forced in (as a must-do) — what the "Add" button would produce.
function forcedPlan(M, paceKey, key) {
  const p = M.places[key];
  const old = p.priority;
  p.priority = 'must';
  try { return optimize(M, paceKey, { restarts: 2 }); } finally { p.priority = old; }
}
// For every candidate not in the route: why, and what adding it would do.
// deep=true re-plans with it forced in (accurate "fits if you drop …"); otherwise a cheap best-slot insertion.
function explainLeftOut(M, route, opts) {
  opts = opts || {};
  const manual = !!opts.manual, deep = !!opts.deep && !manual, paceKey = opts.pace || M.pace;
  const inR = new Set(route);
  const base = simulate(M, route, true);
  const out = [];
  for (const p of M.placeList) {
    if (inR.has(p.id)) continue;
    const it = { id: p.id, reason: '', text: '', addMin: null, finish: null, drops: [], rival: null, action: null, deep };
    if (p.bad) { it.reason = 'no-location'; it.text = 'No coordinates yet'; }
    else if (p.priority === 'skip') { it.reason = 'skipped'; it.text = 'Skipped'; it.action = 'restore'; }
    else if (p.closed) { it.reason = 'closed'; it.text = 'Closed this day'; }
    else if (p.fixed == null && p.iv.length === 0) {
      it.reason = 'hours';
      it.text = p.window || (p.groupKey && p.groupKey.startsWith('meal:')) ? 'No slot fits its time window' : 'Opening hours too short for a ' + fmtDur(p.duration) + ' visit';
    } else {
      const rival = p.groupKey ? route.find((k) => k !== p.id && !isMealKey(k) && M.places[k] && M.places[k].groupKey === p.groupKey) : null;
      let r2;
      if (deep) r2 = forcedPlan(M, paceKey, p.id).route;
      else r2 = bestInsert(M, rival ? removeKey(M, route, rival) : route, p.id).route;
      const s2 = simulate(M, r2, true);
      it.addMin = s2.finish - base.finish;
      it.finish = s2.finish;
      it.drops = route.filter((k) => M.places[k] && k !== rival && !r2.includes(k));
      const dropNames = joinNames(it.drops.map((k) => M.places[k].name));
      if (rival) {
        it.reason = 'alternative'; it.rival = rival; it.action = 'use';
        it.text = 'Alternative to ' + M.places[rival].name;
      } else if (s2.violPen > base.violPen) {
        it.reason = 'conflict'; it.action = 'force';
        it.text = whyNot(M, s2, base, p.id);
      } else {
        it.reason = manual ? 'not-added' : 'not-picked'; it.action = 'add';
        it.text = it.drops.length ? 'Fits if you drop ' + dropNames : (manual ? 'Not in your order' : 'Not picked');
      }
    }
    out.push(it);
  }
  const rank = { must: 0, want: 1, maybe: 2, skip: 3 };
  out.sort((a, b) => rank[M.places[a.id].priority] - rank[M.places[b.id].priority]);
  return out;
}

function legOut(lg) {
  return { type: 'travel', from: lg.from, to: lg.to, mode: lg.mode, minutes: lg.minutes, estimate: lg.estimate, by: lg.by || null, note: lg.note || null, km: Math.round(lg.km * 10) / 10 };
}
function leftOutJson(M, left) {
  return left.map((l) => ({
    id: l.id, name: M.places[l.id].name, priority: M.places[l.id].priority, reason: l.reason, text: l.text,
    addMin: l.addMin, finishIfAdded: l.finish != null ? fmtTime(l.finish) : null, drops: l.drops.map((k) => M.places[k].name),
  }));
}
function buildResult(M, route, sim, left, meta) {
  meta = meta || {};
  const timeline = [{ type: 'start', id: 'start', name: M.start.name, time: hhmm(M.startTime) }];
  for (const it of sim.items) {
    if (it.type === 'meal') {
      timeline.push({ type: 'meal', id: it.meal.id, label: it.meal.label, start: fmtTime(it.start), end: fmtTime(it.end), wait: it.wait, near: it.near.id, nearName: it.near.name });
    } else {
      const p = it.place;
      timeline.push(legOut(it.leg));
      timeline.push({
        type: 'visit', id: p.id, name: p.name, area: p.area || null, arrive: fmtTime(it.arrive), start: fmtTime(it.start), end: fmtTime(it.end),
        wait: it.wait, duration: p.duration, priority: p.priority, fixed: p.fixed != null ? hhmm(p.fixed) : null, booked: p.booked,
        check: p.check || null, approxLocation: p.approx, meal: p.groupKey && p.groupKey.startsWith('meal:') ? p.mealId : null,
        price: p.price ? fmtMoney(p.price, M.fx) : null, note: p.note || null,
      });
    }
  }
  if (M.end) {
    timeline.push(legOut(sim.endLeg));
    timeline.push({ type: 'end', id: 'end', name: M.end.name, time: fmtTime(sim.finish) });
  }
  const visits = sim.items.filter((i) => i.type === 'visit');
  const legs = timeline.filter((x) => x.type === 'travel');
  return {
    schema: SCHEMA, tripId: meta.tripId || null, dayId: meta.dayId || null, basedOn: meta.basedOn || null,
    computedAt: meta.now || null, date: M.date, dayLabel: fmtDateUK(M.date), title: M.title, tz: M.tzLabel || null,
    mode: M.mode, pace: M.pace, order: meta.manual ? 'manual' : 'suggested',
    startTime: hhmm(M.startTime), endBy: hhmm(M.endBy),
    summary: {
      stops: visits.length, start: hhmm(M.startTime), finish: fmtTime(sim.finish), travelMin: sim.travel, visitMin: sim.visit,
      waitMin: sim.wait, spareMin: M.endBy - sim.finish,
      estimatedLegs: legs.filter((l) => l.estimate && l.minutes > 0).length, checkedLegs: legs.filter((l) => !l.estimate).length,
    },
    timeline,
    leftOut: leftOutJson(M, left),
    issues: sim.viol.map((v) => ({ severity: v.sev, id: v.key, text: violText(M, v, sim) })),
    checks: visits.filter((i) => i.place.check || i.place.approx).map((i) => ({ id: i.place.id, name: i.place.name, text: i.place.check || 'Location is approximate' })),
    text: planText(M, sim, left),
  };
}
function planText(M, sim, left) {
  const L = [];
  L.push([fmtDateUK(M.date), M.title].filter(Boolean).join(' · ') + (M.tzLabel ? ' (times ' + M.tzLabel + ')' : ''));
  const legLine = (lg) => '      ' + MODE_WORD[lg.mode] + ' ' + (lg.estimate ? '≈ ' : '') + fmtDur(lg.minutes) + (lg.estimate ? '' : ' ✓');
  L.push(hhmm(M.startTime) + '  Leave ' + M.start.name);
  for (const it of sim.items) {
    if (it.type === 'meal') { L.push(fmtTime(it.start) + '–' + fmtTime(it.end) + '  ' + it.meal.label + ' near ' + it.near.name); continue; }
    const p = it.place;
    if (it.leg.minutes > 0) L.push(legLine(it.leg));
    const tags = [p.priority === 'must' ? 'must-do' : '', p.fixed != null ? 'fixed ' + hhmm(p.fixed) : '', p.check ? 'check: ' + p.check : ''].filter(Boolean);
    L.push(fmtTime(it.start) + '–' + fmtTime(it.end) + '  ' + p.name + (tags.length ? ' [' + tags.join('; ') + ']' : '') + (it.wait > 4 ? ' (wait ' + fmtDur(it.wait) + ')' : ''));
  }
  if (M.end) { if (sim.endLeg.minutes > 0) L.push(legLine(sim.endLeg)); L.push(fmtTime(sim.finish) + '  Back at ' + M.end.name); }
  for (const v of sim.viol) L.push('! ' + violText(M, v, sim));
  const lo = left.filter((l) => l.reason !== 'skipped');
  if (lo.length) L.push('Left out: ' + lo.map((l) => M.places[l.id].name + ' (' + lcFirst(l.text) + ')').join('; '));
  L.push('≈ estimated from distance · ✓ checked');
  return L.join('\n');
}

// Everything the UI needs for one day. opts.deep → accurate left-out analysis (slower).
function plan(trip, day, state, meta, opts) {
  const M = buildModel(trip, day, state);
  const manual = !!M.state.order;
  const main = manual ? null : variant(M, M.pace);
  const route = manual ? sanitizeOrder(M, M.state.order) : main.route;
  const sim = manual ? simulate(M, route, true) : main.sim;
  const left = explainLeftOut(M, route, { manual, deep: !!(opts && opts.deep) });
  const result = buildResult(M, route, sim, left, Object.assign({ manual }, meta));
  return { M, route, sim, left, result, manual };
}

const Core = {
  SCHEMA, PACES, PACE_KEYS, TRANSIT, WALK_SPEED, WALK_LABEL, MODES, MODE_WORD, PRIORITIES, KINDS, DEFAULT_MEALS, VALUE,
  parseTime, hhmm, fmtTime, fmtDur, fmtDateUK, fmtMoney, kmBetween, rideMinutes, walkMinutes,
  normState, stateIsEmpty, buildModel, simulate, scoreOf, optimize, variant, variants, bestInsert, removeKey, sanitizeOrder,
  explainLeftOut, buildResult, leftOutJson, planText, plan, groupOf, isMealKey, nameOf, joinNames, hashStr, busyBudget,
};
root.DayPlannerCore = Core;
if (typeof module !== 'undefined' && module.exports) module.exports = Core;
})(typeof window !== 'undefined' ? window : globalThis);
