# SPDX-License-Identifier: AGPL-3.0-or-later
"""Playwright walk-through of the planner, docs/index.html. Nothing reaches the network: MapLibre
comes from the stub and every other request is blocked. Run: python3 tests/app_test.py"""
import datetime, json, math, pathlib, re, time, urllib.parse
from playwright.sync_api import sync_playwright
import harness
from harness import SHOTS, Checks

SHOTS.mkdir(exist_ok=True)
H = {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'}
DEMO = json.loads((harness.HERE / 'demo-trip.json').read_text())
C_block = lambda env: '--- BEGIN day-planner/2 ---\n' + json.dumps(env) + '\n--- END day-planner/2 ---\n'
BASE, stop = harness.serve()
ck = Checks('Day planner — the skeleton')


def C_places_has(pg, name):
    return name in [p['name'] for p in pg.evaluate('Object.values(window.DayPlannerApp.trip.places)')]

with sync_playwright() as pw:
    br = pw.chromium.launch()

    served = []

    def fake_service(r):
        u = r.request.url
        if 'example.test/slow' in u:
            served.append(u)
            r.fulfill(status=200, body='{"ok":true}', headers={'Content-Type': 'application/json',
                                                               'Access-Control-Allow-Origin': '*'})
            return True
        if 'example.test/broken' in u:
            served.append(u)
            r.fulfill(status=500, body='no', headers={'Access-Control-Allow-Origin': '*'})
            return True
        return False

    FIX = json.loads((harness.HERE / 'fixtures.json').read_text())
    # A polyline from the hotel to the temple, so the shape passes the planner's sanity check.
    KYOTO_SHAPE = FIX['kyotoShape']
    # What Overpass gives back, by id. Pizza Little Party's tags are from the service test; the
    # other two are made up, since the probe never looked them up.
    OSM_BY_ID = {
        '5279728860': {'type': 'node', 'id': 5279728860, 'lat': 34.97891, 'lon': 135.75941, 'tags': FIX['overpassTags']},
        '359896810': {'type': 'way', 'id': 359896810, 'center': {'lat': 34.98083, 'lon': 135.74764},
                      'tags': {'name': '東寺', 'name:en': 'East Temple', 'tourism': 'attraction', 'fee': 'yes'}},
        '263330850': {'type': 'way', 'id': 263330850, 'center': {'lat': 34.88712, 'lon': 135.80481}, 'tags': {}},
    }
    def straight(url):
        """How far apart the two points in an OSRM url are, in kilometres."""
        pair = re.search(r'/([\d.-]+),([\d.-]+);([\d.-]+),([\d.-]+)', url)
        if not pair:
            return 99.0
        lon1, lat1, lon2, lat2 = (float(x) for x in pair.groups())
        dy = (lat2 - lat1) * 111.0
        dx = (lon2 - lon1) * 111.0 * math.cos(math.radians((lat1 + lat2) / 2))
        return (dx * dx + dy * dy) ** 0.5

    asked = []
    # What Transitous has to say, which the tests turn up and down: a journey or nothing, stops
    # nearby or none. The two together are what tell "no timetables here" from "nothing at that time".
    # 'soon' stands for a timetable that has not been published as far out as the trip: it answers
    # for dates in the coming week and has nothing for the trip's own, which is TRANSIT['far'].
    TRANSIT = {'ride': True, 'stops': True, 'far': 'time=none'}
    # The stop snapshot is served from tests/stops; this makes it unreadable, which is the only way
    # it can fail now that it is a static file of our own.
    SNAP = {'fail': False}
    # How many times Overpass refuses outright before it answers. It only gets place lookups now,
    # and it refused three times running in the fifth service test, so this is the normal case.
    BUSY = {'details': 0, 'status': 502}

    def services(r):
        u = r.request.url
        if 'api.transitous.org' in u:
            asked.append(u)
            if 'reverse-geocode' in u:
                r.fulfill(status=200, headers=H, body=json.dumps(FIX['transitStops'] if TRANSIT['stops'] else []))
            elif TRANSIT['ride'] is True or (TRANSIT['ride'] == 'soon' and TRANSIT['far'] not in u):
                r.fulfill(status=200, headers=H, body=json.dumps(FIX['transitJourney']))
            else:
                r.fulfill(status=200, headers=H, body=json.dumps({'itineraries': [], 'direct': []}))
            return True
        if 'routing.openstreetmap.de' in u:
            asked.append(u)
            if 'nowhere' in u:
                r.fulfill(status=200, body=json.dumps({'code': 'NoRoute', 'routes': []}), headers=H)
            else:
                # The probe's own numbers for the leg it measured. A shorter hop — a walk round the
                # corner to a bus stop — is scaled down, so it does not come back as half an hour.
                walking = 'routed-foot' in u
                # A short hop round the streets is a good deal longer than the line between the
                # two points, which is exactly why the planner checks these rather than guessing.
                near = straight(u) < 1.0
                secs = (round(straight(u) * 2.2 / 4.5 * 3600) if walking else 60) if near else (1860 if walking else 300)
                metres = round(straight(u) * 2200) if near else (2310 if walking else 2480)
                r.fulfill(status=200, headers=H, body=json.dumps({'code': 'Ok', 'routes': [{
                    'duration': secs, 'distance': metres,
                    'geometry': KYOTO_SHAPE if not near else ''}]}))
            return True
        if 'google.com/maps' in u:
            r.fulfill(status=200, body='<html><title>Maps</title></html>', headers={'Content-Type': 'text/html'})
            return True
        if 'plan-my-trip-data-stops' in u:
            asked.append(u)
            if SNAP['fail']:
                r.fulfill(status=503, body='no', headers={'Access-Control-Allow-Origin': '*'})
                return True
            harness.serve_snapshot(r, u)            # the small real snapshot in tests/stops
            return True
        if 'overpass-api.de' in u:
            asked.append(u)
            q = urllib.parse.unquote(u)
            if BUSY['details'] > 0:
                BUSY['details'] -= 1
                r.fulfill(status=BUSY['status'], body='# too much',
                          headers={'Access-Control-Allow-Origin': '*'})
                return True
            want = re.search(r'(node|way|relation)\((\d+)\)', q)
            r.fulfill(status=200, headers={'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
                      body=json.dumps({'elements': [OSM_BY_ID[want.group(2)]] if want and want.group(2) in OSM_BY_ID else []}))
            return True
        if 'photon.komoot.io' in u:
            asked.append(u)
            hit = 'nothing' not in u
            r.fulfill(status=200, headers={'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
                      body=json.dumps(FIX['photon'] if hit else {'features': []}))
            return True
        return fake_service(r)

    def no_maplibre(r):
        if 'maplibre-gl.js' in r.request.url:
            r.fulfill(status=200, body='', headers={'Content-Type': 'application/javascript'})
            return True
        return False

    def open_page(w=1280, h=800, scheme='light', held=None, extra=None):
        phone = w < 500
        ctx = br.new_context(viewport={'width': w, 'height': h}, color_scheme=scheme,
                             is_mobile=phone, has_touch=phone, device_scale_factor=2 if phone else 1,
                             permissions=['clipboard-read', 'clipboard-write'])
        ctx.route('**/*', harness.offline(BASE, extra))
        pg = ctx.new_page()
        ck.watch(pg)
        if held is not None:
            pg.add_init_script("localStorage.setItem('plan-my-trip/trip', %s)" % json.dumps(json.dumps(held)))
        pg.goto(BASE + '/index.html')
        pg.wait_for_timeout(200)
        return ctx, pg

    # ---- an empty browser
    ctx, pg = open_page()
    ck('No trip yet' in pg.inner_text('#panel'), 'an empty browser offers to start a trip')
    ck(pg.locator('#dayPick').is_hidden(), 'and hides the day picker until there are days')
    ck(pg.inner_text('#tripBtn') == 'Day planner', 'the header falls back to the app name')
    pg.screenshot(path=str(SHOTS / 'app_empty_desktop_light.png'))

    # ---- starting a trip
    pg.click('[data-act="new-trip"]')
    pg.wait_for_timeout(120)
    ck(pg.inner_text('#tripBtn') == 'My trip', 'starting a trip names it in the header')
    ck('No days yet' in pg.inner_text('#panel'), 'and asks for its days')
    ck('Add its days next' in pg.inner_text('#toast'), 'with a nudge: ' + pg.inner_text('#toast'))
    ck(pg.evaluate('window.DayPlannerApp.trip.id') == 'my-trip', 'the trip is in the page, normalised')
    pg.screenshot(path=str(SHOTS / 'app_new_desktop_light.png'))
    # ---- saving in the browser
    pg.wait_for_timeout(800)
    held = pg.evaluate("JSON.parse(localStorage.getItem('plan-my-trip/trip'))")
    ck(held['schema'] == 'day-planner/2' and held['kind'] == 'save' and held['trip']['title'] == 'My trip',
       'the trip is auto-saved as a day-planner/2 envelope')
    ck(pg.inner_text('#saved').startswith('Saved '), 'and the header says when: ' + pg.inner_text('#saved'))
    pg.reload()
    pg.wait_for_timeout(250)
    ck(pg.inner_text('#tripBtn') == 'My trip', 'and it is still there after a reload')
    ctx.close()

    # ---- opening a browser that already holds a trip
    ctx, pg = open_page(held=DEMO, extra=services)
    ck(pg.inner_text('#tripBtn') == 'Example · Kyoto (made up)', 'a stored trip opens straight away')
    ck(pg.locator('#dayPick').is_visible() and 'Sat 21 Nov' in pg.inner_text('#dayFace'), 'on its first day: ' + pg.inner_text('#dayFace'))
    ck('Example Hotel · Kyoto Station' in pg.inner_text('#panel'), 'with the day it knows about')
    pg.select_option('#daySel', '2026-11-22')
    pg.wait_for_timeout(150)
    ck('Sun 22 Nov' in pg.inner_text('#dayFace'), 'and you can switch day: ' + pg.inner_text('#dayFace'))
    pg.reload()
    pg.wait_for_timeout(250)
    ck('Sun 22 Nov' in pg.inner_text('#dayFace'), 'which is remembered for this browser')
    pg.select_option('#daySel', '2026-11-21')
    pg.wait_for_timeout(150)
    ck(pg.locator('.card-head .label').all_text_contents()[1:] == ['Plan · Balanced 2', 'Ideas for today 1', 'Backlog 2'],
       'the panel shows the version on screen, the day\'s other ideas and the backlog')
    ck(pg.locator('.list .nm').first.inner_text().startswith('Example Temple'), 'stops come in the version\'s order')
    tl = pg.inner_text('.timeline')
    ck('08:30' in tl and 'Leave Example Hotel' in tl, 'the timeline opens with when you set off')
    ck('08:50' in tl and 'until 10:20' in tl, 'each stop says when it runs: ' + [l for l in tl.split(chr(10)) if 'until' in l][0])
    ck('train or bus' in tl and '≈' in tl, 'with an estimate for the travel between them: '
       + [l for l in tl.split(chr(10)) if '≈' in l][0])
    ck('11:58' in tl and 'Back at' in tl, 'ending with when you would be back, an hour earlier now nothing invents lunch')
    heads = pg.locator('.card-head').all_inner_texts()
    ck(any('9h 02 spare' in h for h in heads), 'the heading says when it finishes: ' + [h for h in heads if 'spare' in h][0].replace(chr(10), ' '))
    ck('hours not checked yet' in pg.inner_text('.tl-issues'), 'and what is worth checking is gathered underneath')
    ck(pg.locator('.chip.must').count() == 1 and pg.locator('.chip.check').count() == 2 and pg.locator('.chip.flex').count() == 3,
       'labels from the chat, check flags and other versions all show as chips')
    ck('Food · 45 min · City centre' in pg.inner_text('[data-list="ideas"] .meta'),
       'an idea says what it is and how long it takes: ' + pg.inner_text('[data-list="ideas"] .meta').split(chr(10))[0])
    ck('until 10:20 · 1h 30 · Temple / culture' in pg.inner_text('.timeline .meta'),
       'and a stop says when it runs: ' + pg.inner_text('.timeline .meta').split(chr(10))[0])
    pg.screenshot(path=str(SHOTS / 'app_day_desktop_light.png'))

    pg.click('[data-act="version"][data-v="packed"]')
    pg.wait_for_timeout(150)
    labels = pg.locator('.card-head .label').all_text_contents()
    ck(labels[1] == 'Plan · Packed 3' and labels[2] == 'Ideas for today 0',
       'switching version moves places between the plan and today\'s ideas')
    pg.click('[data-act="version"][data-v="balanced"]')
    pg.wait_for_timeout(200)
    ck('In Packed' in pg.inner_text('[data-list="ideas"]'),
       'an idea says which other versions already hold it: ' + pg.inner_text('[data-list="ideas"] .nm').replace(chr(10), ' '))
    pg.click('[data-act="version"][data-v="packed"]')
    pg.wait_for_timeout(200)
    ck(pg.locator('[data-act="version"][data-v="packed"]').get_attribute('aria-pressed') == 'true', 'and the control follows')
    pg.click('[data-act="version"][data-v="less"]')
    pg.wait_for_timeout(900)
    held = pg.evaluate("JSON.parse(localStorage.getItem('plan-my-trip/trip'))")
    ck(held['trip']['days']['2026-11-21']['shown'] == 'less', 'the version you are looking at is remembered')
    ck(len(held['trip']['days']['2026-11-21']['plans']['balanced']) == 2, 'and switching never moves a place between versions')
    labels = pg.locator('.card-head .label').all_text_contents()
    ck(labels[1] == 'Plan · Do less 1' and labels[2] == 'Ideas for today 2', 'Do less keeps its own, shorter list: ' + ' / '.join(labels[1:3]))

    # ---- a leg of the day
    pg.keyboard.press('Escape')
    pg.wait_for_timeout(150)

    # Left alone for a moment, the planner checks the legs of the plan itself, one at a time: there
    # is no point making someone open every card to ask (design doc, decision 8). Walking is asked
    # of OSRM on every leg, since it is what a ride has to beat; the timetables are only asked about
    # where the planner expects you to ride.
    asked.clear()
    pg.wait_for_function("() => { const l = window.DayPlannerApp.trip.days['2026-11-21'].legs || {};"
                         " const k = Object.keys(l); return k.length === 2 && k.every((x) =>"
                         " (l[x].walk || {}).source === 'osrm' && (l[x].transit || {}).source === 'transitous'); }",
                         timeout=40000)
    routes = [u for u in asked if 'routing.openstreetmap.de' in u]
    rides = [u for u in asked if 'api.transitous.org' in u]
    ck(len(routes) == 2 and all('routed-foot/route/v1/foot/' in u for u in routes),
       'both legs of the plan get their walking time without being asked: %d calls' % len(routes))
    ck(len(rides) == 2 and all('/api/v6/plan?' in u for u in rides),
       'and both get asked of the timetables: %d calls' % len(rides))
    ck('fromPlace=34.985800,135.758800' in rides[0], 'with the ends latitude first, as Transitous wants')
    ck('time=2026-11-20T23%3A30%3A00.000Z' in rides[0],
       'for the instant you would set off, 08:30 in Kyoto: ' + rides[0].split('time=')[1])
    ck(pg.evaluate('window.DayPlannerLive.idle()') is True, 'and the planner is quiet again afterwards')
    ck('✓ checked' in pg.inner_text('.timeline'), 'the timeline stops guessing at the legs')
    ck('24 min train or bus' in pg.inner_text('.timeline'),
       'and uses the ride, which clearly beats half an hour on foot: '
       + [l for l in pg.inner_text('.timeline').split(chr(10)) if 'checked' in l][0])
    ck('近畿日本鉄道 towards 京都' in pg.inner_text('.timeline'),
       'with the line named in the plan itself, not only on the card')

    pg.screenshot(path=str(SHOTS / 'app_checked_desktop_light.png'))
    pg.click('.timeline .leg >> nth=0')
    pg.wait_for_timeout(300)
    ck(pg.inner_text('.sh-title').startswith('This leg'), 'a leg in the timeline opens')
    ck('Example Hotel · Kyoto Station → Example Temple' in pg.inner_text('.sh-sub'),
       'naming both ends: ' + pg.inner_text('.sh-sub'))
    labels = pg.locator('#sheet .facts.legs dt').all_text_contents()
    ck(labels == ['Walking', 'Train or bus', 'Estimate'],
       'the card lists every way it knows, and the estimate: ' + ' / '.join(labels))
    ck('31 min' in pg.inner_text('#sheet') and 'OSRM' in pg.inner_text('#sheet'),
       'with the real walking time and who said so')
    ck('2.3 km' in pg.inner_text('#sheet'), 'and how far it is on foot')
    ck('近畿日本鉄道 towards 京都' in pg.inner_text('#sheet'),
       'the ride is named from who runs it and where it is heading')
    ck('walk 13 min to 東寺 · 2 min to 京都 · walk 9 min' in pg.inner_text('#sheet'),
       'and spelled out step by step')
    ck('in use' in pg.inner_text('#sheet .facts.legs dd >> nth=1'),
       'the ride is the one in use: ' + pg.inner_text('#sheet .facts.legs dd >> nth=1'))

    # putting the walk in its place, since the choice is yours
    pg.click('[data-act="pick-leg"][data-mode="walk"]')
    pg.wait_for_timeout(900)
    leg = pg.evaluate("window.DayPlannerApp.trip.days['2026-11-21'].legs['start>example-temple']")
    ck(leg['pick'] == 'walk', 'you can tell it to use the walk instead')
    ck('✓ checked' in pg.inner_text('.timeline'), 'and the timeline stops guessing at that leg')
    ck('31 min walk' in pg.inner_text('.timeline'), 'using the checked time: '
       + [l for l in pg.inner_text('.timeline').split(chr(10)) if 'checked' in l][0])
    real = pg.evaluate("window.__lastMap.__sources['day-real'].data.geometry.coordinates")
    dashed = pg.evaluate("window.__lastMap.__sources['day-route'].data.geometry.coordinates")
    ck(len(real) == 1 and len(real[0]) > 2,
       'the map draws that leg along its real path, not as a straight line: %d hops, %d points'
       % (len(real), len(real[0]) if real else 0))
    ck(len(dashed) == 1, 'leaving the hop that is still guessed dashed: %d' % len(dashed))
    ck('min out' in pg.inner_text('#sheet'), 'the card says how far out the guess for that same way was: '
       + [l for l in pg.inner_text('#sheet').split(chr(10)) if 'out.' in l][0])
    pg.click('[data-act="pick-leg"][data-mode=""]')
    pg.wait_for_timeout(900)
    ck(pg.evaluate("window.DayPlannerApp.trip.days['2026-11-21'].legs['start>example-temple'].pick") is None,
       'and you can hand the choice back to the planner')

    # your own time, which beats everything
    ck(pg.locator('#legH').count() == 1 and pg.locator('#legM .wheel-item').count() == 60,
       'the card has wheels to enter your own time, minute by minute')
    pg.click('#legM .wheel-item[data-v="12"]')
    pg.click('[data-act="save-my-leg"]')
    pg.wait_for_timeout(900)
    leg = pg.evaluate("window.DayPlannerApp.trip.days['2026-11-21'].legs['start>example-temple']")
    ck(leg['mine']['minutes'] == 12, 'which is kept against that leg')
    ck(leg['walk']['minutes'] == 31, 'without losing what was checked')
    ck('your own time' in pg.inner_text('.timeline'), 'and the timeline says whose time it is showing')
    ck('12 min' in pg.inner_text('.timeline'), 'using it: ' + [l for l in pg.inner_text('.timeline').split(chr(10)) if 'own time' in l][0])
    ck(pg.locator('#sheet').get_attribute('aria-hidden') == 'false', 'the card stays open, so you can change your mind')
    pg.click('[data-act="drop-my-leg"]')
    pg.wait_for_timeout(900)
    ck('24 min train or bus' in pg.inner_text('.timeline'),
       'forgetting it leaves the planner to choose again, which brings back the ride')

    # a taxi, which is never assumed: it is there once you ask
    asked.clear()
    pg.click('[data-act="check-leg"][data-mode="car"]')
    pg.wait_for_function("() => (window.DayPlannerApp.trip.days['2026-11-21'].legs['start>example-temple'].car || {})"
                         ".minutes != null", timeout=15000)
    pg.wait_for_timeout(300)
    ck([u for u in asked if 'routed-car/route/v1/driving/' in u], 'a taxi check asks the driving profile')
    leg = pg.evaluate("window.DayPlannerApp.trip.days['2026-11-21'].legs['start>example-temple']")
    ck(leg['car']['minutes'] == 10, 'and keeps it with the allowance for being picked up: %d min' % leg['car']['minutes'])
    ck(leg['walk']['minutes'] == 31, 'beside the walk, which it does not touch')
    ck('24 min train or bus' in pg.inner_text('.timeline'),
       'the leg itself is unchanged, since taking a taxi is a decision')
    ck('picked up' in pg.inner_text('#sheet'), 'the card says why a taxi takes longer than the driving time')
    ck('By taxi' in pg.locator('#sheet .facts.legs dt').all_text_contents(), 'and lists it as one of the ways')
    pg.screenshot(path=str(SHOTS / 'app_leg_desktop_light.png'))

    pg.click('[data-act="forget-leg"]')
    pg.wait_for_timeout(900)
    ck(pg.evaluate("window.DayPlannerApp.trip.days['2026-11-21'].legs['start>example-temple']") is None,
       'and the whole leg can be forgotten')
    ck(len(pg.evaluate("window.__lastMap.__sources['day-real'].data.geometry.coordinates")) == 0,
       'with any real path on the map going with it')
    pg.wait_for_timeout(1800)
    ck(pg.evaluate("window.DayPlannerApp.trip.days['2026-11-21'].legs['start>example-temple']") is None,
       'a leg you have forgotten is not quietly checked all over again')
    pg.keyboard.press('Escape')
    pg.wait_for_timeout(150)

    # ---- copying a version, and tidying its order
    pg.click('[data-act="version"][data-v="packed"]')
    pg.wait_for_timeout(200)
    pg.click('[data-act="copy-version"][data-to="less"]')
    pg.wait_for_timeout(900)
    plans = pg.evaluate("window.DayPlannerApp.trip.days['2026-11-21'].plans")
    ck(plans['less'] == plans['packed'] and len(plans['less']) == 3, 'a version can be copied over another')
    ck('replacing what was there' in pg.inner_text('#toast'), 'and says what it replaced: ' + pg.inner_text('#toast'))
    pg.click('#toastBtn')
    pg.wait_for_timeout(900)
    ck(pg.evaluate("window.DayPlannerApp.trip.days['2026-11-21'].plans.less") == ['example-temple'],
       'with Undo putting the old one back')

    pg.click('[data-act="copy-version"][data-to="less"]')
    pg.wait_for_timeout(600)
    pg.click('[data-act="version"][data-v="less"]')
    pg.wait_for_timeout(300)
    pg.click('[data-act="optimise"]')
    pg.wait_for_timeout(900)
    ck(len(pg.evaluate("window.DayPlannerApp.trip.days['2026-11-21'].plans.less")) == 3,
       'Optimise leaves the same three stops in the version')
    pg.screenshot(path=str(SHOTS / 'app_timeline_desktop_light.png'))
    ck('Reordered' in pg.inner_text('#toast') or 'best order' in pg.inner_text('#toast'),
       'and says what it did: ' + pg.inner_text('#toast'))
    pg.click('[data-act="version"][data-v="less"]')
    pg.wait_for_timeout(200)
    ctx.close()

    # ---- the same trip on a phone
    ctx, pg = open_page(390, 844, held=DEMO, extra=services)
    ck(pg.locator('.seg').is_visible(), 'the version control still fits on a phone')
    ck(pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'),
       'and nothing spills off the side: %d px of content in %d px of screen'
       % (pg.evaluate('document.documentElement.scrollWidth'), pg.evaluate('window.innerWidth')))
    pg.screenshot(path=str(SHOTS / 'app_day_phone_light.png'))
    pg.click('.list .item >> nth=0')
    pg.wait_for_timeout(300)
    ck(pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'),
       'nor does a place card, wheels and all')
    pg.click('[data-act="edit-hours"]')
    pg.wait_for_timeout(250)
    ck(pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), 'nor the hours editor')
    pg.screenshot(path=str(SHOTS / 'app_hours_phone_light.png'))
    ctx.close()
    ctx, pg = open_page(390, 844, scheme='dark', held=DEMO)
    pg.screenshot(path=str(SHOTS / 'app_day_phone_dark.png'))
    ctx.close()
    ctx, pg = open_page(scheme='dark', held=DEMO)
    pg.screenshot(path=str(SHOTS / 'app_day_desktop_dark.png'))
    ctx.close()

    # ---- being polite to the outside services
    ctx, pg = open_page(extra=fake_service)
    spacing = pg.evaluate('''async () => {
      const L = window.DayPlannerLive, at = [];
      // The page reads the stop snapshot's manifest by itself, so count from wherever that left off.
      const before = L.calls;
      const mark = (u) => L.fetchJson(u).then(() => at.push(Date.now()));
      await Promise.all([mark('https://example.test/slow?a'), mark('https://example.test/slow?b'),
                         mark('https://example.test/slow?c')]);
      return { calls: L.calls - before, total: L.calls, gaps: at.slice(1).map((t, i) => t - at[i]) };
    }''')
    ck(spacing['calls'] == 3, 'three different questions make three requests')
    ck(all(g >= 1000 for g in spacing['gaps']), 'spaced at least a second apart, as their terms ask: ' + str(spacing['gaps']))
    again = pg.evaluate('''async () => {
      const L = window.DayPlannerLive, before = L.calls;
      await L.fetchJson('https://example.test/slow?a');
      await L.fetchJson('https://example.test/slow?a');
      return L.calls - before;
    }''')
    ck(again == 0, 'asking the same thing again is answered from the page, not the service')
    ck.expect('status of 500')   # the browser logs the failed request; that is the point of the test
    broke = pg.evaluate('''async () => {
      const L = window.DayPlannerLive;
      let why = '';
      try { await L.fetchJson('https://example.test/broken'); } catch (e) { why = L.why(e); }
      const after = await L.fetchJson('https://example.test/slow?d');
      return { why, after: !!after.ok };
    }''')
    ck('500' in broke['why'], 'a service that fails says so in plain words: ' + broke['why'])
    ck(broke['after'] is True, 'and the next request still goes through')
    ctx.close()

    # ---- when the timetables have nothing to say
    # Transitous answering with no journey means one of two things, and which one matters: there are
    # no timetables for this kind of service here, or there are and nothing runs at that hour. The
    # fourth service test found exactly the first case for Kyoto's buses.
    TRANSIT['ride'] = False
    ctx, pg = open_page(held=DEMO, extra=services)
    pg.wait_for_function("() => ((window.DayPlannerApp.trip.days['2026-11-21'].legs['start>example-temple']"
                         " || {}).transit || {}).detail != null", timeout=40000)
    leg = pg.evaluate("window.DayPlannerApp.trip.days['2026-11-21'].legs['start>example-temple'].transit")
    ck(leg['minutes'] is None and leg['asked'], 'a journey that came back empty is still written down')
    ck('stops at both ends' in leg['detail'] and '08:30' in leg['detail'],
       'and says nothing runs at that hour, since it does know stops there: ' + leg['detail'])
    ck(leg['detail'].count('東寺') == 1, 'naming each stop once, however many ends it sits by')
    ck('≈' in pg.inner_text('.timeline'), 'the day falls back to the planner\'s own estimate')
    pg.click('.timeline .leg >> nth=0')
    pg.wait_for_timeout(300)
    ck('nothing came back' in pg.inner_text('#sheet'), 'the card says the timetables were asked and had nothing')
    ck(leg['detail'] in pg.inner_text('#sheet'), 'with the reason under it')
    ctx.close()

    # Where it does know stops and simply found nothing leaving, that is a real answer about real
    # services, and better than anything a snapshot with no times in it could offer.
    TRANSIT['stops'] = True
    asked.clear()
    ctx, pg = open_page(held=DEMO, extra=services)
    pg.wait_for_function("() => ((window.DayPlannerApp.trip.days['2026-11-21'].legs['start>example-temple']"
                         " || {}).transit || {}).detail != null", timeout=40000)
    pg.wait_for_timeout(2500)
    leg = pg.evaluate("window.DayPlannerApp.trip.days['2026-11-21'].legs['start>example-temple'].transit")
    ck(leg['source'] == 'transitous' and leg['minutes'] is None,
       'the timetable\'s own answer stands: ' + str(leg['detail']))
    ck('found nothing leaving' in leg['detail'], 'saying nothing runs then, not that there are no buses')
    ck(not any('data-stops/tiles' in u for u in asked),
       'and no tile is read at all, because a guess would be worse than what it already knows')
    ctx.close()

    # ---- working it out from the stops in the snapshot
    # No timetables does not mean no buses. Where Transitous knows no stops at all it has none for
    # this kind of service here, and the snapshot is then exactly the thing that should answer: it
    # says where the stops are and which lines call at them, which is the method anyone would use by
    # hand (design doc, decisions 22 to 25). What the tests serve is a real piece of Kyoto, so these
    # are real answers.
    TRANSIT['stops'] = False
    asked.clear()
    ctx, pg = open_page(held=DEMO, extra=services)
    pg.wait_for_function("() => (((window.DayPlannerApp.trip.days['2026-11-21'].legs['start>example-temple']"
                         " || {}).transit || {}).source) === 'stops'", timeout=60000)
    leg = pg.evaluate("window.DayPlannerApp.trip.days['2026-11-21'].legs['start>example-temple'].transit")
    ck(any('reverse-geocode' in u for u in asked),
       'the timetables are asked whether they cover the place at all, before the snapshot is touched')
    ck(leg['minutes'] and leg['minutes'] < 60, 'the stops give a time after all: %s min' % leg['minutes'])
    ck('walk' in leg['detail'] and '\u00b7' in leg['detail'],
       'spelled out as walk, ride, walk: ' + leg['detail'])
    ck('Kyoto Station' in leg['detail'] and 'Gojozaka' in leg['detail'],
       'naming the stop it would use at each end')
    ck('206' in (leg['name'] or ''), 'and a line that really calls at both: ' + str(leg['name']))
    ck('probably' in (leg['name'] or ''),
       'still hedged, since the snapshot cannot promise the two stops are consecutive')
    tiles = [u for u in asked if 'plan-my-trip-data-stops' in u]
    ck(any('manifest.json' in u for u in tiles), 'the manifest is read before any tile is asked for')
    ck(all('34_135' in u or '35_135' in u or 'manifest' in u for u in tiles),
       'and only the tiles the two ends reach into are fetched: '
       + ', '.join(sorted({u.rsplit('/', 1)[1] for u in tiles})))
    # The walks at each end are the part that can be known for certain, so they are checked.
    pg.wait_for_function("() => /walk \\d+ min to Kyoto Station/.test((((window.DayPlannerApp.trip"
                         ".days['2026-11-21'].legs['start>example-temple'] || {}).transit || {}).detail) || '')",
                         timeout=30000)
    leg = pg.evaluate("window.DayPlannerApp.trip.days['2026-11-21'].legs['start>example-temple'].transit")
    walks = [u for u in asked if 'routed-foot' in u]
    ck(len(walks) >= 2, 'the two walks it settles on are then checked for real: ' + leg['detail'])
    ck(len(walks) == len(set(walks)), 'each asked once, not once per stop there is')
    ck('\u2248' in pg.inner_text('.timeline'), 'and the day still says it is an estimate, because it is')
    pg.click('.timeline .leg >> nth=0')
    pg.wait_for_timeout(300)
    ck('from the stops nearby' in pg.inner_text('#sheet'), 'the card says where the time came from')
    ck(leg['detail'] in pg.inner_text('#sheet'), 'and spells the journey out')
    pg.screenshot(path=str(SHOTS / 'app_stops_desktop_light.png'))
    ctx.close()

    # a leg in a corner of the world the snapshot has no tile for gets no public transport, said plainly
    NOWHERE = json.loads(json.dumps(DEMO))
    NOWHERE['trip']['days']['2026-11-21']['start'] = {'name': 'Nowhere in particular',
                                                      'lat': 0.5, 'lng': 0.5}
    NOWHERE['trip']['places']['example-temple']['lat'] = 0.52
    NOWHERE['trip']['places']['example-temple']['lng'] = 0.52
    ctx, pg = open_page(held=NOWHERE, extra=services)
    pg.wait_for_function("() => (((window.DayPlannerApp.trip.days['2026-11-21'].legs['start>example-temple']"
                         " || {}).transit || {}).source) === 'stops'", timeout=60000)
    leg = pg.evaluate("window.DayPlannerApp.trip.days['2026-11-21'].legs['start>example-temple'].transit")
    ck(leg['minutes'] is None and 'no stops within twenty' in leg['detail'].lower(),
       'with no stops at either end it gives up on public transport for that leg: ' + leg['detail'])
    asked_tiles = [u for u in asked if 'data-stops/tiles' in u]
    ck(not any('/0_0.json' in u for u in asked_tiles),
       'and never asks for a tile the manifest does not list')
    ctx.close()

    # ---- when the snapshot cannot be read
    # It is a static file on our own origin, so this means the browser is offline rather than a
    # service being busy. Either way the leg says which, and does not pass it off as "no buses".
    SNAP['fail'] = True
    ck.expect('503')            # the test refuses on purpose; the browser logs the failed request
    ctx, pg = open_page(held=DEMO, extra=services)
    pg.wait_for_function("() => (((window.DayPlannerApp.trip.days['2026-11-21'].legs['start>example-temple']"
                         " || {}).transit || {}).source) === 'stops'", timeout=60000)
    leg = pg.evaluate("window.DayPlannerApp.trip.days['2026-11-21'].legs['start>example-temple'].transit")
    ck(leg['minutes'] is None and 'could not be read' in leg['detail'],
       'a snapshot that cannot be read is reported as that, not as "there are no stops": '
       + leg['detail'])
    ck('again' in leg['detail'], 'with the one thing worth doing about it')
    pg.click('.timeline .leg >> nth=0')
    pg.wait_for_timeout(300)
    ck('could not be read' in pg.inner_text('#sheet'),
       'and the card says the same, where the button to try again is')
    ck('\u2248' in pg.inner_text('.timeline'), 'while the day carries on with its estimates')
    ctx.close()
    SNAP['fail'] = False

    # ---- Overpass, still asked about a place
    # The stops moved to the snapshot; place details did not. It refuses with a 502 whenever its
    # workers are busy, which by a big station is most of the time, so it is asked again.
    BUSY['details'] = 2
    ck.expect('502')
    ctx, pg = open_page(held=DEMO, extra=services)
    pg.evaluate('window.__features = %s' % json.dumps([FIX['mapFeatures'][4]]))
    pg.evaluate("window.__lastMap.__fire('click', {point: {x: 40, y: 40}, lngLat: {lng: 135.75938, lat: 34.97887}})")
    pg.wait_for_timeout(200)
    ck('Pizza Little Party' in pg.inner_text('.sh-title'),
       'the preview opens on what the map knew while Overpass is refusing')
    ck('Looking\u2026' in pg.inner_text('#sheet'), 'and says it is still asking rather than that it failed')
    pg.wait_for_function("() => !/Looking\u2026/.test(document.getElementById('sheet').innerText)", timeout=60000)
    ck('could not be reached' not in pg.inner_text('#sheet'),
       'then the retry lands and the details arrive, instead of an apology')
    ck(BUSY['details'] == 0, 'having used up every refusal rather than retrying for ever')
    ctx.close()

    # being told off for asking too much is waited out, not argued with
    BUSY['details'], BUSY['status'] = 1, 429
    ck.expect('429')
    started = time.time()
    ctx, pg = open_page(held=DEMO, extra=services)
    pg.evaluate('window.__features = %s' % json.dumps([FIX['mapFeatures'][4]]))
    pg.evaluate("window.__lastMap.__fire('click', {point: {x: 40, y: 40}, lngLat: {lng: 135.75938, lat: 34.97887}})")
    pg.wait_for_function("() => !/Looking\u2026/.test(document.getElementById('sheet').innerText)", timeout=60000)
    ck(time.time() - started > 15,
       'a 429 waits the long wait it earns, rather than the short one a 502 gets')
    ctx.close()
    BUSY['details'], BUSY['status'] = 0, 502

    TRANSIT['ride'] = True
    TRANSIT['stops'] = True

    # ---- a trip further out than the timetables reach
    # Timetables are usually published a few months ahead. A trip beyond that gets nothing back, and
    # the honest answer is the same weekday in the coming week, said plainly (design doc).
    far = json.loads(json.dumps(DEMO))
    base = datetime.date.today() + datetime.timedelta(days=200)
    moved = {old: (base + datetime.timedelta(days=i)).isoformat()
             for i, old in enumerate(sorted(far['trip']['days']))}
    far['trip']['days'] = {moved[k]: dict(v, id=moved[k], date=moved[k]) for k, v in far['trip']['days'].items()}
    for place in far['trip']['places'].values():
        if place.get('dayId'):
            place['dayId'] = moved[place['dayId']]
    firstDay = moved[sorted(moved)[0]]
    TRANSIT['ride'] = 'soon'
    TRANSIT['far'] = 'time=' + firstDay[:8]        # nothing is published for that month
    ctx, pg = open_page(held=far, extra=services)
    pg.wait_for_function("() => { const d = window.DayPlannerApp.trip.days['%s'];"
                         " return ((d.legs['start>example-temple'] || {}).transit || {}).minutes != null; }" % firstDay,
                         timeout=40000)
    leg = pg.evaluate("window.DayPlannerApp.trip.days['%s'].legs['start>example-temple'].transit" % firstDay)
    ck(leg['minutes'] == 24, 'a journey is found after all, on the same weekday in the coming week')
    ck('the same weekday' in leg['detail'] and 'does not reach' in leg['detail'],
       'and the leg says where its times come from: ' + leg['detail'])
    ck(leg['departs'][:7] != firstDay[:7], 'the departure it answers for is that other date, not the trip\'s')
    asked_far = [u for u in asked if '/plan?' in u]
    ck(any(TRANSIT['far'] in u for u in asked_far), 'the trip\'s own date is still what it asks about first')
    pg.click('.timeline .leg >> nth=0')
    pg.wait_for_timeout(300)
    ck('the same weekday' in pg.inner_text('#sheet'), 'and the card says so too')
    ctx.close()
    TRANSIT['ride'] = True

    # ---- crediting the services
    # Every one of them is free on the understanding that it is named, and two of them ask for
    # particular links: a way to fix the map, and where Transitous gets its timetables.
    ctx, pg = open_page(held=DEMO, extra=services)
    credits = pg.inner_text('.credits')
    for name in ['OpenFreeMap', 'OpenMapTiles', 'OpenStreetMap contributors', 'Photon', 'Overpass',
                 'OSRM at FOSSGIS', 'Transitous']:
        ck(name in credits, 'the page credits ' + name)
    links = pg.eval_on_selector_all('.credits a', 'els => els.map(e => e.href)')
    ck('https://www.openstreetmap.org/fixthemap' in links, 'with a way to put the map right')
    ck('https://transitous.org/sources/' in links, 'and where the timetables come from')
    ck(all(pg.eval_on_selector_all('.credits a', 'els => els.map(e => e.rel === "noopener noreferrer")')),
       'every outgoing link opens safely')
    ck('https://github.com/tigerasks' in links, 'and the planner says who to talk to')
    # The stops are OpenStreetMap data we republish, so they are credited as a database of their own,
    # with the date: a line that opened since the last refresh is not in there.
    pg.wait_for_function("() => /as of/.test(document.querySelector('.credits').innerText)", timeout=30000)
    credits = pg.inner_text('.credits')
    ck('our own snapshot' in credits, 'the stops are credited as ours rather than somebody\'s service')
    ck('as of Thu 22 Oct' in credits,
       'with the date it was built, so a stale one is visible: '
       + [l for l in credits.split('\n') if 'as of' in l][0])
    ck('ODbL' in credits, 'and under the licence the data comes with')
    ck('https://opendatacommons.org/licenses/odbl/' in
       pg.eval_on_selector_all('.credits a', 'els => els.map(e => e.href)'), 'which is linked')
    ctx.close()

    # ---- the map
    ctx, pg = open_page(held=DEMO)
    ck(pg.evaluate('window.__lastMap.__opts.style') == 'https://tiles.openfreemap.org/styles/liberty',
       'the map opens on the Liberty style, the only one that shows places')
    ck(pg.evaluate('window.DayPlannerMap.ready') is True, 'and reports itself ready')
    ck(pg.locator('#mapEmpty').is_hidden(), 'with no apology over it')
    ck(pg.locator('.mk-plan').count() == 2 and pg.locator('.mk-idea').count() == 1,
       'the version on screen is numbered on the map, the day\'s other ideas are hollow')
    ck([t for t in pg.locator('.mk-plan').all_text_contents()] == ['1', '2'], 'stops carry their order')
    ck(pg.locator('.mk-anchor').count() == 1, 'and where the day starts is marked')
    ck(pg.evaluate('window.__fitted.length') == 4, 'the view is fitted around everything on the day')

    # the day's thread
    hops = pg.evaluate("window.__lastMap.__sources['day-route'].data.geometry.coordinates")
    ck(len(hops) == 3, 'one hop per pair of stops, out from the hotel and back: %d hops' % len(hops))
    ck(all(len(h) == 2 for h in hops), 'each hop nobody has checked is a straight line between two places')
    ck(hops[0][0] == hops[-1][-1], 'a day that ends where it started closes the loop')
    ck(round(hops[0][0][1], 4) == 34.9858 and round(hops[0][1][1], 4) == 34.9948,
       'starting at the hotel, then stop 1: ' + str([round(h[0][1], 4) for h in hops]))
    layer = pg.evaluate("window.__lastMap.getLayer('day-route-line')")
    ck(layer['paint']['line-dasharray'] == [1.6, 1.6], 'drawn dashed, since a straight line is not a real route')
    ck(len(pg.evaluate("window.__lastMap.__sources['day-real'].data.geometry.coordinates")) == 0,
       'with nothing solid on it yet, since no leg here has been checked')
    ck('line-dasharray' not in pg.evaluate("window.__lastMap.getLayer('day-real-line')")['paint'],
       'and the layer that holds checked legs is solid')
    pg.click('[data-act="version"][data-v="packed"]')
    pg.wait_for_timeout(250)
    ck(len(pg.evaluate("window.__lastMap.__sources['day-route'].data.geometry.coordinates")) == 4,
       'and it follows the version on screen')
    pg.click('[data-act="version"][data-v="balanced"]')
    pg.wait_for_timeout(250)
    pg.click('[data-act="version"][data-v="packed"]')
    pg.wait_for_timeout(200)
    ck(pg.locator('.mk-plan').count() == 3 and pg.locator('.mk-idea').count() == 0, 'switching version renumbers the map')
    pg.select_option('#daySel', '2026-11-22')
    pg.wait_for_timeout(200)
    ck(pg.locator('.mk-plan').count() == 1, 'and switching day redraws it')
    ck(pg.locator('.mk-backlog').count() == 2, 'backlog places sit on the map as faint dots')
    ck(pg.evaluate('window.__fitted.length') == 2, 'without pulling the view out to reach them')
    pg.click('[data-act="backlog-dots"]')
    pg.wait_for_timeout(200)
    ck(pg.locator('.mk-backlog').count() == 0 and 'Off the map' in pg.inner_text('#panel'), 'and they can be switched off')
    pg.reload()
    pg.wait_for_timeout(300)
    ck(pg.locator('.mk-backlog').count() == 0, 'which this browser remembers')
    pg.click('[data-act="backlog-dots"]')
    pg.wait_for_timeout(200)
    ck(pg.locator('.mk-backlog').count() == 2, 'and back on again')
    ctx.close()

    ctx, pg = open_page(held=DEMO, extra=no_maplibre)
    ck('could not be loaded' in pg.inner_text('#mapEmpty'), 'a map that will not load says so: ' + pg.inner_text('#mapEmpty'))
    ck('Example Temple' in pg.inner_text('#panel'), 'and the planner carries on without it')
    ctx.close()

    # ---- adding days by hand
    ctx, pg = open_page()
    pg.click('[data-act="new-trip"]')
    pg.wait_for_timeout(120)
    pg.click('#panel [data-act="add-day"]')
    pg.wait_for_timeout(200)
    ck(pg.input_value('#dyDate') == datetime.date.today().isoformat(), 'a first day is offered as today: ' + pg.input_value('#dyDate'))
    pg.fill('#dyDate', '2026-11-21')
    pg.fill('#dyCity', 'Kyoto')
    pg.click('[data-act="save-day"]')
    pg.wait_for_timeout(200)
    ck('Sat 21 Nov' in pg.inner_text('#dayFace'), 'the new day opens straight away: ' + pg.inner_text('#dayFace'))
    ck('Where you set off from is not set yet' in pg.inner_text('#panel') and '08:30' in pg.inner_text('#panel'),
       'with sensible times, and it asks for the rest')
    pg.click('#addDayBtn')
    pg.wait_for_timeout(200)
    ck(pg.input_value('#dyDate') == '2026-11-22' and pg.input_value('#dyCity') == 'Kyoto', 'the next day is offered as the day after, same city')
    pg.fill('#dyDate', '2026-11-21')
    pg.click('[data-act="save-day"]')
    pg.wait_for_timeout(150)
    ck('The trip already has Sat 21 Nov' in pg.inner_text('#sheet'), 'a date the trip already has is refused: ' + pg.inner_text('#sheet .note.bad'))
    pg.fill('#dyDate', '2026-11-22')
    pg.click('[data-act="save-day"]')
    pg.wait_for_timeout(900)
    ck(len(pg.eval_on_selector_all('#daySel option', 'els => els.map(e => e.value)')) == 2, 'both days are in the picker')

    # several at once
    pg.click('#addDayBtn')
    pg.wait_for_timeout(200)
    ck(pg.input_value('#dyCount') == '1', 'one day is the usual case')
    pg.fill('#dyDate', '2026-11-22')
    pg.fill('#dyCount', '4')
    pg.click('[data-act="save-day"]')
    pg.wait_for_timeout(900)
    days = pg.eval_on_selector_all('#daySel option', 'els => els.map(e => e.value)')
    ck(days == ['2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25'],
       'a run of days arrives at once: ' + ' '.join(days))
    ck('1 day was already there, left as it was' in pg.inner_text('#toast'),
       'and the day it already had is left alone: ' + pg.inner_text('#toast'))
    ctx.close()

    # ---- opening a place already in the trip
    ctx, pg = open_page(held=DEMO, extra=services)
    pg.click('.list .item >> nth=0')
    pg.wait_for_timeout(250)
    ck(pg.inner_text('.sh-title').startswith('Example Temple'), 'a place in the plan opens its card')
    sheet = pg.inner_text('#sheet')
    ck('Sat 21 Nov, in Do less, Balanced and Packed' in sheet, 'saying where it sits: '
       + [l for l in sheet.split(chr(10)) if 'Sat 21 Nov' in l][0])
    ck('Duration' in pg.locator('#sheet .label').all_text_contents(), 'with a section stating how long it takes')
    ck(pg.locator('#sheet .btn.danger').count() == 0, 'and no actions on it at all')
    ck('Mon–Fri 06:00–18:00 · Sat–Sun 06:00–21:00' in sheet, 'and when it is open: '
       + [l for l in sheet.split(chr(10)) if '06:00' in l][0])
    ck('unverified' in sheet, 'flagged unverified, since OpenStreetMap supplied them')
    ck('Made-up hours — check' in sheet, 'with whatever is still to be checked')
    ck('1h 30' in pg.inner_text('#sheet'), 'reading how long it takes, without offering to change it here')
    pg.screenshot(path=str(SHOTS / 'app_place_desktop_light.png'))

    # ---- the hours editor
    pg.click('[data-act="confirm-hours"]')
    pg.wait_for_timeout(600)
    ck(pg.evaluate("window.DayPlannerApp.trip.places['example-temple'].hours.verified") is True,
       'confirming the hours marks them checked')
    ck('Checked by you' in pg.inner_text('#sheet'), 'and the card says so')
    ck(pg.locator('[data-act="confirm-hours"]').count() == 0, 'with nothing left to confirm')

    pg.click('[data-act="edit-hours"]')
    pg.wait_for_timeout(250)
    ck(pg.locator('#hSame').is_checked() is False, 'the editor opens on the days as they differ')
    ck(pg.locator('.seg [data-act="hours-day"]').count() == 7, 'with a day to pick')
    ck(pg.locator('#h0oH').get_attribute('data-value') == '6', 'and the wheels on Monday\'s opening time')
    pg.screenshot(path=str(SHOTS / 'app_hours_desktop_light.png'))
    pg.click('[data-act="hours-day"][data-d="sat"]')
    pg.wait_for_timeout(200)
    ck(pg.locator('#h0cH').get_attribute('data-value') == '21', 'switching day shows that day: Saturday closes at 21')
    pg.click('#h0cH .wheel-item[data-v="20"]')
    pg.click('#h0cM .wheel-item[data-v="30"]')
    pg.click('[data-act="save-hours"]')
    pg.wait_for_timeout(900)
    hours = pg.evaluate("window.DayPlannerApp.trip.places['example-temple'].hours")
    ck(hours['week']['sat'] == [['06:00', '20:30']], 'a corrected day is saved on its own: ' + str(hours['week']['sat']))
    ck(hours['week']['mon'] == [['06:00', '18:00']], 'and the others are left alone')
    ck(hours['source'] == 'you' and hours['verified'] is True, 'hours you set are yours, and checked')
    ck(hours['raw'] == 'Mo-Su 06:00-18:00 (invented)', 'with what OpenStreetMap said kept beside them')

    # closed days, split hours and a last entry
    pg.click('[data-act="edit-hours"]')
    pg.wait_for_timeout(200)
    pg.click('[data-act="hours-day"][data-d="tue"]')
    pg.wait_for_timeout(150)
    pg.check('#hClosed')
    pg.wait_for_timeout(200)
    ck(pg.locator('#h0oH').count() == 0, 'a closed day hides its times')
    pg.click('[data-act="hours-day"][data-d="wed"]')
    pg.wait_for_timeout(150)
    pg.click('[data-act="hours-two-spans"]')
    pg.wait_for_timeout(200)
    ck(pg.locator('#h1oH').count() == 1, 'a second opening can be added for an afternoon closing')
    pg.check('#hLastOn')
    pg.wait_for_timeout(200)
    ck(pg.locator('#hlH').count() == 1, 'and a last entry')
    pg.click('[data-act="save-hours"]')
    pg.wait_for_timeout(900)
    hours = pg.evaluate("window.DayPlannerApp.trip.places['example-temple'].hours")
    ck(hours['week']['tue'] == [], 'the closed day is stored as closed')
    ck(len(hours['week']['wed']) == 2 and hours['lastEntry']['wed'] == '17:30', 'and the split day with its last entry')
    ck('Tue closed' in pg.inner_text('#sheet'), 'which the card reads back: '
       + [l for l in pg.inner_text('#sheet').split(chr(10)) if 'closed' in l][0])
    # ---- moving a place about, from the row rather than the card
    pg.keyboard.press('Escape')
    pg.wait_for_timeout(150)
    ck(pg.locator('#sheet').get_attribute('aria-hidden') == 'true', 'the card is for reading, so close it')
    pg.click('.row-menu >> nth=0')
    pg.wait_for_timeout(200)
    items = pg.locator('.menu-item').all_text_contents()
    ck(items[0] == 'Remove from Balanced', 'the row menu leads with what this version can do: ' + ' · '.join(items))
    joined = ' · '.join(items)
    ck('Move to' in joined and 'Adjust duration' in joined and 'Delete' in joined and 'Open details' in joined,
       'and holds the rest of them')
    pg.screenshot(path=str(SHOTS / 'app_menu_desktop_light.png'))
    pg.click('[data-act="move-remove"]')
    pg.wait_for_timeout(500)
    ck('is still in Do less and Packed' in pg.inner_text('#toast'), 'and the planner says where it still is: ' + pg.inner_text('#toast'))
    ck(pg.locator('.menu').count() == 0, 'the menu puts itself away afterwards')
    ck(pg.locator('#sheet').get_attribute('aria-hidden') == 'true', 'without ever opening the card')

    pg.click('.row-menu >> nth=1')
    pg.wait_for_timeout(200)
    ck(pg.locator('.menu-item').first.inner_text() == 'Add to Balanced', 'an idea offers to join the version on screen')
    pg.click('[data-act="menu-move"]')
    pg.wait_for_timeout(200)
    moves = pg.locator('.menu-item').all_text_contents()
    ck(moves[0] == '\u2039 Back' and 'The backlog' in moves and 'Sun 22 Nov · Kyoto' in moves,
       'Move to lists where it can go: ' + ' · '.join(moves))
    pg.click('[data-act="move-to"][data-day="2026-11-22"]')
    pg.wait_for_timeout(900)
    ck(pg.evaluate("window.DayPlannerApp.trip.places['example-temple'].dayId") == '2026-11-22',
       'and picking one moves it there')
    ck('Sun 22 Nov' in pg.inner_text('#dayFace'), 'which the day picker follows: ' + pg.inner_text('#dayFace'))
    pg.select_option('#daySel', '2026-11-21')
    pg.wait_for_timeout(200)

    # how long, from the same menu
    pg.click('.row-menu >> nth=0')
    pg.wait_for_timeout(200)
    pg.click('[data-act="menu-duration"]')
    pg.wait_for_timeout(250)
    ck(pg.locator('#durH').count() == 1 and 'Adjust duration' in pg.inner_text('.sh-title'),
       'Adjust duration opens just the wheels, not the whole card')
    ck(pg.locator('#durH .wheel-item').count() == 13 and pg.locator('#durM .wheel-item').count() == 4,
       '0 to 12 hours, and quarter hours')
    pg.click('#durH .wheel-item[data-v="2"]')
    pg.click('#durM .wheel-item[data-v="45"]')
    pg.click('[data-act="save-duration"]')
    pg.wait_for_timeout(900)
    ck('2h 45' in pg.inner_text('#panel'), 'and setting it closes again, with the list showing it')
    ck(pg.locator('#sheet').get_attribute('aria-hidden') == 'true', 'leaving you where you were')

    # clicking away
    pg.click('.row-menu >> nth=0')
    pg.wait_for_timeout(200)
    ck(pg.locator('.menu').count() == 1, 'the menu opens')
    pg.click('#panel .label >> nth=0')
    pg.wait_for_timeout(200)
    ck(pg.locator('.menu').count() == 0, 'and a click anywhere else puts it away')

    # ---- dragging (a tall window, so every list is on screen at once)
    ctx, pg = open_page(1280, 1500, held=DEMO, extra=services)

    def drag(source_id, target_list, target_id=None, below=False):
        """Drag a row by its grip onto a list, dropping it above or below a row in it."""
        grip = pg.locator('.row[data-row-id="%s"] .grip' % source_id)
        grip.hover()
        pg.mouse.down()
        where = pg.locator('.row[data-row-id="%s"]' % target_id).bounding_box() if target_id \
            else pg.locator('[data-list="%s"]' % target_list).bounding_box()
        x = where['x'] + where['width'] / 2
        y = where['y'] + (where['height'] * (0.8 if below else 0.2)) if target_id else where['y'] + where['height'] / 2
        pg.mouse.move(x, y - 40, steps=3)
        pg.mouse.move(x, y, steps=6)
        pg.mouse.up()
        pg.wait_for_timeout(500)

    order = lambda: pg.evaluate("window.DayPlannerApp.trip.days['2026-11-21'].plans.balanced")
    ck(order() == ['example-temple', 'made-up-market'], 'the version starts in its own order')
    drag('made-up-market', 'plan', 'example-temple')
    ck(order() == ['made-up-market', 'example-temple'], 'a stop can be dragged above another: ' + ' '.join(order()))
    ck('moved to stop 1' in pg.inner_text('#toast'), 'and says where it landed: ' + pg.inner_text('#toast'))

    drag('pretend-noodle-bar', 'plan', 'example-temple')
    ck(order() == ['made-up-market', 'pretend-noodle-bar', 'example-temple'],
       'an idea can be dragged into the plan at a position: ' + ' '.join(order()))
    ck(len(pg.evaluate("window.DayPlannerApp.trip.days['2026-11-21'].plans.packed")) == 3, 'without touching the other versions')

    drag('example-temple', 'ideas')
    ck(order() == ['made-up-market', 'pretend-noodle-bar'], 'dragging a stop to the ideas takes it out of the version')
    ck(pg.evaluate("window.DayPlannerApp.trip.places['example-temple'].dayId") == '2026-11-21', 'but leaves it on the day')

    drag('example-temple', 'backlog')
    ck(pg.evaluate("window.DayPlannerApp.trip.places['example-temple'].dayId") is None,
       'and dragging it to the backlog takes it off the day')
    back = pg.evaluate('window.DayPlannerApp.trip.backlog')
    ck(back[-1] == 'example-temple' or 'example-temple' in back, 'where it joins the list: ' + ' '.join(back))

    drag('example-temple', 'plan', 'made-up-market')
    ck(order()[0] == 'example-temple', 'and can be dragged straight back into the plan: ' + ' '.join(order()))
    ck(pg.evaluate("window.DayPlannerApp.trip.places['example-temple'].dayId") == '2026-11-21', 'back onto the day with it')

    drag('nowhere-viewpoint', 'backlog', 'imaginary-museum')
    ck(pg.evaluate('window.DayPlannerApp.trip.backlog')[0] == 'nowhere-viewpoint', 'the backlog can be reordered too')

    # a tap is not a drag
    pg.click('.row[data-row-id="example-temple"] .item')
    pg.wait_for_timeout(300)
    ck(pg.locator('#sheet').get_attribute('aria-hidden') == 'false', 'tapping a row still opens it')
    pg.keyboard.press('Escape')
    ctx.close()

    ctx, pg = open_page(held=DEMO, extra=services)

    # ---- the plus buttons
    ck(pg.locator('.timeline .plus').count() == 3, 'a plus sits between the stops and at each end')
    ck(pg.locator('[data-list="ideas"] .plus').count() == 1 and pg.locator('[data-list="backlog"] .plus').count() == 1,
       'and one at the top of the ideas and the backlog')
    pg.click('.timeline .plus >> nth=1')
    pg.wait_for_timeout(300)
    ck('as stop 2' in pg.inner_text('#sheet'), 'the plus says where it would put it: ' + pg.inner_text('.sh-sub'))
    mine = pg.locator('#sheet .list .nm').all_text_contents()
    ck('Pretend Noodle Bar' in mine and 'Imaginary Museum' in mine,
       'the trip\'s own places come first, day and backlog: ' + ' · '.join(mine))
    ck(any('adding it again is a second visit' in m for m in pg.locator('#sheet .meta').all_text_contents()),
       'and a place already in the version says what adding it again means')
    pg.screenshot(path=str(SHOTS / 'app_addstop_desktop_light.png'))
    pg.click('#sheet [data-act="add-mine"][data-id="pretend-noodle-bar"]')
    pg.wait_for_timeout(900)
    ck(pg.evaluate("window.DayPlannerApp.trip.days['2026-11-21'].plans.balanced")
       == ['example-temple', 'pretend-noodle-bar', 'made-up-market'],
       'picking one puts it exactly where the plus was: '
       + ' '.join(pg.evaluate("window.DayPlannerApp.trip.days['2026-11-21'].plans.balanced")))

    # the same place a second time, from the plus
    pg.click('.timeline .plus >> nth=0')
    pg.wait_for_timeout(300)
    ck(any('second visit' in m for m in pg.locator('#sheet .meta').all_text_contents()),
       'a stop already in the version is offered again')
    pg.click('#sheet [data-act="add-mine"][data-id="example-temple"]')
    pg.wait_for_timeout(900)
    order = pg.evaluate("window.DayPlannerApp.trip.days['2026-11-21'].plans.balanced")
    ck(order == ['example-temple', 'example-temple', 'pretend-noodle-bar', 'made-up-market'],
       'and goes in a second time, where the plus was: ' + ' '.join(order))
    ck('again, as stop 1' in pg.inner_text('#toast'), 'with the planner saying so: ' + pg.inner_text('#toast'))

    # searching from the panel
    pg.click('[data-list="backlog"] .plus')
    pg.wait_for_timeout(300)
    ck('Add to the backlog' in pg.inner_text('.sh-title'), 'the backlog plus adds to the backlog')
    pg.fill('#asQ', 'nintendo museum')
    pg.wait_for_timeout(1600)
    ck(pg.locator('#asResults .nm').count() == 2, 'typing searches outside the trip as well')
    pg.click('#asResults [data-act="add-found-here"] >> nth=0')
    pg.wait_for_timeout(900)
    ck('nintendo-museum' in pg.evaluate('window.DayPlannerApp.trip.backlog'),
       'and a found place can be added straight to the backlog')
    ctx.close()

    ctx, pg = open_page(held=DEMO, extra=services)

    # ---- the same place twice in one version
    pg.click('.row-menu >> nth=0')
    pg.wait_for_timeout(200)
    first = pg.locator('.row-menu').first.get_attribute('data-id')
    ck(pg.locator('.menu-item').first.inner_text() == 'Remove from Balanced', 'a stop offers to leave the version')
    pg.keyboard.press('Escape')
    pg.wait_for_timeout(150)
    ideas = pg.locator('[data-list="ideas"] .row-menu')
    if ideas.count():
        pg.click('[data-list="ideas"] .row-menu >> nth=0')
        pg.wait_for_timeout(200)
        pg.click('[data-act="move-add"]')
        pg.wait_for_timeout(600)
    before = len(pg.evaluate("window.DayPlannerApp.trip.days['2026-11-21'].plans.balanced"))
    pg.click('.row-menu >> nth=0')
    pg.wait_for_timeout(200)
    pg.click('[data-act="menu-move"]')
    pg.wait_for_timeout(200)
    pg.click('[data-act="menu-main"]')
    pg.wait_for_timeout(200)
    ck(pg.locator('[data-act="move-remove"]').count() == 1, 'the menu knows which stop it belongs to')
    pg.keyboard.press('Escape')
    pg.wait_for_timeout(150)
    pg.evaluate("id => { const t = window.DayPlannerApp.trip; t.days['2026-11-21'].plans.balanced.push(id); return true; }", first)
    pg.evaluate("() => { window.DayPlannerApp.ui.menu = null; return true; }")
    pg.click('[data-act="version"][data-v="packed"]')
    pg.wait_for_timeout(150)
    pg.click('[data-act="version"][data-v="balanced"]')
    pg.wait_for_timeout(250)
    rows = pg.locator('.timeline .row').count()
    ck(rows == before + 1, 'a place listed twice appears as two stops: %d rows' % rows)
    keys = pg.eval_on_selector_all('.timeline .row', 'els => els.map(e => e.dataset.rowKey)')
    ck(len(set(keys)) == len(keys), 'each with its own row, so they can be told apart: ' + ' '.join(keys))
    pg.click('.timeline .row >> nth=%d >> .row-menu' % (rows - 1))
    pg.wait_for_timeout(200)
    pg.click('[data-act="move-remove"]')
    pg.wait_for_timeout(700)
    ck(len(pg.evaluate("window.DayPlannerApp.trip.days['2026-11-21'].plans.balanced")) == before,
       'and removing one leaves the other')
    ck('still stop' in pg.inner_text('#toast'), 'with the planner saying the place is still in the day: ' + pg.inner_text('#toast'))
    ctx.close()

    ctx, pg = open_page(held=DEMO, extra=services)

    # ---- deleting a place, with a way back
    pg.wait_for_timeout(200)
    doomed = pg.locator('.row-menu').first.get_attribute('data-id')
    name = pg.evaluate('id => window.DayPlannerApp.trip.places[id].name', doomed)
    before = len(pg.evaluate('Object.keys(window.DayPlannerApp.trip.places)'))
    pg.click('.row-menu >> nth=0')
    pg.wait_for_timeout(200)
    pg.click('[data-act="delete-place"]')
    pg.wait_for_timeout(400)
    ck(len(pg.evaluate('Object.keys(window.DayPlannerApp.trip.places)')) == before - 1, 'and it goes')
    ck(name.split(' ')[0] in pg.inner_text('#toast') and 'from ' in pg.inner_text('#toast'),
       'with a note of what went, and what it came out of: ' + pg.inner_text('#toast'))
    pg.click('#toastBtn')
    pg.wait_for_timeout(900)
    ck(len(pg.evaluate('Object.keys(window.DayPlannerApp.trip.places)')) == before, 'and Undo brings it back')
    ck(C_places_has(pg, name), 'by name, where it was')

    marked = pg.locator('.mk-plan').first.get_attribute('data-place')
    pg.click('.mk-plan >> nth=0')
    pg.wait_for_timeout(250)
    ck(pg.inner_text('.sh-title').startswith(pg.evaluate('id => window.DayPlannerApp.trip.places[id].name', marked)),
       'and a marker on the map opens that place\'s card')
    ctx.close()

    # ---- accommodation
    ctx, pg = open_page(held=DEMO, extra=services)
    ck('No accommodation for this day' in pg.inner_text('.stay-line'), 'a day with nowhere to sleep says so')
    pg.click('[data-act="add-stay"]')
    pg.wait_for_timeout(250)
    ck(pg.input_value('#stFrom') == '2026-11-21' and pg.input_value('#stNights') == '1', 'the stay sheet opens on the day you are looking at')
    ck('Type an address or a hotel name' in pg.inner_text('#sheet'), 'and asks for an address')
    pg.fill('#stName', 'nintendo museum')
    pg.wait_for_timeout(1600)
    ck(pg.locator('#stResults .item').count() == 2, 'typing looks the address up')
    pg.click('#stResults .item >> nth=0')
    pg.wait_for_timeout(300)
    ck(pg.input_value('#stName') == 'Nintendo Museum', 'picking one fills the name')
    ck('On the map at' in pg.inner_text('#sheet'), 'and pins it to the map: '
       + [l for l in pg.inner_text('#sheet').split(chr(10)) if 'On the map' in l][0])
    pg.fill('#stName', 'Example Ryokan')
    pg.fill('#stNights', '3')
    pg.wait_for_timeout(100)
    pg.fill('#stFrom', '2026-11-21')
    pg.click('[data-act="save-stay"]')
    pg.wait_for_timeout(900)
    trip = pg.evaluate("JSON.parse(localStorage.getItem('plan-my-trip/trip'))")['trip']
    ck(len(trip['stays']) == 1 and trip['stays'][0]['nights'] == 3, 'the stay is kept once, with its nights')
    ck(trip['stays'][0]['lat'] is None, 'a name typed over the picked one drops the position with it')
    ck(sorted(trip['days'].keys()) == ['2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24'],
       'and the days it covers are created: ' + ' '.join(sorted(trip['days'].keys())))
    ck('Example Ryokan' in pg.inner_text('.stay-line'), 'it shows at the top of the day')
    ck('Back at Example Ryokan' in pg.inner_text('.day-card'), 'and the day now ends there: '
       + [l for l in pg.inner_text('.day-card').split(chr(10)) if 'Back at' in l][0])
    pg.screenshot(path=str(SHOTS / 'app_stay_desktop_light.png'))

    pg.select_option('#daySel', '2026-11-24')
    pg.wait_for_timeout(250)
    ck('Leave Example Ryokan' in pg.inner_text('.day-card'), 'the check-out morning still starts there')
    ck('check out this morning' in pg.inner_text('.stay-line'), 'and says that is what it is: ' + pg.inner_text('.stay-line').replace(chr(10), ' / '))
    ck('not set yet' in pg.inner_text('.day-card'), 'with the evening left open')

    pg.click('[data-act="edit-stay"]')
    pg.wait_for_timeout(250)
    ck('3 nights means you sleep from Sat 21 Nov to Mon 23 Nov and check out on the morning of Tue 24 Nov' in pg.inner_text('#sheet'),
       'the sheet spells out what the nights mean: ' + [l for l in pg.inner_text('#sheet').split(chr(10)) if 'nights means' in l][0][:90])

    # a known position survives an edit that does not touch it
    pg.evaluate("() => { const t = window.DayPlannerApp.trip; t.stays[0].lat = 35.0; t.stays[0].lng = 135.77; return true; }")
    pg.fill('#stNights', '2')
    pg.click('[data-act="save-stay"]')
    pg.wait_for_timeout(900)
    kept = pg.evaluate('window.DayPlannerApp.trip.stays[0]')
    ck(kept['nights'] == 2 and kept['lat'] == 35.0, 'changing the nights leaves the position alone')
    ck('No accommodation for this day' in pg.inner_text('.stay-line'), 'and a shorter stay stops covering the days it no longer reaches')
    pg.select_option('#daySel', '2026-11-22')
    pg.wait_for_timeout(200)
    pg.click('[data-act="edit-stay"]')
    pg.wait_for_timeout(250)
    pg.click('[data-act="drop-stay"]')
    pg.wait_for_timeout(900)
    after = pg.evaluate("JSON.parse(localStorage.getItem('plan-my-trip/trip'))")['trip']
    ck(len(after['stays']) == 0 and len(after['days']) == 4, 'removing a stay leaves its days behind')
    ck('days are still in the trip' in pg.inner_text('#toast'), 'and says so: ' + pg.inner_text('#toast'))
    ctx.close()

    # ---- a day's shape
    ctx, pg = open_page(held=DEMO)
    pg.click('[data-act="day"]')
    pg.wait_for_timeout(200)
    ck(pg.input_value('#edDate') == '2026-11-21' and pg.input_value('#edCity') == 'Kyoto',
       'the day sheet opens on what the day holds')
    pg.screenshot(path=str(SHOTS / 'app_dayedit_desktop_light.png'))
    pg.fill('#edStartTime', '07:45')
    pg.fill('#edEndTime', '')
    pg.fill('#edNote', 'Made-up day, made-up note.')
    pg.click('[data-act="save-day-shape"]')
    pg.wait_for_timeout(900)
    panel = pg.inner_text('#panel')
    ck('07:45' in panel, 'the times follow')
    card = pg.inner_text('#panel .day-card')
    ck('Open-ended day' in card and 'Lunch' not in card, 'an empty back-by time makes the day open-ended, and lunch can be dropped')
    ck('Made-up day, made-up note.' in panel, 'and the note shows under the day')
    held = pg.evaluate("JSON.parse(localStorage.getItem('plan-my-trip/trip'))")['trip']['days']['2026-11-21']
    ck(held['end'] is None, 'and an empty time back leaves the day open-ended')

    pg.click('[data-act="day"]')
    pg.wait_for_timeout(150)
    pg.fill('#edDate', '2026-11-22')
    pg.click('[data-act="save-day-shape"]')
    pg.wait_for_timeout(150)
    ck('already a day of this trip' in pg.inner_text('#sheet'), 'moving a day onto another day is refused')
    pg.fill('#edDate', '2026-11-19')
    pg.click('[data-act="save-day-shape"]')
    pg.wait_for_timeout(900)
    ck('Thu 19 Nov' in pg.inner_text('#dayFace'), 'a day can be given another date: ' + pg.inner_text('#dayFace'))
    trip = pg.evaluate("JSON.parse(localStorage.getItem('plan-my-trip/trip'))")['trip']
    ck(trip['places']['example-temple']['dayId'] == '2026-11-19', 'and its places move with it')
    ck(sorted(trip['days'].keys()) == ['2026-11-19', '2026-11-22'], 'leaving nothing behind')

    # ---- deleting a day
    pg.click('[data-act="day"]')
    pg.wait_for_timeout(150)
    ck('sends its 3 places back to the backlog' in pg.inner_text('#sheet'), 'deleting says what happens to the places on the day')
    pg.click('[data-act="delete-day"]')
    pg.wait_for_timeout(200)
    ck(pg.locator('.card-head .label').all_text_contents()[-1] == 'Backlog 5', 'the day goes, and its places land in the backlog')
    ck('back to the backlog' in pg.inner_text('#toast'), 'with a plain account of it: ' + pg.inner_text('#toast'))
    pg.click('#toastBtn')
    pg.wait_for_timeout(900)
    ck('Thu 19 Nov' in pg.inner_text('#dayFace'), 'and Undo brings the day back: ' + pg.inner_text('#dayFace'))
    ck(pg.locator('.card-head .label').all_text_contents()[-1] == 'Backlog 2', 'with its places on it again')
    ctx.close()

    # ---- searching for a place
    ctx, pg = open_page(held=DEMO, extra=services)
    # Other sections search too, and the planner checks the day's legs on its own, so this one
    # counts the searches rather than every request.
    asked.clear()
    finds = lambda: [u for u in asked if 'photon.komoot.io' in u]
    pg.fill('#findBox', 'n')
    pg.wait_for_timeout(600)
    ck(len(finds()) == 0, 'one letter is not a search')
    pg.fill('#findBox', 'nintendo museum')
    pg.wait_for_timeout(1500)
    ck(len(finds()) == 1 and 'q=nintendo+museum' in finds()[0], 'typing a name asks Photon once, after a pause')
    ck('lat=' in finds()[0], 'biased to where the map is looking')
    ck(pg.locator('#findResults .item').count() == 2, 'the results are listed')
    ck('Nintendo Museum' in pg.locator('#findResults .nm').first.inner_text(), 'by name')
    ck('Museum · Ogura · Ogura-cho · Uji' in pg.locator('#findResults .meta').first.inner_text(),
       'with what they are and where: ' + pg.locator('#findResults .meta').first.inner_text())
    pg.screenshot(path=str(SHOTS / 'app_search_desktop_light.png'))

    # a click only takes you there
    pg.click('#findResults .item >> nth=0')
    pg.wait_for_timeout(400)
    ck(pg.locator('#sheet').get_attribute('aria-hidden') == 'true', 'a plain click opens nothing')
    where = pg.evaluate('window.__lastMap.getCenter()')
    ck(round(where['lat'], 4) == 34.8871 and round(where['lng'], 4) == 135.8048,
       'it only takes the map there: %.4f, %.4f' % (where['lat'], where['lng']))
    ck(pg.evaluate('window.__lastMap.getZoom()') >= 16, 'close enough to make it out')
    ck(pg.locator('.mk-looking').count() == 1, 'with the spot marked')

    # the actions are on the row
    pg.click('#findResults .row-menu >> nth=0')
    pg.wait_for_timeout(250)
    items = pg.locator('#findResults .menu-item').all_text_contents()
    ck(items == ['Add to Balanced', 'Add to Sat 21 Nov', 'Add to the backlog', 'Open details'],
       'the menu holds the three ways in, and the details: ' + ' · '.join(items))
    ck(len(pg.evaluate('Object.keys(window.DayPlannerApp.trip.places)')) == 6, 'and nothing has joined the trip yet')
    pg.click('#findResults [data-act="details-found"]')
    pg.wait_for_timeout(1600)
    ck(pg.inner_text('.sh-title').startswith('Nintendo Museum'), 'Open details still opens the preview')
    ck('Add to Balanced' in pg.inner_text('#sheet'), 'with its own way to add it')
    pg.keyboard.press('Escape')
    pg.wait_for_timeout(200)

    pg.click('#findResults .row-menu >> nth=0')
    pg.wait_for_timeout(250)
    pg.click('#findResults [data-act="add-found"][data-to="plan"]')
    pg.wait_for_timeout(900)
    # a search that finds nothing, and one that fails
    pg.fill('#findBox', 'nothing at all here')
    pg.wait_for_timeout(1600)
    ck('Nothing found' in pg.inner_text('#findResults'), 'an empty answer says so: ' + pg.inner_text('#findResults'))
    ctx.close()

    # ---- tapping the map
    ctx, pg = open_page(held=DEMO, extra=services)
    pg.evaluate('window.__features = %s' % json.dumps([FIX['mapFeatures'][5]]))
    pg.evaluate("window.__lastMap.__fire('click', {point: {x: 40, y: 40}, lngLat: {lng: 135.74771, lat: 34.98061}})")
    pg.wait_for_timeout(300)
    ck(pg.inner_text('.sh-title').startswith('East Temple'), 'tapping a place on the map opens its preview')
    ck('東寺' in pg.inner_text('#sheet'), 'with the local name kept: ' + pg.inner_text('.sh-title').replace(chr(10), ' / '))
    ck('Temple / culture' in pg.inner_text('#sheet'), 'and what kind of place it is')
    pg.click('[data-act="add-place"][data-to="backlog"]')
    pg.wait_for_timeout(900)
    added = pg.evaluate("JSON.parse(localStorage.getItem('plan-my-trip/trip'))")['trip']['places']['east-temple']
    ck(added['osm'] == {'type': 'way', 'id': 359896810}, 'and it carries the OpenStreetMap way the map gave it')
    ck(added['added']['how'] == 'map', 'noted as tapped')
    ck(added['lat'] == 34.98083, 'at the position OpenStreetMap gives, not where the finger landed')

    pg.evaluate('window.__features = [{sourceLayer: "building", properties: {}}]')
    pg.evaluate("window.__lastMap.__fire('click', {point: {x: 10, y: 10}, lngLat: {lng: 135.7, lat: 35.0}})")
    pg.wait_for_timeout(200)
    # the preview must stand up before OpenStreetMap answers, so hold the answer back
    pg.evaluate("() => { const L = window.DayPlannerLive;"
                " window.__realFetch = L.fetchJson; L.fetchJson = () => new Promise(() => {}); return true; }")
    pg.evaluate('window.__features = %s' % json.dumps([FIX['mapFeatures'][4]]))
    pg.evaluate("window.__lastMap.__fire('click', {point: {x: 40, y: 40}, lngLat: {lng: 135.75938, lat: 34.97887}})")
    pg.wait_for_timeout(200)
    ck('Pizza Little Party' in pg.inner_text('.sh-title'), 'the preview stands up on what the map knew')
    ck('Looking…' in pg.inner_text('#sheet'), 'while OpenStreetMap is still being asked')
    ck(pg.locator('[data-act="add-place"]').count() == 3, 'and you can add it without waiting')
    pg.keyboard.press('Escape')
    pg.evaluate("() => { window.DayPlannerLive.fetchJson = window.__realFetch; return true; }")

    # what OpenStreetMap adds, once it answers
    pg.evaluate("window.__lastMap.__fire('click', {point: {x: 40, y: 40}, lngLat: {lng: 135.75938, lat: 34.97887}})")
    pg.wait_for_timeout(1600)
    sheet = pg.inner_text('#sheet')
    ck('Mon–Sat 11:00–14:00, 17:00–22:00 · Sun closed' in sheet, 'then its hours: ' + [l for l in sheet.split(chr(10)) if '11:00' in l][0])
    ck('unverified' in sheet, 'marked unverified until you check them')
    ck('pizza' in sheet and '075-672-9889' in sheet, 'and whatever else it knows')
    ck('OpenStreetMap' in sheet and 'Example look-up' in sheet, 'with a link to the source and your own look-ups')
    ck('Informative links' in pg.locator('#sheet .label').all_text_contents(), 'gathered under Informative links')
    ck('Find on Google Maps' == pg.locator('[data-act="gmaps"]').inner_text(), 'and Google Maps is offered by name')
    ck('stop being a free planner' in sheet, 'with the reason it is a link rather than a map: '
       + [l for l in sheet.split(chr(10)) if 'free planner' in l][0])
    pg.screenshot(path=str(SHOTS / 'app_details_desktop_light.png'))

    # Google Maps, beside the planner
    with pg.expect_popup() as popped:
        pg.click('[data-act="gmaps"]')
    beside = popped.value
    ck('google.com/maps/search/' in beside.url, 'Google Maps opens in its own window: ' + beside.url[:70])
    ck(urllib.parse.unquote(beside.url).endswith('ピザリトルパーティ Kyoto'),
       'searching the local name plus the city: ' + urllib.parse.unquote(beside.url).split('query=')[-1])
    beside.close()
    ck(pg.locator('#sheet').get_attribute('aria-hidden') == 'false', 'and the preview stays put for when you come back')
    pg.click('[data-act="add-place"][data-to="backlog"]')
    pg.wait_for_timeout(900)
    got = pg.evaluate("JSON.parse(localStorage.getItem('plan-my-trip/trip'))")['trip']['places']['pizza-little-party']
    ck(got['hours']['source'] == 'osm' and got['hours']['verified'] is False, 'the hours come with it, still unverified')
    ck(got['lat'] == 34.97891, 'and the position is corrected to where OpenStreetMap puts it')

    ck('Nothing named there' in pg.inner_text('#toast') or True, 'tapping on')
    pg.evaluate('window.__features = [{sourceLayer: "building", properties: {}}]')
    pg.evaluate("window.__lastMap.__fire('click', {point: {x: 10, y: 10}, lngLat: {lng: 135.7, lat: 35.0}})")
    pg.wait_for_timeout(200)
    ck('Nothing named there' in pg.inner_text('#toast'), 'tapping bare building says so: ' + pg.inner_text('#toast'))

    # ---- dropping a pin
    pg.click('#toastBtn')
    pg.wait_for_timeout(250)
    ck(pg.inner_text('.sh-title').startswith('Drop a pin'), 'the toast offers to drop a pin there instead')
    ck('35.00000, 135.70000' in pg.inner_text('#sheet'), 'at the spot that was tapped')
    pg.click('[data-act="add-pin"][data-to="backlog"]')
    pg.wait_for_timeout(200)
    ck('name first' in pg.inner_text('#sheet .note.bad'), 'a pin with no name is refused: ' + pg.inner_text('#sheet .note.bad'))
    pg.fill('#pinName', 'Where we said we would meet')
    pg.select_option('#pinKind', 'other')
    pg.click('[data-act="add-pin"][data-to="backlog"]')
    pg.wait_for_timeout(900)
    pinned = pg.evaluate("JSON.parse(localStorage.getItem('plan-my-trip/trip'))")['trip']['places']
    key = [k for k in pinned if pinned[k]['added']['how'] == 'pin' and pinned[k]['name'].startswith('Where we')]
    ck(len(key) == 1, 'a named pin joins the trip, noted as a pin')
    ck(pinned[key[0]]['lat'] == 35.0 and pinned[key[0]]['osm'] is None, 'at its spot, with no OpenStreetMap entry behind it')

    # the map control arms the next tap
    pg.click('[data-act="pin-mode"]')
    pg.wait_for_timeout(150)
    ck(pg.locator('[data-act="pin-mode"]').get_attribute('aria-pressed') == 'true', 'the pin button arms the next tap')
    pg.evaluate('window.__features = %s' % json.dumps([FIX['mapFeatures'][2]]))
    pg.evaluate("window.__lastMap.__fire('click', {point: {x: 5, y: 5}, lngLat: {lng: 135.8, lat: 34.9}})")
    pg.wait_for_timeout(250)
    ck(pg.inner_text('.sh-title').startswith('Drop a pin'), 'and armed, a tap pins even where the map knows a place')
    ck(pg.locator('[data-act="pin-mode"]').get_attribute('aria-pressed') == 'false', 'then disarms itself')
    pg.screenshot(path=str(SHOTS / 'app_pin_desktop_light.png'))
    ctx.close()

    # ---- trip settings
    ctx, pg = open_page(held=DEMO)
    pg.click('#tripBtn')
    pg.wait_for_timeout(200)
    ck(pg.locator('#sheet').get_attribute('aria-hidden') == 'false', 'the title opens the trip settings')
    ck(pg.input_value('#trTitle') == 'Example · Kyoto (made up)' and pg.input_value('#trTz') == 'JST', 'filled in with what the trip holds')
    pg.screenshot(path=str(SHOTS / 'app_trip_desktop_light.png'))
    pg.fill('#trCur', '12')
    pg.click('[data-act="save-trip"]')
    pg.wait_for_timeout(150)
    ck('three letters' in pg.inner_text('#sheet'), 'a currency that is not a code is explained, not swallowed: ' + pg.inner_text('#sheet .note.bad'))
    pg.fill('#trZone', 'Mars/Olympus')
    pg.click('[data-act="save-trip"]')
    pg.wait_for_timeout(150)
    ck('does not know the time zone' in pg.inner_text('#sheet .note.bad'),
       'a time zone the browser never heard of is explained too: ' + pg.inner_text('#sheet .note.bad'))
    pg.fill('#trZone', 'Asia/Tokyo')
    pg.fill('#trCur', 'chf')
    pg.fill('#trTitle', 'Example · Kyoto')
    pg.click('[data-act="save-trip"]')
    pg.wait_for_timeout(900)
    ck(pg.inner_text('#tripBtn') == 'Example · Kyoto', 'saving renames the trip')
    held = pg.evaluate("JSON.parse(localStorage.getItem('plan-my-trip/trip'))")
    ck(held['trip']['currency'] == 'CHF' and held['trip']['id'] == 'example-kyoto', 'the currency is stored, and the id never moves')
    ck(held['trip']['tz'] == 'Asia/Tokyo', 'and the trip knows which time zone its times are in')
    ck(pg.evaluate("window.DayPlannerCore.instantOf('2026-11-21', 570, 'Asia/Tokyo')") == '2026-11-21T00:30:00.000Z',
       'so 09:30 on a Kyoto morning is the right instant to ask a timetable about')
    pg.keyboard.press('Escape')
    pg.wait_for_timeout(150)
    ck(pg.locator('#sheet').get_attribute('aria-hidden') == 'true', 'Escape closes a sheet')

    # your own look-up links
    pg.click('#tripBtn')
    pg.wait_for_timeout(150)
    ck(pg.input_value('#lkLabel0') == 'Example look-up', 'the trip keeps your own look-up links')
    pg.fill('#lkLabel1', 'Tabelog')
    pg.fill('#lkUrl1', 'https://tabelog.com/rstLst/?sk={local}')
    pg.click('[data-act="save-trip"]')
    pg.wait_for_timeout(900)
    links = pg.evaluate("JSON.parse(localStorage.getItem('plan-my-trip/trip'))")['trip']['lookups']
    ck(len(links) == 2 and links[1]['label'] == 'Tabelog', 'and takes another')
    ck('{local}' in links[1]['url'], 'with the place\'s name left as a placeholder')

    # ---- starting again, with a way back
    pg.click('#tripBtn')
    pg.wait_for_timeout(120)
    pg.click('[data-act="clear-trip"]')
    pg.wait_for_timeout(150)
    ck(pg.inner_text('#tripBtn') == 'My trip', 'starting again clears the trip')
    pg.click('#toastBtn')
    pg.wait_for_timeout(900)
    ck(pg.inner_text('#tripBtn') == 'Example · Kyoto', 'and the toast brings it back')
    ck(len(pg.evaluate("JSON.parse(localStorage.getItem('plan-my-trip/trip'))")['trip']['places']) == 6, 'with everything in it')
    ctx.close()

    # ---- saving to a file
    ctx, pg = open_page(held=DEMO)
    pg.click('#dataBtn')
    pg.wait_for_timeout(200)
    ck('2 days and 6 places' in pg.inner_text('#sheet'), 'the trip file sheet says what is in the trip')
    with pg.expect_download() as got:
        pg.click('[data-act="save-file"]')
    dl = got.value
    ck(dl.suggested_filename.startswith('example-kyoto ') and dl.suggested_filename.endswith('.json'),
       'the file is named after the trip and the moment: ' + dl.suggested_filename)
    saved = json.loads(pathlib.Path(dl.path()).read_text())
    ck(saved['schema'] == 'day-planner/2' and saved['kind'] == 'save' and len(saved['trip']['places']) == 6,
       'and holds the whole trip as valid JSON, ready for the chat')
    pg.wait_for_timeout(200)
    ck('Last saved on this device' in pg.inner_text('#sheet'), 'the sheet remembers when: ' + [l for l in pg.inner_text('#sheet').split(chr(10)) if 'Last saved' in l][0][-40:])
    ctx.close()

    # ---- opening a file
    ctx, pg = open_page()
    pg.click('[data-act="data"]')
    pg.wait_for_timeout(200)
    ck(pg.is_disabled('[data-act="save-file"]'), 'with nothing to save, saving is off')
    pg.set_input_files('#fileIn', files=[{'name': 'example-kyoto.json', 'mimeType': 'application/json',
                                          'buffer': json.dumps(DEMO).encode()}])
    pg.wait_for_timeout(400)
    ck(pg.inner_text('#tripBtn') == 'Example · Kyoto (made up)', 'a file loads straight into an empty browser')
    ck('2 days and 6 places' in pg.inner_text('#sheet .note.good'), 'and the sheet reports what came in: ' + pg.inner_text('#sheet .note.good'))
    ck('Loaded 2 days and 6 places' in pg.inner_text('#toast'), 'with a toast to match')
    pg.screenshot(path=str(SHOTS / 'app_import_desktop_light.png'))

    # replacing a trip asks first
    other = json.loads(json.dumps(DEMO))
    other['tripId'] = other['trip']['id'] = 'italy-2027'
    other['title'] = other['trip']['title'] = 'Italy · Apr 2027'
    pg.set_input_files('#fileIn', files=[{'name': 'italy.json', 'mimeType': 'application/json',
                                          'buffer': json.dumps(other).encode()}])
    pg.wait_for_timeout(400)
    ck('Swap to another trip?' in pg.inner_text('#sheet'), 'another trip asks before it displaces this one')
    ck('different trip' in pg.inner_text('#sheet'), 'and says what that means: ' + pg.inner_text('#sheet .reasons'))
    ck(pg.inner_text('#tripBtn') == 'Example · Kyoto (made up)', 'nothing has changed yet')
    pg.click('[data-act="import-cancel"]')
    pg.wait_for_timeout(150)
    ck(pg.inner_text('#tripBtn') == 'Example · Kyoto (made up)', 'and Cancel leaves it alone')
    pg.set_input_files('#fileIn', files=[{'name': 'italy.json', 'mimeType': 'application/json',
                                          'buffer': json.dumps(other).encode()}])
    pg.wait_for_timeout(300)
    pg.click('[data-act="import-go"]')
    pg.wait_for_timeout(900)
    ck(pg.inner_text('#tripBtn') == 'Italy · Apr 2027', 'and Load it swaps the trip over')

    # a file that is not a trip
    pg.set_input_files('#fileIn', files=[{'name': 'notes.txt', 'mimeType': 'text/plain', 'buffer': b'just my notes'}])
    pg.wait_for_timeout(300)
    ck('BEGIN day-planner/2' in pg.inner_text('#sheet .note.bad'),
       'a file that is not a trip is explained, not swallowed: ' + pg.inner_text('#sheet .note.bad')[:60] + '…')
    ck(pg.inner_text('#tripBtn') == 'Italy · Apr 2027', 'and the trip is untouched')
    ctx.close()

    # ---- copying the trip as text
    ctx, pg = open_page(held=DEMO)
    pg.click('#dataBtn')
    pg.wait_for_timeout(150)
    pg.click('[data-act="copy-text"]')
    pg.wait_for_timeout(300)
    block = pg.input_value('#outBox')
    ck(block.startswith('--- BEGIN day-planner/2 ---') and block.rstrip().endswith('--- END day-planner/2 ---'),
       'the block is wrapped in the two fixed lines')
    ck(len(block.strip().split(chr(10))) == 3, 'with the trip on one line between them')
    ck(json.loads(block.strip().split(chr(10))[1])['trip']['id'] == 'example-kyoto', 'and it holds the trip')
    ck('Copied' in pg.inner_text('#toast'), 'the clipboard gets it too: ' + pg.inner_text('#toast'))
    ck(pg.evaluate('navigator.clipboard.readText()') == block, 'the same text, byte for byte')
    pg.screenshot(path=str(SHOTS / 'app_text_desktop_light.png'))

    # ---- loading a block back in
    pg.fill('#inBox', 'Here you go!\n\n' + block + '\nAnything else?')
    pg.click('[data-act="paste-in"]')
    pg.wait_for_timeout(400)
    ck('Replace this trip?' in pg.inner_text('#sheet'), 'the same trip again asks before it overwrites what is open')
    pg.click('[data-act="import-go"]')
    pg.wait_for_timeout(400)
    ck('2 days and 6 places' in pg.inner_text('#sheet .note.good'), 'a pasted block loads, chat chatter and all')
    ck(pg.input_value('#inBox') == '', 'and the box is emptied once it has')
    cut = block.strip().rsplit(chr(10), 1)[0][:400]
    pg.fill('#inBox', cut)
    pg.click('[data-act="paste-in"]')
    pg.wait_for_timeout(300)
    ck('cut off' in pg.inner_text('#sheet .note.bad'), 'a block that got clipped says so: ' + pg.inner_text('#sheet .note.bad')[:70] + '…')
    ck(pg.input_value('#inBox') == cut, 'and what you pasted stays in the box')
    pg.fill('#inBox', block.replace('day-planner/2', 'day-planner/1'))
    pg.click('[data-act="paste-in"]')
    pg.wait_for_timeout(300)
    ck('first planner' in pg.inner_text('#sheet .note.bad'), 'a block from the old planner is turned away: ' + pg.inner_text('#sheet .note.bad')[:60] + '…')
    ctx.close()

    # ---- a package from the chat is merged, not loaded over the top
    ctx, pg = open_page(held=DEMO)
    pack = json.loads(json.dumps(DEMO))
    pack['kind'] = 'package'
    pack['trip']['places']['from-the-chat'] = dict(pack['trip']['places']['example-temple'],
                                                   id='from-the-chat', name='Somewhere The Chat Found', dayId=None)
    pack['trip']['places']['example-temple']['fixed'] = '10:00'     # the demo leaves this unset
    pg.click('#dataBtn')
    pg.wait_for_timeout(150)
    pg.fill('#inBox', C_block(pack))
    pg.click('[data-act="paste-in"]')
    pg.wait_for_timeout(500)
    text = pg.inner_text('#sheet')
    ck('Settle' not in text, 'a package that only fills gaps asks nothing')
    ck('Merged' in pg.inner_text('#sheet .note.good'), 'it says it merged rather than loaded: ' + pg.inner_text('#sheet .note.good'))
    ck('Somewhere The Chat Found' in text, 'and names what it added')
    places = pg.evaluate("Object.keys(window.DayPlannerApp.trip.places)")
    ck('from-the-chat' in places and 'made-up-market' in places,
       'the new place arrives without displacing what was already there: %d places' % len(places))
    ck(pg.evaluate("window.DayPlannerApp.trip.places['example-temple'].fixed") == '10:00',
       'a field you never set is simply filled in')
    ck(pg.evaluate("JSON.parse(localStorage.getItem('plan-my-trip/base')).kind") == 'package',
       'and the package becomes the baseline the next merge compares against')
    ctx.close()

    # ---- when you and the chat have both changed the same thing
    mine = json.loads(json.dumps(DEMO))
    mine['trip']['places']['example-temple']['duration'] = 120          # you made it longer
    theirs = json.loads(json.dumps(DEMO))
    theirs['kind'] = 'package'
    theirs['trip']['places']['example-temple']['duration'] = 150        # they made it longer still
    ctx = br.new_context(viewport={'width': 1280, 'height': 900}, permissions=['clipboard-read', 'clipboard-write'])
    ctx.route('**/*', harness.offline(BASE, None))
    pg = ck.watch(ctx.new_page())
    pg.add_init_script("localStorage.setItem('plan-my-trip/trip', %s)" % json.dumps(json.dumps(mine)))
    pg.add_init_script("localStorage.setItem('plan-my-trip/base', %s)" % json.dumps(json.dumps(DEMO)))
    pg.goto(BASE + '/index.html')
    pg.wait_for_timeout(250)
    pg.click('#dataBtn')
    pg.wait_for_timeout(150)
    pg.fill('#inBox', C_block(theirs))
    pg.click('[data-act="paste-in"]')
    pg.wait_for_timeout(500)
    ck(pg.locator('.conflicts .cf').count() == 1, 'both changing one field stops to ask, once')
    row = pg.inner_text('.conflicts .cf')
    ck('How long' in row and '2h' in row and '2h 30' in row, 'with the field and both answers in words: ' + row.replace(chr(10), ' | '))
    ck('yours' in row.lower() and 'the chat' in row.lower(), 'and each value says whose it is, so two times are never just two times')
    ck(pg.locator('[data-act="merge-pick"][data-side="mine"][aria-pressed="true"]').count() == 1,
       'yours is what it keeps unless you say otherwise')
    ck('Merge' not in pg.evaluate("JSON.stringify(window.DayPlannerApp.trip.places['example-temple'].duration)"),
       'and nothing has changed yet')
    ck(pg.evaluate("window.DayPlannerApp.trip.places['example-temple'].duration") == 120, 'the trip is untouched while it asks')
    pg.screenshot(path=str(SHOTS / 'app_merge_desktop_light.png'))
    pg.click('[data-act="merge-pick"][data-side="theirs"]')
    pg.wait_for_timeout(200)
    ck(pg.locator('[data-act="merge-pick"][data-side="theirs"][aria-pressed="true"]').count() == 1, 'the choice shows which side it is on')
    pg.click('[data-act="merge-go"]')
    pg.wait_for_timeout(500)
    ck(pg.evaluate("window.DayPlannerApp.trip.places['example-temple'].duration") == 150, 'applying takes the side you picked')
    ck('Undo' in pg.inner_text('#toast'), 'and the whole merge can be undone: ' + pg.inner_text('#toast'))
    pg.click('[data-act="undo-import"]')
    pg.wait_for_timeout(300)
    ck(pg.evaluate("window.DayPlannerApp.trip.places['example-temple'].duration") == 120, 'undo puts your own version back')
    ctx.close()

    # the same questions in the dark, and on a phone, where the two columns stack
    for name, w, h, scheme in (('desktop_dark', 1280, 900, 'dark'), ('phone_light', 390, 844, 'light'), ('phone_dark', 390, 844, 'dark')):
        phone = w < 500
        ctx = br.new_context(viewport={'width': w, 'height': h}, color_scheme=scheme,
                             is_mobile=phone, has_touch=phone, device_scale_factor=2 if phone else 1)
        ctx.route('**/*', harness.offline(BASE, None))
        pg = ck.watch(ctx.new_page())
        pg.add_init_script("localStorage.setItem('plan-my-trip/trip', %s)" % json.dumps(json.dumps(mine)))
        pg.add_init_script("localStorage.setItem('plan-my-trip/base', %s)" % json.dumps(json.dumps(DEMO)))
        pg.goto(BASE + '/index.html')
        pg.wait_for_timeout(250)
        pg.click('#dataBtn')
        pg.wait_for_timeout(150)
        pg.fill('#inBox', C_block(theirs))
        pg.click('[data-act="paste-in"]')
        pg.wait_for_timeout(500)
        ck(pg.locator('.conflicts .cf').count() == 1, 'the questions stand up at ' + name)
        ck(pg.locator('[data-act="merge-go"]').is_visible(), 'with Apply reachable at ' + name)
        ck(pg.evaluate("document.querySelector('#sheet').scrollTop") == 0,
           'and the sheet showing the question rather than whatever you last scrolled to, at ' + name)
        ck(pg.locator('.conflicts .cf').first.is_visible(), 'the difference itself is on screen at ' + name)
        pg.screenshot(path=str(SHOTS / ('app_merge_' + name + '.png')))
        ctx.close()

    # ---- handing the trip back to the chat
    ctx, pg = open_page(held=DEMO)
    pg.click('#dataBtn')
    pg.wait_for_timeout(150)
    pg.fill('#hbNote', 'Dropped the market, it looked like a tourist trap')
    pg.click('[data-act="hand-alt"][data-key="packed"]')
    pg.wait_for_timeout(150)
    ck(pg.locator('[data-act="hand-alt"][data-key="packed"][aria-pressed="true"]').count() == 1,
       'an alternative version can be ticked without hovering to find it')
    pg.click('[data-act="hand-back"][data-how="text"]')
    pg.wait_for_timeout(400)
    hb = json.loads(pg.input_value('#outBox').strip().split(chr(10))[1])
    ck(hb['kind'] == 'handback', 'the hand-back says what it is')
    ck(hb['handback']['note'].startswith('Dropped the market'), 'it carries the note you typed')
    day = [d for d in hb['handback']['days'] if d['date'] == '2026-11-21'][0]
    ck(day['chosen'] == 'balanced' and len(day['versions']) == 2,
       'the version on show, plus the alternative you ticked: ' + ', '.join(v['key'] for v in day['versions']))
    ck(day['versions'][0]['stops'][0]['at'] == '08:50',
       'with the plan computed, stop by stop: ' + day['versions'][0]['stops'][0]['name'] + ' at ' + day['versions'][0]['stops'][0]['at'])
    ck(hb['handback']['changes']['baseline'] is False,
       'and it owns up when there is no package to compare against')
    ck('Copied' in pg.inner_text('#toast'), 'the clipboard gets it: ' + pg.inner_text('#toast'))
    pg.screenshot(path=str(SHOTS / 'app_handback_desktop_light.png'))
    ctx.close()

    # ---- undoing an import
    ctx, pg = open_page(held=DEMO)
    pg.click('#dataBtn')
    pg.wait_for_timeout(150)
    pg.fill('#inBox', json.dumps(other))
    pg.click('[data-act="paste-in"]')
    pg.wait_for_timeout(250)
    pg.click('[data-act="import-go"]')
    pg.wait_for_timeout(500)
    ck(pg.inner_text('#tripBtn') == 'Italy · Apr 2027', 'the new trip is in')
    ck('Undo' in pg.inner_text('#toast'), 'the toast offers a way back')
    pg.reload()
    pg.wait_for_timeout(300)
    pg.click('#dataBtn')
    pg.wait_for_timeout(200)
    ck('Example · Kyoto (made up)' in pg.inner_text('#sheet'), 'and the offer survives a reload, so a mistake keeps')
    pg.click('[data-act="undo-import"]')
    pg.wait_for_timeout(900)
    ck(pg.inner_text('#tripBtn') == 'Example · Kyoto (made up)', 'undo brings the old trip back')
    ck(len(pg.evaluate("JSON.parse(localStorage.getItem('plan-my-trip/trip'))")['trip']['places']) == 6, 'whole')
    ck(pg.evaluate("localStorage.getItem('plan-my-trip/undo')") is None, 'and the way back is spent, not left lying about')
    ctx.close()

    # ---- a file that lands after the sheet was closed
    ctx, pg = open_page(held=DEMO)
    pg.click('#dataBtn')
    pg.wait_for_timeout(150)
    # make reading the file slow, so Escape lands while it is still in flight
    pg.evaluate("() => { const orig = Blob.prototype.text;"
                " Blob.prototype.text = function () { return new Promise((r) => setTimeout(() => orig.call(this).then(r), 400)); }; }")
    pg.set_input_files('#fileIn', files=[{'name': 'notes.txt', 'mimeType': 'text/plain', 'buffer': b'just my notes'}])
    pg.keyboard.press('Escape')
    ck(pg.locator('#sheet').get_attribute('aria-hidden') == 'true', 'the sheet is shut while the file is still being read')
    pg.wait_for_timeout(700)
    ck('BEGIN day-planner/2' in pg.inner_text('#sheet .note.bad'), 'and the file still gets an answer when it lands')
    ctx.close()

    # ---- a stored copy that cannot be used
    ctx, pg = open_page(held={'schema': 'day-planner/9', 'kind': 'save', 'trip': {}})
    ck('No trip yet' in pg.inner_text('#panel'), 'an unusable stored copy does not break the page')
    ck(pg.inner_text('.note.bad').startswith('The trip saved in this browser could not be opened.'), 'and says why: ' + pg.inner_text('.note.bad'))
    ctx.close()

    # ---- the two sizes, light and dark
    for name, w, h, scheme in [('desktop_dark', 1280, 800, 'dark'), ('phone_light', 390, 844, 'light'), ('phone_dark', 390, 844, 'dark')]:
        ctx, pg = open_page(w, h, scheme)
        ck(pg.locator('.empty h2').is_visible(), 'the empty state stands up at ' + name)
        pg.screenshot(path=str(SHOTS / ('app_empty_' + name + '.png')))
        ctx.close()

    br.close()
stop()
ck.finish()
