/* SPDX-License-Identifier: AGPL-3.0-or-later */
/* Node tests for docs/core.js. Run: node tests/core_test.js */
const C = require('../docs/core.js');
const demoEnv = require('./demo-trip.json');
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('  ✗ FAIL:', msg); } else console.log('  ✓', msg); };
const clone = (x) => JSON.parse(JSON.stringify(x));

console.log('\n== Dates, times and durations ==');
ok(C.fmtDateUK('2026-11-21') === 'Sat 21 Nov', 'UK date: ' + C.fmtDateUK('2026-11-21'));
ok(C.fmtDateLongUK('2026-11-21') === 'Sat 21 Nov 2026', 'long UK date: ' + C.fmtDateLongUK('2026-11-21'));
ok(C.weekdayOf('2026-11-21') === 'sat' && C.weekdayOf('2026-11-23') === 'mon', 'weekday of a date, Monday first');
ok(C.normDate('2026-02-31') === null && C.normDate('2026-02-28') === '2026-02-28', '31 February is rejected');
ok(C.normDate('21/11/2026') === null, 'only ISO dates are accepted');
ok(C.normTime('8.5') === null && C.normTime('8:05') === '08:05' && C.normTime('24:30') === '00:30', 'times normalise to HH:MM');
ok(C.fmtDur(95) === '1h 35' && C.fmtDur(60) === '1h' && C.fmtDur(45) === '45 min', 'durations read as hours and minutes');

console.log('\n== Money ==');
const yen = { amount: 400, currency: 'JPY', per: 'pp' };
ok(C.fmtMoney(yen, { currency: null }) === '¥400 pp', 'no preferred currency, no conversion: ' + C.fmtMoney(yen, {}));
ok(C.fmtMoney(yen, { currency: 'CHF', fx: { JPY: 0.0054 } }) === '¥400 (≈ CHF 2.15) pp',
  'a conversion only once one is chosen: ' + C.fmtMoney(yen, { currency: 'CHF', fx: { JPY: 0.0054 } }));
ok(C.fmtMoney({ amount: 0 }, {}) === 'Free', 'free is free');

console.log('\n== The example trip ==');
const { trip: demo, issues: demoIssues } = C.normalise(demoEnv.trip);
ok(demoIssues.length === 0, 'the example trip normalises without complaint');
ok(C.dayIds(demo).join(' ') === '2026-11-21 2026-11-22', 'days come back in date order');
ok(C.planPlaces(demo, '2026-11-21', 'balanced').map((p) => p.name).join(', ') === 'Example Temple, Made-up Market', 'Balanced holds its two stops in order');
ok(C.planPlaces(demo, '2026-11-21', 'packed').length === 3, 'Packed holds three');
ok(C.ideasFor(demo, '2026-11-21', 'balanced').map((p) => p.name).join(', ') === 'Pretend Noodle Bar', 'ideas for today are the day\'s places outside the version on screen');
ok(C.backlogPlaces(demo).map((p) => p.name).join(', ') === 'Imaginary Museum, Nowhere Viewpoint', 'the backlog keeps its order');
ok(C.plansHolding(demo, 'made-up-market').join(' ') === 'balanced packed', 'a place can sit in two versions and not the third');
ok(JSON.stringify(C.normalise(demo).trip) === JSON.stringify(demo), 'normalising twice changes nothing');

console.log('\n== Repairs, each one explained ==');
function repaired(mutate) {
  const raw = clone(demoEnv.trip);
  mutate(raw);
  return C.normalise(raw);
}
let r = repaired((t) => { t.places['example-temple'].dayId = '2026-12-25'; });
ok(r.trip.places['example-temple'].dayId === null && r.trip.backlog.includes('example-temple'), 'a place on a day that is not in the trip goes to the backlog');
ok(/not in this trip/.test(r.issues.join(' ')), 'and says so: ' + r.issues[0]);
ok(!r.trip.days['2026-11-21'].plans.balanced.includes('example-temple'), 'and leaves the version it was in');

r = repaired((t) => { t.days['2026-11-21'].plans.balanced.push('example-garden', 'made-up-market', 'ghost'); });
ok(r.trip.days['2026-11-21'].plans.balanced.join(' ') === 'example-temple made-up-market',
  'a version drops another day\'s places, repeats and unknown ids: ' + r.trip.days['2026-11-21'].plans.balanced.join(' '));

r = repaired((t) => { t.backlog = ['nowhere-viewpoint', 'nowhere-viewpoint', 'example-temple']; });
ok(r.trip.backlog.join(' ') === 'nowhere-viewpoint imaginary-museum', 'the backlog ends up as exactly the places with no day');

r = repaired((t) => { t.places['imaginary-museum'].id = 'example-temple'; });
ok(!!r.trip.places['example-temple-2'], 'a repeated id is renamed rather than lost');
ok(/already had the id/.test(r.issues.join(' ')), 'and says so: ' + r.issues[0]);

r = repaired((t) => { t.places['example-garden'].duration = 47; t.places['nowhere-viewpoint'].duration = 900; });
ok(r.trip.places['example-garden'].duration === 45 && r.trip.places['nowhere-viewpoint'].duration === 720,
  'durations snap to quarter hours and stop at 12 hours');

r = repaired((t) => { t.places['example-temple'].hours.week.mon = ['nonsense']; });
ok(r.trip.places['example-temple'].hours.week.mon.length === 0 && /could not be read/.test(r.issues.join(' ')),
  'an unreadable opening time is dropped and reported: ' + r.issues[0]);

r = repaired((t) => { t.days['2026-11-21'].date = '2026-13-45'; });
ok(C.dayIds(r.trip).join(' ') === '2026-11-21 2026-11-22' && /which is not a date/.test(r.issues.join(' ')),
  'an unreadable date falls back to the day\'s id, and says so: ' + r.issues[0]);
r = repaired((t) => { t.days['2026-11-21'].date = '2026-13-45'; t.days['2026-11-21'].id = 'whenever'; });
ok(C.dayIds(r.trip).join(' ') === '2026-11-22' && /is not a date/.test(r.issues.join(' ')), 'a day with no readable date at all is left out, with a reason');
ok(C.backlogPlaces(r.trip).length === 5, 'the three places that were on it fall back to the backlog');

r = repaired((t) => { t.places['nowhere-viewpoint'].lat = 'somewhere'; });
ok(r.trip.places['nowhere-viewpoint'].lat === null && /off the map/.test(r.issues.join(' ')), 'a place with an unreadable position stays, off the map');

console.log('\n== Starting from nothing ==');
const fresh = C.newTrip('Japan · Nov 2026', '2026-09-25T10:00:00Z');
ok(fresh.id === 'japan-nov-2026' && fresh.title === 'Japan · Nov 2026', 'a new trip gets a slug id from its title');
ok(C.normalise(fresh).issues.length === 0 && C.dayIds(fresh).length === 0, 'a new trip is empty and valid');
ok(C.newTrip('').title === 'My trip', 'an unnamed trip still has a name');

console.log('\n' + (fails ? fails + ' FAILURES' : 'ALL PASSED'));
process.exit(fails ? 1 : 0);
