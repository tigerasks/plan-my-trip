---
name: plan-my-trip
description: >-
  Plan the days of a trip for the plan-my-trip planner (tigerasks.github.io/plan-my-trip) and swap
  day-planner/2 blocks with it. Use this whenever a saved trip, package or hand-back from that
  planner is uploaded or pasted, whenever text appears between "--- BEGIN day-planner/2 ---" and
  "--- END day-planner/2 ---", and whenever someone wants days planned, researched, reordered,
  checked or costed for a trip they keep in that planner. That includes "plan these days", "what
  should I do on the Saturday", "here is my trip file", "check these opening hours", "the hand-back
  says I arrive late" and "send me a package". The planning is yours to do; the app is where the
  owner adjusts it afterwards.
license: AGPL-3.0-or-later
---

# Planning days for plan-my-trip

The owner keeps their trip in a planner that runs entirely in their browser. It owns the map, the
routing and the timeline; you own the research, the judgement and the time to think. They are
handing you the planning, so **plan the days** — do not hand back a list of options for them to
choose from.

Nothing is connected. You exchange two plain-text blocks, copied by hand:

| | You send | They send back |
|---|---|---|
| `kind` | `package` | `handback`, or `save` for the whole trip as it stands |
| Carries | places, opening hours, durations, fixed times, proposed running orders | the trip, the computed day with its times, what they changed, every travel time it measured |

A block that cannot be pasted in one go is a block that failed. Never hand-write one and never edit
one by hand: `scripts/make_package.py` writes it.

You can, however, see what a package would do to their days **before** you hand it over, because
this skill carries the planner's own code. That is `scripts/check_day.js`, and it is what makes
planning iteratively possible without making them paste anything.

## Before you ask them anything

If they already keep an itinerary, a booking tracker or research files for this trip, **read those
first**. They hold the party, the dates, the bases and what is booked, and asking for any of it
again wastes a round.

Where their own instructions say how decisions get made, follow those rather than this file. The
three versions cover how hard a day pushes; when the *anchor* of a day is still open — which temple,
which district, whether to go at all — put two or three to them in prose before you build anything.

## Start from what they gave you

Work in a folder of your own and call the scripts by their full path — a skill folder is often
read-only, and `plan.json` and the package have to land somewhere you can write. Below, `$SKILL`
stands for this skill's folder.

| What arrived | Do this |
|---|---|
| A file, or a block pasted into the chat | `python3 $SKILL/scripts/read_trip.py <file, or - for stdin>` and start from the worklist it prints |
| A hand-back | the same, then work the order under **Reading what comes back** |
| Nothing — just "plan my trip" | They have no trip yet. See **Starting from nothing** |
| A question about one day | Answer it, and still send a package if you changed anything |
| You have drafted a day and want to know whether it works | `node $SKILL/scripts/check_day.js --trip <file> --package package.txt` |

Read the worklist rather than the JSON. It is the shortest path to what actually needs doing, and
the JSON is long.

If you have no way to run Python, you can still do all of this: read the trip yourself and build
the block by hand from `references/package-format.md`, then walk its checklist line by line. The
scripts are a safety net, not a dependency — but use them when you have them, because the format
has traps that careful reading does not catch.

## Plan the day, properly

**Ask first, once.** Before the first package, find out what you cannot guess: who is travelling,
what they have already booked, how hard they like to push, anything they would rather avoid. One
short round of questions beats three rounds of rework. After that, stop asking and plan.

**One anchor per day.** Decide what the day is *for* — the temple, the market morning, the hike —
and build around it. A day that is six equal stops is a day with no shape.

**Group by geography.** Crossing the city twice costs an hour nobody enjoys. The planner measures
the legs, but it cannot rescue an order that was never coherent.

**The three versions are one day at three intensities**, not three different days. `less` is the
calm version, `balanced` is the day you would actually recommend, `packed` is for the morning they
wake up with energy. Roughly two stops, three or four, five. They share the anchor, so dropping to
`less` on the morning is not a replan. A version with eight stops is a version nobody uses.

**Set `duration` honestly**, in 15-minute steps. The default is 60 minutes, which is wrong for most
things: a major temple is two hours, a viewpoint is twenty minutes, a sit-down lunch is ninety.

**Meals are stops.** Put them in, near where they will actually be, with real opening hours. A day
plan that silently assumes they will find lunch is a day plan that runs an hour late.

**Mind the clock you cannot see.** Check what time it gets dark on those dates — a viewpoint at
17:30 in late November is a viewpoint in the dark. Check which weekday things shut: museums very
often close on Mondays, and `lastEntry` is routinely an hour before closing.

**Anchor the day.** Every day starts at the stay of the night before and ends at that night's
stay, so once the bases are in, the middle of a trip looks after itself. Two days do not: the one
they arrive on and the one they fly home on, which need a `start` and an `end` of their own. On a
day a stay does anchor you can still set the time — "out at 07:00 for the early train" — and the
hotel supplies the place.

**Pin what is pinned.** A booked slot or timed entry goes in `fixed` as `"HH:MM"`. Something that
only works in part of the day — a market that is over by noon — goes in `window`. The planner
builds the day around both, and a long wait before a fixed time is the planner telling you the
order is wrong.

**Say what must be booked, and by when.** That is the thing with a deadline, and the one part of
your reply that cannot wait for the next round.

**Leave the exact sequence open.** The app has "Optimise order", which re-sequences a day using the
real measured legs. Decide *what* they do and *what is fixed*; let the app settle the order.

**Travel you may look up, but not invent.** The planner estimates from the straight line, which is
sensible within a city and rough between them, and only the app can ask OSRM or Transitous. So a
leg you have actually checked — a Shinkansen timetable, a published airport transfer — may go in
the package:

```json
"legs": { "start>example-station": { "mode": "transit", "minutes": 150, "source": "chat",
                                   "name": "the express", "link": "https://…" } }
```

It lands only where no service has answered and they have entered nothing themselves: a
measurement is never written over, and a leg with no link is dropped. Never write `"source":
"osrm"` or `"transitous"` — a package claiming to be a service is thrown away. For anything you
have not checked, say nothing: after the first round the hand-back gives you real measured times,
and that is when a day gets tightened.

## Checking opening hours is your highest-value job

The owner cannot easily check thirty places for the dates they are going. You can, and the planner
is built to let you: if you report the times it already has and mark them `verified: true`, the
merge reads that as a confirmation rather than a disagreement, so it lands quietly however many
places you do it for. Correcting times is an ordinary change; confirming them is free.

Say `verified: true` only where you actually checked for the trip's own dates, and **put the source
in `links`** — something like `{"url": "…", "label": "Hours (official)"}`. A verified time nobody
can check is worth less than an unverified one, because it stops the planner asking.

The first running order you propose for a day is free in the same way: a day nobody has planned
counts as unset, so your order simply arrives. It is only a day they have already ordered
themselves that stops to ask — and when that happens, their order usually came out of the app's
"Optimise order", which knew the real travel times. Start from theirs.

## Build the package

Write a `plan.json` holding only what you want to send:

```json
{
  "tripId": "example-kyoto",
  "label": "Hours checked, Saturday planned",
  "places": [
    { "id": "example-temple", "duration": 120,
      "hours": { "source": "chat", "verified": true, "raw": "06:00-18:00",
                 "week": { "mon": [["06:00","18:00"]], "sat": [["06:00","21:00"]] },
                 "lastEntry": { "sat": "20:30" } } },
    { "id": "example-market", "name": "Example Market", "lat": 35.0050, "lng": 135.7650,
      "kind": "food", "duration": 60, "dayId": "2026-11-21" },
    { "id": "example-garden" }
  ],
  "days": {
    "2026-11-21": { "plans": {
      "less": ["example-temple"],
      "balanced": ["example-temple", "example-market"],
      "packed": ["example-temple", "example-market", "example-garden"] } }
  }
}
```

```bash
python3 $SKILL/scripts/make_package.py --trip <their file> --plan plan.json --out package.txt
```

Because the script has their trip as well as your plan, it does not merely write the block — it
says what the block will *do*: what lands quietly, what the owner will be asked about, and what it
refuses to send at all. Read that report before you hand anything over. A package that raises six
questions is usually a package that restated six things it never learned.

## Check the day before you send it

```bash
node $SKILL/scripts/check_day.js --trip <their file> --package package.txt
```

This runs the planner's actual schedule — the same `core.js` the app runs — over the merged trip
and prints each day you touched:

```
Mon 23 Nov — the second day — Balanced
  08:30          leave Example base
                 ↓ 22 min train or bus (estimate)
  08:52 – 10:22  Example Shrine        1h 30
  ...
  2 stops · 4h visiting · 1h 12 travelling · 25 min waiting · 1h 48 spare
  [ERROR] the evening booking: you would arrive 18:45, after the 18:30 you have booked
```

So you can fix the order, the durations and the fixed times yourself, iterating until the day
holds, and only then give it to them. Options: `--day` for one date, `--version` for one of the
three, `--keep-mine` to see it as they would before answering any questions.

**The travel times are the planner's own estimates, not measured routes.** Only the app can ask
OSRM and Transitous, and those answers come back in the hand-back. So an estimate is good enough to
choose an order and to spot a day that cannot work; it is not good enough to promise a train.

If `node` is missing, say so plainly and fall back: propose the day, and let them paste it in and
tell you how it looked.

## Give it to them

**Attach the file.** `make_package.py` writes `package.txt` and `package.json` side by side; hand
over the `.json` for "Import from file" whenever you can. Pasting the block means retyping it, and
a package confirming hours for thirty places is 15 KB of JSON in which one wrong digit merges
without a murmur. Every block carries a checksum, so the planner refuses one that was changed on
the way — but not getting it wrong beats catching it.

Ask for hand-backs as files too, for the same reason: the app has "Save it as a file" beside
"Copy the hand-back".

Attach `package.json`; paste the block only when a file will not do. Underneath, a short plain
summary: what you planned, what needs booking and by when, what you could not verify. Three or four
sentences. They are about to load it and look at the timeline — the prose is so they know what to
expect, not a second copy of it.

## Reading what comes back

Run `read_trip.py` on the hand-back, then work in this order:

1. **`issues` with `severity: "error"`.** The day does not work: arriving after a booked time, a
   place shut that day, getting back late. Fix these first, in the next package.
2. **The note.** It is the only part a person wrote. Answer it.
3. **`checks`.** The planner's own worklist: hours it has never had confirmed, `check` notes you
   left behind.
4. **`changes.edited`.** What they overrode. They know something you do not — do not send it back
   changed, and do not argue with it in prose.
5. **`travel`.** Now you have real times. `osrm` and `transitous` measured them. `stops` did not:
   it is two stops that share a line in OpenStreetMap, with no timetable behind it, so never
   promise a particular bus from one. `mine` is a time they entered themselves and beats everything.

`references/handback.md` has the full shape.

## The rules that bite

The script checks every one of these. They are here because breaking them does real damage.

- **A field you leave out is silence**, and the owner's value stands. That is what makes a small
  package safe: say what you learned and leave the rest alone.
- **`null` and `""` are not silence.** They mean the same thing — "there is none" — and take back a
  value one of your earlier packages put there. Useful deliberately, awful by accident: never send a
  place back with every key filled in just because you have the shape to hand.
- **Every place named in a running order must appear in `places`.** `{"id": "example-garden"}` on
  its own is enough, and says nothing else about the place.
- **Naming a place in an order says which day it is on.** Do not also send a `dayId` contradicting
  it.
- **A package never deletes** — and never un-deletes. If something should be dropped, say so in
  prose. If the hand-back lists a place under `changes.deleted`, leave it out: sending it again
  puts it back in front of them, and where the planner has no baseline it simply returns. The
  builder refuses one unless you add `"restore": true` on purpose.
- **Ids are forever.** A place's `id` is how the merge finds it again. Never rename one; a new place
  gets a new slug, like `fushimi-inari`.
- **The trip is theirs**, once it exists. Never send `title`, `tz`, `transit`, `currency`,
  `lookups`, or a day's `shown`, `centre`, `note` or `city`. The one exception is a package that
  *creates* the trip, where there is nothing of theirs to overwrite — see below. Which version they are looking at and where their map is pointed is
  not yours to propose. Put the suggestion in prose instead.
- **Never send a travel time you have not checked**, and never one marked as a service. A leg is
  `source: "chat"` with the link you read it from, or it is not in the package at all.
- **A version you do not send keeps whatever they have.** Sending only `balanced` changes only
  `balanced`, even if they take everything else in the package.
- **Stays you may send, but never invent one.** Where they sleep drives every day's start and end,
  so carrying what they have already told you is worth doing. A place they have booked gets its
  real name. A base that is not settled gets a name that says so — "Second city — not booked yet" — and
  an approximate position for the district, because a stay with no position costs every day it
  anchors all of its travel times. Ids are permanent, as for places, so the booking refines in
  place later. Never write a hotel name they have not chosen.
- **Prices in the package stay in their own currency.** Never convert one into `price`. Your prose
  is a different matter: there, follow the owner's own conventions for what to show beside it.

## Going deeper

- `references/package-format.md` — every field with its values and bounds, the envelope and its
  checksum, how to send a travel time you looked up, what the planner repairs silently, and a
  complete worked package.
- `references/handback.md` — everything a hand-back carries, and what to do with each part.

The scripts: `read_trip.py` reads anything the planner wrote; `make_package.py` checks a plan and
hands it to `write_package.js`, which writes the block and works the merge out with the planner's
own code; `check_day.js` shows a day. The planner itself is in `vendor/core.js`, which is where
every answer about what will happen comes from.

**Do not try to fetch the live planner to compare against `vendor/core.js`.** The copy is pinned on
purpose, and the planner's own test suite fails if it differs from the published file by a single
byte, so they cannot drift apart unnoticed. Nothing here needs the network. The only thing worth
watching is the other direction: if a file the owner sends was saved by a *newer* planner than this
copy, `make_package.py` and `check_day.js` both say so, and then something they have learned since
may be missing here.

## Starting from nothing

A package is also how a trip is born: one with `days` for the dates, `stays` for the bases and
places in the backlog opens as a new trip. Only then may it set the trip's own settings, and one of
them it **must**:

```json
{ "tripId": "example-trip", "title": "Example trip", "tz": "Asia/Tokyo", "transit": "metro", … }
```

- **`tz` is not optional.** A timetable is asked about an instant, and without a zone the planner
  uses whatever one the owner's browser is in. Planning a trip to Japan from Europe, a 09:00 leg
  gets looked up at 17:00 and an 18:00 leg at 02:00 the next morning, when nothing runs — and the
  answer that comes back looks like any other answer. The builder refuses a creating package
  without it.
- **`transit`** is `metro`, `city` or `sparse`: how much public transport there is where they are
  going. It only shapes the first rough estimates, but it costs nothing to get right. Ask for the dates, the cities and where they are staying
first; send a placeholder stay where a base is not booked, so the days can still be timed.

Two things to get right, because nothing else will:

- **a day with no stops is still a day.** On the one they fly home, give the day an `end` at the
  airport with the time they must be there, and the planner will tell you whether leaving the
  hotel that morning gets them there. Putting the check-in in as a fixed stop works too, and shows
  up on the timeline;
- **the day they arrive and the day they fly home are not anchored by a stay** — one has no night
  before it, the other ends at an airport. Send those days a `start` and an `end` of their own, or
  the first and last legs of the trip cannot be timed at all;
- **a stay does not bring its days with it.** Send the days you want in `days`; `make_package.py`
  warns about the nights you left uncovered.
