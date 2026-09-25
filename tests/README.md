# Tests

Playwright drives a real Chromium against the files in `docs/`. Nothing here touches the network:
`harness.py` serves `docs/` over http on a free port, answers MapLibre from `maplibre_stub.js`,
and blocks every other request. Each test's own mocks stand in for Photon, Overpass, OSRM and Transitous.

## Setting up, once

```sh
python3 -m venv .venv
.venv/bin/pip install playwright
.venv/bin/playwright install chromium
```

`.venv/` is ignored by git.

## Running

```sh
.venv/bin/python tests/probe_test.py    # the service test page, docs/probe.html
.venv/bin/python tests/app_test.py      # the planner, docs/index.html
```

Both print a `PASS`/`FAIL` line per check. `app_test.py` exits non-zero when anything fails or the
page logs a console error; run it before every commit. Screenshots land in `tests/shots/` at
1280×800 and 390×844, light and dark. They are not committed: they carry timestamps and timings, so
every run would rewrite a few of them. Look at them on disk after a run.

`PROBE_URL=https://tigerasks.github.io/plan-my-trip/probe.html .venv/bin/python tests/probe_test.py`
points the probe test at a copy that is already served. The live services are only ever exercised by
opening `docs/probe.html` in a browser by hand.

## Files

| File | What it is |
|---|---|
| `harness.py` | local server, MapLibre stub, offline routing, PASS/FAIL bookkeeping |
| `maplibre_stub.js` | stand-in for MapLibre GL JS; extend it when the app uses more of the library |
| `probe_test.py` | walk-through of the service test page |
| `app_test.py` | walk-through of the planner |
| `demo-trip.json` | an obviously fake trip used as test data |
| `core_test.js` | Node tests for `docs/core.js`, run with `node tests/core_test.js` |
| `shots/` | screenshots from the last run, not committed |
