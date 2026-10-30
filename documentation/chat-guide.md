# Chat guide — working with the planner

For the trip-planning chat project. It covers the two things the chat does with
[plan-my-trip](https://tigerasks.github.io/plan-my-trip/): **prepare a package** to send to the
planner, and **read a hand-back** that comes out of it.

`day-planner-v2-design.md` is the source of truth for the format; where this guide and that
document disagree, that one wins. The v1 spec (`day-planner-v1-spec.md`) describes a different
format and stays as it is.

## The two directions

| | The chat sends | The planner sends |
|---|---|---|
| `kind` | `package` | `handback` |
| Carries | places, days, proposed orders | the trip, plus what was settled, changed and measured |
| The other end does | merges it in, asking only where both sides moved the same thing | reads it, verifies, folds it into the next package |

There is a third kind, `save`: the whole trip as the owner saves it. The chat receives these as
project files and can read them exactly like a hand-back minus the `handback` section.

## The envelope

One JSON object. As text it sits between two lines that never vary:

```
--- BEGIN day-planner/2 ---
{"schema":"day-planner/2","kind":"package","tripId":"japan-2026","title":"Japan · Nov 2026","at":"2026-10-24T09:00:00Z","app":"chat","trip":{…}}
--- END day-planner/2 ---
```

As a file it is the same object without the two lines, laid out to be read.

- **Always generate it from a script.** Never type one by hand and never edit one by hand.
- The planner joins the lines between the markers before parsing, so a block that gets re-wrapped
  still reads. It also ignores text before and after, code fences, and Windows line endings.
- Keep `tripId` the same as the trip you were given. A different one is a different trip, and the
  planner will say so and offer to swap rather than merge.

## Preparing a package

### The one rule that matters most

**A package never deletes.** A place it does not mention is a place it had nothing to say about.
If the owner should drop something, say so in prose; do not express it by leaving it out.

### What to put in

Everything the owner needs that they cannot easily find themselves: opening hours for the actual
date, closures, whether a ticket must be bought ahead, how long a visit really takes, what is worth
the detour. Put it on the place, not only in the chat around the block.

Keep ids stable. A place's `id` is how the merge finds it again, so once a place has one it keeps
it for the life of the trip. New places get a new slug-like id (`fushimi-inari`, `nishiki-market`).

### The place shape

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
  "hours": {
    "source": "chat",
    "verified": true,
    "raw": "24/7, shrine buildings 08:30-16:30",
    "week": { "mon": [["00:00", "23:59"]], "tue": [["00:00", "23:59"]] },
    "lastEntry": null
  },
  "closed": [],
  "booked": false,
  "priority": "must",
  "price": { "amount": 0, "currency": "JPY", "per": "pp" },
  "check": "The upper trail takes longer than people expect",
  "note": "Go early or late; the lower gates are shoulder to shoulder by 10:00",
  "links": [{ "label": "Official", "url": "https://inari.jp/" }],
  "osm": { "type": "way", "id": 123456 },
  "added": { "by": "chat", "how": "package", "at": "2026-10-24T09:00:00Z" },
  "dayId": "2026-11-21"
}
```

That is a new place, where everything you have found out is worth sending. For a place the owner
already has, send its `id` and only the fields you have learned something about — see below.

| Field | Values |
|---|---|
| `kind` | `sight`, `food`, `shop`, `nature`, `museum`, `culture`, `view`, `experience`, `other` |
| `priority` | `must`, `want`, `maybe`, or `null`. Only shown when it came from a package |
| `duration` | minutes, 0 to 720, in steps of 15. Default 60 |
| `fixed` | `"HH:MM"` for a booked time, else `null` |
| `window` | `{"from":"HH:MM","to":"HH:MM"}` when it only makes sense in part of the day |
| `hours.source` | `osm`, `you` or `chat`. Use `chat` for anything you looked up |
| `hours.verified` | `true` only if you actually checked it for the trip's dates |
| `hours.week` | seven keys `mon`–`sun`, each a list of `["open","close"]` pairs. `[]` means closed that day. A day you leave out is a day nobody knows about |
| `closed` | specific dates (`YYYY-MM-DD`) it is shut, whatever the usual hours say |
| `dayId` | the day's ISO date, or `null` for the backlog |
| `added.by` / `.how` | `chat` / `package` for anything you send |

Times are `HH:MM` in destination local time, dates are `YYYY-MM-DD`, timestamps are ISO UTC.

**Leave out what you do not know.** The planner notes which fields were actually in the package, and
a field you leave out is one you have no opinion about: the owner's value stands and they are not
asked anything. So a package that mentions two places and four fields is read as being about two
places and four fields, and nothing else. A guess written as fact is the one thing the merge cannot
undo for them.

**`null` is not the same as leaving it out.** Leaving a key out says nothing at all. Sending
`"fixed": null` says "there is no booked time", which is a statement — and on a place the owner
already has, it can take back a time you gave them in an earlier package. When you are describing a
new place from scratch, nulls are honest and harmless. When you are adding to a place they already
have, send only the keys you mean.

**A blank takes back only your own.** An empty string, an empty list and `null` all mean "nothing
here". Sending one clears a field whose value came from your last package and the owner never
changed it — that is how you take back something you got wrong. It will not quietly clear a value of
theirs: that is put to them as a question and left alone unless they say otherwise, and with no
stored baseline, where it cannot tell whose the value was, theirs simply stands. A *place* cannot be
removed by any means.

**Leave the trip's own settings alone.** `title`, `tz`, `transit`, `currency` and `lookups` belong to
the owner. Restating the title is not free: it is a different title from theirs, so the merge stops
and asks about it.

### Days and orders

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

That is a whole day as a package should send one. A day has more to it — `city`, `start`, `end`,
`shown`, `centre`, `note` — and all of it is the owner's: where they are sleeping, when they want to
leave, which version is on screen. Send any of it and you are proposing a change to it.

Three rules hold at all times, and the planner repairs anything that breaks them on the way in:

- a place's `dayId` says where it lives — a day, or `null` for the backlog;
- `plans` hold **order only**, and may only name places of their own day. A place may appear twice,
  for a station you pass back through, and each appearance is its own stop;
- the backlog is exactly the places with no day.

**Every place your order names must be in `places`.** Its id on its own is enough — `{"id":
"nishiki-market"}` carries it into the order and says nothing about it, so everything the owner has
on that place is left exactly as it was. An id that comes with no place at all is dropped from the
order, and the planner says so.

You do not need to restate `dayId` for a place you are only putting in an order: naming it in a
day's order is itself saying which day it is on. Do not send both at once in contradiction — a place
with `"dayId": null` that an order also names stays in the backlog, and the order loses it.

Propose all three versions where you can. `less`, `balanced` and `packed` are the owner's to choose
between, and a package that only fills one of them leaves the other two as they were.

Do not send `legs`. Travel times are the planner's own measurements and a package cannot improve
them.

## How the merge will treat your package

The planner keeps the last package it loaded and compares three ways: that baseline, what the owner
has now, and what you have just sent.

| Baseline | Owner | You | Result |
|---|---|---|---|
| anything | anything | *field not in the package* | theirs stands, no question |
| nothing | nothing | hours | your hours land, no question |
| 60 min | 60 min | 90 min | yours lands, no question |
| 60 min | 90 min | 60 min | theirs stays, no question |
| 60 min | 90 min | 120 min | **it asks**, and keeps theirs unless the owner says otherwise |
| your note | your note | `""` | your note comes off, no question |
| your note | a note of their own | `""` | **it asks**, and keeps theirs |

So the way to avoid pestering the owner is to **change only what you have actually learned
something about**. Re-sending an unchanged place costs nothing; re-sending it with a field quietly
rewritten costs them a question.

If the owner has never loaded a package in that browser there is no baseline, and anything they have
set that you disagree with has to be asked about. The planner tells them this is why.

## Reading a hand-back

A hand-back is the whole trip plus a `handback` section:

```json
{
  "schema": "day-planner/2", "kind": "handback", "tripId": "japan-2026",
  "at": "2026-11-18T19:04:00Z", "trip": { … },
  "handback": {
    "note": "Dropped the market, it looked like a tourist trap",
    "days": [{
      "date": "2026-11-21", "city": "Kyoto", "note": "", "chosen": "balanced",
      "versions": [{
        "key": "balanced", "label": "Balanced",
        "order": ["fushimi-inari", "nishiki-market"],
        "starts": "08:30", "finishes": "17:40",
        "summary": { "stops": 2, "travel": 58, "wait": 0, "visit": 150, "spare": 200,
                     "estimated": 1, "checked": 2, "errors": 0 },
        "stops": [{ "id": "fushimi-inari", "name": "Fushimi Inari Taisha",
                    "arrive": "08:50", "at": "08:50", "until": "10:50", "waited": 0, "minutes": 120 }],
        "issues": [{ "severity": "warn", "text": "…" }],
        "checks": [{ "name": "Nishiki Market", "text": "Hours not checked yet" }]
      }]
    }],
    "changes": { "baseline": true, "added": [], "deleted": [], "moved": [], "edited": [], "orders": [] },
    "travel": [{
      "date": "2026-11-21", "leg": "start>fushimi-inari",
      "from": "the start of the day", "to": "Fushimi Inari Taisha",
      "pick": null, "mine": null,
      "ways": { "walk":    { "minutes": 44, "km": 3.32, "source": "osrm" },
                "transit": { "minutes": 17, "source": "transitous", "name": "Karasuma line",
                             "detail": "walk 11 min to 四条 · 3 min to 京都 · walk 3 min" } }
    }]
  }
}
```

### What to do with each part

**`note`** — read it first. It is the only part written by a person.

**`days[].chosen` and `versions`** — the version named by `chosen` is the one they settled on. Any
other version present is one they want a second opinion about, not one they are using.

**`versions[].issues`** — `severity: "error"` means the day does not work as planned: arriving after
a booked time, a place shut that day, getting back late. These are the first thing to fix in the
next package. `warn` is softer, usually a missing position.

**`versions[].checks`** — things the planner could not verify: hours it has never confirmed, or a
`check` note you wrote earlier. **This is your worklist.** Each one is a place where a package with
a verified `hours` block would remove a question.

**`changes`** — what the owner did since the two of you were last in step, which is the last package
they merged or the last hand-back they took, whichever came later. `edited` names fields by their
label, so `{"name":"Fushimi Inari Taisha","fields":["How long"]}` means they overrode your duration.
Take the hint: they know something you do not, so do not send it back changed. Nothing appears here
because you left it out — these are their own edits to a whole trip.

When `changes.baseline` is `false`, the planner had nothing to compare against. Treat the whole
trip as current state and the change lists as absent, not empty.

**`travel`** — the measured times, and this is the part worth being careful with:

| `source` | What it is |
|---|---|
| `osrm` | a real route along real streets. Trustworthy |
| `transitous` | a real timetabled journey. `detail` spells it out, `departs` says which departure it answers |
| `stops` | **not** a timetable. Worked out from stops near each end plus a shared line in OpenStreetMap, with no times behind it. `name` is hedged ("probably the 206 bus") for exactly this reason |
| `mine` | a time the owner entered themselves. It beats everything, including yours |

A leg with no `ways` at all is one nothing could answer. A slot with `asked` set but no `minutes`
is a service that was asked and had nothing — do not suggest asking it again.

Never present a `stops` time as a timetable, and never promise a specific bus from one.

## A round trip, start to finish

1. The owner uploads their latest saved trip file to the chat project.
2. The chat researches, and sends a package: new places with verified hours, three proposed orders,
   notes on what to book.
3. The owner pastes it into **Trip file → Paste a block**. It merges. Anything they had already
   changed that the package also changed is put to them as a question, one row per place.
4. They plan the day, tap the map, check travel times, change their mind.
5. They write a note in **Hand back to the chat**, tick any version they want a second look at, and
   copy the block into the chat.
6. The chat reads the note, the errors, the checks and the changes, and goes back to step 2.

## Checklist before sending a package

- [ ] generated by script, both marker lines present, one JSON object between them
- [ ] `kind` is `package`, `schema` is `day-planner/2`, `tripId` matches theirs
- [ ] every place has a stable `id` it has had before, or a new slug if it is new
- [ ] every place named in an order is in `places`, if only as `{"id": "…"}`
- [ ] nothing is deleted by omission; a field sent empty is one you mean to take back
- [ ] no `title` or other trip setting unless you mean to change it
- [ ] `hours.verified` is `true` only where it was really checked, for the trip's dates
- [ ] no field changed unless you learned something about it
- [ ] no `legs`
- [ ] every `dayId` is a day the trip actually has
- [ ] prices in their own currency, never converted
