# The package format, field by field

Everything here is `day-planner/2`. The planner's own design document is the source of truth; this
is what a package needs from it.

- [The envelope](#the-envelope)
- [A place](#a-place)
- [Opening hours](#opening-hours)
- [Days and running orders](#days-and-running-orders)
- [What never goes in a package](#what-never-goes-in-a-package)
- [The invariants the planner repairs](#the-invariants-the-planner-repairs)
- [A complete package](#a-complete-package)

## The envelope

One JSON object between two lines that never vary:

```
--- BEGIN day-planner/2 ---
{"schema":"day-planner/2","kind":"package","tripId":"japan-2026","title":"Research, 1 Nov","at":"2026-11-01T09:00:00Z","app":"chat","trip":{…}}
--- END day-planner/2 ---
```

| Key | Value |
|---|---|
| `schema` | always `day-planner/2` |
| `kind` | `package` from you; `save` or `handback` come back |
| `tripId` | **the same id as their trip.** A different one is a different trip, and the planner offers to replace rather than merge |
| `title` | a name for this block while it merges — *not* the trip's title |
| `at` | ISO UTC timestamp |
| `app` | `chat` |
| `trip` | `{ "id": tripId, "places": [...], "days": {...} }` |

The planner joins the lines between the markers before parsing, so a re-wrapped block still reads,
and it ignores prose, code fences and Windows line endings around it. What it cannot survive is a
block that was edited by hand.

`places` may be a list or an object keyed by id; `days` likewise. A day **must carry its own `id`
and `date`** — the planner reads the date from inside the day, not from the key it sits under, and a
day without one is dropped along with its running order. `make_package.py` fills both in for you.

## A place

```json
{
  "id": "fushimi-inari",
  "name": "Fushimi Inari Taisha",
  "localName": "伏見稲荷大社",
  "lat": 34.9671, "lng": 135.7727,
  "kind": "culture",
  "area": "Southern Kyoto",
  "duration": 120,
  "fixed": null,
  "window": null,
  "hours": { "source": "chat", "verified": true, "raw": "24/7, buildings 08:30-16:30",
             "week": { "mon": [["00:00", "23:59"]] }, "lastEntry": null },
  "closed": [],
  "booked": false,
  "priority": "must",
  "price": { "amount": 0, "currency": "JPY", "per": "pp" },
  "check": "The upper trail takes longer than people expect",
  "note": "Go early or late; the lower gates are packed by 10:00",
  "links": [{ "label": "Official", "url": "https://inari.jp/" }],
  "osm": { "type": "way", "id": 123456 },
  "dayId": "2026-11-21"
}
```

That is a **new** place, where everything you found out is worth sending. For a place they already
have, send the `id` and only what you learned.

| Field | Values |
|---|---|
| `id` | lower case letters, digits and hyphens. Stable for the life of the trip — never rename one |
| `name` | up to 120 characters. In English where there is one |
| `localName` | the local-script name, kept beside it |
| `lat` / `lng` | decimal degrees. Send both or neither |
| `kind` | `sight`, `food`, `shop`, `nature`, `museum`, `culture`, `view`, `experience`, `other` |
| `area` | a neighbourhood, for grouping |
| `duration` | minutes, 0 to 720, in steps of 15. The planner's default is 60, which is wrong for most things |
| `fixed` | `"HH:MM"` for a booked or timed slot, else `null` |
| `window` | `{"from": "HH:MM", "to": "HH:MM"}` where it only works in part of the day |
| `closed` | specific `YYYY-MM-DD` dates it is shut, whatever the week says |
| `booked` | `true` only if they have actually booked it |
| `priority` | `must`, `want`, `maybe` or `null`. Shown only when it came from a package |
| `price` | `{"amount": 1500, "currency": "JPY", "per": "pp"}`, or `{"text": "about ¥1,000"}`. **Never converted** |
| `check` | one thing worth confirming. It becomes an item on their checks list |
| `note` | what you would tell them in person |
| `links` | up to 6, each `{"label", "url"}` with an http(s) url |
| `osm` | `{"type": "node"\|"way"\|"relation", "id": 123}` |
| `dayId` | the day's ISO date, or `null` for the backlog |
| `added` | set for you — `{"by": "chat", "how": "package", "at": …}` |

Times are `HH:MM` in destination local time, dates `YYYY-MM-DD`, timestamps ISO UTC.

## Opening hours

```json
"hours": {
  "source": "chat",
  "verified": true,
  "raw": "Th-Mo 11:00-21:00, We to 14:30, closed Tu",
  "week": { "mon": [["11:00","21:00"]], "tue": [], "wed": [["11:00","14:30"]] },
  "lastEntry": { "sat": "20:30" }
}
```

- `source` is `osm`, `you` or `chat` — `chat` for anything you looked up.
- `verified` is `true` **only** if you checked it for the trip's own dates. It is what stops the
  planner putting the place on their checks list, so claiming it falsely is worse than leaving it.
- `week` has keys `mon`–`sun`. A list of `["open","close"]` pairs; `[]` means **closed that day**; a
  day you leave out is a day **nobody knows about**. Several pairs give a lunch break.
- `lastEntry` is per day and often earlier than closing — the planner uses it to decide you cannot
  get in.
- `raw` is the text you read it from. It is what the owner checks your work against.

## Days and running orders

```json
"days": {
  "2026-11-21": {
    "id": "2026-11-21", "date": "2026-11-21",
    "plans": {
      "less":     ["fushimi-inari"],
      "balanced": ["fushimi-inari", "nishiki-market"],
      "packed":   ["fushimi-inari", "tofuku-ji", "nishiki-market"]
    }
  }
}
```

`plans` hold **order only**. A place may appear twice — a station you pass back through — and each
appearance is its own stop. `city` is the only other day field a package may send.

A version you leave out stays as it is, so send all three when you mean to plan the whole day.

## What never goes in a package

| Never send | Because |
|---|---|
| `legs` | travel times are the planner's own measurements, from OSRM, Transitous and its stop snapshot. A package cannot improve them |
| a day's `start`, `end`, `shown`, `centre`, `note` | where they sleep, when they leave and what is on their screen are theirs |
| `title`, `tz`, `tzLabel`, `transit`, `currency`, `fx`, `lookups` | the trip's own settings are theirs. Restating the title stops the merge to ask about it |
| `stays` | the same |
| a renamed `id` | the merge finds a place by its id. A new id is a new place, and the old one stays |

## The invariants the planner repairs

- a place's `dayId` says where it lives — a day, or `null` for the backlog;
- a running order may only name places of its own day. **Naming a place in an order is itself saying
  which day it is on**, so you need not restate `dayId` — but never send `dayId: null` for a place
  an order also names, because the backlog wins and the order loses it;
- the backlog is exactly the places with no day;
- every place an order names must be in `places`. `{"id": "nishiki-market"}` is enough.

Anything it cannot keep, it reports to the owner — but a report is not a plan, so do not rely on it.

## A complete package

```
--- BEGIN day-planner/2 ---
{"schema":"day-planner/2","kind":"package","tripId":"japan-2026","title":"Research, 1 Nov","at":"2026-11-01T09:00:00Z","app":"chat","trip":{"id":"japan-2026","places":[{"id":"fushimi-inari","duration":120,"hours":{"source":"chat","verified":true,"raw":"Open all hours","week":{"mon":[["00:00","23:59"]],"sat":[["00:00","23:59"]]}}},{"id":"nishiki-market","name":"Nishiki Market","lat":35.005,"lng":135.7649,"kind":"food","duration":60,"closed":["2026-11-21"],"check":"Invented closure: shut that Saturday","added":{"by":"chat","how":"package","at":"2026-11-01T09:00:00Z"}},{"id":"tofuku-ji"}],"days":{"2026-11-21":{"id":"2026-11-21","date":"2026-11-21","plans":{"less":["fushimi-inari"],"balanced":["fushimi-inari","tofuku-ji"],"packed":["fushimi-inari","tofuku-ji","nishiki-market"]}}}}}
--- END day-planner/2 ---
```

Read that back as three statements: lengthen one visit and verify its hours; add a new market with a
closure worth knowing; and propose three orders, one of which names a place the package says nothing
else about. Everything else in that trip is left exactly as the owner has it.
