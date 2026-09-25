/* SPDX-License-Identifier: AGPL-3.0-or-later */
/* Stand-in for MapLibre GL JS, so the tests never reach the network.
   Shared by every Playwright test; extend it here when the app uses more of the library. */
const lngLat = (x) => (Array.isArray(x) ? { lng: x[0], lat: x[1] } : x);
window.maplibregl = { version: 'stub',
  NavigationControl: function () {},
  AttributionControl: function () {},
  LngLatBounds: function () {
    this.points = [];
    this.extend = (x) => { this.points.push(lngLat(x)); return this; };
    this.isEmpty = () => this.points.length === 0;
  },
  // Markers really go into the container, so a test can count and place them.
  Marker: function (opts) {
    const el = (opts && opts.element) || document.createElement('div');
    this.getElement = () => el;
    this.setLngLat = (x) => { const p = lngLat(x); el.dataset.at = p.lat.toFixed(5) + ',' + p.lng.toFixed(5); return this; };
    this.addTo = (map) => { if (map && map.getContainer()) map.getContainer().appendChild(el); return this; };
    this.remove = () => { if (el.parentNode) el.parentNode.removeChild(el); return this; };
  },
  Map: function (opts) {
    const h = {}, src = {}; let center = { lng: opts.center[0], lat: opts.center[1] };
    const container = typeof opts.container === 'string' ? document.getElementById(opts.container) : opts.container;
    this.getContainer = () => container;
    this.fitBounds = (b) => { window.__fitted = b && b.points ? b.points.slice() : []; };
    this.resize = () => {};
    this.remove = () => {};
    this.easeTo = (o) => { if (o && o.center) center = lngLat(o.center); };
    const fire = (ev, a) => (h[ev] || []).forEach((f) => f(a));
    this.__opts = opts;
    this.__fire = fire; window.__lastMap = this;
    this.on = (ev, f) => { (h[ev] = h[ev] || []).push(f); return this; };
    this.addControl = () => this;
    this.setStyle = () => { for (const k in src) delete src[k]; setTimeout(() => { fire('style.load'); fire('idle'); }, 20); };
    this.jumpTo = (o) => { center = { lng: o.center[0], lat: o.center[1] }; };
    this.getCenter = () => center;
    // A test can put its own features under the finger with window.__features.
    this.queryRenderedFeatures = () => window.__features
      || [{ sourceLayer: 'poi', layer: { id: 'poi_r1' }, id: 31415921, properties: { name: '清水寺', 'name:en': 'Kiyomizu-dera', class: 'place_of_worship', subclass: 'buddhist', rank: 1 } }];
    this.getSource = (id) => src[id]; this.addSource = (id) => { src[id] = { setData: () => {} }; }; this.addLayer = () => {};
    this.areTilesLoaded = () => true;
    setTimeout(() => { fire('style.load'); fire('idle'); }, 30);
  } };
