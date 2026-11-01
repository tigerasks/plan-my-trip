# Reading a hand-back

A hand-back is the whole trip plus a `handback` section. Run `scripts/read_trip.py` on it first — it
prints all of this and ends with a worklist. This file is for when you need to know what a field
means rather than what to do next.

A `save` — the trip as the owner saved it — is the same thing without the `handback` section. Read it
the same way.

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

## Each part, and what it is for

**`note`** — the only part a person wrote. Read it first and answer it.

**`days[].chosen`** names the version they settled on. Any other version present is one they want a
second opinion about, not one they are using.

**`versions[].summary`** — `travel`, `wait`, `visit` and `spare` are minutes. `estimated` counts legs
the planner guessed rather than measured; `checked` counts places with something still to confirm;
`errors` counts issues that make the day not work.

**`versions[].stops`** — `arrive` is when they get there, `at` when the visit starts, `waited` the
minutes lost between the two. A large `waited` before a `fixed` time means the order is wrong, not
that the place is wrong.

**`versions[].issues`** — `severity: "error"` means **the day does not work as planned**: arriving
after a booked time, a place shut that day, getting back late. Fix these first. `warn` is softer,
usually a missing position.

**`versions[].checks`** — what the planner could not verify: hours it never had confirmed, and the
`check` notes you wrote. **This is your worklist.** Each one is a place where a package with a
verified `hours` block removes a question for good.

**`changes`** — what they did since the two of you were last in step, which is the last package they
merged or the last hand-back they took, whichever came later. Both sides of that comparison are
whole trips, so everything listed is a real edit of theirs — nothing appears because you left it
out.

- `edited` names fields by their label: `{"name": "Fushimi Inari Taisha", "fields": ["How long"]}`
  means they overrode your duration. **Take the hint.** They know something you do not, so do not
  send it back changed.
- `moved`, `added`, `deleted` and `orders` are the same in spirit: their decisions, not invitations.
- `baseline: false` means the planner had nothing to compare against — a new device, or cleared
  storage. Treat the trip as current state and the change lists as absent rather than empty.

**`travel`** — the measured times, and the part to be most careful with.

| `source` | What it is |
|---|---|
| `osrm` | a real route along real streets, walking or driving. Trustworthy |
| `transitous` | a real timetabled journey. `detail` spells it out; `departs` says which departure it answers |
| `stops` | **not a timetable.** Two stops near each end that share a line in OpenStreetMap, with no times behind it. `name` is hedged — "probably the 206 bus" — for exactly that reason |
| `mine` | a time they entered themselves. It beats everything, including yours |

A leg with no `ways` is one nothing could answer. A slot with `asked` set but no `minutes` is a
service that was asked and had nothing — do not suggest asking it again.

Never present a `stops` time as a timetable, and never promise a particular bus from one.

## What to do with it

1. Fix every `error` in the next package.
2. Answer the note.
3. Work the `checks` list — that is what turns a plan into one they can trust.
4. Leave alone everything in `changes.edited`.
5. Re-plan the days that now have real travel times, especially any with a long `wait` or little
   `spare`. This is the round where a day stops being a guess.
