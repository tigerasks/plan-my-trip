/* SPDX-License-Identifier: AGPL-3.0-or-later */
/* Day planner v2 — talking to the outside services.
   Every one of them is free on the understanding that we are light on it: at most one request a
   second across the lot, answers cached in the page, and a failure that leaves the planner working.
   The queries themselves are built and read in core.js; this file only fetches. */
(function (root) {
'use strict';

const GAP = 1100;              // a little over the one request a second they ask for
const TIMEOUT = 20000;         // enough for Photon, OSRM and Transitous, which all answer in under a second
const BUSY = [429, 502, 503, 504];   // the service is up but will not take this request now
const BACKOFF = 2000;          // doubling from here, which is what Overpass asks for
const BACKOFF_MAX = 15000;     // but not doubling for ever: a refusal is worth outlasting, not chasing
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const Live = {
  last: 0,
  queue: Promise.resolve(),
  cache: new Map(),
  calls: 0,                    // the tests count these
  pending: 0,                  // calls asked for and not yet answered

  // Space the calls out, whatever asks for them. Requests queue rather than overlap.
  fetchJson(url, opts) {
    const key = String(url);
    if (this.cache.has(key)) return Promise.resolve(this.cache.get(key));
    this.pending++;
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
        if (!res.ok) {
          // The status is kept on the error so a caller can tell "come back later" from "no".
          const err = new Error('the service answered ' + res.status);
          err.status = res.status;
          throw err;
        }
        const json = await res.json();
        this.cache.set(key, json);
        return json;
      } finally {
        clearTimeout(timer);
      }
    });
    run.then(() => { this.pending--; }, () => { this.pending--; });
    // A failed call must not poison the queue for the next one.
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  },

  // Overpass asks to be retried with exponential backoff when it is at capacity, and by a busy
  // station it often is: three refusals in a row and then an answer, in the fifth service test.
  // A failure is never cached, so asking again is a fresh call that waits its turn like any other,
  // and the backoff happens outside the queue so nothing else is held up behind it.
  busy(err) { return BUSY.includes((err && err.status) || 0); },

  fetchPatiently(url, opts) {
    const tries = Math.max(1, Math.round((opts && opts.tries) || 1));
    const again = (left, wait) => this.fetchJson(url, opts).catch((err) => {
      if (left <= 1 || !this.busy(err)) throw err;
      // A 502 means the server is busy, and coming back soon is the right thing. A 429 means we
      // are the ones asking too much, so it waits the longest we ever wait rather than the
      // shortest: the point is to stop crowding, not to insist.
      const next = err.status === 429 ? BACKOFF_MAX : wait;
      return sleep(next).then(() => again(left - 1, Math.min(next * 2, BACKOFF_MAX)));
    });
    return again(tries, (opts && opts.backoff) || BACKOFF);
  },

  // Plain words for a failure, since the planner carries on either way.
  why(err) {
    const m = String((err && err.message) || err || '');
    if (/abort/i.test(m)) return 'it took too long to answer';
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'it could not be reached';
    return m || 'it did not answer';
  },

  // Nothing is waiting, so background work may take its turn without delaying anybody.
  idle() { return this.pending === 0; },

  forget() { this.cache.clear(); },
};

root.DayPlannerLive = Live;
})(window);
