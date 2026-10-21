/* SPDX-License-Identifier: AGPL-3.0-or-later */
/* Day planner v2 — the street map: MapLibre GL JS over OpenFreeMap's Liberty tiles.
   Liberty is the only style: Positron shows no places to tap (service test, Fri 25 Sep 2026). */
(function (root) {
'use strict';

const C = root.DayPlannerCore;
const ROUTE = 'day-route';
const REAL = 'day-real';
// The line takes the page's own ink, so it stays legible when the theme changes.
const inkColour = () => {
  try { return getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#1c1917'; }
  catch (e) { return '#1c1917'; }
};
const STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const WORLD = { center: [8, 47], zoom: 3 };

function pin(cls, label, title, id) {
  const d = document.createElement('div');
  d.className = 'mk ' + cls;
  if (label) d.textContent = label;
  if (title) d.title = title;
  if (id) { d.dataset.place = id; d.setAttribute('role', 'button'); d.tabIndex = 0; }
  return d;
}

const MapView = {
  map: null,
  ready: false,
  failed: false,
  marks: [],
  shownAs: '',
  tap: null,
  pick: null,
  looking: null,

  // Returns false when MapLibre did not load; the rest of the planner carries on regardless.
  init(id, onReady) {
    const gl = root.maplibregl;
    if (!gl || !gl.Map) { this.failed = true; return false; }
    try {
      this.map = new gl.Map({ container: id, style: STYLE, center: WORLD.center, zoom: WORLD.zoom });
    } catch (e) {
      this.failed = true;
      return false;
    }
    try { this.map.addControl(new gl.NavigationControl({ showCompass: false }), 'top-right'); } catch (e) { /* optional */ }
    this.map.on('style.load', () => { this.ready = true; if (onReady) onReady(); });
    this.map.on('click', (e) => this.onClick(e));
    this.map.on('error', () => { /* a missing tile must never stop the planner */ });
    root.addEventListener('resize', () => { try { this.map.resize(); } catch (e) { /* not up yet */ } });
    return true;
  },

  // Move the map to a place and mark it while you are looking at it. Used when you pick a search
  // result: the point of finding somewhere is to see where it is.
  lookAt(place) {
    if (!this.ready || !this.map || !C.hasPos(place)) return;
    this.stopLooking();
    const gl = root.maplibregl;
    let zoom = 16;
    try { zoom = Math.max(this.map.getZoom() || 0, 16); } catch (e) { /* the default will do */ }
    this.map.easeTo({ center: [place.lng, place.lat], zoom: zoom, duration: 600 });
    try {
      this.looking = new gl.Marker({ element: pin('mk-looking', '', place.name), anchor: 'center' })
        .setLngLat([place.lng, place.lat]).addTo(this.map);
    } catch (e) { this.looking = null; }
  },
  stopLooking() {
    if (this.looking) { try { this.looking.remove(); } catch (e) { /* already gone */ } }
    this.looking = null;
  },

  // Tapping the map. A named point of interest becomes a place to look at; bare ground is left to
  // the caller, which is where dropping a pin comes in.
  onTap(fn) { this.tap = fn; },
  onPick(fn) { this.pick = fn; },
  onClick(e) {
    if (!this.tap) return;
    let feats = [];
    try { feats = this.map.queryRenderedFeatures(e.point) || []; } catch (err) { feats = []; }
    const at = { lat: e.lngLat.lat, lng: e.lngLat.lng };
    const best = C.bestFeature(feats);
    this.tap(best ? C.fromMapFeature(best, at) : null, at, feats.length);
  },

  // Where the map is looking, so search can favour places near it.
  centre() {
    if (!this.ready || !this.map) return null;
    try { const c = this.map.getCenter(); return { lat: c.lat, lng: c.lng }; } catch (e) { return null; }
  },

  // The day's thread, one hop at a time. A hop we have only guessed at is dashed and straight: that
  // is not the way you would walk or ride. A hop checked against a routing service is drawn solid,
  // along the path it really takes.
  drawRoute(hops) {
    if (!this.ready || !this.map) return;
    const shape = (real) => ({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'MultiLineString',
        coordinates: (hops || []).filter((h) => !!h.real === real)
          .map((h) => h.points.map((p) => [p.lng, p.lat])),
      },
    });
    const put = (src, real) => {
      if (!this.map.getSource(src)) {
        this.map.addSource(src, { type: 'geojson', data: shape(real) });
        this.map.addLayer({
          id: src + '-line', type: 'line', source: src,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: real
            ? { 'line-color': inkColour(), 'line-width': 3.5, 'line-opacity': 0.75 }
            : { 'line-color': inkColour(), 'line-width': 2.5, 'line-opacity': 0.55, 'line-dasharray': [1.6, 1.6] },
        });
      } else {
        this.map.getSource(src).setData(shape(real));
        this.map.setPaintProperty(src + '-line', 'line-color', inkColour());
      }
    };
    // The guesses go down first, so a real path sits on top of the straight line it replaces.
    try { put(ROUTE, false); put(REAL, true); } catch (e) { /* the map can carry on without the thread */ }
  },

  // One hop per pair on the thread: the real path of the way the leg is using, where that way was
  // checked and came back with a shape, and the straight line between the two where it did not.
  hopsAlong(trip, dayId, thread) {
    const hops = [];
    for (let i = 1; i < thread.length; i++) {
      const a = thread[i - 1], b = thread[i];
      const path = C.legPath(C.legBetween(trip, dayId, a.id, b.id));
      const real = path.length > 1;
      hops.push({ points: real ? path : [a.p, b.p], real });
    }
    return hops;
  },

  clear() {
    for (const m of this.marks) { try { m.remove(); } catch (e) { /* already gone */ } }
    this.marks = [];
  },

  // Numbered stops for the version on screen, hollow markers for the day's other ideas.
  show(trip, dayId, opts) {
    if (!this.ready || !this.map) return;
    this.clear();
    const day = trip && dayId ? trip.days[dayId] : null;
    if (!day) { this.shownAs = ''; this.drawRoute([]); return; }
    const gl = root.maplibregl;
    const pts = [];
    const put = (p, cls, label, title, fit) => {
      if (!C.hasPos(p)) return;
      const el = pin(cls, label, title, p.id);
      if (p.id) {
        const open = (e) => { e.stopPropagation(); if (this.pick) this.pick(p.id); };
        el.addEventListener('click', open);
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') open(e); });
      }
      const mk = new gl.Marker({ element: el, anchor: 'center' })
        .setLngLat([p.lng, p.lat]).addTo(this.map);
      this.marks.push(mk);
      if (fit !== false) pts.push(p);
    };
    const start = C.dayStart(trip, dayId), end = C.dayEnd(trip, dayId);
    const thread = [];
    if (C.hasPos(start)) { put(start, 'mk-anchor', '', start.name || 'Where the day starts'); thread.push({ p: start, id: 'start' }); }
    const stops = C.planPlaces(trip, dayId, day.shown);
    stops.forEach((p, i) => { put(p, 'mk-plan', String(i + 1), p.name); if (C.hasPos(p)) thread.push({ p, id: p.id }); });
    if (end && C.hasPos(end)) {
      if (!C.hasPos(start) || end.lat !== start.lat || end.lng !== start.lng) put(end, 'mk-anchor', '', end.name || 'Where the day ends');
      thread.push({ p: end, id: 'end' });
    }
    this.drawRoute(thread.length > 1 ? this.hopsAlong(trip, dayId, thread) : []);
    C.ideasFor(trip, dayId, day.shown).forEach((p) => put(p, 'mk-idea', '', p.name));
    // Backlog dots are there to spot an idea near today's route; they never pull the view about.
    const dots = !!(opts && opts.backlog);
    if (dots) C.backlogPlaces(trip).forEach((p) => put(p, 'mk-backlog', '', p.name + ' · backlog', false));

    // Only move the view when the day or its places change, so panning is never yanked back.
    const as = dayId + '|' + day.shown + '|' + this.marks.length + '|' + dots;
    if (as === this.shownAs) return;
    this.shownAs = as;
    if (pts.length) {
      const b = new gl.LngLatBounds();
      for (const p of pts) b.extend([p.lng, p.lat]);
      this.map.fitBounds(b, { padding: 70, maxZoom: 15, duration: 0 });
    } else if (day.centre) {
      this.map.easeTo({ center: [day.centre.lng, day.centre.lat], zoom: day.centre.zoom, duration: 0 });
    }
  },
};

root.DayPlannerMap = MapView;
})(window);
