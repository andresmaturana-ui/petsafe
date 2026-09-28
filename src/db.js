// Almacenamiento local en IndexedDB.
// Es la capa que se reemplaza por un backend real (Supabase/Firebase):
// mientras las funciones mantengan la misma firma, el resto de la app no cambia.

const DB_NAME = 'petsafe';
const DB_VERSION = 2;
export const STORES = ['users', 'pets', 'found', 'notifications', 'successes', 'comments', 'contacts', 'meta'];

let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const name of STORES) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        const result = fn(t.objectStore(store));
        t.oncomplete = () => resolve(result && 'result' in result ? result.result : result);
        t.onerror = () => reject(t.error);
      }),
  );
}

export const db = {
  all: (store) => tx(store, 'readonly', (s) => s.getAll()),
  get: (store, id) => tx(store, 'readonly', (s) => s.get(id)),
  put: (store, value) => tx(store, 'readwrite', (s) => s.put(value)).then(() => value),
  delete: (store, id) => tx(store, 'readwrite', (s) => s.delete(id)),
};

export function uid(prefix = '') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
