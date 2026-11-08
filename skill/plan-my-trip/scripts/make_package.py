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
import subprocess
import sys
import tempfile

# The scripts sit beside each other, and a script's own folder is not on the path under `python -I`.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

NODE = os.environ.get('NODE', 'node')

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

VERSION = '2.0.0'          # the planner this skill carries; see vendor/core.js
PLACE_KEYS = ['id', 'name', 'localName', 'lat', 'lng', 'lon', 'kind', 'area', 'duration', 'fixed',
              'window', 'hours', 'closed', 'booked', 'priority', 'price', 'check', 'note', 'links',
              'osm', 'dayId']
STAY_KEYS = ['id', 'name', 'localName', 'lat', 'lng', 'lon', 'area', 'from', 'nights', 'note', 'osm']
PLACE_MERGE = ['pos', 'name', 'localName', 'kind', 'area', 'duration', 'fixed', 'window', 'hours',
               'closed', 'booked', 'priority', 'price', 'check', 'note', 'links', 'osm', 'dayId']
STAY_MERGE = ['pos', 'name', 'localName', 'area', 'from', 'nights', 'note', 'osm']
# Fields the merge compares, in the planner's own words.
FIELD_LABEL = {
    'pos': 'Position', 'name': 'Name', 'localName': 'Local name', 'kind': 'Kind', 'area': 'Area',
    'duration': 'How long', 'fixed': 'Fixed time', 'window': 'Time window', 'hours': 'Opening hours',
    'closed': 'Closed dates', 'booked': 'Booked', 'priority': 'Priority', 'price': 'Price',
    'check': 'Check', 'note': 'Note', 'links': 'Links', 'osm': 'OpenStreetMap', 'dayId': 'Which day',
    'from': 'First night', 'nights': 'Nights',
    'plans': 'Running order', 'start': 'Where the day starts', 'end': 'Where the day ends',
}
NOT_YOURS = {
    'added': 'the planner\'s own bookkeeping',
    'createdAt': 'the planner\'s own bookkeeping',
    'updatedAt': 'the planner\'s own bookkeeping',
    'title': 'the trip\'s name is a setting of theirs. Use "label" at the top of the plan for this block\'s label',
    'tz': 'a trip setting of theirs', 'tzLabel': 'a trip setting of theirs',
    'transit': 'a trip setting of theirs', 'currency': 'a trip setting of theirs',
    'lookups': 'a trip setting of theirs', 'fx': 'a trip setting of theirs',
    'backlog': 'worked out from which places have no day',
}
# A day carries only its id and its running orders. Everything else about it is the owner's.
DAY_NOT_YOURS = dict(NOT_YOURS, **{
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


# ---------- checking the plan ----------

def want_str(where, key, value, limit):
    if value is None:
        return ''          # `null` and `""` are the same statement: there is none
    if not isinstance(value, str):
        problem('%s: %s must be text, or null to say there is none' % (where, key))
        return None
    if len(value) > limit:
        warn('%s: %s is longer than %d characters and will be cut' % (where, key, limit))
    return value


def want_time(where, key, value):
    if not isinstance(value, str) or not TIME_RE.match(value):
        extra = (' For a place that never shuts, the day is [["00:00","23:59"]]; "24:00" is read '
                 'as midnight at the start of the day.' if value in ('24:00', '24:00:00') else '')
        problem('%s: %s must be a 24-hour time like "09:30", not %r.%s' % (where, key, value, extra))
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


def check_place(raw, their_places, deleted=None):
    if not isinstance(raw, dict):
        problem('Every entry in places must be an object')
        return None
    pid = raw.get('id')
    if not isinstance(pid, str) or not ID_RE.match(pid):
        problem('A place needs an id: lower case, digits and hyphens, like "fushimi-inari" (got %r)' % pid)
        return None
    where = 'place "%s"' % pid
    if (deleted or {}).get(pid) and raw.get('restore') is not True:
        problem('%s: they deleted "%s" since your last package. Sending it again puts it back in '
                'front of them, and where the planner has no baseline it simply returns. Leave it '
                'out, or add "restore": true if you really mean to bring it back'
                % (where, deleted[pid]))
    for key in raw:
        if key == 'restore':
            continue
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


def check_stay(raw, their_stays):
    """Where they sleep. Theirs to decide, but you may carry what they have told you — and a
    placeholder for what is not booked yet, as long as its name says so."""
    if not isinstance(raw, dict):
        problem('Every entry in stays must be an object')
        return None
    sid = raw.get('id')
    if not isinstance(sid, str) or not ID_RE.match(sid):
        problem('A stay needs an id: lower case, digits and hyphens, like "kagurazaka-base" (got %r)' % sid)
        return None
    where = 'stay "%s"' % sid
    fresh = sid not in their_stays
    for key in raw:
        if key in NOT_YOURS:
            problem('%s: never send %s — %s' % (where, key, NOT_YOURS[key]))
        elif key not in STAY_KEYS:
            problem('%s: there is no stay field called %s' % (where, key))

    out = {'id': sid}
    if 'name' in raw:
        out['name'] = want_str(where, 'name', raw['name'], 120)
    elif fresh:
        warn('%s: it has no name, so the planner will call it "%s"' % (where, sid))
    if 'localName' in raw:
        out['localName'] = want_str(where, 'localName', raw['localName'], 120)
    if 'area' in raw:
        out['area'] = want_str(where, 'area', raw['area'], 80)
    if 'note' in raw:
        out['note'] = want_str(where, 'note', raw['note'], 500)
    if 'from' in raw:
        out['from'] = want_date(where, 'from', raw['from'])
    elif fresh:
        problem('%s: a new stay needs "from", the date of its first night. Without one the planner '
                'leaves it out altogether' % where)
    if 'nights' in raw:
        n = raw['nights']
        if not isinstance(n, int) or isinstance(n, bool) or n < 1 or n > 60:
            problem('%s: nights must be a whole number from 1 to 60' % where)
        else:
            out['nights'] = n
    elif fresh:
        problem('%s: a new stay needs "nights"' % where)

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
    elif fresh:
        warn('%s: no position, so every day it anchors loses its travel times — the planner cannot '
             'measure from nowhere. An approximate one for the district is better than none'
             % where)

    if 'osm' in raw:
        o = raw['osm']
        if not isinstance(o, dict) or o.get('type') not in OSM_TYPES or not isinstance(o.get('id'), int):
            problem('%s: osm must be {"type":"node","id":123} with type node, way or relation' % where)
        else:
            out['osm'] = {'type': o['type'], 'id': o['id']}
    return out


def nights_of(stay):
    """The days a stay touches: its nights, plus the morning they check out."""
    from datetime import date, timedelta
    try:
        first = date.fromisoformat(stay['from'])
    except (KeyError, TypeError, ValueError):
        return []
    return [(first + timedelta(days=i)).isoformat() for i in range(int(stay.get('nights') or 1) + 1)]


def dates_text(dates):
    """A run of dates as "21–27 Nov", so a sixteen-night trip does not print sixteen dates."""
    from datetime import date, timedelta
    runs, run = [], None
    for iso in sorted(dates):
        try:
            d = date.fromisoformat(iso)
        except ValueError:
            continue
        if run and d - run[1] == timedelta(days=1):
            run[1] = d
            continue
        if run:
            runs.append(run)
        run = [d, d]
    if run:
        runs.append(run)
    out = []
    for a, b in runs:
        out.append(fmt_date(a.isoformat()) if a == b
                   else '%s–%s' % (fmt_date(a.isoformat()), fmt_date(b.isoformat())))
    return ', '.join(out)


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


def check_point(where, what, value):
    """Where a day begins or ends: a name, a position and a time, any of which may be left out."""
    if value is None:
        return None
    if not isinstance(value, dict):
        problem('%s: %s must be {"name": ..., "lat": ..., "lng": ..., "time": "HH:MM"}' % (where, what))
        return None
    extra = set(value) - {'name', 'localName', 'lat', 'lng', 'lon', 'time'}
    if extra:
        problem('%s: %s has no %s' % (where, what, ', '.join(sorted(extra))))
    out = {}
    if 'name' in value:
        out['name'] = want_str(where, what + ' name', value['name'], 80)
    if 'localName' in value:
        out['localName'] = want_str(where, what + ' localName', value['localName'], 80)
    if 'time' in value:
        out['time'] = want_time(where, what + ' time', value['time'])
    lat, lng = value.get('lat'), value.get('lng', value.get('lon'))
    if (lat is None) != (lng is None):
        problem('%s: %s needs both lat and lng, or neither' % (where, what))
    elif lat is not None:
        if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
            problem('%s: %s lat and lng must be numbers' % (where, what))
        elif abs(lat) > 90 or abs(lng) > 180:
            problem('%s: %s is not anywhere on Earth' % (where, what))
        else:
            out['lat'], out['lng'] = lat, lng
    if out.get('name') and 'lat' not in out:
        warn('%s: %s has a name but no position, so the leg to or from it cannot be estimated'
             % (where, what))
    return out or None


def anchored(date, which, stays):
    """The stay the planner will use for a day's start or end, if any. A day starts at the stay of
    the night before and ends at the stay of that night, so the place a package sends for an
    anchored day is ignored — only its time is used."""
    from datetime import date as D, timedelta
    best = None
    for s in stays:
        try:
            first = D.fromisoformat(s['from'])
        except (KeyError, TypeError, ValueError):
            continue
        nights = int(s.get('nights') or 1)
        span = ((first + timedelta(days=1), first + timedelta(days=nights)) if which == 'start'
                else (first, first + timedelta(days=nights - 1)))
        try:
            day = D.fromisoformat(date)
        except ValueError:
            return None
        if span[0] <= day <= span[1] and (best is None or s['from'] > best['from']):
            best = s
    return best


LEG_MODES = ['walk', 'transit', 'car']


def check_legs(where, value, known):
    """Travel times the chat looked up. Only `chat` with a link, because a measurement is the
    planner's own and a time with nowhere it was read cannot be checked by anybody."""
    if not isinstance(value, dict):
        problem('%s: legs must be an object keyed "fromId>toId"' % where)
        return None
    out = {}
    for key, raw in value.items():
        ends = str(key).split('>')
        if len(ends) != 2 or not all(ends):
            problem('%s: "%s" is not a leg — the key is "fromId>toId", where an end of the day is '
                    '"start" or "end"' % (where, key))
            continue
        for end in ends:
            if end not in known:
                problem('%s: the leg "%s" names "%s", which is not a place of this trip'
                        % (where, key, end))
        if not isinstance(raw, dict):
            problem('%s: the leg "%s" must be an object' % (where, key))
            continue
        extra = set(raw) - {'mode', 'minutes', 'source', 'link', 'name', 'detail', 'departs', 'km'}
        if extra:
            problem('%s: the leg "%s" has no %s' % (where, key, ', '.join(sorted(extra))))
        if raw.get('source') != 'chat':
            problem('%s: the leg "%s" must say "source": "chat". A package claiming to be osrm, '
                    'transitous or stops is thrown away — those mean a service measured it'
                    % (where, key))
        link = raw.get('link')
        if not isinstance(link, str) or not re.match(r'^https?://', link, re.I):
            problem('%s: the leg "%s" needs "link", the page you read the time from. One with '
                    'nowhere it came from is dropped' % (where, key))
        if raw.get('mode') not in LEG_MODES:
            problem('%s: the leg "%s" needs a mode: %s' % (where, key, ', '.join(LEG_MODES)))
        minutes = raw.get('minutes')
        if not isinstance(minutes, int) or isinstance(minutes, bool) or minutes < 0 or minutes > 1440:
            problem('%s: the leg "%s" needs "minutes", a whole number up to 1440' % (where, key))
        for word in ('name', 'detail', 'departs'):
            if word in raw:
                want_str('%s leg "%s"' % (where, key), word, raw[word], 300)
        out[key] = {k: v for k, v in raw.items() if k != 'km' or isinstance(v, (int, float))}
    return out or None


def check_days(raw, places_by_id, their_days, all_stays, known_places):
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
            elif field not in ('id', 'date', 'plans', 'start', 'end', 'legs'):
                problem('%s: there is no day field called %s that you may send' % (where, field))
        entry = {'id': date}
        for which in ('start', 'end'):
            if which not in day:
                continue
            point = check_point(where, which, day[which])
            if point is None and day[which] is not None:
                continue
            entry[which] = point
            holder = anchored(date, which, all_stays)
            if holder and point and (point.get('name') or point.get('lat') is not None):
                warn('%s: its %s is anchored by the stay "%s", so the place you sent is ignored — '
                     'only the time is used. Send just the time here' % (where, which, holder['id']))
        if 'legs' in day:
            legs = check_legs(where, day['legs'], known_places | {'start', 'end'})
            if legs:
                entry['legs'] = legs
        plans = day.get('plans')
        if plans is None and len(entry) > 1:
            out[date] = entry
            continue
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
        entry['plans'] = kept
        out[date] = entry
    for date in out:
        if date not in their_days:
            warn('%s is not a day of their trip yet, so the package creates it'
                 % fmt_date(date))
    return out


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
        elif key not in ('tripId', 'label', 'places', 'days', 'stays'):
            problem('The plan has no field called "%s" — it takes tripId, label, places, days and '
                    'stays.' % key)

    their_places = as_map(their_trip.get('places'))
    their_days = as_map(their_trip.get('days'))
    # A hand-back says what they deleted. Sending one of those back puts it in front of them
    # again, and where the planner has no baseline it simply reappears.
    deleted = {}
    if not fresh:
        for gone in ((their_env.get('handback') or {}).get('changes') or {}).get('deleted') or []:
            if isinstance(gone, dict) and gone.get('id'):
                deleted[gone['id']] = gone.get('name') or gone['id']
        written_by = str(their_env.get('app') or '')
        mine_version = tuple(int(n) for n in VERSION.split('.'))
        theirs = re.search(r'(\d+)\.(\d+)\.(\d+)', written_by)
        if theirs and tuple(int(n) for n in theirs.groups()) > mine_version:
            warn('%s was written by planner %s, and this skill carries %s. Anything it has learned '
                 'since is not in here, so check what it says against the app'
                 % (args.trip, theirs.group(0), VERSION))

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
    places = [p for p in (check_place(r, their_places, deleted) for r in raw_places) if p]
    seen = {}
    for place in places:
        if place['id'] in seen:
            problem('place "%s" appears twice in the plan' % place['id'])
        seen[place['id']] = place

    their_stays = as_map(their_trip.get('stays'))
    raw_stays = plan.get('stays') or []
    if not isinstance(raw_stays, list):
        problem('stays must be a list.')
        raw_stays = []
    stays = [s for s in (check_stay(r, their_stays) for r in raw_stays) if s]
    # A day's start and end can be anchored by a stay, from this package or from their trip.
    anchors = {s['id']: s for s in their_stays.values()}
    for s in stays:
        anchors[s['id']] = dict(anchors.get(s['id']) or {}, **s)

    days = check_days(plan.get('days') or {}, seen, their_days, list(anchors.values()),
                      set(seen) | set(their_places))
    # A stay does not bring its days with it: the planner only creates those when the owner adds a
    # stay by hand. Nights with no day are nights nothing can be planned on.
    for stay in stays:
        missing = [d for d in nights_of(stay) if d not in days and d not in their_days]
        if missing:
            warn('stay "%s" covers %s; %s %s no day yet, here or in their trip. A package does '
                 'not create the days a stay touches — add them to "days" if you want them'
                 % (stay['id'], dates_text(nights_of(stay)), dates_text(missing),
                    'has' if len(missing) == 1 else 'have'))

    if not places and not days and not stays:
        problem('The plan says nothing: no places, no days and no stays.')

    if PROBLEMS:
        print('REFUSED — nothing was written')
        print('=' * 72)
        for text in PROBLEMS:
            print('  %s' % text)
        print('\n%d problem(s). Fix them and run it again.' % len(PROBLEMS))
        return 1

    fragment = {'id': trip_id}
    if fresh and plan.get('title'):
        fragment['title'] = plan['title']
    if places:
        fragment['places'] = places
    if days:
        fragment['days'] = days
    if stays:
        fragment['stays'] = stays

    if WARNINGS:
        print('WORTH KNOWING')
        print('=' * 72)
        for text in WARNINGS:
            print('  %s' % text)
        print()

    # The block itself, and what it will do, both come from the planner's own code. A prediction
    # made by anything else is a guess, and the one this script used to make disagreed with the
    # merge about questions, about a deleted place and about what landed quietly.
    here = os.path.dirname(os.path.abspath(__file__))
    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False, encoding='utf-8') as fh:
        json.dump(fragment, fh, ensure_ascii=False)
        frag_path = fh.name
    cmd = [NODE, os.path.join(here, 'write_package.js'),
           '--fragment', frag_path, '--out', args.out,
           '--label', args.label or plan.get('label') or 'From the chat']
    if args.at:
        cmd += ['--at', args.at]
    if args.trip:
        cmd += ['--trip', args.trip]
    if args.base:
        cmd += ['--base', args.base]
    try:
        done = subprocess.run(cmd, capture_output=True, text=True)
    except FileNotFoundError:
        os.unlink(frag_path)
        die('this needs node to write the block and work out what it will do, and there is no '
            '"%s" on the path. Everything above still stands: the plan itself is sound.' % NODE)
    os.unlink(frag_path)
    sys.stdout.write(done.stdout)
    sys.stderr.write(done.stderr)
    return done.returncode


if __name__ == '__main__':
    sys.exit(main())
