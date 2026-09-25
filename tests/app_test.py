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

    def open_page(w=1280, h=800, scheme='light'):
        phone = w < 500
        ctx = br.new_context(viewport={'width': w, 'height': h}, color_scheme=scheme,
                             is_mobile=phone, has_touch=phone, device_scale_factor=2 if phone else 1)
        ctx.route('**/*', harness.offline(BASE))
        pg = ctx.new_page()
        ck.watch(pg)
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
