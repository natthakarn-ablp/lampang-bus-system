/**
 * Offline GPS buffer for the driver app.
 *
 * When the phone has no signal (or a send fails) the fix is queued here and
 * flushed later, oldest first, to POST /driver/vehicle-location/batch.
 *
 *   • IndexedDB (database "lampang-gps-buffer", store "queues") is preferred;
 *     localStorage is the fallback when IndexedDB is unavailable (private
 *     mode on some browsers, old WebViews).
 *   • One queue PER USER ID — a phone shared by two drivers must never send
 *     driver A's points under driver B's login (the server resolves the
 *     vehicle from the JWT, not from the point).
 *   • Capped at MAX_POINTS and MAX_AGE_MS: the oldest points are dropped first.
 *   • Points carry only coordinates/accuracy/speed/heading/time — no ids.
 *
 * All operations run through one promise chain so read-modify-write updates
 * from overlapping GPS callbacks cannot lose points.
 */

export const MAX_POINTS = 5000;
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const DB_NAME = 'lampang-gps-buffer';
const STORE = 'queues';
const LS_PREFIX = 'gps-buffer:';

let dbPromise = null;
function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function idbGet(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const r = tx.objectStore(STORE).get(key);
    r.onsuccess = () => resolve(Array.isArray(r.result) ? r.result : []);
    r.onerror = () => reject(r.error);
  });
}

function idbSet(db, key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function readQueue(key) {
  const db = await openDb();
  if (db) {
    try { return await idbGet(db, key); } catch { /* fall through to localStorage */ }
  }
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeQueue(key, list) {
  const db = await openDb();
  if (db) {
    try { await idbSet(db, key, list); return; } catch { /* fall through */ }
  }
  try {
    if (list.length) localStorage.setItem(LS_PREFIX + key, JSON.stringify(list));
    else localStorage.removeItem(LS_PREFIX + key);
  } catch { /* storage full / blocked — the point is lost, nothing else to do */ }
}

/** Keep newest MAX_POINTS within MAX_AGE_MS, oldest first. Pure. */
export function trimQueue(list, now = Date.now()) {
  const fresh = list.filter((p) => {
    const t = Date.parse(p?.recorded_at);
    return Number.isFinite(t) && now - t <= MAX_AGE_MS;
  });
  fresh.sort((a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at));
  return fresh.length > MAX_POINTS ? fresh.slice(fresh.length - MAX_POINTS) : fresh;
}

let chain = Promise.resolve();
function serial(fn) {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

const keyFor = (userId) => `u:${userId ?? 'anon'}`;

export function enqueuePoint(userId, point) {
  return serial(async () => {
    const key = keyFor(userId);
    const list = await readQueue(key);
    list.push(point);
    const trimmed = trimQueue(list);
    await writeQueue(key, trimmed);
    return trimmed.length;
  });
}

export function peekPoints(userId, limit) {
  return serial(async () => {
    const key = keyFor(userId);
    const trimmed = trimQueue(await readQueue(key));
    return trimmed.slice(0, limit);
  });
}

/** Remove the points just flushed (matched by recorded_at). Returns remaining count. */
export function removeSent(userId, recordedAts) {
  const sent = new Set(recordedAts);
  return serial(async () => {
    const key = keyFor(userId);
    const rest = trimQueue(await readQueue(key)).filter((p) => !sent.has(p.recorded_at));
    await writeQueue(key, rest);
    return rest.length;
  });
}

export function countPoints(userId) {
  return serial(async () => trimQueue(await readQueue(keyFor(userId))).length);
}
