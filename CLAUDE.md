# Day planner — brief for Claude Code

## What this is

A personal, non-commercial web app for planning trip days. It is published on GitHub Pages at https://tigerasks.github.io/plan-my-trip/, from the `docs/` folder of this repository (`plan-my-trip`). It is laptop-first; phone use is basic but workable.

A trip has a **backlog** of ideas and **days**. Each day has **ideas for today** and **three plan versions**: Do less, Balanced and Packed. Places are added by search, by tapping the street map, or by dropping a pin. Travel times come from open routing services, with the app's own estimates as the fallback.

The app works on its own. It also exchanges data with the owner's Claude chat (a trip-planning project) through versioned text blocks or files.

**Status:**
- The v2 design is complete and was tested against the live services on Fri 25 Sep 2026.
- Milestone 1 is built and published: the app shell with the Liberty map, the trip, backlog and days
  model, auto-save in the browser, and the `day-planner/2` file and text block. Places, plans and
  travel times are still to come. The service test page, `docs/probe.html`, stays alongside it.
- v1 (a Claude-hosted artifact) is still in use; its code is in `reference/v1/` for reuse.

## Repository layout

GitHub Pages publishes the `docs/` folder of `main`; the only choices GitHub offers are the root and `docs/`. So `docs/` holds **only the app** and what it serves, and everything else stays outside and is never published.

| Folder | Contents | Published |
|---|---|---|
| `docs/` | The app (`index.html`, `style.css`, `core.js`, `map.js`, `app.js`), `probe.html`, and an empty `.nojekyll` so GitHub serves the files as they are | Yes |
| `documentation/` | The design doc, the v1 spec, and later the chat guide | No |
| `reference/v1/` | v1 code for reuse | No |
| `tests/` | Playwright tests, mocks, screenshots; `harness.py` serves `docs/` locally, `app_test.py` covers the planner, `probe_test.py` the service test page, `core_test.js` the model in Node. See `tests/README.md` | No |

If an older `probe.html` is still at the repository root, delete it: the copy in `docs/` is the one that gets published. Make sure `docs/.nojekyll` exists.

## Read first

1. `documentation/day-planner-v2-design.md` is the source of truth for features and decisions; see its Decisions table and the "Service test" section. If this brief and the design doc disagree, the design doc wins. If the design needs to change, agree it with the owner first, then update the doc in the same commit.
2. `reference/v1/README.md`, then the code it points to.
3. `documentation/day-planner-v1-spec.md`: the v1 data contract and chat workflow. Background only; v1 stays in use, so leave this file unchanged.

## How the owner likes to work

- **Iterative.** Do one milestone at a time and check in before moving on. Show what changed, with screenshots for anything visual.
- **Options, not silent decisions.** When a decision is open, offer 2–3 concrete options with trade-offs, including a "do less" option.
- **Verify, don't assume.** Anything about outside services (endpoints, parameters, policies, limits) is checked against the provider's docs or a live probe before building on it. Flag anything unverified as such.
- **UK conventions.** UK English, dates like "Sat 21 Nov", 24-hour times.
- **Currency.** Prices show in their original currency. A conversion appears only if the user picks a preferred currency in the trip settings; never assume one.
- **Small commits.** Keep commits small and focused, with clear messages; the app must keep working after every commit.

## Hard constraints

- **Hosting:** static files in `docs/`, published by GitHub Pages. No backend and no required build step: plain HTML, CSS and JavaScript, with libraries from a CDN.
- **Licence:** AGPL-3.0 (see `LICENSE`). Put an SPDX line (`AGPL-3.0-or-later`) at the top of source files.
- **Privacy:**
  - Trip data never goes into this repository. It lives in the browser (auto-saved to local storage) and in files the owner saves.
  - Demo or test data must be obviously fake.
- **Outside services** (all free with conditions; sources in the design doc):
  - **Map:** MapLibre GL JS with OpenFreeMap vector tiles, **Liberty style only**. Positron shows no points of interest.
  - **Search:** Photon (`https://photon.komoot.io/api/?q=…&lat=…&lon=…&lang=en`). Never Nominatim: it forbids search-as-you-type.
  - **Place details:** Overpass, OpenStreetMap's read-only query service (`https://overpass-api.de/api/interpreter?data=…`). One lookup per previewed place. The fair-use guideline is under 10,000 queries a day. It can be slow when busy, so previews must work without it. It also supplies bus and rail lines for the stop-based public transport fallback.
  - **Walking and taxi routes:** OSRM on the FOSSGIS servers.
    - Endpoints: `https://routing.openstreetmap.de/routed-foot/route/v1/foot/LON,LAT;LON,LAT` and `/routed-car/route/v1/driving/…`.
    - Terms: reasonable non-commercial use, at most one request per second.
  - **Public transport:** Transitous.
    - Endpoint: `https://api.transitous.org/api/v6/plan?fromPlace=LAT,LON&toPlace=LAT,LON&time=ISO`, falling back to v5.
    - Conditions: open source and non-commercial only. Browser requests identify themselves through the Referer header, with contact details shown on the site. Cache results.
    - Before routine routing use, the owner gives Transitous a heads-up in their Matrix channel.
  - **No Google APIs.** Google Maps appears only as outgoing search links ("Check on Google Maps").
  - **Never OpenStreetMap's own tile servers:** they reject requests without a Referer.
- **Using the services:**
  - Space calls at least one second apart and cache results in the trip data.
  - If a service fails, keep working with estimates and say so.
- **Visible credits:**
  - OpenFreeMap, © OpenMapTiles and © OpenStreetMap contributors;
  - Photon and Overpass;
  - OSRM, with a "fix the map" link;
  - Transitous, with a link to https://transitous.org/sources/.
- **Contact:** a link to https://github.com/tigerasks.

## House style

This follows the owner's trip-planning style.

- **Base:** page #f5f5f4, ink #1c1917, hairlines #e7e5e4, muted #78716c, faint #a8a29e. White cards with a 12 px radius. System font stack. Section labels are 11 px uppercase with letter-spacing.
- **Chips** are pills, 10.5 px, weight 700:

  | Chip | Colours |
  |---|---|
  | Must-do | rose #ffe4e6 / #9f1239 |
  | Booked | green #dcfce7 / #166534 |
  | Check / Watch | blue #dbeafe / #1e40af |
  | Flex or meal | stone #eceae8 / #57534e |
  | Travel | slate #e2e8f0 / #334155 |

- **Time constraints** are amber text, #b45309.
- **Dark mode** uses `prefers-color-scheme`; the tokens are in `reference/v1/style.css`.

## Reusing v1

**Reuse from `core.js`:**
- the schedule simulation: times, waits, opening hours and last entry, fixed times, time windows, meal windows, back-by time;
- the travel estimate model, which becomes the fallback and self-calibrates per city;
- date, duration and money formatting (`fmtDateUK`, `fmtDur`, `fmtMoney`; its fixed CHF target becomes the user's optional preferred currency);
- the normalisation patterns;
- best insertion and 2-opt ordering, as the basis for "Optimise order".

**Reuse from `app.js` / `style.css`:** the timeline, sheet and drag-to-reorder patterns, plus the house-style CSS.

**Don't carry over:**
- pace budgets and automatic selection (`variants`, "Fits if you drop …");
- the Claude database sync (`Subs`, `Writer`, `meta/focus`);
- the schematic SVG map.

**Formats:** v1 used schema `day-planner/1`; v2 uses `day-planner/2` (design doc, "Between chat and planner").

## Testing

- Tests make no live network calls. Stub MapLibre and mock Photon, Overpass, OSRM and Transitous, following `tests/probe_test.py` and `reference/v1/ui_test.py`.
- Use Playwright against the files in `docs/`. Keep tests, mocks and screenshots in `tests/`.
- Take screenshots at 1280×800 (primary) and 390×844, light and dark.
- Before every commit, the tests pass with no console errors.
- The live services get exercised through `docs/probe.html`, or a new probe page, run by the owner.

## Milestones

These are proposed; confirm each with the owner before starting it.

1. **Skeleton — built:**
   - app shell and Liberty map;
   - the trip, backlog and days model;
   - auto-save to browser storage;
   - Save to file and Import from file;
   - the versioned text export and import format, with begin/end lines and plain-language validation errors.
2. **Places:**
   - Photon search, tapping the map to add, dropping a pin;
   - look before you add: tapping or finding a place opens a preview first. It shows the map information (English name where available, local name kept, type), the distance from the plan, OpenStreetMap details via Overpass, the user's own look-up links, and "Check on Google Maps" opening beside the planner (a separate window on a laptop, the Maps app on a phone), then the Add buttons;
   - an hours editor per place: filled from OpenStreetMap where available and marked unverified, confirmed or corrected by the user, feeding the timeline;
   - durations: 1 h by default, 0–12 h in 15-minute steps;
   - moving places between plan, today, backlog and another day;
   - Delete, with undo.
3. **Plans:**
   - three versions per day, with copy between them;
   - a timeline with times, waits and conflicts;
   - Optimise order;
   - priority labels only when imported.
4. **Travel times:**
   - estimates first, then real routes: OSRM for walking (with real paths) and taxi (with a pickup allowance), Transitous for public transport;
   - handling of how far ahead timetables reach;
   - when Transitous finds nothing, a check whether it knows any stops nearby, to tell "no timetables" from "no connection";
   - the stop-based fallback: every stop within 10 minutes' walk of each end, widening to 20 minutes where an end has none, and no public transport estimate if there are still none; lines from OpenStreetMap where mapped; the quickest combination; used only when it clearly beats walking;
   - caching and self-calibrating estimates;
   - a leg card showing the estimate against the real time, where you can also enter your own time.
5. **Chat round trip:**
   - package import, merging by id and asking on conflicts;
   - hand-back export: note, chosen version plus alternatives, changes, travel times;
   - credits and contact details, dark-mode polish;
   - finally, write `documentation/chat-guide.md`: how the chat prepares packages and reads hand-backs in the v2 format. The v1 spec stays as it is.

## Open items

- **Verify:**
  - confirmed: tapped feature ids are OpenStreetMap ids times 10 plus the element type (1 node, 2 way, 3 relation). The way case was verified live; spot-check a node and a relation;
  - whether OpenStreetMap's bus and rail lines are mapped well enough in a trip's region to name the line between two stops;
  - whether Transitous knows stops in a trip's region, to tell "no timetables" from "no connection";
  - the exact credit lines.
- **Before going live:** the Transitous heads-up, contact details on the site, the credits, and licence headers.
- **v1:** the Claude-hosted planner stays for now; this is the owner's decision.
