/* SPDX-License-Identifier: AGPL-3.0-or-later */
/* Day planner v2 — the page. Everything that touches the DOM is here; the model is in core.js. */
(() => {
'use strict';
const C = window.DayPlannerCore;
const $ = (s, el) => (el || document).querySelector(s);
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);

const ICON = {
  chev: '<path d="m6 9 6 6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
};
const ic = (n) => '<svg class="i" viewBox="0 0 24 24" aria-hidden="true">' + ICON[n] + '</svg>';

// ---------- state ----------
const App = {
  trip: null,            // the one trip this browser holds, already normalised
  ui: { dayId: null, sheet: null },   // what is on screen; never part of what gets exported
  savedAt: null,         // when the browser copy was last written
  storageProblem: null,  // why the browser copy could not be used, in plain words
};

// ---------- browser storage ----------
// Keys are namespaced: every GitHub Pages project of this account shares one origin, so a bare
// key would collide with another project's.
const KEY = { trip: 'plan-my-trip/trip', undo: 'plan-my-trip/undo', ui: 'plan-my-trip/ui' };
const Store = {
  read(key) {
    try { const v = localStorage.getItem(key); return v == null ? null : JSON.parse(v); } catch (e) { return null; }
  },
  write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  },
  drop(key) { try { localStorage.removeItem(key); } catch (e) { /* nothing to do */ } },
};
let saveTimer = 0;
// Every change to the trip goes through here: it saves a moment later, and redraws now.
function changed(msg) {
  if (!App.trip) return;
  C.touch(App.trip);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 700);
  render();
  if (msg) toast(msg);
}
function save() {
  clearTimeout(saveTimer);
  saveTimer = 0;
  if (!App.trip) return;
  const ok = Store.write(KEY.trip, C.envelope(App.trip, 'save'));
  App.savedAt = ok ? new Date() : null;
  if (!ok) toast('This browser would not store the trip. Save it to a file now, before you lose it.', null, 9000);
  renderSaved();
}
function saveNow() { if (saveTimer) save(); }
function saveUi() {
  Store.write(KEY.ui, { dayId: App.ui.dayId });
}
function restore() {
  const ui = Store.read(KEY.ui);
  if (ui && ui.dayId) App.ui.dayId = ui.dayId;
  const held = Store.read(KEY.trip);
  if (held == null) return;
  const res = C.readBlock(JSON.stringify(held));
  if (!res.ok) {
    App.storageProblem = 'The trip saved in this browser could not be opened. ' + res.message;
    return;
  }
  App.trip = res.trip;
  App.savedAt = null;
}
const two = (n) => String(n).padStart(2, '0');
const fmtClock = (d) => two(d.getHours()) + ':' + two(d.getMinutes());

// ---------- rendering ----------
function render() {
  renderHeader();
  renderPanel();
  renderSheet();
  renderSaved();
}
function renderSaved() {
  const el = $('#saved');
  if (!App.trip) el.textContent = '';
  else if (saveTimer) el.textContent = 'Saving…';
  else if (App.savedAt) el.textContent = 'Saved ' + fmtClock(App.savedAt);
  else el.textContent = 'Saved in this browser';
}
function currentDay() {
  if (!App.trip) return null;
  const ids = C.dayIds(App.trip);
  if (!ids.length) return null;
  if (!ids.includes(App.ui.dayId)) App.ui.dayId = ids[0];
  return App.trip.days[App.ui.dayId];
}
function renderHeader() {
  const t = App.trip;
  $('#tripBtn .name').textContent = t ? t.title : 'Day planner';
  const ids = t ? C.dayIds(t) : [];
  $('#addDayBtn').hidden = !t;
  const pick = $('#dayPick');
  pick.hidden = !ids.length;
  if (!ids.length) return;
  const day = currentDay();
  $('#daySel').innerHTML = ids.map((id) =>
    '<option value="' + esc(id) + '"' + (id === day.id ? ' selected' : '') + '>' + esc(C.fmtDateUK(id)) + (App.trip.days[id].city ? ' · ' + esc(App.trip.days[id].city) : '') + '</option>').join('');
  $('#dayFace').textContent = C.fmtDateUK(day.id) + (day.city ? ' · ' + day.city : '');
}
function renderPanel() {
  $('#panel').innerHTML = App.trip ? tripHtml() : emptyHtml();
}
function emptyHtml() {
  return '<div class="empty">'
    + (App.storageProblem ? '<p class="note bad">' + esc(App.storageProblem) + '</p>' : '')
    + '<h2>No trip yet</h2>'
    + '<p>A trip holds a backlog of ideas and the days you are planning. Start one here, then add its days.</p>'
    + '<div class="actions"><button type="button" class="btn primary" data-act="new-trip">' + ic('plus') + 'Start a trip</button></div>'
    + '</div>';
}
function tripHtml() {
  const day = currentDay();
  return (day ? dayHtml(day) + planHtml(day) + ideasHtml(day) : noDaysHtml()) + backlogHtml() + creditsHtml();
}
function noDaysHtml() {
  return '<div class="card"><span class="label">Days</span>'
    + '<p class="hint">No days yet. A day carries its date, its city, where you set off from and when you want to be back.</p>'
    + '<div class="actions"><button type="button" class="btn primary" data-act="add-day">' + ic('plus') + 'Add a day</button></div>'
    + '</div>';
}
function dayHtml(day) {
  const end = day.end;
  const endName = end ? (end.name || day.start.name) : '';
  return '<div class="card">'
    + '<div class="card-head"><span class="label">' + esc(C.fmtDateLongUK(day.id)) + (day.city ? ' · ' + esc(day.city) : '') + '</span></div>'
    + '<div class="day-line"><span class="t">' + esc(day.start.time) + '</span>'
    + (day.start.name ? '<span>Leave ' + esc(day.start.name) + '</span>' : '<span class="muted">Where you set off from is not set yet</span>') + '</div>'
    + (end
      ? '<div class="day-line"><span class="t">' + esc(end.time) + '</span><span' + (endName ? '>Back at ' + esc(endName) : ' class="muted">Back where you started') + '</span></div>'
      : '<div class="day-line"><span class="t">—</span><span class="muted">Open-ended day</span></div>')
    + (day.lunch.on
      ? '<div class="day-line"><span class="t">Lunch</span><span class="muted">' + esc(C.fmtDur(day.lunch.duration)) + ', between ' + esc(day.lunch.from) + ' and ' + esc(day.lunch.to) + '</span></div>'
      : '')
    + (day.note ? '<p class="hint">' + esc(day.note) + '</p>' : '')
    + versionsHtml(day)
    + '</div>';
}
// The version on screen. The three are yours: the planner never moves a place between them.
function versionsHtml(day) {
  return '<div class="seg" role="group" aria-label="Which version of this day" style="margin-top:10px">'
    + C.PLAN_KEYS.map((k) =>
      '<button type="button" data-act="version" data-v="' + k + '" aria-pressed="' + (k === day.shown) + '">'
      + esc(C.PLAN_LABEL[k]) + ' <span class="count">' + day.plans[k].length + '</span></button>').join('')
    + '</div>';
}

// ---------- lists of places ----------
function chipsHtml(p) {
  let h = '';
  if (p.priority === 'must') h += '<span class="chip must">Must-do</span>';
  else if (p.priority) h += '<span class="chip flex">' + esc(C.PRIORITY_LABEL[p.priority]) + '</span>';
  if (p.booked) h += '<span class="chip booked">Booked</span>';
  if (p.check) h += '<span class="chip check">Check</span>';
  if (p.meal) h += '<span class="chip flex">Lunch option</span>';
  return h;
}
function itemHtml(p, lead) {
  const meta = [C.KIND_LABEL[p.kind], C.fmtDur(p.duration), p.area].filter(Boolean).join(' · ');
  return '<li><div class="item" data-place="' + esc(p.id) + '">' + lead
    + '<span class="body"><span class="nm">' + esc(p.name) + chipsHtml(p) + '</span>'
    + '<span class="meta">' + esc(meta) + (p.localName ? ' <span class="sep">·</span> ' + esc(p.localName) : '') + '</span></span></div></li>';
}
function listHtml(places, lead, empty) {
  if (!places.length) return '<p class="empty-line">' + esc(empty) + '</p>';
  return '<ul class="list">' + places.map((p, i) => itemHtml(p, lead(i))).join('') + '</ul>';
}
function sectionHtml(label, count, body) {
  return '<div class="card"><div class="card-head"><span class="label">' + esc(label)
    + ' <span class="count">' + count + '</span></span></div>' + body + '</div>';
}
function planHtml(day) {
  const places = C.planPlaces(App.trip, day.id, day.shown);
  return sectionHtml('Plan · ' + C.PLAN_LABEL[day.shown], places.length,
    listHtml(places, (i) => '<span class="num">' + (i + 1) + '</span>',
      'Nothing in ' + C.PLAN_LABEL[day.shown] + ' yet. Places you add to this version show up here, in order.'));
}
function ideasHtml(day) {
  const places = C.ideasFor(App.trip, day.id, day.shown);
  return sectionHtml('Ideas for today', places.length,
    listHtml(places, () => '<span class="dot"></span>',
      'Nothing else on this day. Ideas sit here until you put them in a version.'));
}
function backlogHtml() {
  const places = C.backlogPlaces(App.trip);
  return sectionHtml('Backlog', places.length,
    listHtml(places, () => '<span class="dot"></span>',
      'The backlog is empty. It holds ideas that do not have a day yet.'));
}
function creditsHtml() {
  return '<p class="credits">'
    + 'Map: <a href="https://openfreemap.org/" target="_blank" rel="noopener noreferrer">OpenFreeMap</a>'
    + ' · <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener noreferrer">© OpenMapTiles</a>'
    + ' · Data <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a><br>'
    + 'Planner by <a href="https://github.com/tigerasks" target="_blank" rel="noopener noreferrer">tigerasks</a>'
    + ' · <a href="https://github.com/tigerasks/plan-my-trip" target="_blank" rel="noopener noreferrer">source code</a> (AGPL-3.0)'
    + '</p>';
}

// ---------- sheets ----------
// One panel at a time, sliding in from the right on a laptop and up from the bottom on a phone.
function openSheet(kind, data) {
  App.ui.sheet = Object.assign({ kind: kind }, data);
  render();
  const first = $('#sheet .in');
  if (first) { first.focus(); if (first.select) first.select(); }
}
function closeSheet() {
  if (!App.ui.sheet) return;
  App.ui.sheet = null;
  render();
}
function renderSheet() {
  const el = $('#sheet');
  const s = App.ui.sheet;
  const build = s && SHEETS[s.kind];
  el.innerHTML = build ? build(s) : '';
  el.classList.toggle('open', !!build);
  el.setAttribute('aria-hidden', build ? 'false' : 'true');
}
const sheetHead = (title, sub) =>
  '<div class="sh-head"><div class="sh-title">' + esc(title) + (sub ? '<div class="sh-sub">' + esc(sub) + '</div>' : '') + '</div>'
  + '<button type="button" class="icon-btn" data-act="close-sheet" aria-label="Close">' + ic('x') + '</button></div>';
const field = (id, label, html, hint) =>
  '<label class="field" for="' + id + '"><span class="label">' + esc(label) + '</span>' + html
  + (hint ? '<span class="hint">' + esc(hint) + '</span>' : '') + '</label>';
const textIn = (id, value, extra) => '<input class="in" id="' + id + '" value="' + esc(value) + '"' + (extra || '') + '>';
const val = (id) => { const el = $('#' + id); return el ? el.value.trim() : ''; };

const SHEETS = {
  'add-day': (s) => sheetHead('Add a day')
    + (s.error ? '<p class="note bad">' + esc(s.error) + '</p>' : '')
    + field('dyDate', 'Date', '<input class="in" type="date" id="dyDate" value="' + esc(s.date) + '">', 'One day per date.')
    + field('dyCity', 'City', textIn('dyCity', s.city, ' maxlength="60" placeholder="Kyoto"'), 'Where the day happens. It steers the map and place search later.')
    + '<div class="actions"><button type="button" class="btn primary" data-act="save-day">Add</button>'
    + '<button type="button" class="btn" data-act="close-sheet">Cancel</button></div>',
  trip: () => {
    const t = App.trip;
    const s = App.ui.sheet;
    return sheetHead('Trip settings', t.title)
      + (s.error ? '<p class="note bad">' + esc(s.error) + '</p>' : '')
      + field('trTitle', 'Title', textIn('trTitle', t.title, ' maxlength="80"'), 'Shown at the top, and in what you hand back to the chat.')
      + field('trTz', 'Time zone label', textIn('trTz', t.tzLabel, ' maxlength="12" placeholder="JST"'), 'Just a label next to the times. Every time in the planner is local to where you are going.')
      + field('trTransit', 'Getting around, by default',
        '<select class="in" id="trTransit">' + C.TRANSIT_TYPES.map((k) =>
          '<option value="' + k + '"' + (k === t.transit ? ' selected' : '') + '>' + esc(C.TRANSIT_LABEL[k]) + '</option>').join('') + '</select>',
        'Used for travel estimates until real routes arrive.')
      + field('trCur', 'Preferred currency', textIn('trCur', t.currency || '', ' maxlength="3" placeholder="none"'),
        'Prices always show in their own currency. Name one here and a conversion appears beside them.')
      + '<div class="actions"><button type="button" class="btn primary" data-act="save-trip">Save</button>'
      + '<button type="button" class="btn" data-act="close-sheet">Cancel</button></div>'
      + '<div class="sh-sec"><span class="label">Start again</span>'
      + '<p class="note">Clears this trip from the browser and starts an empty one. You can undo it straight afterwards.</p>'
      + '<button type="button" class="btn danger" data-act="clear-trip">Start a new trip</button></div>';
  },
};

// ---------- toast ----------
let toastTimer = 0;
function toast(msg, action, ms) {
  const el = $('#toast');
  el.innerHTML = '<span>' + esc(msg) + '</span>' + (action ? '<button type="button" id="toastBtn">' + esc(action.label) + '</button>' : '');
  el.classList.add('show');
  if (action) $('#toastBtn').onclick = () => { el.classList.remove('show'); action.fn(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms || 4200);
}

// ---------- actions ----------
const isoToday = () => { const d = new Date(); return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()); };
// The day after the last one, since trips are usually planned forwards.
function suggestDay() {
  const ids = C.dayIds(App.trip);
  if (!ids.length) return { date: isoToday(), city: '' };
  const last = ids[ids.length - 1];
  const d = new Date(last + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return { date: d.toISOString().slice(0, 10), city: App.trip.days[last].city };
}
const ACTIONS = {
  trip: () => { if (App.trip) openSheet('trip'); },
  'close-sheet': closeSheet,
  'save-trip': () => {
    const cur = val('trCur').toUpperCase();
    if (cur && !/^[A-Z]{3}$/.test(cur)) {
      App.ui.sheet.error = 'A currency is three letters, like CHF or JPY. Leave it empty to show every price as it is.';
      render();
      return;
    }
    App.trip.title = val('trTitle') || App.trip.title;
    App.trip.tzLabel = val('trTz');
    App.trip.transit = val('trTransit');
    App.trip.currency = cur || null;
    App.trip = C.normalise(App.trip).trip;
    closeSheet();
    changed('Trip settings saved');
  },
  'clear-trip': () => {
    const before = C.clone(App.trip);
    App.trip = C.newTrip('My trip');
    App.ui.dayId = null;
    closeSheet();
    changed();
    toast('Started again from nothing.', { label: 'Undo', fn: () => { App.trip = before; changed('Trip brought back'); } }, 9000);
  },
  'add-day': () => { if (App.trip) openSheet('add-day', suggestDay()); },
  'save-day': () => {
    const res = C.addDay(App.trip, val('dyDate'), val('dyCity'));
    if (!res.ok) { App.ui.sheet.error = res.text; App.ui.sheet.date = val('dyDate'); App.ui.sheet.city = val('dyCity'); render(); return; }
    App.ui.dayId = res.id;
    saveUi();
    closeSheet();
    changed(res.text);
  },
  version: (el) => {
    const day = currentDay();
    if (!day || day.shown === el.dataset.v) return;
    day.shown = el.dataset.v;
    changed();
  },
  'new-trip': () => {
    App.trip = C.newTrip('My trip');
    App.ui.dayId = null;
    App.storageProblem = null;
    changed('Trip started. Add its days next.');
  },
};
function onClick(e) {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = ACTIONS[el.dataset.act];
  if (!fn) return;
  e.preventDefault();
  fn(el);
}

// ---------- boot ----------
function boot() {
  document.addEventListener('click', onClick);
  $('#daySel').addEventListener('change', (e) => { App.ui.dayId = e.target.value; saveUi(); render(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
  window.addEventListener('pagehide', saveNow);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow(); });
  restore();
  render();
  window.DayPlannerApp = App;   // the tests look in here
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
})();
