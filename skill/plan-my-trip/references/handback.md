# Reading a hand-back

A hand-back is what the owner copies back after they have adjusted the day. It is the same envelope
as a save — `kind: "handback"`, with the whole `trip` — plus a `handback` section holding everything
the planner worked out that you could not.

It can only be read. Pasting one back into the planner is refused on purpose.

```json
{
  "schema": "day-planner/2", "kind": "handback", "tripId": "example-kyoto",
  "title": "Kyoto", "at": "2026-11-07T18:12:00Z", "app": "day-planner",
  "trip": { ...the whole trip as it now stands... },
  "handback": {
    "note": "...",
    "days": [ ... ],
    "changes": { ... },
    "travel": [ ... ]
  }
}
```

## `base`

The package the planner will merge the next one against. Pass the hand-back to
`make_package.py --trip` and it is used automatically, which is what makes its prediction exact
rather than a worst case. `null` means the planner had no package stored — a fresh browser — and
then anything the owner has set and you disagree with has to be asked about.

## `note`

What the owner typed before copying. It is the only part of the hand-back a person wrote, and the
only part that can say something no field can. **Answer it first**, in prose, before anything else.

## `days`

One entry per day of the trip:

| Key | What it is |
|---|---|
| `date`, `city`, `note` | the day itself |
| `chosen` | the version they are actually looking at: `less`, `balanced` or `packed` |
| `versions` | the chosen one, plus any alternative they ticked |

Each version carries the day as the planner computed it:

| Key | What it is |
|---|---|
| `key`, `label` | which version |
| `order` | the ids, in order |
| `starts`, `finishes` | `"HH:MM"` for the whole day |
| `summary` | the day in a line |
| `stops` | per stop: `id`, `name`, `arrive`, `at` (when the visit starts), `until`, `waited` minutes, `minutes` of visit |
| `issues` | `{severity, text}` — see below |
| `checks` | `{name, text}` — things it could not verify |

`waited` is the quiet signal. A long wait means they arrive before the place opens or before a
fixed time, so the order is wrong — not that the day is too full.

### `issues`

| `severity` | Meaning | What to do |
|---|---|---|
| `error` | the day does not work: a closed place, arriving after a booked time, getting home late | fix it in the next package, before anything else |
| `warn` | it works but it is tight or odd | worth a sentence; fix if it is cheap |
| `info` | something to be aware of | usually nothing |

### `checks`

The planner's own worklist: hours it has never had confirmed, and every `check` note you left on a
place. This is the list to work through when you research. A verified `hours` block removes the
first kind; answering the question and sending `"check": ""` removes the second.

## `changes`

What the owner has done since the two sides were last in step — since a package of yours was merged
or a hand-back was taken. Both sides of that comparison are whole trips, so everything here is real.

| Key | What it is |
|---|---|
| `baseline` | `false` means the planner has nothing to compare against, and `why` says so. Then the rest is absent and the trip is simply how it stands |
| `added` | `{id, name, dayId, how}` — places they added themselves. `how` is `search`, `map`, `pin` or `package` |
| `deleted` | `{id, name}` — places they removed. **Do not send them back.** The builder refuses one unless you add `"restore": true` deliberately |
| `moved` | `{id, name, from, to}` — a place that changed day |
| `edited` | `{id, name, fields}` — fields they changed, in words: "How long", "Opening hours", "Note" |
| `orders` | `{date, version, now}` — a running order they re-sequenced, with the order as it now is. `{date, added: true}` is a new day |

**`edited` is the one to take seriously.** They changed it because they know something you do not.
Do not send that field back changed, and do not argue with it in prose. If you think it is a
mistake, ask.

An order under `orders` has usually been through the app's "Optimise order", which used the real
measured legs. Start from it rather than from yours.

## `travel`

Every leg the planner measured, which is the part you cannot do at all:

```json
{ "date": "2026-11-21", "leg": "start>example-temple",
  "from": "the start of the day", "to": "Example Temple",
  "pick": "transit", "mine": null,
  "ways": {
    "walk":    {"minutes": 52, "km": 4.1, "source": "osrm"},
    "transit": {"minutes": 23, "source": "transitous", "name": "Bus 206", "departs": "08:41"}
  } }
```

| `source` | What it is | How much to trust it |
|---|---|---|
| `osrm` | a real walking or driving route | a measurement |
| `transitous` | a real timetabled journey, with the service named and a departure time | a measurement, for that departure |
| `stops` | two stops that share a line in OpenStreetMap, with **no timetable behind it** | a plausible connection and nothing more. Never promise a particular bus from one |
| `chat` | a time you looked up in an earlier package, with the link you read it from | as good as the source beside it. Check the link before leaning on it again |
| `mine` | a time the owner entered themselves | beats everything else |

`pick` is the mode they chose for that leg. A slot with `asked` but no minutes is a service that
was asked and had nothing to offer.

Use these to tighten the next round: a leg that costs 40 minutes is an argument for reordering the
day or dropping a stop, and now you can say so with a number behind it.

## Where to start

1. every `error` in `issues`
2. the `note`
3. `checks`
4. `changes.edited`, then `changes.orders`
5. `travel`, for anything that now looks expensive
