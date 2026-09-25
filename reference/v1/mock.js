(() => {
  // In-memory stand-in for claude.use("db"), following the 0.2.56 contract: cache-first then definitive
  // snapshots, own writes echoed with hasPendingWrites:true then confirmed, frozen data().
  const seed = __SEED__;
  const store = new Map();
  store.set('trips/demo', seed.trip);
  store.set('trips/demo/days/' + seed.dayId, seed.day);
  store.set('meta/focus', { tripId: 'demo', dayId: seed.dayId, at: '2026-09-24T12:00:00Z' });
  const listeners = [];
  const deep = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
  const freeze = (o) => { if (o && typeof o === 'object') { Object.values(o).forEach(freeze); Object.freeze(o); } return o; };
  const meta = (cache, pending) => ({ fromCache: !!cache, hasPendingWrites: !!pending });
  const docSnap = (path, o) => { const d = o.blank ? undefined : store.get(path); const body = d === undefined ? undefined : freeze(deep(d));
    return { id: path.split('/').pop(), exists: body !== undefined, data: () => body, metadata: meta(o.cache, o.pending) }; };
  const colSnap = (path, o) => { const n = path.split('/').length; const docs = [];
    if (!o.blank) for (const [k] of [...store.entries()].sort()) if (k.startsWith(path + '/') && k.split('/').length === n + 1) docs.push(docSnap(k, {}));
    return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: meta(o.cache, false) }; };
  const notify = (path, pending) => {
    for (const l of listeners.slice()) {
      if (l.kind === 'doc' && l.path === path) l.cb(docSnap(path, { pending }));
      if (l.kind === 'col' && path.startsWith(l.path + '/') && path.split('/').length === l.path.split('/').length + 1) l.cb(colSnap(l.path, {}));
    }
  };
  const sub = (path, kind, cb) => {
    const l = { path, kind, cb }; listeners.push(l);
    const mk = kind === 'doc' ? docSnap : colSnap;
    setTimeout(() => { if (listeners.includes(l)) cb(mk(path, { cache: true, blank: true })); }, 5);   // early cache view
    setTimeout(() => { if (listeners.includes(l)) cb(mk(path, {})); }, 90);                          // definitive
    window.__subs = (window.__subs || 0) + 1;
    return () => { const i = listeners.indexOf(l); if (i >= 0) { listeners.splice(i, 1); window.__subs--; } };
  };
  const db = {
    doc: (path) => ({ id: path.split('/').pop(), path,
      get: async () => docSnap(path, {}),
      set: async (data) => { window.__writes.push({ path, data: deep(data), t: Date.now() }); store.set(path, deep(data)); notify(path, true);
        await new Promise((r) => setTimeout(r, 40)); notify(path, false); },
      onSnapshot: (cb) => sub(path, 'doc', cb) }),
    collection: (path) => ({ path, get: async () => colSnap(path, {}), onSnapshot: (cb) => sub(path, 'col', cb) }),
  };
  window.__writes = []; window.__store = store;
  window.__chatWrite = (path, data) => { store.set(path, deep(data)); notify(path, false); };
  window.claude = { use: (name) => new Promise((res) => setTimeout(() => res(name === 'db' ? db : null), 20)) };
})();
