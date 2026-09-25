/* SPDX-License-Identifier: AGPL-3.0-or-later */
/* Day planner v2 — the page. Everything that touches the DOM is here; the model is in core.js. */
(() => {
'use strict';
const C = window.DayPlannerCore;
const M = window.DayPlannerMap;
const Live = window.DayPlannerLive;
const $ = (s, el) => (el || document).querySelector(s);
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);

const ICON = {
  chev: '<path d="m6 9 6 6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  pin: '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  sliders: '<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/>',
  down: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>',
  up: '<path d="M12 21V9"/><path d="m7 14 5-5 5 5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>',
};
const ic = (n) => '<svg class="i" viewBox="0 0 24 24" aria-hidden="true">' + ICON[n] + '</svg>';

// ---------- state ----------
const App = {
  trip: null,            // the one trip this browser holds, already normalised
  ui: {
    dayId: null, sheet: null, backlogDots: true,
    find: { q: '', busy: false, results: null, error: '' },   // the search box
    pinning: false,                                           // the next tap drops a pin
  },   // what is on screen; never part of what gets exported
  savedAt: null,         // when the browser copy was last written
  fileAt: null,          // when this device last saved a file, as an ISO stamp
  undo: null,            // the trip the last import displaced, kept until it is used
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
  Store.write(KEY.ui, { dayId: App.ui.dayId, backlogDots: App.ui.backlogDots, fileAt: App.fileAt });
}
// The trip an import displaced, kept in the browser so it survives a reload.
function readUndo() {
  const env = Store.read(KEY.undo);
  if (!env) return null;
  const res = C.readBlock(JSON.stringify(env));
  return res.ok ? res : null;
}
function restore() {
  const ui = Store.read(KEY.ui);
  if (ui && ui.dayId) App.ui.dayId = ui.dayId;
  if (ui && ui.backlogDots === false) App.ui.backlogDots = false;
  if (ui && ui.fileAt) App.fileAt = ui.fileAt;
  const held = Store.read(KEY.trip);
  if (held == null) return;
  const res = C.readBlock(JSON.stringify(held));
  if (!res.ok) {
    App.storageProblem = 'The trip saved in this browser could not be opened. ' + res.message;
    return;
  }
  App.trip = res.trip;
  App.savedAt = null;
  App.undo = readUndo();
}
const two = (n) => String(n).padStart(2, '0');
const fmtClock = (d) => two(d.getHours()) + ':' + two(d.getMinutes());

// ---------- rendering ----------
function render() {
  renderHeader();
  renderPanel();
  renderSheet();
  renderSaved();
  M.show(App.trip, App.trip ? App.ui.dayId : null, { backlog: App.ui.backlogDots });
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
  $('#mapCtl').hidden = !t || M.failed;
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
    + '<div class="actions"><button type="button" class="btn primary" data-act="new-trip">' + ic('plus') + 'Start a trip</button>'
    + '<button type="button" class="btn" data-act="data">' + ic('up') + 'Bring one in</button></div>'
    + '</div>';
}
function tripHtml() {
  const day = currentDay();
  return findHtml() + (day ? dayHtml(day) + planHtml(day) + ideasHtml(day) : noDaysHtml()) + backlogHtml() + creditsHtml();
}

// ---------- finding a place ----------
function findHtml() {
  return '<div class="card find">'
    + '<div class="find-row">' + ic('search')
    + '<input class="in" id="findBox" type="search" autocomplete="off" aria-label="Search for a place"'
    + ' placeholder="Search for a place" value="' + esc(App.ui.find.q) + '">'
    + '</div><div id="findResults">' + findResultsHtml() + '</div></div>';
}
function findResultsHtml() {
  const f = App.ui.find;
  if (f.error) return '<p class="hint bad">' + esc(f.error) + '</p>';
  if (f.busy) return '<p class="hint">Looking…</p>';
  if (!f.results) return '';
  if (!f.results.length) return '<p class="hint">Nothing found. Try a different spelling, or the name as it is written locally.</p>';
  return '<ul class="list">' + f.results.map((p, i) =>
    '<li><button type="button" class="item" data-act="preview-found" data-i="' + i + '">'
    + '<span class="dot"></span><span class="body"><span class="nm">' + esc(p.name) + '</span>'
    + '<span class="meta">' + esc([C.KIND_LABEL[p.kind], p.where].filter(Boolean).join(' · ')) + '</span></span></button></li>').join('')
    + '</ul>';
}
function renderResults() {
  const el = $('#findResults');
  if (el) el.innerHTML = findResultsHtml();
}
let findSeq = 0;
let findTimer = 0;
function onFindInput(e) {
  App.ui.find.q = e.target.value;
  clearTimeout(findTimer);
  findTimer = setTimeout(runFind, 350);
}
function runFind() {
  const f = App.ui.find;
  const q = f.q.trim();
  const mine = ++findSeq;
  if (q.length < 2) { f.busy = false; f.results = null; f.error = ''; renderResults(); return; }
  f.busy = true; f.error = ''; renderResults();
  Live.fetchJson(C.photonUrl(q, M.centre())).then(
    (json) => {
      if (mine !== findSeq) return;                 // a later keystroke has overtaken this one
      f.busy = false;
      f.results = C.parsePhoton(json, new Date().toISOString());
      renderResults();
    },
    (err) => {
      if (mine !== findSeq) return;
      f.busy = false;
      f.results = null;
      f.error = 'Place search ' + Live.why(err) + '. The rest of the planner still works.';
      renderResults();
    });
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
  return '<div class="card day-card">'
    + '<div class="card-head"><span class="label">' + esc(C.fmtDateLongUK(day.id)) + (day.city ? ' · ' + esc(day.city) : '') + '</span>'
    + '<button type="button" class="icon-btn" data-act="day" aria-label="Day settings">' + ic('sliders') + '</button></div>'
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
function sectionHtml(label, count, body, extra) {
  return '<div class="card"><div class="card-head"><span class="label">' + esc(label)
    + ' <span class="count">' + count + '</span></span>' + (extra || '') + '</div>' + body + '</div>';
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
  const on = App.ui.backlogDots;
  const toggle = places.length
    ? '<button type="button" class="mini" data-act="backlog-dots" aria-pressed="' + on + '">'
      + (on ? 'On the map' : 'Off the map') + '</button>'
    : '';
  return sectionHtml('Backlog', places.length,
    listHtml(places, () => '<span class="dot"></span>',
      'The backlog is empty. It holds ideas that do not have a day yet.'), toggle);
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
function pendingHtml(p) {
  if (!p) return '';
  return '<div class="sh-sec"><span class="label">Before this loads</span>'
    + '<p class="note">' + esc(p.note.title) + '</p>'
    + '<ul class="reasons">' + p.note.lines.map((l) => '<li>' + esc(l) + '</li>').join('') + '</ul>'
    + '<div class="actions"><button type="button" class="btn primary" data-act="import-go">Load it</button>'
    + '<button type="button" class="btn" data-act="import-cancel">Cancel</button></div></div>';
}
function undoHtml() {
  if (!App.undo) return '';
  return '<div class="sh-sec"><span class="label">Undo</span>'
    + '<p class="note">The last thing you loaded replaced "' + esc(App.undo.title) + '" — ' + esc(App.undo.summary)
    + '. This puts it back, and drops what came in.</p>'
    + '<div class="actions"><button type="button" class="btn" data-act="undo-import">Undo the last import</button></div></div>';
}
function reportHtml(r) {
  if (!r) return '';
  return '<div class="sh-sec"><span class="label">' + (r.bad ? 'Not loaded' : 'Loaded') + '</span>'
    + '<p class="note ' + (r.bad ? 'bad' : 'good') + '">' + esc(r.title) + '</p>'
    + (r.lines.length ? '<ul class="reasons">' + r.lines.map((l) => '<li>' + esc(l) + '</li>').join('') + '</ul>' : '')
    + '</div>';
}
// The three ways in, or the one when there is no day yet.
function addButtonsHtml(act) {
  const day = currentDay();
  return '<div class="sh-sec"><span class="label">Add it</span>'
    + '<p class="note">' + esc(day
      ? 'To the plan you are looking at, to the day without putting it in a version, or to the backlog for later.'
      : 'There are no days yet, so it waits in the backlog until there is one.') + '</p>'
    + '<div class="actions">'
    + (day
      ? '<button type="button" class="btn primary" data-act="' + act + '" data-to="plan">Add to ' + esc(C.PLAN_LABEL[day.shown]) + '</button>'
        + '<button type="button" class="btn" data-act="' + act + '" data-to="day">Add to today</button>'
        + '<button type="button" class="btn" data-act="' + act + '" data-to="backlog">Add to the backlog</button>'
      : '<button type="button" class="btn primary" data-act="' + act + '" data-to="backlog">Add to the backlog</button>')
    + '</div></div>';
}
function lookupRowsHtml(list) {
  const rows = list.concat([{ label: '', url: '' }]).slice(0, 6);
  return rows.map((l, i) =>
    '<div class="pair lookup-row">'
    + '<input class="in" id="lkLabel' + i + '" maxlength="40" placeholder="Tabelog" value="' + esc(l.label) + '" aria-label="Link name">'
    + '<input class="in" id="lkUrl' + i + '" maxlength="300" placeholder="https://tabelog.com/rstLst/?sk={local}" value="' + esc(l.url) + '" aria-label="Link address">'
    + '</div>').join('');
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
  // Look before you add: nothing joins the trip until you choose. What the map already knows is
  // here at once; the rest fills in as it arrives.
  pin: (s) => sheetHead('Drop a pin', s.at.lat.toFixed(5) + ', ' + s.at.lng.toFixed(5))
    + (s.error ? '<p class="note bad">' + esc(s.error) + '</p>' : '')
    + '<p class="note">The map has nothing named here, so give this spot a name of your own.</p>'
    + field('pinName', 'Name', textIn('pinName', s.name || '', ' maxlength="120" placeholder="Meeting point"'))
    + field('pinKind', 'What is it?', '<select class="in" id="pinKind">' + C.KINDS.map((k) =>
      '<option value="' + k + '"' + (k === (s.pinKind || 'other') ? ' selected' : '') + '>' + esc(C.KIND_LABEL[k]) + '</option>').join('') + '</select>')
    + addButtonsHtml('add-pin'),

  preview: (s) => {
    const p = s.place;
    const day = currentDay();
    const where = [C.KIND_LABEL[p.kind], p.where || p.area].filter(Boolean).join(' · ');
    const near = day ? C.nearText(C.nearestInDay(App.trip, day.id, p, day.shown)) : '';
    return sheetHead(p.name, p.localName || '')
      + (where ? '<p class="note">' + esc(where) + '</p>' : '')
      + (near ? '<p class="note">' + esc(near) + '</p>' : '')
      + detailsHtml(s)
      + linksHtml(p, s.details)
      + gmapsHtml(p)
      + addButtonsHtml('add-place');
  },

  // A trip travels two ways with the same content: as a .json file, or as a block of text.
  data: (s) => {
    const t = App.trip;
    const when = App.fileAt ? new Date(App.fileAt) : null;
    return sheetHead('Trip file', t ? t.title + ' — ' + C.summarise(t) : 'Nothing to save yet')
      + pendingHtml(s.pending) + reportHtml(s.report) + undoHtml()
      + '<div class="sh-sec"><span class="label">Save to a file</span>'
      + '<p class="note">A file is a backup, the way to move this trip to another device, and what you upload to the chat.'
      + (when ? ' Last saved on this device ' + esc(C.fmtDateUK(isoOf(when)) + ' ' + fmtClock(when)) + '.' : '')
      + '</p>'
      + '<div class="actions"><button type="button" class="btn primary" data-act="save-file"' + (t ? '' : ' disabled') + '>'
      + ic('down') + 'Save to file</button></div></div>'
      + '<div class="sh-sec"><span class="label">Open a file</span>'
      + '<p class="note">A trip you saved before, or one the chat gave you as a file. It replaces what is in this browser, and you can undo it straight afterwards.</p>'
      + '<div class="actions"><button type="button" class="btn" data-act="open-file">' + ic('up') + 'Open a file</button></div></div>'
      + '<div class="sh-sec"><span class="label">As text</span>'
      + '<p class="note">The same trip, as a block to paste into the chat. It starts and ends with a fixed line, so the chat can find it whatever you paste it into.</p>'
      + '<div class="actions"><button type="button" class="btn" data-act="copy-text"' + (t ? '' : ' disabled') + '>Copy as text</button></div>'
      + (s.text ? '<textarea class="in copybox" id="outBox" readonly aria-label="The trip as text">' + esc(s.text) + '</textarea>' : '')
      + '</div>'
      + '<div class="sh-sec"><span class="label">Paste a block</span>'
      + '<p class="note">Paste what the chat gave you, from its first line to its last. Anything around it is ignored.</p>'
      + '<textarea class="in copybox" id="inBox" aria-label="A block to load" placeholder="--- BEGIN day-planner/2 ---">' + esc(s.paste || '') + '</textarea>'
      + '<div class="actions"><button type="button" class="btn" data-act="paste-in">Load the text</button></div></div>';
  },
  day: (s) => {
    const day = currentDay();
    const end = day.end;
    const timeIn = (id, v) => '<input class="in" type="time" id="' + id + '" value="' + esc(v || '') + '">';
    return sheetHead('Day settings', C.fmtDateLongUK(day.id))
      + (s.error ? '<p class="note bad">' + esc(s.error) + '</p>' : '')
      + '<div class="pair">'
      + field('edDate', 'Date', '<input class="in" type="date" id="edDate" value="' + esc(day.id) + '">')
      + field('edCity', 'City', textIn('edCity', day.city, ' maxlength="60"'))
      + '</div>'
      + '<div class="sh-sec"><span class="label">Setting off</span>'
      + '<div class="pair" style="margin-top:6px">'
      + field('edStartName', 'From', textIn('edStartName', day.start.name, ' maxlength="80" placeholder="Hotel"'))
      + field('edStartTime', 'At', timeIn('edStartTime', day.start.time))
      + '</div>'
      + '<p class="hint">Finding the hotel on the map, so its position is known, comes with place search at the next step.</p></div>'
      + '<div class="sh-sec"><span class="label">Back</span>'
      + '<div class="pair" style="margin-top:6px">'
      + field('edEndName', 'At', textIn('edEndName', end ? end.name : '', ' maxlength="80" placeholder="Where you started"'))
      + field('edEndTime', 'By', timeIn('edEndTime', end ? end.time : ''))
      + '</div>'
      + '<p class="hint">Leave the time empty for an open-ended day. An empty place means back where you started.</p></div>'
      + '<div class="sh-sec"><span class="label">Lunch</span>'
      + '<label class="tick" style="margin-top:8px"><input type="checkbox" id="edLunchOn"' + (day.lunch.on ? ' checked' : '') + '><span>Keep a lunch break</span></label>'
      + '<div class="pair">'
      + field('edLunchFrom', 'Between', timeIn('edLunchFrom', day.lunch.from))
      + field('edLunchTo', 'And', timeIn('edLunchTo', day.lunch.to))
      + field('edLunchFor', 'For', '<select class="in" id="edLunchFor">' + [30, 45, 60, 75, 90, 120].map((n) =>
        '<option value="' + n + '"' + (n === day.lunch.duration ? ' selected' : '') + '>' + esc(C.fmtDur(n)) + '</option>').join('') + '</select>')
      + '</div></div>'
      + field('edNote', 'Note', '<textarea class="in" id="edNote" maxlength="2000" placeholder="Anything about this day worth remembering">' + esc(day.note) + '</textarea>')
      + '<div class="actions"><button type="button" class="btn primary" data-act="save-day-shape">Save</button>'
      + '<button type="button" class="btn" data-act="close-sheet">Cancel</button></div>'
      + '<div class="sh-sec"><span class="label">Delete</span>'
      + '<p class="note">' + esc(dayPlacesNote(day)) + ' You can undo it straight afterwards.</p>'
      + '<button type="button" class="btn danger" data-act="delete-day">Delete this day</button></div>';
  },
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
      + '<div class="sh-sec"><span class="label">Your own look-up links</span>'
      + '<p class="note">Shown on every place you preview, so you can check it where you normally would. '
      + 'Put <code>{name}</code> or <code>{local}</code> where the place\'s name belongs.</p>'
      + lookupRowsHtml(t.lookups)
      + '</div>'
      + '<div class="actions"><button type="button" class="btn primary" data-act="save-trip">Save</button>'
      + '<button type="button" class="btn" data-act="close-sheet">Cancel</button></div>'
      + '<div class="sh-sec"><span class="label">Start again</span>'
      + '<p class="note">Clears this trip from the browser and starts an empty one. You can undo it straight afterwards.</p>'
      + '<button type="button" class="btn danger" data-act="clear-trip">Start a new trip</button></div>';
  },
};

function onMapTap(place, at, featureCount) {
  if (!App.trip) { toast('Start a trip first, then tap the map to add places to it.'); return; }
  if (App.ui.pinning) { setPinning(false); openPin(at); return; }
  if (place) { openPreview(place); return; }
  toast(featureCount ? 'Nothing named there. Tap right on a label or an icon.' : 'Nothing on the map there.',
    { label: 'Drop a pin here', fn: () => openPin(at) }, 9000);
}
function setPinning(on) {
  App.ui.pinning = !!on;
  const btn = $('#mapCtl button');
  if (btn) btn.setAttribute('aria-pressed', String(App.ui.pinning));
  $('#map').classList.toggle('pinning', App.ui.pinning);
  if (App.ui.pinning) toast('Tap the map where you want the pin.', null, 6000);
}
// A pin is a place the map does not know about: a meeting point, a shop with no label, a view.
function openPin(at) {
  openSheet('pin', { at: at });
}

function addPlaceTo(place, to) {
  const day = currentDay();
  const res = C.addPlace(App.trip, place, to === 'backlog' || !day ? null : day.id);
  if (to === 'plan' && day) C.addToPlan(App.trip, res.id, day.shown, C.bestSlot(App.trip, day.id, day.shown, res.id));
  closeSheet();
  changed(res.place.name + ' added to ' + (to === 'backlog' || !day ? 'the backlog'
    : to === 'plan' ? C.PLAN_LABEL[day.shown] : C.fmtDateUK(day.id)));
}

// A place found anywhere — search, the map, a dropped pin — is shown before it is added.
// The map's own information is on screen at once; OpenStreetMap fills in behind it, and the
// preview works perfectly well if that never arrives.
let previewSeq = 0;
function openPreview(place) {
  const mine = ++previewSeq;
  openSheet('preview', { place: place, details: null, detailsBusy: !!C.overpassUrl(place.osm), detailsError: '' });
  const url = C.overpassUrl(place.osm);
  if (!url) return;
  Live.fetchJson(url).then(
    (json) => {
      if (mine !== previewSeq || !App.ui.sheet) return;
      const got = C.parseOverpass(json);
      const s = App.ui.sheet;
      s.detailsBusy = false;
      if (!got) { s.detailsError = 'OpenStreetMap has nothing filed under this place.'; render(); return; }
      s.details = C.detailsFromTags(got.tags, place.osm);
      if (got.at) { place.lat = got.at.lat; place.lng = got.at.lng; }   // the finger lands near, not on
      if (s.details.hours) place.hours = s.details.hours.hours;
      render();
    },
    (err) => {
      if (mine !== previewSeq || !App.ui.sheet) return;
      App.ui.sheet.detailsBusy = false;
      App.ui.sheet.detailsError = 'OpenStreetMap ' + Live.why(err) + '. Everything else here still holds.';
      render();
    });
}

// What OpenStreetMap knows, once it has answered. Coverage varies: a well-known sight carries
// plenty, a small restaurant often nothing but a name.
function detailsHtml(s) {
  if (s.detailsBusy) return '<div class="sh-sec"><span class="label">OpenStreetMap</span><p class="note">Looking…</p></div>';
  if (s.detailsError) return '<div class="sh-sec"><span class="label">OpenStreetMap</span><p class="note">' + esc(s.detailsError) + '</p></div>';
  if (!s.details) return '';
  const d = s.details;
  const rows = [];
  const add = (k, v) => { if (v) rows.push([k, v]); };
  if (d.hours) {
    const line = C.hoursText(d.hours.hours);
    add('Hours', line || d.hours.hours.raw);
  }
  add('Cuisine', d.cuisine);
  add('Diet', d.diet.join(', '));
  add('Takeaway', d.takeaway === 'only' ? 'takeaway only' : d.takeaway === 'yes' ? 'yes' : '');
  add('Booking', d.reservation);
  add('Step-free', d.wheelchair);
  add('Entry', d.fee === 'yes' ? 'there is a charge' : d.fee === 'no' ? 'free' : '');
  add('Phone', d.phone);
  return '<div class="sh-sec"><span class="label">What OpenStreetMap knows</span>'
    + (d.hours
      ? '<p class="note amber">These hours are unverified — check them before you rely on them.</p>'
      : '<p class="note amber">Hours unknown — check.</p>')
    + (rows.length ? '<dl class="facts">' + rows.map(([k, v]) =>
      '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>').join('') + '</dl>' : '')
    + (d.hours && d.hours.partial ? '<p class="hint">Part of what it says could not be read: <code>' + esc(d.hours.hours.raw) + '</code></p>' : '')
    + (d.description ? '<p class="hint">' + esc(d.description) + '</p>' : '')
    + (!rows.length && !d.description ? '<p class="note">Nothing but a name, which is usual for small places.</p>' : '')
    + '</div>';
}
// Google Maps is where reviews, photos and today's real hours live. It opens beside the planner —
// a separate window on a laptop, the Maps app on a phone — and the preview stays put for when you
// come back. Nothing comes the other way: no Google result is ever stored or drawn on our map.
function gmapsHtml(place) {
  const day = currentDay();
  return '<div class="sh-sec"><span class="label">Check it on Google Maps</span>'
    + '<p class="note">For reviews, photos and the hours as they are today. It opens in a window beside this one.</p>'
    + '<div class="actions"><button type="button" class="btn" data-act="gmaps">Check on Google Maps</button></div>'
    + '<p class="hint">Nothing comes back from Google into the planner.</p></div>';
}
function linksHtml(place, details) {
  const out = [];
  for (const l of (details ? details.links : [])) out.push([l.url, l.label]);
  for (const l of App.trip.lookups) out.push([C.lookupUrl(l, place), l.label]);
  if (!out.length) return '';
  return '<div class="sh-sec"><span class="label">Look it up</span><p class="links">'
    + out.map(([url, label]) => '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + '</a>').join(' · ')
    + '</p></div>';
}

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

function dayPlacesNote(day) {
  const n = C.dayPlaces(App.trip, day.id).length;
  return n
    ? 'Deleting this day sends its ' + n + ' place' + (n > 1 ? 's' : '') + ' back to the backlog.'
    : 'Deleting this day takes it off the trip.';
}

// ---------- files and text ----------
const isoOf = (d) => d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Everything that comes in — file or pasted text — goes through here. Reading a file takes a
// moment, so the sheet may have been closed by the time it arrives; it comes back for the answer.
function dataSheet() {
  if (!App.ui.sheet || App.ui.sheet.kind !== 'data') openSheet('data');
  return App.ui.sheet;
}
function takeIn(text) {
  const s = dataSheet();
  const res = C.readBlock(text);
  const note = C.importNote(res, App.trip);
  s.pending = null;
  if (!res.ok) { s.report = { bad: true, title: res.message, lines: [] }; render(); return; }
  if (note.confirm) { s.report = null; s.pending = { res: res, note: note }; render(); return; }
  applyImport(res);
}
function applyImport(res) {
  const s = dataSheet();
  if (App.trip) {
    Store.write(KEY.undo, C.envelope(App.trip, 'save'));
    App.undo = readUndo();
  }
  App.trip = res.trip;
  App.ui.dayId = null;
  App.storageProblem = null;
  s.pending = null;
  s.paste = '';
  s.text = '';
  s.report = { bad: false, title: res.title + ' — ' + res.summary, lines: res.issues };
  saveUi();
  changed();
  if (App.undo) toast('Loaded ' + res.summary + ' from ' + res.title, { label: 'Undo', fn: undoImport }, 9000);
  else toast('Loaded ' + res.summary + ' from ' + res.title);
}
function undoImport() {
  const back = App.undo;
  if (!back) return;
  Store.drop(KEY.undo);
  App.undo = null;
  App.trip = back.trip;
  App.ui.dayId = null;
  if (App.ui.sheet) { App.ui.sheet.report = null; App.ui.sheet.pending = null; }
  saveUi();
  changed();
  toast('Back to ' + back.title + ' — ' + back.summary);
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
    const lookups = [];
    for (let i = 0; i < 6; i++) {
      const url = val('lkUrl' + i);
      if (url) lookups.push({ label: val('lkLabel' + i), url: url });
    }
    App.trip.lookups = lookups;
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
  day: () => { if (currentDay()) openSheet('day'); },
  'save-day-shape': () => {
    let day = currentDay();
    if (!day) return;
    const wanted = val('edDate');
    if (wanted && wanted !== day.id) {
      const moved = C.setDayDate(App.trip, day.id, wanted);
      if (!moved.ok) { App.ui.sheet.error = moved.text; render(); return; }
      App.ui.dayId = moved.id;
      day = currentDay();
    }
    day.city = val('edCity');
    const startName = val('edStartName');
    if (startName !== day.start.name) { day.start.lat = null; day.start.lng = null; }
    day.start.name = startName;
    day.start.time = val('edStartTime') || day.start.time;
    const backBy = val('edEndTime');
    if (!backBy) day.end = null;
    else {
      const endName = val('edEndName');
      const kept = day.end && day.end.name === endName ? day.end : { lat: null, lng: null };
      day.end = { name: endName, lat: kept.lat, lng: kept.lng, time: backBy };
    }
    day.lunch = {
      on: $('#edLunchOn').checked,
      from: val('edLunchFrom') || day.lunch.from,
      to: val('edLunchTo') || day.lunch.to,
      duration: +val('edLunchFor'),
    };
    day.note = val('edNote');
    App.trip = C.normalise(App.trip).trip;
    saveUi();
    closeSheet();
    changed('Day saved');
  },
  'delete-day': () => {
    const day = currentDay();
    if (!day) return;
    const before = C.clone(App.trip);
    const wasId = day.id;
    const res = C.deleteDay(App.trip, day.id);
    App.ui.dayId = null;
    saveUi();
    closeSheet();
    changed();
    toast(res.text, { label: 'Undo', fn: () => {
      App.trip = before;
      App.ui.dayId = wasId;
      saveUi();
      changed('Day brought back');
    } }, 9000);
  },
  'preview-found': (el) => {
    const found = (App.ui.find.results || [])[+el.dataset.i];
    if (found) openPreview(found);
  },
  'add-place': (el) => { if (App.ui.sheet && App.ui.sheet.place) addPlaceTo(App.ui.sheet.place, el.dataset.to); },
  'pin-mode': () => setPinning(!App.ui.pinning),
  gmaps: () => {
    const s = App.ui.sheet;
    if (!s || !s.place) return;
    const day = currentDay();
    const url = C.gmapsUrl(s.place, day ? day.city : '');
    // A named window with a size asks for a separate window rather than a tab, which is what the
    // service test saw. A phone ignores the hint and opens the Maps app.
    const win = window.open(url, 'day-planner-gmaps', 'popup=yes,width=560,height=900,noopener');
    if (!win) toast('Your browser blocked the window. Allow pop-ups for this page, or open the link yourself.', null, 8000);
  },
  'add-pin': (el) => {
    const s = App.ui.sheet;
    const name = val('pinName');
    if (!name) { s.error = 'Give the pin a name first.'; s.name = ''; render(); $('#pinName').focus(); return; }
    addPlaceTo({
      name: name, kind: val('pinKind'), lat: s.at.lat, lng: s.at.lng,
      added: { by: 'you', how: 'pin', at: null },
    }, el.dataset.to);
  },
  'backlog-dots': () => {
    App.ui.backlogDots = !App.ui.backlogDots;
    saveUi();
    render();
  },
  data: () => openSheet('data'),
  'save-file': () => {
    if (!App.trip) return;
    saveNow();
    const now = new Date();
    download(C.fileName(App.trip, now), C.writeJson(App.trip, 'save', now.toISOString()));
    App.fileAt = now.toISOString();
    saveUi();
    render();
    toast('Saved ' + C.fileName(App.trip, now));
  },
  'open-file': () => $('#fileIn').click(),
  'undo-import': undoImport,
  'paste-in': () => {
    App.ui.sheet.paste = $('#inBox') ? $('#inBox').value : '';
    takeIn(App.ui.sheet.paste);
  },
  'copy-text': () => {
    if (!App.trip) return;
    saveNow();
    const block = C.writeBlock(App.trip, 'save');
    App.ui.sheet.text = block;
    render();
    const box = $('#outBox');
    if (box) { box.focus(); box.select(); }
    const byHand = () => toast('Select the text below and copy it yourself.');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(block).then(() => toast('Copied — ' + C.sizeText(block)), byHand);
    } else byHand();
  },
  'import-go': () => { if (App.ui.sheet.pending) applyImport(App.ui.sheet.pending.res); },
  'import-cancel': () => { App.ui.sheet.pending = null; render(); },
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
  M.onTap(onMapTap);
  if (!M.init('map', render)) {
    $('#mapEmpty').hidden = false;
    $('#mapEmpty').textContent = 'The street map could not be loaded. Everything else still works.';
  }
  document.addEventListener('click', onClick);
  document.addEventListener('input', (e) => { if (e.target.id === 'findBox') onFindInput(e); });
  $('#daySel').addEventListener('change', (e) => { App.ui.dayId = e.target.value; saveUi(); render(); });
  $('#fileIn').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    dataSheet();
    file.text().then(takeIn, () => {
      dataSheet().report = { bad: true, title: 'That file could not be read.', lines: [] };
      render();
    });
  });
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
