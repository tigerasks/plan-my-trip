# Day planner — brief for Claude Code

## What this is

A personal, non-commercial web app for planning trip days. It is published on GitHub Pages at https://tigerasks.github.io/plan-my-trip/, from the `docs/` folder of this repository (`plan-my-trip`). It is laptop-first; phone use is basic but workable.

A trip has a **backlog** of ideas and **days**. Each day has **ideas for today** and **three plan versions**: Do less, Balanced and Packed. Places are added by search, by tapping the street map, or by dropping a pin. Travel times come from open routing services, with the app's own estimates as the fallback.

The app works on its own. It also exchanges data with the owner's Claude chat (a trip-planning project) through versioned text blocks or files.

**Status:**
- The v2 design is complete and was tested against the live services on Fri 25 Sep 2026.
- Milestones 1 to 3 are built and published: the app shell with the Liberty map, the trip, stays,
  backlog and days model, auto-save in the browser, the `day-planner/2` file and text block, places
  (search, tapping the map, dropped pins, the preview with OpenStreetMap details, the hours editor,
  durations, moves, dragging and Delete with undo), and plans (the timeline with times, waits and
  conflicts, copying between versions, Optimise order).
- Milestone 4 is built, published, and checked against the live services on Thu 22 Oct 2026: real
  routes from OSRM, journeys from Transitous, the stop-based fallback over OpenStreetMap, the leg
  card, and the planner checking a day's legs by itself. That run found two real faults, both fixed:
  the planner gave up on Overpass's first refusal, and its 20-second timeout was shorter than
  Overpass's normal reply. The service test pages, `docs/probe.html` and `docs/probe-transit.html`,
  stay alongside the app.
- Milestone 6 is built. Those same live runs showed Overpass refusing five requests in six and
  taking 33 to 40 seconds when it answered, against a documented budget of about a hundred queries a
  day across all users — so the stop lookup moved to a snapshot we publish at
  `https://tigerasks.github.io/plan-my-trip-data-stops/`. Overpass now answers only about a place.
  The global snapshot was built on Fri 23 Oct 2026: 4,495,039 stops in 8,985 tiles, every continent.
- Milestone 5 is built: a package from the chat is merged rather than loaded over the top, three
  ways against the package it last sent, asking only where both sides moved the same thing; a
  hand-back carries the note, the chosen version with any alternatives, the computed plan with its
  issues and checks, what changed, and every travel time with the service that measured it. The
  format is written down in `documentation/chat-guide.md`.
- v1 (a Claude-hosted artifact) is still in use; its code is in `reference/v1/` for reuse.

## Repository layout

GitHub Pages publishes the `docs/` folder of `main`; the only choices GitHub offers are the root and `docs/`. So `docs/` holds **only the app** and what it serves, and everything else stays outside and is never published.

| Folder | Contents | Published |
|---|---|---|
| `docs/` | The app (`index.html`, `style.css`, `core.js`, `map.js`, `app.js`), `probe.html`, and an empty `.nojekyll` so GitHub serves the files as they are | Yes |
| `documentation/` | The design doc, the v1 spec, the chat guide | No |
| `reference/v1/` | v1 code for reuse | No |
| `tests/` | Playwright tests, mocks, screenshots; `harness.py` serves `docs/` locally, `app_test.py` covers the planner, `probe_test.py` the service test page, `core_test.js` the model in Node. See `tests/README.md` | No |
| `tools/` | Scripts the owner runs by hand, not part of the app: `refresh-stops.py` builds the stop snapshot from OpenStreetMap and publishes it | No |

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
- **Git.** `main` holds only merge commits. Every change goes on a feature branch and is merged with
  `--no-ff`. Write the commit subject only, never a body, and no `Co-Authored-By` or similar
  trailers. If a subject needs an "and", the work probably wants splitting into two commits.
- **Nothing hover-only.** Every option is visible without a mouse — drag handles, menus, the labels on
  the add buttons. If you have to hover to discover what you can do, that is a bug, not a preference.

## Hard constraints

- **Hosting:** static files in `docs/`, published by GitHub Pages. No backend and no required build step: plain HTML, CSS and JavaScript, with libraries from a CDN.
- **Licence:** AGPL-3.0 (see `LICENSE`). Put an SPDX line (`AGPL-3.0-or-later`) at the top of source files.
- **Privacy:**
  - Trip data never goes into this repository. It lives in the browser (auto-saved to local storage) and in files the owner saves.
  - Demo or test data must be obviously fake.
- **Outside services** (all free with conditions; sources in the design doc):
  - **Map:** MapLibre GL JS with OpenFreeMap vector tiles, **Liberty style only**. Positron shows no points of interest.
  - **Search:** Photon (`https://photon.komoot.io/api/?q=…&lat=…&lon=…&lang=en`). Never Nominatim: it forbids search-as-you-type.
  - **Place details:** Overpass, OpenStreetMap's read-only query service (`https://overpass-api.de/api/interpreter?data=…`). One lookup per previewed place, and nothing else — the stop lookup moved to a published snapshot (design doc, decision 22). The fair-use guideline is 10,000 queries a day for light use, but **about 100 a day counted across all users** for anything used regularly, which is what this is. It is slow and often refuses outright, so previews must work without it.
  - **Stops for the public transport fallback:** a snapshot we publish at
    `https://tigerasks.github.io/plan-my-trip-data-stops/`, built from OpenStreetMap by
    `tools/refresh-stops.py`. Same origin as the app, so no CORS. ODbL, credited on the page.
  - **Walking and taxi routes:** OSRM on the FOSSGIS servers.
    - Endpoints: `https://routing.openstreetmap.de/routed-foot/route/v1/foot/LON,LAT;LON,LAT` and `/routed-car/route/v1/driving/…`.
    - Terms: reasonable non-commercial use, at most one request per second.
  - **Public transport:** Transitous.
    - Endpoint: `https://api.transitous.org/api/v6/plan?fromPlace=LAT,LON&toPlace=LAT,LON&time=ISO`, falling back to v5.
    - Conditions: open source and non-commercial only. Browser requests identify themselves through the Referer header, with contact details shown on the site. Cache results.
    - The owner gives Transitous a heads-up in their Matrix channel (`#transitous:matrix.spline.de`) once other people use the planner. Development traffic is too small to need it (design doc, decision 14).
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
- the schedule simulation: times, waits, opening hours and last entry, fixed times, time windows, back-by time;
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
2. **Places — built:**
   - Photon search, tapping the map to add, dropping a pin;
   - look before you add: tapping or finding a place opens a preview first. It shows the map information (English name where available, local name kept, type), the distance from the plan, OpenStreetMap details via Overpass, the user's own look-up links, and "Check on Google Maps" opening beside the planner (a separate window on a laptop, the Maps app on a phone), then the Add buttons;
   - an hours editor per place: filled from OpenStreetMap where available and marked unverified, confirmed or corrected by the user, feeding the timeline;
   - durations: 1 h by default, 0–12 h in 15-minute steps;
   - moving places between plan, today, backlog and another day;
   - Delete, with undo.
3. **Plans — built:**
   - three versions per day, with copy between them;
   - a timeline with times, waits and conflicts;
   - Optimise order;
   - priority labels only when imported.
4. **Travel times — built:**
   - estimates first, then real routes: OSRM for walking (with real paths) and taxi (with a pickup allowance), Transitous for public transport;
   - handling of how far ahead timetables reach;
   - when Transitous finds nothing, a check whether it knows any stops nearby, to tell "no timetables" from "no connection";
   - the stop-based fallback: every stop within 10 minutes' walk of each end, widening to 20 minutes where an end has none, and no public transport estimate if there are still none; lines from OpenStreetMap where mapped; the quickest combination; used only when it clearly beats walking;
   - caching and self-calibrating estimates;
   - a leg card showing the estimate against the real time, where you can also enter your own time.
5. **Chat round trip — built:**
   - a package is merged by place id, three ways against the package the chat last sent, so filling
     in hours nobody had set lands quietly and only a field both sides moved is put as a question
     (design doc, decisions 26 and 27). A package never deletes: a place it leaves out is one it had
     nothing to say about;
   - the questions come as one list, a choice per place, with "keep all mine" and "take all theirs"
     at the top. Nothing changes until Apply, and the whole merge undoes in one go;
   - the hand-back carries the note, the chosen version plus any alternatives ticked, the computed
     plan with its issues and checks, what was added, moved, deleted or edited since the last
     package, and every travel time with its source — so the chat can tell a measured 43 minutes
     from an estimate, and a stop-based guess from a timetable;
   - the credits say the planner is personal and non-commercial and give somewhere to complain,
     which is what Transitous and OSRM ask for;
   - `documentation/chat-guide.md` is written. The v1 spec stays as it is.
6. **Stops from a snapshot — built.** Overpass turned out not to be dependable enough to ask about
   stops (design doc, decisions 22 to 25 and the fifth and sixth service runs), so the planner reads
   them from a snapshot we publish instead:
   - `tools/refresh-stops.py`, which builds the snapshot from OpenStreetMap extracts and publishes
     it;
   - the planner reads a tile rather than asking anybody: the file a point needs is arithmetic on its
     coordinates, the manifest says which tiles exist so nothing is ever asked for in vain, and a
     tile is decoded only as far as its positions until a stop turns out to be near enough to matter;
   - a line is named only where the map says it calls at **both** stops, and a pairing on such a line
     beats a quicker one that is on nothing. For the demo trip that turned "probably the EX100 bus",
     an airport coach picked out of nine candidates, into bus 206 from Kyoto Station to Gojozaka;
   - the snapshot is consulted only where Transitous has no timetables for the area. Where it has
     them and found nothing leaving, that answer stands: it knows about times, and the snapshot does
     not;
   - the credits name the snapshot, its date and its licence;
   - the global snapshot is built and published, as of Fri 23 Oct 2026: **4,495,039 stops in 8,985
     tiles**, 180 MB, every continent Geofabrik publishes. The seventh service run drove the
     published app through it in London, Buenos Aires and Nairobi, with Overpass asked nothing at
     all.

## Open items

- **Verify:**
  - confirmed: tapped feature ids are OpenStreetMap ids times 10 plus the element type (1 node, 2 way, 3 relation). Nodes and ways are both verified live; relations never came up in three runs, and places are rarely relations;
  - answered: OpenStreetMap has Kyoto's bus lines with their numbers, Transitous has no stops at all for them, and a leg is named from `agencyName` plus `headsign` (design doc, fourth run);
  - whether any of that holds in another country: it is one city on one day;
  - answered (fifth run): the stop-based fallback's Overpass query works as written, and every stop
    it returns carries a position — 115 stops and 189 lines by Kyoto Station, 15 and 21 by the demo
    trip's temple, none without one;
  - answered (fifth run): MOTIS states `legGeometry.precision` on each leg and it is 6. The planner
    already reads it, so the 7-then-5 guess behind it never runs;
  - answered (fifth run): the timetables reach about two months — five journeys 30 and 60 days out,
    nothing from 75 days on. `TIMETABLE_REACH = 30` is a floor, and the same-weekday retry is what
    evidences the claim;
  - answered (sixth run): the published app does the whole chain against the live services — OSRM
    walks with real paths, a Transitous journey drawn and named, and the stop fallback working a
    third leg out. Transitous turns out to have Kyoto's subway, so the fourth run's gap is city
    buses only;
  - settled: Overpass is not dependable enough to ask about stops. On 22 Oct every answer took 33 to
    40 seconds, a one-element lookup included, and across three drives of the real app it refused far
    more often than it answered (5 of 6, then 7× 502 and 3× 429 in one session). The stop lookup
    moves to a published snapshot (decision 22); Overpass keeps the place-details job, which is one
    query per place opened and degrades gracefully;
  - answered (the global snapshot, Fri 23 Oct): how well OpenStreetMap maps stops and routes varies
    enormously, and the planner inherits all of it. Worldwide 90% of stops carry a name and 57% a
    line. By place: Sydney 92% on a named line, Paris 82%, Tokyo and London 72%, Kyoto 55%, New York
    34%, Buenos Aires 0% of 400 stops, Nairobi 0% of 39. A stop with no line can still be paired,
    just not named, and a stop with no name is called "the stop" — both seen working in the seventh
    run;
  - **still open:** a city like Nairobi, with 39 stops mapped in the whole tile, gets an answer that
    looks like the others and is worth far less. The planner has no way to say "the map barely covers
    this place", and it should;
  - staleness is a new failure mode: a line that opens after a refresh is invisible until the next
    one, and with Overpass gone from this path nothing catches it. The "stops as of" date is the
    mitigation, not a fix.
- **Before going live:** the Transitous heads-up, and licence headers. The credits have been on the
  page since milestone 4 — OpenFreeMap, OpenMapTiles, OpenStreetMap contributors with a "fix the
  map" link, Photon, Overpass, OSRM at FOSSGIS, Transitous with its data sources, and the stop
  snapshot with its build date — and milestone 5 added what the services actually ask for beyond
  attribution: that the planner says it is personal and non-commercial, and gives somewhere to
  reach whoever runs it.
- **v1:** the Claude-hosted planner stays for now; this is the owner's decision.
