import json, pathlib
from playwright.sync_api import sync_playwright
D = pathlib.Path('/home/claude/dp'); SH = D/'shots'; SH.mkdir(exist_ok=True)
for f in SH.glob('*.png'): f.unlink()
demo = json.loads((D/'demo.json').read_text())
URL = 'file:///mnt/user-data/outputs/day-planner.html'
MOCK = (D/'mock.js').read_text().replace('__SEED__', json.dumps(demo))
log, errs = [], []
def check(c, m): log.append(('PASS  ' if c else 'FAIL  ') + m)
with sync_playwright() as pw:
    br = pw.chromium.launch()
    def open_page(w, h, scheme='light', mobile=True, mock=True):
        ctx = br.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2 if mobile else 1, color_scheme=scheme, is_mobile=mobile, has_touch=mobile)
        pg = ctx.new_page()
        pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
        pg.on('console', lambda m: errs.append('console.' + m.type + ': ' + m.text) if m.type in ('error', 'warning') else None)
        if mock: pg.add_init_script(MOCK)
        pg.goto(URL); pg.wait_for_timeout(2200)
        return ctx, pg
    # ---- A: phone, light
    ctx, pg = open_page(390, 844)
    check(pg.evaluate('window.__writes.length') == 0, 'no writes on load')
    pg.screenshot(path=str(SH/'m1_plan.png'))
    check(not pg.evaluate("[...document.querySelectorAll('.v-meta')].some(e => e.scrollWidth > e.clientWidth + 1)"), 'pace chip text fits')
    check(pg.locator('.m-leader').count() > 0, 'crowded markers nudged apart with leader lines: %d' % pg.locator('.m-leader').count())
    log.append('header: ' + pg.locator('#dpFace').inner_text().replace('\n', ' / '))
    log.append('chips: ' + ' | '.join(pg.locator('.variant').all_inner_texts()).replace('\n', ' '))
    log.append('summary: ' + pg.locator('.summary').inner_text())
    log.append('left: ' + ' || '.join(pg.locator('.lrow').all_inner_texts()).replace('\n', ' '))
    check(pg.locator('li.row[data-id="kiyomizu"]').count() == 1, 'Kiyomizu in the timeline')
    pg.click('li.row[data-id="kiyomizu"]'); pg.wait_for_timeout(500)
    pg.screenshot(path=str(SH/'m2_place.png'))
    pg.click('#sheet button[data-act="prio"][data-v="skip"]'); pg.wait_for_timeout(1500)
    w = pg.evaluate('window.__writes')
    check(len(w) == 1 and w[-1]['data']['state'].get('priority', {}).get('kiyomizu') == 'skip', 'skip saved (debounced, one write): %d writes' % len(w))
    pg.click('#sheet [data-act="close"]'); pg.wait_for_timeout(300)
    check(pg.locator('li.row[data-id="kiyomizu"]').count() == 0, 'Kiyomizu gone from timeline')
    log.append('toast after skip: ' + pg.locator('#toast').inner_text())
    pg.locator('li.leg').nth(1).click(); pg.wait_for_timeout(400)
    pg.screenshot(path=str(SH/'m3_leg.png'))
    pg.click('#sheet [data-act="close"]'); pg.wait_for_timeout(300)
    pg.click('.foot [data-act="handback"]'); pg.wait_for_timeout(400)
    pg.fill('#hbNote', 'Looks good — keep lunch flexible')
    pg.screenshot(path=str(SH/'m4_handback.png'))
    pg.click('#sheet [data-act="dohandback"]'); pg.wait_for_timeout(900)
    pg.screenshot(path=str(SH/'m5_handed.png'))
    w = pg.evaluate('window.__writes'); hb = (w[-1]['data'].get('handback') or {}) if w else {}
    check(bool(hb.get('result', {}).get('timeline')), 'handback.result written')
    check(hb.get('note') == 'Looks good — keep lunch flexible', 'handback note saved')
    check(all(x.get('drops') is not None for x in hb.get('result', {}).get('leftOut', [])), 'handback carries left-out analysis')
    check('Handed back' in pg.locator('#status').inner_text(), 'status pill: ' + pg.locator('#status').inner_text())
    pg.click('#sheet [data-act="close"]'); pg.wait_for_timeout(200)
    pg.evaluate("""() => { const p = 'trips/demo/days/2026-10-17'; const d = JSON.parse(JSON.stringify(window.__store.get(p)));
      d.places.push({id:'toji', name:'Tō-ji', lat:34.9806, lng:135.7478, priority:'maybe', duration:40, area:'Minami'}); d.updatedAt='2026-09-24T13:00:00Z'; window.__chatWrite(p, d); }""")
    pg.wait_for_timeout(700)
    check('1 new place' in pg.locator('#toast').inner_text(), 'toast on chat update: ' + pg.locator('#toast').inner_text())
    check(pg.locator('[data-id="toji"]').count() >= 1, 'new place appears')
    check(pg.evaluate('window.__subs') <= 6, 'subscriptions stay bounded: %s' % pg.evaluate('window.__subs'))
    ctx.close()
    # ---- B: phone, dark, fixed-time item selected
    ctx, pg = open_page(390, 844, scheme='dark')
    pg.click('li.row[data-id="tea-ceremony"]'); pg.wait_for_timeout(500)
    pg.screenshot(path=str(SH/'m6_dark.png'))
    ctx.close()
    # ---- C: desktop
    ctx, pg = open_page(1280, 800, mobile=False)
    pg.screenshot(path=str(SH/'d1_plan.png'))
    box = pg.locator('circle.m-cand').first.bounding_box()
    pg.mouse.click(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2); pg.wait_for_timeout(600)
    check(pg.locator('#sheet.open').count() == 1, 'tap on map candidate opens its sheet')
    pg.screenshot(path=str(SH/'d2_maptap.png'))
    pg.click('#sheet [data-act="close"]'); pg.wait_for_timeout(300)
    g = pg.locator('.grip'); a = g.nth(1).bounding_box(); b = g.nth(3).bounding_box()
    x = a['x'] + a['width'] / 2; y0 = a['y'] + a['height'] / 2; y1 = b['y'] + b['height'] + 6
    pg.mouse.move(x, y0); pg.mouse.down()
    for i in range(1, 13): pg.mouse.move(x, y0 + (y1 - y0) * i / 12)
    pg.mouse.up(); pg.wait_for_timeout(1500)
    w = pg.evaluate('window.__writes'); order = w[-1]['data']['state'].get('order') if w else None
    check(bool(order), 'drag → manual order saved: %s' % order)
    check(pg.locator('#sheet.open').count() == 0, 'drag did not open a sheet')
    check(pg.locator('.foot [data-act="replan"]').count() == 1, 'Re-plan offered in manual mode')
    pg.screenshot(path=str(SH/'d3_manual.png'))
    pg.click('.foot [data-act="replan"]'); pg.wait_for_timeout(1400)
    w = pg.evaluate('window.__writes'); check(not w[-1]['data']['state'].get('order'), 'Re-plan clears the manual order')
    pg.click('.top [data-act="settings"]'); pg.wait_for_timeout(400)
    pg.screenshot(path=str(SH/'d4_settings.png'))
    ctx.close()
    # ---- D: opened outside Claude
    ctx, pg = open_page(390, 844, mock=False)
    check('Open this from Claude' in pg.locator('#plan').inner_text(), 'no-db state explains itself')
    ctx.close(); br.close()
print('\n'.join(log)); print('ERRORS (%d):' % len(errs)); print('\n'.join(errs[:20]))
from PIL import Image
def montage(names, out, cols, h):
    ims = [Image.open(SH/n).convert('RGB') for n in names]; ims = [im.resize((int(im.width * h / im.height), h)) for im in ims]
    w = max(im.width for im in ims); rows = (len(ims) + cols - 1) // cols
    M = Image.new('RGB', (cols * w + (cols - 1) * 14, rows * h + (rows - 1) * 14), (120, 120, 120))
    for i, im in enumerate(ims): M.paste(im, ((i % cols) * (w + 14), (i // cols) * (h + 14)))
    M.save(SH/out); print('montage', out, M.size)
montage(['m1_plan.png', 'm2_place.png', 'm3_leg.png'], 'mont_phone.png', 3, 760)

