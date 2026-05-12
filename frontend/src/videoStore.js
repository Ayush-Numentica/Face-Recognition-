/**
 * videoStore.js
 * ─────────────
 * Thin wrapper around IndexedDB for storing/retrieving the idle background
 * video blob.  IndexedDB has no practical size limit, unlike localStorage.
 */

const DB_NAME    = 'facerecog_db';
const STORE_NAME = 'idle_video';
const KEY        = 'video';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

/** Save a Blob to IndexedDB. Pass null to clear. */
export async function saveVideoBlob(blob) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req   = blob ? store.put(blob, KEY) : store.delete(KEY);
    req.onsuccess = () => resolve();
    req.onerror   = e => reject(e.target.error);
  });
}

/** Save a plain string URL (e.g. https://…) to IndexedDB. Pass '' to clear. */
export async function saveVideoUrl(url) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req   = url ? store.put(url, KEY) : store.delete(KEY);
    req.onsuccess = () => resolve();
    req.onerror   = e => reject(e.target.error);
  });
}

/**
 * Load the stored video and return an object URL (or plain URL string).
 * Returns '' if nothing is stored.
 */
export async function loadVideoSrc() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req   = store.get(KEY);
    req.onsuccess = e => {
      const val = e.target.result;
      if (!val)              return resolve('');
      if (typeof val === 'string') return resolve(val);          // plain URL
      resolve(URL.createObjectURL(val));                          // Blob → object URL
    };
    req.onerror = e => reject(e.target.error);
  });
}

/** Clear stored video. */
export async function clearVideo() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req   = store.delete(KEY);
    req.onsuccess = () => resolve();
    req.onerror   = e => reject(e.target.error);
  });
}
