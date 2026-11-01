---
name: plan-my-trip
description: >-
  Plan trip days for the plan-my-trip planner (tigerasks.github.io/plan-my-trip) and exchange
  day-planner/2 blocks with it. Use this whenever a trip file, saved trip, package or hand-back from
  that planner is uploaded or pasted, whenever a block between "--- BEGIN day-planner/2 ---" and
  "--- END day-planner/2 ---" appears, and whenever the user wants days planned, researched,
  reordered or costed for a trip they keep in that planner — including when they just say "plan
  these days", "what should I do on the Saturday", "here's my trip file", "check the opening hours"
  or "send me a package". Also use it to read a hand-back and work out what to fix next. It does the
  planning; the app is where the owner adjusts it.
license: AGPL-3.0-or-later
---

# Planning days for plan-my-trip

The owner keeps their trip in a planner that runs entirely in their browser. It has the routing and
the map; you have the research and the time to think. So the division of labour is: **you plan the
days, they adjust in the app.**

You exchange two things with it, both plain text:

| | You send | It sends back |
|---|---|---|
| `kind` | `package` | `handback` (or `save`, the whole trip as they saved it) |
| Carries | places, hours, durations, fixed times, proposed orders | the trip, what they settled, what they changed, every travel time it measured |

The owner copies one into the other. Nothing is connected, so a block that cannot be pasted in one
go is a block that fails.

## The loop

### 1. Read what they gave you

```bash
python3 scripts/read_trip.py <their file or pasted block>
```

It prints the trip's days, stays, places and plans, and — for a hand-back — the note, the issues,
the checks and every measured travel time, ending in a worklist. Start there rather than reading the
JSON by eye: the worklist is the shortest path to what actually needs doing.

### 2. Research the gaps

The worklist names them: places with no opening hours, hours nobody has verified for these dates,
`check` notes left over, days with nothing planned. Find out what the owner cannot easily find
themselves — hours **for the actual dates**, closures, whether a ticket must be bought ahead, how
long a visit really takes, whether it is worth the detour.

Put what you learn on the place, not only in your prose. Prose is for them; the package is for the
planner.

### 3. Plan the days

This is the part they are handing you, so do it properly rather than listing options.

- **Group by geography.** A day that crosses the city twice costs an hour nobody enjoys. The planner
  will measure the legs, but it cannot undo an order that was never coherent.
- **Fill all three versions.** `less` is a calm day, `balanced` is the day you would actually
  recommend, `packed` is for when they wake up with energy. Roughly two, three to four, and five
  stops — a version with eight stops is a version nobody uses.
- **Set `duration` honestly**, in 15-minute steps. The default is 60, which is wrong for most things.
- **Pin what is pinned.** A booked slot or a timed entry goes in `fixed` as `"HH:MM"`; something that
  only works in part of the day goes in `window`. The planner builds the day around those, and a
  fixed time with a long gap before it shows up as a wait, which is the signal you got the order
  wrong.
- **Mind the hours you just looked up.** `lastEntry` is often earlier than closing, and a `closed`
  date beats the usual week.
- **Leave the sequence open to improvement.** The app has "Optimise order", which re-sequences a day
  using the real measured legs. Decide *what* they do and *what is fixed*; let the app settle the
  exact order.

You cannot measure travel. Do not pretend to: never send `legs`, and never state a journey time as
fact in your prose. After the first round the hand-back gives you real measured times, and that is
when a day gets tightened.

### 4. Write the plan, then let the script build the block

Write a `plan.json` — the places and days you want to send, and nothing else:

```json
{
  "tripId": "example-kyoto",
  "places": [
    { "id": "example-temple", "duration": 120,
      "hours": { "source": "chat", "verified": true, "raw": "06:00-18:00",
                 "week": { "mon": [["06:00","18:00"]], "tue": [["06:00","18:00"]] } } },
    { "id": "nishiki-market", "name": "Nishiki Market", "lat": 35.0050, "lng": 135.7649,
      "kind": "food", "duration": 60, "dayId": "2026-11-21" },
    { "id": "example-garden" }
  ],
  "days": {
    "2026-11-21": { "plans": { "less": ["example-temple"],
                               "balanced": ["example-temple", "nishiki-market"],
                               "packed": ["example-temple", "nishiki-market", "example-garden"] } }
  }
}
```

```bash
python3 scripts/make_package.py --trip <their file> --plan plan.json --out package.txt
```

The script writes the block and, because it has their trip too, tells you what the package will
actually do: what lands quietly, what the owner will be asked about, and what it refuses to send.
Read that report. A package that raises six questions is usually a package that restated six things
it never learned.

Never hand-write a block, and never edit one. One stray character and the whole thing fails to
paste.

### 5. Give it to them

Reply with the block, then a short plain summary: what you planned, what needs booking and by when,
what you could not verify. Three or four sentences, not a wall. They are about to paste the block
and look at the timeline; the prose is so they know what to expect.

### 6. Next round

They paste the block, adjust the day, and copy a hand-back back to you. Run `read_trip.py` on it and
work in this order:

1. **`issues` with `severity: "error"`** — the day does not work: arriving after a booked time, a
   place shut that day, getting back late. Fix these first, in the next package.
2. **The note.** It is the only part a person wrote. Answer it.
3. **`checks`** — your worklist: hours the planner has never had confirmed, `check` notes you left.
4. **`changes.edited`** — what they overrode. They know something you do not; do not send it back
   changed.
5. **`travel`** — now you have real times. `osrm` and `transitous` are measured. `stops` is **not** a
   timetable: it is two stops that share a line in OpenStreetMap, with no times behind it, so never
   promise a particular bus from one. `mine` is a time they entered themselves and beats everything.

## The rules that bite

These are the ones that cause real damage, and the script checks every one of them.

- **A field you leave out is silence**, and the owner's value stands. That is what makes a small
  package safe: say what you learned, leave the rest alone.
- **`null` and `""` are not silence.** They are a statement — "there is none" — and they take back a
  value an earlier package of yours put there. Useful on purpose, awful by accident: never send a
  whole place back with its nulls filled in just because you have the shape to hand.
- **Every place an order names must be in `places`.** `{"id": "example-garden"}` on its own is
  enough, and says nothing about the place.
- **Naming a place in an order says which day it is on.** Do not also send `dayId` contradicting it.
- **A package never deletes a place.** If something should be dropped, say so in prose.
- **Ids are forever.** A place's `id` is how the merge finds it again. Never rename one; new places
  get a new slug, like `fushimi-inari`.
- **The trip and the days are theirs.** Do not send `title`, `tz`, `currency` or `lookups`, nor a
  day's `start`, `end`, `shown`, `centre` or `note`. Where they sleep and when they leave is not
  yours to propose.
- **Prices stay in their own currency.** Never convert.

## Going deeper

- `references/package-format.md` — every field, its values and its bounds; the envelope; the
  invariants the planner repairs; a complete worked package.
- `references/handback.md` — everything a hand-back carries and what to do with each part.

## Starting from nothing

If they have no trip yet, a package is also how a trip is created: send one with `days` for the
dates and places in the backlog, and the planner will open it as a new trip. Ask them for the dates,
the city and where they are staying first — the day's start and end are theirs to set, and without
them the planner cannot time anything.
