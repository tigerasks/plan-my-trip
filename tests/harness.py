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


def offline(base, extra=None):
    """A route handler: the app is served from `base`, `extra` gets first refusal (returning True
    when it has answered), MapLibre comes from the stub, and everything else is blocked."""
    def route(r):
        u = r.request.url
        if u.startswith(base):
            return r.continue_()
        if extra and extra(r):
            return None
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

    def __call__(self, cond, msg):
        self.log.append(('PASS  ' if cond else 'FAIL  ') + msg)
        if not cond:
            self.failed += 1
        return cond

    def note(self, msg):
        self.log.append('      ' + msg)

    def watch(self, page):
        """Fail the run on any page error or console error."""
        page.on('pageerror', lambda e: self.errs.append('pageerror: ' + str(e)))
        page.on('console', lambda m: self.errs.append('console.' + m.type + ': ' + m.text) if m.type == 'error' else None)
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
