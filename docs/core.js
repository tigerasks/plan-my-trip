/* SPDX-License-Identifier: AGPL-3.0-or-later */
/* Day planner v2 — core logic. Pure functions, no DOM: runs in the page and in Node tests.
   The data contract is the "Between chat and planner" section of
   documentation/day-planner-v2-design.md (schema "day-planner/2"). */
(function (root) {
'use strict';

const SCHEMA = 'day-planner/2';
const VERSION = '2.0.0';
const APP = 'day-planner ' + VERSION;

// ---------- vocabulary ----------
const PLAN_KEYS = ['less', 'balanced', 'packed'];
const PLAN_LABEL = { less: 'Do less', balanced: 'Balanced', packed: 'Packed' };
const KINDS = ['sight', 'food', 'shop', 'nature', 'museum', 'culture', 'view', 'experience', 'other'];
const KIND_LABEL = {
  sight: 'Sight', food: 'Food', shop: 'Shopping', nature: 'Nature', museum: 'Museum',
  culture: 'Temple / culture', view: 'Viewpoint', experience: 'Experience', other: 'Place',
};
const PRIORITIES = ['must', 'want', 'maybe'];
const PRIORITY_LABEL = { must: 'Must-do', want: 'Want', maybe: 'Maybe' };
const TRANSIT_TYPES = ['metro', 'city', 'sparse'];
const TRANSIT_LABEL = { metro: 'Dense metro', city: 'City tram & bus', sparse: 'Sparse / rural' };
const ADDED_BY = ['you', 'chat'];
const ADDED_HOW = ['search', 'map', 'pin', 'package'];
const HOURS_SOURCES = ['osm', 'you', 'chat'];
const OSM_TYPES = ['node', 'way', 'relation'];
const WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const WEEK_LABEL = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
  fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
};
const MAX_DURATION = 720;          // 12 hours
const DURATION_STEP = 15;
const DEFAULT_DURATION = 60;
const DEFAULT_LUNCH = { from: '11:30', to: '13:30', duration: 60, on: true };

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
  return str(x).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9._~:@+-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}
const cleanId = (s) => str(s, 80).replace(/[>|\s/]+/g, '-');
function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ---------- time & date ----------
// Times are destination-local "HH:MM" strings everywhere; they turn into minutes only for sums.
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
const normTime = (x) => { const t = parseTime(x); return t == null ? null : hhmm(t); };
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
const dateParts = (iso) => /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(iso));
function normDate(x) {
  const m = dateParts(x);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  // Reject 31 Feb and friends. UTC throughout, so the local time zone never shifts a date.
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return m[0];
}
function fmtDateUK(iso) {
  const m = dateParts(iso);
  if (!m) return str(iso);
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return WD[d.getUTCDay()] + ' ' + (+m[3]) + ' ' + MO[+m[2] - 1];
}
function fmtDateLongUK(iso) {
  const m = dateParts(iso);
  return m ? fmtDateUK(iso) + ' ' + m[1] : str(iso);
}
function weekdayOf(iso) {
  const m = dateParts(iso);
  if (!m) return null;
  return WEEK[(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay() + 6) % 7];
}

// ---------- money ----------
// Prices always show in their own currency; a conversion appears only once the trip names one.
function fmtMoney(price, trip) {
  const p = obj(price);
  if (!price) return '';
  if (p.text) return str(p.text, 80);
  if (!isNum(p.amount)) return '';
  if (p.amount === 0) return 'Free';
  const cur = str(p.currency, 3).toUpperCase();
  let out;
  try {
    out = cur
      ? new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur, currencyDisplay: 'narrowSymbol' }).format(p.amount)
      : String(p.amount);
  } catch (e) { out = (cur ? cur + ' ' : '') + p.amount; }
  const want = str(obj(trip).currency, 3).toUpperCase();
  const rate = want && cur && cur !== want ? toNum(obj(obj(trip).fx)[cur]) : null;
  if (rate) {
    const v = p.amount * rate;
    out += ' (≈ ' + want + ' ' + (v >= 10 ? String(Math.round(v)) : (Math.round(v * 20) / 20).toFixed(2)) + ')';
  }
  return out + (p.per ? ' ' + str(p.per, 20) : '');
}

// ---------- geography ----------
function kmBetween(a, b) {
  const R = 6371.0088, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
const hasPos = (p) => isNum(obj(p).lat) && isNum(obj(p).lng);

// ---------- normalising ----------
// Every load, every import and every save goes through normalise(), so the rest of the app can
// assume: ids are unique, a place belongs to exactly one day or to the backlog, and a plan version
// only ever lists places that are on its own day.
function normSpan(raw) {
  let a = null, b = null;
  if (Array.isArray(raw)) { a = raw[0]; b = raw[1]; }
  else if (raw && typeof raw === 'object') { a = raw.from != null ? raw.from : raw.start; b = raw.to != null ? raw.to : raw.end; }
  else if (typeof raw === 'string') { const m = raw.split(/\s*[-–—]\s*/); a = m[0]; b = m[1]; }
  const from = normTime(a), to = normTime(b);
  if (from == null && to == null) return null;
  return { from, to };
}
function normPair(raw) {
  const s = normSpan(raw);
  return s && s.from != null && s.to != null ? [s.from, s.to] : null;
}
function normHours(raw, issues, name) {
  if (raw == null || raw === '') return null;
  const h = obj(raw);
  const src = obj(h.week);
  const week = {}, lastEntry = {};
  let known = false;
  for (const d of WEEK) {
    const v = src[d];
    if (v == null) { week[d] = null; continue; }
    if (!Array.isArray(v)) {
      week[d] = null;
      issues.push(name + ': the ' + WEEK_LABEL[d] + ' opening hours could not be read');
      continue;
    }
    const spans = [];
    for (const s of v) {
      const pair = normPair(s);
      if (pair) spans.push(pair);
      else issues.push(name + ': an opening time on ' + WEEK_LABEL[d] + ' could not be read');
    }
    spans.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
    week[d] = spans;                       // an empty list means closed that day
    known = true;
    const last = normTime(obj(h.lastEntry)[d]);
    if (last && spans.length) lastEntry[d] = last;
  }
  const rawText = str(h.raw, 200);
  if (!known && !rawText) return null;
  return {
    source: HOURS_SOURCES.includes(h.source) ? h.source : 'you',
    verified: h.verified === true,
    raw: rawText,
    week, lastEntry,
  };
}
function normPrice(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'string') return { text: str(raw, 80) };
  if (isNum(raw)) return { amount: raw, currency: null, per: null };
  const p = obj(raw);
  const amount = toNum(p.amount);
  if (amount == null) return p.text ? { text: str(p.text, 80) } : null;
  return { amount, currency: str(p.currency, 3).toUpperCase() || null, per: str(p.per, 20) || null };
}
function normLinks(raw) {
  const out = [];
  for (const l of arr(raw)) {
    const url = str(typeof l === 'string' ? l : obj(l).url, 500);
    if (!/^https?:\/\//i.test(url)) continue;
    let label = str(obj(l).label, 60);
    if (!label) { try { label = new URL(url).hostname.replace(/^www\./, ''); } catch (e) { label = 'Link'; } }
    out.push({ url, label });
    if (out.length >= 8) break;
  }
  return out;
}
function normOsm(raw) {
  const o = obj(raw);
  const type = OSM_TYPES.includes(o.type) ? o.type : null;
  const id = toNum(o.id);
  return type && id != null && id > 0 ? { type, id: Math.round(id) } : null;
}
function normAdded(raw, now) {
  const a = obj(raw);
  return {
    by: ADDED_BY.includes(a.by) ? a.by : 'you',
    how: ADDED_HOW.includes(a.how) ? a.how : 'search',
    at: str(a.at, 32) || now,
  };
}
function normPoint(raw, fallbackName) {
  if (raw === null) return null;
  const p = obj(raw);
  const lat = toNum(p.lat), lng = toNum(p.lng != null ? p.lng : p.lon);
  const ok = lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  return {
    name: str(p.name, 80) || fallbackName || '',
    lat: ok ? lat : null,
    lng: ok ? lng : null,
    time: normTime(p.time),
  };
}
function normPlace(raw, issues, now) {
  const r = obj(raw);
  const p = {};
  p.id = cleanId(r.id) || slug(r.name) || 'place';
  p.name = str(r.name, 120) || p.id;
  p.localName = str(r.localName, 120);
  const lat = toNum(r.lat), lng = toNum(r.lng != null ? r.lng : r.lon);
  const ok = lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  if (!ok && (r.lat != null || r.lng != null)) issues.push(p.name + ': its position could not be read, so it stays off the map');
  p.lat = ok ? lat : null;
  p.lng = ok ? lng : null;
  p.kind = KINDS.includes(r.kind) ? r.kind : 'other';
  p.area = str(r.area, 60);
  const d = toNum(r.duration);
  p.duration = d == null ? DEFAULT_DURATION : clamp(Math.round(d / DURATION_STEP) * DURATION_STEP, 0, MAX_DURATION);
  p.fixed = normTime(r.fixed);
  p.window = normSpan(r.window);
  p.hours = normHours(r.hours, issues, p.name);
  p.closed = arr(r.closed).map(normDate).filter(Boolean).slice(0, 60);
  p.meal = r.meal === true;
  p.booked = r.booked === true;
  p.priority = PRIORITIES.includes(r.priority) ? r.priority : null;
  p.price = normPrice(r.price);
  p.check = str(r.check, 300);
  p.note = str(r.note, 2000);
  p.links = normLinks(r.links);
  p.osm = normOsm(r.osm);
  p.added = normAdded(r.added, now);
  p.dayId = normDate(r.dayId);
  return p;
}
function normDay(raw, issues, now) {
  const r = obj(raw);
  const d = {};
  d.date = normDate(r.date) || normDate(r.id);
  d.id = d.date;
  if (d.date && str(r.date) && !normDate(r.date)) {
    issues.push(fmtDateUK(d.date) + ': its date read "' + str(r.date, 20) + '", which is not a date, so its id was used instead');
  }
  d.city = str(r.city, 60);
  d.start = normPoint(r.start, 'Start') || { name: 'Start', lat: null, lng: null, time: null };
  if (!d.start.time) d.start.time = '08:30';
  d.end = r.end === null ? null : (normPoint(r.end, '') || { name: '', lat: null, lng: null, time: null });
  if (d.end && !d.end.time) d.end.time = '21:00';
  const l = obj(r.lunch);
  d.lunch = {
    from: normTime(l.from) || DEFAULT_LUNCH.from,
    to: normTime(l.to) || DEFAULT_LUNCH.to,
    duration: clamp(Math.round((toNum(l.duration) == null ? DEFAULT_LUNCH.duration : toNum(l.duration)) / DURATION_STEP) * DURATION_STEP, 0, 240),
    on: l.on !== false,
  };
  d.plans = {};
  for (const k of PLAN_KEYS) d.plans[k] = arr(obj(r.plans)[k]).map(cleanId).filter(Boolean);
  d.shown = PLAN_KEYS.includes(r.shown) ? r.shown : 'balanced';
  const c = obj(r.centre);
  d.centre = toNum(c.lat) != null && toNum(c.lng) != null
    ? { lat: toNum(c.lat), lng: toNum(c.lng), zoom: clamp(toNum(c.zoom) == null ? 13 : toNum(c.zoom), 1, 20) }
    : null;
  d.note = str(r.note, 2000);
  d.legs = obj(r.legs);
  return d;
}
function normTrip(raw, now) {
  const r = obj(raw);
  const issues = [];
  now = now || new Date().toISOString();
  const t = {};
  t.title = str(r.title, 80) || 'Untitled trip';
  t.id = cleanId(r.id) || slug(t.title) || 'trip';
  t.tzLabel = str(r.tzLabel, 12);
  t.transit = TRANSIT_TYPES.includes(r.transit) ? r.transit : 'city';
  t.currency = str(r.currency, 3).toUpperCase().replace(/[^A-Z]/g, '') || null;
  const fx = {};
  for (const [k, v] of Object.entries(obj(r.fx))) {
    const rate = toNum(v), code = str(k, 3).toUpperCase();
    if (rate != null && rate > 0 && /^[A-Z]{3}$/.test(code)) fx[code] = rate;
  }
  t.fx = Object.keys(fx).length ? fx : null;
  t.fxAt = str(r.fxAt, 24) || null;
  t.lookups = [];
  for (const l of arr(r.lookups)) {
    const url = str(obj(l).url, 300);
    if (!/^https?:\/\//i.test(url)) continue;
    t.lookups.push({ label: str(obj(l).label, 40) || 'Look up', url });
    if (t.lookups.length >= 6) break;
  }

  // days, keyed by their date
  t.days = {};
  const dayEntries = Array.isArray(r.days) ? r.days : Object.values(obj(r.days));
  for (const rawDay of dayEntries) {
    const d = normDay(rawDay, issues, now);
    if (!d.date) {
      issues.push('A day was left out: "' + (str(obj(rawDay).date, 20) || str(obj(rawDay).id, 20) || 'no date at all') + '" is not a date');
      continue;
    }
    if (t.days[d.id]) { issues.push(fmtDateUK(d.id) + ' appeared twice; the second one was left out'); continue; }
    t.days[d.id] = d;
  }

  // places, keyed by a unique id
  t.places = {};
  const placeEntries = Array.isArray(r.places) ? r.places : Object.values(obj(r.places));
  for (const rawPlace of placeEntries) {
    const p = normPlace(rawPlace, issues, now);
    if (t.places[p.id]) {
      let k = 2;
      while (t.places[p.id + '-' + k]) k++;
      issues.push(p.name + ': another place already had the id "' + p.id + '", so this one became "' + p.id + '-' + k + '"');
      p.id = p.id + '-' + k;
    }
    if (p.dayId && !t.days[p.dayId]) {
      issues.push(p.name + ': it pointed at a day that is not in this trip, so it went to the backlog');
      p.dayId = null;
    }
    t.places[p.id] = p;
  }

  // plan versions hold order only: every id must be a place of that same day, listed once
  for (const d of Object.values(t.days)) {
    for (const k of PLAN_KEYS) {
      const seen = new Set();
      d.plans[k] = d.plans[k].filter((id) => {
        const p = t.places[id];
        if (!p || p.dayId !== d.id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
    }
  }

  // the backlog holds exactly the places with no day, in the order it gives
  const backlog = [], inBacklog = new Set();
  for (const id of arr(r.backlog).map(cleanId)) {
    const p = t.places[id];
    if (p && !p.dayId && !inBacklog.has(id)) { backlog.push(id); inBacklog.add(id); }
  }
  for (const p of Object.values(t.places)) if (!p.dayId && !inBacklog.has(p.id)) backlog.push(p.id);
  t.backlog = backlog;

  t.createdAt = str(r.createdAt, 32) || now;
  t.updatedAt = str(r.updatedAt, 32) || now;
  return { trip: t, issues };
}
const normalise = normTrip;

function newTrip(title, now) {
  now = now || new Date().toISOString();
  return normTrip({ title: str(title, 80) || 'My trip', createdAt: now, updatedAt: now }, now).trip;
}
function newDay(date, city) {
  return normDay({ date, city }, [], new Date().toISOString());
}

// ---------- reading the model ----------
const dayIds = (trip) => Object.keys(obj(obj(trip).days)).sort();
const dayList = (trip) => dayIds(trip).map((id) => trip.days[id]);
const placeById = (trip, id) => obj(obj(trip).places)[id] || null;
const byAdded = (a, b) => (a.added.at < b.added.at ? -1 : a.added.at > b.added.at ? 1 : a.name.localeCompare(b.name));
function dayPlaces(trip, dayId) {
  return Object.values(obj(obj(trip).places)).filter((p) => p.dayId === dayId).sort(byAdded);
}
function planPlaces(trip, dayId, key) {
  const d = obj(obj(trip).days)[dayId];
  if (!d) return [];
  return d.plans[key].map((id) => trip.places[id]).filter(Boolean);
}
function ideasFor(trip, dayId, key) {
  const d = obj(obj(trip).days)[dayId];
  if (!d) return [];
  const inPlan = new Set(d.plans[key]);
  return dayPlaces(trip, dayId).filter((p) => !inPlan.has(p.id));
}
const backlogPlaces = (trip) => arr(obj(trip).backlog).map((id) => trip.places[id]).filter(Boolean);
function plansHolding(trip, placeId) {
  const p = placeById(trip, placeId);
  if (!p || !p.dayId) return [];
  const d = trip.days[p.dayId];
  return PLAN_KEYS.filter((k) => d.plans[k].includes(placeId));
}

// ---------- changing the model ----------
// Every move goes through these, so the invariants normalise() guarantees keep holding as you work.
const clone = (x) => JSON.parse(JSON.stringify(x));
const touch = (trip, now) => { trip.updatedAt = now || new Date().toISOString(); return trip; };
const nameOf = (trip, id) => (placeById(trip, id) || {}).name || id;
function joinList(list) {
  return list.length <= 1 ? list.join('') : list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
}
const planWords = (keys) => joinList(keys.map((k) => PLAN_LABEL[k]));

function freeId(trip, wanted, fallback) {
  const base = cleanId(wanted) || slug(fallback) || 'place';
  if (!trip.places[base]) return base;
  let k = 2;
  while (trip.places[base + '-' + k]) k++;
  return base + '-' + k;
}
function takeOutOfPlans(trip, id, dayId) {
  const d = trip.days[dayId];
  if (!d) return [];
  const left = [];
  for (const k of PLAN_KEYS) {
    const i = d.plans[k].indexOf(id);
    if (i >= 0) { d.plans[k].splice(i, 1); left.push(k); }
  }
  return left;
}
const takeOutOfBacklog = (trip, id) => { const i = trip.backlog.indexOf(id); if (i >= 0) trip.backlog.splice(i, 1); };

// Put a new place into the trip. `dayId` null means the backlog.
function addPlace(trip, raw, dayId, now) {
  const issues = [];
  const p = normPlace(raw, issues, now || new Date().toISOString());
  p.id = freeId(trip, p.id, p.name);
  p.dayId = dayId && trip.days[dayId] ? dayId : null;
  trip.places[p.id] = p;
  if (!p.dayId) trip.backlog.push(p.id);
  touch(trip, now);
  return { ok: true, id: p.id, place: p, issues, text: p.name + (p.dayId ? ' added to ' + fmtDateUK(p.dayId) : ' added to the backlog') };
}
function moveToDay(trip, id, dayId, now) {
  const p = placeById(trip, id);
  if (!p || !trip.days[dayId]) return { ok: false, text: 'That place or day is no longer here' };
  if (p.dayId === dayId) return { ok: false, text: p.name + ' is already on ' + fmtDateUK(dayId) };
  const left = p.dayId ? takeOutOfPlans(trip, id, p.dayId) : (takeOutOfBacklog(trip, id), []);
  p.dayId = dayId;
  touch(trip, now);
  return { ok: true, left, text: p.name + ' moved to ' + fmtDateUK(dayId) + (left.length ? ', and out of ' + planWords(left) : '') };
}
function moveToBacklog(trip, id, now) {
  const p = placeById(trip, id);
  if (!p) return { ok: false, text: 'That place is no longer here' };
  if (!p.dayId) return { ok: false, text: p.name + ' is already in the backlog' };
  const left = takeOutOfPlans(trip, id, p.dayId);
  p.dayId = null;
  trip.backlog.push(id);
  touch(trip, now);
  return { ok: true, left, text: p.name + ' moved to the backlog' + (left.length ? ', and out of ' + planWords(left) : '') };
}
function addToPlan(trip, id, key, index, now) {
  const p = placeById(trip, id);
  if (!p || !p.dayId || !PLAN_KEYS.includes(key)) return { ok: false, text: 'That place is not on a day' };
  const list = trip.days[p.dayId].plans[key];
  if (list.includes(id)) return { ok: false, text: p.name + ' is already in ' + PLAN_LABEL[key] };
  const at = index == null ? list.length : clamp(Math.round(index), 0, list.length);
  list.splice(at, 0, id);
  touch(trip, now);
  return { ok: true, text: p.name + ' added to ' + PLAN_LABEL[key] };
}
// Remove takes a place out of one version only; it stays on the day and in any other version.
function removeFromPlan(trip, id, key, now) {
  const p = placeById(trip, id);
  if (!p || !p.dayId || !PLAN_KEYS.includes(key)) return { ok: false, text: 'That place is not in a plan' };
  const list = trip.days[p.dayId].plans[key];
  const i = list.indexOf(id);
  if (i < 0) return { ok: false, text: p.name + ' is not in ' + PLAN_LABEL[key] };
  list.splice(i, 1);
  touch(trip, now);
  const still = plansHolding(trip, id);
  return { ok: true, still, text: p.name + ' left ' + PLAN_LABEL[key] + (still.length ? ', and is still in ' + planWords(still) : '') };
}
function reorderPlan(trip, dayId, key, from, to, now) {
  const d = trip.days[dayId];
  if (!d || !PLAN_KEYS.includes(key)) return { ok: false, text: 'That version is no longer here' };
  const list = d.plans[key];
  if (from < 0 || from >= list.length) return { ok: false, text: 'Nothing to move' };
  const at = clamp(Math.round(to), 0, list.length - 1);
  list.splice(at, 0, list.splice(from, 1)[0]);
  touch(trip, now);
  return { ok: true, text: 'Order changed' };
}
// Delete drops a place from every version and from its day or the backlog.
function deletePlace(trip, id, now) {
  const p = placeById(trip, id);
  if (!p) return { ok: false, text: 'That place is no longer here' };
  if (p.dayId) takeOutOfPlans(trip, id, p.dayId); else takeOutOfBacklog(trip, id);
  delete trip.places[id];
  touch(trip, now);
  return { ok: true, text: p.name + ' deleted' };
}
function addDay(trip, date, city, now) {
  const iso = normDate(date);
  if (!iso) return { ok: false, text: 'That is not a date the planner can read (it wants 2026-11-21)' };
  if (trip.days[iso]) return { ok: false, text: fmtDateUK(iso) + ' is already a day of this trip' };
  const d = normDay({ date: iso, city }, [], now || new Date().toISOString());
  trip.days[iso] = d;
  touch(trip, now);
  return { ok: true, id: iso, day: d, text: fmtDateUK(iso) + ' added' };
}
// Deleting a day sends its ideas back to the backlog.
function deleteDay(trip, dayId, now) {
  const d = trip.days[dayId];
  if (!d) return { ok: false, text: 'That day is no longer here' };
  const moved = dayPlaces(trip, dayId);
  for (const p of moved) { p.dayId = null; trip.backlog.push(p.id); }
  delete trip.days[dayId];
  touch(trip, now);
  return {
    ok: true, moved: moved.length,
    text: fmtDateUK(dayId) + ' deleted' + (moved.length ? ', and its ' + moved.length + ' place' + (moved.length > 1 ? 's went' : ' went') + ' back to the backlog' : ''),
  };
}
function setDayDate(trip, dayId, date, now) {
  const d = trip.days[dayId];
  if (!d) return { ok: false, text: 'That day is no longer here' };
  const iso = normDate(date);
  if (!iso) return { ok: false, text: 'That is not a date the planner can read (it wants 2026-11-21)' };
  if (iso === dayId) return { ok: false, text: 'That is the date it already has' };
  if (trip.days[iso]) return { ok: false, text: fmtDateUK(iso) + ' is already a day of this trip' };
  delete trip.days[dayId];
  d.id = iso; d.date = iso;
  trip.days[iso] = d;
  for (const p of Object.values(trip.places)) if (p.dayId === dayId) p.dayId = iso;
  touch(trip, now);
  return { ok: true, id: iso, text: fmtDateUK(dayId) + ' is now ' + fmtDateUK(iso) };
}

// ---------- the exchange format ----------
// Two fixed lines around one line of JSON. The lines never vary, so the chat can print them from a
// script and the planner can find a block in whatever text it was pasted into. The .json file holds
// the same envelope without the lines, so it stays valid JSON for the chat to read as a file.
const BEGIN_LINE = '--- BEGIN ' + SCHEMA + ' ---';
const END_LINE = '--- END ' + SCHEMA + ' ---';
const KIND_LABELS = { save: 'a saved trip', package: 'a package from the chat', handback: 'a hand-back for the chat' };
const KINDS_INOUT = Object.keys(KIND_LABELS);

function envelope(trip, kind, now) {
  return {
    schema: SCHEMA,
    kind: KINDS_INOUT.includes(kind) ? kind : 'save',
    tripId: trip.id,
    title: trip.title,
    at: now || new Date().toISOString(),
    app: APP,
    trip: clone(trip),
  };
}
const writeJson = (trip, kind, now) => JSON.stringify(envelope(trip, kind, now), null, 2) + '\n';
const writeBlock = (trip, kind, now) => BEGIN_LINE + '\n' + JSON.stringify(envelope(trip, kind, now)) + '\n' + END_LINE + '\n';
function fileName(trip, when) {
  const d = when || new Date();
  const two = (n) => String(n).padStart(2, '0');
  const stamp = d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + ' ' + two(d.getHours()) + two(d.getMinutes());
  return (slug(trip.id) || 'trip') + ' ' + stamp + '.json';
}
function sizeText(text) {
  const bytes = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(text).length : Buffer.byteLength(text, 'utf8');
  return bytes < 1024 ? bytes + ' bytes' : Math.round(bytes / 1024) + ' KB';
}

const BEGIN_RE = /^\s*-{2,}\s*BEGIN\s+day-planner\/(\d+)\s*-{2,}\s*$/i;
const END_RE = /^\s*-{2,}\s*END\s+day-planner\/(\d+)\s*-{2,}\s*$/i;
const FENCE_RE = /^\s*```/;

// Pull the JSON out of whatever was pasted: a block between the two lines, or a plain .json file.
// Lines are joined without their line breaks, so a block the chat re-wrapped still reads — JSON
// never holds a raw newline inside a string.
function findPayload(text) {
  const lines = String(text == null ? '' : text).split(/\r?\n/);
  let begin = -1, end = -1, version = null;
  for (let i = 0; i < lines.length; i++) {
    const m = BEGIN_RE.exec(lines[i]);
    if (m) { begin = i; version = m[1]; break; }
  }
  if (begin >= 0) {
    for (let i = begin + 1; i < lines.length; i++) if (END_RE.test(lines[i])) { end = i; break; }
    if (end < 0) return { form: 'block', version, cut: true };
    const body = lines.slice(begin + 1, end).filter((l) => !FENCE_RE.test(l)).join('');
    return { form: 'block', version, body };
  }
  const bare = lines.filter((l) => !FENCE_RE.test(l)).join('\n').trim();
  return { form: 'bare', body: bare };
}

// Read a pasted block or the contents of a saved file. Always returns an object; check `ok`.
function readBlock(text, now) {
  const found = findPayload(text);
  if (found.cut || !found.body) return fail('unreadable', found, null);
  let env;
  try { env = JSON.parse(found.body); } catch (e) { return fail('unreadable', found, null); }
  if (!env || typeof env !== 'object' || Array.isArray(env)) return fail('unreadable', found, null);
  if (str(env.schema) !== SCHEMA) return fail('unreadable', found, env);
  if (!KINDS_INOUT.includes(str(env.kind))) return fail('unreadable', found, env);
  const { trip, issues } = normTrip(env.trip, now);
  return {
    ok: true,
    kind: str(env.kind),
    tripId: cleanId(env.tripId) || trip.id,
    title: str(env.title, 80) || trip.title,
    at: str(env.at, 32),
    app: str(env.app, 40),
    trip, issues,
    summary: summarise(trip),
  };
}
function fail(problem, found, env) {
  return { ok: false, problem, message: 'I could not read a day-planner block in that text.', env: env || null, found };
}
// "6 days and 43 places" — for confirmations and for the import report.
function summarise(trip) {
  const days = dayIds(trip).length;
  const places = Object.keys(obj(trip.places)).length;
  const s = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  return joinList([s(days, 'day', 'days'), s(places, 'place', 'places')]);
}

const Core = {
  SCHEMA, VERSION, APP,
  PLAN_KEYS, PLAN_LABEL, KINDS, KIND_LABEL, PRIORITIES, PRIORITY_LABEL,
  TRANSIT_TYPES, TRANSIT_LABEL, ADDED_BY, ADDED_HOW, HOURS_SOURCES, OSM_TYPES,
  WEEK, WEEK_LABEL, MAX_DURATION, DURATION_STEP, DEFAULT_DURATION, DEFAULT_LUNCH,
  isNum, toNum, str, obj, arr, clamp, slug, cleanId, hashStr,
  parseTime, hhmm, normTime, fmtTime, fmtDur, normDate, fmtDateUK, fmtDateLongUK, weekdayOf,
  fmtMoney, kmBetween, hasPos,
  normSpan, normHours, normPrice, normLinks, normOsm, normPoint, normPlace, normDay, normTrip, normalise,
  newTrip, newDay,
  dayIds, dayList, placeById, dayPlaces, planPlaces, ideasFor, backlogPlaces, plansHolding,
  clone, touch, nameOf, joinList, freeId, addPlace, moveToDay, moveToBacklog, addToPlan, removeFromPlan,
  reorderPlan, deletePlace, addDay, deleteDay, setDayDate,
  BEGIN_LINE, END_LINE, KIND_LABELS, KINDS_INOUT, envelope, writeJson, writeBlock, fileName, sizeText,
  findPayload, readBlock, summarise,
};
root.DayPlannerCore = Core;
if (typeof module !== 'undefined' && module.exports) module.exports = Core;
})(typeof window !== 'undefined' ? window : globalThis);
