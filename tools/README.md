# Tools

Scripts run by hand. Nothing here is part of the app, and none of it is published: GitHub Pages
serves `docs/` only.

## `refresh-stops.py` — the stop snapshot

Where no timetable reaches, the planner works a journey out from the stops near each end of a leg.
It used to ask Overpass for those live. On 22 Oct 2026 Overpass refused five requests in six, took
33 to 40 seconds when it answered, and documents an allowance of about a hundred queries a day
counted across everyone using a given app — a tenth of what one day's legs spent. So the stops are
built into a snapshot and published instead (design doc, decisions 22 to 25).

The snapshot lives in its own repository,
[plan-my-trip-data-stops](https://github.com/tigerasks/plan-my-trip-data-stops), served at
<https://tigerasks.github.io/plan-my-trip-data-stops/>. It is a grid of whole-degree tiles, so the
file the planner wants is arithmetic on the coordinates rather than a lookup.

### Setting up

```sh
brew install osmium-tool                          # a compiled binary; no virtual environment holds it
.venv/bin/pip install -r tools/requirements.txt   # pyosmium, which is a different thing
```

You also need the data repository checked out beside this one, with a remote it can push to.

### Running it

For a region or two, which is enough to develop against:

```sh
.venv/bin/python tools/refresh-stops.py --regions kansai,kanto --out ../plan-my-trip-data-stops
```

For the whole world:

```sh
.venv/bin/python tools/refresh-stops.py --regions global --out ../plan-my-trip-data-stops --push
```

| | A region or two | The world |
|---|---|---|
| Downloads | 354 MB for Kansai, 521 MB for Kanto | about 86 GB, several hours |
| Disk at peak | under a gigabyte | about 35 GB — each extract is deleted once filtered |
| Work after that | about a minute | an hour or so |
| Result | 106,245 stops in 22 tiles, 3.8 MB | 4,495,039 stops in 8,985 tiles, 180 MB (measured, 23 Oct 2026) |

A run that falls over is started again with the same command, and carries on rather than beginning
from nothing: the regions it finished keep their stops, a part-finished download is resumed, and a
region whose filtered extract is already on disk is never fetched again. That last one matters most,
because the raw extract is deleted as soon as it is filtered — Europe is 33 GB to download and 2.4 GB
once filtered, so going back for it would be the longest part of the run repeated for nothing.

`--restart` builds every region again instead. Changing the regions, the tile size or the layout
does that by itself, since stops gathered under one set of those do not belong with another's.

### What it does

1. fetches each Geofabrik extract;
2. runs `osmium tags-filter` over it first, keeping only stops and route relations. This is the
   difference between 20 seconds and 13 minutes, and the output is identical;
3. reads the route relations for their members, so it knows which lines call at which stop — the
   thing a live query could never say, and what lets the planner name a line that serves **both**
   ends rather than one that merely passes near them;
4. writes each stop to the file for the tile it falls in, one continent at a time. Going out to disk
   a stop at a time looks wasteful, but holding nine million of them in memory to sort at the end
   would want several gigabytes, and a tile can straddle two continents;
5. compacts each tile into columns — positions delta-encoded as fixed point, names newline-joined,
   line labels written once and referenced by index. GitHub Pages gzips in transit, so what the
   repository pays is the uncompressed size, and columns cost about a third of an object a stop;
6. writes `manifest.json` listing the tiles that exist, so the planner never asks for one that
   does not;
7. with `--push`, commits and force-pushes. The history is **reset** by default: a refresh replaces
   every tile, so keeping the old ones would add a few hundred megabytes every time. The commit takes
   its name and address from this repository rather than your global git config, and refuses to
   commit at all if this repository has none — a snapshot should not go out under a work address.

### Afterwards

The planner shows the snapshot's build date in its credits. A line that opens after a refresh is
invisible until the next one, which is the cost of not asking a service every time.
