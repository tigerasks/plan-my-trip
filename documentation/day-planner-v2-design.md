# Day planner v2 — design draft

Draft for review. Once built, v2 sits alongside the Claude-hosted planner (v1), which stays for now. The v1 spec stays as it is; the chat gets a separate guide for v2's exchange format.

**Changed Fri 25 Sep 2026, review round 1:** decisions recorded (see the end). Travel times now come from routing services, with the planner's own estimates as the fallback. The planner no longer picks places on its own, so "Fits if you drop …" and the pace budgets are gone. Priority labels only come from the chat's imports. Delete added.

**Changed Fri 25 Sep 2026, review round 2:** no cost hints; every place gets an adjustable duration, 1 hour by default; automatic route checks and self-calibrating estimates decided; licence still open.

**Changed Fri 25 Sep 2026, review round 3:** AGPL-3.0 licence; real walking paths; the planner auto-saves in the browser, and every export and import works as text or as a file.

**Updated Fri 25 Sep 2026:** Transitous details from its API page (how web apps identify themselves, a heads-up before routine routing, versioned endpoint); test page `probe.html` prepared.

**Updated Fri 25 Sep 2026, after the service test:** Liberty is the only map style (Positron shows no places to tap). Public transport gets a nearest-stop fallback where there are no timetables. Results recorded under "Service test".

**Updated Fri 25 Sep 2026, handoff:** the app is published at https://tigerasks.github.io/plan-my-trip/ from the repository's `docs/` folder. Currency conversion is optional, into a currency the user chooses. "Check on Google Maps" is for opening hours only.

**Updated Fri 25 Sep 2026, look before you add:** tapping or finding a place opens a preview first, with OpenStreetMap details (via Overpass) and an hours editor. Google Maps opens beside the planner. The test page gains a details check.

**Updated Fri 25 Sep 2026, service test 2:** the map's ids are OpenStreetMap ids (confirmed). OpenStreetMap's details are thin for small places. The public transport fallback now works from all stops near both ends, not just the nearest.

**Updated Fri 25 Sep 2026:** the stop search widens from 10 to 20 minutes' walk before giving up. Google Maps opening in a separate window is confirmed.

**Updated Wed 21 Oct 2026, the public transport probe:** the two questions milestone 4 was waiting
on are answered, and both answers hold. Kyoto's city buses are not in Transitous at all — not the
timetables, not even the stops — while OpenStreetMap has them in full, with line numbers. So the
stop-based fallback is both needed and buildable. A transit leg is named from its agency and its
headsign, not from `routeShortName`, which a Japanese operator fills with a numeric id. Every leg
carries a `legGeometry`, so a train can be drawn on the map and not only a walk. Overpass took
26 to 44 seconds for the queries the fallback needs, which decides how they have to be made.

**Changed Sun 4 Oct 2026, adding where you want it:** every gap in a version has a plus, and the
ideas and the backlog have one at the top. A plus opens a panel listing the trip's own places first —
the day's, including ones already in the version, and the backlog — then whatever a search turns up.
A search result in the panel beside the map now behaves like any other row: tapping it moves the map
to it, and its menu holds the three ways to add it and "Open details".

**Changed Sun 4 Oct 2026, a place can be a stop twice:** a version may list the same place more than
once, so you can go back somewhere later in the day. It is one place with one set of hours and one
duration; each appearance is its own stop, removed on its own, and taking the place off the day takes
out every copy.

**Changed Sun 4 Oct 2026, no more lunch window:** a day no longer has one, and a place is no longer
marked as a lunch option. The planner never puts a meal in a day for you — somewhere to eat is a
place you add like any other, and it may well be an attraction you intend to eat at. The `lunch` key
on a day and the `meal` key on a place are both gone.

**Updated Sat 3 Oct 2026, milestone 3:** the timeline is built. Travel in it is the planner's own
estimate from straight-line distance, marked ≈, until milestone 4 puts real routes behind it. Optimise order relocates stops and reverses stretches, judging an order by its problems
first, then travel, then waiting, then how late it finishes; adding a place to a version now uses the
same judgement rather than straight-line distance. Today's ideas carry a chip naming the versions
that already hold them.

**Changed Sat 26 Sep 2026, accommodation:** where you sleep is now a **stay** of its own — a place, a
first night and a number of nights — rather than a start and end place typed onto every day. The days
a stay covers take their start and end from it, and are created if the trip does not have them yet.
Days can also be added several at a time.

**Updated Fri 25 Sep 2026, milestone 2:** places are built. Two things worth recording. Adding to a
plan puts a stop where it adds the least straight-line distance, not yet where it causes the fewest
problems — that waits for the scheduler in milestone 3. And the hours editor is two wheels for every
time, an hour and a quarter-hour, with "same every day" broken out per day when a place needs it; an
imported time that is not on a quarter hour is kept as an extra stop on the wheel rather than rounded.

**Updated Fri 25 Sep 2026, service test 3:** Transitous does have Kyoto's rail timetables — the first two runs were bus journeys. The stop-based fallback is for the bus gap, not for the city as a whole. Node ids confirmed. Photon and Overpass can both take about two seconds. Raw output now kept in `service-tests.md`.

**Updated Fri 25 Sep 2026, Transitous:** building the planner sends Transitous too little traffic to be worth telling them about. The heads-up is the owner's to send, once other people are actually using the planner; while it isn't being advertised it may never be needed.

**Updated Fri 25 Sep 2026, milestone 1:** the exchange format is settled and written down below: fixed marker lines, one envelope, and the same envelope again as a `.json` file. Opening hours are kept as a weekly table with the original OpenStreetMap text beside them, so a place can carry its hours before it has a day. A place belongs to exactly one day through its own `dayId`; the three versions hold order only.

**Updated Thu 22 Oct 2026, the stops move off Overpass:** the fifth and sixth service runs settled
the question milestone 4 left open. Overpass refused five requests in six, took 33 to 40 seconds
when it answered a one-element lookup, and its documented allowance for something used regularly is
about a hundred queries a day counted across every user — a tenth of what one day's legs spent. So
the stop lookup becomes a snapshot we build from OpenStreetMap and publish ourselves (decisions 22
to 24), which is also better data: route relation membership says which lines really call at a stop,
where a live query could only say a relation was somewhere nearby. For the demo trip's first leg
that is nine genuine candidates instead of one arbitrary airport coach. Overpass keeps the
place-details job. `tools/refresh-stops.py` and a Kansai-and-Kanto snapshot are built; the planner
reads it in milestone 6, and until then still asks Overpass. The "Travel times" section below still
describes the live query, and is rewritten when that lands.

## Why a v2

The first planner lives inside Claude and syncs with the chat through a shared database. Claude's published pages can't load outside data. So its map is a schematic without streets, and it can't search for places.

v2 runs as an ordinary web page instead. That buys two things:
- a real street map you can tap to discover and add places;
- place search, so the planner is useful on its own and can start empty.

The price is the live link: data moves between planner and chat as a pasted text block or a file.

## Where it runs and what it uses

| Piece | Choice | Notes |
|---|---|---|
| The page | Static files in the `docs/` folder of the `plan-my-trip` repository, published by GitHub Pages at https://tigerasks.github.io/plan-my-trip/ | A real web address lets the map, search and routing services work on the laptop, the phone and your wife's devices. The code is public there under the AGPL-3.0 licence, which meets Transitous's open-source condition; your trip data never goes into the repository. A local file is the untested fallback. |
| Street map | MapLibre GL JS with OpenFreeMap vector tiles | Free, no API key, no request limits, OpenStreetMap data ([openfreemap.org](https://openfreemap.org/)). Style: Liberty; Positron was dropped because it shows no places to tap. The map is data, so tapping a place gives its name, type and position. Credit is shown on the map. |
| Place search | Photon, komoot's public geocoder | Built for search-as-you-type and biased towards where the map is looking. Free for fair use; heavy use is throttled; no availability guarantee ([Photon](https://github.com/komoot/photon)). OpenStreetMap's Nominatim is not used, because its policy forbids search-as-you-type ([policy](https://operations.osmfoundation.org/policies/nominatim/)). |
| Place details | Overpass, OpenStreetMap's read-only query service | Opening hours, cuisine, website, phone, reservations and diet options, where mappers entered them. One lookup per previewed place; the public servers treat fewer than 10,000 queries a day as safe, far above our use, but can be slow when busy ([Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API), [usage guidance](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html)). |
| Reviews, photos, current hours | "Check on Google Maps" in the place preview | Opens a Google Maps search for the local name plus area and city: in a separate window beside the planner on a laptop, in the Maps app on a phone. Nothing from Google is stored or embedded; an embedded Google map would need a Google Cloud key and shows little. |
| Walking and taxi times | OSRM on FOSSGIS's OpenStreetMap routing servers | Real routes on OpenStreetMap streets, with foot, car and bike profiles. Reasonable non-commercial use, at most one request per second, no guarantees; credit and a "fix the map" link required ([demo server](https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server), [about](https://routing.openstreetmap.de/about.html)). No traffic data, so taxis get a pickup allowance. |
| Public transport times | Transitous, a community-run router built on open timetables | Free, across borders, for projects that are open source, non-commercial and light on its resources. Web apps may identify themselves through the page address, as long as the site shows contact details; results should be cached and the data sources credited ([API and policy](https://transitous.org/api/)). Coverage depends on which operators publish open timetables. |
| Fallback times | The planner's own distance-based estimates | Instant and offline, marked ≈. Used where routing has no answer, and for quick "from here" exploration. For public transport without timetables, a stop-based estimate uses nearby stops and, where mapped, OpenStreetMap's bus and rail lines. |

## Service test (Fri 25 Sep 2026, from GitHub Pages in Chrome, Kyoto)

- **Page:** served over https from GitHub Pages; browser storage and clipboard work.
- **Map:** both styles and their tiles loaded in under 0.1 s.
- **Tapping:** in Liberty, places come back with names in several languages, a type (restaurant, post office, Buddhist temple) and a numeric id. Positron returns only neighbourhood names.
- **Search:** found "Nintendo Museum" in Uji, 13 km away, in 0.4 s, with its OpenStreetMap reference.
- **Walking and taxi:** OSRM answered in about 20 ms. A 1.5 km straight line came out at 31 min walking and 4 min by car over 2.3 km, which shows why taxis need a pickup allowance.
- **Public transport:** Transitous answered (API v6, 70 ms) but found no journey, although a bus stop sits right next to the destination. At the time this looked like missing Kyoto timetables; the third run showed it is narrower than that — see below.

**Second run, same day:**
- **Place details:** the map's ids decode to OpenStreetMap ids. Sukiya's became way 1135461266 and was found directly in 175 ms, so details lookups are exact and every place gets a source link.
- **What OpenStreetMap knows:** little for small places. Sukiya had cuisine and takeaway but no hours. Well-known sights tend to carry more, so Google Maps stays the main check for restaurants.
- **Google Maps** opened in a separate window, as intended.
- **Walking** now follows real streets on the map.
- **Public transport:** Transitous again found nothing, this time from Daisen-in, although the Imamiya-jinja-mae bus stop is a few minutes' walk away. The router walks to nearby stops by itself when it has their timetables, so this pointed at missing bus timetables — which the third run bears out, while showing that the rail ones are there.

**Third run, Fri 25 Sep 2026 15:27 UTC** (raw output in `service-tests.md`), around Kyoto Station and Tō-ji:
- **Public transport works in Kyoto after all.** Tō-ji to Kyoto Station returned five journeys, all using transit, the best 25 min with no changes on a regional rail leg. So Transitous has Kyoto's rail timetables. The reading that fits all three runs is rail yes, city buses no: the two runs that found nothing were bus journeys, from Daisen-in and to a destination served only by a bus stop.
- **But the line has no name.** The leg came back as `REGIONAL_RAIL 18999264` — the mode plus a numeric id where `displayName` or `routeShortName` should be. A leg card cannot show that, so naming a line needs another field, or OpenStreetMap, or the planner just says "train".
- **Node ids confirmed.** Feature `52797288601` decoded to `node/5279728860` and Overpass found it with a matching name. With the way case from the second run, the ×10 + element type rule holds both ways that matter. The six taps were five nodes and one way (`3598968102` → way 359896810, Tō-ji); no relation came up, which is what you would expect of places.
- **Names need a fallback chain.** Tō-ji came back with no plain `name` at all: only `name:en`, `name_int`, `name:nonlatin` and a dozen translations. Pizza Little Party had `name` in Japanese plus `name:en`, `name_en`, `name:latin` and `name:nonlatin`. And "East Temple" for 東寺 is why the local name is always kept.
- **Types map cleanly:** `fast_food`, `cafe`, `restaurant`, `viewpoint` under `attraction`, `place_of_worship`.
- **Still no opening hours.** Pizza Little Party had seven tags — cuisine, phone, takeaway — and no hours. Two small restaurants, two misses: the hours editor will mostly be typing.
- **Both lookups can be slow.** Photon took 1.5–1.8 s against 0.4 s in the first run, Overpass 1.9 s against 175 ms. Search has to stay responsive through a two-second reply, and the preview has to draw before Overpass lands.
- **Searching "Kyoto" returns the station**, `railway=station`, not the city. Setting a day's city needs more than the first hit.
- **Walking and taxi:** 27 min against 5 min over about 2 km, in 15 ms. The pickup allowance stands.

**Fourth run, Wed 21 Oct 2026** (the public transport probe, `docs/probe-transit.html`; raw output in
`service-tests.md`):
- **Kyoto's city buses are not in Transitous.** Daisen-in to Kinkaku-ji returned no journey at all,
  and asking what stops it knows at either end returned an empty list. The same question without the
  stop filter returned ten OpenStreetMap places at each end, so the question lands and the answer is
  real: it has no transit data for that part of the city. Decision 13's fallback is not a nicety.
- **Where rail exists it works well.** Tō-ji to Kyoto Station gave five journeys, the best 24 min,
  and the stop look-up named 東寺 (`jp-japan-rail_9639`) and three at Kyoto Station — among them two
  long-distance coach feeds, so a little bus data exists; just not the city network.
- **Naming a leg:** `routeShortName` and `displayName` both came back as `8999421`, and
  `routeLongName` was empty. What is usable is `headsign` (京都) and `agencyName` (近畿日本鉄道), which
  is how a Japanese train is described anyway: the operator, and where it is heading.
- **Every leg has a shape.** `legGeometry` was populated on all three legs, the rail one included
  (39 points). Transit legs can be drawn on the map, not only walks.
- **OpenStreetMap has Kyoto's buses.** Around Daitoku-ji and Kinkaku-ji: bus stops and route
  relations, *every* relation carrying a `ref` — 102, 6, 9, 12, 15, 37, 50, operator 京都市交通局 —
  and lines serving both ends in common (102 and 12). That is exactly what naming a line needs.
  Around Kyoto Station the relations are named trains instead (Nozomi, Haruka, Thunderbird), often
  with no `ref`; but that is where Transitous works, so it matters less.
- **Overpass is slow for this.** 26, 37, 44 seconds for one 800 m query. Not something a leg can
  wait on.
- **A caveat on the counts.** The probe asked for `out tags 60` and every end came back summing to
  exactly 60, so its stop and route counts are truncated; the "0 relations" at Kyoto Station is that
  limit, not the map. Raised to 400 afterwards.

**Fifth run, Thu 22 Oct 2026** (the queries milestone 4 actually sends, asked directly against the
live services from the repository, one at a time 1.2 s apart):
- **The stop query works, and every stop has a position.** The planner's own
  `nwr(around:800,…)[highway=bus_stop]` and friends with `out tags center 400;` — the part earlier
  runs never proved — came back with 115 stops and 189 route relations by Kyoto Station, and 15 stops
  and 21 relations by the demo trip's temple. *All* of them carried a position, by `lat`/`lon` on a
  node or `center` on a way, so the fallback can measure a walk to every stop it is told about. The
  400 limit was not reached at either end (304 elements at the busiest).
- **Overpass is slower and ruder than the fourth run suggested.** Every answer took 33 to 40 seconds,
  including a one-element place lookup, over eight samples with no fast case at all. Worse, it refuses
  outright with a 502 and "all query workers are busy": three refusals in a row before the stop query
  got through, and one in six for the light query. It asks to be retried with exponential backoff.
  This broke two things, both now fixed: the planner gave up on the first refusal and reported "no
  stops" where there were a hundred, and its 20-second default timeout was shorter than Overpass's
  normal reply, so place details in the preview would have failed nearly every time.
- **MOTIS states the precision, and it is 6.** `legGeometry` carries a `precision` field alongside
  `points` and `length`, set to 6 on every leg. The planner already reads it, so the 7-then-5 guess
  behind it never runs; decoded at 6 the shape starts 11 m from the leg. Running `core.js` over the
  live payload gave a 54-minute journey named "JR towards 奈良" with a 1074-point path that passes
  `pathLooksRight`. This closes the last unverified thing in milestone 4.
- **The timetables reach about two months.** Kyoto to Nara answered with five journeys 30 and 60 days
  out, and with nothing at all 75, 90, 105 and 120 days out. So `TIMETABLE_REACH = 30` is a safe
  floor rather than a measurement: past it the planner spends one extra request checking the same
  weekday, and that retry is what actually evidences "the timetable does not reach that date".
- **Stops confirm the fallback is needed, not hypothetical.** Transitous knows three stops by the
  demo hotel (京都, 京都駅八条口, 京都駅) and *none* by the temple 3 km away, where OpenStreetMap has
  15 stops and 21 lines. That is decision 13's case, in the demo trip itself.
- **The stop endpoint is v1 only.** `v1/reverse-geocode` answers; `v6/reverse-geocode` is a 404. The
  planner defaults to v1, which is right.
- **The fast services are still fast.** Photon 11 results in 0.2 s; OSRM walking 44 min over 3.32 km
  with a 232-point shape in 0.2 s, driving 9 min over 3.90 km in under 0.1 s. A car route starts at
  the nearest drivable road, which was 124 m from a point beside the station — well inside
  `PATH_SLACK`, but a reminder that the ends of a route move.

**Sixth run, Thu 22 Oct 2026** (the published app itself, driven in Chromium against every live
service, the demo trip's first day):
- **The whole chain works end to end.** OSRM checked all three walks with real paths (44 min/3.32 km,
  37 min/2.76 km, 36 min/2.67 km). Transitous planned the leg home: 17 min, drawn, named
  "京都市交通局 towards 竹田(京都府)", spelled out as "walk 11 min to 四条 · 3 min to 京都 · walk 3 min".
  The stop fallback did the leg out to the temple: 37 min, "probably the EX100 bus", "walk 1 min to
  Kyoto Station · ≈ 19 min by bus · walk 17 min from 池田町". Three different sources on one day,
  each labelled as what it is.
- **Transitous has Kyoto's subway, not just its rail.** 四条 to 京都 in 3 minutes under 京都市交通局 is
  the Karasuma line. The fourth run's finding holds for city *buses*; the subway is there.
- **The hedge on a line name earns its keep.** "probably the EX100 bus" is a limited-express airport
  coach, which will not be stopping at 池田町. The map says both ends have an EX100 relation near
  them and that is all it says, which is exactly why the wording hedges.
- **Picking a stop by estimate and then measuring it can move the answer a lot.** 池田町 was chosen as
  within ten minutes' walk on the estimate; OSRM then measured that walk at 17 minutes. The leg still
  came out ahead of walking the whole way (37 against 44), but the margin is thinner than the pairing
  thought it was. Something to watch: a stop that loses its advantage once measured is not re-picked.
- **Overpass refused far more than it answered, and started rate-limiting.** Across three drives:
  one clean run of two queries, and runs of 6 requests with 5 refusals and 14 requests with 7× 502,
  3× 429 and one 90-second timeout. The 429s are Overpass objecting to the planner's own volume, so a
  refusal now waits the longest wait rather than the shortest, which is decision 20.
- **The honest-failure message fired in the wild.** One leg's stop lookup never got through, and the
  leg said "OpenStreetMap was too busy to say which stops are nearby" rather than passing Transitous's
  "no stops near there" off as the whole story. That fault was found by this run and fixed in it.
- **Nothing else broke.** No page errors, no console errors beyond the browser's own notes about the
  refused requests, and every published file serves (index, style, core, live, map, app, both probes).

**Still to verify during the build:**
- answered (fourth run): OpenStreetMap's bus lines are mapped well enough in Kyoto to name one, every
  relation carrying a line number. Rail relations around a station are named rather than numbered;
- answered (fourth run): Transitous knows no stops at all for Kyoto's city buses, which is what tells
  "no timetables here" from "no connection now";
- answered (fourth run): a leg is named from `agencyName` and `headsign`; `routeShortName` and
  `displayName` are a numeric id and `routeLongName` is empty, at least for this operator;
- answered (fifth run): the stop query the fallback sends, and that every stop it returns carries a
  position;
- answered (fifth run): MOTIS states `legGeometry.precision`, and it is 6;
- whether the same holds in another country: all of the above is one city on one day;
- how often Overpass is this slow. Eight samples on one afternoon is not a pattern, and if 35 seconds
  is normal rather than a bad day, a second provider or the offline snapshot becomes the question;
- how big a trip region's feeds are once reduced to stops, lines and frequencies, and what their
  licences allow being republished, if the offline fallback is ever needed;
- the local-file fallback, optional now that GitHub Pages works;
- the exact credit lines.

OpenStreetMap's own tile servers are out regardless: they reject pages that don't send a web address ([tile policy](https://operations.osmfoundation.org/policies/tiles/)).

## Travel times

Every leg starts with the planner's own estimate, computed instantly from the two positions. It exists even from a blank start, but it's rough, so it's marked ≈.

Legs that are part of a plan then get checked against real routes: OSRM for walking and taxi, Transitous for public transport. Results are cached in the trip data, so each leg is asked once, and requests are spaced at least a second apart. A checked leg shows the real time and its source; its card also shows the estimate and flags a big gap between the two, comparing like with like — a checked walk against what the planner would have guessed for walking.

**A leg holds every way of making it, side by side.** Walking, public transport and taxi each keep
their own time, distance, shape and source, so checking the taxi never loses the walk. The planner
then chooses which one the day uses: your own time if you gave one, then whichever way you picked,
then the quickest that makes sense — a ride has to clearly beat walking, and a taxi is never
assumed, since taking one is a decision. A long walk where a ride still looks quicker stays on the
card without taking the leg over, so the day does not look worse than it is while a real transit
time is still missing.

The planner checks the legs of the day on screen by itself, without being asked. It waits for the
screen to go quiet, asks about one leg at a time, gives way to anything you are waiting for, and
tries each leg once. The walking time is asked for on every leg, however long: it is what a ride has
to beat, and it is the one thing OSRM can always answer.

Public transport has two catches. Timetables are usually only published a few months ahead, so for a
trip further out the planner asks about the same weekday and time in the current timetable, and says
so. And where Transitous finds no journey, the planner asks `/api/v1/reverse-geocode` what stops it
knows at each end, so it can say which case it is: no data for that kind of service in the region
(Kyoto has rail but no city buses, confirmed), or no connection at that time.

**Naming a leg.** From `agencyName` and `headsign` — "近畿日本鉄道 towards 京都" — because
`routeShortName` and `displayName` carry a numeric id and `routeLongName` can be empty. Where a
short name is a real line number it is used instead.

**Drawing a leg.** Every leg carries `legGeometry`, an encoded polyline with the precision it was
encoded at stated alongside it (6, in the fifth run). A checked leg is drawn along its real path
whatever the mode; only estimates stay as dashed straight lines. A shape that does not land on the
leg is dropped and the time kept, so a misread draws nothing rather than a line across the sea.

Where there are no timetables, it falls back to a stop-based estimate. This is the manual method
automated, and it reads the stops out of a snapshot we publish ourselves rather than asking anybody
(decisions 22 to 25):
- the snapshot is asked **only where Transitous has no timetables for the area.** Where it does have
  them and simply found nothing leaving then, that is a real answer about real services, and better
  than anything a map that knows no times could offer. The stop check that tells those two apart is
  what decides it;
- it considers every station and stop within 10 minutes' walk of each end, not just the nearest one.
  Where an end has none, it widens to 20 minutes. If there are still none, it gives up on public
  transport for that leg and says so;
- **a tile is fetched, not a query asked.** The file a point needs is arithmetic on its coordinates,
  it is on our own origin, and it is kept for as long as the page is open. Kyoto's tile is 177 KB and
  Tokyo's 469 KB over the wire, both in under half a second — against the 33 to 40 seconds Overpass
  took, when it answered at all;
- **a line is named only where it calls at both stops.** The snapshot carries route relation
  membership, so this is a good deal more than the old live query could say, which only knew a route
  passed somewhere near each end. Where several lines serve both, the leg says so — "probably the 206
  bus, or one of 8 others". It still cannot promise the two stops are consecutive, or that anything
  runs at the time, which is what "probably" is doing;
- it pairs the nearest dozen stops at each end, estimating both walks and the ride from distance, and
  prefers the quickest pairing **on a line that serves both** over a quicker one that is on nothing:
  one is a journey somebody could make, the other is two stops that happen to be near each other.
  Then it checks that pairing's two walks for real against OSRM — only those two, since asking about
  every candidate would be hundreds of requests for one leg. The ride stays an estimate, which is why
  the whole result is marked ≈;
- it suggests public transport only when that clearly beats walking; otherwise the leg stays a walk,
  which is also what stops a poor pairing doing any harm.

The result is marked ≈ and spells out the stops, and the line where known. From the snapshot, for the
demo trip's own first leg: "probably the 206 bus · walk 1 min to Kyoto Station · ≈ 18 min by bus ·
walk 13 min from Gojozaka". You can correct it with your own time.

Your own entries still win. Google's routing service itself isn't an option: as I understand its terms, its results can't be shown on a non-Google map (to double-check if it ever matters).

The estimates calibrate themselves from the checked legs in the same city, so the "from here" numbers improve as you go.

Walking legs are drawn along their real path, from the same routing requests. Other legs stay straight lines unless their routing result includes a path.

**If the hosted router is ever not an option.** Transitous publishes the timetable data it collects,
not only the routing built on top of it. The processed GTFS files sit at
`https://api.transitous.org/gtfs/`, one per source, and can be synced over plain HTTP; their API page
says as much: "There is no need to scrape data using the API, you may download our entire source
dataset". So the worst case is not losing public transport altogether. A trip's region is a handful of
feeds, and those can be reduced to what the planner actually needs — the stops near the trip's places,
the lines serving them and their typical frequencies — then served as a small file from the same
GitHub Pages site and refreshed by hand now and then. Two catches: the feeds carry their own licences
(CC-BY, CC-BY-SA, ODbL and some custom terms, listed per source), so anything republished has to be
checked feed by feed and credited; and the sizes and update cadence are unverified, so whether a
region's worth is small enough to publish is still an open question. The whole collection certainly
is not.

## The model

A trip has a backlog and days. Every place lives in exactly one spot: the backlog, or one day. Within
its day, a place may be in any, all or none of the day's three plan versions — it can be in Balanced
and Packed but not in Do less, and it can be a stop twice in the same version.

**"Ideas for today" means the day's places that the version on screen does not hold**, not the places
in no version at all. So removing a stop from Balanced drops it into the ideas, where you can still
see it, even while Packed still holds it. An idea that another version does hold says so, with a chip
naming them, so switching version holds no surprises.

| Thing | Holds |
|---|---|
| Trip | Title, time zone label, default transit type, optional preferred currency, backlog, stays, days |
| Stay | Where you sleep: a place with its position, the date of the first night, and how many nights |
| Day | Date, city, the times it starts and ends, ideas for today, three plan versions |
| Plan version | Do less, Balanced or Packed: which places, in which order |
| Place | Name, position, type, area, duration, fixed time or time window, opening hours with their source (OpenStreetMap, you or the chat), the OpenStreetMap id where known, check flag, notes, links, who added it (chat or you) and how (search, map, pin), and a priority label only if the chat's import gave it one |

Priority labels (Must-do, Want, Maybe) are optional. They only come from the chat's imports, they're shown as labels, and they never make the planner do anything. A label travels with its place, so a must-do can sit in the backlog before it has a day. Places you add yourself get no label.

## Moving things around

"Plan" always means the version on screen.

| From ↓ · To → | Plan | Ideas for today | Another day | Backlog | Delete |
|---|---|---|---|---|---|
| New place | Add to plan | Add to today | — | Add to backlog | — |
| Backlog | Yes | Yes | Yes (pick the day) | — | Yes |
| Ideas for today | Yes | — | Yes (pick the day) | Yes | Yes |
| Plan | — | Remove | — | Remove to backlog | Yes |

**Removing:**
- **Remove** takes a place out of this version only, so it can still be in another version.
- **Remove to backlog** takes it off the day altogether, so it leaves all three versions. The planner says so when that affects another version.

**Adding:** adding to a plan without saying where inserts the place at the best position (fewest
problems, least travel); the plus between two stops puts it exactly there; dragging adjusts.

**Dragging.** Every row has a grip on its left. Dragging by it reorders a version, and carries a
place between the plan, today's ideas and the backlog in either direction, which does the same as
the moves above. Only the grip starts a drag, so a row can still be tapped and the list still
scrolls under a thumb; nearing the top or bottom of the panel scrolls it, so a list that is off the
screen can still be reached.

**Acting on a place.** Everything you do to a place is on its own row, behind a menu: add it to the
version on screen or take it out, move it to another day or the backlog, set how long it takes,
delete it. Opening a place is for reading it — what it is, when it is open, what still needs
checking, where to look it up — with the hours editor the one thing you can change there.

**Deleting:** Delete, shown in red, drops a place entirely, from every version and from its day or the backlog, with undo.

## The three versions

Each day opens on Balanced. The versions are yours: they hold what you put in them, or what a chat package proposed, and the planner never adds or removes places on its own.

- **Copying.** "Copy to Do less" or "Copy to Packed" takes the version on screen as the starting point there.
- **Timeline.** For the version on screen, the planner works out times, waits and conflicts: opening hours, fixed times, and when you need to be back. Nothing is ever added to a day that you did not put there.
- **Optimise order** re-sequences your stops for less travel and fewer conflicts, without changing what's in them.
- **Must-do labels** stay visible wherever the place is, so a must-do sitting outside a plan stands out. Nothing is enforced.
- **Hand-back** sends the version you pick, optionally with the other two as alternatives.

## Adding places: look before you add

There are three ways to find a place: search for it, tap something on the map, or tap an empty spot to drop a pin and name it. All three open a **preview** first; nothing is added until you choose.

The preview fills in from three layers:
- **At once, from the map:**
  - the name, in English where the map has one and always in the local name too (alternative names joined with ";" are trimmed to the first);
  - the type: restaurant, café, temple…;
  - how far it is from the plan, such as "≈ 5 min walk from stop 3".
- **Within a second or two, from OpenStreetMap:** opening hours, cuisine, website, phone, reservations, and vegetarian or vegan options, wherever local mappers entered them.
  - Coverage varies: well-known sights are rich, small restaurants often have just a name.
  - The preview shows the map information first and fills in the rest as it arrives. If the lookup fails, the preview still works.
- **Links out:**
  - "Check on Google Maps", for reviews, photos and current hours. It opens beside the planner: a separate window on a laptop, the Maps app on a phone. The preview stays open for when you come back.
  - the place's own website, when OpenStreetMap has one, and its OpenStreetMap entry as the source;
  - look-up links you set yourself, such as Tabelog for restaurants in Japan.

At the bottom are the three buttons: Add to plan, Add to today, Add to backlog. If no day exists yet, only the backlog is offered.

**Opening hours.** Every place has an hours editor.
- When OpenStreetMap has hours, they're filled in and marked unverified.
- You confirm or correct them after checking, and from then on they drive the timeline.
- Places without hours carry a "Hours unknown — check" flag.
- The hours record where they came from: OpenStreetMap, you, or the chat.

**New places** start with a duration of 1 hour and no priority label.

**Durations** are adjustable for every place, whether you added it or it came from the chat's package with its own duration: from 0 to 12 hours, plus 0, 15, 30 or 45 minutes. The timeline adapts straight away.

*Not now:* an embedded Google map, a "What's here" list of everything in view, Wikipedia summaries, and a hand-off to the chat for researching shortlisted places.

## Map

- **Plans** show as numbered stops joined in order, out from where the day starts and back to where
  it ends. The thread is dashed while it is only straight lines between places; the real paths of
  milestone 4 are drawn solid, so the map says which it is the way ≈ does in the timeline.
- **Today's ideas** show as hollow markers.
- **The backlog** shows as faint dots you can switch off. The point is to spot backlog ideas near today's route.
- **Tapping** anything opens its card.
- **Selecting** a place shows estimated travel minutes from there to everything else, backlog included.
- *Proposal:* tone Liberty's colours down towards the house style, keeping its places.

## Days, stays and trip settings

A day gets:
- a date and a city;
- the time you set off and the time you want to be back, or no time back for an open-ended day.

Days are added one at a time or as a run of them, which is how a trip is usually laid out. Dates the
trip already has are never touched.

**Where a day starts and ends comes from the accommodation**, not from the day. A stay is one
booking: a place, found by typing an address or a hotel name, the date of the first night, and how
many nights. Three nights from the 21st means you sleep on the 21st, 22nd and 23rd and check out on
the morning of the 24th, so the stay is where those first three days *end* and where the 22nd, 23rd
and 24th *start*. All four days are created if the trip does not have them. The stay shows at the top
of every day it starts, and the morning you check out says so.

Where two stays overlap, the later check-in wins. A day no stay covers falls back to whatever start
and end it carries itself, which is how a trip imported from the chat still works. On the morning you
check out with nothing booked for that night, the evening is left unspoken for rather than pretending
you are going back to the hotel you have just left. Removing a stay leaves its days in the trip,
since by then they may have places on them.

Deleting a day sends its ideas back to the backlog.

Trip settings hold the title, time zone label and default transit type. Optionally they also hold a preferred currency: prices always show in their original currency, with a conversion only when one is set.

## Between chat and planner

**Format.** Both directions use the same envelope. As text it sits between two lines that never
vary, so the chat can print them from a script and the planner can find the block in whatever was
pasted around it:

```
--- BEGIN day-planner/2 ---
{"schema":"day-planner/2","kind":"save","tripId":"japan-2026","title":"Japan · Nov 2026","at":"2026-09-25T10:04:12Z","app":"day-planner 2.0.0","trip":{…}}
--- END day-planner/2 ---
```

`kind` is `save`, `package` or `handback`. As a file it is the same envelope, laid out to be read and
without the two lines, so it stays valid JSON that the chat can take as a project file.

Blocks are always generated by script, never typed. Reading is forgiving in the ways that copying
from a chat goes wrong: text before and after the block is ignored, so are code fences and Windows
line endings, and the lines between the markers are joined before parsing, so a block the chat has
re-wrapped still reads — JSON never holds a raw line break inside a string.

| What went wrong | What the planner says |
|---|---|
| No markers, and not JSON either | Can't find a block; copy everything from the BEGIN line to the END line |
| The opening line but no closing one | The block is cut off; copy it again from first line to last |
| Markers fine, JSON damaged | Damaged, and where it stops making sense; try the file instead |
| `day-planner/1` | From the first planner; a different format |
| A newer schema | From a newer planner; reload the page, or ask for a `day-planner/2` block |
| JSON, but no `schema` line | Valid JSON, but not the planner's |
| `kind: handback` | That is what the planner sends *to* the chat |
| An unknown `kind` | Quotes it back, and says what the planner does read |
| It loads, with gaps | Loads what it can and lists every repair, place by place |

**The trip inside.** One flat store of places, keyed by a stable id, with days keyed by their ISO
date:

| Key | Holds |
|---|---|
| `trip` | `id`, `title`, `tzLabel`, `tz`, `transit`, `currency`, `fx`, `fxAt`, `lookups[]`, `places{}`, `backlog[]`, `stays[]`, `days{}`, `createdAt`, `updatedAt`. `tzLabel` is only a label next to the times; `tz` is a time zone name like `Asia/Tokyo`, used to turn a local time into the instant a timetable service needs |
| `stay` | `id`, `name`, `localName`, `lat`, `lng`, `area`, `from` (the first night), `nights`, `note`, `osm` |
| `day` | `id` and `date` (both the ISO date), `city`, `start`, `end`, `plans{less,balanced,packed}`, `shown`, `centre`, `note`, `legs`. `start` and `end` carry the day's times; their place is only a fallback for when no stay covers the day |
| `place` | `id`, `name`, `localName`, `lat`, `lng`, `kind`, `area`, `duration`, `fixed`, `window`, `hours`, `closed[]`, `booked`, `priority`, `price`, `check`, `note`, `links[]`, `osm`, `added`, `dayId` |
| `hours` | `source` (`osm`, `you` or `chat`), `verified`, `raw` (the text it came from), `week` (seven days, each a list of open–close pairs, `[]` for closed, absent for unknown), `lastEntry` |
| `added` | `by` (`you` or `chat`), `how` (`search`, `map`, `pin` or `package`), `at` |
| `leg` | keyed `fromId>toId` within its day, where an end is a place id or `start`/`end`. Holds `pick` (the way you chose, or none), `mine` (`minutes`, `mode`, `at`) and one slot per way — `walk`, `transit`, `car` — each with `minutes`, `km`, `source` (`osrm`, `transitous` or `stops`), `at`, `asked`, `departs` (the departure a timetable answer is about), `path`, `precision`, `name` and `detail`. A slot with `asked` but no `minutes` is a service that was asked and had nothing, so it is not asked again |

Three rules hold at all times, and the planner repairs anything that breaks them on the way in:

- a place's `dayId` says where it lives — a day, or `null` for the backlog;
- `plans` hold order only, and may only name places of their own day — a place may appear more than
  once, for a station you pass back through, and each appearance is its own stop;
- the backlog is exactly the places with no day.

"Ideas for today" is worked out, never stored: the day's places that the version on screen does not
hold. `duration` is minutes, 0 to 720 in steps of 15. Times are `HH:MM` in destination local time,
dates are `YYYY-MM-DD`, and timestamps are ISO UTC.

**From the chat.** A package carries places for the backlog and the days, researched and verified as before, optionally with priority labels and proposed plan versions. It also carries your own versions from your last hand-back. Loading it merges by place id; where you've changed something since, the planner asks which version to keep.

**To the chat.** A hand-back carries:
- your note;
- the chosen version, with alternatives if you tick them;
- the computed plan, with its issues and checks;
- everything you added, moved or deleted since the last package;
- the travel times from the routing services, so the chat can tell real times from estimates.

The chat verifies your additions for that date (hours, closures, tickets), fills in what's missing, and folds them into the next package.

**Whole-trip sync.** Use Save to file and upload the file to the chat. The latest saved trip file becomes a supporting project file (you add it, like the research files), so later chats start from it.

## Storage

The planner auto-saves every change to the browser's own storage, a moment after you stop editing, and reopens exactly where you left off. Closing the tab or window by accident loses nothing.

Browser storage belongs to that browser on that device, though, and private windows or clearing browser data wipe it. So everything that goes out or comes in can travel two ways, with identical content:
- **as text:** copy it, then paste it to import;
- **as a file:** Save to file, then Import from file.

That covers a day's hand-back and the whole trip alike, and the importer accepts either form. Files double as backups and as the way to move a trip between devices; the planner shows when you last saved one. Syncing through your GitHub account could come later.

## Carried over and dropped

**Carried over:**
- the scheduler, which works out times, waits and conflicts, and the ordering logic behind Optimise order;
- the distance-based estimates, now as the fallback, and your own leg checks;
- the timeline;
- the house style and dark mode;
- the hand-back note.

**Dropped:** automatic selection by priority and pace, "Fits if you drop …", the shared database and the focus pointer. The Claude-hosted page stays for now, without the map or search.

## Before going live

A few duties come with the outside services:
- tell Transitous about the planner in their Matrix channel (`#transitous:matrix.spline.de`) once other
  people are using it. Their API page asks to be contacted "before using any potentially
  resource-intensive API endpoints (such as routing, isochrones) or doing many requests (also from
  different users)". That is about capacity, and building the planner does not trouble it: a few dozen
  requests made by hand, cached, spaced a second apart. So while the planner stays a personal tool
  that isn't being advertised, the message may never be needed at all. It is the owner's to send, not
  something the planner or the chat does;
- show contact details on the site, such as a link to your GitHub profile;
- keep the credits visible: OpenFreeMap and OpenMapTiles, © OpenStreetMap contributors, Photon, Overpass, OSRM with a "fix the map" link, and Transitous with a link to its data sources;
- publish the code with the AGPL-3.0 licence file.

The Transitous journey endpoint is versioned (v6 at the time of writing), so the planner should expect newer versions.

## Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Host on GitHub Pages? | Yes. |
| 2 | Move from Ideas for today straight to another day? | Yes. |
| 3 | What happens when you remove a must-do from a version? | Nothing. The label stays visible, so you notice. |
| 4 | Priority for new places? | None. |
| 5 | Map style? | Liberty only. Positron shows no places to tap (service test). |
| 6 | The current Claude-hosted planner? | Keep it for now. |
| 7 | Cost hints on today's ideas? | No. The real cost depends on what the place is and where it fits in the plan. |
| 8 | Check plan legs against real routes automatically? | Yes for legs in a plan, cached, at most one request per second; on request for anything else. |
| 9 | Let the estimates calibrate themselves from checked legs? | Yes, per city. |
| 10 | Licence for the planner's public code? | AGPL-3.0. |
| 11 | Draw real walking paths on the map? | Yes. |
| 12 | How to check places before adding them? | A preview with OpenStreetMap details and an hours editor; Google Maps opens beside the planner. |
| 13 | Public transport without timetables? | A stop-based estimate. It uses all stops within 10 minutes' walk of each end, widening to 20 minutes where an end has none, with no public transport estimate if there are still none. The line is named where OpenStreetMap has it, and it's suggested only when it clearly beats walking. Since the third service test, this is understood to cover the gaps in a region's coverage — Kyoto's buses — rather than whole regions. |
| 14 | When does Transitous need telling about the planner? | Once other people use it. Development traffic is too small to require it, and while the planner isn't being advertised it may not be needed at all. The owner sends the message, not the planner and not the chat. |
| 15 | What if the hosted router stops being an option? | Fall back on the dataset. Transitous publishes the timetable data it collects, and says outright that there is no need to scrape the API for it. See "If the hosted router is ever not an option". |
| 16 | How is accommodation entered? | Once per booking, as a stay: a place, a first night and a number of nights. The days it covers take their start and end from it and are created with it. Not on each day. |
| 17 | How does a leg hold what the services say? | Every way of making it side by side — walking, public transport, taxi — each with its own time, source and shape. Checking one never loses another. The planner picks which the day uses: your own time, then whichever you picked, then the quickest that makes sense. A taxi is never assumed. |
| 18 | How does the planner know what instant to ask a timetable about? | The trip says which time zone its times are in (`tz`, a name like `Asia/Tokyo`), and the browser's own time zone database does the rest, summer time included. Left empty, it uses the device's own zone. Every time shown stays local to where you are going. |
| 19 | Whose times calibrate the estimates? | Only times that measured something: OSRM, Transitous, and your own. A stop-based time is the planner's own arithmetic, so calibrating against it would be circular. |
| 20 | What happens when Overpass refuses? | Overpass is only asked about a place now, never about stops. It is asked again, up to six times, and given 90 s to answer rather than the 20 s the fast services get. A 502 means its workers are busy, which by a big station is most of the time, so the wait starts at 2 s and doubles to a 15 s ceiling. A 429 means the planner itself is asking too much, so that waits the full 15 s straight away: the point is to stop crowding, not to insist. Giving up on the first refusal reported "no stops" where the map had a hundred. |
| 21 | And when it never gets through? | A preview says so and everything else on it still holds. A leg no longer has this problem: a snapshot either has the stops or does not, and the only way it fails is the browser being offline, which the leg says plainly rather than reporting "no buses". |
| 22 | Where do the stops come from? | A snapshot we build from OpenStreetMap and publish ourselves, not a live query. Overpass refused five requests in six, took 33 to 40 seconds when it answered, and its documented budget for something used regularly is about a hundred queries a day counted across everybody — a tenth of what one day's legs spent. The snapshot is also better data: route relation membership says which lines really call at a stop, where a live query could only say a relation was somewhere nearby. |
| 23 | How is the snapshot laid out? | One file per whole degree of latitude and longitude, named `<lat>_<lng>.json`, so the planner finds the file it wants by arithmetic on the coordinates rather than shipping boundaries and testing which region a point is in. A `manifest.json` lists the tiles that exist, so the planner never asks for one that is not there. Each tile is columnar — positions delta-encoded as fixed point, names newline-joined, line labels written once and referenced by index — because GitHub Pages gzips in transit, so the repository pays the uncompressed size. Measured live: Tokyo is 48,248 stops, 1.8 MB on disk, 469 KB on the wire in 0.3 s; Kyoto 177 KB. |
| 24 | How is it refreshed? | `tools/refresh-stops.py`, run by hand, roughly yearly. It lives in its own repository, `plan-my-trip-data-stops`, whose history is reset on each refresh so successive snapshots do not pile up a few hundred megabytes at a time in git. The planner shows the date it was built, because a line that opens afterwards is invisible until the next run. |
| 25 | Which two stops does it pair? | The quickest pairing whose two stops share a line, in preference to a quicker pairing that shares none — route relation membership is the thing the old live query could not give, and it is the difference between a journey somebody could make and two stops that merely happen to be near. Where nothing is shared anywhere, the quickest pairing still stands, with no line named. Nothing silly gets through either way, because a ride is only used at all where it beats walking. For the demo trip this turned "probably the EX100 bus", an airport coach picked arbitrarily out of nine candidates, into bus 206 from Kyoto Station to Gojozaka, which is the real route to Kiyomizu-dera. |

## Open questions

None at the moment.
