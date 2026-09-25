/* SPDX-License-Identifier: AGPL-3.0-or-later */
/* Day planner v2 — the street map: MapLibre GL JS over OpenFreeMap's Liberty tiles.
   Liberty is the only style: Positron shows no places to tap (service test, Fri 25 Sep 2026). */
(function (root) {
'use strict';

const STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const WORLD = { center: [8, 47], zoom: 3 };

const MapView = {
  map: null,
  ready: false,
  failed: false,

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
    this.map.on('error', () => { /* a missing tile must never stop the planner */ });
    root.addEventListener('resize', () => { try { this.map.resize(); } catch (e) { /* not up yet */ } });
    return true;
  },
};

root.DayPlannerMap = MapView;
})(window);
