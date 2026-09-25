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
- **Public transport:** Transitous answered (API v6, 70 ms) but found no journey, although a bus stop sits right next to the destination. That points to missing Kyoto timetables rather than a stop-finding problem, since the router walks to nearby stops by itself.

**Second run, same day:**
- **Place details:** the map's ids decode to OpenStreetMap ids. Sukiya's became way 1135461266 and was found directly in 175 ms, so details lookups are exact and every place gets a source link.
- **What OpenStreetMap knows:** little for small places. Sukiya had cuisine and takeaway but no hours. Well-known sights tend to carry more, so Google Maps stays the main check for restaurants.
- **Google Maps** opened in a separate window, as intended.
- **Walking** now follows real streets on the map.
- **Public transport:** Transitous again found nothing, this time from Daisen-in, although the Imamiya-jinja-mae bus stop is a few minutes' walk away. The router walks to nearby stops by itself when it has their timetables, so this is further evidence that it has no Kyoto bus timetables.

**Still to verify during the build:**
- whether OpenStreetMap's bus and rail lines are mapped well enough in a trip's region to name the line between two stops;
- whether Transitous knows any stops in a trip's region, to tell "no timetables here" from "no connection";
- the local-file fallback, optional now that GitHub Pages works;
- the exact credit lines.

OpenStreetMap's own tile servers are out regardless: they reject pages that don't send a web address ([tile policy](https://operations.osmfoundation.org/policies/tiles/)).

## Travel times

Every leg starts with the planner's own estimate, computed instantly from the two positions. It exists even from a blank start, but it's rough, so it's marked ≈.

Legs that are part of a plan then get checked against real routes: OSRM for walking and taxi, Transitous for public transport. Results are cached in the trip data, so each leg is asked once, and requests are spaced at least a second apart. A checked leg shows the real time and its source; its card also shows the estimate and flags a big gap between the two.

Public transport has two catches. Timetables are usually only published a few months ahead, so for a trip further out the planner asks about the same weekday and time in the current timetable, and says so. And where Transitous finds no journey, the planner first asks whether it knows any stops nearby at all, so it can say which case it is: no timetable data for the region (as in both Kyoto tests), or no connection at that time.

Without timetables, it falls back to a stop-based estimate. This is the manual method automated:
- it considers every station and stop within 10 minutes' walk of each end, from the map data, not just the nearest one. Where an end has none, it widens the search to 20 minutes' walk. If there are still none, it gives up on public transport for that leg and says so;
- where OpenStreetMap has the bus and rail lines mapped (fetched through Overpass), it checks which lines serve both a start stop and an end stop, and names the line;
- it takes the real walking times to and from the stops, estimates the ride from distance, and picks the quickest combination;
- it suggests public transport only when that clearly beats walking; otherwise the leg stays a walk.

The result is marked ≈ and spells out the stops, and the line where known. For example: "walk 3 min to Imamiya-jinja-mae · ≈ 14 min by bus · walk 5 min". You can correct it with your own time.

Your own entries still win. Google's routing service itself isn't an option: as I understand its terms, its results can't be shown on a non-Google map (to double-check if it ever matters).

The estimates calibrate themselves from the checked legs in the same city, so the "from here" numbers improve as you go.

Walking legs are drawn along their real path, from the same routing requests. Other legs stay straight lines unless their routing result includes a path.

## The model

A trip has a backlog and days. Every place lives in exactly one spot: the backlog, or one day. Within its day, a place is either among the ideas for today or in one or more of the day's three plan versions. For example, a place can be in Balanced and Packed but not in Do less.

| Thing | Holds |
|---|---|
| Trip | Title, time zone label, default transit type, optional preferred currency, backlog, days |
| Day | Date, city, start and end place with times, lunch window, ideas for today, three plan versions |
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

**Adding:** adding to a plan inserts the place at the best position (fewest problems, least travel); dragging adjusts.

**Deleting:** Delete, shown in red, drops a place entirely, from every version and from its day or the backlog, with undo.

## The three versions

Each day opens on Balanced. The versions are yours: they hold what you put in them, or what a chat package proposed, and the planner never adds or removes places on its own.

- **Copying.** "Copy to Do less" or "Copy to Packed" takes the version on screen as the starting point there.
- **Timeline.** For the version on screen, the planner works out times, waits and conflicts: opening hours, fixed times, and when you need to be back.
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

**Lunch options:** food places can be marked as one.

*Not now:* an embedded Google map, a "What's here" list of everything in view, Wikipedia summaries, and a hand-off to the chat for researching shortlisted places.

## Map

- **Plans** show as numbered stops joined in order.
- **Today's ideas** show as hollow markers.
- **The backlog** shows as faint dots you can switch off. The point is to spot backlog ideas near today's route.
- **Tapping** anything opens its card.
- **Selecting** a place shows estimated travel minutes from there to everything else, backlog included.
- *Proposal:* tone Liberty's colours down towards the house style, keeping its places.

## Days and trip settings

A day gets:
- a date and a city;
- a start and end place (found by search, usually the hotel);
- times and a lunch window.

Deleting a day sends its ideas back to the backlog.

Trip settings hold the title, time zone label and default transit type. Optionally they also hold a preferred currency: prices always show in their original currency, with a conversion only when one is set.

## Between chat and planner

**Format.** Both directions use the same text format:
- a fixed first and last line around JSON;
- inside: a schema version (`day-planner/2`), a kind (package, hand-back or save), the trip id and a timestamp.

Blocks are always generated by script, never typed. The planner explains plainly when a block is cut off, is from another trip, or is from an old version. The same content can also travel as a `.json` file.

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
- tell Transitous about the planner in their Matrix channel before it routes routinely, since their policy asks for a heads-up on routing use;
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
| 13 | Public transport without timetables? | A stop-based estimate. It uses all stops within 10 minutes' walk of each end, widening to 20 minutes where an end has none, with no public transport estimate if there are still none. The line is named where OpenStreetMap has it, and it's suggested only when it clearly beats walking. |

## Open questions

None at the moment.
