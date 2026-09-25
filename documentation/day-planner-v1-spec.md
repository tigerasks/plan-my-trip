# Day planner — spec for the chat (and a future skill)

**Planner:** https://claude.ai/artifact/5J4oB2ZSkT3KGksNB73mVF — artifact "Day planner", schema `day-planner/1`.
One planner holds every trip. Its data is private to the owner's Claude organisation (it can't be shared publicly), so the itinerary stays the thing to share.

## What it does

Once a day's anchors and rough shape are agreed, the chat sends that day's candidate places to the planner. The planner:

- lays them out on a to-scale map (no street tiles — published pages can't load them);
- estimates travel times, public transport by default;
- proposes an order in three paces — **Do less / Balanced / Packed** — that always includes the must-dos and respects fixed times, opening hours and meal windows;
- explains every left-out place ("Fits if you drop X", "Doesn't fit: clashes with Y (14:00)").

The user adjusts priorities, durations, order, travel mode and leg times, then hands the day back. The chat reads the result and adds it to the itinerary as a collapsible day plan.

## Workflow

1. **Gather** the day's candidates from the conversation and research files:
   - must-dos (non-negotiable, time-fixed or not), wants and maybes;
   - meal options;
   - anything already booked, with its exact time.
2. **Verify before sending.** Check date-specific opening hours, last entry, closures, timed-entry slots and seasonal windows. Anything unverified goes in with a `check` note, never as fact.
3. **Coordinates** come from a checkable source: official site, Wikipedia/Wikidata, OpenStreetMap, or the user. Never take them from Google Places results — those may only be shown in the map card. Mark rough positions `"loc": "approx"`.
4. **Write** the trip (first time only), the day and the focus pointer in **one** `write_db` batch (see "Writing" below). Then tell the user: "Sat 21 Nov is in the planner — [open it](link). Hand it back when you're happy."
5. **Verify legs that matter** and send them as `legs`:
   - long or intercity hops;
   - infrequent services (last buses, ferries, mountain railways);
   - anything feeding a fixed-time slot.

   Estimates are fine for short city hops.
6. **Iterate.** The user works in the planner.
   - The chat can read the plan doc at any time to see the user's choices (`state`) and the current plan (`current`).
   - To add or change candidates, edit the **day doc**: read → modify → `set` with `if_version`. Never regenerate it.
   - Never overwrite the plan doc (see "Writing" for the one exception).
7. **Hand-back.** When the user says "Sat 21 Nov is ready", read `trips/{tripId}/plans/{dayId}` and use `handback.result` plus `handback.note`. If the root `stateHash` differs from `handback.stateHash`, the user changed things after handing back. Ask which version counts (`current` holds the latest).
8. **Review before integrating.** Flag weak spots:
   - estimated (≈) legs into fixed times;
   - `checks` and `issues`;
   - tight connections and long waits.

   Verify what matters.
9. **Integrate.**
   - Add the day plan inside that day's card in the itinerary (component below).
   - Sync the markdown companion.
   - Put newly bookable items in the booking tracker with their windows; unverified items go to Watch.
   - Optionally offer the real-map check (below).

## Storage layout

| Path | Written by | Contents |
|---|---|---|
| `trips/{tripId}` | chat | trip meta |
| `trips/{tripId}/days/{dayId}` | chat | the day's input: candidates, times, legs |
| `trips/{tripId}/plans/{dayId}` | planner | the user's choices, current plan, hand-back |
| `meta/focus` | chat | the day the planner opens next: `{tripId, dayId, at}` |

**Ids:**
- `tripId`: a short slug (`japan-2026`).
- `dayId`: the ISO date (`2026-11-21`).
- Place ids: short slugs, unique within the day and **stable** — the user's choices are keyed by them, so never rename or reuse an id.

**Formats:**
- Timestamps are ISO UTC (`2026-09-24T15:00:00Z`).
- Times are `HH:MM` in destination local time (24 h; `24:30` is allowed past midnight).

## Writing

**First send** (atomic):
```
Artifact action=write_db url=<planner> db_op=batch writes=[
  {op:"set", collection:"trips",                 doc_id:"japan-2026", data:{…trip…}},
  {op:"set", collection:"trips/japan-2026/days", doc_id:"2026-11-21", file_path:"/home/claude/day.json"},
  {op:"set", collection:"meta",                  doc_id:"focus",      data:{tripId:"japan-2026", dayId:"2026-11-21", at:"<now ISO>"}}]
```

**Edits:**
1. `read_db db_op=get collection="trips/japan-2026/days" doc_id="2026-11-21" out_dir=…` to get the JSON as a file.
2. Edit it and bump `updatedAt`.
3. `write_db db_op=set file_path=… if_version=<version read>`.

Re-set `meta/focus` with a new `at` whenever the planner should jump to that day on next open.

**Reading the result:** `read_db db_op=get collection="trips/japan-2026/plans" doc_id="2026-11-21"`. No document means the user hasn't changed or handed back anything yet.

**The only write to a plan doc:** when the user explicitly asks the chat to change one of their in-planner choices, use a targeted merge:
`write_db db_op=update collection="trips/…/plans" doc_id=… if_version=… data={"state":{"priority":{"ginkakuji":"must"}}, "writer":"chat", "updatedAt":"<now>"}`.
- `"writer":"chat"` is required. Without it an open planner treats the change as its own echo and later overwrites it.
- Nested objects merge; arrays (e.g. `state.order`) replace wholesale.

## Trip doc
```json
{ "schema": "day-planner/1", "title": "Japan · Nov 2026", "tzLabel": "JST", "transit": "metro",
  "fx": { "JPY": 0.0054 }, "fxDate": "2026-09-24", "updatedAt": "…" }
```
- `fx` is CHF per unit of each currency, dated. It is used to show "¥600 (≈ CHF 3.25)".
- `transit` is the trip's default network type (see below).

## Day doc
```json
{
  "schema": "day-planner/1", "date": "2026-11-21", "title": "Kyoto — Higashiyama & Fushimi", "tzLabel": "JST",
  "start": { "name": "Hotel · Kyoto Station", "lat": 34.9862, "lng": 135.7594, "time": "08:30" },
  "end":   { "name": "Hotel · Kyoto Station", "time": "21:00" },
  "mode": "transit", "transit": "city", "pace": "balanced",
  "meals": [ { "id": "lunch", "label": "Lunch", "from": "11:30", "to": "13:30", "duration": 60 } ],
  "places": [ … ], "legs": [ … ],
  "landmarks": [ { "name": "Kyoto Station", "lat": 34.9858, "lng": 135.7588 } ],
  "notes": "Short context shown under the plan: sources, caveats.",
  "updatedAt": "2026-09-24T15:00:00Z", "updatedBy": "chat"
}
```

**Start and end**
- `start.time` is when they leave. `end.time` is the latest time back — a hard limit.
- `end` without coordinates means the same place as the start. `"end": null` means an open-ended day with no return leg.

**Getting around**
- `mode`: `transit`, `walk` or `car` (taxi).
- `transit`: `metro` (big-city rail every few minutes), `city` (trams and buses) or `sparse` (infrequent services).
- Optional: `walkSpeed` (`slow`, `normal`, `brisk`), `maxWalk` (minutes, default 20), `fixedBuffer` (minutes early for booked times, default 10).

**Meals**
- Omit `meals` for a default lunch: start between 11:30 and 13:30, 60 min. Use `[]` for no meal breaks.
- A meal is a floating break unless a place tagged with its id is chosen instead.

**Landmarks** are 1–3 orientation points, such as main stations; they are not visited. **`pace`** is only the default pace; the user sees all three.

## Place fields

| Field | Meaning |
|---|---|
| `id`, `name` | stable slug; display name |
| `lat`, `lng` | decimal degrees, 4–5 decimals |
| `loc` | `"approx"` if rough (shows a badge); optionally the source (`official`, `wikipedia`, `osm`, `user`) |
| `area` | neighbourhood label shown on the map — group places sensibly |
| `kind` | `sight` `food` `shop` `nature` `museum` `culture` `view` `experience` `other` |
| `priority` | `must` · `want` · `maybe` (`skip` to hide). Must-dos always go in; wants beat maybes |
| `duration` | minutes on site, realistic, including photos and queues |
| `fixed` | `"HH:MM"` exact start: timed ticket, tour, reservation |
| `window` | `{from, to}` — the visit must *start* in this window (sunset, lanterns, a show) |
| `prefer` | `{from?, to?}` soft preference, e.g. `{to:"09:30"}` = early for crowds |
| `hours` | opening hours **on this date**: `{open, close, last}` or an array for split hours; omit = always open |
| `closed` | `true` if closed that day (stays visible, never scheduled) |
| `meal` | meal id this place can serve; several places may share one and the planner picks the best-placed |
| `group` | alternatives in general: at most one place per group |
| `price` | `{amount, currency, per?}` e.g. `{amount:600, currency:"JPY", per:"pp"}`, or a short string |
| `booked` | `true` once booked (green chip) |
| `check` | what's unverified and when to check, e.g. "Nov hours not posted — check late Oct" |
| `note` | a sentence or two of context |
| `links` | `[{label, url}]`, official and source pages (http/https only) |
| `tags` | short labels, e.g. `"Foliage"` |

## Legs (verified travel times)
```json
{ "from": "start", "to": "fushimi-inari", "mode": "transit", "minutes": 12,
  "note": "JR Nara Line, 2 stops + 5 min walk", "source": "https://…", "checked": "2026-09-24" }
```
- `from`/`to` are place ids, `"start"` or `"end"`. A leg applies in both directions.
- `minutes` is door to door, including walking to the stop and typical waiting.
- Verified legs show ✓. The user can also enter their own; those win over the chat's.

## Plan doc (planner-owned — read only, except the targeted `update` above)
```json
{ "schema": "day-planner/1", "tripId": "…", "dayId": "…",
  "state": { "pace": "less|balanced|packed", "mode": "transit|walk|car",
             "priority": {"id": "must|want|maybe|skip"}, "duration": {"id": 90},
             "order": ["id", "meal:lunch", "…"], "legs": {"a>b|transit": {"minutes": 14}}, "legPick": {"a>b": "walk"},
             "meals": {"lunch": false}, "startTime": "09:00", "endBy": "20:00",
             "transit": "…", "walkSpeed": "…", "maxWalk": 20, "fixedBuffer": 10 },
  "stateHash": "…", "current": { …result… },
  "handback": { "at": "…", "note": "…", "stateHash": "…", "result": { …result… } },
  "updatedAt": "…", "writer": "…", "rev": 7 }
```
Only the keys the user has changed appear in `state`. `order` is present only when they arranged stops by hand.

**Result**
```json
{ "dayLabel": "Sat 21 Nov", "title": "…", "tz": "JST", "mode": "transit", "pace": "balanced",
  "order": "suggested|manual", "startTime": "08:30", "endBy": "21:00", "basedOn": "<day updatedAt>",
  "summary": { "stops": 7, "start": "08:30", "finish": "18:19", "travelMin": 101, "visitMin": 385,
               "waitMin": 43, "spareMin": 161, "estimatedLegs": 7, "checkedLegs": 1 },
  "timeline": [
    { "type": "start", "name": "…", "time": "08:30" },
    { "type": "travel", "from": "start", "to": "fushimi-inari", "mode": "transit", "minutes": 12, "estimate": false, "by": "chat", "km": 2.2 },
    { "type": "visit", "id": "…", "name": "…", "area": "…", "arrive": "08:42", "start": "08:42", "end": "10:42", "wait": 0,
      "duration": 120, "priority": "must", "fixed": null, "booked": false, "check": null, "approxLocation": false,
      "meal": null, "price": "¥600 (≈ CHF 3.25)", "note": "…" },
    { "type": "meal", "id": "lunch", "label": "Lunch", "start": "12:23", "end": "13:23", "near": "kiyomizu", "nearName": "…" },
    { "type": "end", "name": "…", "time": "18:19" } ],
  "leftOut": [ { "id": "…", "name": "…", "priority": "want", "reason": "not-picked", "text": "Fits if you drop …",
                 "addMin": 12, "finishIfAdded": "18:31", "drops": ["…"] } ],
  "issues": [ { "severity": "error|warn", "id": "…", "text": "…" } ],
  "checks": [ { "id": "…", "name": "…", "text": "…" } ],
  "text": "plain-text version of the plan" }
```
- `reason` is one of: `not-picked`, `not-added` (manual order), `conflict`, `alternative`, `skipped`, `closed`, `hours`, `no-location`.
- If `basedOn` differs from the day doc's current `updatedAt`, the plan predates the latest candidates.

## How the planner decides

**Travel times**
- Estimated from straight-line distance:
  - walking: pace × 1.3 detour;
  - public transport: a typical wait plus a ride speed that rises with distance;
  - taxi: works the same way.
- It walks when walking takes at most `maxWalk` minutes and isn't much slower than riding. For example, on a city network, 3 km comes out at about 21 min by transport.
- Estimates are good for comparing options within a city. They are not good enough for anything feeding a fixed time or crossing a region, so verify those legs.

**Schedule**
- Fixed times start exactly, arriving `fixedBuffer` early.
- Last entry and closing times are respected, and windows and meal windows hold. Waits are shown.

**Pace** is the share of the day (start → back-by) that may be busy with visits, meals and travel:
- Do less: 55 %;
- Balanced: 75 %;
- Packed: 100 %.

Must-dos go in even over budget; conflicts appear as issues.

**Left-out places** are re-planned with the place forced in, and the planner reports exactly what that would change.

## Adding a day plan to the itinerary

Put the day plan inside the day's card, after its existing content, in trip-planning-html house style. Build it from `handback.result`:
- the visit and meal rows;
- travel lines — say "≈" only for estimated legs;
- chips: Must-do (rose), Booked (green), Check (blue);
- a foot line with left-out highlights that are worth knowing.

If the itinerary already defines chip classes, reuse them instead of `dp-chip`.

```html
<details class="day-plan">
  <summary><span class="dp-h">Day plan</span><span class="dp-m">7 stops · 08:30–18:19 · ≈1h 40 travel</span></summary>
  <ol class="dp-list">
    <li><span class="dp-t">08:30</span><span>Leave the hotel</span></li>
    <li class="dp-leg">Train 12 min ✓</li>
    <li><span class="dp-t">08:42–10:42</span><span><b>Fushimi Inari Taisha</b> — go early<span class="dp-chip dp-rose">Must-do</span></span></li>
    <li class="dp-leg">Walk ≈ 4 min</li>
    <li><span class="dp-t">14:00–15:00</span><span><b>Tea ceremony</b> · fixed 14:00<span class="dp-chip dp-green">Booked</span></span></li>
    <li><span class="dp-t">18:19</span><span>Back at the hotel</span></li>
  </ol>
  <p class="dp-foot">≈ estimated · ✓ checked · Not included: Tōfuku-ji (fits if you drop Sanjūsangen-dō)</p>
</details>
```
```css
.day-plan { margin-top: 10px; border-top: 1px solid #f2f1ef; padding-top: 8px; }
.day-plan > summary { list-style: none; cursor: pointer; display: flex; gap: 8px; align-items: baseline; font-size: 12.5px; }
.day-plan > summary::-webkit-details-marker { display: none; }
.day-plan > summary::before { content: "▸"; color: #a8a29e; font-size: 11px; transition: transform .15s; }
.day-plan[open] > summary::before { transform: rotate(90deg); }
.dp-h { font-weight: 700; color: #1c1917; }
.dp-m { color: #78716c; }
.dp-list { list-style: none; margin: 8px 0 0; padding: 0; }
.dp-list li { display: grid; grid-template-columns: 92px 1fr; gap: 10px; padding: 3px 0; font-size: 13px; }
.dp-list li.dp-leg { display: block; padding: 0 0 0 102px; font-size: 11.5px; color: #a8a29e; }
.dp-t { color: #57534e; font-variant-numeric: tabular-nums; }
.dp-chip { display: inline-block; font-size: 10.5px; font-weight: 700; padding: 1px 7px; border-radius: 999px; margin-left: 6px; }
.dp-rose { background: #ffe4e6; color: #9f1239; } .dp-green { background: #dcfce7; color: #166534; } .dp-blue { background: #dbeafe; color: #1e40af; }
.dp-foot { font-size: 11.5px; color: #a8a29e; margin: 6px 0 0; }
```
For printing, open all day plans:
```html
<script>addEventListener('beforeprint', () => document.querySelectorAll('details.day-plan').forEach(d => d.open = true));</script>
```

**Markdown companion format**
```markdown
**Day plan** — 7 stops · 08:30–18:19 · ≈1h 40 travel
- 08:30 Leave the hotel — train 12 min ✓
- 08:42–10:42 **Fushimi Inari Taisha** (must-do) — go early — walk ≈ 4 min
- 14:00–15:00 **Tea ceremony** (booked, fixed 14:00)
- 18:19 Back at the hotel
_Not included: Tōfuku-ji (fits if you drop Sanjūsangen-dō)._
```

**Real-map check (optional).** After integrating, offer to show the day's route on a real map:
- run `places_search` for the stops (name + city), then `places_map_display_v0` in itinerary mode with the right `travel_mode`;
- Google results appear only in that card, never copied into the planner or the trip files.

## Housekeeping

**Before writing a day, check:**
- unique, stable ids;
- every place has coordinates in the same city (not swapped lat/lng);
- `HH:MM` local times;
- hours for that date;
- bookings as `fixed`;
- meal options tagged;
- start and end with times;
- the right `transit` type;
- 1–3 landmarks;
- sources in `notes` or `links`.

**Demo data.** The `demo` trip is sample data. Delete it once real days exist: `trips/demo/days/2026-10-17`, `trips/demo/plans/2026-10-17` (if present) and `trips/demo`.

**Limits:** 256 KiB per document (a 50-place day is about 20 KiB) and 5,000 documents per planner.

**Stale choices.** Removing a place orphans the user's choices for it; that's harmless, but say so if they had changed it.

## Packaging as a skill later

- `SKILL.md`: when to use, plus the workflow above.
- `references/data-contract.md`: storage layout, fields, result format.
- `references/itinerary-component.md`: the day-plan component and markdown format.
- `assets/day-planner.html`: the planner page. Get it with `Artifact action=read` on the planner link. To give another account its own planner, publish it with `capabilities {"db":{}}`, then seed with `write_db`.
