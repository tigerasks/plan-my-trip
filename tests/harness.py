# SPDX-License-Identifier: AGPL-3.0-or-later
"""Shared pieces for the Playwright tests: a local server for docs/, the MapLibre stub,
and routing that keeps a page off the network. Import this, don't run it."""
import functools, http.server, pathlib, sys, threading

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
DOCS = ROOT / 'docs'
SHOTS = HERE / 'shots'
STUB = (HERE / 'maplibre_stub.js').read_text()
JS = {'Content-Type': 'application/javascript'}
CSS = {'Content-Type': 'text/css'}
JSON_H = {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'}
NO_ROUTE = '{"code": "NoRoute", "routes": []}'
NO_JOURNEY = '{"itineraries": [], "direct": []}'
NO_ELEMENTS = '{"elements": []}'


class _Quiet(http.server.SimpleHTTPRequestHandler):
    """Same as the standard handler, without a line of noise per request."""
    def log_message(self, *a):
        pass


def serve(directory=DOCS):
    """Serve a folder over http on a free port, the way GitHub Pages serves docs/.
    Browser storage and module loading behave as they do live, which file:// cannot promise.
    Returns (base_url, stop)."""
    handler = functools.partial(_Quiet, directory=str(directory))
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return 'http://127.0.0.1:%d' % srv.server_address[1], srv.shutdown


STOPS = HERE / 'stops'


def serve_snapshot(route, url):
    """Answer a request for the published stop snapshot from `tests/stops`."""
    want = url.split('plan-my-trip-data-stops/', 1)[1].split('?')[0].split('#')[0]
    path = (STOPS / want).resolve()
    # A tile name comes from arithmetic, not from anything a user typed, but serving whatever a path
    # asks for is still not a habit worth having.
    inside = path.is_file() and STOPS.resolve() in path.parents
    if not inside:
        return route.fulfill(status=404, body='{}', headers=JSON_H)
    return route.fulfill(status=200, body=path.read_text(encoding='utf-8'), headers=JSON_H)


def offline(base, extra=None):
    """A route handler: the app is served from `base`, `extra` gets first refusal (returning True
    when it has answered), MapLibre comes from the stub, and everything else is blocked."""
    def route(r):
        u = r.request.url
        if u.startswith(base):
            return r.continue_()
        if extra and extra(r):
            return None
        if 'plan-my-trip-data-stops' in u:
            # The planner reads stops from a snapshot we publish, and asks for it unprompted on any
            # day with a leg. Serve the small real one in tests/stops, so every page has an answer.
            return serve_snapshot(r, u)
        if 'overpass-api.de' in u:
            # Place details, and nothing else: the stops come from the snapshot above. One lookup
            # per place previewed, and an empty answer means the map has nothing filed under it.
            return r.fulfill(status=200, body=NO_ELEMENTS, headers=JSON_H)
        if 'api.transitous.org' in u:
            # As with OSRM: the planner asks about the legs of a day by itself, so an unanswered
            # request would be a console error in every test. "No journey" leaves the estimate.
            return r.fulfill(status=200, body=NO_JOURNEY, headers=JSON_H)
        if 'routing.openstreetmap.de' in u:
            # The planner checks a plan's legs by itself, so every page asks OSRM sooner or later.
            # Unless a test answers for it, it gets a polite "no route": the estimates stand, and a
            # blocked request would show up as a console error and fail the run.
            return r.fulfill(status=200, body=NO_ROUTE, headers=JSON_H)
        if 'maplibre-gl.js' in u:
            return r.fulfill(status=200, body=STUB, headers=JS)
        if 'maplibre-gl.css' in u:
            return r.fulfill(status=200, body='', headers=CSS)
        return r.abort()
    return route


class Checks:
    """Collects PASS/FAIL lines and page errors, then decides the exit code."""
    def __init__(self, title):
        self.title, self.log, self.errs, self.failed = title, [], [], 0
        self.expected = []

    def expect(self, fragment):
        """Console noise this test causes on purpose, such as a service it makes fail deliberately.
        The browser logs a failed request itself, and that is not the app misbehaving."""
        self.expected.append(fragment)

    def __call__(self, cond, msg):
        self.log.append(('PASS  ' if cond else 'FAIL  ') + msg)
        if not cond:
            self.failed += 1
        return cond

    def note(self, msg):
        self.log.append('      ' + msg)

    def watch(self, page):
        """Fail the run on any page error or console error, bar the noise a test asked for."""
        def note(text):
            if not any(f in text for f in self.expected):
                self.errs.append(text)
        page.on('pageerror', lambda e: note('pageerror: ' + str(e)))
        page.on('console', lambda m: note('console.' + m.type + ': ' + m.text) if m.type == 'error' else None)
        return page

    def report(self):
        print(self.title)
        print('\n'.join(self.log))
        print('ERRORS (%d):' % len(self.errs))
        print('\n'.join(self.errs[:10]))
        ok = not self.failed and not self.errs
        print('\n%s — %d checks, %d failed, %d errors' % ('OK' if ok else 'PROBLEMS', len(self.log), self.failed, len(self.errs)))
        return 0 if ok else 1

    def finish(self):
        sys.exit(self.report())
