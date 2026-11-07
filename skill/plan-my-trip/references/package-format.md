# The package format

Everything here is the contract the planner's own `docs/core.js` enforces. Where this file and the
planner disagree, the planner wins — but it has been checked against it field by field.

## Contents

- [The envelope](#the-envelope)
- [Places](#places)
- [Opening hours](#opening-hours)
- [Days and running orders](#days-and-running-orders)
- [What never goes in a package](#what-never-goes-in-a-package)
- [What the planner repairs without asking](#what-the-planner-repairs-without-asking)
- [A complete package](#a-complete-package)

## The envelope

```
--- BEGIN day-planner/2 ---
{"schema":"day-planner/2","kind":"package","tripId":"example-kyoto","title":"Saturday planned","at":"2026-11-07T10:00:00Z","app":"chat","trip":{ ... }}
--- END day-planner/2 ---
```

| Key | Value |
|---|---|
| `schema` | exactly `day-planner/2` |
| `kind` | `package`. `save` means a whole trip; `handback` can only be read, never pasted in |
| `tripId` | the owner's `trip.id`, unchanged. A different one is read as a different trip |
| `title` | a **label for this block**, shown as "Merged …". Not the trip's name — the trip's name is a setting of theirs and must not be sent inside `trip` |
| `at` | ISO timestamp |
| `app` | `chat` |
| `trip` | `{ "id": ..., "places": [...], "days": {...} }` and nothing else |

The JSON must be on one line between the two marker lines. Both marker lines are part of the block.
The planner will cope with a block that was re-wrapped, but not with one that was edited.

## Places

`trip.places` may be a list or an object keyed by id; a list is simpler. Every key is optional
except `id` — and **leaving one out is silence**, so the owner's value stands untouched.

| Key | Value |
|---|---|
| `id` | lower-case slug, the permanent handle. Never rename one |
| `name` | up to 120 characters |
| `localName` | the name in the local script, up to 120 |
| `lat`, `lng` | numbers. `lon` is accepted for `lng`. Both or neither — one alone is dropped with a complaint |
| `kind` | `sight`, `food`, `shop`, `nature`, `museum`, `culture`, `view`, `experience`, `other` |
| `area` | neighbourhood, up to 60 characters |
| `duration` | minutes, 0 to 720, rounded to the nearest 15. Anything missing becomes 60 |
| `fixed` | `"HH:MM"` — a booked or timed entry the day is built around |
| `window` | `{"from":"HH:MM","to":"HH:MM"}`, or `["HH:MM","HH:MM"]`, or `"HH:MM-HH:MM"` |
| `hours` | see below |
| `closed` | list of `"YYYY-MM-DD"` it is shut whatever the week says, up to 60 |
| `booked` | `true` only if it really is booked |
| `priority` | `must`, `want`, `maybe`, or omitted |
| `price` | `{"amount":1200,"currency":"JPY","per":"person"}`, or `{"text":"free"}`, or a bare number, or a string. **Never convert a currency** |
| `check` | one short thing still to confirm, up to 300 characters. It shows up in their checks list |
| `note` | up to 2000 characters. This is where your reasoning goes |
| `links` | up to 8 of `{"url":"https://…","label":"…"}`. `http`/`https` only; a missing label becomes the hostname |
| `osm` | `{"type":"node","id":123}`, where you are sure. The type is `node`, `way` or `relation` |
| `dayId` | `"YYYY-MM-DD"` of the day it belongs to, or omitted to leave it where it is |

A place with no day, named in no running order, lands in the backlog.

## Opening hours

```json
"hours": {
  "source": "chat",
  "verified": true,
  "raw": "Mo-Fr 06:00-18:00; Sa,Su 06:00-21:00",
  "week": {
    "mon": [["06:00","18:00"]], "tue": [["06:00","18:00"]],
    "wed": [["06:00","18:00"]], "thu": [["06:00","18:00"]],
    "fri": [["06:00","18:00"]], "sat": [["06:00","21:00"]],
    "sun": [["06:00","21:00"]]
  },
  "lastEntry": { "sat": "20:30", "sun": "20:30" }
}
```

| Key | Value |
|---|---|
| `source` | `osm`, `you` or `chat`. Yours is `chat` |
| `verified` | `true` only where you checked for the trip's own dates |
| `raw` | the original line you read it from, up to 200 characters |
| `week` | seven optional keys `mon`–`sun`, each a list of `["open","close"]` pairs. `[]` means **closed that day**; a day you leave out is a day **nobody knows about**, which is not the same thing |
| `lastEntry` | `"HH:MM"` per day, where last entry is before closing. Ignored for a day with no spans |

The merge compares the **times**, not the account of where they came from. So reporting the hours
the owner already has, with `verified: true`, is a confirmation: it lands quietly and asks nothing,
however many places it covers. Reporting the same times as *less* well known changes nothing at all.
Different times are an ordinary change, and become a question only if the owner moved them too.

Split days are a list of two pairs: `"wed": [["11:00","14:00"],["17:00","22:00"]]`.

## Days and running orders

```json
"days": {
  "2026-11-21": {
    "id": "2026-11-21",
    "plans": {
      "less": ["example-temple"],
      "balanced": ["example-temple", "nishiki-market"],
      "packed": ["example-temple", "nishiki-market", "example-garden"]
    }
  }
}
```

**A day must carry its own `id` (or `date`).** The planner reads the values of `days` and ignores
the key it sits under, so a day without one is dropped and its running orders vanish with it. This
is the single easiest way to send a package that silently does nothing; `make_package.py` fills the
`id` in from the key for you.

The three versions are `less`, `balanced` and `packed`, and hold **order only** — no times, no
travel. A place may appear twice in one order if the day really passes through twice.

**Every id in an order must also be in `places`.** `{"id": "example-garden"}` on its own is enough.
An order naming a place that did not come with the package loses that stop, and the planner says so
in its issues rather than failing.

**Naming a place in an order is itself a statement that it is on that day.** That is how you move a
place onto a day without sending `dayId`. An explicit `dayId` wins where the two disagree, so do not
send both unless you mean the `dayId`.

## What never goes in a package

| Not this | Why |
|---|---|
| `legs` | travel times are the planner's own measurements, from OSRM, Transitous and its stop snapshot. Yours would be guesses overwriting facts |
| `title`, `tz`, `tzLabel`, `transit`, `currency`, `lookups`, `fx` | trip settings, theirs to choose |
| `stays` | where they sleep |
| a day's `start`, `end`, `shown`, `centre`, `note` | when they leave the hotel, which version they are looking at, where the map is pointed |
| `added`, `createdAt`, `updatedAt` | the planner's own bookkeeping |
| `backlog` | worked out from which places have no day |
| a deletion | there is no way to express one. Say it in prose |

Suggestions about any of these belong in your prose reply, not in the block.

## What the planner repairs without asking

It never refuses a package. It fixes what it can and lists what it did:

- a place pointing at a day the trip does not have goes to the backlog, and its `dayId` is treated
  as never said;
- a duplicate id becomes `id-2`;
- an order naming a place of another day, or no day, loses that entry;
- a day whose `date` is unreadable falls back to its `id`;
- an unreadable position leaves the place off the map rather than dropping it;
- a duration becomes the nearest 15 minutes within 0–720.

All of it arrives in the owner's issues list. A quiet repair is still a failure of your package.

## A complete package

```json
{
  "schema": "day-planner/2",
  "kind": "package",
  "tripId": "example-kyoto",
  "title": "Saturday planned, hours checked",
  "at": "2026-11-07T10:00:00Z",
  "app": "chat",
  "trip": {
    "id": "example-kyoto",
    "places": [
      {
        "id": "example-temple",
        "duration": 120,
        "hours": {
          "source": "chat", "verified": true, "raw": "06:00-18:00",
          "week": {"mon": [["06:00","18:00"]], "sat": [["06:00","21:00"]]},
          "lastEntry": {"sat": "20:30"}
        },
        "note": "Go for opening: the main hall is empty before 08:00 and queues from 09:30."
      },
      {
        "id": "nishiki-market",
        "name": "Nishiki Market",
        "localName": "錦市場",
        "lat": 35.0050, "lng": 135.7649,
        "kind": "food", "area": "Nakagyo", "duration": 60,
        "window": {"from": "09:30", "to": "17:00"},
        "price": {"text": "free to walk, snacks 200–600 JPY"},
        "check": "Several stalls shut on Wednesdays — confirm nearer the time",
        "links": [{"url": "https://www.kyoto-nishiki.or.jp/", "label": "Official"}]
      },
      { "id": "example-garden" }
    ],
    "days": {
      "2026-11-21": {
        "id": "2026-11-21",
        "plans": {
          "less": ["example-temple"],
          "balanced": ["example-temple", "nishiki-market"],
          "packed": ["example-temple", "nishiki-market", "example-garden"]
        }
      }
    }
  }
}
```

## Before you hand it over

- [ ] `tripId` is theirs, unchanged, and no `trip.title` is inside
- [ ] every `id` already in their trip is spelled exactly as they have it
- [ ] every place named in an order is in `places`
- [ ] every day carries its own `id`
- [ ] no `legs`, no trip settings, no day `start`/`end`/`shown`/`note`, no `stays`
- [ ] no field restated that you did not actually learn something about
- [ ] no `null` or `""` that you did not mean as "there is none"
- [ ] `hours.verified` is `true` only where you really checked, for these dates
- [ ] prices in their own currency
- [ ] `make_package.py` ran, and you have read its report
