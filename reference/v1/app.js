(function () {
'use strict';
const C = window.DayPlannerCore;
const $ = (s, el) => (el || document).querySelector(s);
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);
const SESSION = 's' + Math.random().toString(36).slice(2, 10);
const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : null);

// ---------- icons (inline SVG, Lucide/Tabler-style strokes) ----------
const ICON = {
  transit: '<rect x="4" y="3" width="16" height="16" rx="2"/><path d="M4 11h16M12 3v8M8 19l-2 3M18 22l-2-3M8 15h.01M16 15h.01"/>',
  walk: '<circle cx="13" cy="4" r="1.6"/><path d="M7 21l3-4M16 21l-2-4-3-3 1-6M6 12l2-3 4-1 3 3 3 1"/>',
  car: '<path d="m21 8-2 2-1.5-3.7A2 2 0 0 0 15.65 5H8.4a2 2 0 0 0-1.9 1.26L5 10 3 8"/><path d="M7 14h.01M17 14h.01"/><rect x="3" y="10" width="18" height="8" rx="2"/><path d="M5 18v2M19 18v2"/>',
  home: '<path d="M4 11 12 4l8 7"/><path d="M6 10v10h12V10"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  fit: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
  expand: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
  shrink: '<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>',
  sliders: '<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/>',
  grip: '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',
  ext: '<path d="M15 3h6v6M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  utensils: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/>',
  chev: '<path d="m6 9 6 6 6-6"/>',
  undo: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
};
const ic = (n, cls) => '<svg class="i' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true">' + ICON[n] + '</svg>';
const MODE_LABEL = { transit: 'Train / bus', walk: 'Walk', car: 'Taxi' };
const MODE_SHORT = { transit: 'Transit', walk: 'Walk', car: 'Taxi' };
const PRIO_LABEL = { must: 'Must-do', want: 'Want', maybe: 'Maybe', skip: 'Skip' };
const KIND_LABEL = { sight: 'Sight', food: 'Food', shop: 'Shopping', nature: 'Nature', museum: 'Museum', culture: 'Temple / culture', view: 'Viewpoint', experience: 'Experience', other: 'Place' };
const GMODE = { transit: 'transit', walk: 'walking', car: 'driving' };

// Per-viewer conveniences only (never shared state).
const LS = {
  get(k, d) { try { const v = localStorage.getItem('dp:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('dp:' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
};

// ---------- app state ----------
const App = {
  db: null, dbState: 'connecting', readOnly: false,
  trips: {}, days: {}, daysLoaded: {}, tripsLoaded: false, focus: null, focusLoaded: false,
  tripId: null, dayId: null, trip: {}, day: null, dayKey: null, dayMissing: false, noDays: false,
  planDoc: null, planLoaded: false, state: C.normState({}), plan: null, V: null, planError: null,
  ui: { sel: null, sheet: null, handedMsg: null, copyFallback: null },
  rev: 0, saveTimer: null, savePath: null, gen: 0,
};

// ---------- database ----------
const Subs = {
  map: {},
  on(name, ref, cb) {
    this.off(name);
    try { this.map[name] = ref.onSnapshot(cb, (err) => dbError(err, name)); } catch (e) { dbError(e, name); }
  },
  off(name) { const u = this.map[name]; if (u) { try { u(); } catch (e) { /* ignore */ } delete this.map[name]; } },
  names() { return Object.keys(this.map); },
};
function dbError(err, where) {
  const code = err && err.code;
  console.warn('db error', where, code, err && err.message);
  if (code === 'revoked') { App.dbState = 'error'; App.dbErrorText = 'Access to this planner\'s data was revoked.'; render(); }
}
// One write at a time; a newer body for a queued path replaces the older one.
const Writer = {
  queue: [], busy: false,
  put(path, body) {
    return new Promise((resolve, reject) => {
      const q = this.queue.find((x) => x.path === path);
      if (q) { q.body = body; q.waiters.push({ resolve, reject }); }
      else this.queue.push({ path, body, waiters: [{ resolve, reject }], tries: 0 });
      this.run();
    });
  },
  async run() {
    if (this.busy) return;
    this.busy = true;
    while (this.queue.length) {
      const job = this.queue.shift();
      try {
        await App.db.doc(job.path).set(job.body);
        job.waiters.forEach((w) => w.resolve(true));
      } catch (e) {
        const code = e && e.code;
        if ((code === 'unavailable' || code === 'resource_exhausted') && job.tries < 2) {
          job.tries++;
          await new Promise((r) => setTimeout(r, code === 'unavailable' ? 1500 : 5000));
          this.queue.unshift(job);
          continue;
        }
        if (code === 'invalid_argument') {
          App.readOnly = true;
          toast('View only — your changes here aren\'t saved');
          render();
        } else if (code === 'quota_exceeded') toast('Planner storage is full — changes aren\'t saved');
        else toast('Couldn\'t save (' + (code || 'error') + ')');
        job.waiters.forEach((w) => w.reject(e));
      }
    }
    this.busy = false;
  },
};

function cleanState(s) {
  const out = {};
  for (const [k, v] of Object.entries(C.normState(s))) {
    if (v == null) continue;
    if (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length) continue;
    out[k] = v;
  }
  return out;
}
const stateHash = (s) => C.hashStr(JSON.stringify(cleanState(s))).toString(36);
const planPath = () => 'trips/' + App.tripId + '/plans/' + App.dayId;
function planBody(handback) {
  const state = cleanState(App.state);
  const body = {
    schema: C.SCHEMA, tripId: App.tripId, dayId: App.dayId, state, stateHash: stateHash(state),
    current: App.plan ? App.plan.result : null,
    handback: handback || (App.planDoc && App.planDoc.handback) || null,
    updatedAt: new Date().toISOString(), writer: SESSION, rev: ++App.rev,
  };
  App.planDoc = body;
  return body;
}
function scheduleSave() {
  if (!App.db || App.readOnly || !App.tripId || !App.dayId) return;
  App.savePath = planPath();
  clearTimeout(App.saveTimer);
  App.saveTimer = setTimeout(() => { App.saveTimer = null; Writer.put(App.savePath, planBody()).catch(() => {}); }, 900);
}
function flushSave() {
  if (!App.saveTimer) return;
  clearTimeout(App.saveTimer);
  App.saveTimer = null;
  Writer.put(App.savePath, planBody()).catch(() => {});
}

async function initDb() {
  if (!window.claude || typeof window.claude.use !== 'function') { App.dbState = 'absent'; render(); return; }
  let db = null;
  try { db = await window.claude.use('db'); } catch (e) { db = null; }
  if (!db) { App.dbState = 'absent'; render(); return; }
  App.db = db;
  App.dbState = 'ready';
  Subs.on('focus', db.doc('meta/focus'), onFocus);
  Subs.on('trips', db.collection('trips'), onTrips);
  render();
}
const definitive = (snap) => !(snap && snap.metadata && snap.metadata.fromCache);
function onFocus(snap) {
  if (!snap.exists && !definitive(snap) && !App.grace) return;
  const f = snap.exists ? snap.data() : null;
  const first = !App.focusLoaded;
  App.focus = f && f.tripId && f.dayId ? { tripId: String(f.tripId), dayId: String(f.dayId), at: String(f.at || '') } : null;
  App.focusLoaded = true;
  if (first) { pickDay(); return; }
  const f2 = App.focus;
  if (f2 && (f2.tripId !== App.tripId || f2.dayId !== App.dayId)) {
    LS.set('focusSeen', f2.at);
    const d = App.days[f2.tripId] && App.days[f2.tripId][f2.dayId];
    toast('The chat sent ' + (d ? C.fmtDateUK(d.date || f2.dayId) : f2.dayId), { label: 'Open', fn: () => selectDay(f2.tripId, f2.dayId) }, 8000);
  }
}
function onTrips(snap) {
  const trips = {};
  snap.docs.forEach((d) => { trips[d.id] = d.data() || {}; });
  App.trips = trips;
  App.tripsLoaded = App.tripsLoaded || definitive(snap) || !!App.grace;
  for (const id of Object.keys(trips)) {
    if (!Subs.map['days:' + id]) Subs.on('days:' + id, App.db.collection('trips/' + id + '/days'), (s) => onDays(id, s));
  }
  for (const name of Subs.names()) {
    if (name.startsWith('days:') && !trips[name.slice(5)]) { Subs.off(name); delete App.days[name.slice(5)]; delete App.daysLoaded[name.slice(5)]; }
  }
  if (App.tripId && trips[App.tripId]) { App.trip = trips[App.tripId]; recompute(); }
  pickDay();
  render();
}
function onDays(tripId, snap) {
  const days = {};
  snap.docs.forEach((d) => { days[d.id] = d.data() || {}; });
  App.days[tripId] = days;
  App.daysLoaded[tripId] = App.daysLoaded[tripId] || definitive(snap) || !!App.grace;
  if (tripId === App.tripId) onDayData();
  pickDay();
  renderHeader();
}
function onPlan(snap) {
  if (snap.metadata && snap.metadata.hasPendingWrites) return;
  if (!snap.exists && !definitive(snap) && !App.grace) return;
  const data = snap.exists ? snap.data() : null;
  App.planLoaded = true;
  const own = !!data && data.writer === SESSION;
  if (!own && !App.saveTimer) {
    App.planDoc = data;
    App.state = C.normState(data && data.state);
    recompute();
  } else if (own) App.planDoc = data;
  render();
}

function allDays() {
  const out = [];
  for (const [tid, days] of Object.entries(App.days)) {
    for (const [did, d] of Object.entries(days)) out.push({ tripId: tid, dayId: did, day: d, trip: App.trips[tid] || {} });
  }
  return out;
}
const dayExists = (t, d) => !!(App.days[t] && App.days[t][d]);
function pickDay() {
  if (App.tripId) return;
  if (!App.focusLoaded || !App.tripsLoaded) return;
  const f = App.focus;
  if (f && (!LS.get('focusSeen') || f.at > LS.get('focusSeen'))) {
    if (!App.daysLoaded[f.tripId] && App.trips[f.tripId]) return;       // wait for that trip's days
    if (dayExists(f.tripId, f.dayId)) { LS.set('focusSeen', f.at); selectDay(f.tripId, f.dayId); return; }
  }
  const last = LS.get('lastSel');
  if (last && dayExists(last.tripId, last.dayId)) { selectDay(last.tripId, last.dayId); return; }
  if (Object.keys(App.trips).some((t) => !App.daysLoaded[t])) return;
  const all = allDays().filter((x) => !x.trip.demo).concat(allDays().filter((x) => x.trip.demo));
  if (!all.length) { App.noDays = true; render(); return; }
  all.sort((a, b) => String(b.day.updatedAt || '').localeCompare(String(a.day.updatedAt || '')));
  selectDay(all[0].tripId, all[0].dayId);
}
function selectDay(tripId, dayId) {
  if (App.tripId === tripId && App.dayId === dayId) return;
  flushSave();
  App.tripId = tripId; App.dayId = dayId; App.trip = App.trips[tripId] || {};
  App.noDays = false; App.dayMissing = false;
  LS.set('lastSel', { tripId, dayId });
  App.day = null; App.dayKey = null; App.planDoc = null; App.planLoaded = false; App.state = C.normState({}); App.plan = null;
  App.ui.sel = null; App.ui.sheet = null; App.ui.handedMsg = null;
  MapV.needFit = true;
  if (App.db) Subs.on('plan', App.db.doc(planPath()), onPlan);
  onDayData();
  render();
}
function onDayData() {
  const d = App.days[App.tripId] && App.days[App.tripId][App.dayId];
  if (!d) {
    if (App.daysLoaded[App.tripId]) { App.day = null; App.dayMissing = true; App.plan = null; render(); }
    return;
  }
  const key = JSON.stringify(d);
  if (key === App.dayKey) return;
  const prev = App.day;
  App.day = d; App.dayKey = key; App.dayMissing = false;
  if (prev) {
    const had = new Set((prev.places || []).map((p) => p && p.id));
    const added = (d.places || []).filter((p) => p && !had.has(p.id)).length;
    toast('Updated by the chat' + (added ? ' · ' + added + ' new place' + (added > 1 ? 's' : '') : ''));
  }
  recompute();
  render();
}

// ---------- planning ----------
function recompute() {
  if (!App.day) { App.plan = null; return; }
  const gen = ++App.gen;
  const meta = { tripId: App.tripId, dayId: App.dayId, basedOn: App.day.updatedAt || null, now: new Date().toISOString() };
  try {
    App.plan = C.plan(App.trip, App.day, App.state, meta, { deep: false });
    App.plan.leftFinal = App.plan.manual;
    App.planError = null;
  } catch (e) {
    console.error(e);
    App.plan = null; App.planError = String((e && e.message) || e);
    return;
  }
  App.V = null;
  setTimeout(() => deepPass(gen), 30);
}
function deepPass(gen) {
  if (gen !== App.gen || !App.plan) return;
  const P = App.plan;
  const V = {};
  for (const k of C.PACE_KEYS) V[k] = C.variant(P.M, k);
  if (gen !== App.gen) return;
  App.V = V;
  renderVariantsOnly();
  if (P.leftFinal) return;
  setTimeout(() => {
    if (gen !== App.gen) return;
    const left = C.explainLeftOut(P.M, P.route, { manual: P.manual, deep: true });
    if (gen !== App.gen) return;
    P.left = left; P.leftFinal = true;
    P.result.leftOut = C.leftOutJson(P.M, left);
    P.result.text = C.planText(P.M, P.sim, left);
    renderPanel();
    if (App.ui.sheet && App.ui.sheet.type === 'place') renderSheet();
  }, 15);
}
// Apply a state change from a user action.
function change(mutator, opts) {
  opts = opts || {};
  const before = App.plan ? App.plan.route.slice() : [];
  const s = JSON.parse(JSON.stringify(App.state));
  mutator(s);
  App.state = C.normState(s);
  recompute();
  render();
  scheduleSave();
  if (opts.announce && App.plan) announceDiff(before, App.plan.route, opts.subject);
}
function announceDiff(before, after, subject) {
  const M = App.plan.M;
  const places = (r) => r.filter((k) => M.places[k]);
  const b = new Set(places(before)), a = new Set(places(after));
  const added = [...a].filter((k) => !b.has(k) && k !== subject).map((k) => M.places[k].name);
  const dropped = [...b].filter((k) => !a.has(k) && k !== subject).map((k) => M.places[k].name);
  const bits = [];
  if (added.length) bits.push('Added ' + C.joinNames(added));
  if (dropped.length) bits.push('dropped ' + C.joinNames(dropped));
  if (bits.length) {
    const s = bits.join(' · ');
    toast(s[0].toUpperCase() + s.slice(1) + (dropped.length && !App.plan.manual ? ' to keep the ' + C.PACES[M.pace].label.toLowerCase() + ' pace' : ''));
  }
}
const inRoute = (k) => !!App.plan && App.plan.route.includes(k);

// ---------- map ----------
const MapV = {
  svg: null, wrap: null, w: 0, h: 0, lat0: 0, lng0: 0, kx: 1, ky: 1, cx: 0, cy: 0, scale: 60, needFit: true, originKey: null,
  hits: [], raf: 0, ctx: null,
  init() {
    this.svg = $('#map'); this.wrap = $('#mapwrap');
    const ro = new ResizeObserver(() => { this.measure(); this.render(); });
    ro.observe(this.wrap);
    this.measure();
    this.bindGestures();
  },
  measure() { const r = this.wrap.getBoundingClientRect(); this.w = r.width; this.h = r.height; },
  setOrigin(M) {
    const key = M.start.lat + ',' + M.start.lng;
    if (key === this.originKey) return;
    this.originKey = key;
    this.lat0 = M.start.lat; this.lng0 = M.start.lng;
    this.kx = 111.32 * Math.cos(this.lat0 * Math.PI / 180); this.ky = 110.574;
    this.needFit = true;
  },
  km(n) { return [(n.lng - this.lng0) * this.kx, (n.lat - this.lat0) * this.ky]; },
  scr(x, y) { return [(x - this.cx) * this.scale + this.w / 2, this.h / 2 - (y - this.cy) * this.scale]; },
  unscr(sx, sy) { return [(sx - this.w / 2) / this.scale + this.cx, this.cy - (sy - this.h / 2) / this.scale]; },
  pts() {
    const P = App.plan; if (!P) return [];
    const M = P.M;
    const list = [M.start].concat(M.end ? [M.end] : [], M.placeList.filter((p) => !p.bad), M.landmarks);
    return list.map((n) => this.km(n));
  },
  fit() {
    const pts = this.pts();
    if (!pts.length || !this.w) return;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const pad = { l: 28, r: 58, t: 58, b: 46 };
    const sw = Math.max(40, this.w - pad.l - pad.r), sh = Math.max(40, this.h - pad.t - pad.b);
    const bw = Math.max(0.05, maxX - minX), bh = Math.max(0.05, maxY - minY);
    this.scale = Math.max(1, Math.min(2500, Math.min(sw / bw, sh / bh)));
    this.cx = (minX + maxX) / 2 + ((pad.r - pad.l) / 2) / this.scale;
    this.cy = (minY + maxY) / 2 + ((pad.t - pad.b) / 2) / this.scale;
    this.needFit = false;
  },
  zoom(f, sx, sy) {
    if (sx == null) { sx = this.w / 2; sy = this.h / 2; }
    const [x, y] = this.unscr(sx, sy);
    this.scale = Math.max(1, Math.min(3000, this.scale * f));
    this.cx = x - (sx - this.w / 2) / this.scale;
    this.cy = y + (sy - this.h / 2) / this.scale;
    this.render();
  },
  ensureVisible(key) {
    const n = nodeOf(key); if (!n || !this.w) return;
    const [sx, sy] = this.scr(...this.km(n));
    if (sx < 30 || sx > this.w - 60 || sy < 56 || sy > this.h - 40) { const [x, y] = this.km(n); this.cx = x; this.cy = y; }
  },
  request() { if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.render(); }); },
  measureText(t, font) {
    if (!this.ctx) this.ctx = document.createElement('canvas').getContext('2d');
    this.ctx.font = font;
    return this.ctx.measureText(t).width;
  },
  render() {
    const svg = this.svg; if (!svg) return;
    const P = App.plan;
    $('#mapEmpty').hidden = !!P;
    if (!P || !this.w || !this.h) { svg.innerHTML = ''; $('#scale').innerHTML = ''; return; }
    const M = P.M;
    this.setOrigin(M);
    if (this.needFit) this.fit();
    const W = this.w, H = this.h, S = this.scale;
    const out = [];
    const hits = [];
    // grid
    const steps = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200];
    const step = steps.find((s) => s * S >= 70) || 200;
    const [x0, y1] = this.unscr(0, 0), [x1, y0] = this.unscr(W, H);
    let g = '';
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) { const sx = this.scr(x, 0)[0]; g += 'M' + sx.toFixed(1) + ' 0V' + H; }
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) { const sy = this.scr(0, y)[1]; g += 'M0 ' + sy.toFixed(1) + 'H' + W; }
    out.push('<path class="m-grid" d="' + g + '"/>');
    const sbar = step * S, sLabel = step < 1 ? Math.round(step * 1000) + ' m' : step + ' km';
    $('#scale').innerHTML = '<div class="scalebar"><span>' + sLabel + '</span><i style="width:' + sbar.toFixed(0) + 'px"></i></div><span class="map-note">No street map · positions to scale</span>';

    const good = M.placeList.filter((p) => !p.bad);
    const pos = new Map();
    const put = (n) => { const [x, y] = this.km(n); const s = this.scr(x, y); pos.set(n.id, s); return s; };
    put(M.start); if (M.end) put(M.end); good.forEach(put); M.landmarks.forEach(put);

    // area labels (behind everything)
    const areas = new Map();
    for (const p of good) if (p.area) { const a = areas.get(p.area) || []; a.push(pos.get(p.id)); areas.set(p.area, a); }
    const areaRects = [];
    for (const [name, list] of areas) {
      const ax = list.reduce((s, q) => s + q[0], 0) / list.length, ay = list.reduce((s, q) => s + q[1], 0) / list.length - 22;
      const tw = this.measureText(name.toUpperCase(), '700 10.5px sans-serif') * 1.15;
      const r = { x: ax - tw / 2, y: ay - 8, w: tw, h: 11 };
      if (areaRects.some((o) => overlap(o, r))) continue;
      areaRects.push(r);
      out.push('<text class="m-area" x="' + ax.toFixed(1) + '" y="' + ay.toFixed(1) + '" text-anchor="middle">' + esc(name) + '</text>');
    }
    // landmarks
    for (const l of M.landmarks) {
      const [sx, sy] = pos.get(l.id);
      out.push('<rect class="m-lm" x="' + (sx - 4).toFixed(1) + '" y="' + (sy - 4).toFixed(1) + '" width="8" height="8" rx="1.5"/>');
    }
    // declutter: nudge overlapping markers apart; the true spot keeps a dot and a leader line
    const stopSet = new Set(P.sim.items.filter((i) => i.type === 'visit').map((i) => i.place.id));
    const drawEnd = !!M.end && C.kmBetween(M.start, M.end) > 0.05;
    const items = [M.start].concat(drawEnd ? [M.end] : [], good).map((n) => {
      const [x, y] = pos.get(n.id);
      return { id: n.id, x, y, ox: x, oy: y, r: n.id === 'start' || n.id === 'end' || stopSet.has(n.id) ? 12 : 7.5 };
    });
    for (let it = 0; it < 60; it++) {
      let moved = false;
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i], b = items[j];
          let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
          const min = a.r + b.r + 2;
          if (d >= min) continue;
          if (d < 0.01) { const ang = (i + 1) * 2.39996 + j; dx = Math.cos(ang); dy = Math.sin(ang); d = 1; }
          const push = (min - d) / 2 + 0.01;
          a.x -= dx / d * push; a.y -= dy / d * push; b.x += dx / d * push; b.y += dy / d * push;
          moved = true;
        }
      }
      for (const a of items) {
        const ddx = a.x - a.ox, ddy = a.y - a.oy, dd = Math.hypot(ddx, ddy);
        if (dd > 42) { a.x = a.ox + ddx / dd * 42; a.y = a.oy + ddy / dd * 42; }
      }
      if (!moved) break;
    }
    const dpos = new Map(items.map((a) => [a.id, [a.x, a.y]]));
    const at = (id) => dpos.get(id) || pos.get(id);
    let leaders = '';
    for (const a of items) {
      if (Math.hypot(a.x - a.ox, a.y - a.oy) < 3) continue;
      leaders += '<path class="m-leader" d="M' + a.ox.toFixed(1) + ' ' + a.oy.toFixed(1) + 'L' + a.x.toFixed(1) + ' ' + a.y.toFixed(1) + '"/><circle class="m-true" cx="' + a.ox.toFixed(1) + '" cy="' + a.oy.toFixed(1) + '" r="2.2"/>';
    }
    // route
    const sel = App.ui.sel;
    const stops = P.sim.items.filter((i) => i.type === 'visit');
    const segs = [];
    let prevId = 'start';
    for (const it of stops) { segs.push({ a: prevId, b: it.place.id, leg: it.leg }); prevId = it.place.id; }
    if (M.end && P.sim.endLeg) segs.push({ a: prevId, b: 'end', leg: P.sim.endLeg });
    for (const s of segs) {
      const A = at(s.a), B = at(s.b); if (!A || !B) continue;
      const d = 'M' + A[0].toFixed(1) + ' ' + A[1].toFixed(1) + 'L' + B[0].toFixed(1) + ' ' + B[1].toFixed(1);
      out.push('<path class="m-seg-bg" d="' + d + '"/><path class="m-seg ' + s.leg.mode + '" d="' + d + '"/>');
    }
    out.push(leaders);
    // nodes
    const nodeRects = [];
    const nodeSvg = [];
    const stopNo = new Map(); stops.forEach((it, i) => stopNo.set(it.place.id, i + 1));
    const homeSvg = (n, isEnd) => {
      const [sx, sy] = at(n.id);
      nodeRects.push({ x: sx - 11, y: sy - 11, w: 22, h: 22, id: n.id });
      hits.push({ key: n.id, x: sx, y: sy, r: 12 });
      return (sel === n.id ? '<circle class="m-halo" cx="' + sx + '" cy="' + sy + '" r="19"/>' : '') +
        '<rect class="m-home" x="' + (sx - 11).toFixed(1) + '" y="' + (sy - 11).toFixed(1) + '" width="22" height="22" rx="6"/>' +
        '<g transform="translate(' + (sx - 7).toFixed(1) + ' ' + (sy - 7).toFixed(1) + ') scale(0.583)"><path class="m-home-i" d="' + (isEnd ? 'M5 21V4M5 4h11l-2 4 2 4H5' : 'M4 11 12 4l8 7M6 10v10h12V10') + '"/></g>';
    };
    const cands = good.filter((p) => !stopNo.has(p.id));
    for (const p of cands) {
      const [sx, sy] = at(p.id);
      const cls = 'm-cand ' + p.priority + (p.closed || p.priority === 'skip' ? ' out' : '');
      nodeRects.push({ x: sx - 8, y: sy - 8, w: 16, h: 16, id: p.id });
      hits.push({ key: p.id, x: sx, y: sy, r: 8 });
      nodeSvg.push((sel === p.id ? '<circle class="m-halo" cx="' + sx.toFixed(1) + '" cy="' + sy.toFixed(1) + '" r="15"/>' : '') +
        '<circle class="' + cls + '" cx="' + sx.toFixed(1) + '" cy="' + sy.toFixed(1) + '" r="' + (p.priority === 'skip' ? 5 : 6.5) + '"/>');
    }
    const startSvg = homeSvg(M.start, false);
    const endSvg = M.end && C.kmBetween(M.start, M.end) > 0.05 ? homeSvg(M.end, true) : '';
    for (const it of stops) {
      const p = it.place, [sx, sy] = at(p.id), n = stopNo.get(p.id);
      nodeRects.push({ x: sx - 12, y: sy - 12, w: 24, h: 24, id: p.id });
      hits.push({ key: p.id, x: sx, y: sy, r: 12 });
      nodeSvg.push((sel === p.id ? '<circle class="m-halo" cx="' + sx.toFixed(1) + '" cy="' + sy.toFixed(1) + '" r="20"/>' : '') +
        '<circle class="m-stop' + (p.priority === 'must' ? ' must' : '') + '" cx="' + sx.toFixed(1) + '" cy="' + sy.toFixed(1) + '" r="11"/>' +
        '<text class="m-num" x="' + sx.toFixed(1) + '" y="' + (sy + 0.5).toFixed(1) + '">' + n + '</text>');
    }
    // leg pills
    const placed = [];
    const inView = (r) => r.x > 2 && r.y > 2 && r.x + r.w < W - 2 && r.y + r.h < H - 2;
    const free = (r, selfId) => !placed.some((o) => overlap(o, r)) && !nodeRects.some((o) => o.id !== selfId && overlap(o, r));
    const pillSvg = [];
    if (!sel) {
      for (const s of segs) {
        const A = at(s.a), B = at(s.b); if (!A || !B) continue;
        const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
        if (len < 58 || s.leg.minutes <= 0) continue;
        const t = (s.leg.estimate ? '≈' : '') + s.leg.minutes + '′';
        const tw = this.measureText(t, '700 10.5px sans-serif') + 10;
        const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2;
        const r = { x: mx - tw / 2, y: my - 8, w: tw, h: 16 };
        if (!inView(r) || !free(r)) continue;
        placed.push(r);
        hits.push({ key: 'leg:' + s.a + '>' + s.b, x: mx, y: my, r: Math.max(12, tw / 2) });
        pillSvg.push('<g class="m-pill' + (s.leg.estimate ? ' est' : '') + '"><rect x="' + r.x.toFixed(1) + '" y="' + r.y.toFixed(1) + '" width="' + tw.toFixed(1) + '" height="16" rx="8"/><text x="' + mx.toFixed(1) + '" y="' + (my + 3.8).toFixed(1) + '" text-anchor="middle">' + esc(t) + '</text></g>');
      }
    }
    // "from here" minutes when something is selected
    const distSvg = [];
    const selNode = sel ? nodeOf(sel) : null;
    if (selNode && at(selNode.id)) {
      const others = [M.start].concat(endSvg ? [M.end] : [], good).filter((n) => n.id !== selNode.id);
      for (const n of others) {
        const lg = M.leg(selNode, n);
        const [sx, sy] = at(n.id);
        const t = (lg.estimate ? '≈' : '') + lg.minutes + '′';
        const tw = this.measureText(t, '800 10.5px sans-serif') + 10;
        const r = { x: sx - tw / 2, y: sy - 30, w: tw, h: 16 };
        if (!inView(r) || !free(r, n.id)) continue;
        placed.push(r);
        const band = lg.minutes <= 15 ? 'near' : lg.minutes <= 30 ? 'mid' : 'far';
        distSvg.push('<g class="m-dist ' + band + '"><rect x="' + r.x.toFixed(1) + '" y="' + r.y.toFixed(1) + '" width="' + tw.toFixed(1) + '" height="16" rx="8"/><text x="' + sx.toFixed(1) + '" y="' + (r.y + 11.8).toFixed(1) + '" text-anchor="middle">' + esc(t) + '</text></g>');
      }
    }
    // labels (selected first, then stops, anchors, candidates, landmarks)
    const labelSvg = [];
    const order = [];
    if (sel && at(sel)) order.push({ id: sel, cls: 'sel', r: 13 });
    for (const it of stops) order.push({ id: it.place.id, cls: '', r: 12 });
    order.push({ id: 'start', cls: '', r: 12 });
    if (endSvg) order.push({ id: 'end', cls: '', r: 12 });
    for (const p of cands) order.push({ id: p.id, cls: 'cand', r: 8 });
    for (const l of M.landmarks) order.push({ id: l.id, cls: 'cand', r: 5, lm: true });
    const done = new Set();
    for (const o of order) {
      if (done.has(o.id)) continue; done.add(o.id);
      const n = nodeOf(o.id) || M.landmarks.find((l) => l.id === o.id);
      const pt = at(o.id); if (!n || !pt) continue;
      let text = n.name;
      if (o.id === 'start' && endSvg === '' && M.end) text = n.name;
      if (text.length > 30) text = text.slice(0, 28) + '…';
      const font = o.cls === 'cand' ? '500 11.5px sans-serif' : (o.cls === 'sel' ? '800 12px sans-serif' : '600 12px sans-serif');
      const tw = this.measureText(text, font) * 1.04, th = 14;
      const [sx, sy] = pt;
      const tries = [[sx + o.r + 4, sy - th / 2, 'start'], [sx - o.r - 4 - tw, sy - th / 2, 'end'], [sx - tw / 2, sy + o.r + 3, 'mid'], [sx - tw / 2, sy - o.r - 3 - th, 'mid']];
      for (const [lx, ly] of tries) {
        const r = { x: lx, y: ly, w: tw, h: th };
        if (!inView(r) || !free(r, o.id)) continue;
        placed.push(r);
        labelSvg.push('<text class="m-label ' + (o.lm ? 'cand' : o.cls) + '"' + (o.lm ? ' font-style="italic"' : '') + ' x="' + lx.toFixed(1) + '" y="' + (ly + 11).toFixed(1) + '">' + esc(text) + '</text>');
        break;
      }
    }
    out.push(nodeSvg.join(''), startSvg, endSvg, pillSvg.join(''), distSvg.join(''), labelSvg.join(''));
    svg.innerHTML = out.join('');
    this.hits = hits;
  },
  hit(sx, sy) {
    let best = null, bd = 1e9;
    for (const h of this.hits) {
      const d = Math.hypot(h.x - sx, h.y - sy);
      const lim = Math.max(22, h.r + 8);
      if (d <= lim && d < bd) { bd = d; best = h; }
    }
    return best;
  },
  bindGestures() {
    const svg = this.svg, pts = new Map();
    let start = null, moved = false, pinch = null;
    const local = (e) => { const r = svg.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    svg.addEventListener('pointerdown', (e) => {
      svg.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, local(e));
      if (pts.size === 1) { start = { p: local(e), cx: this.cx, cy: this.cy }; moved = false; }
      else if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), m: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], scale: this.scale, cx: this.cx, cy: this.cy };
        moved = true;
      }
    });
    svg.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, local(e));
      if (pts.size === 1 && start) {
        const p = local(e), dx = p[0] - start.p[0], dy = p[1] - start.p[1];
        if (!moved && Math.hypot(dx, dy) < 6) return;
        moved = true; svg.classList.add('dragging');
        this.cx = start.cx - dx / this.scale; this.cy = start.cy + dy / this.scale;
        this.request();
      } else if (pts.size === 2 && pinch) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]), m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const ns = Math.max(1, Math.min(3000, pinch.scale * d / Math.max(10, pinch.d)));
        const wx = pinch.cx + (pinch.m[0] - this.w / 2) / pinch.scale, wy = pinch.cy - (pinch.m[1] - this.h / 2) / pinch.scale;
        this.scale = ns;
        this.cx = wx - (m[0] - this.w / 2) / ns; this.cy = wy + (m[1] - this.h / 2) / ns;
        this.request();
      }
    });
    const end = (e) => {
      if (!pts.has(e.pointerId)) return;
      const p = pts.get(e.pointerId);
      pts.delete(e.pointerId);
      if (pts.size === 1) { const [q] = [...pts.values()]; start = { p: q, cx: this.cx, cy: this.cy }; pinch = null; return; }
      svg.classList.remove('dragging');
      if (pts.size === 0) {
        if (!moved && e.type === 'pointerup') onMapTap(this.hit(p[0], p[1]));
        start = null; pinch = null;
      }
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    svg.addEventListener('wheel', (e) => { e.preventDefault(); const p = local(e); this.zoom(Math.exp(-e.deltaY * 0.0015), p[0], p[1]); }, { passive: false });
    svg.addEventListener('dblclick', (e) => { const p = local(e); this.zoom(2, p[0], p[1]); });
  },
};
function overlap(a, b) { return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h; }
function nodeOf(key) {
  const M = App.plan && App.plan.M; if (!M) return null;
  if (key === 'start') return M.start;
  if (key === 'end') return M.end;
  return M.places[key] && !M.places[key].bad ? M.places[key] : null;
}
function onMapTap(hit) {
  if (!hit) { if (App.ui.sheet && (App.ui.sheet.type === 'place' || App.ui.sheet.type === 'leg')) closeSheet(); else if (App.ui.sel) { App.ui.sel = null; render(); } return; }
  if (hit.key.startsWith('leg:')) { const [a, b] = hit.key.slice(4).split('>'); openSheet({ type: 'leg', a, b }); return; }
  openPlace(hit.key, false);
}
function openPlace(key, fromList) {
  App.ui.sel = key;
  if (fromList) MapV.ensureVisible(key);
  openSheet({ type: 'place', id: key });
}

// ---------- rendering ----------
function render() {
  renderHeader();
  renderPanel();
  renderFoot();
  renderSheet();
  MapV.render();
  renderModeSeg();
}
function renderHeader() {
  const sel = $('#daySel'), face = $('#dpFace');
  const groups = Object.entries(App.days).map(([tid, days]) => ({ tid, trip: App.trips[tid] || {}, days: Object.entries(days) }))
    .filter((g) => g.days.length)
    .sort((a, b) => (a.trip.demo ? 1 : 0) - (b.trip.demo ? 1 : 0) || String(a.trip.title || a.tid).localeCompare(String(b.trip.title || b.tid)));
  let opts = '';
  for (const g of groups) {
    opts += '<optgroup label="' + esc(g.trip.title || g.tid) + '">';
    g.days.sort((a, b) => String(a[1].date || a[0]).localeCompare(String(b[1].date || b[0])));
    for (const [did, d] of g.days) {
      const v = g.tid + '/' + did;
      opts += '<option value="' + esc(v) + '"' + (g.tid === App.tripId && did === App.dayId ? ' selected' : '') + '>' + esc(C.fmtDateUK(d.date || did) + (d.title ? ' · ' + d.title : '')) + '</option>';
    }
    opts += '</optgroup>';
  }
  if (sel.dataset.sig !== opts) { sel.innerHTML = opts || '<option>No days yet</option>'; sel.dataset.sig = opts; }
  sel.disabled = !groups.length;
  const d = App.day;
  const title = d ? (d.title || '') : App.dbState === 'absent' ? 'Open from your Claude chat' : App.noDays ? 'No days yet' : 'Loading…';
  const date = d ? C.fmtDateUK(d.date || App.dayId) : 'Day planner';
  face.innerHTML = '<span class="dp-date">' + esc(date) + (d && (d.tzLabel || App.trip.tzLabel) ? ' <span class="dp-title" style="display:inline">· ' + esc(d.tzLabel || App.trip.tzLabel) + '</span>' : '') + '</span><span class="dp-title">' + esc(title) + '</span>';
  const st = $('#status');
  let html = '';
  if (App.readOnly) html = '<span class="status ro">View only</span>';
  else if (App.planDoc && App.planDoc.handback && App.planDoc.handback.at) {
    const same = App.planDoc.handback.stateHash === stateHash(App.state);
    const t = new Date(App.planDoc.handback.at);
    const hm = isNaN(t) ? '' : String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
    html = same ? '<span class="status ok">' + ic('check') + 'Handed back ' + esc(hm) + '</span>' : '<span class="status changed">Changed since hand-back</span>';
  }
  st.innerHTML = html;
  document.documentElement.style.setProperty('--top-h', $('.top').getBoundingClientRect().height + 'px');
}
function renderModeSeg() {
  const P = App.plan, el = $('#modeSeg');
  el.hidden = !P;
  if (!P) return;
  el.innerHTML = C.MODES.map((m) => '<button type="button" data-act="mode" data-v="' + m + '" aria-pressed="' + (P.M.mode === m) + '">' + ic(m) + MODE_SHORT[m] + '</button>').join('');
}
function variantHtml() {
  const P = App.plan, M = P.M;
  const chip = (k, label, v, on) => {
    const n = v ? v.sim.items.filter((i) => i.type === 'visit').length : 0;
    const m1 = v ? n + ' stop' + (n === 1 ? '' : 's') : '…', m2 = v ? 'back ' + C.hhmm(v.sim.finish) : '\u00a0';
    return '<button type="button" class="variant' + (v ? '' : ' pending') + '" data-act="pace" data-v="' + k + '" aria-pressed="' + on + '"><span class="v-name">' + esc(label) + '</span><span class="v-meta">' + esc(m1) + '</span><span class="v-meta">' + esc(m2) + '</span></button>';
  };
  let h = '<div class="variants' + (P.manual ? ' four' : '') + '" id="variants" role="group" aria-label="Pace">';
  for (const k of C.PACE_KEYS) {
    const v = App.V ? App.V[k] : (!P.manual && k === M.pace ? { sim: P.sim } : null);
    h += chip(k, C.PACES[k].label, v, !P.manual && M.pace === k);
  }
  if (P.manual) h += chip('manual', 'Your order', { sim: P.sim }, true);
  return h + '</div>';
}
function renderVariantsOnly() {
  const el = $('#variants');
  if (el && App.plan) el.outerHTML = variantHtml();
}
function waitReason(it, M) {
  const p = it.place;
  if (p.fixed != null && it.start === p.fixed) return 'starts ' + C.hhmm(p.fixed);
  if (p.window && p.window.from === it.start) return 'window opens ' + C.hhmm(it.start);
  if (p.groupKey && p.groupKey.startsWith('meal:') && M.meals[p.mealId] && it.start === M.meals[p.mealId].from) return M.meals[p.mealId].label.toLowerCase() + ' from ' + C.hhmm(it.start);
  if (p.hours && p.hours.some((h) => h.open === it.start)) return 'opens ' + C.hhmm(it.start);
  return 'until ' + C.hhmm(it.start);
}
function legRow(lg, a, b) {
  if (!lg) return '';
  const zero = lg.minutes <= 0;
  const txt = zero ? 'Same spot' : MODE_LABEL[lg.mode] + ' ' + (lg.estimate ? '<span class="est">≈</span> ' : '') + C.fmtDur(lg.minutes) + (lg.estimate ? '' : ' <span class="ck" title="' + (lg.by === 'you' ? 'Entered by you' : 'Checked by the chat') + '">✓</span>');
  return '<li class="leg ' + lg.mode + '" data-act="leg" data-a="' + esc(a) + '" data-b="' + esc(b) + '" role="button" tabindex="0" aria-label="Travel ' + esc(MODE_LABEL[lg.mode]) + ' ' + lg.minutes + ' minutes"><div></div><div class="rail"></div><div class="legtxt">' + ic(lg.mode) + txt + '</div></li>';
}
function timelineHtml() {
  const P = App.plan, M = P.M, sim = P.sim;
  const viol = new Map();
  for (const v of sim.viol) { const a = viol.get(v.key) || []; a.push(v); viol.set(v.key, a); }
  const vtxt = (key) => (viol.get(key) || []).map((v) => '<div class="bad">' + esc(violShort(M, v)) + '</div>').join('');
  let h = '';
  h += '<li class="row clickable' + (App.ui.sel === 'start' ? ' sel' : '') + '" data-act="open" data-id="start"><div class="t">' + C.hhmm(M.startTime) + '</div><div class="disc home">' + ic('home') + '</div><div class="main"><div class="name soft">' + esc(M.start.name) + '</div><div class="sub">Leave</div></div><div></div></li>';
  let prev = 'start', n = 0;
  for (const it of sim.items) {
    if (it.type === 'meal') {
      h += '<li class="row clickable" data-key="' + esc(it.key) + '" data-act="settings"><div class="t">' + C.hhmm(it.start) + '<small>' + C.hhmm(it.end) + '</small></div><div class="disc meal">' + ic('utensils') + '</div><div class="main"><div class="name soft">' + esc(it.meal.label) + '</div><div class="sub">near ' + esc(it.near.name) + ' · spot not chosen</div>' +
        (it.wait >= 5 ? '<div class="wait">Wait ' + C.fmtDur(it.wait) + ' — ' + esc(it.meal.label.toLowerCase()) + ' from ' + C.hhmm(it.start) + '</div>' : '') + vtxt(it.key) +
        '</div><button type="button" class="grip" data-grip="' + esc(it.key) + '" aria-label="Drag to reorder">' + ic('grip') + '</button></li>';
      continue;
    }
    const p = it.place;
    n++;
    h += legRow(it.leg, prev, p.id);
    const sub = [];
    if (p.area) sub.push('<span>' + esc(p.area) + '</span>');
    sub.push('<span>' + C.fmtDur(p.duration) + '</span>');
    if (p.fixed != null) sub.push('<span class="cons">' + ic('lock') + C.hhmm(p.fixed) + '</span>');
    else if (p.window) sub.push('<span class="cons">' + ic('clock') + (p.window.from != null ? C.hhmm(p.window.from) : '') + '–' + (p.window.to != null ? C.hhmm(p.window.to) : '') + '</span>');
    if (p.priority === 'must') sub.push('<span class="chip chip-rose">Must-do</span>');
    if (p.booked) sub.push('<span class="chip chip-green">Booked</span>');
    if (p.check) sub.push('<span class="chip chip-blue">Check</span>');
    else if (p.approx) sub.push('<span class="chip chip-blue">Approx. location</span>');
    if (p.groupKey && p.groupKey.startsWith('meal:')) sub.push('<span class="chip chip-stone">' + esc(M.meals[p.mealId].label) + '</span>');
    h += '<li class="row clickable' + (App.ui.sel === p.id ? ' sel' : '') + '" data-key="' + esc(p.id) + '" data-act="open" data-id="' + esc(p.id) + '">' +
      '<div class="t">' + C.hhmm(it.start) + '<small>' + C.hhmm(it.end) + '</small></div>' +
      '<div class="disc' + (p.priority === 'must' ? ' must' : '') + '">' + n + '</div>' +
      '<div class="main"><div class="name">' + esc(p.name) + '</div><div class="sub">' + sub.join('') + '</div>' +
      (it.wait >= 5 ? '<div class="wait">Wait ' + C.fmtDur(it.wait) + ' — ' + esc(waitReason(it, M)) + '</div>' : '') + vtxt(p.id) + '</div>' +
      '<button type="button" class="grip" data-grip="' + esc(p.id) + '" aria-label="Drag to reorder ' + esc(p.name) + '">' + ic('grip') + '</button></li>';
    prev = p.id;
  }
  if (M.end) {
    h += legRow(sim.endLeg, prev, 'end');
    const spare = M.endBy - sim.finish;
    h += '<li class="row clickable' + (App.ui.sel === 'end' ? ' sel' : '') + '" data-act="open" data-id="end"><div class="t">' + C.fmtTime(sim.finish) + '</div><div class="disc home">' + ic(C.kmBetween(M.start, M.end) > 0.05 ? 'flag' : 'home') + '</div><div class="main"><div class="name soft">Back at ' + esc(M.end.name) + '</div><div class="sub">' +
      (spare >= 0 ? C.fmtDur(spare) + ' spare before ' + C.hhmm(M.endBy) : '') + '</div>' + vtxt('end') + '</div><div></div></li>';
  } else {
    h += '<li class="row"><div class="t">' + C.fmtTime(sim.finish) + '</div><div></div><div class="main"><div class="name soft">Day ends</div></div><div></div></li>';
  }
  return h;
}
function violShort(M, v) {
  const p = M.places[v.key];
  switch (v.kind) {
    case 'late-fixed': return 'Arrives ' + C.fmtDur(v.minutes) + ' late for the ' + C.hhmm(p.fixed) + ' start';
    case 'tight-fixed': return 'Only ' + Math.max(0, M.fixedBuffer - v.minutes) + ' min to spare before ' + C.hhmm(p.fixed);
    case 'too-late': return 'Arrives after the last start time (' + C.hhmm(v.latest) + ')';
    case 'closed': return 'Closed this day';
    case 'no-window': return 'No opening slot fits this visit';
    case 'meal-late': return 'Starts ' + C.fmtDur(v.minutes) + ' after ' + C.hhmm(M.meals[v.key.slice(5)].to);
    case 'late-end': return C.fmtDur(v.minutes) + ' after ' + C.hhmm(M.endBy);
    default: return v.kind;
  }
}
function leftHtml() {
  const P = App.plan, M = P.M;
  if (!P.left.length) return '';
  let h = '<div class="sect"><span class="label">Not in the plan · ' + P.left.length + '</span></div><div class="card"><ul class="left">';
  let anyDrops = false;
  for (const l of P.left) {
    const p = M.places[l.id];
    const pending = !P.leftFinal && (l.reason === 'conflict' || l.reason === 'not-picked');
    let why = pending ? 'Checking what it would take…' : l.text;
    if (!pending && (l.reason === 'not-picked' || l.reason === 'not-added' || l.reason === 'alternative') && l.finish != null) {
      why += ' · ' + (l.addMin > 0 ? '+' + C.fmtDur(l.addMin) + ', ' : '') + 'back ' + C.hhmm(l.finish);
    }
    if (!pending && l.drops.length) anyDrops = true;
    const act = App.readOnly && !App.db ? null : l.action;
    const btn = act === 'add' ? 'Add' : act === 'use' ? 'Use instead' : act === 'force' ? 'Add anyway' : act === 'restore' ? 'Restore' : null;
    h += '<li class="lrow' + (App.ui.sel === l.id ? ' sel' : '') + '" data-act="open" data-id="' + esc(l.id) + '"><span class="ring ' + p.priority + '"></span>' +
      '<div><div class="lname">' + esc(p.name) + '</div><div class="lwhy' + (pending ? ' pending' : '') + '"><span class="pr">' + PRIO_LABEL[p.priority] + '</span> · ' + esc(why) + '</div></div>' +
      (btn ? '<button type="button" class="mini" data-act="left" data-v="' + act + '" data-id="' + esc(l.id) + '">' + btn + '</button>' : '<span></span>') + '</li>';
  }
  h += '</ul></div>';
  if (anyDrops && !P.manual) h += '<p class="fine">“Fits if you drop …” keeps the day at the ' + esc(C.PACES[M.pace].label.toLowerCase()) + ' pace — a busier pace fits more.</p>';
  return h;
}
function routeLink() {
  const P = App.plan, M = P.M;
  const pts = [M.start].concat(P.sim.items.filter((i) => i.type === 'visit').map((i) => i.place), M.end ? [M.end] : []);
  if (pts.length < 2) return '';
  const use = pts.length > 10 ? pts.slice(0, 10) : pts;
  const url = 'https://www.google.com/maps/dir/' + use.map((n) => n.lat.toFixed(5) + ',' + n.lng.toFixed(5)).join('/');
  return '<a class="routelink" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + ic('pin') + 'See the route on Google Maps' + (pts.length > 10 ? ' (first 10 points)' : '') + ic('ext') + '</a>';
}
function renderPanel() {
  const el = $('#plan');
  const top = el.scrollTop;
  el.innerHTML = panelHtml();
  el.scrollTop = top;
}
function panelHtml() {
  if (App.dbState === 'connecting') return '<div class="skel" style="width:70%"></div><div class="skel"></div><div class="skel" style="width:85%"></div>';
  if (App.dbState === 'error') return '<div class="empty"><h2>Can\'t load the planner</h2>' + esc(App.dbErrorText || '') + '</div>';
  if (App.dbState === 'absent') return '<div class="empty"><h2>Open this from Claude</h2>The planner keeps its days in Claude, so it only works when opened from your Claude chat or artifacts list.</div>';
  if (App.noDays) return '<div class="empty"><h2>No days yet</h2>Ask the chat to send a day to the planner — it will appear here.</div>';
  if (App.dayMissing) return '<div class="empty"><h2>This day was removed</h2>Pick another day from the menu at the top.</div>';
  if (!App.day || (!App.planLoaded && App.db)) return '<div class="skel" style="width:70%"></div><div class="skel"></div><div class="skel" style="width:85%"></div>';
  if (!App.plan) return '<div class="empty"><h2>Couldn\'t plan this day</h2>' + esc(App.planError || '') + '</div>';
  const P = App.plan, M = P.M, s = P.result.summary;
  let h = '';
  if (App.trip.demo) h += '<div class="banner demo"><b>Demo day.</b> Hours, prices and bookings are made up — play with it freely.</div>';
  if (App.readOnly) h += '<div class="banner warn">You can look around, but changes here aren\'t saved.</div>';
  h += variantHtml();
  const spare = s.spareMin;
  h += '<p class="summary"><b>' + s.stops + ' stop' + (s.stops === 1 ? '' : 's') + '</b> · ' + s.start + '–' + C.hhmm(P.sim.finish) + ' · ' + C.fmtDur(s.travelMin) + ' travel · ' +
    (spare >= 0 ? C.fmtDur(spare) + ' spare' : '<span class="over">' + C.fmtDur(-spare) + ' over</span>') + (s.waitMin >= 10 ? ' · ' + C.fmtDur(s.waitMin) + ' waiting' : '') + '</p>';
  const iss = P.result.issues;
  if (iss.length) h += '<ul class="issues">' + iss.map((i) => '<li class="' + i.severity + '">' + ic(i.severity === 'error' ? 'alert' : 'info') + '<span>' + esc(i.text) + '</span></li>').join('') + '</ul>';
  h += '<div class="card"><ol class="tl" id="tl">' + timelineHtml() + '</ol></div>';
  h += leftHtml();
  h += routeLink();
  if (M.notes) h += '<div class="notebox"><b>From the chat</b>' + esc(M.notes) + '</div>';
  if (M.issues.length) h += '<div class="databox"><b>Data to fix</b><ul>' + M.issues.map((i) => '<li>' + esc(i.text) + '</li>').join('') + '</ul></div>';
  h += '<p class="fine">Times ' + esc(M.tzLabel || 'local') + '. ≈ = estimated from distance (' + esc(C.TRANSIT[M.transitKey].label.toLowerCase()) + '); ✓ = checked. Tap a leg to check or correct it.</p>';
  return h;
}
function renderFoot() {
  const el = $('#foot');
  const P = App.plan;
  if (!P) { el.innerHTML = '<span class="note"></span>'; return; }
  const note = P.manual ? 'Your order' : C.PACES[P.M.pace].label + ' · suggested order';
  el.innerHTML = '<span class="note">' + esc(note) + '</span>' +
    (P.manual ? '<button type="button" class="btn" data-act="replan">' + ic('undo') + 'Re-plan</button>' : '') +
    '<button type="button" class="btn primary" data-act="handback"' + (App.db && !App.readOnly ? '' : ' disabled') + '>' + ic('send') + 'Hand back</button>';
}

// ---------- sheets ----------
function openSheet(s) { App.ui.sheet = s; if (s.type !== 'place') App.ui.sel = s.type === 'leg' ? null : App.ui.sel; render(); const el = $('#sheet'); el.scrollTop = 0; }
function closeSheet(silent) { App.ui.sheet = null; App.ui.sel = null; App.ui.copyFallback = null; if (!silent) render(); }
function renderSheet() {
  const el = $('#sheet'), s = App.ui.sheet;
  const typed = $('#hbNote'); if (typed) App.ui.hbNote = typed.value;
  if (!s || !App.plan) { el.classList.remove('open'); el.setAttribute('aria-hidden', 'true'); return; }
  let h = '';
  try {
    if (s.type === 'place') h = placeSheet(s.id);
    else if (s.type === 'leg') h = legSheet(s.a, s.b);
    else if (s.type === 'settings') h = settingsSheet();
    else if (s.type === 'handback') h = handbackSheet();
  } catch (e) { console.error(e); h = ''; }
  if (!h) { el.classList.remove('open'); App.ui.sheet = null; return; }
  el.innerHTML = '<div class="handle"></div>' + h;
  el.classList.add('open');
  el.setAttribute('aria-hidden', 'false');
}
const head = (title, sub) => '<div class="sh-head"><div class="sh-title">' + esc(title) + (sub ? '<div class="sh-sub">' + sub + '</div>' : '') + '</div><button type="button" class="icon-btn" data-act="close" aria-label="Close">' + ic('x') + '</button></div>';
function gmapsPlace(n) { return 'https://www.google.com/maps/search/?api=1&query=' + n.lat.toFixed(6) + ',' + n.lng.toFixed(6); }
function gmapsDir(a, b, mode) { return 'https://www.google.com/maps/dir/?api=1&origin=' + a.lat.toFixed(6) + ',' + a.lng.toFixed(6) + '&destination=' + b.lat.toFixed(6) + ',' + b.lng.toFixed(6) + '&travelmode=' + (GMODE[mode] || 'transit'); }
const link = (url, label) => (safeUrl(url) ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + ic('ext') + '</a>' : '');
function nearList(n) {
  const P = App.plan, M = P.M;
  const others = [M.start].concat(M.end && C.kmBetween(M.start, M.end) > 0.05 ? [M.end] : [], M.placeList.filter((p) => !p.bad)).filter((o) => o.id !== n.id);
  const rows = others.map((o) => ({ o, lg: M.leg(n, o) })).sort((a, b) => a.lg.minutes - b.lg.minutes).slice(0, 8);
  return '<ul class="near">' + rows.map(({ o, lg }) => {
    const band = lg.minutes <= 15 ? 'near' : lg.minutes <= 30 ? 'mid' : 'far';
    const tag = o.id === 'start' || o.id === 'end' ? '' : inRoute(o.id) ? '<span class="in">IN PLAN</span>' : '';
    return '<li data-act="open" data-id="' + esc(o.id) + '">' + ic(lg.mode) + '<span class="nm">' + esc(o.name) + '</span>' + tag + '<span class="pill ' + band + '">' + (lg.estimate ? '≈ ' : '') + lg.minutes + ' min</span></li>';
  }).join('') + '</ul>';
}
function prevNodeOf(id) {
  const P = App.plan;
  const vis = P.sim.items.filter((i) => i.type === 'visit');
  const i = vis.findIndex((x) => x.place.id === id);
  if (i < 0) return null;
  return i === 0 ? P.M.start : vis[i - 1].place;
}
function placeSheet(id) {
  const P = App.plan, M = P.M;
  if (id === 'start' || id === 'end') {
    const n = id === 'start' ? M.start : M.end;
    if (!n) return '';
    const sub = id === 'start' ? 'Leave at ' + C.hhmm(M.startTime) : 'Back by ' + C.hhmm(M.endBy);
    return head(n.name, esc(sub)) + '<div class="links">' + link(gmapsPlace(n), 'Google Maps') + '<a href="#" data-act="settings">' + ic('sliders') + 'Change times</a></div>' +
      '<div class="sh-sec"><span class="label">From here</span>' + nearList(n) + '</div>';
  }
  const p = M.places[id];
  if (!p) return '';
  const it = P.sim.items.find((i) => i.type === 'visit' && i.place.id === id);
  const idx = P.sim.items.filter((i) => i.type === 'visit').indexOf(it);
  const status = it ? 'Stop ' + (idx + 1) + ' · ' + C.hhmm(it.start) + '–' + C.hhmm(it.end) : 'Not in the plan';
  const sub = [p.area, KIND_LABEL[p.kind], status].filter(Boolean).map(esc).join(' · ');
  let h = head(p.name, sub);
  h += '<div class="seg" role="group" aria-label="Priority">' + C.PRIORITIES.map((k) =>
    '<button type="button" class="p-' + k + '" data-act="prio" data-id="' + esc(id) + '" data-v="' + k + '" aria-pressed="' + (p.priority === k) + '">' + PRIO_LABEL[k] + '</button>').join('') + '</div>';
  if (p.priority !== p.basePriority) h += '<p class="fine">The chat suggested “' + PRIO_LABEL[p.basePriority] + '”.</p>';
  const kv = [];
  kv.push('<dt>Stay</dt><dd><span class="stepper"><button type="button" data-act="dur" data-id="' + esc(id) + '" data-v="-15" aria-label="Shorter">' + ic('minus') + '</button><output>' + C.fmtDur(p.duration) + '</output><button type="button" data-act="dur" data-id="' + esc(id) + '" data-v="15" aria-label="Longer">' + ic('plus') + '</button></span></dd>');
  if (p.fixed != null) kv.push('<dt>Starts</dt><dd><span class="cons">' + ic('lock') + C.hhmm(p.fixed) + '</span> fixed' + (p.booked ? ' · <span class="chip chip-green">Booked</span>' : '') + '</dd>');
  if (p.window) kv.push('<dt>Start</dt><dd><span class="cons">' + ic('clock') + 'between ' + (p.window.from != null ? C.hhmm(p.window.from) : 'any time') + ' and ' + (p.window.to != null ? C.hhmm(p.window.to) : 'late') + '</span></dd>');
  kv.push('<dt>Hours</dt><dd>' + (p.closed ? '<b>Closed this day</b>' : p.hours ? p.hours.map((x) => C.hhmm(x.open) + '–' + C.hhmm(x.close) + (x.last != null ? ' (last entry ' + C.hhmm(x.last) + ')' : '')).join(', ') : 'None given — assumed open') + '</dd>');
  if (p.prefer) kv.push('<dt>Best</dt><dd>' + (p.prefer.from != null && p.prefer.to != null ? C.hhmm(p.prefer.from) + '–' + C.hhmm(p.prefer.to) : p.prefer.to != null ? 'before ' + C.hhmm(p.prefer.to) : 'after ' + C.hhmm(p.prefer.from)) + '</dd>');
  if (p.groupKey && p.groupKey.startsWith('meal:')) { const m = M.meals[p.mealId]; kv.push('<dt>' + esc(m.label) + '</dt><dd>Counts as ' + esc(m.label.toLowerCase()) + ' (' + C.hhmm(m.from) + '–' + C.hhmm(m.to) + ')</dd>'); }
  else if (p.group) kv.push('<dt>Group</dt><dd>One of “' + esc(p.group) + '”</dd>');
  if (p.price) kv.push('<dt>Price</dt><dd>' + esc(C.fmtMoney(p.price, M.fx)) + '</dd>');
  if (p.tags.length) kv.push('<dt>Tags</dt><dd>' + p.tags.map((t) => '<span class="chip chip-stone">' + esc(t) + '</span>').join(' ') + '</dd>');
  h += '<div class="sh-sec"><dl class="kv">' + kv.join('') + '</dl></div>';
  if (p.check) h += '<div class="flag">' + ic('info') + '<span>' + esc(p.check) + '</span></div>';
  if (p.approx) h += '<div class="flag">' + ic('pin') + '<span>Location is approximate — distances to here are rough.</span></div>';
  if (p.note) h += '<p class="note">' + esc(p.note) + '</p>';
  const left = P.left.find((l) => l.id === id);
  if (left && P.leftFinal) h += '<div class="flag" style="background:var(--stone-bg);color:var(--stone)">' + ic('info') + '<span>' + esc(left.text) + (left.finish != null && left.reason !== 'conflict' ? ' · back ' + C.hhmm(left.finish) : '') + '</span></div>';
  if (!p.bad) {
    const prev = prevNodeOf(id);
    const links = p.links.map((l) => link(l.url, l.label)).join('') + link(gmapsPlace(p), 'Google Maps') +
      (prev ? link(gmapsDir(prev, p, it ? it.leg.mode : M.mode), 'Directions from ' + (prev.id === 'start' ? 'start' : prev.name)) : '');
    h += '<div class="sh-sec"><span class="label">Links</span><div class="links">' + links + '</div></div>';
  }
  if (it) {
    h += '<div class="sh-sec"><span class="label">Order</span><div class="inrow"><button type="button" class="btn" data-act="move" data-id="' + esc(id) + '" data-v="-1">' + ic('up') + 'Earlier</button><button type="button" class="btn" data-act="move" data-id="' + esc(id) + '" data-v="1">' + ic('down') + 'Later</button></div>' +
      (P.manual ? '' : '<p class="fine">Moving a stop switches to your own order; Re-plan goes back to the suggestion.</p>') + '</div>';
  }
  if (!p.bad) h += '<div class="sh-sec"><span class="label">From here</span>' + nearList(p) + '</div>';
  return h;
}
function legSheet(a, b) {
  const P = App.plan, M = P.M;
  const A = nodeOf(a), B = nodeOf(b);
  if (!A || !B) return '';
  const lg = M.leg(A, B);
  const opts = [lg.walk].concat(lg.ride ? [lg.ride] : []);
  let h = head(A.name + ' → ' + B.name, (lg.km < 1 ? Math.round(lg.km * 1000) + ' m' : lg.km.toFixed(1) + ' km') + ' apart in a straight line');
  h += '<div class="opts">' + opts.map((o) => {
    const src = o.estimate ? 'Estimate from distance' : o.by === 'you' ? 'Entered by you' : 'Checked by the chat' + (o.note ? ' — ' + o.note : '');
    return '<button type="button" class="opt" data-act="pick" data-a="' + esc(a) + '" data-b="' + esc(b) + '" data-v="' + o.mode + '" aria-pressed="' + (lg.mode === o.mode) + '">' + ic(o.mode) +
      '<span><span class="ot">' + MODE_LABEL[o.mode] + '</span><br><span class="os">' + esc(src) + '</span></span><span class="om">' + (o.estimate ? '≈ ' : '') + C.fmtDur(o.minutes) + '</span></button>';
  }).join('') + '</div>';
  h += '<p class="fine">' + (lg.auto ? 'Chosen automatically: walking wins when it\'s under ' + M.maxWalk + ' min and not much slower.' : 'You picked this. ') + '</p>';
  if (lg.source && safeUrl(lg.source)) h += '<div class="links">' + link(lg.source, 'Source') + '</div>';
  h += '<div class="sh-sec"><span class="label">Checked it? Enter the real time</span><div class="inrow"><input class="in" id="legMin" type="number" inputmode="numeric" min="0" max="600" placeholder="' + lg.minutes + '" style="width:90px" aria-label="Minutes"><span>min by ' + esc(MODE_LABEL[lg.mode].toLowerCase()) + '</span><button type="button" class="btn" data-act="legsave" data-a="' + esc(a) + '" data-b="' + esc(b) + '" data-v="' + lg.mode + '">Save</button></div></div>';
  h += '<div class="sh-sec"><div class="links">' + link(gmapsDir(A, B, lg.mode), 'Check in Google Maps') + '</div></div>';
  const st = App.state, k1 = a + '>' + b, k2 = b + '>' + a;
  const has = st.legPick[k1] || st.legPick[k2] || Object.keys(st.legs).some((k) => k.startsWith(k1 + '|') || k.startsWith(k2 + '|'));
  if (has) h += '<div class="actions"><button type="button" class="btn" data-act="legreset" data-a="' + esc(a) + '" data-b="' + esc(b) + '">' + ic('undo') + 'Back to automatic</button></div>';
  return h;
}
function segHtml(act, cur, list) {
  return '<div class="seg">' + list.map(([v, label]) => '<button type="button" data-act="' + act + '" data-v="' + esc(v) + '" aria-pressed="' + (String(cur) === String(v)) + '">' + esc(label) + '</button>').join('') + '</div>';
}
function settingsSheet() {
  const P = App.plan, M = P.M;
  let h = head('Day settings', esc(C.fmtDateUK(M.date) + (M.title ? ' · ' + M.title : '')));
  h += '<div class="row2"><div class="rl">Leave ' + esc(M.start.name) + (M.startTime !== M.baseStart ? '<small>Chat said ' + C.hhmm(M.baseStart) + '</small>' : '') + '</div><input class="in" type="time" data-set="startTime" value="' + C.hhmm(M.startTime) + '" aria-label="Start time"></div>';
  h += '<div class="row2"><div class="rl">' + (M.end ? 'Back at ' + esc(M.end.name) + ' by' : 'Day ends by') + (M.endBy % 1440 !== M.baseEnd % 1440 ? '<small>Chat said ' + C.hhmm(M.baseEnd) + '</small>' : '') + '</div><input class="in" type="time" data-set="endBy" value="' + C.hhmm(M.endBy) + '" aria-label="Back by"></div>';
  for (const m of M.mealList) {
    const on = App.state.meals[m.id] !== false && !m.outside;
    h += '<div class="row2"><div class="rl">' + esc(m.label) + ' break<small>' + (m.outside ? 'Outside today\'s hours' : C.fmtDur(m.duration) + ', starting ' + C.hhmm(m.from) + '–' + C.hhmm(m.to)) + '</small></div><button type="button" class="switch" role="switch" aria-checked="' + on + '" aria-label="' + esc(m.label) + ' break" data-act="meal" data-id="' + esc(m.id) + '"' + (m.outside ? ' disabled' : '') + '></button></div>';
  }
  h += '<div class="sh-sec"><span class="label">Public transport</span>' + segHtml('transit', M.transitKey, Object.values(C.TRANSIT).map((t) => [t.key, t.key === 'metro' ? 'Dense metro' : t.key === 'city' ? 'City tram/bus' : 'Sparse']));
  h += '<p class="fine">Dense metro: big-city rail every few minutes. City: trams and buses. Sparse: infrequent services — budget long waits.</p></div>';
  h += '<div class="sh-sec"><span class="label">Walking pace</span>' + segHtml('walkSpeed', M.walkKey, Object.keys(C.WALK_SPEED).map((k) => [k, C.WALK_LABEL[k]])) + '</div>';
  h += '<div class="sh-sec"><span class="label">Walk instead of riding up to</span>' + segHtml('maxWalk', M.maxWalk, [[10, '10 min'], [15, '15 min'], [20, '20 min'], [30, '30 min']]) + '</div>';
  h += '<div class="sh-sec"><span class="label">Arrive before booked times</span>' + segHtml('fixedBuffer', M.fixedBuffer, [[0, 'On time'], [5, '5 min'], [10, '10 min'], [15, '15 min']]) + '</div>';
  h += '<div class="sh-sec"><span class="label">How travel times work</span><p class="note">There\'s no live routing here, so times are estimated from straight-line distance: walking at your pace with detours, public transport with a typical wait and speed for the network type. They\'re marked ≈. Legs the chat has checked, or that you correct, show ✓ and always win. Check the important legs in Google Maps from the leg sheet.</p></div>';
  if (!C.stateIsEmpty(App.state)) h += '<div class="actions"><button type="button" class="btn" data-act="resetall">' + ic('undo') + (App.ui.confirmReset ? 'Tap again to reset everything' : 'Reset my changes for this day') + '</button></div>';
  return h;
}
function handbackSheet() {
  const P = App.plan, r = P.result, s = r.summary;
  let h = head('Hand back to the chat', esc(r.dayLabel + ' · ' + s.stops + ' stops · ' + s.start + '–' + s.finish));
  if (App.ui.handedMsg) {
    h += '<div class="done"><b>Handed back ' + esc(App.ui.handedMsg) + '.</b> In the chat, say “' + esc(r.dayLabel) + ' is ready” and it will pick up this plan.</div>';
    h += '<div class="actions"><button type="button" class="btn" data-act="copy">' + ic('copy') + 'Copy plan as text</button><button type="button" class="btn" data-act="close">Done</button></div>';
    if (App.ui.copyFallback) h += '<textarea class="in copybox" readonly>' + esc(App.ui.copyFallback) + '</textarea>';
    return h;
  }
  const warn = [];
  const est = s.estimatedLegs;
  if (est) warn.push(est + ' travel time' + (est > 1 ? 's are estimates' : ' is an estimate') + ' (≈)');
  for (const c of r.checks) warn.push(c.name + ': ' + c.text);
  for (const i of r.issues) warn.push(i.text);
  if (warn.length) h += '<div class="sh-sec"><span class="label">The chat will double-check</span><ul class="warnlist">' + warn.map((w) => '<li>' + ic('alert') + '<span>' + esc(w) + '</span></li>').join('') + '</ul></div>';
  h += '<div class="sh-sec"><label class="label" for="hbNote">Note for the chat (optional)</label><textarea class="in" id="hbNote" placeholder="e.g. Happy with this — keep lunch flexible">' + esc(App.ui.hbNote || '') + '</textarea></div>';
  h += '<div class="actions"><button type="button" class="btn primary" data-act="dohandback">' + ic('send') + 'Hand back</button><button type="button" class="btn" data-act="copy">' + ic('copy') + 'Copy as text</button></div>';
  if (App.ui.copyFallback) h += '<textarea class="in copybox" readonly>' + esc(App.ui.copyFallback) + '</textarea>';
  return h;
}

// ---------- actions ----------
function setPriority(id, v) {
  const M = App.plan.M, p = M.places[id];
  change((s) => {
    if (v === p.basePriority) delete s.priority[id]; else s.priority[id] = v;
    if (s.order && v !== 'skip' && v !== 'must' && !s.order.includes(id)) { /* stays out of a manual order until added */ }
  }, { announce: true, subject: id });
}
function addPlace(id) {
  const P = App.plan, M = P.M;
  if (P.manual) {
    const r = C.bestInsert(M, P.route, id).route;
    change((s) => { s.order = r; if (M.places[id].priority === 'skip') delete s.priority[id]; }, { announce: true, subject: id });
  } else change((s) => { s.priority[id] = 'must'; }, { announce: true, subject: id });
}
function moveStop(id, dir) {
  const r = App.plan.route.slice();
  const i = r.indexOf(id), j = i + dir;
  if (i < 0 || j < 0 || j >= r.length) return;
  [r[i], r[j]] = [r[j], r[i]];
  change((s) => { s.order = r; });
}
async function doHandback() {
  const P = App.plan;
  if (!App.db || App.readOnly || !P) return;
  const note = ($('#hbNote') && $('#hbNote').value.trim().slice(0, 1000)) || '';
  App.ui.hbNote = note;
  clearTimeout(App.saveTimer); App.saveTimer = null;
  if (!P.leftFinal) {
    P.left = C.explainLeftOut(P.M, P.route, { manual: P.manual, deep: true });
    P.leftFinal = true;
    P.result.leftOut = C.leftOutJson(P.M, P.left);
    P.result.text = C.planText(P.M, P.sim, P.left);
  }
  const at = new Date();
  const hb = { at: at.toISOString(), note, result: JSON.parse(JSON.stringify(P.result)), stateHash: stateHash(App.state) };
  const btn = $('[data-act="dohandback"]'); if (btn) { btn.disabled = true; btn.textContent = 'Handing back…'; }
  try {
    await Writer.put(planPath(), planBody(hb));
    App.ui.handedMsg = String(at.getHours()).padStart(2, '0') + ':' + String(at.getMinutes()).padStart(2, '0');
  } catch (e) { /* toast already shown */ }
  render();
}
async function copyText() {
  const text = App.plan ? App.plan.result.text : '';
  let ok = false;
  try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); ok = true; } } catch (e) { ok = false; }
  if (!ok) {
    try {
      const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); ta.remove();
    } catch (e) { ok = false; }
  }
  if (ok) { App.ui.copyFallback = null; toast('Copied'); }
  else { App.ui.copyFallback = text; renderSheet(); }
}

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-grip]')) return;
  const t = e.target.closest('[data-act]');
  if (!t || t.disabled) return;
  const act = t.dataset.act, id = t.dataset.id, v = t.dataset.v;
  if (t.tagName === 'A' && act === 'settings') e.preventDefault();
  if (act !== 'resetall') App.ui.confirmReset = false;
  switch (act) {
    case 'open': openPlace(id, true); break;
    case 'close': closeSheet(); break;
    case 'leg': openSheet({ type: 'leg', a: t.dataset.a, b: t.dataset.b }); break;
    case 'settings': openSheet({ type: 'settings' }); break;
    case 'handback': App.ui.handedMsg = null; App.ui.copyFallback = null; openSheet({ type: 'handback' }); break;
    case 'dohandback': doHandback(); break;
    case 'copy': copyText(); break;
    case 'mode': change((s) => { s.mode = v; }); break;
    case 'pace': if (v !== 'manual') change((s) => { s.pace = v; s.order = null; }); break;
    case 'replan': change((s) => { s.order = null; }, { announce: true }); break;
    case 'prio': setPriority(id, v); break;
    case 'dur': change((s) => { const p = App.plan.M.places[id]; const d = Math.max(15, Math.min(720, p.duration + Number(v))); if (d === p.baseDuration) delete s.duration[id]; else s.duration[id] = d; }, { announce: true, subject: id }); break;
    case 'left': {
      e.stopPropagation();
      const p = App.plan.M.places[id];
      if (v === 'restore') change((s) => { delete s.priority[id]; if (p.basePriority === 'skip') s.priority[id] = 'want'; }, { announce: true, subject: id });
      else addPlace(id);
      break;
    }
    case 'move': moveStop(id, Number(v)); break;
    case 'pick': change((s) => { s.legPick[t.dataset.a + '>' + t.dataset.b] = v; delete s.legPick[t.dataset.b + '>' + t.dataset.a]; }, { announce: true }); break;
    case 'legsave': {
      const val = Number(($('#legMin') || {}).value);
      if (!isFinite(val) || val < 0 || ($('#legMin') || {}).value === '') { toast('Enter the minutes first'); break; }
      change((s) => { s.legs[t.dataset.a + '>' + t.dataset.b + '|' + v] = { minutes: Math.round(val) }; s.legPick[t.dataset.a + '>' + t.dataset.b] = v; }, { announce: true });
      toast('Saved — this leg now uses ' + Math.round(val) + ' min');
      break;
    }
    case 'legreset': change((s) => {
      const a = t.dataset.a, b = t.dataset.b;
      for (const k of [a + '>' + b, b + '>' + a]) { delete s.legPick[k]; for (const lk of Object.keys(s.legs)) if (lk.startsWith(k + '|')) delete s.legs[lk]; }
    }, { announce: true }); break;
    case 'meal': change((s) => { if (s.meals[id] === false) delete s.meals[id]; else s.meals[id] = false; }, { announce: true }); break;
    case 'transit': case 'walkSpeed': case 'maxWalk': case 'fixedBuffer':
      change((s) => { s[act] = act === 'maxWalk' || act === 'fixedBuffer' ? Number(v) : v; }, { announce: true }); break;
    case 'resetall':
      if (!App.ui.confirmReset) { App.ui.confirmReset = true; renderSheet(); break; }
      App.ui.confirmReset = false;
      change((s) => { for (const k of Object.keys(s)) delete s[k]; });
      toast('Back to the chat\'s version of this day');
      break;
    case 'zoomin': MapV.zoom(1.6); break;
    case 'zoomout': MapV.zoom(1 / 1.6); break;
    case 'fit': MapV.needFit = true; MapV.render(); break;
    case 'mapsize': document.body.classList.toggle('map-big'); LS.set('mapBig', document.body.classList.contains('map-big')); renderMapCtl(); break;
    default: break;
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && App.ui.sheet) { closeSheet(); return; }
  const t = e.target.closest && e.target.closest('.leg[data-act]');
  if (t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); t.click(); }
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'daySel') { const [tid, did] = t.value.split('/'); if (tid && did) selectDay(tid, did); return; }
  if (t.dataset && t.dataset.set) {
    const key = t.dataset.set, val = t.value;
    if (!/^\d{1,2}:\d{2}$/.test(val)) return;
    change((s) => { const M = App.plan.M; const base = key === 'startTime' ? M.baseStart : M.baseEnd; if (C.parseTime(val) % 1440 === base % 1440) s[key] = null; else s[key] = val; }, { announce: true });
  }
});
function renderMapCtl() {
  const big = document.body.classList.contains('map-big');
  $('#mapCtl').innerHTML = '<button type="button" data-act="zoomin" aria-label="Zoom in">' + ic('plus') + '</button><button type="button" data-act="zoomout" aria-label="Zoom out">' + ic('minus') + '</button><button type="button" data-act="fit" aria-label="Show everything">' + ic('fit') + '</button>' +
    '<button type="button" data-act="mapsize" class="mapsize" aria-label="' + (big ? 'Smaller map' : 'Bigger map') + '">' + ic(big ? 'shrink' : 'expand') + '</button>';
}

// ---------- drag to reorder ----------
document.addEventListener('pointerdown', (e) => {
  const g = e.target.closest('[data-grip]');
  if (!g || !App.plan) return;
  e.preventDefault();
  const key = g.dataset.grip, list = $('#tl'), panel = $('#plan');
  const rows = [...list.querySelectorAll('li[data-key]')];
  const src = rows.find((r) => r.dataset.key === key);
  if (!src) return;
  g.setPointerCapture(e.pointerId);
  src.classList.add('dragging');
  const line = document.createElement('div'); line.className = 'drop-line'; list.style.position = 'relative'; list.appendChild(line);
  let target = null;
  const place = (y) => {
    let idx = rows.length;
    for (let i = 0; i < rows.length; i++) { const r = rows[i].getBoundingClientRect(); if (y < r.top + r.height / 2) { idx = i; break; } }
    target = idx;
    const lr = list.getBoundingClientRect();
    const ref = rows[idx];
    const yy = ref ? ref.getBoundingClientRect().top - lr.top - 2 : rows[rows.length - 1].getBoundingClientRect().bottom - lr.top;
    line.style.top = yy + 'px';
  };
  place(e.clientY);
  const move = (ev) => {
    const pr = panel.getBoundingClientRect();
    if (ev.clientY < pr.top + 36) panel.scrollTop -= 10; else if (ev.clientY > pr.bottom - 36) panel.scrollTop += 10;
    place(ev.clientY);
  };
  const up = () => {
    g.removeEventListener('pointermove', move); g.removeEventListener('pointerup', up); g.removeEventListener('pointercancel', up);
    line.remove(); src.classList.remove('dragging');
    const keys = rows.map((r) => r.dataset.key);
    const from = keys.indexOf(key);
    let to = target == null ? from : target;
    if (to > from) to--;
    if (to !== from) { keys.splice(from, 1); keys.splice(to, 0, key); change((s) => { s.order = keys; }); toast('Your order · Re-plan returns to the suggestion'); }
  };
  g.addEventListener('pointermove', move);
  g.addEventListener('pointerup', up);
  g.addEventListener('pointercancel', up);
});

// ---------- toast ----------
let toastTimer = 0;
function toast(msg, action, ms) {
  const el = $('#toast');
  el.innerHTML = '<span>' + esc(msg) + '</span>' + (action ? '<button type="button" id="toastBtn">' + esc(action.label) + '</button>' : '');
  el.classList.add('show');
  if (action) $('#toastBtn').onclick = () => { el.classList.remove('show'); action.fn(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms || 3800);
}

// ---------- boot ----------
function boot() {
  if (LS.get('mapBig', false)) document.body.classList.add('map-big');
  renderMapCtl();
  MapV.init();
  render();
  window.addEventListener('pagehide', flushSave);
  // If the store stays unreachable, stop waiting for definitive snapshots and use what arrived.
  setTimeout(() => {
    App.grace = true;
    if (!App.db) return;
    App.tripsLoaded = true; App.focusLoaded = true;
    for (const t of Object.keys(App.trips)) App.daysLoaded[t] = true;
    if (App.tripId) App.planLoaded = true;
    pickDay(); onDayData(); render();
  }, 3000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(); });
  initDb();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
