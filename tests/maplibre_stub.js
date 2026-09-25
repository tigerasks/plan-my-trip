/* SPDX-License-Identifier: AGPL-3.0-or-later */
/* Stand-in for MapLibre GL JS, so the tests never reach the network.
   Shared by every Playwright test; extend it here when the app uses more of the library. */
window.maplibregl = { version: 'stub',
  NavigationControl: function () {},
  Marker: function () { this.setLngLat = () => this; this.addTo = () => this; this.remove = () => this; },
  Map: function (opts) {
    const h = {}, src = {}; let center = { lng: opts.center[0], lat: opts.center[1] };
    const fire = (ev, a) => (h[ev] || []).forEach((f) => f(a));
    this.__fire = fire; window.__lastMap = this;
    this.on = (ev, f) => { (h[ev] = h[ev] || []).push(f); return this; };
    this.addControl = () => this;
    this.setStyle = () => { for (const k in src) delete src[k]; setTimeout(() => { fire('style.load'); fire('idle'); }, 20); };
    this.jumpTo = (o) => { center = { lng: o.center[0], lat: o.center[1] }; };
    this.getCenter = () => center;
    this.queryRenderedFeatures = () => [{ sourceLayer: 'poi', layer: { id: 'poi_r1' }, id: 31415921, properties: { name: '清水寺', 'name:en': 'Kiyomizu-dera', class: 'place_of_worship', subclass: 'buddhist', rank: 1 } }];
    this.getSource = (id) => src[id]; this.addSource = (id) => { src[id] = { setData: () => {} }; }; this.addLayer = () => {};
    this.areTilesLoaded = () => true;
    setTimeout(() => { fire('style.load'); fire('idle'); }, 30);
  } };
