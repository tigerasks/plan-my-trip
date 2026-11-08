#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Read a plan-my-trip save, package or hand-back and print it in a form you can work from.

    python3 read_trip.py trip.json
    python3 read_trip.py -            # the block on standard input
    pbpaste | python3 read_trip.py -

It accepts a saved .json file, a pasted block between the day-planner/2 marker lines, or bare JSON,
with or without a code fence round it. The last thing it prints is a worklist: what to do next, in
the order worth doing it.
"""

import argparse
import json
import os
import re
import sys
from datetime import date

WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
WEEK_SHORT = {'mon': 'Mon', 'tue': 'Tue', 'wed': 'Wed', 'thu': 'Thu',
              'fri': 'Fri', 'sat': 'Sat', 'sun': 'Sun'}
MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
PLAN_KEYS = ['less', 'balanced', 'packed']
PLAN_LABEL = {'less': 'Do less', 'balanced': 'Balanced', 'packed': 'Packed'}

BEGIN_RE = re.compile(r'^\s*-{2,}\s*BEGIN\s+day-planner/(\d+)\s*-{2,}\s*$', re.I)
END_RE = re.compile(r'^\s*-{2,}\s*END\s+day-planner/(\d+)\s*-{2,}\s*$', re.I)
FENCE_RE = re.compile(r'^\s*```')


# ---------- getting at the JSON ----------

def payload(text):
    """Pull the envelope out of a block, a fenced block or bare JSON."""
    lines = text.splitlines()
    begin = end = -1
    version = None
    for i, line in enumerate(lines):
        m = BEGIN_RE.match(line)
        if m:
            begin, version = i, m.group(1)
            break
    if begin >= 0:
        if version != '2':
            die('That block says day-planner/%s. This planner speaks day-planner/2.' % version)
        for i in range(begin + 1, len(lines)):
            if END_RE.match(lines[i]):
                end = i
                break
        if end < 0:
            die('That block has no closing "--- END day-planner/2 ---" line, so it is cut off.')
        body = ''.join(l for l in lines[begin + 1:end] if not FENCE_RE.match(l))
    else:
        body = '\n'.join(l for l in lines if not FENCE_RE.match(l)).strip()
    if not body:
        die('There is no day-planner block and no JSON in that.')
    try:
        env = json.loads(body)
    except json.JSONDecodeError as e:
        die('The JSON is damaged: %s' % e)
    if not isinstance(env, dict):
        die('That is JSON, but not a day-planner envelope.')
    return env


def load(source):
    if source == '-':
        return sys.stdin.read()
    if os.path.exists(source):
        with open(source, encoding='utf-8') as fh:
            return fh.read()
    if '{' in source or 'day-planner' in source:
        return source
    die('No such file: %s' % source)


def canon(v):
    """The shape a checksum is taken over: keys in order, nothing else changed."""
    if isinstance(v, list):
        return [canon(x) for x in v]
    if isinstance(v, dict):
        return {k: canon(v[k]) for k in sorted(v)}
    return v


def checksum(env):
    """The planner's own hash, so a block that was changed on the way can be spotted here too."""
    body = {k: v for k, v in env.items() if k != 'sum'}
    text = json.dumps(canon(body), ensure_ascii=False, separators=(',', ':'))
    # JavaScript walks a string as UTF-16 code units, so anything outside the basic plane — an
    # emoji in a note — counts as two. Reading the same units here is what makes the two agree.
    units = text.encode('utf-16-le')
    h = 2166136261
    for i in range(0, len(units), 2):
        h ^= units[i] | (units[i + 1] << 8)
        h = (h * 16777619) & 0xFFFFFFFF
    return '%08x' % h


def die(message):
    print('Cannot read it: ' + message, file=sys.stderr)
    raise SystemExit(2)


# ---------- saying things in words ----------

def as_map(value, key='id'):
    """places and days may arrive as a list or as an object. Give me an object."""
    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            if isinstance(v, dict):
                out[v.get(key) or v.get('date') or k] = v
        return out
    if isinstance(value, list):
        return {v.get(key) or v.get('date') or str(i): v
                for i, v in enumerate(value) if isinstance(v, dict)}
    return {}


def fmt_date(iso):
    if not iso:
        return '(no date)'
    try:
        d = date.fromisoformat(str(iso)[:10])
    except ValueError:
        return str(iso)
    return '%s %d %s' % (DAY_NAMES[d.weekday()], d.day, MONTHS[d.month - 1])


def fmt_dur(minutes):
    if minutes is None:
        return '?'
    minutes = int(minutes)
    if minutes < 60:
        return '%dm' % minutes
    h, m = divmod(minutes, 60)
    return '%dh' % h if not m else '%dh %02d' % (h, m)


def spans_text(spans):
    if not spans:
        return 'closed'
    return ', '.join('%s-%s' % (s[0], s[1]) for s in spans if isinstance(s, list) and len(s) == 2)


def hours_line(hours):
    """The week in a line, consecutive days that agree grouped together."""
    if not isinstance(hours, dict):
        return ''
    week = hours.get('week') or {}
    known = [d for d in WEEK if isinstance(week.get(d), list)]
    if not known:
        return (hours.get('raw') or '').strip()
    if len(known) == 7 and all(week[d] == week[known[0]] for d in known):
        line = spans_text(week['mon'])
    else:
        runs, run = [], None
        for d in WEEK:
            text = spans_text(week[d]) if isinstance(week.get(d), list) else None
            if run and text == run[2]:
                run[1] = d
                continue
            if run:
                runs.append(run)
            run = None if text is None else [d, d, text]
        if run:
            runs.append(run)
        line = ' / '.join(
            (WEEK_SHORT[a] if a == b else '%s-%s' % (WEEK_SHORT[a], WEEK_SHORT[b])) + ' ' + t
            for a, b, t in runs)
    last = hours.get('lastEntry') or {}
    if last:
        line += ' (last entry ' + ', '.join('%s %s' % (WEEK_SHORT[d], last[d])
                                            for d in WEEK if last.get(d)) + ')'
    return line


def summary_text(summary):
    if not isinstance(summary, dict):
        return ''
    bits = ['%d stop(s)' % (summary.get('stops') or 0)]
    for key, word in (('visit', 'visiting'), ('travel', 'travelling'), ('wait', 'waiting')):
        if summary.get(key):
            bits.append('%s %s' % (fmt_dur(summary[key]), word))
    if summary.get('spare') is not None:
        bits.append('%s spare' % fmt_dur(summary['spare']))
    legs = (summary.get('estimated') or 0) + (summary.get('checked') or 0)
    if legs:
        bits.append('%d of %d leg(s) measured' % (summary.get('checked') or 0, legs))
    return ', '.join(bits)


def price_text(price):
    if price is None:
        return ''
    if isinstance(price, (int, float)):
        return str(price)
    if isinstance(price, str):
        return price
    if price.get('text'):
        return price['text']
    bits = [str(price.get('amount')), price.get('currency') or '']
    if price.get('per'):
        bits.append('(%s)' % price['per'])
    return ' '.join(b for b in bits if b)


# ---------- the trip ----------

def show_trip(trip):
    places = as_map(trip.get('places'))
    days = as_map(trip.get('days'))
    print('TRIP  %s  (id %s)' % (trip.get('title') or '(untitled)', trip.get('id')))
    bits = []
    for key, label in (('tz', 'time zone'), ('transit', 'getting around'), ('currency', 'currency')):
        if trip.get(key):
            bits.append('%s %s' % (label, trip[key]))
    if bits:
        print('      ' + ', '.join(bits))
    print('      %d day(s), %d place(s)' % (len(days), len(places)))

    stays = [s for s in (trip.get('stays') or []) if isinstance(s, dict)]
    if stays:
        print('\nSTAYS')
        for s in stays:
            print('  %-28s from %s, %s night(s)%s'
                  % (s.get('name') or s.get('id'), fmt_date(s.get('from')), s.get('nights'),
                     '  ' + s['area'] if s.get('area') else ''))

    if days:
        print('\nDAYS')
    for key in sorted(days):
        d = days[key]
        head = '  %s' % fmt_date(d.get('id') or d.get('date') or key)
        if d.get('city'):
            head += '  %s' % d['city']
        start, end = d.get('start') or {}, d.get('end') or {}
        times = []
        if start.get('time'):
            times.append('out %s%s' % (start['time'], ' from ' + start['name'] if start.get('name') else ''))
        if end and end.get('time'):
            times.append('back %s%s' % (end['time'], ' to ' + end['name'] if end.get('name') else ''))
        if times:
            head += '  (%s)' % '; '.join(times)
        if d.get('shown'):
            head += '  showing %s' % PLAN_LABEL.get(d['shown'], d['shown'])
        print(head)
        if d.get('note'):
            print('      note: %s' % d['note'])
        plans = d.get('plans') or {}
        on_day = [p for p in places.values() if p.get('dayId') == (d.get('id') or key)]
        date = d.get('id') or key
        for k in PLAN_KEYS:
            order = plans.get(k) or []
            names = ' -> '.join(in_order(places, pid, date) for pid in order) if order else '(empty)'
            print('      %-9s %s' % (PLAN_LABEL[k], names))
        shown = plans.get(d.get('shown') or 'balanced') or []
        spare = [p for p in on_day if p.get('id') not in shown]
        if spare:
            print('      ideas     %s' % ', '.join(p.get('name') or p.get('id') for p in spare))

    backlog = [pid for pid in (trip.get('backlog') or []) if pid in places]
    loose = [p['id'] for p in places.values() if not p.get('dayId') and p.get('id') not in backlog]
    if backlog or loose:
        print('\nBACKLOG')
        for pid in backlog + loose:
            print('  %s' % name_of(places, pid))

    if places:
        print('\nPLACES')
    for pid in sorted(places, key=lambda i: (places[i].get('dayId') or 'zzzz', i)):
        p = places[pid]
        head = '  %-22s %s' % (pid, p.get('name') or '')
        tags = [p.get('kind') or 'other', fmt_dur(p.get('duration'))]
        if p.get('dayId'):
            tags.append(fmt_date(p['dayId']))
        else:
            tags.append('backlog')
        if p.get('priority'):
            tags.append(p['priority'])
        if p.get('booked'):
            tags.append('BOOKED')
        if p.get('fixed'):
            tags.append('fixed ' + p['fixed'])
        window = p.get('window')
        if isinstance(window, dict) and window.get('from'):
            tags.append('window %s-%s' % (window.get('from'), window.get('to')))
        if p.get('lat') is None:
            tags.append('NO POSITION')
        print('%s  [%s]' % (head, ', '.join(str(t) for t in tags)))
        hours = p.get('hours')
        if hours:
            mark = 'verified' if hours.get('verified') else 'UNVERIFIED'
            print('      hours   %s  (%s, %s)' % (hours_line(hours) or '(nothing readable)',
                                                  hours.get('source') or '?', mark))
        else:
            print('      hours   none')
        if p.get('closed'):
            print('      closed  %s' % ', '.join(fmt_date(c) for c in p['closed']))
        if price_text(p.get('price')):
            print('      price   %s' % price_text(p.get('price')))
        if p.get('check'):
            print('      CHECK   %s' % p['check'])
        if p.get('note'):
            print('      note    %s' % one_line(p['note']))


def settle_days(trip):
    """Work out where places will actually land, the way the planner does.

    A package leaves `dayId` off the places it is not moving and lets the running orders say which
    day they are on. A `dayId` naming a day the trip does not have is no statement at all: the
    place goes to the backlog and its orders do not rescue it.
    """
    places, days = as_map(trip.get('places')), as_map(trip.get('days'))
    lost = set()
    for pid, place in places.items():
        day = place.get('dayId')
        if day and day not in days:
            place['dayId'] = None
            lost.add(pid)
    for date in sorted(days):
        for key in PLAN_KEYS:
            for pid in (days[date].get('plans') or {}).get(key) or []:
                place = places.get(pid)
                if place and not place.get('dayId') and pid not in lost:
                    place['dayId'] = date
    return lost


def in_order(places, pid, date):
    """A stop as it appears in a running order, saying so when the planner will drop it."""
    place = places.get(pid)
    if not place:
        return '%s (DROPPED: not in this package)' % pid
    if place.get('dayId') != date:
        where = fmt_date(place['dayId']) if place.get('dayId') else 'the backlog'
        return '%s (DROPPED: it is on %s)' % (place.get('name') or pid, where)
    return place.get('name') or pid


def name_of(places, pid):
    p = places.get(pid)
    return (p.get('name') or pid) if p else '%s (MISSING)' % pid


def one_line(text, limit=300):
    text = ' '.join(str(text).split())
    return text if len(text) <= limit else text[:limit - 1] + '…'


# ---------- the hand-back ----------

def show_handback(hb, trip):
    places = as_map(trip.get('places'))
    print('\n' + '=' * 72)
    print('WHAT THE PLANNER WORKED OUT')
    print('=' * 72)
    note = (hb.get('note') or '').strip()
    print('\nTHEIR NOTE')
    print('  %s' % (one_line(note, 2000) if note else '(they left it empty)'))

    for day in hb.get('days') or []:
        print('\n%s%s' % (fmt_date(day.get('date')), '  ' + day['city'] if day.get('city') else ''))
        if day.get('note'):
            print('  note: %s' % one_line(day['note']))
        for v in day.get('versions') or []:
            mark = '*' if v.get('key') == day.get('chosen') else ' '
            print('  %s %s  %s-%s  %s' % (mark, v.get('label') or v.get('key'),
                                          v.get('starts') or '?', v.get('finishes') or '?',
                                          summary_text(v.get('summary'))))
            for s in v.get('stops') or []:
                wait = '  waited %d min' % s['waited'] if s.get('waited') else ''
                print('      %s-%s  %-26s %s%s' % (s.get('at') or '??:??', s.get('until') or '??:??',
                                                   s.get('name') or s.get('id'),
                                                   fmt_dur(s.get('minutes')), wait))
            for issue in v.get('issues') or []:
                print('      [%s] %s' % ((issue.get('severity') or '?').upper(), issue.get('text')))
            for check in v.get('checks') or []:
                print('      [CHECK] %s: %s' % (check.get('name'), check.get('text')))

    ch = hb.get('changes') or {}
    print('\nWHAT THEY CHANGED')
    if not ch.get('baseline'):
        print('  %s' % (ch.get('why') or 'Nothing to compare against.'))
    else:
        shown = False
        for key, label in (('added', 'added'), ('deleted', 'deleted'), ('moved', 'moved'),
                           ('edited', 'edited'), ('orders', 'reordered')):
            for item in ch.get(key) or []:
                shown = True
                if key == 'moved':
                    print('  moved     %s: %s -> %s' % (item.get('name'), fmt_date(item.get('from')),
                                                        fmt_date(item.get('to'))))
                elif key == 'edited':
                    print('  edited    %s: %s' % (item.get('name'), ', '.join(item.get('fields') or [])))
                elif key == 'orders':
                    if item.get('added'):
                        print('  new day   %s' % fmt_date(item.get('date')))
                    else:
                        print('  reordered %s %s: %s' % (fmt_date(item.get('date')),
                                                         PLAN_LABEL.get(item.get('version'), item.get('version')),
                                                         ' -> '.join(name_of(places, i) for i in item.get('now') or [])))
                else:
                    print('  %-9s %s' % (label, item.get('name')))
        if not shown:
            print('  nothing since you were last in step')

    travel = hb.get('travel') or []
    if travel:
        print('\nTRAVEL THEY MEASURED')
        for leg in travel:
            ways = leg.get('ways') or {}
            bits = []
            for mode, slot in ways.items():
                if slot.get('minutes') is None:
                    continue
                piece = '%s %d min (%s' % (mode, slot['minutes'], slot.get('source') or '?')
                if slot.get('name'):
                    piece += ', %s' % slot['name']
                if slot.get('departs'):
                    piece += ', departs %s' % slot['departs']
                if slot.get('link'):
                    piece += ', %s' % slot['link']
                bits.append(piece + ')')
            mine = leg.get('mine') or {}
            if mine.get('minutes') is not None:
                bits.append('%s %d min (their own time, which beats the rest)'
                            % (mine.get('mode') or 'somehow', mine['minutes']))
            if not bits:
                continue
            print('  %s  %s -> %s' % (fmt_date(leg.get('date')), leg.get('from'), leg.get('to')))
            print('      %s%s' % ('; '.join(bits),
                                  '   [they chose %s]' % leg['pick'] if leg.get('pick') else ''))


# ---------- the worklist ----------

def worklist(env, trip):
    places = as_map(trip.get('places'))
    days = as_map(trip.get('days'))
    hb = env.get('handback') or {}
    jobs = []
    # The planner says these two about any place whose hours it does not have or trust. The HOURS
    # lines below say it better, and for every place rather than only the planned ones.
    boilerplate = ('Hours unknown, so these times assume it is open', 'Hours not checked yet')

    for day in hb.get('days') or []:
        for v in day.get('versions') or []:
            for issue in v.get('issues') or []:
                if (issue.get('severity') or '') == 'error':
                    jobs.append('FIX  %s (%s): %s' % (fmt_date(day.get('date')),
                                                      v.get('label') or v.get('key'), issue.get('text')))
    if (hb.get('note') or '').strip():
        jobs.append('ANSWER their note: %s' % one_line(hb['note'], 160))

    for day in hb.get('days') or []:
        for v in day.get('versions') or []:
            for check in v.get('checks') or []:
                if (check.get('text') or '') in boilerplate:
                    continue
                jobs.append('CHECK %s: %s' % (check.get('name'), check.get('text')))

    for pid in sorted(places):
        p = places[pid]
        if not p.get('hours'):
            jobs.append('HOURS %s has none at all' % (p.get('name') or pid))
        elif not p['hours'].get('verified'):
            jobs.append('HOURS %s unverified (%s) — confirming the same times costs them nothing'
                        % (p.get('name') or pid, p['hours'].get('source') or '?'))
        if p.get('check'):
            jobs.append('CHECK %s: %s' % (p.get('name') or pid, p['check']))
        if p.get('lat') is None:
            jobs.append('PLACE %s has no position, so nothing can be routed to it' % (p.get('name') or pid))

    for key in sorted(days):
        d = days[key]
        plans = d.get('plans') or {}
        empty = [PLAN_LABEL[k] for k in PLAN_KEYS if not (plans.get(k) or [])]
        if len(empty) == 3:
            jobs.append('PLAN  %s has no running order at all' % fmt_date(key))
        elif empty:
            jobs.append('PLAN  %s is missing %s' % (fmt_date(key), ' and '.join(empty)))

    for item in (hb.get('changes') or {}).get('edited') or []:
        jobs.append('LEAVE %s: they changed %s themselves — do not send it back changed'
                    % (item.get('name'), ', '.join(item.get('fields') or [])))

    print('\n' + '=' * 72)
    print('WORKLIST')
    print('=' * 72)
    if not jobs:
        print('  Nothing obvious. Read the plan above and decide what would make the day better.')
    said = set()
    for job in jobs:
        if job in said:
            continue
        said.add(job)
        print('  ' + job)


def main():
    ap = argparse.ArgumentParser(description='Read a plan-my-trip save, package or hand-back.')
    ap.add_argument('source', help='a .json file, a file holding a pasted block, or - for stdin')
    args = ap.parse_args()

    env = payload(load(args.source))
    kind = env.get('kind') or '?'
    trip = env.get('trip')
    if not isinstance(trip, dict):
        die('That envelope has no trip in it.')

    label = {'save': 'a saved trip', 'package': 'a package', 'handback': 'a hand-back'}.get(kind, kind)
    print('Read %s, written by %s at %s' % (label, env.get('app') or '?', env.get('at') or '?'))
    if env.get('title'):
        print('Labelled: %s' % env['title'])
    if env.get('sum'):
        print('Checksum: %s' % ('matches' if checksum(env) == env['sum']
                                else 'DOES NOT MATCH — this was changed on the way. Ask for it '
                                     'again, as a file if you can.'))
    if kind == 'handback':
        print('Baseline: %s' % ('carried, so a prediction can be exact'
                                if (env.get('handback') or {}).get('base')
                                else 'none, so the planner had no package to compare against'))
    print()
    lost = settle_days(trip)
    for pid in sorted(lost):
        print('NOTE  "%s" points at a day this trip does not have, so it goes to the backlog.' % pid)
    show_trip(trip)
    if kind == 'handback':
        show_handback(env.get('handback') or {}, trip)
    worklist(env, trip)


if __name__ == '__main__':
    main()
