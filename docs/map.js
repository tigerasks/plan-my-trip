/* SPDX-License-Identifier: AGPL-3.0-or-later */
/* Day planner v2 — the street map: MapLibre GL JS over OpenFreeMap's Liberty tiles.
   Liberty is the only style: Positron shows no places to tap (service test, Fri 25 Sep 2026). */
(function (root) {
'use strict';

const C = root.DayPlannerCore;
const STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const WORLD = { center: [8, 47], zoom: 3 };

function pin(cls, label, title) {
  const d = document.createElement('div');
  d.className = 'mk ' + cls;
  if (label) d.textContent = label;
  if (title) d.title = title;
  return d;
}

const MapView = {
  map: null,
  ready: false,
  failed: false,
  marks: [],
  shownAs: '',
  tap: null,

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

  // Tapping the map. A named point of interest becomes a place to look at; bare ground is left to
  // the caller, which is where dropping a pin comes in.
  onTap(fn) { this.tap = fn; },
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

  clear() {
    for (const m of this.marks) { try { m.remove(); } catch (e) { /* already gone */ } }
    this.marks = [];
  },

  // Numbered stops for the version on screen, hollow markers for the day's other ideas.
  show(trip, dayId, opts) {
    if (!this.ready || !this.map) return;
    this.clear();
    const day = trip && dayId ? trip.days[dayId] : null;
    if (!day) { this.shownAs = ''; return; }
    const gl = root.maplibregl;
    const pts = [];
    const put = (p, cls, label, title, fit) => {
      if (!C.hasPos(p)) return;
      const mk = new gl.Marker({ element: pin(cls, label, title), anchor: 'center' })
        .setLngLat([p.lng, p.lat]).addTo(this.map);
      this.marks.push(mk);
      if (fit !== false) pts.push(p);
    };
    put(day.start, 'mk-anchor', '', day.start.name || 'Where the day starts');
    if (day.end && (day.end.lat != null)) put(day.end, 'mk-anchor', '', day.end.name || 'Where the day ends');
    C.planPlaces(trip, dayId, day.shown).forEach((p, i) => put(p, 'mk-plan', String(i + 1), p.name));
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
