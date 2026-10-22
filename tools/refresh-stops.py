#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Build the planner's stop snapshot from OpenStreetMap, and optionally publish it.

The planner needs two things to work a journey out where no timetable reaches: every public
transport stop near each end of a leg, and which lines call at those stops. Overpass can answer
that live, but on the public instance it refused five requests in six and took 33 to 40 seconds
when it did answer, against a fair-use budget of about a hundred queries a day for everybody using
the planner together. So we build the answer once and publish it as plain files.

The output is a grid of tiles, one file per whole degree of latitude and longitude, which means the
planner works out which file it wants with arithmetic on the coordinates rather than a lookup table.

Run it for the whole world:
    tools/refresh-stops.py --regions global --out ../plan-my-trip-data-stops --push

or for a few places, which is enough to develop against:
    tools/refresh-stops.py --regions kansai,kanto --out ../plan-my-trip-data-stops

Needs `osmium` (brew install osmium-tool) and pyosmium (pip install osmium).
"""
import argparse
import collections
import json
import math
import os
import pathlib
import re
import shutil
import subprocess
import sys
import time

# Geofabrik's own names. 'global' is every continent it publishes that has public transport in it.
CONTINENTS = ['europe', 'asia', 'north-america', 'south-america', 'africa',
              'australia-oceania', 'central-america']
# A handful of smaller extracts, so a developer need not fetch a continent to have something real.
PLACES = {
    'kansai': 'asia/japan/kansai', 'kanto': 'asia/japan/kanto', 'japan': 'asia/japan',
    'britain': 'europe/great-britain', 'germany': 'europe/germany', 'france': 'europe/france',
    'switzerland': 'europe/switzerland', 'ireland': 'europe/ireland-and-northern-ireland',
}
GEOFABRIK = 'https://download.geofabrik.de/%s-latest.osm.pbf'
AGENT = 'plan-my-trip stop snapshot (https://github.com/tigerasks/plan-my-trip)'

# What counts as a stop, and what counts as a line. These mirror the query the planner used to send
# Overpass, so the snapshot holds the same objects the live answer did.
RAILWAY_STOP = re.compile(r'^(station|halt|tram_stop)$')
ROUTE_KIND = re.compile(r'^(bus|tram|light_rail|train|subway)$')
KIND_CODE = {'bus': 0, 'rail': 1, 'tram': 2, 'stop': 3}
FORMAT = 1          # bumped if the tile layout changes, so the planner can refuse an older one


def say(*bits):
    print(*bits, flush=True)


def run(cmd, **kw):
    say('   $', ' '.join(str(c) for c in cmd))
    subprocess.run(cmd, check=True, **kw)


def part_of(path):
    """Where a file is built before it is finished. Only the rename makes it real, so a run that is
    killed half way leaves nothing the next one will mistake for a whole file."""
    return path.with_name(path.name.replace('.osm.pbf', '.part.osm.pbf'))


def download(path, into):
    """Fetch one Geofabrik extract. What is already there is kept, and a part-finished download is
    resumed rather than started again: these are gigabytes."""
    dest = into / (path.replace('/', '-') + '.osm.pbf')
    if dest.exists():
        say('   have %s already (%.0f MB)' % (dest.name, dest.stat().st_size / 1e6))
        return dest
    part = part_of(dest)
    say('   fetching', GEOFABRIK % path)
    # curl rather than urllib: it resumes, and these are gigabytes.
    run(['curl', '-fL', '--retry', '3', '--retry-delay', '5', '-C', '-',
         '-A', AGENT, '-o', str(part), GEOFABRIK % path])
    part.rename(dest)
    return dest


def extract(path, into, keep):
    """The filtered extract for one region: everything that is not a stop or a route thrown away
    before anything parses it. That is the difference between twenty seconds and twenty minutes,
    because osmium does it in C++ at about 100 MB a second.

    The raw extract is deleted once filtered, since a continent is tens of gigabytes and what is
    left of it is a fiftieth of that. So the filtered copy is what decides whether to download at
    all: a run that falls over must not go back for a download it no longer has any use for.
    """
    out = into / (path.replace('/', '-') + '-transit.osm.pbf')
    if out.exists():
        say('   have %s already (%.0f MB)' % (out.name, out.stat().st_size / 1e6))
        raw = into / (path.replace('/', '-') + '.osm.pbf')
        if raw.exists() and not keep:
            # A run that stopped before it could tidy up leaves one of these behind, and a continent
            # is tens of gigabytes of disk that the rest of the refresh wants.
            say('   dropping %s, which has already been filtered (%.0f MB)' % (raw.name, raw.stat().st_size / 1e6))
            raw.unlink()
        return out
    pbf = download(path, into)
    part = part_of(out)
    run(['osmium', 'tags-filter', '-o', str(part), '--overwrite', str(pbf),
         'nw/highway=bus_stop', 'nw/railway=station,halt,tram_stop',
         'nw/public_transport=station', 'r/type=route'])
    part.rename(out)
    if not keep:
        pbf.unlink(missing_ok=True)
    return out


def kind_of(tags):
    railway = tags.get('railway', '')
    if railway in ('tram_stop', 'light_rail'):
        return 'tram'
    if railway in ('station', 'halt'):
        return 'rail'
    if tags.get('highway') == 'bus_stop':
        return 'bus'
    return 'stop'


def is_stop(tags):
    return (tags.get('highway') == 'bus_stop'
            or RAILWAY_STOP.match(tags.get('railway', ''))
            or tags.get('public_transport') == 'station')


class Spill:
    """Collects stops by tile and writes them out in batches.

    Holding one open file per tile is the obvious way to do this and it falls over: the world is a
    few thousand tiles, and a process may have only a few hundred files open. Holding every stop in
    memory instead would want gigabytes. So rows pile up in memory and go out together, which bounds
    both, and touches each file a few dozen times over a whole run rather than once per stop.
    """
    def __init__(self, folder, rows=200000):
        self.folder, self.limit = folder, rows
        self.rows, self.held = collections.defaultdict(list), 0

    def write(self, tile, row):
        self.rows[tile].append(row)
        self.held += 1
        if self.held >= self.limit:
            self.flush()

    def flush(self):
        for tile, rows in self.rows.items():
            with open(self.folder / (tile + '.ndjson'), 'a', encoding='utf-8') as fh:
                fh.write(''.join(rows))
        self.rows.clear()
        self.held = 0


def harvest(pbf, degrees, spill):
    """Read one extract and write each stop to the file for the tile it falls in.

    Going out to disk rather than keeping everything is what makes this bounded: the whole world is
    nearly nine million stops, and holding them all to sort at the end would want several gigabytes.
    A tile can also straddle two continents, so spilling and compacting later is how the two halves
    meet.
    """
    import osmium

    lines, member_lines = {}, collections.defaultdict(set)
    for rel in osmium.FileProcessor(pbf, osmium.osm.RELATION).with_filter(osmium.filter.KeyFilter('type')):
        tags = dict(rel.tags)
        if tags.get('type') != 'route' or not ROUTE_KIND.match(tags.get('route', '')):
            continue
        # A line is known by its number where it has one. Where it has not, its name will do, and
        # where it has neither there is nothing worth showing, so it is left out.
        label = (tags.get('ref') or '').strip() or (tags.get('name:en') or tags.get('name') or '').strip()
        if not label:
            continue
        lines[rel.id] = label
        for m in rel.members:
            if m.type in ('n', 'w'):
                member_lines[(m.type, m.ref)].add(rel.id)
    say('   %d lines, %d objects on one' % (len(lines), len(member_lines)))

    tiles, counted = set(), 0
    for obj in osmium.FileProcessor(pbf, osmium.osm.NODE | osmium.osm.WAY).with_locations():
        tags = dict(obj.tags)
        if not tags or not is_stop(tags):
            continue
        if isinstance(obj, osmium.osm.Node):
            lat, lng, key = obj.location.lat, obj.location.lon, ('n', obj.id)
        else:
            try:
                pts = [(n.lat, n.lon) for n in obj.nodes if n.location.valid()]
            except Exception:
                pts = []
            if not pts:
                continue
            lat = sum(p[0] for p in pts) / len(pts)
            lng = sum(p[1] for p in pts) / len(pts)
            key = ('w', obj.id)
        name = (tags.get('name:en') or tags.get('name') or '').strip()
        on = sorted({lines[i] for i in member_lines.get(key, ()) if i in lines})
        # Round before choosing the tile, not after. A stop half a metre inside the edge rounds onto
        # it, and a stop filed under one tile but written as being in the next is one the planner
        # would look for in the wrong file.
        lat, lng = round(lat, 5), round(lng, 5)
        tile = '%d_%d' % (math.floor(lat / degrees), math.floor(lng / degrees))
        tiles.add(tile)
        # The id goes along so the same stop met twice in overlapping extracts is only kept once.
        spill.write(tile, json.dumps([key[0] + str(key[1]), name, lat, lng,
                                      kind_of(tags), on], ensure_ascii=False) + '\n')
        counted += 1
    spill.flush()
    say('   %d stops in %d tiles' % (counted, len(tiles)))
    return counted


def compact(spill, out, degrees):
    """Turn each tile's spilled stops into the file the planner fetches.

    GitHub Pages gzips on the way out, so what the repository pays is the uncompressed size. Columns
    of numbers with the line names written once cost about a third of what an object a stop does.
    """
    tiles_dir = out / 'tiles'
    tiles_dir.mkdir(parents=True, exist_ok=True)
    for stale in tiles_dir.glob('*.json'):
        stale.unlink()
    names, total = [], 0
    for path in sorted(spill.glob('*.ndjson')):
        tile = path.stem
        seen, stops = set(), []
        with open(path, encoding='utf-8') as fh:
            for row in fh:
                sid, name, lat, lng, kind, on = json.loads(row)
                if sid in seen:
                    continue
                seen.add(sid)
                stops.append((lat, lng, name, kind, on))
        if not stops:
            continue
        stops.sort()                      # so the deltas below stay small
        labels, index = [], {}
        for _, _, _, _, on in stops:
            for label in on:
                if label not in index:
                    index[label] = len(labels)
                    labels.append(label)
        ty, tx = (int(v) for v in tile.split('_'))
        oy, ox = round(ty * degrees * 1e5), round(tx * degrees * 1e5)
        ys, xs, py, px = [], [], oy, ox
        for lat, lng, _, _, _ in stops:
            y, x = round(lat * 1e5), round(lng * 1e5)
            ys.append(y - py)
            xs.append(x - px)
            py, px = y, x
        body = {
            'v': FORMAT,
            'o': [oy, ox],
            'L': labels,
            'y': ys,
            'x': xs,
            'k': [KIND_CODE.get(s[3], 3) for s in stops],
            'n': '\n'.join(s[2] for s in stops),
            'l': [[index[label] for label in s[4]] for s in stops],
        }
        (tiles_dir / (tile + '.json')).write_text(
            json.dumps(body, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
        names.append(tile)
        total += len(stops)
    return names, total


def write_manifest(out, names, total, degrees, regions):
    """What the planner reads first: which tiles exist, so it never asks for one that does not."""
    (out / 'manifest.json').write_text(json.dumps({
        'v': FORMAT,
        'built': time.strftime('%Y-%m-%d'),
        'degrees': degrees,
        'stops': total,
        'regions': regions,
        'tiles': sorted(names),
    }, separators=(',', ':')), encoding='utf-8')
    (out / 'README.md').write_text(
        '# plan-my-trip stop snapshot\n\n'
        'Public transport stops and the lines that call at them, for\n'
        '[plan-my-trip](https://github.com/tigerasks/plan-my-trip). Built by that repository\'s\n'
        '`tools/refresh-stops.py` from OpenStreetMap extracts.\n\n'
        '- built: %s\n- regions: %s\n- stops: %d\n- tiles: %d, one per %g degree of latitude and longitude\n\n'
        '## Licence\n\n'
        'This is a derived database of OpenStreetMap data.\n\n'
        '© OpenStreetMap contributors, available under the\n'
        '[Open Database Licence](https://opendatacommons.org/licenses/odbl/).\n\n'
        'See https://www.openstreetmap.org/copyright.\n\n'
        '## Layout\n\n'
        '`manifest.json` lists the tiles that exist. Each `tiles/<lat>_<lng>.json` holds the stops\n'
        'whose position floors to that whole degree, as columns: `o` the tile origin at 1e5 fixed\n'
        'point, `y` and `x` delta-encoded positions from it, `n` the names newline-joined, `k` the\n'
        'kind (0 bus, 1 rail, 2 tram, 3 other), `L` the line labels, and `l` each stop\'s labels as\n'
        'indices into `L`.\n'
        % (time.strftime('%Y-%m-%d'), ', '.join(regions), total, len(names), degrees),
        encoding='utf-8')
    (out / '.nojekyll').write_text('', encoding='utf-8')


def resume(spill, settings, restart):
    """Which regions an earlier run already spilled, so this one can carry on from where it stopped.

    A refresh of the world is hours of work, and what stops it is rarely the first region. So each
    region's stops stay on disk once they are written. Anything that would make those files no
    longer belong together — a different set of regions, a different tile size, a different layout —
    starts the spill again rather than mixing two runs.

    A region killed half way through is not marked done, so its stops are written a second time. The
    ids ride along with them for exactly that reason: compacting keeps the first of each.
    """
    state = spill / 'state.json'
    was = {}
    if state.exists() and not restart:
        try:
            was = json.loads(state.read_text(encoding='utf-8'))
        except ValueError:
            was = {}
    if {key: was.get(key) for key in settings} != settings:
        for stale in spill.glob('*.ndjson'):
            stale.unlink()
        was = {}
    return state, list(was.get('done', []))


def mark(state, settings, done):
    state.write_text(json.dumps(dict(settings, done=done)), encoding='utf-8')


def who_commits():
    """The name and address this project's own commits carry.

    A fresh repository has no identity of its own, so git falls back to whatever is configured
    globally — which on a work machine is a work address, and it would be published. So take the
    identity from the repository this script lives in, and refuse to commit without one rather than
    let the fallback decide.
    """
    here = pathlib.Path(__file__).resolve().parent.parent
    got = {}
    for key in ('user.name', 'user.email'):
        done = subprocess.run(['git', '-C', str(here), 'config', '--get', key],
                              capture_output=True, text=True)
        got[key] = done.stdout.strip()
    if not got['user.name'] or not got['user.email']:
        sys.exit('%s has no user.name or user.email configured, and I will not fall back to the\n'
                 'global one in case it is a work address. Set them there first.' % here)
    return got


def can_publish(out):
    """Everything publishing will need, settled before the work rather than after it.

    A refresh of the world is an hour of work on top of most of a day's downloads. Finding out at
    the end of it that there is nowhere to push to, or no name to commit under, is the one failure
    that wastes all of it.
    """
    who_commits()
    where = subprocess.run(['git', '-C', str(out), 'remote', 'get-url', 'origin'],
                           capture_output=True, text=True)
    if where.returncode:
        sys.exit('%s is not a git repository with anywhere to push to, so --push would fail at the\n'
                 'end of a long run. Clone the data repository into it first:\n'
                 '    git clone git@github.com:tigerasks/plan-my-trip-data-stops.git %s' % (out, out))
    say('publishing to', where.stdout.strip())


def publish(out, message, reset):
    """Commit the snapshot and send it up.

    The history is reset by default: a refresh replaces every tile, so keeping the old ones would
    add a few hundred megabytes to the repository every time for no good reason.
    """
    git = ['git', '-C', str(out)]
    for key, value in who_commits().items():
        run(git + ['config', key, value])
    if reset:
        run(git + ['checkout', '-q', '--orphan', 'fresh'])
    run(git + ['add', '-A'])
    run(git + ['commit', '-q', '-m', message])
    if reset:
        run(git + ['branch', '-M', 'main'])
    run(git + ['push', '--force', 'origin', 'main'])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--regions', default='kansai',
                    help="'global' for every continent, or names from %s, comma separated"
                         % ','.join(sorted(PLACES)))
    ap.add_argument('--out', required=True, help='the data repository to write the snapshot into')
    ap.add_argument('--work', default=None, help='where to keep downloads (default: <out>/../stop-work)')
    ap.add_argument('--degrees', type=float, default=1.0, help='tile size in degrees (default 1)')
    ap.add_argument('--push', action='store_true', help='commit the result and force-push it')
    ap.add_argument('--keep-history', action='store_true', help='do not reset the data repository history')
    ap.add_argument('--keep-downloads', action='store_true', help='do not delete the extracts afterwards')
    ap.add_argument('--restart', action='store_true', help='build every region again rather than carrying on')
    args = ap.parse_args()

    names = CONTINENTS if args.regions == 'global' else [r.strip() for r in args.regions.split(',') if r.strip()]
    paths = []
    for name in names:
        if name in PLACES:
            paths.append(PLACES[name])
        elif name in CONTINENTS or '/' in name:
            paths.append(name)
        else:
            sys.exit("I do not know the region %r. Use 'global', a path like asia/japan/kansai, or one of: %s"
                     % (name, ', '.join(sorted(PLACES))))

    out = pathlib.Path(args.out).expanduser().resolve()
    work = pathlib.Path(args.work).expanduser().resolve() if args.work else out.parent / 'stop-work'
    spill = work / 'spill'
    out.mkdir(parents=True, exist_ok=True)
    spill.mkdir(parents=True, exist_ok=True)
    settings = {'format': FORMAT, 'degrees': args.degrees, 'paths': paths}
    state, done = resume(spill, settings, args.restart)

    for tool in ('osmium', 'curl', 'git'):
        if not shutil.which(tool):
            sys.exit('I need %s on the path. For osmium: brew install osmium-tool' % tool)
    try:
        import osmium           # noqa: F401
    except ImportError:
        sys.exit('I need pyosmium. Install it with: pip install osmium')
    if args.push:
        can_publish(out)

    started = time.time()
    for i, path in enumerate(paths, 1):
        say('[%d/%d] %s' % (i, len(paths), path))
        if path in done:
            say('   an earlier run harvested this already')
            continue
        small = extract(path, work, args.keep_downloads)
        harvest(str(small), args.degrees, Spill(spill))
        done.append(path)
        mark(state, settings, done)
        say('   %.0f min so far' % ((time.time() - started) / 60))

    say('compacting')
    tiles, kept = compact(spill, out, args.degrees)
    write_manifest(out, tiles, kept, args.degrees, names)
    size = sum(p.stat().st_size for p in (out / 'tiles').glob('*.json'))
    say('%d stops in %d tiles, %.1f MB on disk, %.0f min all told'
        % (kept, len(tiles), size / 1e6, (time.time() - started) / 60))

    if args.push:
        publish(out, 'Stops as of ' + time.strftime('%Y-%m-%d'), not args.keep_history)
        say('pushed')
    else:
        say('not pushed. Add --push, or commit %s yourself.' % out)


if __name__ == '__main__':
    main()
