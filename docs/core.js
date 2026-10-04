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
// The planner's own walking estimate, carried over from v1: straight-line distance with a detour
// allowance, at a normal pace. Marked ≈ wherever it shows, and replaced by a real route later.
const WALK_SPEED = 4.6;          // km/h
const WALK_DETOUR = 1.3;
const walkMinutes = (km) => (km * WALK_DETOUR / WALK_SPEED) * 60;

// How far a place is from the day on screen: the nearest thing already in it, and the walk to it.
// "≈ 5 min walk from Example Temple (stop 3)" is the point of the preview saying it.
function nearestInDay(trip, dayId, place, planKey) {
  if (!hasPos(place)) return null;
  const d = obj(obj(trip).days)[dayId];
  if (!d) return null;
  const key = PLAN_KEYS.includes(planKey) ? planKey : d.shown;
  const marks = [];
  if (hasPos(d.start)) marks.push({ name: d.start.name || 'where the day starts', where: 'the start' });
  d.plans[key].forEach((id, i) => {
    const p = trip.places[id];
    if (hasPos(p)) marks.push({ name: p.name, where: 'stop ' + (i + 1), lat: p.lat, lng: p.lng });
  });
  if (hasPos(d.start)) { marks[0].lat = d.start.lat; marks[0].lng = d.start.lng; }
  if (d.end && hasPos(d.end)) marks.push({ name: d.end.name || d.start.name || 'where the day ends', where: 'the end', lat: d.end.lat, lng: d.end.lng });
  let best = null;
  for (const m of marks) {
    const km = kmBetween(m, place);
    if (!best || km < best.km) best = { km, name: m.name, where: m.where };
  }
  if (!best) return null;
  best.minutes = Math.max(1, Math.round(walkMinutes(best.km)));
  return best;
}
// "≈ 5 min walk from Example Temple (stop 3)", or a plain distance when it is too far to walk.
function nearText(near) {
  if (!near) return '';
  const from = near.name + (near.where.indexOf('stop') === 0 ? ' (' + near.where + ')' : '');
  return near.minutes <= 45
    ? '≈ ' + fmtDur(near.minutes) + ' walk from ' + from
    : '≈ ' + (near.km < 10 ? near.km.toFixed(1) : String(Math.round(near.km))) + ' km from ' + from;
}

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
  d.start = normPoint(r.start, '') || { name: '', lat: null, lng: null, time: null };
  if (!d.start.time) d.start.time = '08:30';
  d.end = r.end === null ? null : (normPoint(r.end, '') || { name: '', lat: null, lng: null, time: null });
  if (d.end && !d.end.time) d.end.time = '21:00';
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
// ---------- where you sleep ----------
// A stay is one booking: a place, a first night and a number of nights. The days it covers take
// their start and end from it, so a hotel is entered once rather than on every day of the week.
// Three nights from the 21st means the nights of the 21st, 22nd and 23rd: it is where those days
// end, and where the 22nd, 23rd and 24th start.
function shiftDate(iso, days) {
  const d = new Date(normDate(iso) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function normStay(raw) {
  const r = obj(raw);
  const s = {};
  s.id = cleanId(r.id) || slug(r.name) || 'stay';
  s.name = str(r.name, 120) || s.id;
  s.localName = str(r.localName, 120);
  const lat = toNum(r.lat), lng = toNum(r.lng != null ? r.lng : r.lon);
  const ok = lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  s.lat = ok ? lat : null;
  s.lng = ok ? lng : null;
  s.area = str(r.area, 80);
  s.from = normDate(r.from);
  s.nights = clamp(Math.round(toNum(r.nights) || 1), 1, 60);
  s.note = str(r.note, 500);
  s.osm = normOsm(r.osm);
  return s;
}
const stayNights = (s) => ({ first: s.from, last: shiftDate(s.from, s.nights - 1) });
const stayMornings = (s) => ({ first: shiftDate(s.from, 1), last: shiftDate(s.from, s.nights) });
// The days a stay touches at all, which is what gets created with it.
const stayDays = (s) => ({ first: s.from, last: shiftDate(s.from, s.nights) });

// Which stay a day starts or ends at. Where two overlap, the later check-in wins.
function stayFor(trip, dayId, which) {
  const date = normDate(dayId);
  if (!date) return null;
  let best = null;
  for (const s of arr(obj(trip).stays)) {
    if (!s.from) continue;
    const span = which === 'start' ? stayMornings(s) : stayNights(s);
    if (date >= span.first && date <= span.last && (!best || s.from > best.from)) best = s;
  }
  return best;
}
// Where a day begins and ends: the stay if one covers it, otherwise whatever the day itself holds.
function dayStart(trip, dayId) {
  const d = obj(obj(trip).days)[dayId];
  if (!d) return null;
  const s = stayFor(trip, dayId, 'start');
  if (s) return { name: s.name, localName: s.localName, lat: s.lat, lng: s.lng, time: d.start.time, stayId: s.id };
  return { name: d.start.name, localName: '', lat: d.start.lat, lng: d.start.lng, time: d.start.time, stayId: null };
}
function dayEnd(trip, dayId) {
  const d = obj(obj(trip).days)[dayId];
  if (!d || !d.end) return null;
  const s = stayFor(trip, dayId, 'end');
  if (s) return { name: s.name, localName: s.localName, lat: s.lat, lng: s.lng, time: d.end.time, stayId: s.id };
  const start = dayStart(trip, dayId);
  const own = str(d.end.name);
  if (own) return { name: own, localName: '', lat: d.end.lat, lng: d.end.lng, time: d.end.time, stayId: null };
  // The morning you check out, "back where you started" would mean the hotel you have just left.
  if (start.stayId) return { name: '', localName: '', lat: null, lng: null, time: d.end.time, stayId: null };
  return { name: start.name, localName: '', lat: start.lat, lng: start.lng, time: d.end.time, stayId: null };
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

  // where you sleep
  t.stays = [];
  const stayIds = new Set();
  for (const rawStay of arr(r.stays)) {
    const st = normStay(rawStay);
    if (!st.from) { issues.push('A stay at "' + st.name + '" had no first night, so it was left out'); continue; }
    if (stayIds.has(st.id)) {
      let k = 2;
      while (stayIds.has(st.id + '-' + k)) k++;
      st.id = st.id + '-' + k;
    }
    stayIds.add(st.id);
    t.stays.push(st);
    if (t.stays.length >= 60) break;
  }
  t.stays.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));

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

  // Plan versions hold order only: every id must be a place of that same day. A place may appear
  // more than once — you might pass back through a station in the evening.
  for (const d of Object.values(t.days)) {
    for (const k of PLAN_KEYS) {
      d.plans[k] = d.plans[k].filter((id) => { const p = t.places[id]; return p && p.dayId === d.id; });
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

// ---------- OpenStreetMap opening hours ----------
// The opening_hours syntax is far bigger than anything a trip needs, and small places rarely carry
// hours at all (two Kyoto restaurants, two misses in the service test). So this reads the common
// shapes and admits it when it cannot: whatever is left over is kept as text for you to type in.
const WEEK_ABBR = { mo: 'mon', tu: 'tue', we: 'wed', th: 'thu', fr: 'fri', sa: 'sat', su: 'sun' };
const ALL_WEEK = () => { const w = {}; for (const d of WEEK) w[d] = null; return w; };

function osmDays(spec) {
  const out = [];
  for (const part of str(spec).split(',')) {
    const t = part.trim().toLowerCase();
    if (!t) continue;
    const range = /^([a-z]{2})\s*-\s*([a-z]{2})$/.exec(t);
    if (range) {
      const a = WEEK.indexOf(WEEK_ABBR[range[1]]), b = WEEK.indexOf(WEEK_ABBR[range[2]]);
      if (a < 0 || b < 0) return null;
      for (let i = a, guard = 0; guard < 7; i = (i + 1) % 7, guard++) { out.push(WEEK[i]); if (i === b) break; }
      continue;
    }
    if (!WEEK_ABBR[t]) return null;
    out.push(WEEK_ABBR[t]);
  }
  return out.length ? out : null;
}
function osmSpans(spec) {
  const t = str(spec).toLowerCase();
  if (t === 'off' || t === 'closed') return [];
  const out = [];
  for (const part of str(spec).split(',')) {
    const m = /^\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s*$/.exec(part);
    if (!m) return null;
    const from = normTime(m[1]), to = normTime(m[2]);
    if (from == null || to == null) return null;
    out.push([from, to]);
  }
  return out.length ? out : null;
}
// Returns { week, partial } — partial when part of the string went unread — or null when none of it did.
function parseOsmHours(text) {
  const src = str(text, 200);
  if (!src) return null;
  if (/^\s*24\s*\/\s*7\s*$/.test(src)) {
    const week = {};
    for (const d of WEEK) week[d] = [['00:00', '23:59']];   // a minute short of midnight, and never ambiguous
    return { week, partial: false };
  }
  const week = ALL_WEEK();
  let read = 0, partial = false;
  for (const rule of src.split(';')) {
    const r = rule.trim();
    if (!r) continue;
    const m = /^([A-Za-z]{2}(?:\s*[-,]\s*[A-Za-z]{2})*)?\s*(.+)$/.exec(r);
    const days = m && m[1] ? osmDays(m[1]) : WEEK.slice();
    const spans = m ? osmSpans(m[2]) : null;
    if (!days || spans == null) { partial = true; continue; }
    for (const d of days) week[d] = spans;
    read++;
  }
  return read ? { week, partial } : null;
}
// What the planner stores for a place whose hours came from OpenStreetMap, and whether any of the
// string went unread. `partial` is deliberately not part of the stored hours: once you have edited
// them it would be a stale claim, and it can always be worked out again from `raw`.
function hoursFromOsm(text) {
  const raw = str(text, 200);
  if (!raw) return null;
  const parsed = parseOsmHours(raw);
  return {
    hours: { source: 'osm', verified: false, raw, week: parsed ? parsed.week : ALL_WEEK(), lastEntry: {} },
    partial: !parsed || parsed.partial,
  };
}

// Opening hours in a line: consecutive days that agree are grouped, unknown days left out.
const WEEK_SHORT = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
const spansText = (spans) => (spans.length ? spans.map(([a, b]) => a + '–' + b).join(', ') : 'closed');
function hoursText(hours) {
  const h = obj(hours);
  const week = obj(h.week);
  const known = WEEK.filter((d) => Array.isArray(week[d]));
  if (!known.length) return '';
  const same = known.every((d) => JSON.stringify(week[d]) === JSON.stringify(week[known[0]]));
  if (same && known.length === 7) return spansText(week.mon);
  const out = [];
  let run = null;
  for (const d of WEEK) {
    const spans = week[d];
    const text = Array.isArray(spans) ? spansText(spans) : null;
    if (run && text === run.text) { run.to = d; continue; }
    if (run) out.push(run);
    run = text == null ? null : { from: d, to: d, text };
  }
  if (run) out.push(run);
  return out.map((r) => (r.from === r.to ? WEEK_SHORT[r.from] : WEEK_SHORT[r.from] + '–' + WEEK_SHORT[r.to]) + ' ' + r.text).join(' · ');
}

// ---------- reading the map ----------
// A tapped vector-tile feature carries the OpenStreetMap id as id × 10 + the element type.
// Verified live for ways (Sukiya) and nodes (Pizza Little Party); relations never came up, and
// places are rarely relations. See documentation/service-tests.md.
const OSM_BY_DIGIT = { 1: 'node', 2: 'way', 3: 'relation' };
function decodeFeatureId(fid) {
  const text = String(fid == null ? '' : fid);
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  if (!isFinite(n) || n > Number.MAX_SAFE_INTEGER) return null;
  const type = OSM_BY_DIGIT[n % 10];
  const id = Math.floor(n / 10);
  return type && id > 0 ? { type, id } : null;
}

// The map names a place in many languages, and not always under the keys you expect: Tō-ji came
// back with no plain `name` at all. So both names are picked from a chain, and the local one is
// always kept — "East Temple" is not what is written on the gate.
const firstName = (s) => str(s, 120).split(';')[0].trim();
function namesFrom(props) {
  const p = obj(props);
  const pick = (keys) => { for (const k of keys) if (str(p[k])) return firstName(p[k]); return ''; };
  const local = pick(['name', 'name:nonlatin']);
  const english = pick(['name:en', 'name_en', 'name_int', 'name:latin']);
  const name = english || local;
  return { name, localName: local && local !== name ? local : '' };
}

// class and subclass come from OpenMapTiles; subclass is the OpenStreetMap tag value, so it wins.
const KIND_BY_TAG = {
  restaurant: 'food', fast_food: 'food', cafe: 'food', bar: 'food', pub: 'food', biergarten: 'food',
  ice_cream: 'food', bakery: 'food', confectionery: 'food', food_court: 'food', deli: 'food',
  museum: 'museum', art_gallery: 'museum', gallery: 'museum',
  place_of_worship: 'culture', shrine: 'culture', temple: 'culture', church: 'culture',
  monastery: 'culture', castle: 'culture', monument: 'culture', memorial: 'culture',
  ruins: 'culture', archaeological_site: 'culture', historic: 'culture',
  park: 'nature', garden: 'nature', nature_reserve: 'nature', beach: 'nature', forest: 'nature',
  waterfall: 'nature', spring: 'nature', picnic_site: 'nature',
  viewpoint: 'view', tower: 'view',
  theatre: 'experience', cinema: 'experience', onsen: 'experience', spa: 'experience',
  swimming: 'experience', aquarium: 'experience', theme_park: 'experience', zoo: 'experience',
  stadium: 'experience', arts_centre: 'experience',
  shop: 'shop', supermarket: 'shop', department_store: 'shop', mall: 'shop', marketplace: 'shop',
  clothing_store: 'shop', grocery: 'shop', convenience: 'shop', gift: 'shop', books: 'shop',
  attraction: 'sight', lighthouse: 'sight', bridge: 'sight',
};
function kindFrom(props) {
  const p = obj(props);
  return KIND_BY_TAG[str(p.subclass)] || KIND_BY_TAG[str(p.class)] || 'other';
}

// Everything a tapped feature can tell us, before any lookup. `at` is where the finger landed;
// the feature itself carries no position in the tile.
function fromMapFeature(feature, at) {
  const f = obj(feature);
  const names = namesFrom(f.properties);
  if (!names.name) return null;
  const osm = decodeFeatureId(f.id);
  const point = obj(at);
  return {
    name: names.name,
    localName: names.localName,
    kind: kindFrom(f.properties),
    lat: toNum(point.lat),
    lng: toNum(point.lng),
    osm,
    added: { by: 'you', how: 'map', at: null },
  };
}
// The feature under the finger: a named point of interest if there is one.
function bestFeature(features) {
  const named = arr(features).filter((f) => namesFrom(obj(f).properties).name);
  return named.find((f) => obj(f).sourceLayer === 'poi') || named[0] || null;
}

// ---------- asking the outside services ----------
// Photon, komoot's geocoder, built for search-as-you-type and biased towards where the map looks.
// Never Nominatim: its policy forbids search-as-you-type.
const PHOTON = 'https://photon.komoot.io/api/';
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const OSM_PAGE = 'https://www.openstreetmap.org/';
const GMAPS_SEARCH = 'https://www.google.com/maps/search/?api=1&query=';
const OSM_BY_LETTER = { N: 'node', W: 'way', R: 'relation' };
// Photon answers with an OpenStreetMap key and value rather than a map class.
const KIND_BY_KEY = { shop: 'shop', tourism: 'sight', leisure: 'experience', natural: 'nature', historic: 'culture' };

function photonUrl(query, near, limit) {
  const p = new URLSearchParams({ q: str(query, 120), lang: 'en', limit: String(clamp(limit || 8, 1, 20)) });
  const n = obj(near);
  if (isNum(n.lat) && isNum(n.lng)) { p.set('lat', n.lat.toFixed(5)); p.set('lon', n.lng.toFixed(5)); }
  return PHOTON + '?' + p.toString();
}
const kindFromTags = (key, value) => KIND_BY_TAG[str(value)] || KIND_BY_KEY[str(key)] || 'other';
// Where a result is, in the words its own country uses, nearest first.
function whereOf(p) {
  const bits = [p.street, p.district, p.locality, p.city, p.state, p.country].map((x) => str(x, 60));
  const out = [];
  for (const b of bits) if (b && !out.includes(b)) out.push(b);
  return out.slice(0, 3).join(' · ');
}
function parsePhoton(json, now) {
  const out = [];
  for (const f of arr(obj(json).features)) {
    const p = obj(obj(f).properties);
    const c = arr(obj(obj(f).geometry).coordinates);
    const lat = toNum(c[1]), lng = toNum(c[0]);
    const name = firstName(p.name);
    if (!name || lat == null || lng == null) continue;
    const type = OSM_BY_LETTER[str(p.osm_type).toUpperCase()];
    const id = toNum(p.osm_id);
    out.push({
      name, localName: '', lat, lng,
      kind: kindFromTags(p.osm_key, p.osm_value),
      area: str(p.district || p.locality || p.city, 60),
      where: whereOf(p),
      osm: type && id ? { type, id: Math.round(id) } : null,
      added: { by: 'you', how: 'search', at: now || null },
    });
    if (out.length >= 20) break;
  }
  return out;
}

// One lookup per previewed place, straight at its id, so Overpass never has to search.
function overpassUrl(osm) {
  const o = normOsm(osm);
  if (!o) return null;
  // `center` as well as tags: the finger lands near a place, not on it, so this corrects the position.
  return OVERPASS + '?data=' + encodeURIComponent('[out:json][timeout:20];' + o.type + '(' + o.id + ');out tags center;');
}
function parseOverpass(json) {
  const el = arr(obj(json).elements)[0];
  if (!el) return null;
  const c = obj(el.center);
  const lat = toNum(el.lat != null ? el.lat : c.lat);
  const lng = toNum(el.lon != null ? el.lon : c.lon);
  return { tags: obj(el.tags), at: lat != null && lng != null ? { lat, lng } : null };
}

// Your own look-up links, such as Tabelog for restaurants in Japan. {name} and {local} are filled
// in from the place; a link without either just opens.
function lookupUrl(lookup, place) {
  const l = obj(lookup), p = obj(place);
  const local = str(p.localName) || str(p.name);
  return str(l.url, 300)
    .replace(/\{name\}/g, encodeURIComponent(str(p.name)))
    .replace(/\{local\}/g, encodeURIComponent(local));
}
const osmUrl = (osm) => { const o = normOsm(osm); return o ? OSM_PAGE + o.type + '/' + o.id : ''; };
// Google Maps is for reviews, photos and today's hours. It opens beside the planner and nothing
// comes back: no Google result is ever stored or drawn on our map.
function gmapsUrl(place, city) {
  const p = obj(place);
  const words = [str(p.localName) || str(p.name), str(p.area, 60) || str(city, 60)].filter(Boolean);
  return GMAPS_SEARCH + encodeURIComponent(words.join(' '));
}

// What OpenStreetMap knows, in the shape the preview shows it. Coverage varies wildly: a well-known
// sight carries plenty, a small restaurant often just a name.
const DIET = { 'diet:vegetarian': 'vegetarian', 'diet:vegan': 'vegan', 'diet:halal': 'halal', 'diet:kosher': 'kosher' };
function detailsFromTags(tags, osm) {
  const t = obj(tags);
  const val = (...keys) => { for (const k of keys) if (str(t[k])) return str(t[k], 200); return ''; };
  const diet = [];
  for (const [k, word] of Object.entries(DIET)) if (/^(yes|only)$/i.test(str(t[k]))) diet.push(word);
  const website = val('website', 'contact:website', 'url');
  const wiki = str(t.wikipedia, 120);
  const links = [];
  if (/^https?:\/\//i.test(website)) links.push({ url: website, label: 'Its own site' });
  if (/^[a-z-]+:.+/i.test(wiki)) {
    const [lang, title] = wiki.split(/:(.+)/);
    links.push({ url: 'https://' + lang + '.wikipedia.org/wiki/' + encodeURIComponent(title.replace(/ /g, '_')), label: 'Wikipedia' });
  }
  const page = osmUrl(osm);
  if (page) links.push({ url: page, label: 'OpenStreetMap' });
  return {
    hours: hoursFromOsm(t.opening_hours),
    hoursChecked: str(t['check_date:opening_hours'], 20),
    cuisine: val('cuisine').replace(/;/g, ', '),
    phone: val('phone', 'contact:phone'),
    website,
    reservation: val('reservation'),
    takeaway: val('takeaway'),
    wheelchair: val('wheelchair'),
    fee: val('fee'),
    description: val('description'),
    diet,
    links: normLinks(links),
    tagCount: Object.keys(t).length,
  };
}

// ---------- when a place is open ----------
// The stored hours are a week; a day of the trip needs them for one date. Unknown is not the same
// as open: the timeline says so rather than quietly assuming.
function openOn(place, date) {
  const p = obj(place);
  const day = weekdayOf(date);
  if (!day) return { known: false, closed: false, spans: [], last: null };
  if (arr(p.closed).indexOf(date) >= 0) return { known: true, closed: true, spans: [], last: null };
  const h = obj(p.hours);
  const week = obj(h.week)[day];
  if (!p.hours || !Array.isArray(week)) return { known: false, closed: false, spans: [], last: null };
  const spans = [];
  for (const pair of week) {
    const open = parseTime(pair[0]), close = parseTime(pair[1]);
    if (open == null || close == null) continue;
    spans.push([open, close <= open ? close + 1440 : close]);     // a close before the open is past midnight
  }
  spans.sort((a, b) => a[0] - b[0]);
  const last = parseTime(obj(h.lastEntry)[day]);
  return { known: true, closed: spans.length === 0, spans, last: last == null ? null : last, verified: h.verified === true };
}
// When a visit of this length may start: opening hours, last entry and the place's own time window.
function startWindows(place, date) {
  const open = openOn(place, date);
  const duration = toNum(obj(place).duration) || 0;
  if (open.closed) return { open, slots: [] };
  let slots = open.known && open.spans.length
    ? open.spans.map(([a, b]) => [a, Math.min(open.last == null ? Infinity : open.last, b - duration)])
    : [[-Infinity, Infinity]];
  const w = normSpan(obj(place).window);
  if (w) {
    const from = w.from != null ? parseTime(w.from) : -Infinity;
    const to = w.to != null ? parseTime(w.to) : Infinity;
    slots = slots.map(([a, b]) => [Math.max(a, from), Math.min(b, to)]);
  }
  return { open, slots: slots.filter(([a, b]) => b >= a).sort((x, y) => x[0] - y[0]) };
}

// ---------- estimating a leg ----------
// The planner's own numbers, from the straight-line distance: instant, offline and rough, so they
// are always marked ≈. Milestone 4 replaces them with real routes and keeps this as the fallback.
const TRANSIT_MODEL = {
  metro: { overhead: 10, near: 22, far: 50, detour: 1.30 },
  city: { overhead: 12, near: 18, far: 45, detour: 1.35 },
  sparse: { overhead: 20, near: 22, far: 45, detour: 1.35 },
};
const CAR_MODEL = { overhead: 6, near: 20, far: 60, detour: 1.35 };
const MAX_WALK = 20;      // minutes: beyond this, riding wins even if it is no quicker
const WALK_BIAS = 5;      // and below it, walking wins unless riding saves more than this
const MODE_WORD = { walk: 'walk', transit: 'train or bus', car: 'taxi' };
function rideMinutes(km, model) {
  const speed = model.near + (model.far - model.near) * (1 - Math.exp(-km / 8));
  return model.overhead + (km * model.detour / speed) * 60;
}
function estimateLeg(from, to, trip) {
  if (!hasPos(from) || !hasPos(to)) return { mode: 'unknown', minutes: 0, km: null, estimate: true, unknown: true };
  const km = kmBetween(from, to);
  const walk = Math.max(km < 0.02 ? 0 : 1, Math.round(walkMinutes(km)));
  const model = TRANSIT_MODEL[obj(trip).transit] || TRANSIT_MODEL.city;
  const ride = Math.round(rideMinutes(km, model));
  const onFoot = walk <= MAX_WALK && walk <= ride + WALK_BIAS;
  return {
    mode: onFoot ? 'walk' : 'transit',
    minutes: onFoot ? walk : ride,
    km, estimate: true,
    walkMinutes: walk, rideMinutes: ride,
  };
}

// ---------- walking a day ----------
// One version of one day, turned into times: when you arrive, when you can actually start, how long
// you wait, and when you would be back. Carried over from the first planner, with its pace budgets
// and its picking-places-for-you taken out — the three versions are yours.
// Where a day begins and ends comes from the accommodation, so that is where to send someone who
// has not set it — once, however many legs it leaves unknown.
const ADD_A_STAY = ' — add where you are staying, at the top of the day';
function planDay(trip, dayId, key, order) {
  const day = obj(obj(trip).days)[dayId];
  if (!day) return null;
  const shown = PLAN_KEYS.includes(key) ? key : day.shown;
  const date = day.date;
  const start = dayStart(trip, dayId);
  const end = dayEnd(trip, dayId);
  const startTime = parseTime(start.time);
  let endBy = end ? parseTime(end.time) : null;
  if (endBy != null && endBy <= startTime) endBy += 1440;

  const items = [{ type: 'start', name: start.name, at: startTime, place: start }];
  const issues = [], checks = [];
  const flag = (sev, text, id) => issues.push({ severity: sev, text, id: id || null });
  let advised = false;
  const advice = () => (advised ? '' : ((advised = true), ADD_A_STAY));
  const stops = (order ? arr(order).map((id) => placeById(trip, id)).filter((p) => p && p.dayId === dayId)
    : planPlaces(trip, dayId, shown));

  let t = startTime, prev = start, travel = 0, wait = 0, visit = 0;

  for (const p of stops) {
    const leg = estimateLeg(prev, p, trip);
    // An unknown leg has an end without a position. Say which one: blaming the destination for a
    // day that has no starting point sends you looking in the wrong place.
    if (leg.unknown) {
      if (!hasPos(p)) flag('warn', p.name + ' has no position, so the time to get there is unknown', p.id);
      else if (prev === start) flag('warn', 'Where the day starts is not set, so the time to ' + p.name + ' is unknown' + advice(), 'start');
    }
    travel += leg.minutes;
    const arrive = t + leg.minutes;
    const when = startWindows(p, date);
    const fixed = parseTime(p.fixed);
    let at = arrive;
    if (when.open.closed) {
      flag('error', p.name + ' is closed on ' + fmtDateUK(date), p.id);
    } else if (fixed != null) {
      at = Math.max(arrive, fixed);
      if (arrive > fixed) flag('error', p.name + ': you would arrive ' + fmtTime(arrive) + ', after the ' + hhmm(fixed) + ' you have booked', p.id);
    } else if (!when.slots.length) {
      flag('error', p.name + ': no part of its opening hours fits a ' + fmtDur(p.duration) + ' visit', p.id);
    } else {
      const slot = when.slots.find(([, hi]) => arrive <= hi);
      if (slot) at = Math.max(arrive, slot[0]);
      else {
        const latest = when.slots[when.slots.length - 1][1];
        flag('error', p.name + ': you would arrive ' + fmtTime(arrive) + ', after the latest you can start (' + hhmm(latest) + ')', p.id);
      }
    }
    if (!when.open.known) checks.push({ id: p.id, name: p.name, text: 'Hours unknown, so these times assume it is open' });
    else if (!when.open.verified) checks.push({ id: p.id, name: p.name, text: 'Hours not checked yet' });
    if (p.check) checks.push({ id: p.id, name: p.name, text: p.check });

    const waited = at - arrive;
    wait += waited;
    visit += p.duration;
    items.push(Object.assign({ type: 'travel' }, leg));
    items.push({
      type: 'visit', id: p.id, name: p.name, place: p, leg,
      arrive, at, until: at + p.duration, waited,
    });
    t = at + p.duration;
    prev = p;
  }
  let finish = t;
  if (end) {
    const leg = estimateLeg(prev, end, trip);
    if (leg.unknown && !hasPos(end)) flag('warn', 'Where the day ends is not set, so the time back is unknown' + advice(), 'end');
    travel += leg.minutes;
    finish = t + leg.minutes;
    items.push(Object.assign({ type: 'travel' }, leg));
    items.push({ type: 'end', name: end.name, at: finish, place: end });
    if (endBy != null && finish > endBy) {
      flag('error', 'You would be back ' + fmtTime(finish) + ', ' + fmtDur(finish - endBy) + ' after ' + hhmm(endBy), 'end');
    }
  }
  const legs = items.filter((i) => i.type === 'travel');
  return {
    dayId, date, key: shown, items, issues, checks,
    start, end, startTime, endBy, finish,
    summary: {
      stops: stops.length, travel, wait, visit,
      spare: endBy == null ? null : endBy - finish,
      estimated: legs.filter((l) => l.estimate && l.minutes > 0).length,
      errors: issues.filter((i) => i.severity === 'error').length,
    },
  };
}

// What a day's order costs: anything that will not work first, then time on the move, then waiting
// about, then finishing late. Lower is better.
function planCost(P) {
  if (!P) return Infinity;
  const warns = P.issues.length - P.summary.errors;
  return P.summary.errors * 10000 + warns * 200 + P.summary.travel + P.summary.wait * 0.5
    + (P.finish - P.startTime) * 0.01;
}
// Re-sequence a day's stops for less travel and fewer problems, without changing what is in it.
// Relocating one stop at a time and reversing stretches, which is what the first planner did.
function optimiseOrder(trip, dayId, key) {
  const day = obj(obj(trip).days)[dayId];
  if (!day) return { ok: false, text: 'That day is no longer here' };
  const k = PLAN_KEYS.includes(key) ? key : day.shown;
  let best = day.plans[k].slice();
  if (best.length < 3) return { ok: false, text: 'There is nothing to reorder yet' };
  const cost = (order) => planCost(planDay(trip, dayId, k, order));
  const was = { order: best.slice(), cost: cost(best) };
  let bestCost = was.cost;
  for (let pass = 0; pass < 12; pass++) {
    let better = false;
    for (let i = 0; i < best.length; i++) {
      for (let j = 0; j < best.length; j++) {
        if (i === j) continue;
        const next = best.slice();
        next.splice(j, 0, next.splice(i, 1)[0]);
        const c = cost(next);
        if (c < bestCost - 1e-9) { best = next; bestCost = c; better = true; }
      }
    }
    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const next = best.slice(0, i).concat(best.slice(i, j + 1).reverse(), best.slice(j + 1));
        const c = cost(next);
        if (c < bestCost - 1e-9) { best = next; bestCost = c; better = true; }
      }
    }
    if (!better) break;
  }
  if (best.join() === was.order.join()) return { ok: false, was: was.order, text: 'That is already the best order I can find' };
  day.plans[k] = best;
  touch(trip);
  const before = planDay(trip, dayId, k, was.order);
  const now = planDay(trip, dayId, k);
  const bits = [];
  const fewer = before.issues.length - now.issues.length;
  const saved = before.summary.travel - now.summary.travel;
  const waited = before.summary.wait - now.summary.wait;
  const earlier = before.finish - now.finish;
  if (fewer > 0) bits.push(fewer + (fewer === 1 ? ' problem' : ' problems') + ' fewer');
  if (saved > 0) bits.push(fmtDur(saved) + ' less travel');
  if (waited > 0) bits.push(fmtDur(waited) + ' less waiting about');
  if (!bits.length && earlier > 0) bits.push('back ' + fmtDur(earlier) + ' earlier');
  return { ok: true, was: was.order, text: 'Reordered' + (bits.length ? ': ' + joinList(bits) : '') };
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
// Taking a place off a day takes out every copy of it in every version.
function takeOutOfPlans(trip, id, dayId) {
  const d = trip.days[dayId];
  if (!d) return [];
  const left = [];
  for (const k of PLAN_KEYS) {
    const kept = d.plans[k].filter((x) => x !== id);
    if (kept.length !== d.plans[k].length) { d.plans[k] = kept; left.push(k); }
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
// Where a new stop fits best: the position that causes the fewest problems and the least travel,
// judged by running the day at each one.
function bestSlot(trip, dayId, key, placeId) {
  const d = obj(obj(trip).days)[dayId];
  if (!d) return 0;
  const rest = d.plans[key];
  let best = rest.length, bestCost = Infinity;
  for (let i = 0; i <= rest.length; i++) {
    const order = rest.slice(0, i).concat([placeId], rest.slice(i));
    const cost = planCost(planDay(trip, dayId, key, order));
    if (cost < bestCost - 1e-9) { bestCost = cost; best = i; }
  }
  return best;
}
function addToPlan(trip, id, key, index, now) {
  const p = placeById(trip, id);
  if (!p || !p.dayId || !PLAN_KEYS.includes(key)) return { ok: false, text: 'That place is not on a day' };
  const list = trip.days[p.dayId].plans[key];
  const again = list.includes(id);
  const at = index == null ? list.length : clamp(Math.round(index), 0, list.length);
  list.splice(at, 0, id);
  touch(trip, now);
  return {
    ok: true, at,
    text: p.name + (again ? ' added to ' + PLAN_LABEL[key] + ' again, as stop ' + (at + 1)
      : ' added to ' + PLAN_LABEL[key]),
  };
}
// Remove takes one stop out of one version; the place stays on the day, in any other version, and
// at any other point in this one.
function removeStop(trip, dayId, key, at, now) {
  const d = obj(obj(trip).days)[dayId];
  if (!d || !PLAN_KEYS.includes(key)) return { ok: false, text: 'That version is no longer here' };
  const list = d.plans[key];
  const i = Math.round(at);
  if (!(i >= 0 && i < list.length)) return { ok: false, text: 'That stop is no longer there' };
  const id = list[i];
  const p = placeById(trip, id);
  list.splice(i, 1);
  touch(trip, now);
  const again = list.indexOf(id);
  const still = plansHolding(trip, id).filter((k) => k !== key);
  const name = p ? p.name : id;
  const rest = [];
  if (again >= 0) rest.push('still stop ' + (again + 1) + ' here');
  if (still.length) rest.push('still in ' + planWords(still));
  return { ok: true, id, still, text: name + ' left ' + PLAN_LABEL[key] + (rest.length ? ', and is ' + joinList(rest) : '') };
}
// Put a place at a position in a version. `from` is the stop being moved, or null to add one more.
// One operation for dragging a stop up its own list and for dragging one in from somewhere else.
function placeInPlan(trip, id, key, index, from, now) {
  const p = placeById(trip, id);
  if (!p || !p.dayId || !PLAN_KEYS.includes(key)) return { ok: false, text: 'That place is not on a day' };
  const list = trip.days[p.dayId].plans[key];
  const at = from == null ? -1 : Math.round(from);
  if (at >= 0 && at < list.length && list[at] === id) list.splice(at, 1);
  const to = clamp(Math.round(index == null ? list.length : index), 0, list.length);
  list.splice(to, 0, id);
  touch(trip, now);
  return {
    ok: true, index: to, moved: at >= 0,
    text: p.name + (at >= 0 ? ' moved to stop ' + (to + 1) : ' added to ' + PLAN_LABEL[key] + ' as stop ' + (to + 1)),
  };
}
// The backlog keeps the order you put it in, so it can be dragged about too.
function moveInBacklog(trip, id, index, now) {
  const p = placeById(trip, id);
  if (!p) return { ok: false, text: 'That place is no longer here' };
  if (p.dayId) {
    takeOutOfPlans(trip, id, p.dayId);
    p.dayId = null;
  } else {
    takeOutOfBacklog(trip, id);
  }
  const to = clamp(Math.round(index == null ? trip.backlog.length : index), 0, trip.backlog.length);
  trip.backlog.splice(to, 0, id);
  touch(trip, now);
  return { ok: true, index: to, text: p.name + ' moved to the backlog' };
}
// Copy what is on screen into another version, as a starting point there.
function copyVersion(trip, dayId, from, to, now) {
  const day = obj(obj(trip).days)[dayId];
  if (!day || !PLAN_KEYS.includes(from) || !PLAN_KEYS.includes(to) || from === to) {
    return { ok: false, text: 'There is nothing to copy there' };
  }
  const was = day.plans[to].slice();
  day.plans[to] = day.plans[from].slice();
  touch(trip, now);
  const n = day.plans[to].length;
  return {
    ok: true, was,
    text: PLAN_LABEL[from] + ' copied to ' + PLAN_LABEL[to]
      + (was.length ? ', replacing what was there' : '') + ' — ' + n + (n === 1 ? ' stop' : ' stops'),
  };
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
// A run of days at once, which is how a trip is usually planned. Dates the trip already has are
// left exactly as they are.
function addDays(trip, date, count, city, now) {
  const first = normDate(date);
  if (!first) return { ok: false, text: 'That is not a date the planner can read (it wants 2026-11-21)', added: [] };
  const n = clamp(Math.round(toNum(count) || 1), 1, 60);
  const added = [], kept = [];
  const at = new Date(first + 'T00:00:00Z');
  for (let i = 0; i < n; i++) {
    const iso = at.toISOString().slice(0, 10);
    at.setUTCDate(at.getUTCDate() + 1);
    if (trip.days[iso]) { kept.push(iso); continue; }
    trip.days[iso] = normDay({ date: iso, city }, [], now || new Date().toISOString());
    added.push(iso);
  }
  touch(trip, now);
  const already = (list) => list.length === 1
    ? '1 day was already there, left as it was'
    : list.length + ' days were already there, left as they were';
  return {
    ok: added.length > 0, added, kept, id: added[0] || kept[0],
    text: added.length
      ? (added.length === 1 ? fmtDateUK(added[0]) + ' added' : added.length + ' days added, ' + fmtDateUK(added[0]) + ' to ' + fmtDateUK(added[added.length - 1]))
        + (kept.length ? ' · ' + already(kept) : '')
      : 'The trip already has ' + (kept.length === 1 ? fmtDateUK(kept[0]) : 'all ' + kept.length + ' of those days'),
  };
}

// Putting a stay in also puts in the days it covers: the nights plus the morning you check out.
// Days the trip already has are left exactly as they are, places and all.
function fillStayDays(trip, stay, now) {
  const span = stayDays(stay);
  return addDays(trip, span.first, stay.nights + 1, nearestCity(trip, span.first), now);
}
// New days take the city of whichever day of the trip sits closest to them.
function nearestCity(trip, date) {
  const day = new Date(date + 'T00:00:00Z').getTime();
  let best = null, gap = Infinity;
  for (const id of dayIds(trip)) {
    const city = str(trip.days[id].city);
    if (!city) continue;
    const away = Math.abs(new Date(id + 'T00:00:00Z').getTime() - day);
    if (away < gap) { gap = away; best = city; }
  }
  return best || '';
}
function addStay(trip, raw, now) {
  const stay = normStay(raw);
  if (!stay.from) return { ok: false, text: 'A stay needs the date of its first night', added: [] };
  if (!str(raw && raw.name)) return { ok: false, text: 'Give the place you are staying a name first', added: [] };
  let id = stay.id, k = 2;
  while (trip.stays.some((s) => s.id === id)) { id = stay.id + '-' + k; k++; }
  stay.id = id;
  trip.stays.push(stay);
  trip.stays.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  const days = fillStayDays(trip, stay, now);
  touch(trip, now);
  return {
    ok: true, id: stay.id, stay, added: days.added,
    text: stay.name + ', ' + stay.nights + (stay.nights === 1 ? ' night' : ' nights') + ' from ' + fmtDateUK(stay.from)
      + (days.added.length ? ' · ' + days.added.length + (days.added.length === 1 ? ' day' : ' days') + ' added' : ''),
  };
}
const stayById = (trip, id) => arr(obj(trip).stays).find((s) => s.id === id) || null;
function updateStay(trip, id, patch, now) {
  const stay = stayById(trip, id);
  if (!stay) return { ok: false, text: 'That stay is no longer here', added: [] };
  const next = normStay(Object.assign({}, stay, obj(patch), { id: stay.id }));
  if (!next.from) return { ok: false, text: 'A stay needs the date of its first night', added: [] };
  Object.assign(stay, next);
  trip.stays.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  const days = fillStayDays(trip, stay, now);
  touch(trip, now);
  return {
    ok: true, id: stay.id, stay, added: days.added,
    text: stay.name + ' saved' + (days.added.length ? ' · ' + days.added.length + (days.added.length === 1 ? ' day' : ' days') + ' added' : ''),
  };
}
// Removing a stay leaves the days alone: they may well have places on them by now.
function deleteStay(trip, id, now) {
  const at = arr(obj(trip).stays).findIndex((s) => s.id === id);
  if (at < 0) return { ok: false, text: 'That stay is no longer here' };
  const [gone] = trip.stays.splice(at, 1);
  touch(trip, now);
  return { ok: true, stay: gone, text: gone.name + ' removed. Its days are still in the trip.' };
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
// When it can't, `message` says why in the words someone pasting from a chat would use.
function readBlock(text, now) {
  const found = findPayload(text);
  if (found.version && found.version !== '2') return fail(found.version === '1' ? 'old-version' : 'newer-version', found);
  if (found.cut) return fail('cut-off', found);
  if (!found.body) return fail('no-block', found);
  let env;
  try {
    env = JSON.parse(found.body);
  } catch (e) {
    return fail(found.form === 'block' ? 'damaged' : 'no-block', found, null, e);
  }
  if (!env || typeof env !== 'object' || Array.isArray(env)) return fail('not-ours', found);
  const schema = str(env.schema);
  if (schema !== SCHEMA) {
    const m = /^day-planner\/(\d+)$/.exec(schema);
    if (!m) return fail('not-ours', found, env);
    return fail(m[1] === '1' ? 'old-version' : 'newer-version', found, env);
  }
  const kind = str(env.kind);
  if (kind === 'handback') return fail('handback', found, env);
  if (!KINDS_INOUT.includes(kind)) return fail('unknown-kind', found, env);
  if (!env.trip || typeof env.trip !== 'object' || Array.isArray(env.trip)) return fail('no-trip', found, env);
  const { trip, issues } = normTrip(env.trip, now);
  return {
    ok: true,
    kind,
    tripId: cleanId(env.tripId) || trip.id,
    title: str(env.title, 80) || trip.title,
    at: str(env.at, 32),
    app: str(env.app, 40),
    trip, issues,
    summary: summarise(trip),
  };
}
function fail(problem, found, env, err) {
  const size = found && found.body ? found.body.length : 0;
  const spot = err && /position (\d+)/.exec(String(err.message || ''));
  const at = spot ? Math.min(+spot[1], size) : null;
  let message;
  switch (problem) {
    case 'no-block':
      message = size || (found && found.form === 'block')
        ? 'I can\'t find a day-planner block in that text. Copy everything from the "' + BEGIN_LINE + '" line to the "' + END_LINE + '" line, including both lines.'
        : 'There is nothing to import yet. Paste a block from the chat, or open a trip you saved to a file.';
      break;
    case 'cut-off':
      message = 'This block is cut off: the closing "' + END_LINE + '" line is missing. Copy it again from the chat, from its first line to its last.';
      break;
    case 'damaged':
      message = 'The block is damaged, so I could not read it'
        + (at == null ? '' : at >= size ? ' (it stops after ' + size + ' characters)' : ' (it stops making sense ' + at + ' characters in, of ' + size + ')')
        + '. Copy it again, or ask the chat for the trip as a file instead.';
      break;
    case 'old-version':
      message = 'This comes from the first planner (day-planner/1). It uses a different format, so it cannot be loaded here.';
      break;
    case 'newer-version':
      message = 'This block was written by a newer planner than this page. Reload the page to pick up the latest version; if that does not help, ask the chat for a ' + SCHEMA + ' block.';
      break;
    case 'handback':
      message = 'That is a hand-back: what the planner sends to the chat, not something it reads back. Ask the chat for a package, or open a trip you saved to a file.';
      break;
    case 'unknown-kind':
      message = 'This block does not say what it holds' + (env && str(env.kind) ? ' (it says "' + str(env.kind, 30) + '")' : '')
        + '. The planner reads a saved trip or a package from the chat.';
      break;
    case 'no-trip':
      message = 'This block has the right shape but no trip inside it.';
      break;
    default:
      message = 'That is valid JSON, but not the planner\'s: nothing in it says "schema": "' + SCHEMA + '".';
  }
  return { ok: false, problem, message, env: env || null, found: found || null };
}

// What loading a block would do to the trip that is open. Merging a package into a trip you have
// already changed comes later; until then every import replaces, so it always asks first.
function importNote(result, current) {
  if (!result.ok) return { confirm: false, title: 'Nothing loaded', lines: [result.message] };
  const from = result.title + ' — ' + result.summary + (result.at ? ', written ' + result.at.slice(0, 10) : '');
  if (!current) {
    return { mode: 'fresh', confirm: false, title: 'Load ' + result.title + '?', lines: [from] };
  }
  const same = current.id === result.tripId;
  const lines = [from, 'This replaces ' + (same ? 'the copy you have open' : '"' + current.title + '"') + ' — ' + summarise(current) + '.'];
  if (!same) lines.push('That is a different trip. Everything in it is about to leave this browser.');
  if (result.kind === 'package') lines.push('Merging a package into a trip you have changed comes at a later milestone; for now it replaces.');
  lines.push('You can undo this straight afterwards.');
  return { mode: same ? 'replace-same' : 'replace-other', confirm: true, title: same ? 'Replace this trip?' : 'Swap to another trip?', lines };
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
  WEEK, WEEK_LABEL, MAX_DURATION, DURATION_STEP, DEFAULT_DURATION,
  isNum, toNum, str, obj, arr, clamp, slug, cleanId, hashStr,
  parseTime, hhmm, normTime, fmtTime, fmtDur, normDate, fmtDateUK, fmtDateLongUK, weekdayOf,
  fmtMoney, kmBetween, hasPos, walkMinutes, nearestInDay, nearText,
  openOn, startWindows, estimateLeg, rideMinutes, TRANSIT_MODEL, CAR_MODEL, MODE_WORD, MAX_WALK,
  planDay,
  normSpan, normHours, normPrice, normLinks, normOsm, normPoint, normPlace, normDay, normTrip, normalise,
  normStay, shiftDate, stayNights, stayMornings, stayDays, stayFor, dayStart, dayEnd,
  addStay, updateStay, deleteStay, stayById,
  decodeFeatureId, namesFrom, kindFrom, fromMapFeature, bestFeature, KIND_BY_TAG,
  osmDays, osmSpans, parseOsmHours, hoursFromOsm, hoursText,
  PHOTON, OVERPASS, photonUrl, parsePhoton, overpassUrl, parseOverpass, detailsFromTags,
  osmUrl, gmapsUrl, lookupUrl, kindFromTags, whereOf,
  newTrip, newDay,
  dayIds, dayList, placeById, dayPlaces, planPlaces, ideasFor, backlogPlaces, plansHolding,
  clone, touch, nameOf, joinList, freeId, addPlace, moveToDay, moveToBacklog, addToPlan,
  reorderPlan, placeInPlan, removeStop, moveInBacklog, copyVersion, optimiseOrder, planCost, deletePlace, addDay, addDays, deleteDay, setDayDate, bestSlot,
  BEGIN_LINE, END_LINE, KIND_LABELS, KINDS_INOUT, envelope, writeJson, writeBlock, fileName, sizeText,
  findPayload, readBlock, summarise, importNote,
};
root.DayPlannerCore = Core;
if (typeof module !== 'undefined' && module.exports) module.exports = Core;
})(typeof window !== 'undefined' ? window : globalThis);
