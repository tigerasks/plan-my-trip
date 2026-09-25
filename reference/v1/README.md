# v1 reference code

The first planner: a Claude-hosted artifact with a shared database and a schematic, tile-free map. It is still in use, but it is **not** deployed from this repository. It is here so v2 can reuse the parts that still fit. See `CLAUDE.md` for what to reuse and what not.

| File | What it is |
|---|---|
| `core.js` | Pure logic, no DOM: time and date formatting, the travel estimate model, input normalisation, the schedule simulation (times, waits, opening hours, fixed times, meal windows), best-insertion and 2-opt ordering, and result building. Also the v1-only pace optimiser. |
| `app.js` | v1 UI: database sync (v1-only), schematic SVG map with marker declutter, timeline, sheets, drag to reorder, hand-back. |
| `style.css` | House-style tokens, light and dark, and components (chips, timeline, sheets). |
| `index.template.html`, `build.py` | Single-file build used by v1. |
| `demo.json` | Fake demo day in Kyoto; hours, prices and bookings are made up. |
| `test_core.js` | Node tests for the core. |
| `ui_test.py`, `mock.js` | Playwright UI tests against a mocked database. |
