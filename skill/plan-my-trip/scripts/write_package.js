#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Write a package and say what it will do, using the planner's own code for both.
//
//   node write_package.js --fragment frag.json --out package.txt [--trip their.json] [--base b.json]
//
// `make_package.py` calls this after it has checked the plan. It exists because a prediction made
// by anything other than `mergePackage` is a guess: the merge has rules about silence, baselines,
// opening hours and running orders that are easy to restate wrongly and were, until this replaced
// a hand-written copy of them.

'use strict';

const fs = require('fs');
const path = require('path');
const C = require(path.join(__dirname, '..', 'vendor', 'core.js'));

const PLAN_KEYS = ['less', 'balanced', 'packed'];

function die(message) {
  process.stderr.write('Cannot write it: ' + message + '\n');
  process.exit(2);
}

function slurp(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch (e) {
    die(e.code === 'ENOENT' ? 'there is no file called "' + file + '".' : e.message);
  }
  return '';
}

function envelopeOf(file) {
  const found = C.findPayload(slurp(file));
  if (!found.body) die(file + ' holds no day-planner block and no JSON.');
  try { return JSON.parse(found.body); } catch (e) { die(file + ' is damaged: ' + e.message); }
  return null;
}

function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) o[a.slice(2)] = argv[i + 1] !== undefined && !String(argv[i + 1]).startsWith('--')
      ? argv[++i] : true;
    else die('I do not know what "' + a + '" is for.');
  }
  return o;
}

// ---------- what the merge did, field by field ----------

const LISTS = {
  places: { fields: C.PLACE_FIELDS, of: C.placeFields, scope: 'place' },
  days: { fields: C.DAY_FIELDS, of: C.dayFields, scope: 'day' },
};

function nameOf(scope, id, thing) {
  return scope === 'day' ? C.fmtDateUK(id) : (thing && thing.name) || id;
}

function told(said, kind, id) {
  return C.arr ? (((said || {})[kind] || {})[id] || []) : [];
}

function weigh(current, incoming, dry, said) {
  const out = { fresh: [], lands: [], asks: [], moot: [], same: [] };
  const asked = {};
  for (const c of dry.conflicts) asked[c.key] = c;

  for (const [kind, spec] of Object.entries(LISTS)) {
    const theirs = (incoming && incoming[kind]) || {};
    const mine = (current && current[kind]) || {};
    const after = (dry.trip && dry.trip[kind]) || {};
    for (const id of Object.keys(theirs)) {
      const label = nameOf(spec.scope, id, mine[id] || theirs[id]);
      if (!mine[id]) {
        if (!after[id]) out.fresh.push({ scope: spec.scope, id, label, gone: true });
        continue;                       // the planner reports what it added itself
      }
      const q = asked[spec.scope + ':' + id];
      if (q) out.asks.push({ scope: spec.scope, id, label, fields: q.fields });
      // What landed is the planner's own account, in its own words. What did *not* land it has no
      // reason to mention, so those two are worked out by comparing before with after.
      const spoke = told(said, kind, id);
      const was = spec.of(mine[id]), now = spec.of(after[id] || mine[id]), sent = spec.of(theirs[id]);
      const ignored = [], already = [];
      for (const k of spec.fields) {
        if (spoke.length && !spoke.includes(k)) continue;
        if (q && q.fields.some((f) => f.key === k)) continue;
        if (!C.same(was[k], now[k])) continue;
        (C.same(was[k], sent[k]) ? already : ignored).push(C.FIELD_LABEL[k] || k);
      }
      if (ignored.length) out.moot.push({ label, fields: ignored });
      if (already.length && !ignored.length && !q) out.same.push({ label, fields: already });
    }
  }
  return out;
}

function valueText(v) {
  if (v === null || v === undefined || v === '') return '(nothing)';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'number' || typeof v === 'string') {
    const s = String(v);
    return s.length <= 48 ? s : s.slice(0, 47) + '…';
  }
  if (v && typeof v === 'object' && !Array.isArray(v) && PLAN_KEYS.every((k) => k in v)) {
    return PLAN_KEYS.filter((k) => (v[k] || []).length)
      .map((k) => k + ': ' + v[k].join(' → ')).join('; ') || '(empty)';
  }
  const s = JSON.stringify(v);
  return s.length <= 64 ? s : s.slice(0, 63) + '…';
}

function report(out, dry, hasBase) {
  const pad = (s) => String(s).padEnd(24);
  console.log('WHAT THIS PACKAGE WILL DO');
  console.log('='.repeat(72));
  for (const f of out.fresh) {
    console.log('  ' + (f.gone ? 'NO USE  ' : 'NEW     ') + pad(f.id)
      + (f.gone ? 'they deleted this, and the planner keeps it deleted'
        : f.scope === 'day' ? 'a day their trip does not have yet' : 'arrives as a new place'));
  }
  for (const name of dry.report.added) console.log('  NEW     ' + pad(name) + 'arrives as a new place');
  for (const date of dry.report.newDays) console.log('  NEW     ' + pad(C.fmtDateUK(date)) + 'a day their trip does not have yet');
  for (const line of dry.report.updated) {
    const cut = line.indexOf(': ');
    console.log('  FILLS   ' + pad(line.slice(0, cut)) + line.slice(cut + 2));
  }
  for (const name of dry.report.restored) console.log('  BACK    ' + pad(name) + 'they deleted it, and this puts it back');
  for (const m of out.moot) console.log('  NO USE  ' + pad(m.label) + m.fields.join(', ') + ' — theirs stands');
  for (const s of out.same) console.log('  SAME    ' + pad(s.label) + s.fields.join(', ') + ' — they already have it');
  for (const text of dry.issues) console.log('  !       ' + text);

  console.log();
  if (!out.asks.length) {
    console.log('  NOTHING TO SETTLE. It all lands without a question.');
  } else {
    console.log('  THEY WILL BE ASKED ' + out.asks.length + ' question(s), one per place or day:');
    for (const a of out.asks) {
      console.log('    ' + a.label);
      for (const f of a.fields) {
        console.log('      ' + String(f.label).padEnd(18) + 'theirs ' + valueText(f.mine)
          + '   vs   yours ' + valueText(f.theirs));
      }
    }
  }
  if (!hasBase) {
    console.log();
    console.log('  No baseline, so this is the worst case: anything they have set and you disagree');
    console.log('  with counts as a question. A hand-back carries the baseline — pass it as --trip');
    console.log('  and it is used automatically.');
  }
}

function main() {
  const o = args(process.argv.slice(2));
  if (!o.fragment || !o.out) die('I need --fragment and --out.');
  const fragment = JSON.parse(slurp(o.fragment));

  const env = {
    schema: 'day-planner/2',
    kind: 'package',
    tripId: fragment.id,
    title: o.label || 'From the chat',
    at: o.at || new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    app: 'chat',
    trip: fragment,
  };
  env.sum = C.sumOf(env);
  const block = C.BEGIN_LINE + '\n' + JSON.stringify(env) + '\n' + C.END_LINE + '\n';
  fs.writeFileSync(o.out, block);
  const asJson = String(o.out).replace(/\.(txt|block)$/i, '') + '.json';
  fs.writeFileSync(asJson, JSON.stringify(env, null, 2) + '\n');

  const incoming = C.readBlock(block);
  if (!incoming.ok) die('the block I just wrote will not read back: ' + incoming.message);

  let current = null, base = null, hasBase = false;
  if (o.trip) {
    const theirEnv = envelopeOf(o.trip);
    if (!theirEnv.trip) die(o.trip + ' has no trip in it.');
    if (theirEnv.sum && C.sumOf(theirEnv) !== theirEnv.sum) {
      console.log('! ' + o.trip + ' fails its own checksum: it was changed somewhere on the way.');
      console.log('  Ask for it again before trusting anything below.');
      console.log();
    }
    current = C.normalise(theirEnv.trip).trip;
    const carried = theirEnv.handback && theirEnv.handback.base;
    const given = o.base ? (envelopeOf(o.base).trip || null) : null;
    const raw = given || carried;
    if (raw) { base = C.normalise(raw).trip; hasBase = true; }
  }

  if (!current) {
    console.log('NO TRIP TO MERGE INTO');
    console.log('='.repeat(72));
    console.log('  This package creates the trip, so everything in it arrives as new and nothing');
    console.log('  can be asked about.');
    if (!(fragment.stays || []).length) {
      console.log('  It carries no stays. Where they sleep is what gives every day a start and an');
      console.log('  end, so without one each day begins at 08:30 from nowhere in particular.');
    }
    console.log();
    const made = C.normalise(fragment).trip;
    console.log('  ' + C.summarise(made) + (made.stays.length ? ', ' + made.stays.length + ' stay(s)' : ''));
  } else {
    const dry = C.mergePackage(current, incoming.trip, base, {}, env.at, incoming.said);
    report(weigh(current, incoming.trip, dry, incoming.said), dry, hasBase);
  }

  console.log();
  console.log('Written to ' + o.out + ' and ' + asJson + '.');
  console.log('Give them the file if you can; the block is for pasting when a file will not do.');
  return 0;
}

process.exit(main());
