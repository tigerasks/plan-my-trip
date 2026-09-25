"""Playwright walk-through of the planner, docs/index.html. Nothing reaches the network: MapLibre
comes from the stub and every other request is blocked. Run: python3 tests/app_test.py"""
import json
from playwright.sync_api import sync_playwright
import harness
from harness import SHOTS, Checks

SHOTS.mkdir(exist_ok=True)
DEMO = json.loads((harness.HERE / 'demo-trip.json').read_text())
BASE, stop = harness.serve()
ck = Checks('Day planner — the skeleton')

with sync_playwright() as pw:
    br = pw.chromium.launch()

    def open_page(w=1280, h=800, scheme='light', held=None):
        phone = w < 500
        ctx = br.new_context(viewport={'width': w, 'height': h}, color_scheme=scheme,
                             is_mobile=phone, has_touch=phone, device_scale_factor=2 if phone else 1)
        ctx.route('**/*', harness.offline(BASE))
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
    ctx, pg = open_page(390, 844, held=DEMO)
    ck(pg.locator('.seg').is_visible(), 'the version control still fits on a phone')
    pg.screenshot(path=str(SHOTS / 'app_day_phone_light.png'))
    ctx.close()
    ctx, pg = open_page(390, 844, scheme='dark', held=DEMO)
    pg.screenshot(path=str(SHOTS / 'app_day_phone_dark.png'))
    ctx.close()
    ctx, pg = open_page(scheme='dark', held=DEMO)
    pg.screenshot(path=str(SHOTS / 'app_day_desktop_dark.png'))
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
