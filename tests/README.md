# Tests

Playwright drives a real Chromium against the files in `docs/`. Nothing here touches the network:
`harness.py` serves `docs/` over http on a free port, answers MapLibre from `maplibre_stub.js`,
and blocks every other request. Each test's own mocks stand in for Photon, Overpass, OSRM and
Transitous, and `tests/stops/` is served in place of the published stop snapshot.

## Setting up, once

See [the README](../README.md#setting-up-a-fresh-clone) — in short:

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/playwright install chromium
```

`.venv/` is ignored by git, so nothing lands outside the clone.

## Running

```sh
.venv/bin/python tests/probe_test.py          # the service test page, docs/probe.html
.venv/bin/python tests/probe_transit_test.py  # the public transport probe, docs/probe-transit.html
.venv/bin/python tests/app_test.py            # the planner, docs/index.html
node tests/core_test.js                       # the model, in Node
```

Each prints a `PASS`/`FAIL` line per check and exits non-zero when anything fails or the page logs a
console error; run them all before every commit. Screenshots land in `tests/shots/` at
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
| `probe_transit_test.py` | walk-through of the public transport probe |
| `app_test.py` | walk-through of the planner |
| `demo-trip.json` | an obviously fake trip used as test data |
| `core_test.js` | Node tests for `docs/core.js`, run with `node tests/core_test.js` |
| `fixtures.json` | answers the mocks give back, most of them taken from a real service test |
| `stops/` | a small real slice of the published stop snapshot, served in place of it |
| `shots/` | screenshots from the last run, not committed |
