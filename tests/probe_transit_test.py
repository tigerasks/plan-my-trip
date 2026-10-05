# SPDX-License-Identifier: AGPL-3.0-or-later
"""Playwright test of docs/probe-transit.html with every outside service mocked (no network).
Run: python3 tests/probe_transit_test.py"""
import json
from playwright.sync_api import sync_playwright
import harness
from harness import SHOTS, Checks

SHOTS.mkdir(exist_ok=True)
BASE, stop = harness.serve()
ck = Checks('Day planner — the public transport probe')
H = {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'}

# A bus journey Transitous cannot do, and a rail one it can: the two cases the probe exists to tell apart.
PLAN_BUS = {'itineraries': [{'legs': [{'mode': 'WALK'}], 'startTime': '2026-10-06T01:00:00Z', 'endTime': '2026-10-06T02:30:00Z'}], 'direct': []}
PLAN_RAIL = {'itineraries': [{
    'startTime': '2026-10-06T01:00:00Z', 'endTime': '2026-10-06T01:27:00Z',
    'legs': [
        {'mode': 'WALK', 'duration': 360},
        {'mode': 'REGIONAL_RAIL', 'duration': 1020, 'routeShortName': '18999264',
         'routeLongName': 'Kintetsu Kyoto Line', 'headsign': 'Nara', 'agencyName': 'Kintetsu Railway',
         'from': {'name': 'Kyoto'}, 'to': {'name': 'Kōtari'},
         'legGeometry': {'points': 'abcdefghij' * 12, 'length': 42}},
        {'mode': 'WALK', 'duration': 300}]}], 'direct': []}
STOPS = [{'name': 'Imamiya-jinja-mae', 'type': 'STOP', 'id': 'jp-1'},
         {'name': 'Daitokuji-mae', 'type': 'STOP', 'id': 'jp-2'}]
ADDRESSES = [{'name': 'Murasakino', 'type': 'ADDRESS'}]
OVERPASS = {'elements': [
    {'type': 'node', 'id': 1, 'tags': {'highway': 'bus_stop', 'name': '大徳寺前', 'name:en': 'Daitokuji-mae'}},
    {'type': 'node', 'id': 2, 'tags': {'highway': 'bus_stop', 'name': '今宮神社前'}},
    {'type': 'relation', 'id': 9, 'tags': {'type': 'route', 'route': 'bus', 'ref': '206', 'name': 'Kyoto City Bus 206', 'operator': 'Kyoto City'}}]}
PHOTON = {'features': [{'geometry': {'coordinates': [135.7458, 35.0436]},
                        'properties': {'name': 'Daisen-in', 'osm_type': 'W', 'osm_id': 1}}]}
seen = []


def services(r):
    u = r.request.url
    if 'photon.komoot.io' in u:
        r.fulfill(status=200, body=json.dumps(PHOTON), headers=H)
    elif 'api/v6/plan' in u:
        seen.append('plan')
        r.fulfill(status=200, body=json.dumps(PLAN_RAIL if 'rail' in u or len(seen) > 1 else PLAN_BUS), headers=H)
    elif 'reverse-geocode' in u:
        seen.append(u.split('api/')[1].split('/')[0])
        # The second run stands in for Kyoto's buses: no stops, but the place itself is known.
        if 'type=STOP' in u:
            r.fulfill(status=200, body=json.dumps([] if len(seen) > 4 else STOPS), headers=H)
        else:
            r.fulfill(status=200, body=json.dumps(ADDRESSES), headers=H)
    elif 'overpass-api.de' in u:
        seen.append('overpass')
        # The first map query is answered 504, as a busy Overpass does; the retry succeeds.
        if seen.count('overpass') == 1:
            r.fulfill(status=504, body='busy', headers={'Access-Control-Allow-Origin': '*'})
        else:
            r.fulfill(status=200, body=json.dumps(OVERPASS), headers=H)
    else:
        return False
    return True


with sync_playwright() as pw:
    br = pw.chromium.launch()
    ctx = br.new_context(viewport={'width': 1280, 'height': 900})
    ctx.route('**/*', harness.offline(BASE, services))
    pg = ctx.new_page()
    ck.watch(pg)
    pg.goto(BASE + '/probe-transit.html')
    pg.wait_for_timeout(400)
    ck('Served from' in pg.inner_text('#r-env'), 'the page says where it is served from')
    ck(pg.is_disabled('#go'), 'and will not run until both ends are set')

    pg.click('#find')
    pg.wait_for_timeout(2600)
    ck('Daisen-in' in pg.inner_text('#r-ends'), 'searching sets both ends: ' + pg.inner_text('#r-ends').replace('\n', ' / '))
    ck(not pg.is_disabled('#go'), 'and the checks can run')

    ck.expect('504')   # the test makes Overpass fail once on purpose, to prove the retry
    pg.click('#go')
    pg.wait_for_timeout(18000)
    out = pg.inner_text('#r-run')
    ck('no way to do it by public transport' in out, 'a journey it cannot do is reported as that, not as a failure')
    ck('Stops near A: 2' in out, 'while Transitous still knows stops there: ' + [l for l in out.split('\n') if 'Stops near A' in l][0])
    ck('2 bus stops, 1 route (' in out, 'and OpenStreetMap answers once it is asked again after a timeout: '
       + [l for l in out.split('\n') if 'OpenStreetMap near A' in l][0])
    ck('206' in out, 'with its number, which is what naming a line needs')
    ck('/v1/' not in str(seen) or seen.count('v1') == 2, 'the v1 stop endpoint answers, so no fallback is needed: ' + str(seen))
    pg.screenshot(path=str(SHOTS / 'probe_transit_desktop.png'))

    pg.click('#again')
    pg.wait_for_timeout(200)
    pg.click('#find')
    pg.wait_for_timeout(2600)
    pg.click('#go')
    pg.wait_for_timeout(14000)
    out = pg.inner_text('#r-run')
    ck('use transit' in out, 'a journey it can do comes back with its legs: ' + [l for l in out.split('\n') if 'Journey' in l][0])
    ck('other thing it does know' in out, 'an empty stop list is told apart from a question that never landed: '
       + [l for l in out.split('\n') if 'Stops near A' in l][0])
    ck('Kintetsu Kyoto Line' in out, 'named from the fields the leg actually carries')
    ck('shape' in out, 'and the probe reports whether the leg has a shape to draw')

    block = pg.input_value('#out')
    body = json.loads(block.split('\n', 1)[1].rsplit('\n', 1)[0])
    ck(len(body['runs']) == 2, 'both runs are kept in one block to paste')
    ck(body['runs'][1]['journey']['bestLegs'][1]['routeLongName'] == 'Kintetsu Kyoto Line',
       'the block carries every name field, so the chat can see which to use')
    ck(body['runs'][0]['map'][0]['routesWithRef'] == 1, 'and how many map routes carry a line number')
    ck(body['runs'][1]['stops'][0]['anythingCount'] == 1 and body['runs'][1]['stops'][0]['count'] == 0,
       'and, where there are no stops, what else is known there — which says whether the answer means anything')
    br.close()
stop()
ck.finish()
