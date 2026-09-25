const C = require('./core.js');
const demo = require('./demo.json');
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('  ✗ FAIL:', msg); } else console.log('  ✓', msg); };

console.log('\n== Travel model (minutes by straight-line km) ==');
const kms = [0.3, 0.8, 1.5, 3, 6, 12, 35];
console.log('km      walk  metro  city  sparse  car');
for (const km of kms) {
  const row = [C.walkMinutes(km, 4.6), C.rideMinutes(km, C.TRANSIT.metro), C.rideMinutes(km, C.TRANSIT.city), C.rideMinutes(km, C.TRANSIT.sparse), C.rideMinutes(km, { overhead: 6, near: 20, far: 60, detour: 1.35 })];
  console.log(String(km).padEnd(7), row.map((x) => String(Math.round(x)).padStart(5)).join(' '));
}

console.log('\n== Demo day, all paces ==');
const t0 = Date.now();
const P = C.plan(demo.trip, demo.day, {}, { tripId: 'demo', dayId: demo.dayId });
console.log('plan() ms (quick):', Date.now() - t0);
P.V = C.variants(P.M);
const t0b = Date.now(); const PD = C.plan(demo.trip, demo.day, {}, {}, { deep: true }); console.log('deep explain ms:', Date.now() - t0b);
for (const k of C.PACE_KEYS) {
  const v = P.V[k];
  console.log(`-- ${k}: ${v.route.join(' > ')}  finish ${C.fmtTime(v.sim.finish)} viol=${v.sim.viol.length}`);
}
console.log('\n' + P.result.text);
const r = P.result;
ok(r.issues.filter((i) => i.severity === 'error').length === 0, 'no errors in balanced plan');
for (const id of ['fushimi-inari', 'kiyomizu', 'tea-ceremony']) ok(P.route.includes(id), 'must-do included: ' + id);
const tea = r.timeline.find((x) => x.id === 'tea-ceremony');
ok(tea && tea.start === '14:00', 'tea ceremony starts at 14:00');
const lunchPlaces = P.route.filter((k) => k === 'meal:lunch' || k === 'nishiki' || k === 'yudofu-lunch');
ok(lunchPlaces.length === 1, 'exactly one lunch (float or place): ' + lunchPlaces.join(','));
ok(P.sim.active <= C.busyBudget(P.M, 'balanced') + 1e-9, 'balanced stays within its busy budget (' + P.sim.active + ' ≤ ' + C.busyBudget(P.M, 'balanced') + ')');
const first = r.timeline.find((x) => x.type === 'visit');
ok(first.id === 'fushimi-inari', 'Fushimi Inari first (prefers early)');
const leg1 = r.timeline.find((x) => x.type === 'travel');
ok(leg1.estimate === false && leg1.minutes === 12, 'chat-verified leg used for start → Fushimi');
ok(P.V.less.route.length <= P.V.balanced.route.length && P.V.balanced.route.length <= P.V.packed.route.length, 'more stops as pace increases');
ok(P.V.less.sim.active <= P.V.balanced.sim.active && P.V.balanced.sim.active <= P.V.packed.sim.active, 'busier as pace increases');
ok(P.V.less.route.join() !== P.V.balanced.route.join() && P.V.balanced.route.join() !== P.V.packed.route.join(), 'the three paces give different plans');
console.log('left out (quick):\n  ' + P.left.map((l) => `${l.id}: ${l.reason} · ${l.text} · +${l.addMin}`).join('\n  '));
console.log('left out (deep):\n  ' + PD.left.map((l) => `${l.id}: ${l.reason} · ${l.text} · +${l.addMin} · drops [${l.drops}]`).join('\n  '));
ok(PD.left.every((l) => l.deep || ['skipped','closed','hours','no-location'].includes(l.reason)), 'deep analysis ran');

console.log('\n== User skips a must, marks a maybe as must ==');
const P2 = C.plan(demo.trip, demo.day, { priority: { kiyomizu: 'skip', ginkakuji: 'must' } });
ok(!P2.route.includes('kiyomizu'), 'skipped must is out');
ok(P2.route.includes('ginkakuji'), 'forced ginkakuji is in');
ok(P2.left.find((l) => l.id === 'kiyomizu').reason === 'skipped', 'reason = skipped');

console.log('\n== Infeasible must (closes before reachable) ==');
const d3 = JSON.parse(JSON.stringify(demo.day));
d3.places.push({ id: 'early-closer', name: 'Early closer', lat: 35.03, lng: 135.73, priority: 'must', duration: 60, hours: { open: '07:00', close: '08:40' } });
const P3 = C.plan(demo.trip, d3, {});
ok(P3.route.includes('early-closer'), 'infeasible must still placed');
ok(P3.result.issues.some((i) => i.severity === 'error' && i.id === 'early-closer'), 'error issue reported: ' + (P3.result.issues[0] || {}).text);

console.log('\n== Manual order ==');
const man = ['kiyomizu', 'tea-ceremony', 'fushimi-inari'];
const P4 = C.plan(demo.trip, demo.day, { order: man });
ok(P4.manual, 'manual mode');
ok(P4.route.indexOf('kiyomizu') < P4.route.indexOf('fushimi-inari'), 'manual order respected');
ok(P4.route.includes('meal:lunch'), 'floating lunch added to manual order');
console.log(P4.result.text);

console.log('\n== Walk mode & taxi mode ==');
const P5 = C.plan(demo.trip, demo.day, { mode: 'walk' });
ok(P5.result.timeline.filter((x) => x.type === 'travel').every((x) => x.mode === 'walk'), 'walk mode: all legs walk');
const P6 = C.plan(demo.trip, demo.day, { mode: 'car' });
ok(P6.result.timeline.some((x) => x.type === 'travel' && x.mode === 'car'), 'car mode has taxi legs');
console.log('walk finish', P5.result.summary.finish, 'stops', P5.result.summary.stops, '| car finish', P6.result.summary.finish, 'stops', P6.result.summary.stops);

console.log('\n== User leg entry + pick ==');
const P7 = C.plan(demo.trip, demo.day, { legs: { 'fushimi-inari>kiyomizu|transit': { minutes: 30 } }, legPick: { 'fushimi-inari>kiyomizu': 'transit' } });
const l7 = P7.result.timeline.find((x) => x.type === 'travel' && x.from === 'fushimi-inari' && x.to === 'kiyomizu');
if (l7) ok(l7.minutes === 30 && l7.mode === 'transit' && l7.by === 'you', 'user-entered leg used'); else console.log('  (leg not in route: ' + P7.route.join('>') + ')');
const M7 = C.buildModel(demo.trip, demo.day, { legPick: { 'kiyomizu>yudofu-lunch': 'transit' } });
const lg7 = M7.leg(M7.places.kiyomizu, M7.places['yudofu-lunch']);
ok(lg7.mode === 'transit' && !lg7.auto, 'leg pick forces transit on a short hop (' + lg7.minutes + ' min)');
const lg7r = M7.leg(M7.places['yudofu-lunch'], M7.places.kiyomizu);
ok(lg7r.mode === 'transit', 'leg pick applies in reverse direction too');

console.log('\n== Lunch disabled ==');
const P8 = C.plan(demo.trip, demo.day, { meals: { lunch: false } });
ok(!P8.route.includes('meal:lunch'), 'no floating lunch when disabled');

console.log('\n== Bad data handling ==');
const d9 = { date: '2026-10-18', start: { lat: 35, lng: 135.76, time: '9:00' }, places: [
  { id: 'a', name: 'A', lat: 35.01, lng: 135.77 }, { id: 'a', name: 'A dup', lat: 35.02, lng: 135.77 },
  { name: 'No coords' }, { id: 'far', name: 'Far', lat: 36.5, lng: 138 }, { id: 'h', name: 'Bad hours', lat: 35.0, lng: 135.78, hours: 'whenever' },
  { id: 'b', name: 'B', lat: 35.005, lng: 135.765 }, { id: 'c', name: 'C', lat: 35.006, lng: 135.768 } ] };
const P9 = C.plan({}, d9, {});
console.log(P9.M.issues.map((i) => ' - ' + i.text).join('\n'));
ok(P9.M.issues.length >= 4, 'issues reported');
ok(!P9.route.includes('no-coords'), 'no-coords not routed');

console.log('\n== Performance: 30 random candidates ==');
const rnd = C.hashStr; let seed = 7; const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const d10 = { date: '2026-11-20', start: { name: 'H', lat: 35.68, lng: 139.76, time: '08:00' }, end: { time: '22:00' }, places: [] };
for (let i = 0; i < 30; i++) d10.places.push({ id: 'p' + i, name: 'Place ' + i, lat: 35.68 + (rand() - 0.5) * 0.12, lng: 139.76 + (rand() - 0.5) * 0.16,
  priority: i < 3 ? 'must' : i < 15 ? 'want' : 'maybe', duration: 30 + Math.round(rand() * 90),
  hours: rand() < 0.5 ? { open: '09:00', close: '17:00' } : null, fixed: i === 1 ? '13:00' : undefined, meal: i === 20 || i === 21 ? 'lunch' : undefined });
const t1 = Date.now();
const P10 = C.plan({ transit: 'metro' }, d10, {}); C.variants(P10.M);
const ms = Date.now() - t1;
console.log('30 candidates, 3 variants:', ms, 'ms; stops', P10.result.summary.stops, 'finish', P10.result.summary.finish, 'errors', P10.result.issues.filter((i) => i.severity === 'error').length);
ok(ms < 1500, 'optimiser fast enough (' + ms + ' ms)');
const t2 = Date.now(); C.plan({ transit: 'metro' }, d10, { priority: { p5: 'skip' } }); console.log('re-plan after one edit (active pace only):', Date.now() - t2, 'ms');
const t3 = Date.now(); C.plan({ transit: 'metro' }, d10, { priority: { p5: 'skip' } }, {}, { deep: true }); console.log('deep explain on 30 candidates:', Date.now() - t3, 'ms');

console.log('\n== Late start drops lunch; timed item before start is flagged ==');
const P11 = C.plan(demo.trip, demo.day, { startTime: '14:30' });
ok(!P11.route.includes('meal:lunch') && P11.M.meals.lunch.outside, 'lunch window already over → no lunch break');
ok(P11.result.issues.some((i) => i.id === 'tea-ceremony' && i.severity === 'error'), 'missed 14:00 tea ceremony is an error: ' + (P11.result.issues.find((i) => i.id === 'tea-ceremony') || {}).text);

console.log('\n' + (fails ? fails + ' FAILURES' : 'ALL PASSED'));
process.exit(fails ? 1 : 0);
