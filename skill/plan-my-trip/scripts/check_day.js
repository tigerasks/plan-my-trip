#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// See a day the way the planner will, before anybody pastes anything.
//
//   node check_day.js --trip their.json --package package.txt
//   node check_day.js --trip their.json --day 2026-11-23 --version balanced
//   node check_day.js --package package.txt            (a trip that does not exist yet)
//
// It merges the package into their trip with the planner's own code and then walks each day:
// when you set off, when you arrive, how long you wait, what is shut, whether you get back in
// time. Travel is the planner's own estimate, not a measured route — only the app can ask OSRM
// and Transitous, so treat the times as good enough to choose an order, not to promise a train.

'use strict';

const fs = require('fs');
const path = require('path');
const C = require(path.join(__dirname, '..', 'vendor', 'core.js'));

const PLAN_KEYS = ['less', 'balanced', 'packed'];
const NOW = '2026-01-01T00:00:00Z';

function die(message) {
  process.stderr.write('Cannot check it: ' + message + '\n');
  process.exit(2);
}

function args(argv) {
  const out = { version: null, day: null, keepMine: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--trip') out.trip = argv[++i];
    else if (a === '--package') out.pack = argv[++i];
    else if (a === '--day') out.day = argv[++i];
    else if (a === '--version') out.version = argv[++i];
    else if (a === '--keep-mine') out.keepMine = true;
    else if (a === '-h' || a === '--help') out.help = true;
    else die('I do not know the option "' + a + '".');
  }
  return out;
}

function slurp(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    die(e.code === 'ENOENT' ? 'there is no file called "' + file + '".' : e.message);
  }
  return '';
}

function readTrip(file) {
  const text = slurp(file);
  const found = C.findPayload(text);
  if (!found.body) die(file + ' holds no day-planner block and no JSON.');
  let env;
  try { env = JSON.parse(found.body); } catch (e) { die(file + ' is damaged: ' + e.message); }
  if (!env || !env.trip) die(file + ' has no trip in it.');
  return C.normalise(env.trip, NOW).trip;
}

// ---------- saying a day out loud ----------

const pad = (s, n) => String(s).padEnd(n);

function showDay(trip, dayId, key, note) {
  const P = C.planDay(trip, dayId, key);
  if (!P) return false;
  const day = trip.days[dayId];
  const head = [C.fmtDateUK(dayId), day.city || null, C.PLAN_LABEL[key]].filter(Boolean).join(' — ');
  console.log('\n' + head + (note ? '   ' + note : ''));
  console.log('-'.repeat(Math.max(head.length, 40)));
  if (!P.summary.stops) {
    console.log('  nothing planned in this version');
    return true;
  }
  for (const item of P.items) {
    if (item.type === 'start') {
      console.log('  ' + pad(C.hhmm(item.at), 15) + 'leave ' + (item.name || 'wherever the day starts'));
    } else if (item.type === 'end') {
      console.log('  ' + pad(C.hhmm(item.at), 15) + 'back at ' + (item.name || 'wherever the day ends'));
    } else if (item.type === 'travel') {
      const how = item.unknown ? 'no idea — nothing to measure from'
        : C.fmtDur(item.minutes) + ' ' + (C.MODE_WORD[item.mode] || item.mode)
          + (item.estimate ? ' (estimate)' : ' (' + (item.by || 'measured') + ')');
      console.log('  ' + pad('', 15) + '↓ ' + how);
    } else {
      const span = C.hhmm(item.at) + ' – ' + C.hhmm(item.until);
      const waited = item.waited ? '   waited ' + C.fmtDur(item.waited) : '';
      console.log('  ' + pad(span, 15) + pad(item.name, 32) + C.fmtDur(item.place.duration) + waited);
    }
  }
  const s = P.summary;
  const legs = (s.estimated || 0) + (s.checked || 0);
  const bits = [s.stops + ' stop' + (s.stops === 1 ? '' : 's')];
  if (s.visit) bits.push(C.fmtDur(s.visit) + ' visiting');
  if (s.travel) bits.push(C.fmtDur(s.travel) + ' travelling');
  if (s.wait) bits.push(C.fmtDur(s.wait) + ' waiting');
  if (s.spare != null) bits.push(C.fmtDur(s.spare) + ' spare');
  if (legs) bits.push(s.checked + ' of ' + legs + ' legs measured');
  console.log('  ' + bits.join(' · '));
  for (const i of P.issues) console.log('  [' + i.severity.toUpperCase() + '] ' + i.text);
  for (const c of P.checks) console.log('  [CHECK] ' + c.name + ': ' + c.text);
  return true;
}

function main() {
  const o = args(process.argv.slice(2));
  if (o.help || (!o.trip && !o.pack)) {
    console.log('node check_day.js --trip their.json [--package package.txt] [--day DATE] [--version KEY]');
    console.log('  --keep-mine   preview the merge as the owner would first see it, with their own');
    console.log('                values kept, rather than as if they took everything you sent');
    return 0;
  }
  if (o.version && !PLAN_KEYS.includes(o.version)) {
    die('--version is less, balanced or packed.');
  }

  let trip = o.trip ? readTrip(o.trip) : null;
  let touched = null;

  if (o.pack) {
    const r = C.readBlock(slurp(o.pack), NOW);
    if (!r.ok) die(r.message);
    if (!trip) {
      // Nothing to merge into: the planner would open this as a new trip.
      trip = r.trip;
      console.log('No trip given, so this is the package opened on its own, as a new trip.');
    } else {
      // Every conflict answered the package's way, because what you want to see is the day you
      // are proposing. --keep-mine shows the other branch: what they see before they answer.
      const dry = C.mergePackage(trip, r.trip, null, {}, NOW, r.said);
      const choices = {};
      if (!o.keepMine) for (const c of dry.conflicts) choices[c.key] = 'theirs';
      const done = C.mergePackage(trip, r.trip, null, choices, NOW, r.said);
      trip = done.trip;
      touched = new Set(Object.keys(r.trip.days || {}));
      for (const p of Object.values(r.trip.places || {})) {
        const landed = trip.places[p.id];
        if (landed && landed.dayId) touched.add(landed.dayId);
      }
      const n = dry.conflicts.length;
      console.log('Merged ' + (r.title || 'the package') + ': '
        + (n ? n + ' field(s) would be put to them, shown here '
               + (o.keepMine ? 'as theirs' : 'as yours') : 'nothing to settle'));
      for (const text of done.issues) console.log('  ! ' + text);
    }
  }

  let days = C.dayIds(trip);
  if (o.day) {
    if (!trip.days[o.day]) die('this trip has no ' + o.day + '. It has ' + (days.join(', ') || 'no days at all'));
    days = [o.day];
  } else if (touched && touched.size) {
    days = days.filter((d) => touched.has(d));
  }
  if (!days.length) die('there is no day to look at.');

  const versions = o.version ? [o.version] : PLAN_KEYS;
  if (days.length > 4 && !o.day) {
    console.log('\n' + days.length + ' days. Showing the version on each; use --day for one day in full.');
    for (const id of days) showDay(trip, id, trip.days[id].shown, '');
    return 0;
  }
  for (const id of days) {
    for (const key of versions) {
      if (!o.version && !(trip.days[id].plans[key] || []).length) continue;
      showDay(trip, id, key, key === trip.days[id].shown ? '(the one they are looking at)' : '');
    }
  }
  console.log('\nTravel times here are the planner\'s own estimates. Real routes come back in the'
    + '\nhand-back, once they have pasted the package in.');
  return 0;
}

process.exit(main());
