#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Build a day-planner/2 package, and say what it will do before anyone pastes it.

    python3 make_package.py --trip their-trip.json --plan plan.json --out package.txt

`--plan` is a small file holding only what you want to send:

    {
      "tripId": "example-kyoto",
      "label": "Saturday planned",
      "places": [ { "id": "example-temple", "duration": 120 } ],
      "days": { "2026-11-21": { "plans": { "balanced": ["example-temple"] } } }
    }

Because this script has the owner's own trip as well as your plan, it does not only write the
block. It works the merge out first and reports what will land quietly, what the owner will be
asked about, and what it refuses to send at all. Read that before handing anything over.

If you still have the package you sent last time, pass it as `--base` and the prediction improves:
the planner merges three ways against it, so a field you both changed from the same starting point
can land without a question.
"""

import argparse
import json
import os
import re
import sys

# read_trip.py sits beside this one, and Python puts a script's own directory on the path.
from read_trip import payload, load, as_map, fmt_date, fmt_dur, die

SCHEMA = 'day-planner/2'
KINDS = ['sight', 'food', 'shop', 'nature', 'museum', 'culture', 'view', 'experience', 'other']
PRIORITIES = ['must', 'want', 'maybe']
HOURS_SOURCES = ['osm', 'you', 'chat']
OSM_TYPES = ['node', 'way', 'relation']
WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
PLAN_KEYS = ['less', 'balanced', 'packed']
PLAN_LABEL = {'less': 'Do less', 'balanced': 'Balanced', 'packed': 'Packed'}
MAX_DURATION = 720
TIME_RE = re.compile(r'^([01]\d|2[0-3]):[0-5]\d$')
DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
ID_RE = re.compile(r'^[a-z0-9][a-z0-9-]*$')

PLACE_KEYS = ['id', 'name', 'localName', 'lat', 'lng', 'lon', 'kind', 'area', 'duration', 'fixed',
              'window', 'hours', 'closed', 'booked', 'priority', 'price', 'check', 'note', 'links',
              'osm', 'dayId']
# Fields the merge compares, in the planner's own words.
FIELD_LABEL = {
    'pos': 'Position', 'name': 'Name', 'localName': 'Local name', 'kind': 'Kind', 'area': 'Area',
    'duration': 'How long', 'fixed': 'Fixed time', 'window': 'Time window', 'hours': 'Opening hours',
    'closed': 'Closed dates', 'booked': 'Booked', 'priority': 'Priority', 'price': 'Price',
    'check': 'Check', 'note': 'Note', 'links': 'Links', 'osm': 'OpenStreetMap', 'dayId': 'Which day',
}
NOT_YOURS = {
    'legs': 'travel times are the planner\'s own measurements; yours would be guesses over facts',
    'added': 'the planner\'s own bookkeeping',
    'createdAt': 'the planner\'s own bookkeeping',
    'updatedAt': 'the planner\'s own bookkeeping',
    'title': 'the trip\'s name is a setting of theirs. Use "label" at the top of the plan for this block\'s label',
    'tz': 'a trip setting of theirs', 'tzLabel': 'a trip setting of theirs',
    'transit': 'a trip setting of theirs', 'currency': 'a trip setting of theirs',
    'lookups': 'a trip setting of theirs', 'fx': 'a trip setting of theirs',
    'stays': 'where they sleep is theirs', 'backlog': 'worked out from which places have no day',
}
# A day carries only its id and its running orders. Everything else about it is the owner's.
DAY_NOT_YOURS = dict(NOT_YOURS, **{
    'start': 'when they leave is theirs', 'end': 'when they get back is theirs',
    'shown': 'which version they are looking at is theirs',
    'centre': 'where their map is pointed is theirs',
    'city': 'the day\'s city is theirs', 'note': 'the day\'s own note is theirs',
})

PROBLEMS = []
WARNINGS = []


def problem(text):
    PROBLEMS.append(text)


def warn(text):
    WARNINGS.append(text)


# ---------- comparing the way the planner does ----------

def blank(v):
    if v is None or v is False or v == '':
        return True
    return isinstance(v, (list, dict)) and not v


def same(a, b):
    if blank(a) and blank(b):
        return True
    return json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)


def hours_times(h):
    """Opening hours, minus the account of where they came from."""
    if blank(h) or not isinstance(h, dict):
        return None
    return {'week': h.get('week'), 'lastEntry': h.get('lastEntry')}


def three_way(mine, theirs, base):
    """mine is the owner's, theirs is ours. Whoever moved away from the baseline wins."""
    if same(theirs, base):
        return 'nothing'
    if same(mine, base) or same(mine, theirs):
        return 'quiet'
    return 'question'


def value_text(v):
    if v is None or v == '':
        return '(nothing)'
    if isinstance(v, bool):
        return 'yes' if v else 'no'
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, str):
        return v if len(v) <= 48 else v[:47] + '…'
    text = json.dumps(v, sort_keys=True)
    return text if len(text) <= 64 else text[:63] + '…'


# ---------- checking the plan ----------

def want_str(where, key, value, limit):
    if not isinstance(value, str):
        problem('%s: %s must be text' % (where, key))
        return None
    if len(value) > limit:
        warn('%s: %s is longer than %d characters and will be cut' % (where, key, limit))
    return value


def want_time(where, key, value):
    if not isinstance(value, str) or not TIME_RE.match(value):
        problem('%s: %s must be a 24-hour time like "09:30", not %r' % (where, key, value))
        return None
    return value


def want_date(where, key, value):
    if not isinstance(value, str) or not DATE_RE.match(value):
        problem('%s: %s must be a date like "2026-11-21", not %r' % (where, key, value))
        return None
    return value


def check_window(where, value):
    if isinstance(value, str):
        bits = re.split(r'\s*[-–—]\s*', value)
        value = bits if len(bits) == 2 else [value]
    if isinstance(value, list):
        if len(value) != 2:
            problem('%s: window needs an opening and a closing time' % where)
            return None
        value = {'from': value[0], 'to': value[1]}
    if not isinstance(value, dict):
        problem('%s: window must be {"from": "HH:MM", "to": "HH:MM"}' % where)
        return None
    out = {}
    for key in ('from', 'to'):
        if value.get(key) is not None:
            out[key] = want_time(where, 'window ' + key, value[key])
    return out or None


def check_hours(where, value):
    if value is None:
        return None
    if not isinstance(value, dict):
        problem('%s: hours must be an object with week, source and verified' % where)
        return None
    extra = set(value) - {'source', 'verified', 'raw', 'week', 'lastEntry'}
    if extra:
        problem('%s: hours has no %s' % (where, ', '.join(sorted(extra))))
    out = {}
    source = value.get('source', 'chat')
    if source not in HOURS_SOURCES:
        problem('%s: hours source must be one of %s' % (where, ', '.join(HOURS_SOURCES)))
    out['source'] = source
    if 'verified' in value and not isinstance(value['verified'], bool):
        problem('%s: hours verified must be true or false' % where)
    out['verified'] = value.get('verified') is True
    if value.get('raw') is not None:
        out['raw'] = want_str(where, 'hours raw', value['raw'], 200) or ''
    week = value.get('week') or {}
    if not isinstance(week, dict):
        problem('%s: hours week must be an object keyed mon to sun' % where)
        week = {}
    bad = set(week) - set(WEEK)
    if bad:
        problem('%s: hours week has no day called %s' % (where, ', '.join(sorted(bad))))
    out_week = {}
    for day in WEEK:
        if day not in week:
            continue
        spans = week[day]
        if spans is None:
            continue
        if not isinstance(spans, list):
            problem('%s: hours for %s must be a list of ["open","close"] pairs, or [] for closed'
                    % (where, day))
            continue
        kept = []
        for span in spans:
            if not isinstance(span, list) or len(span) != 2:
                problem('%s: an opening time on %s must be a pair like ["09:00","17:00"]' % (where, day))
                continue
            a = want_time(where, 'hours ' + day, span[0])
            b = want_time(where, 'hours ' + day, span[1])
            if a and b:
                kept.append([a, b])
        kept.sort()
        out_week[day] = kept
    out['week'] = out_week
    last = value.get('lastEntry') or {}
    if not isinstance(last, dict):
        problem('%s: hours lastEntry must be an object keyed mon to sun' % where)
        last = {}
    out_last = {}
    for day, when in last.items():
        if day not in WEEK:
            problem('%s: hours lastEntry has no day called %s' % (where, day))
            continue
        when = want_time(where, 'lastEntry ' + day, when)
        if when and out_week.get(day):
            out_last[day] = when
        elif when:
            warn('%s: a last entry for %s with no opening times is dropped' % (where, day))
    out['lastEntry'] = out_last
    if not out_week and not out.get('raw'):
        problem('%s: these hours say nothing — give a week, or leave hours out' % where)
    return out


def check_links(where, value):
    if not isinstance(value, list):
        problem('%s: links must be a list' % where)
        return None
    out = []
    for link in value:
        if isinstance(link, str):
            link = {'url': link}
        if not isinstance(link, dict) or not isinstance(link.get('url'), str):
            problem('%s: every link needs a url' % where)
            continue
        if not re.match(r'^https?://', link['url'], re.I):
            problem('%s: a link must start with http:// or https:// — %r' % (where, link['url']))
            continue
        label = link.get('label') or re.sub(r'^www\.', '', link['url'].split('/')[2])
        out.append({'url': link['url'], 'label': label})
    if len(out) > 8:
        warn('%s: only the first 8 links are kept' % where)
        out = out[:8]
    return out


def check_price(where, value):
    if value is None or isinstance(value, (int, float, str)):
        return value
    if not isinstance(value, dict):
        problem('%s: price must be a number, some text, or {"amount":…,"currency":…}' % where)
        return None
    if value.get('amount') is None:
        return {'text': want_str(where, 'price text', value.get('text', ''), 80) or ''}
    if not isinstance(value['amount'], (int, float)):
        problem('%s: price amount must be a number' % where)
    currency = value.get('currency')
    if currency is not None and not (isinstance(currency, str) and len(currency) == 3):
        problem('%s: price currency must be a three-letter code like "JPY"' % where)
    return {k: v for k, v in value.items() if k in ('amount', 'currency', 'per')}


def check_place(raw, their_places):
    if not isinstance(raw, dict):
        problem('Every entry in places must be an object')
        return None
    pid = raw.get('id')
    if not isinstance(pid, str) or not ID_RE.match(pid):
        problem('A place needs an id: lower case, digits and hyphens, like "fushimi-inari" (got %r)' % pid)
        return None
    where = 'place "%s"' % pid
    for key in raw:
        if key in NOT_YOURS:
            problem('%s: never send %s — %s' % (where, key, NOT_YOURS[key]))
        elif key not in PLACE_KEYS:
            problem('%s: there is no place field called %s' % (where, key))

    out = {'id': pid}
    if 'name' in raw:
        out['name'] = want_str(where, 'name', raw['name'], 120)
    if 'localName' in raw:
        out['localName'] = want_str(where, 'localName', raw['localName'], 120)
    if 'area' in raw:
        out['area'] = want_str(where, 'area', raw['area'], 60)
    if 'check' in raw:
        out['check'] = want_str(where, 'check', raw['check'], 300)
    if 'note' in raw:
        out['note'] = want_str(where, 'note', raw['note'], 2000)

    lat, lng = raw.get('lat'), raw.get('lng', raw.get('lon'))
    if (lat is None) != (lng is None):
        problem('%s: a position needs both lat and lng' % where)
    elif lat is not None:
        if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
            problem('%s: lat and lng must be numbers' % where)
        elif abs(lat) > 90 or abs(lng) > 180:
            problem('%s: lat %s, lng %s is not anywhere on Earth' % (where, lat, lng))
        else:
            out['lat'], out['lng'] = lat, lng

    if 'kind' in raw:
        if raw['kind'] not in KINDS:
            problem('%s: kind must be one of %s' % (where, ', '.join(KINDS)))
        else:
            out['kind'] = raw['kind']
    if 'priority' in raw:
        if raw['priority'] not in PRIORITIES and raw['priority'] is not None:
            problem('%s: priority must be must, want or maybe' % where)
        else:
            out['priority'] = raw['priority']
    if 'booked' in raw:
        if not isinstance(raw['booked'], bool):
            problem('%s: booked must be true or false' % where)
        else:
            out['booked'] = raw['booked']
    if 'duration' in raw:
        d = raw['duration']
        if not isinstance(d, (int, float)):
            problem('%s: duration must be a number of minutes' % where)
        elif d < 0 or d > MAX_DURATION:
            problem('%s: duration must be between 0 and %d minutes' % (where, MAX_DURATION))
        else:
            rounded = int(round(d / 15.0) * 15)
            if rounded != d:
                warn('%s: duration %s becomes %d — the planner works in 15-minute steps'
                     % (where, d, rounded))
            out['duration'] = rounded
    if 'fixed' in raw:
        out['fixed'] = want_time(where, 'fixed', raw['fixed']) if raw['fixed'] else raw['fixed']
    if 'window' in raw:
        out['window'] = check_window(where, raw['window']) if raw['window'] else raw['window']
    if 'hours' in raw:
        out['hours'] = check_hours(where, raw['hours'])
    if 'closed' in raw:
        if not isinstance(raw['closed'], list):
            problem('%s: closed must be a list of dates' % where)
        else:
            out['closed'] = [want_date(where, 'closed', c) for c in raw['closed']]
    if 'price' in raw:
        out['price'] = check_price(where, raw['price'])
    if 'links' in raw:
        out['links'] = check_links(where, raw['links'])
    if 'osm' in raw:
        o = raw['osm']
        if not isinstance(o, dict) or o.get('type') not in OSM_TYPES or not isinstance(o.get('id'), int):
            problem('%s: osm must be {"type":"node","id":123} with type node, way or relation' % where)
        else:
            out['osm'] = {'type': o['type'], 'id': o['id']}
    if 'dayId' in raw:
        out['dayId'] = want_date(where, 'dayId', raw['dayId']) if raw['dayId'] else raw['dayId']

    if pid not in their_places:
        near = [i for i in their_places if close_enough(i, pid)]
        if near:
            problem('%s: the trip already has "%s". If you mean that place, use its id exactly; '
                    'ids are never renamed' % (where, near[0]))
    return out


def close_enough(a, b):
    """Near-miss ids, because a new place with an almost-right id silently splits one in two."""
    if a == b or abs(len(a) - len(b)) > 2:
        return False
    if a.replace('-', '') == b.replace('-', ''):
        return True
    short, long = (a, b) if len(a) < len(b) else (b, a)
    if len(short) >= 6 and short in long:
        return True
    pairs = lambda s: {s[i:i + 3] for i in range(len(s) - 2)}
    pa, pb = pairs(a), pairs(b)
    return bool(pa) and len(pa & pb) >= max(len(pa), len(pb)) - 1


def check_days(raw, places_by_id, their_days):
    if not isinstance(raw, dict):
        problem('days must be an object keyed by date')
        return {}
    out = {}
    for key, day in raw.items():
        if not isinstance(day, dict):
            problem('day "%s" must be an object' % key)
            continue
        date = day.get('id') or day.get('date') or key
        if not want_date('day "%s"' % key, 'date', date):
            continue
        where = 'day %s' % fmt_date(date)
        for field in day:
            if field in DAY_NOT_YOURS:
                problem('%s: never send %s — %s' % (where, field, DAY_NOT_YOURS[field]))
            elif field not in ('id', 'date', 'plans'):
                problem('%s: there is no day field called %s that you may send' % (where, field))
        plans = day.get('plans')
        if not isinstance(plans, dict):
            problem('%s: it needs plans, with less, balanced or packed' % where)
            continue
        kept = {}
        for version, order in plans.items():
            if version not in PLAN_KEYS:
                problem('%s: there is no version called %s — it is less, balanced or packed'
                        % (where, version))
                continue
            if not isinstance(order, list) or not all(isinstance(i, str) for i in order):
                problem('%s: the %s order must be a list of place ids' % (where, version))
                continue
            for pid in order:
                if pid not in places_by_id:
                    problem('%s: the %s order names "%s", which is not in places. Add at least '
                            '{"id": "%s"} or the stop is dropped' % (where, version, pid, pid))
                else:
                    stated = places_by_id[pid].get('dayId')
                    if stated and stated != date:
                        problem('%s: it lists "%s" in the %s order, but that place says dayId %s. '
                                'Send one or the other' % (where, pid, version, stated))
            kept[version] = order
        out[date] = {'id': date, 'plans': kept}
    for date in out:
        if date not in their_days:
            warn('%s is not a day of their trip yet, so the package creates it'
                 % fmt_date(date))
    return out


# ---------- what it will do ----------

def their_fields(place):
    f = {'pos': {'lat': place.get('lat'), 'lng': place.get('lng')}}
    for key in FIELD_LABEL:
        if key != 'pos':
            f[key] = place.get(key)
    if f['pos']['lat'] is None and f['pos']['lng'] is None:
        f['pos'] = None
    return f


def our_fields(place):
    """Only the fields we actually said something about, in the planner's own shape."""
    f = {}
    if 'lat' in place:
        f['pos'] = {'lat': place['lat'], 'lng': place['lng']}
    for key in FIELD_LABEL:
        if key not in ('pos',) and key in place:
            f[key] = place[key]
    return f


def predict(places, days, their_trip, base_trip):
    their_places = as_map(their_trip.get('places'))
    their_days = as_map(their_trip.get('days'))
    base_places = as_map((base_trip or {}).get('places'))
    base_days = as_map((base_trip or {}).get('days'))

    # Naming a place in a running order says which day it is on, so a new place lands there
    # rather than in the backlog.
    from_order = {}
    for date in sorted(days):
        for key in PLAN_KEYS:
            for pid in days[date]['plans'].get(key) or []:
                from_order.setdefault(pid, date)

    new, quiet, asks, nothing, moot = [], [], [], [], []
    for place in places:
        pid = place['id']
        theirs = their_places.get(pid)
        if not theirs:
            new.append((pid, place.get('name') or pid, place.get('dayId') or from_order.get(pid)))
            continue
        mineF, theirsF = their_fields(theirs), our_fields(place)
        baseF = their_fields(base_places[pid]) if pid in base_places else None
        lands, questions, restated, ignored = [], [], [], []
        for key, value in theirsF.items():
            mine = mineF.get(key)
            base = baseF.get(key) if baseF else None
            if key == 'hours' and same(hours_times(mine), hours_times(value)) and not same(mine, value):
                if (value or {}).get('verified') and not (mine or {}).get('verified'):
                    lands.append('Opening hours confirmed')
                else:
                    restated.append('Opening hours')
                continue
            verdict = three_way(mine, value, base)
            if verdict == 'question':
                questions.append((FIELD_LABEL[key], mine, value))
            elif same(mine, value):
                restated.append(FIELD_LABEL[key])
            elif verdict == 'quiet':
                lands.append(FIELD_LABEL[key])
            else:
                # They match the baseline, so the planner reads ours as nothing new and keeps
                # theirs. Most often an empty field meant to take something back that was never
                # ours to take back.
                ignored.append(FIELD_LABEL[key])
        if questions:
            asks.append((pid, theirs.get('name') or pid, questions))
        if lands:
            quiet.append((pid, theirs.get('name') or pid, lands))
        if ignored:
            moot.append((pid, theirs.get('name') or pid, ignored))
        if restated and not lands and not questions and not ignored:
            nothing.append((pid, theirs.get('name') or pid, restated))

    day_asks, day_quiet, day_new, day_moot = [], [], [], []
    for date, day in sorted(days.items()):
        theirs = their_days.get(date)
        if not theirs:
            day_new.append(date)
            continue
        mine = {k: (theirs.get('plans') or {}).get(k) or [] for k in PLAN_KEYS}
        ours = {k: day['plans'].get(k, mine[k]) for k in PLAN_KEYS}
        if same(mine, ours):
            continue
        base = None
        if date in base_days:
            base = {k: (base_days[date].get('plans') or {}).get(k) or [] for k in PLAN_KEYS}
        verdict = three_way(mine, ours, base)
        {'question': day_asks, 'quiet': day_quiet, 'nothing': day_moot}[verdict].append(
            (date, mine, ours))

    return {'new': new, 'quiet': quiet, 'asks': asks, 'nothing': nothing, 'moot': moot,
            'day_new': day_new, 'day_quiet': day_quiet, 'day_asks': day_asks,
            'day_moot': day_moot}


def report(p, has_base):
    print('WHAT THIS PACKAGE WILL DO')
    print('=' * 72)
    for pid, name, dayId in p['new']:
        print('  NEW    %-24s arrives as a new place, %s'
              % (pid, 'on ' + fmt_date(dayId) if dayId else 'in the backlog'))
    for date in p['day_new']:
        print('  NEW    %-24s a day their trip does not have yet' % fmt_date(date))
    for pid, name, fields in p['quiet']:
        print('  FILLS  %-24s %s' % (pid, ', '.join(fields)))
    for date, mine, ours in p['day_quiet']:
        print('  FILLS  %-24s its running order' % fmt_date(date))
    for pid, name, fields in p['nothing']:
        print('  SAME   %-24s %s — they already have it, so leave it out next time'
              % (pid, ', '.join(fields)))
    for date, mine, ours in p['day_moot']:
        print('  NO USE %-24s its running order — they have re-sequenced it since, and that stands'
              % fmt_date(date))
    for pid, name, fields in p['moot']:
        print('  NO USE %-24s %s — theirs stands and yours is dropped. An empty field only takes '
              'back what one of your own packages put there' % (pid, ', '.join(fields)))

    count = len(p['asks']) + len(p['day_asks'])
    print()
    if not count:
        print('  NOTHING TO SETTLE. It all lands without a question.')
    else:
        print('  THEY WILL BE ASKED %d question(s), one per place or day:' % count)
        for pid, name, fields in p['asks']:
            print('    %s' % name)
            for label, mine, ours in fields:
                print('      %-16s theirs %s   vs   yours %s'
                      % (label, value_text(mine), value_text(ours)))
        for date, mine, ours in p['day_asks']:
            print('    %s' % fmt_date(date))
            for key in PLAN_KEYS:
                if mine[key] != ours[key]:
                    print('      %-16s theirs %s   vs   yours %s'
                          % (PLAN_LABEL[key], ' → '.join(mine[key]) or '(empty)',
                             ' → '.join(ours[key]) or '(empty)'))
        if not has_base:
            print()
            print('  This is the worst case: no --base was given, so anything they have set and you')
            print('  disagree with counts as a question. With the package you last sent as --base,')
            print('  some of these would land quietly.')


def main():
    ap = argparse.ArgumentParser(description='Build a day-planner/2 package and say what it will do.')
    ap.add_argument('--trip', help='their save, package or hand-back. Leave it out only when they '
                                   'have no trip yet and this package is to create one')
    ap.add_argument('--plan', required=True, help='your plan.json')
    ap.add_argument('--out', default='package.txt', help='where to write the block')
    ap.add_argument('--base', help='the package you last sent, for a sharper prediction')
    ap.add_argument('--label', help='the label for this block, overriding the plan')
    ap.add_argument('--at', help='ISO timestamp for the envelope')
    args = ap.parse_args()

    fresh = not args.trip
    if fresh:
        their_trip = {'id': None, 'places': [], 'days': {}}
    else:
        their_env = payload(load(args.trip))
        their_trip = their_env.get('trip')
        if not isinstance(their_trip, dict):
            die('%s has no trip in it.' % args.trip)
    base_trip = None
    if args.base:
        base_env = payload(load(args.base))
        base_trip = base_env.get('trip')

    with open(args.plan, encoding='utf-8') as fh:
        try:
            plan = json.load(fh)
        except json.JSONDecodeError as e:
            die('%s is not valid JSON: %s' % (args.plan, e))
    if not isinstance(plan, dict):
        die('%s must be an object.' % args.plan)

    for key in plan:
        if key == 'title' and not fresh:
            problem('The plan has "title". A trip\'s title belongs to the owner; call it "label" '
                    'if you mean the name of this block.')
        elif key == 'title':
            continue          # a trip that does not exist yet has no name of theirs to overwrite
        elif key not in ('tripId', 'label', 'places', 'days'):
            problem('The plan has no field called "%s" — it takes tripId, label, places and days.' % key)

    their_places = as_map(their_trip.get('places'))
    their_days = as_map(their_trip.get('days'))

    trip_id = plan.get('tripId') or their_trip.get('id')
    if fresh and not trip_id:
        problem('With no --trip to merge into, the plan must give a tripId: a slug of its own, '
                'like "kyoto-november".')
    elif fresh:
        their_trip['id'] = trip_id
    elif trip_id != their_trip.get('id'):
        problem('tripId is "%s" but their trip is "%s". A different id is read as a different trip.'
                % (trip_id, their_trip.get('id')))

    raw_places = plan.get('places') or []
    if not isinstance(raw_places, list):
        problem('places must be a list.')
        raw_places = []
    places = [p for p in (check_place(r, their_places) for r in raw_places) if p]
    seen = {}
    for place in places:
        if place['id'] in seen:
            problem('place "%s" appears twice in the plan' % place['id'])
        seen[place['id']] = place

    days = check_days(plan.get('days') or {}, seen, their_days)

    if not places and not days:
        problem('The plan says nothing: no places and no days.')

    if PROBLEMS:
        print('REFUSED — nothing was written')
        print('=' * 72)
        for text in PROBLEMS:
            print('  %s' % text)
        print('\n%d problem(s). Fix them and run it again.' % len(PROBLEMS))
        return 1

    if fresh:
        print('NO TRIP TO MERGE INTO')
        print('=' * 72)
        print('  This package creates the trip. Everything in it arrives as new, and nothing can')
        print('  be asked about. Tell them to add where they are staying in the app: the planner')
        print('  takes each day\'s start and end from that, and until it has one every day begins')
        print('  at 08:30 from nowhere in particular.')
        print()
    report(predict(places, days, their_trip, base_trip), bool(base_trip))

    if WARNINGS:
        print('\nWORTH KNOWING')
        print('=' * 72)
        for text in WARNINGS:
            print('  %s' % text)

    env = {
        'schema': SCHEMA, 'kind': 'package', 'tripId': trip_id,
        'title': args.label or plan.get('label') or 'From the chat',
        'at': args.at or '',
        'app': 'chat',
        'trip': {'id': trip_id},
    }
    if fresh and plan.get('title'):
        env['trip']['title'] = plan['title']
    if not env['at']:
        from datetime import datetime, timezone
        env['at'] = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    if places:
        env['trip']['places'] = places
    if days:
        env['trip']['days'] = days

    block = ('--- BEGIN day-planner/2 ---\n'
             + json.dumps(env, ensure_ascii=False, separators=(',', ':'))
             + '\n--- END day-planner/2 ---\n')
    with open(args.out, 'w', encoding='utf-8') as fh:
        fh.write(block)
    print('\nWritten to %s — %d place(s), %d day(s), %d bytes.'
          % (args.out, len(places), len(days), len(block.encode('utf-8'))))
    print('Give them the whole block, both marker lines included.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
