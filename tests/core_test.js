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

console.log('\n== Moving places around ==');
function withDemo(fn) {
  const t = C.normalise(clone(demoEnv.trip)).trip;
  return { t, out: fn(t) };
}
let m = withDemo((t) => C.moveToBacklog(t, 'example-temple'));
ok(m.out.ok && m.t.places['example-temple'].dayId === null, 'a day place can move to the backlog');
ok(m.t.backlog[m.t.backlog.length - 1] === 'example-temple', 'and joins the end of the backlog');
ok(m.out.text === 'Example Temple moved to the backlog, and out of Do less, Balanced and Packed', 'and the planner says which versions it left: ' + m.out.text);
ok(C.normalise(m.t).issues.length === 0, 'the trip stays consistent afterwards');

m = withDemo((t) => C.moveToDay(t, 'imaginary-museum', '2026-11-22'));
ok(m.out.ok && m.t.places['imaginary-museum'].dayId === '2026-11-22', 'a backlog place can move to a day');
ok(!m.t.backlog.includes('imaginary-museum'), 'and leaves the backlog');
ok(C.ideasFor(m.t, '2026-11-22', 'balanced').map((p) => p.name).join() === 'Imaginary Museum', 'and arrives as an idea, not in a version');

m = withDemo((t) => C.moveToDay(t, 'example-temple', '2026-11-22'));
ok(m.t.days['2026-11-21'].plans.packed.join(' ') === 'pretend-noodle-bar made-up-market', 'moving to another day takes it out of the old day\'s versions');

m = withDemo((t) => C.removeFromPlan(t, 'made-up-market', 'balanced'));
ok(m.out.ok && m.t.days['2026-11-21'].plans.packed.includes('made-up-market'), 'Remove takes a place out of one version only');
ok(m.out.text === 'Made-up Market left Balanced, and is still in Packed', 'and says where it still is: ' + m.out.text);
ok(m.t.places['made-up-market'].dayId === '2026-11-21', 'and it stays on the day');

m = withDemo((t) => C.addToPlan(t, 'pretend-noodle-bar', 'balanced', 1));
ok(m.t.days['2026-11-21'].plans.balanced.join(' ') === 'example-temple pretend-noodle-bar made-up-market', 'a place can be added to a version at a chosen position');
ok(!C.addToPlan(m.t, 'pretend-noodle-bar', 'balanced').ok, 'but not twice');
ok(!C.addToPlan(m.t, 'imaginary-museum', 'balanced').ok, 'and not from the backlog');

m = withDemo((t) => C.reorderPlan(t, '2026-11-21', 'packed', 2, 0));
ok(m.t.days['2026-11-21'].plans.packed.join(' ') === 'made-up-market example-temple pretend-noodle-bar', 'stops can be reordered inside a version');

m = withDemo((t) => C.deletePlace(t, 'example-temple'));
ok(!m.t.places['example-temple'] && C.planPlaces(m.t, '2026-11-21', 'packed').length === 2, 'Delete drops a place from every version');
ok(C.normalise(m.t).issues.length === 0, 'and leaves nothing dangling');

m = withDemo((t) => C.addPlace(t, { name: 'Made-up Market', lat: 35.01, lng: 135.77 }, '2026-11-22'));
ok(m.out.id === 'made-up-market-2', 'a new place with a taken id gets its own: ' + m.out.id);
ok(m.t.places['made-up-market-2'].duration === 60, 'and an hour by default');
ok(C.addPlace(m.t, { name: 'Spare Idea', lat: 35, lng: 135 }, null).text === 'Spare Idea added to the backlog', 'a new place can go straight to the backlog');

console.log('\n== Days ==');
m = withDemo((t) => C.addDay(t, '2026-11-23', 'Nara'));
ok(m.out.ok && m.t.days['2026-11-23'].city === 'Nara', 'a day can be added');
ok(!C.addDay(m.t, '2026-11-23', 'Nara').ok && !C.addDay(m.t, 'next Tuesday', '').ok, 'but not twice, and not from prose');
ok(C.addDay(m.t, 'next Tuesday', '').text.indexOf('2026-11-21') > 0, 'and it shows the shape it wants: ' + C.addDay(m.t, 'next Tuesday', '').text);

m = withDemo((t) => C.deleteDay(t, '2026-11-21'));
ok(m.out.ok && C.dayIds(m.t).join() === '2026-11-22', 'a day can be deleted');
ok(C.backlogPlaces(m.t).length === 5 && m.out.text.indexOf('back to the backlog') > 0, 'and its ideas go back to the backlog: ' + m.out.text);

m = withDemo((t) => C.setDayDate(t, '2026-11-21', '2026-11-25'));
ok(m.out.ok && !m.t.days['2026-11-21'] && !!m.t.days['2026-11-25'], 'a day can be given another date');
ok(m.t.places['example-temple'].dayId === '2026-11-25', 'and its places follow it');
ok(C.normalise(m.t).issues.length === 0, 'with nothing left pointing at the old date');
ok(!C.setDayDate(m.t, '2026-11-25', '2026-11-22').ok, 'but not onto a date the trip already has');

console.log('\n== Writing a block ==');
const demoTrip = C.normalise(demoEnv.trip).trip;
const block = C.writeBlock(demoTrip, 'save', '2026-09-25T10:04:12Z');
const lines = block.trimEnd().split('\n');
ok(lines[0] === '--- BEGIN day-planner/2 ---', 'it starts with the fixed line: ' + lines[0]);
ok(lines[lines.length - 1] === '--- END day-planner/2 ---', 'and ends with the fixed one: ' + lines[lines.length - 1]);
ok(lines.length === 3, 'with the whole trip on one line between them');
const env = JSON.parse(lines[1]);
ok(env.schema === 'day-planner/2' && env.kind === 'save', 'the header names the schema and the kind');
ok(env.tripId === 'example-kyoto' && env.title === 'Example · Kyoto (made up)' && env.at === '2026-09-25T10:04:12Z',
  'and the trip, its title and when it was written');
ok(JSON.stringify(env.trip) === JSON.stringify(demoTrip), 'the trip itself travels unchanged');
ok(C.writeBlock(demoTrip, 'nonsense').indexOf('"kind":"save"') > 0, 'an unknown kind falls back to a save');

const file = C.writeJson(demoTrip, 'save', '2026-09-25T10:04:12Z');
ok(JSON.stringify(JSON.parse(file)) === JSON.stringify(env), 'the file holds the same envelope, without the two lines');
ok(file.indexOf('\n  "schema"') > 0 && file.endsWith('\n'), 'laid out to be read, since a file is not pasted');
ok(/^example-kyoto \d{4}-\d{2}-\d{2} \d{4}\.json$/.test(C.fileName(demoTrip)), 'the file is named after the trip and the moment: ' + C.fileName(demoTrip));
ok(C.sizeText(block).indexOf('KB') > 0, 'and the planner can say how big a block is: ' + C.sizeText(block));

console.log('\n' + (fails ? fails + ' FAILURES' : 'ALL PASSED'));
process.exit(fails ? 1 : 0);
