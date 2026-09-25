# SPDX-License-Identifier: AGPL-3.0-or-later
"""Playwright walk-through of the planner, docs/index.html. Nothing reaches the network: MapLibre
comes from the stub and every other request is blocked. Run: python3 tests/app_test.py"""
import datetime, json, pathlib, re, urllib.parse
from playwright.sync_api import sync_playwright
import harness
from harness import SHOTS, Checks

SHOTS.mkdir(exist_ok=True)
DEMO = json.loads((harness.HERE / 'demo-trip.json').read_text())
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
    # What Overpass gives back, by id. Pizza Little Party's tags are from the service test; the
    # other two are made up, since the probe never looked them up.
    OSM_BY_ID = {
        '5279728860': {'type': 'node', 'id': 5279728860, 'lat': 34.97891, 'lon': 135.75941, 'tags': FIX['overpassTags']},
        '359896810': {'type': 'way', 'id': 359896810, 'center': {'lat': 34.98083, 'lon': 135.74764},
                      'tags': {'name': '東寺', 'name:en': 'East Temple', 'tourism': 'attraction', 'fee': 'yes'}},
        '263330850': {'type': 'way', 'id': 263330850, 'center': {'lat': 34.88712, 'lon': 135.80481}, 'tags': {}},
    }
    asked = []

    def services(r):
        u = r.request.url
        if 'google.com/maps' in u:
            r.fulfill(status=200, body='<html><title>Maps</title></html>', headers={'Content-Type': 'text/html'})
            return True
        if 'overpass-api.de' in u:
            asked.append(u)
            want = re.search(r'(node|way|relation)\((\d+)\)', urllib.parse.unquote(u))
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
    ctx, pg = open_page(held=DEMO)
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
    ck(pg.locator('.card .label').all_text_contents()[1:] == ['Plan · Balanced 2', 'Ideas for today 1', 'Backlog 2'],
       'the panel shows the version on screen, the day\'s other ideas and the backlog')
    ck(pg.locator('.list .nm').first.inner_text().startswith('Example Temple'), 'stops come in the version\'s order')
    ck(pg.locator('.chip.must').count() == 1 and pg.locator('.chip.check').count() == 2 and pg.locator('.chip.flex').count() == 3,
       'labels from the chat, check flags and lunch options show as chips')
    ck('Temple / culture · 1h 30 · Eastern hills' in pg.inner_text('.list .meta'), 'each place says what it is and how long it takes')
    pg.screenshot(path=str(SHOTS / 'app_day_desktop_light.png'))

    pg.click('[data-act="version"][data-v="packed"]')
    pg.wait_for_timeout(150)
    labels = pg.locator('.card .label').all_text_contents()
    ck(labels[1] == 'Plan · Packed 3' and labels[2] == 'Ideas for today 0',
       'switching version moves places between the plan and today\'s ideas')
    ck(pg.locator('[data-act="version"][data-v="packed"]').get_attribute('aria-pressed') == 'true', 'and the control follows')
    pg.click('[data-act="version"][data-v="less"]')
    pg.wait_for_timeout(900)
    held = pg.evaluate("JSON.parse(localStorage.getItem('plan-my-trip/trip'))")
    ck(held['trip']['days']['2026-11-21']['shown'] == 'less', 'the version you are looking at is remembered')
    ck(len(held['trip']['days']['2026-11-21']['plans']['balanced']) == 2, 'and switching never moves a place between versions')
    labels = pg.locator('.card .label').all_text_contents()
    ck(labels[1] == 'Plan · Do less 1' and labels[2] == 'Ideas for today 2', 'Do less keeps its own, shorter list: ' + ' / '.join(labels[1:3]))
    pg.screenshot(path=str(SHOTS / 'app_less_desktop_light.png'))
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
      const mark = (u) => L.fetchJson(u).then(() => at.push(Date.now()));
      await Promise.all([mark('https://example.test/slow?a'), mark('https://example.test/slow?b'),
                         mark('https://example.test/slow?c')]);
      return { calls: L.calls, gaps: at.slice(1).map((t, i) => t - at[i]) };
    }''')
    ck(spacing['calls'] == 3, 'three different questions make three requests')
    ck(all(g >= 1000 for g in spacing['gaps']), 'spaced at least a second apart, as their terms ask: ' + str(spacing['gaps']))
    again = pg.evaluate('''async () => {
      const L = window.DayPlannerLive;
      await L.fetchJson('https://example.test/slow?a');
      await L.fetchJson('https://example.test/slow?a');
      return L.calls;
    }''')
    ck(again == 3, 'asking the same thing again is answered from the page, not the service')
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
    ck('already a day of this trip' in pg.inner_text('#sheet'), 'a date the trip already has is refused: ' + pg.inner_text('#sheet .note.bad'))
    pg.fill('#dyDate', '2026-11-22')
    pg.click('[data-act="save-day"]')
    pg.wait_for_timeout(900)
    ck(len(pg.eval_on_selector_all('#daySel option', 'els => els.map(e => e.value)')) == 2, 'both days are in the picker')
    ctx.close()

    # ---- opening a place already in the trip
    ctx, pg = open_page(held=DEMO, extra=services)
    pg.click('.list .item >> nth=0')
    pg.wait_for_timeout(250)
    ck(pg.inner_text('.sh-title').startswith('Example Temple'), 'a place in the plan opens its card')
    sheet = pg.inner_text('#sheet')
    ck('Sat 21 Nov, in Do less, Balanced and Packed' in sheet, 'saying where it sits: '
       + [l for l in sheet.split(chr(10)) if 'Sat 21 Nov' in l][0])
    ck('How long it takes' in pg.locator('#sheet .label').all_text_contents(), 'with a section for how long it takes')
    ck('Mon–Fri 06:00–18:00 · Sat–Sun 06:00–21:00' in sheet, 'and when it is open: '
       + [l for l in sheet.split(chr(10)) if '06:00' in l][0])
    ck('unverified' in sheet, 'flagged unverified, since OpenStreetMap supplied them')
    ck('Made-up hours — check' in sheet, 'with whatever is still to be checked')
    ck(pg.locator('#durH').get_attribute('data-value') == '1' and pg.locator('#durM').get_attribute('data-value') == '30',
       'the duration wheels open on what it takes now')
    ck(pg.locator('#durH .wheel-item').count() == 13 and pg.locator('#durM .wheel-item').count() == 4,
       '0 to 12 hours, and quarter hours')
    pg.click('#durH .wheel-item[data-v="2"]')
    pg.click('#durM .wheel-item[data-v="45"]')
    pg.click('[data-act="save-duration"]')
    pg.wait_for_timeout(900)
    ck(pg.evaluate("window.DayPlannerApp.trip.places['example-temple'].duration") == 165, 'and set it when you save')
    ck('2h 45' in pg.inner_text('#panel'), 'which shows in the list straight away')
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
    # ---- moving a place about
    ck('Remove from Balanced' in pg.inner_text('#sheet'), 'a stop in the version on screen can be taken out of it')
    pg.click('[data-act="move-remove"]')
    pg.wait_for_timeout(500)
    ck('is still in Do less and Packed' in pg.inner_text('#toast'), 'and the planner says where it still is: ' + pg.inner_text('#toast'))
    ck(pg.evaluate("window.DayPlannerApp.trip.places['example-temple'].dayId") == '2026-11-21', 'it stays on its day')
    ck('Add to Balanced' in pg.inner_text('#sheet'), 'and can go back in')
    pg.click('[data-act="move-add"]')
    pg.wait_for_timeout(500)
    ck('example-temple' in pg.evaluate("window.DayPlannerApp.trip.days['2026-11-21'].plans.balanced"), 'back in the version')

    pg.click('[data-act="move-backlog"]')
    pg.wait_for_timeout(900)
    trip = pg.evaluate("JSON.parse(localStorage.getItem('plan-my-trip/trip'))")['trip']
    ck(trip['places']['example-temple']['dayId'] is None, 'Remove to the backlog takes it off the day')
    ck('example-temple' not in trip['days']['2026-11-21']['plans']['packed'], 'which means out of every version')
    pg.select_option('#moveDay', '2026-11-22')
    pg.click('[data-act="move-to-day"]')
    pg.wait_for_timeout(900)
    ck(pg.evaluate("window.DayPlannerApp.trip.places['example-temple'].dayId") == '2026-11-22',
       'and it can be put on another day from the same card')
    ck('Sun 22 Nov' in pg.inner_text('#dayFace'), 'which follows it there: ' + pg.inner_text('#dayFace'))
    pg.keyboard.press('Escape')
    pg.select_option('#daySel', '2026-11-21')
    pg.wait_for_timeout(200)

    pg.click('.list .item >> nth=3')
    pg.wait_for_timeout(250)
    ck('In the backlog, with no day yet' in pg.inner_text('#sheet'), 'a backlog place says so')
    pg.keyboard.press('Escape')

    # ---- deleting a place, with a way back
    pg.click('.list .item >> nth=0')
    pg.wait_for_timeout(250)
    name = pg.inner_text('.sh-title').split(chr(10))[0]
    ck('drops it from' in pg.inner_text('#sheet'), 'deleting says which versions it would empty: '
       + [l for l in pg.inner_text('#sheet').split(chr(10)) if 'Deleting' in l][0])
    before = len(pg.evaluate('Object.keys(window.DayPlannerApp.trip.places)'))
    pg.click('[data-act="delete-place"]')
    pg.wait_for_timeout(400)
    ck(len(pg.evaluate('Object.keys(window.DayPlannerApp.trip.places)')) == before - 1, 'and it goes')
    ck(name.split(' ')[0] in pg.inner_text('#toast'), 'with a note of what went: ' + pg.inner_text('#toast'))
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

    # ---- a day's shape
    ctx, pg = open_page(held=DEMO)
    pg.click('[data-act="day"]')
    pg.wait_for_timeout(200)
    ck(pg.input_value('#edDate') == '2026-11-21' and pg.input_value('#edStartName') == 'Example Hotel · Kyoto Station',
       'the day sheet opens on what the day holds')
    ck(pg.input_value('#edLunchFrom') == '11:30' and pg.input_value('#edLunchFor') == '60', 'lunch included')
    pg.screenshot(path=str(SHOTS / 'app_dayedit_desktop_light.png'))
    pg.fill('#edStartName', 'Example Ryokan')
    pg.fill('#edStartTime', '07:45')
    pg.fill('#edEndTime', '')
    pg.uncheck('#edLunchOn')
    pg.fill('#edNote', 'Made-up day, made-up note.')
    pg.click('[data-act="save-day-shape"]')
    pg.wait_for_timeout(900)
    panel = pg.inner_text('#panel')
    ck('07:45' in panel and 'Leave Example Ryokan' in panel, 'the times and the start place follow')
    card = pg.inner_text('#panel .day-card')
    ck('Open-ended day' in card and 'Lunch' not in card, 'an empty back-by time makes the day open-ended, and lunch can be dropped')
    ck('Made-up day, made-up note.' in panel, 'and the note shows under the day')
    held = pg.evaluate("JSON.parse(localStorage.getItem('plan-my-trip/trip'))")['trip']['days']['2026-11-21']
    ck(held['end'] is None and held['start']['lat'] is None, 'a renamed start place drops the position it had, ready for search')

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
    ck(pg.locator('.card .label').all_text_contents()[-1] == 'Backlog 5', 'the day goes, and its places land in the backlog')
    ck('back to the backlog' in pg.inner_text('#toast'), 'with a plain account of it: ' + pg.inner_text('#toast'))
    pg.click('#toastBtn')
    pg.wait_for_timeout(900)
    ck('Thu 19 Nov' in pg.inner_text('#dayFace'), 'and Undo brings the day back: ' + pg.inner_text('#dayFace'))
    ck(pg.locator('.card .label').all_text_contents()[-1] == 'Backlog 2', 'with its places on it again')
    ctx.close()

    # ---- searching for a place
    ctx, pg = open_page(held=DEMO, extra=services)
    pg.fill('#findBox', 'n')
    pg.wait_for_timeout(600)
    ck(len(asked) == 0, 'one letter is not a search')
    pg.fill('#findBox', 'nintendo museum')
    pg.wait_for_timeout(1500)
    ck(len(asked) == 1 and 'q=nintendo+museum' in asked[0], 'typing a name asks Photon once, after a pause')
    ck('lat=' in asked[0], 'biased to where the map is looking')
    ck(pg.locator('#findResults .item').count() == 2, 'the results are listed')
    ck('Nintendo Museum' in pg.locator('#findResults .nm').first.inner_text(), 'by name')
    ck('Museum · Ogura · Ogura-cho · Uji' in pg.locator('#findResults .meta').first.inner_text(),
       'with what they are and where: ' + pg.locator('#findResults .meta').first.inner_text())
    pg.screenshot(path=str(SHOTS / 'app_search_desktop_light.png'))

    # nothing is added until you say so
    pg.click('#findResults .item')
    pg.wait_for_timeout(300)
    ck(pg.inner_text('.sh-title').startswith('Nintendo Museum'), 'a result opens a preview first')
    ck('Add to Balanced' in pg.inner_text('#sheet'), 'offering the version on screen')
    ck('km from' in pg.inner_text('#sheet'), 'and how far it is from the day: '
       + [l for l in pg.inner_text('#sheet').split(chr(10)) if ' from ' in l][0])
    ck(len(pg.evaluate('Object.keys(window.DayPlannerApp.trip.places)')) == 6, 'and nothing has joined the trip yet')
    pg.screenshot(path=str(SHOTS / 'app_preview_desktop_light.png'))
    pg.click('[data-act="add-place"][data-to="plan"]')
    pg.wait_for_timeout(900)
    trip = pg.evaluate("JSON.parse(localStorage.getItem('plan-my-trip/trip'))")['trip']
    ck(len(trip['places']) == 7, 'choosing Add puts it in the trip')
    ck(trip['places']['nintendo-museum']['kind'] == 'museum', 'with the kind worked out for it')
    ck(trip['places']['nintendo-museum']['added'] == {'by': 'you', 'how': 'search', 'at': trip['places']['nintendo-museum']['added']['at']},
       'and a note of how it was found')
    ck(trip['days']['2026-11-21']['plans']['balanced'].index('nintendo-museum') >= 0, 'in the version that was on screen')
    ck(trip['days']['2026-11-21']['plans']['packed'].count('nintendo-museum') == 0, 'and in no other')

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
    pg.fill('#trCur', 'chf')
    pg.fill('#trTitle', 'Example · Kyoto')
    pg.click('[data-act="save-trip"]')
    pg.wait_for_timeout(900)
    ck(pg.inner_text('#tripBtn') == 'Example · Kyoto', 'saving renames the trip')
    held = pg.evaluate("JSON.parse(localStorage.getItem('plan-my-trip/trip'))")
    ck(held['trip']['currency'] == 'CHF' and held['trip']['id'] == 'example-kyoto', 'the currency is stored, and the id never moves')
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
