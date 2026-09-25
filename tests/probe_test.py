# SPDX-License-Identifier: AGPL-3.0-or-later
"""Playwright test of docs/probe.html with every outside service mocked (no network needed).
Run: python3 tests/probe_test.py   (or set PROBE_URL to test a copy that is already served)"""
import json, os
from playwright.sync_api import sync_playwright
import harness
from harness import SHOTS

SHOTS.mkdir(exist_ok=True)
BASE, stop = ('', None) if os.environ.get('PROBE_URL') else harness.serve()
URL = os.environ.get('PROBE_URL') or BASE + '/probe.html'
AREA = {"features": [{"geometry": {"coordinates": [135.7681, 35.0116]}, "properties": {"name": "Kyoto", "country": "Japan", "osm_key": "place", "osm_value": "city", "osm_type": "R", "osm_id": 357794}}]}
NEAR = {"features": [{"geometry": {"coordinates": [135.7588, 34.9858]}, "properties": {"name": "Kyoto Station", "osm_key": "railway", "osm_value": "station", "city": "Kyoto", "osm_type": "N", "osm_id": 1}},
                     {"geometry": {"coordinates": [135.7722, 35.0036]}, "properties": {"name": "Gion-Shijō", "osm_key": "railway", "osm_value": "station", "city": "Kyoto", "osm_type": "N", "osm_id": 2}}]}
OSRM = {"code": "Ok", "routes": [{"duration": 1290.4, "distance": 1712.3, "geometry": {"type": "LineString", "coordinates": [[135.7681, 35.0116], [135.782, 35.0184]]}}]}
TRANSIT = {"itineraries": [{"duration": 1500, "startTime": "2026-09-26T01:03:00Z", "endTime": "2026-09-26T01:24:00Z", "transfers": 0,
            "legs": [{"mode": "WALK"}, {"mode": "BUS", "displayName": "206"}, {"mode": "WALK"}]}], "direct": []}
OVERPASS = {"elements": [{"type": "node", "id": 3141592, "tags": {"name": "清水寺", "name:en": "Kiyomizu-dera", "opening_hours": "06:00-18:00", "website": "https://example.org/", "wikipedia": "ja:清水寺", "amenity": "place_of_worship"}}]}
H = {"Access-Control-Allow-Origin": "*", "Content-Type": "application/json"}
errs, log, seen, gseen = [], [], [], []
def check(c, m): log.append(('PASS  ' if c else 'FAIL  ') + m)
def services(r):
    """The outside services the probe talks to. Returns True once it has answered."""
    u = r.request.url
    if 'photon.komoot.io' in u:
        r.fulfill(status=200, body=json.dumps(AREA if 'q=Kyoto' in u else NEAR), headers=H)
    elif 'routing.openstreetmap.de' in u:
        r.fulfill(status=200, body=json.dumps(OSRM), headers=H)
    elif 'api.transitous.org/api/v6/plan' in u:
        r.fulfill(status=200, body=json.dumps(TRANSIT), headers=H)
    elif 'overpass-api.de/api/interpreter' in u:
        seen.append(u)
        r.fulfill(status=200, body=json.dumps(OVERPASS if ('node(3141592)' in u or 'node%283141592%29' in u) else {"elements": []}), headers=H)
    elif 'google.com/maps' in u:
        gseen.append(u)
        r.abort()
    else:
        return False
    return True
with sync_playwright() as pw:
    br = pw.chromium.launch()
    ctx = br.new_context(viewport={'width': 1280, 'height': 800})
    ctx.route('**/*', harness.offline(BASE, services))
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
    pg.on('console', lambda m: errs.append('console.' + m.type + ': ' + m.text) if m.type == 'error' else None)
    pg.goto(URL); pg.wait_for_timeout(400)
    check('Liberty loaded' in pg.inner_text('#r-map'), 'map starts on Liberty: ' + pg.inner_text('#r-map'))
    pg.click('#go'); pg.wait_for_timeout(1300)
    check('Found Kyoto' in pg.inner_text('#r-area'), 'area: ' + pg.inner_text('#r-area'))
    check(pg.is_disabled('#details'), 'details disabled before a tap')
    pg.evaluate("window.__lastMap.__fire('click', {point: {x: 10, y: 10}, lngLat: {lng: 135.785, lat: 34.9949}})"); pg.wait_for_timeout(100)
    check('Kiyomizu-dera' in pg.inner_text('#r-tap'), 'tap: ' + pg.inner_text('#r-tap').replace('\n', ' | '))
    pg.click('#details'); pg.wait_for_timeout(1400)
    t = pg.inner_text('#r-details')
    check('Found node/3141592' in t and 'matched by id' in t and 'opening_hours: 06:00-18:00' in t, 'details: ' + t.replace('\n', ' | '))
    check(len(seen) == 1 and ('node(3141592)' in seen[0] or 'node%283141592%29' in seen[0]), 'one Overpass lookup, by decoded id')
    with pg.expect_popup() as pop:
        pg.click('#gmaps')
    pop.value.wait_for_timeout(300)
    check(any('google.com/maps/search/?api=1&query=' in u for u in gseen), 'Google Maps opens in a separate window: ' + (gseen[-1][:100] if gseen else 'no request'))
    check('opened' in pg.inner_text('#r-gmaps'), 'gmaps note: ' + pg.inner_text('#r-gmaps'))
    pg.click('#search'); pg.wait_for_timeout(1300)
    check('2 results' in pg.inner_text('#r-search'), 'search: ' + pg.inner_text('#r-search').split('\n')[0])
    pg.click('#route'); pg.wait_for_timeout(4200)
    t = pg.inner_text('#r-route')
    check('Walking: 22 min' in t and 'Public transport: 21 min' in t, 'routes: ' + t.replace('\n', ' | '))
    pg.click('[data-style=positron]'); pg.wait_for_timeout(200)
    check('Positron loaded' in pg.inner_text('#r-map'), 'style switch works')
    out = pg.input_value('#out'); res = json.loads(out.split('\n', 1)[1].rsplit('\n', 1)[0])
    check(res['probe'].endswith('2') and res['details']['method'] == 'id' and res['details']['useful']['opening_hours'] == '06:00-18:00' and res['gmaps']['opened'],
          'results block: details + gmaps recorded; query = ' + res['gmaps']['query'])
    pg.screenshot(path=str(SHOTS / 'probe_desktop.png'), full_page=False)
    br.close()
if stop: stop()
print('\n'.join(log)); print('ERRORS (%d):' % len(errs)); print('\n'.join(errs[:10]))
