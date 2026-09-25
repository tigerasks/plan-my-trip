/* SPDX-License-Identifier: AGPL-3.0-or-later */
/* Day planner v2 — talking to the outside services.
   Every one of them is free on the understanding that we are light on it: at most one request a
   second across the lot, answers cached in the page, and a failure that leaves the planner working.
   The queries themselves are built and read in core.js; this file only fetches. */
(function (root) {
'use strict';

const GAP = 1100;              // a little over the one request a second they ask for
const TIMEOUT = 20000;         // Overpass can take a couple of seconds, and sometimes much longer
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const Live = {
  last: 0,
  queue: Promise.resolve(),
  cache: new Map(),
  calls: 0,                    // the tests count these

  // Space the calls out, whatever asks for them. Requests queue rather than overlap.
  fetchJson(url, opts) {
    const key = String(url);
    if (this.cache.has(key)) return Promise.resolve(this.cache.get(key));
    const run = this.queue.then(async () => {
      if (this.cache.has(key)) return this.cache.get(key);
      const wait = this.last + GAP - Date.now();
      if (wait > 0) await sleep(wait);
      this.last = Date.now();
      this.calls++;
      const stop = new AbortController();
      const timer = setTimeout(() => stop.abort(), (opts && opts.timeout) || TIMEOUT);
      try {
        const res = await fetch(key, { signal: stop.signal });
        if (!res.ok) throw new Error('the service answered ' + res.status);
        const json = await res.json();
        this.cache.set(key, json);
        return json;
      } finally {
        clearTimeout(timer);
      }
    });
    // A failed call must not poison the queue for the next one.
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  },

  // Plain words for a failure, since the planner carries on either way.
  why(err) {
    const m = String((err && err.message) || err || '');
    if (/abort/i.test(m)) return 'it took too long to answer';
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'it could not be reached';
    return m || 'it did not answer';
  },

  forget() { this.cache.clear(); },
};

root.DayPlannerLive = Live;
})(window);
