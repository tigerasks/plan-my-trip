#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Build a day-planner/2 package from a plan, checking it against the owner's own trip first.

    python3 make_package.py --trip <their file> --plan plan.json --out package.txt

`plan.json` holds only what you mean to say:

    { "tripId": "example-kyoto",
      "places": [ { "id": "example-temple", "duration": 120 },
                  { "id": "new-place", "name": "…", "lat": 1.0, "lng": 2.0, "dayId": "2026-11-21" },
                  { "id": "example-garden" } ],
      "days":   { "2026-11-21": { "plans": { "balanced": ["example-temple", "new-place"] } } } }

Because it has their trip as well, it does not merely emit the block: it works out what the package
will do when they paste it — what lands quietly, what they will be asked about, and what it will not
send at all. A package that asks six questions has usually restated six things it never learned.
"""
import argparse
import json
import re
import sys

WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
PLAN_KEYS = ['less', 'balanced', 'packed']
KINDS = ['sight', 'food', 'shop', 'nature', 'museum', 'culture', 'view', 'experience', 'other']
PRIORITIES = ['must', 'want', 'maybe']
HOURS_SOURCES = ['osm', 'you', 'chat']
OSM_TYPES = ['node', 'way', 'relation']
PLACE_FIELDS = ['name', 'localName', 'lat', 'lng', 'kind', 'area', 'duration', 'fixed', 'window',
                'hours', 'closed', 'booked', 'priority', 'price', 'check', 'note', 'links', 'osm',
                'dayId']
# A day's own arrangements belong to the owner: where they sleep, when they leave, what is on screen.
DAY_OK = ['id', 'date', 'city', 'plans']
TRIP_OWN = ['title', 'tzLabel', 'tz', 'transit', 'currency', 'fx', 'fxAt', 'lookups']
IDENTITY = ['name', 'lat', 'lng']
BEGIN = '--- BEGIN day-planner/2 ---'
END = '--- END day-planner/2 ---'
DATE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
TIME = re.compile(r'^([01]\d|2[0-3]):[0-5]\d$')
SLUG = re.compile(r'^[a-z0-9][a-z0-9-]*$')

errors, warnings, quiet = [], [], []
asks = {}        # subject -> the fields it will be asked about, as the owner sees it


def ask(subject, line):
    asks.setdefault(subject, []).append(line)


def load(path):
    text = sys.stdin.read() if path == '-' else open(path, encoding='utf-8').read()
    if BEGIN in text and END in text:
        body = text.split(BEGIN, 1)[1].split(END, 1)[0]
        return json.loads(''.join(l.strip() for l in body.strip().splitlines()))
    return json.loads(text)


def as_map(x, key='id'):
    if isinstance(x, list):
        return {d.get(key) or d.get('date'): d for d in x if isinstance(d, dict)}
    return x or {}


def blank(v):
    return v is None or v == '' or v == [] or v == {} or v is False


def brief(v, width=52):
    """Values go in a report a person reads, so an opening-hours object has to fit on the line."""
    if isinstance(v, dict):
        if 'week' in v or 'source' in v:
            week = v.get('week') or {}
            shut = [d for d in WEEK if week.get(d) == []]
            known = [d for d in WEEK if week.get(d)]
            return ('hours %s/%s, open %s%s' % (v.get('source'), 'verified' if v.get('verified') else 'unverified',
                                                ','.join(known) or 'nothing',
                                                ', shut ' + ','.join(shut) if shut else ''))
        v = json.dumps(v, ensure_ascii=False)
    elif not isinstance(v, str):
        v = json.dumps(v, ensure_ascii=False)
    return v if len(v) <= width else v[:width - 1] + '…'


def check_hours(pid, h):
    if not isinstance(h, dict):
        errors.append('%s: hours must be an object' % pid)
        return
    if h.get('source') not in HOURS_SOURCES:
        errors.append('%s: hours.source is %r, not one of %s' % (pid, h.get('source'), HOURS_SOURCES))
    week = h.get('week') or {}
    for day, spans in week.items():
        if day not in WEEK:
            errors.append('%s: hours.week has "%s"; the keys are %s' % (pid, day, WEEK))
            continue
        if spans is None:
            continue
        if not isinstance(spans, list):
            errors.append('%s: hours.week.%s must be a list of [open, close] pairs, or [] for closed' % (pid, day))
            continue
        for pair in spans:
            if (not isinstance(pair, (list, tuple)) or len(pair) != 2
                    or not all(TIME.match(str(t) or '') for t in pair)):
                errors.append('%s: hours.week.%s has %r; each pair is ["HH:MM", "HH:MM"]' % (pid, day, pair))
    for day, last in (h.get('lastEntry') or {}).items():
        if day not in WEEK:
            errors.append('%s: hours.lastEntry has "%s"' % (pid, day))
        elif not TIME.match(str(last) or ''):
            errors.append('%s: hours.lastEntry.%s is %r, not "HH:MM"' % (pid, day, last))
    if h.get('verified') and not h.get('raw'):
        warnings.append('%s: hours say verified but carry no raw text to show for it' % pid)
    if not h.get('verified'):
        warnings.append('%s: hours are not marked verified, so the planner keeps asking about them' % pid)
    if not week and not h.get('raw'):
        errors.append('%s: hours carry neither a week nor raw text, so they say nothing' % pid)


def check_place(p, trip_places, day_ids, named_by_order):
    pid = p.get('id')
    if not pid:
        errors.append('a place has no id; the id is how the merge finds it again')
        return
    if not SLUG.match(str(pid)):
        errors.append('%s: an id is lower case letters, digits and hyphens, like "fushimi-inari"' % pid)
    if 'legs' in p:
        errors.append('%s: never send legs — travel times are the planner\'s own measurements' % pid)
    for key in p:
        if key not in PLACE_FIELDS + ['id', 'added']:
            warnings.append('%s: "%s" is not a field the planner reads, so it is dropped on the way in'
                            % (pid, key))

    mine = trip_places.get(pid)
    said = [k for k in PLACE_FIELDS if k in p]
    if mine is None:
        # An id is the one thing that has to stay exactly as it was, so a near miss is worth saying
        # out loud: a typo does not fail, it silently creates a second copy of the same place.
        loose = re.sub(r'[^a-z0-9]', '', str(pid).lower())
        near = [k for k in trip_places if re.sub(r'[^a-z0-9]', '', k.lower()) == loose]
        if near:
            errors.append('%s: no such place, but the trip has "%s" — ids are exact, and a near miss '
                          'makes a second copy instead of finding the first' % (pid, near[0]))
    if mine is None and not any(k in p for k in IDENTITY):
        if pid in named_by_order:
            pass            # carried by its id so an order can name it, which is exactly right
        else:
            errors.append('%s: a new place needs at least a name, and should have lat and lng' % pid)
    if mine is not None:
        for key in IDENTITY:
            if key in p and p[key] == mine.get(key):
                warnings.append('%s: "%s" is already exactly that, so sending it only risks a question' % (pid, key))
        for key in said:
            if p[key] is None and not blank(mine.get(key)):
                warnings.append('%s: "%s" is null, which asks to take back what they have (%s)'
                                % (pid, key, brief(mine.get(key))))

    if 'duration' in p:
        d = p['duration']
        if not isinstance(d, int) or d < 0 or d > 720 or d % 15:
            errors.append('%s: duration is %r; it is minutes, 0 to 720, in steps of 15' % (pid, d))
    if 'kind' in p and p['kind'] not in KINDS:
        errors.append('%s: kind is %r, not one of %s' % (pid, p['kind'], KINDS))
    if 'priority' in p and p['priority'] is not None and p['priority'] not in PRIORITIES:
        errors.append('%s: priority is %r, not one of %s or null' % (pid, p['priority'], PRIORITIES))
    if 'fixed' in p and p['fixed'] is not None and not TIME.match(str(p['fixed'])):
        errors.append('%s: fixed is %r, not "HH:MM"' % (pid, p['fixed']))
    if 'window' in p and p['window'] is not None:
        w = p['window']
        if not isinstance(w, dict) or not all(TIME.match(str(w.get(k) or '')) for k in ('from', 'to')):
            errors.append('%s: window is %r; it is {"from": "HH:MM", "to": "HH:MM"}' % (pid, w))
    for c in p.get('closed') or []:
        if not DATE.match(str(c)):
            errors.append('%s: closed has %r, not a YYYY-MM-DD date' % (pid, c))
    if 'hours' in p and p['hours'] is not None:
        check_hours(pid, p['hours'])
    if 'osm' in p and p['osm'] is not None:
        o = p['osm']
        if not isinstance(o, dict) or o.get('type') not in OSM_TYPES or not isinstance(o.get('id'), int):
            errors.append('%s: osm is %r; it is {"type": "node|way|relation", "id": 123}' % (pid, o))
    for link in p.get('links') or []:
        if not isinstance(link, dict) or not str(link.get('url', '')).startswith(('http://', 'https://')):
            errors.append('%s: a link needs a url starting http:// or https://' % pid)
    if 'price' in p and isinstance(p['price'], dict) and p['price'].get('amount') is not None:
        if not p['price'].get('currency'):
            warnings.append('%s: a price with an amount should name its currency, never converted' % pid)
    if 'dayId' in p and p['dayId'] is not None:
        if not DATE.match(str(p['dayId'])):
            errors.append('%s: dayId is %r, not a YYYY-MM-DD date' % (pid, p['dayId']))
        elif p['dayId'] not in day_ids:
            errors.append('%s: dayId is %s, which is not a day of this trip (%s)'
                          % (pid, p['dayId'], ', '.join(sorted(day_ids)) or 'none'))
    if p.get('dayId') is None and 'dayId' in p and pid in named_by_order:
        errors.append('%s: it is in the backlog (dayId null) and in a running order at the same time; '
                      'drop the dayId and let the order say where it goes' % pid)

    # What the owner will see. A field they have nothing for lands quietly; one they have a
    # different value for becomes a question, because nothing can tell who is more likely right.
    for key in said:
        if key == 'dayId' and 'dayId' not in p:
            continue
        theirs = (mine or {}).get(key)
        ours = p[key]
        if mine is None:
            continue
        if blank(theirs) and not blank(ours):
            quiet.append('%s: %s' % (pid, key))
        elif theirs != ours and not blank(ours):
            ask(pid, '%s\n        theirs: %s\n        yours : %s' % (key, brief(theirs), brief(ours)))


def main():
    ap = argparse.ArgumentParser(description='Build and check a day-planner/2 package.')
    ap.add_argument('--trip', required=True, help="the owner's saved trip or hand-back ('-' for stdin)")
    ap.add_argument('--plan', required=True, help='the places and days you mean to send')
    ap.add_argument('--out', default='package.txt', help='where to write the block')
    ap.add_argument('--label', default=None, help='a short name for the block, shown while merging')
    ap.add_argument('--at', default=None, help='the timestamp to stamp it with (ISO UTC)')
    args = ap.parse_args()

    theirs = load(args.trip)
    plan = load(args.plan)
    trip = theirs.get('trip') or {}
    trip_places = as_map(trip.get('places'))
    their_days = as_map(trip.get('days'))

    tripId = plan.get('tripId') or theirs.get('tripId') or trip.get('id')
    if not tripId:
        errors.append('no tripId anywhere; the planner uses it to tell one trip from another')
    elif theirs.get('tripId') and tripId != theirs.get('tripId'):
        errors.append('the plan says tripId %r but their trip is %r; a different id is a different '
                      'trip and the planner will offer to replace rather than merge'
                      % (tripId, theirs.get('tripId')))

    places = plan.get('places') or []
    if isinstance(places, dict):
        places = list(places.values())
    days = plan.get('days') or {}
    if isinstance(days, list):
        days = {d.get('id') or d.get('date'): d for d in days}
    # The planner reads a day's date from inside the day, not from the key it sits under, so a day
    # that only has a key is a day it drops — taking its running order with it, in silence. Filling
    # both in here means nobody has to remember that.
    for dayId, d in list(days.items()):
        for key in ('id', 'date'):
            if d.get(key) and d[key] != dayId:
                errors.append('%s: its "%s" says %r; a day is keyed by its own date'
                              % (dayId, key, d[key]))
            d[key] = dayId

    if 'title' in plan:
        errors.append('the plan\'s "title" is ambiguous: the trip\'s title is the owner\'s. Use '
                      '"label" (or --label) for a name for this block')
    for key in TRIP_OWN:
        if key in (plan.get('trip') or {}) or (key != 'title' and key in plan):
            errors.append('"%s" is the owner\'s to set; a package that sends it stops and asks them '
                          'about it' % key)

    day_ids = set(their_days) | set(days)
    named_by_order = set()
    for dayId, d in days.items():
        if not DATE.match(str(dayId)):
            errors.append('"%s" is not a date; days are keyed YYYY-MM-DD' % dayId)
        for key in d:
            if key not in DAY_OK:
                errors.append('%s: "%s" belongs to the owner — where they sleep, when they leave and '
                              'what is on screen are not a package\'s business' % (dayId, key))
        for key, order in (d.get('plans') or {}).items():
            if key not in PLAN_KEYS:
                errors.append('%s: "%s" is not a version; they are %s' % (dayId, key, PLAN_KEYS))
                continue
            if len(order) > 6:
                warnings.append('%s %s has %d stops; a version that long is one nobody uses'
                                % (dayId, key, len(order)))
            named_by_order.update(order)

    sent = {p.get('id') for p in places if isinstance(p, dict)}
    for dayId, d in days.items():
        for key, order in (d.get('plans') or {}).items():
            for pid in order or []:
                if pid not in sent:
                    errors.append('%s %s names "%s", which the package does not list as a place. Add '
                                  '{"id": "%s"} to places — its id alone is enough and says nothing '
                                  'about it' % (dayId, key, pid, pid))

    for p in places:
        if isinstance(p, dict):
            check_place(p, trip_places, day_ids, named_by_order)

    for dayId, d in days.items():
        theirs = (their_days.get(dayId) or {}).get('plans') or {}
        ours = dict(d.get('plans') or {})
        if not ours:
            continue
        # The planner merges the three versions as one field, so a day where any version differs
        # from what they have is one question about the running order.
        full = {k: list(ours.get(k, theirs.get(k) or [])) for k in PLAN_KEYS}
        had = {k: list(theirs.get(k) or []) for k in PLAN_KEYS}
        if full == had:
            quiet.append('%s: its running order is already exactly that' % dayId)
        elif any(had[k] for k in PLAN_KEYS):
            ask(dayId, 'running order\n        theirs: %s\n        yours : %s'
                % (' / '.join('%s %d' % (k, len(had[k])) for k in PLAN_KEYS),
                   ' / '.join('%s %d' % (k, len(full[k])) for k in PLAN_KEYS)))
        else:
            quiet.append('%s: a running order where they had none' % dayId)
        # Only the versions you send are yours to propose; the rest stay as they are.
        missing = [k for k in PLAN_KEYS if k not in ours]
        if missing and any(had[k] for k in missing):
            warnings.append('%s: you left %s out, so those stay as they are — send all three if you '
                            'mean to plan the whole day' % (dayId, ', '.join(missing)))

    for dayId in days:
        if dayId not in their_days:
            warnings.append('%s is a new day; the planner will add it, but its start and end times '
                            'are the owner\'s to set' % dayId)

    now = args.at or '1970-01-01T00:00:00Z'
    out = []
    for p in places:
        q = dict(p)
        if p.get('id') not in trip_places:
            q['added'] = {'by': 'chat', 'how': 'package', 'at': now}
        else:
            q.pop('added', None)
        out.append(q)
    env = {'schema': 'day-planner/2', 'kind': 'package', 'tripId': tripId,
           'title': args.label or plan.get('label') or 'Package', 'at': now, 'app': 'chat',
           'trip': {'id': tripId, 'places': out, 'days': days}}

    print('=== what this package will do ===')
    print('%d place(s), %d day(s), %d byte(s)'
          % (len(out), len(days), len(json.dumps(env, ensure_ascii=False))))
    new = [p['id'] for p in out if p.get('id') not in trip_places]
    if new:
        print('\nnew places, simply added:')
        for pid in new:
            print('  + %s' % pid)
    if quiet:
        print('\nfills a gap, no question asked:')
        for line in quiet:
            print('  . %s' % line)
    if asks:
        print('\nTHEY WILL BE ASKED %d question(s), one per place or day:' % len(asks))
        for subject in asks:
            print('  ? %s' % subject)
            for line in asks[subject]:
                print('      %s' % line)
        print('  — fine where you really did learn better; otherwise drop the field and leave theirs.')
    if warnings:
        print('\nworth a second look:')
        for line in warnings:
            print('  ! %s' % line)
    if errors:
        print('\nNOT SENT — fix these first:')
        for line in errors:
            print('  x %s' % line)
        print('\nNo block written.')
        return 1

    block = BEGIN + '\n' + json.dumps(env, ensure_ascii=False, separators=(',', ':')) + '\n' + END + '\n'
    with open(args.out, 'w', encoding='utf-8') as fh:
        fh.write(block)
    print('\nWritten to %s — give the owner the whole block, first line to last.' % args.out)
    return 0


if __name__ == '__main__':
    sys.exit(main())
