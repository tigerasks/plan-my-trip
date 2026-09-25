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
  d.start = normPoint(r.start, '') || { name: '', lat: null, lng: null, time: null };
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
// Where a new stop fits best. Until the scheduler lands this is least added distance, measured
// straight-line from the day's start and back to its end.
function bestSlot(trip, dayId, key, placeId) {
  const d = obj(obj(trip).days)[dayId];
  const p = placeById(trip, placeId);
  if (!d || !p || !hasPos(p)) return d ? d.plans[key].length : 0;
  const stops = d.plans[key].map((id) => trip.places[id]).filter(hasPos);
  const start = hasPos(d.start) ? d.start : null;
  const end = d.end && hasPos(d.end) ? d.end : start;
  const chain = [start].concat(stops, [end]);
  let best = stops.length, bestCost = Infinity;
  for (let i = 0; i <= stops.length; i++) {
    const before = chain[i], after = chain[i + 1];
    const cost = (before ? kmBetween(before, p) : 0) + (after ? kmBetween(p, after) : 0)
      - (before && after ? kmBetween(before, after) : 0);
    if (cost < bestCost - 1e-9) { bestCost = cost; best = i; }
  }
  return best;
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
// Put a place at a position in a version, whether or not it is already in it. One operation for
// both dragging a stop up the list and dragging one in from somewhere else.
function placeInPlan(trip, id, key, index, now) {
  const p = placeById(trip, id);
  if (!p || !p.dayId || !PLAN_KEYS.includes(key)) return { ok: false, text: 'That place is not on a day' };
  const list = trip.days[p.dayId].plans[key];
  const at = list.indexOf(id);
  if (at >= 0) list.splice(at, 1);
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
  WEEK, WEEK_LABEL, MAX_DURATION, DURATION_STEP, DEFAULT_DURATION, DEFAULT_LUNCH,
  isNum, toNum, str, obj, arr, clamp, slug, cleanId, hashStr,
  parseTime, hhmm, normTime, fmtTime, fmtDur, normDate, fmtDateUK, fmtDateLongUK, weekdayOf,
  fmtMoney, kmBetween, hasPos, walkMinutes, nearestInDay, nearText,
  normSpan, normHours, normPrice, normLinks, normOsm, normPoint, normPlace, normDay, normTrip, normalise,
  normStay, shiftDate, stayNights, stayMornings, stayDays, stayFor, dayStart, dayEnd,
  addStay, updateStay, deleteStay, stayById,
  decodeFeatureId, namesFrom, kindFrom, fromMapFeature, bestFeature, KIND_BY_TAG,
  osmDays, osmSpans, parseOsmHours, hoursFromOsm, hoursText,
  PHOTON, OVERPASS, photonUrl, parsePhoton, overpassUrl, parseOverpass, detailsFromTags,
  osmUrl, gmapsUrl, lookupUrl, kindFromTags, whereOf,
  newTrip, newDay,
  dayIds, dayList, placeById, dayPlaces, planPlaces, ideasFor, backlogPlaces, plansHolding,
  clone, touch, nameOf, joinList, freeId, addPlace, moveToDay, moveToBacklog, addToPlan, removeFromPlan,
  reorderPlan, placeInPlan, moveInBacklog, deletePlace, addDay, addDays, deleteDay, setDayDate, bestSlot,
  BEGIN_LINE, END_LINE, KIND_LABELS, KINDS_INOUT, envelope, writeJson, writeBlock, fileName, sizeText,
  findPayload, readBlock, summarise, importNote,
};
root.DayPlannerCore = Core;
if (typeof module !== 'undefined' && module.exports) module.exports = Core;
})(typeof window !== 'undefined' ? window : globalThis);
