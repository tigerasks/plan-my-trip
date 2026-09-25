/* SPDX-License-Identifier: AGPL-3.0-or-later */
/* Node tests for docs/core.js. Run: node tests/core_test.js */
const C = require('../docs/core.js');
const demoEnv = require('./demo-trip.json');
const fix = require('./fixtures.json');
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

console.log('\n== Reading a block back ==');
let got = C.readBlock(block);
ok(got.ok && got.kind === 'save' && got.tripId === 'example-kyoto', 'a block the planner wrote comes back');
ok(JSON.stringify(got.trip) === JSON.stringify(demoTrip), 'with the trip exactly as it went out');
ok(got.issues.length === 0 && got.summary === '2 days and 6 places', 'and a summary to show: ' + got.summary);

ok(C.readBlock(file).ok, 'a saved .json file reads without the two lines');
ok(C.readBlock('Here you go!\n\n' + block + '\nAnything else?').ok, 'text around the block is ignored');
ok(C.readBlock('```\n' + block + '```').ok, 'so are code fences around it');
ok(C.readBlock(block.replace(/\n/g, '\r\n')).ok, 'so are Windows line endings');

const wrapped = block.split('\n');
wrapped[1] = wrapped[1].replace(/,/g, ',\n');
ok(C.readBlock(wrapped.join('\n')).ok, 'a block the chat has re-wrapped still reads');

ok(C.readBlock(C.writeBlock(demoTrip, 'package')).kind === 'package', 'a package is recognised as one');

console.log('\n== When a block cannot be read ==');
const why = (text) => { const r = C.readBlock(text); return r.ok ? 'ok' : r.problem + ': ' + r.message; };
let bad = C.readBlock('just some chat text');
ok(bad.problem === 'no-block' && /BEGIN day-planner\/2/.test(bad.message), 'no block at all: ' + bad.message);
bad = C.readBlock('');
ok(bad.problem === 'no-block' && /nothing to import/.test(bad.message), 'nothing pasted: ' + bad.message);
bad = C.readBlock(block.split('\n').slice(0, 2).join('\n'));
ok(bad.problem === 'cut-off' && /cut off/.test(bad.message), 'cut off: ' + bad.message);
bad = C.readBlock(block.slice(0, 900) + '\n--- END day-planner/2 ---');
ok(bad.problem === 'damaged' && /it stops after 872 characters/.test(bad.message), 'damaged, and where: ' + bad.message);
bad = C.readBlock('--- BEGIN day-planner/1 ---\n{"schema":"day-planner/1"}\n--- END day-planner/1 ---');
ok(bad.problem === 'old-version' && /first planner/.test(bad.message), 'a version 1 block: ' + bad.message);
bad = C.readBlock(block.replace(/day-planner\/2/g, 'day-planner/3'));
ok(bad.problem === 'newer-version' && /newer planner/.test(bad.message), 'a newer block: ' + bad.message);
bad = C.readBlock('{"some":"other json"}');
ok(bad.problem === 'not-ours' && /not the planner/.test(bad.message), 'somebody else\'s JSON: ' + bad.message);
bad = C.readBlock(C.writeBlock(demoTrip, 'handback'));
ok(bad.problem === 'handback' && /sends to the chat/.test(bad.message), 'a hand-back: ' + bad.message);
bad = C.readBlock(block.replace('"kind":"save"', '"kind":"leftovers"'));
ok(bad.problem === 'unknown-kind' && /leftovers/.test(bad.message), 'an unknown kind, quoted back: ' + bad.message);
bad = C.readBlock(block.replace(/"trip":\{.*\}\}$/m, '"trip":null}'));
ok(bad.problem === 'no-trip', 'no trip inside: ' + bad.message);

console.log('\n== What an import would do ==');
let note = C.importNote(C.readBlock(block), null);
ok(!note.confirm && note.title === 'Load Example · Kyoto (made up)?', 'into an empty browser it just loads: ' + note.title);
note = C.importNote(C.readBlock(block), demoTrip);
ok(note.mode === 'replace-same' && note.confirm && /replaces the copy you have open/.test(note.lines.join(' ')), 'the same trip again asks first: ' + note.lines[1]);
const other = C.newTrip('Italy · Apr 2027', '2026-09-25T10:00:00Z');
note = C.importNote(C.readBlock(block), other);
ok(note.mode === 'replace-other' && /different trip/.test(note.lines.join(' ')), 'another trip says what it displaces: ' + note.lines.join(' '));
note = C.importNote(C.readBlock(C.writeBlock(demoTrip, 'package')), demoTrip);
ok(/Merging a package/.test(note.lines.join(' ')), 'a package says merging comes later: ' + note.lines[2]);
note = C.importNote(C.readBlock('nonsense'), demoTrip);
ok(!note.confirm && note.lines[0] === why('nonsense').split(': ').slice(1).join(': '), 'and an unreadable block just shows its reason');

console.log('\n== Reading the map ==');
ok(JSON.stringify(C.decodeFeatureId('52797288601')) === '{"type":"node","id":5279728860}',
  'a tapped id decodes to its OpenStreetMap node, as the service test confirmed');
ok(JSON.stringify(C.decodeFeatureId(3598968102)) === '{"type":"way","id":359896810}', 'and to a way');
ok(C.decodeFeatureId('359896810' + '3').type === 'relation', 'and to a relation');
ok(C.decodeFeatureId('') === null && C.decodeFeatureId('abc') === null && C.decodeFeatureId('5') === null,
  'and to nothing when the id is missing, not a number, or has no id left');

const byName = {};
for (const f of fix.mapFeatures) { const p = C.fromMapFeature(f, { lat: 35, lng: 135 }); byName[p.name] = p; }
ok(byName['Pizza Little Party'].localName === 'ピザリトルパーティ', 'English name with the local one kept beside it');
ok(byName['Pizza Little Party'].kind === 'food', 'a fast food place is food');
ok(byName['East Temple'].localName === '東寺', 'a feature with no plain name still gives up its local one');
ok(byName['East Temple'].kind === 'culture', 'a place of worship is culture');
ok(byName['East Temple'].osm.type === 'way' && byName['East Temple'].osm.id === 359896810, 'and its OpenStreetMap way');
ok(byName['Wasachi'].localName === '', 'a place whose names agree is not shown its own name twice');
ok(byName['Best Breakfast Point'].kind === 'view', 'a viewpoint beats its attraction class');
ok(byName['Odashi'].kind === 'food' && byName['Wagyu to Worldwide Kyoto Station'].kind === 'food', 'the rest land where they should');
ok(C.fromMapFeature({ id: 1, properties: { class: 'park' } }, {}) === null, 'a feature with no name is not a place');
ok(C.namesFrom({ name: 'A;B;C' }).name === 'A', 'alternative names are trimmed to the first');

const feats = [{ sourceLayer: 'building', properties: { name: 'A block of flats' } }].concat(fix.mapFeatures.slice(0, 1));
ok(C.bestFeature(feats).sourceLayer === 'poi', 'a point of interest wins over whatever else is under the finger');
ok(C.bestFeature([{ properties: {} }]) === null, 'and nothing named means nothing tapped');

console.log('\n== Opening hours from OpenStreetMap ==');
const hrs = (t) => C.parseOsmHours(t);
let h = hrs('Mo-Sa 11:00-14:00,17:00-22:00; Su off');
ok(JSON.stringify(h.week.mon) === '[["11:00","14:00"],["17:00","22:00"]]', 'split hours read as two spans');
ok(JSON.stringify(h.week.sun) === '[]' && !h.partial, 'a day off reads as closed, with nothing left over');
ok(JSON.stringify(h.week.sat) === JSON.stringify(h.week.mon), 'a day range covers its whole span');
ok(JSON.stringify(hrs('Mo-Su 06:00-18:00').week.wed) === '[["06:00","18:00"]]', 'every day, written as a range');
ok(JSON.stringify(hrs('09:00-17:00').week.sun) === '[["09:00","17:00"]]', 'times with no days apply to every day');
ok(JSON.stringify(hrs('Mo,We,Fr 10:00-18:00').week.wed) === '[["10:00","18:00"]]', 'a list of days');
ok(hrs('Mo,We,Fr 10:00-18:00').week.tue === null, 'and the days it does not mention stay unknown');
ok(hrs('24/7').week.mon[0][1] === '23:59', 'around the clock is stored as a full day');
ok(JSON.stringify(hrs('Sa-Su 10:00-16:00').week.sun) === '[["10:00","16:00"]]', 'a range that wraps past Sunday');

h = hrs('Mo-Fr 09:00-17:00; Nov-Mar Su off; PH closed');
ok(JSON.stringify(h.week.mon) === '[["09:00","17:00"]]' && h.partial,
  'what it can read it reads, and it owns up to the rest');
ok(hrs('sunrise-sunset') === null && hrs('') === null, 'a string it cannot read at all gives nothing');

const fromOsm = C.hoursFromOsm(fix.overpassTags.opening_hours);
ok(fromOsm.hours.source === 'osm' && fromOsm.hours.verified === false, 'hours from the map arrive unverified');
ok(fromOsm.hours.raw === 'Mo-Sa 11:00-14:00,17:00-22:00; Su off', 'with the original text kept beside them');
ok(fromOsm.partial === false, 'and this one was read in full');
const half = C.hoursFromOsm('Nov-Mar 09:00-16:00');
ok(half.partial && half.hours.raw === 'Nov-Mar 09:00-16:00', 'an unreadable string still comes through, as text to correct');
ok(!('partial' in C.normalise({ places: { x: { name: 'X', hours: fromOsm.hours } } }).trip.places.x.hours),
  'the stored hours carry no claim about how well they were read');
ok(C.normalise({ places: { x: { name: 'X', hours: fromOsm.hours } } }).trip.places.x.hours.week.sun.length === 0,
  'and they survive normalising into the trip');

console.log('\n== Asking the outside services ==');
const pu = C.photonUrl('nintendo museum', { lat: 34.97787, lng: 135.76039 });
ok(pu.indexOf('https://photon.komoot.io/api/?') === 0 && /q=nintendo\+museum/.test(pu), 'a Photon query, escaped: ' + pu);
ok(/lang=en/.test(pu) && /lat=34\.97787/.test(pu) && /lon=135\.76039/.test(pu), 'in English, biased to where the map is looking');
ok(!/lat=/.test(C.photonUrl('kyoto')), 'and without a bias when the map has nowhere to point');

const found = C.parsePhoton(fix.photon, '2026-09-25T10:00:00Z');
ok(found.length === 2 && found[0].name === 'Nintendo Museum', 'results come back as places');
ok(found[0].kind === 'museum' && found[1].kind === 'other', 'with a kind worked out from their OpenStreetMap tags');
ok(found[0].lat === 34.8871 && found[0].lng === 135.8048, 'and their position the right way round');
ok(JSON.stringify(found[0].osm) === '{"type":"way","id":263330850}', 'and their OpenStreetMap reference');
ok(found[0].where === 'Ogura · Ogura-cho · Uji', 'said where they are, nearest first: ' + found[0].where);
ok(found[0].added.how === 'search' && found[0].added.by === 'you', 'and remember how they were found');
ok(C.parsePhoton({ features: [{ properties: { name: 'No position' } }] }).length === 0, 'a result with no position is dropped');

ok(C.overpassUrl({ type: 'node', id: 5279728860 }).indexOf('node(5279728860)%3Bout%20tags%3B') > 0,
  'an Overpass lookup goes straight at the id, never a search');
ok(C.overpassUrl(null) === null, 'and there is none to make without one');
ok(C.parseOverpass({ elements: [{ type: 'node', id: 1, tags: { a: 'b' } }] }).a === 'b', 'tags come back');
ok(C.parseOverpass({ elements: [] }) === null, 'and nothing when the place is not there');

const det = C.detailsFromTags(fix.overpassTags, { type: 'node', id: 5279728860 });
ok(det.cuisine === 'pizza' && det.phone === '075-672-9889' && det.takeaway === 'only', 'the useful tags are picked out');
ok(det.hours.hours.raw === fix.overpassTags.opening_hours, 'hours come through as hours');
ok(det.links.some((l) => l.url === 'https://www.openstreetmap.org/node/5279728860'), 'with a link back to the source');
const rich = C.detailsFromTags({ website: 'https://example.org/t', wikipedia: 'ja:東寺', 'diet:vegan': 'yes', 'diet:vegetarian': 'only' }, null);
ok(rich.diet.join(', ') === 'vegetarian, vegan', 'diet options are read: ' + rich.diet.join(', '));
ok(rich.links[1].url === 'https://ja.wikipedia.org/wiki/%E6%9D%B1%E5%AF%BA', 'and a Wikipedia tag becomes a link: ' + rich.links[1].url);
ok(C.detailsFromTags({}, null).hours === null, 'a place with no hours says so plainly');

const lk = { label: 'Tabelog', url: 'https://tabelog.com/rstLst/?sk={local}' };
ok(C.lookupUrl(lk, { name: 'Pizza Little Party', localName: 'ピザリトルパーティ' }).endswith
  ? true : C.lookupUrl(lk, { name: 'Pizza Little Party', localName: 'ピザリトルパーティ' })
    === 'https://tabelog.com/rstLst/?sk=' + encodeURIComponent('ピザリトルパーティ'),
  'a look-up link is filled in with the local name');
ok(C.lookupUrl({ url: 'https://x.test/?q={name}' }, { name: 'A & B' }) === 'https://x.test/?q=A%20%26%20B', 'and escaped');
ok(C.lookupUrl({ url: 'https://x.test/' }, { name: 'A' }) === 'https://x.test/', 'a link with no placeholder just opens');

ok(C.gmapsUrl({ name: 'Pizza Little Party', localName: 'ピザリトルパーティ' }, 'Kyoto')
  === 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('ピザリトルパーティ Kyoto'),
  'Google Maps is asked for the local name plus the city, as the service test did');

console.log('\n== How far a place is from the day ==');
const near = (lat, lng, key) => C.nearestInDay(demoTrip, '2026-11-21', { lat, lng }, key);
let n = near(34.9950, 135.7855);                       // a few steps from Example Temple
ok(n.name === 'Example Temple' && n.where === 'stop 1', 'the nearest thing on the day is found: ' + C.nearText(n));
ok(n.minutes >= 1 && n.minutes <= 3, 'with a walking estimate: ' + n.minutes + ' min');
n = near(34.9860, 135.7590);                           // outside the hotel
ok(n.where === 'the start' && n.name === 'Example Hotel · Kyoto Station', 'the start counts too: ' + C.nearText(n));
n = near(35.0052, 135.7650, 'packed');
ok(n.where === 'stop 3', 'stop numbers follow the version on screen: ' + C.nearText(n));
ok(C.nearText(near(35.5, 136.5)).indexOf('km from') > 0, 'too far to walk is given as a distance: ' + C.nearText(near(35.5, 136.5)));
ok(C.nearestInDay(demoTrip, '2026-11-21', {}) === null, 'a place with no position has no distance');
ok(C.nearText(null) === '', 'and nothing to say about it');

console.log('\n' + (fails ? fails + ' FAILURES' : 'ALL PASSED'));
process.exit(fails ? 1 : 0);
