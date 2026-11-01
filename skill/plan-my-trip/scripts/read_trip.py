#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Read anything the plan-my-trip planner produced and say what is in it.

    python3 read_trip.py <file>          a saved trip, a hand-back or a package
    python3 read_trip.py -               the same, from standard input

Takes a .json file or a pasted block between the BEGIN and END marker lines, and prints the trip,
then — for a hand-back — the note, the plan it computed, its issues, its checks and every travel
time with the service that measured it. Ends with a worklist, which is the point of running it.
"""
import json
import re
import sys

WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
PLAN_KEYS = ['less', 'balanced', 'packed']
BEGIN = '--- BEGIN day-planner/2 ---'
END = '--- END day-planner/2 ---'
DATE = re.compile(r'^\d{4}-\d{2}-\d{2}$')


def find_block(text):
    """The envelope, from a file or from whatever the block was pasted into."""
    if BEGIN in text and END in text:
        body = text.split(BEGIN, 1)[1].split(END, 1)[0]
        # The lines are joined because a chat window may have re-wrapped the block, and JSON never
        # holds a raw line break inside a string.
        return json.loads(''.join(line.strip() for line in body.strip().splitlines()))
    return json.loads(text)


def uk(iso):
    """2026-11-21 -> Sat 21 Nov, the way the planner and the owner write dates."""
    if not DATE.match(str(iso) or ''):
        return str(iso)
    import datetime
    d = datetime.date.fromisoformat(iso)
    return d.strftime('%a %d %b').replace(' 0', ' ')


def hours_of(place):
    h = place.get('hours')
    if not h:
        return 'no hours'
    week = h.get('week') or {}
    days = sum(1 for k in WEEK if week.get(k) is not None)
    state = 'verified' if h.get('verified') else 'UNVERIFIED'
    return '%s, %s, %d day(s) known' % (h.get('source') or '?', state, days)


def money(price):
    if not price:
        return ''
    if price.get('text'):
        return ' · ' + price['text']
    if price.get('amount') is not None:
        return ' · %s %s%s' % (price.get('currency') or '', price['amount'],
                               ' ' + price['per'] if price.get('per') else '')
    return ''


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    text = sys.stdin.read() if sys.argv[1] == '-' else open(sys.argv[1], encoding='utf-8').read()
    env = find_block(text)
    trip = env.get('trip') or {}
    places = trip.get('places') or {}
    if isinstance(places, list):
        places = {p.get('id'): p for p in places if isinstance(p, dict)}
    days = trip.get('days') or {}
    if isinstance(days, list):
        days = {d.get('id') or d.get('date'): d for d in days if isinstance(d, dict)}

    print('%s — %s' % (env.get('kind', '?'), env.get('title') or trip.get('title') or '(untitled)'))
    print('tripId: %s   written: %s   by: %s' % (env.get('tripId') or trip.get('id'),
                                                 env.get('at') or '?', env.get('app') or '?'))
    if trip.get('currency'):
        print('preferred currency: %s' % trip['currency'])

    for stay in trip.get('stays') or []:
        print('stay: %s from %s for %s night(s)%s'
              % (stay.get('name'), uk(stay.get('from')), stay.get('nights'),
                 ' — ' + stay['note'] if stay.get('note') else ''))

    print('\n=== days ===')
    for dayId in sorted(days):
        d = days[dayId]
        start, end = d.get('start') or {}, d.get('end') or {}
        print('\n%s  %s' % (uk(dayId), d.get('city') or ''))
        print('  from %s %s   back by %s %s'
              % (start.get('time') or '?', '(' + start['name'] + ')' if start.get('name') else '(no place set)',
                 end.get('time') or '?', '(' + end['name'] + ')' if end.get('name') else '(no place set)'))
        if d.get('note'):
            print('  note: %s' % d['note'])
        for key in PLAN_KEYS:
            order = (d.get('plans') or {}).get(key) or []
            shown = ' <- on screen' if d.get('shown') == key else ''
            names = ' → '.join((places.get(i) or {}).get('name', i) for i in order) or '(empty)'
            print('  %-8s %s%s' % (key, names, shown))
        inPlans = {i for key in PLAN_KEYS for i in (d.get('plans') or {}).get(key) or []}
        ideas = [p for p in places.values() if p.get('dayId') == dayId and p.get('id') not in inPlans]
        if ideas:
            print('  ideas not in any version: %s' % ', '.join(p.get('name', '?') for p in ideas))

    backlog = [places[i] for i in trip.get('backlog') or [] if i in places]
    if backlog:
        print('\n=== backlog ===')
        for p in backlog:
            print('  %-24s %s' % (p.get('id'), p.get('name')))

    print('\n=== places ===')
    for p in sorted(places.values(), key=lambda x: (x.get('dayId') or 'zzz', x.get('name') or '')):
        where = uk(p['dayId']) if p.get('dayId') else 'backlog'
        bits = ['%s min' % p.get('duration')]
        if p.get('fixed'):
            bits.append('fixed %s' % p['fixed'])
        if p.get('window'):
            bits.append('window %s-%s' % (p['window'].get('from'), p['window'].get('to')))
        if p.get('priority'):
            bits.append(p['priority'])
        if p.get('booked'):
            bits.append('BOOKED')
        if p.get('closed'):
            bits.append('closed ' + ', '.join(uk(c) for c in p['closed']))
        print('  %-22s %-26s %-9s %s | %s%s'
              % (p.get('id'), (p.get('name') or '')[:26], where, ', '.join(bits),
                 hours_of(p), money(p.get('price'))))
        if p.get('check'):
            print('      check: %s' % p['check'])
        if p.get('note'):
            print('      note: %s' % p['note'])

    hb = env.get('handback')
    if hb:
        print('\n=== what they said ===')
        print('note: %s' % (hb.get('note') or '(none)'))
        for day in hb.get('days') or []:
            print('\n%s  settled on: %s' % (uk(day.get('date')), day.get('chosen')))
            for v in day.get('versions') or []:
                s = v.get('summary') or {}
                print('  %-8s %s-%s  %s stop(s), %s min travel, %s min waiting, %s min spare'
                      % (v.get('key'), v.get('starts'), v.get('finishes'), s.get('stops'),
                         s.get('travel'), s.get('wait'), s.get('spare')))
                for stop in v.get('stops') or []:
                    print('      %s %s for %s min%s' % (stop.get('at'), stop.get('name'),
                                                        stop.get('minutes'),
                                                        ' (waited %s)' % stop['waited'] if stop.get('waited') else ''))
                for i in sorted(v.get('issues') or [], key=lambda x: x.get('severity') != 'error'):
                    print('      %-5s %s' % (i.get('severity', '?').upper(), i.get('text')))
                for c in v.get('checks') or []:
                    print('      CHECK %s — %s' % (c.get('name'), c.get('text')))
        ch = hb.get('changes') or {}
        print('\n=== what they changed ===')
        if not ch.get('baseline'):
            print('  nothing to compare against: %s' % ch.get('why', ''))
        else:
            for label, rows in (('added', ch.get('added')), ('deleted', ch.get('deleted'))):
                for r in rows or []:
                    print('  %-8s %s' % (label, r.get('name')))
            for r in ch.get('moved') or []:
                print('  moved    %s: %s -> %s' % (r.get('name'), r.get('from') or 'backlog',
                                                   r.get('to') or 'backlog'))
            for r in ch.get('edited') or []:
                print('  edited   %s: %s   <- leave these alone' % (r.get('name'), ', '.join(r.get('fields') or [])))
            for r in ch.get('orders') or []:
                print('  reordered %s %s' % (uk(r.get('date')), r.get('version') or ''))
            if not any(ch.get(k) for k in ('added', 'deleted', 'moved', 'edited', 'orders')):
                print('  nothing since the last time you were in step')
        travel = hb.get('travel') or []
        if travel:
            print('\n=== travel, with what measured it ===')
            for t in travel:
                ways = []
                for mode, slot in (t.get('ways') or {}).items():
                    if slot.get('minutes') is None:
                        ways.append('%s: asked, nothing' % mode)
                        continue
                    hedge = ' (NOT a timetable)' if slot.get('source') == 'stops' else ''
                    ways.append('%s %s min by %s%s%s' % (mode, slot['minutes'], slot.get('source'),
                                                         ': ' + slot['name'] if slot.get('name') else '', hedge))
                chose = ' — they picked %s' % t['pick'] if t.get('pick') else ''
                if t.get('mine'):
                    chose += ' — their own time: %s min' % (t['mine'] or {}).get('minutes')
                print('  %s  %s → %s: %s%s' % (uk(t.get('date')), t.get('from'), t.get('to'),
                                               '; '.join(ways) or 'nothing could answer', chose))

    print('\n=== worklist ===')
    work = []
    if hb:
        for day in hb.get('days') or []:
            for v in day.get('versions') or []:
                for i in v.get('issues') or []:
                    if i.get('severity') == 'error':
                        work.append('FIX  %s %s: %s' % (uk(day.get('date')), v.get('key'), i.get('text')))
        if hb.get('note'):
            work.append('ANSWER  their note: %s' % hb['note'])
        for day in hb.get('days') or []:
            for v in day.get('versions') or []:
                for c in v.get('checks') or []:
                    work.append('CHECK  %s: %s' % (c.get('name'), c.get('text')))
    for p in places.values():
        if not p.get('hours'):
            work.append('HOURS  %s has none at all' % (p.get('name') or p.get('id')))
        elif not (p['hours'] or {}).get('verified'):
            work.append('HOURS  %s has unverified hours (%s)' % (p.get('name') or p.get('id'),
                                                                 (p['hours'] or {}).get('source')))
    for dayId in sorted(days):
        plans = days[dayId].get('plans') or {}
        empty = [k for k in PLAN_KEYS if not plans.get(k)]
        if empty:
            work.append('PLAN   %s has nothing in %s' % (uk(dayId), ', '.join(empty)))
    seen = set()
    for line in work:
        if line not in seen:
            print('  ' + line)
            seen.add(line)
    if not work:
        print('  nothing outstanding')
    return 0


if __name__ == '__main__':
    sys.exit(main())
