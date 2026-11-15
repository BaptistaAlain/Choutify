// Petit wrapper IndexedDB : bibliothèque, pochettes, fichiers importés et
// réglages restent sur l'appareil.

const DB_NAME = 'choutify';
const VERSION = 1;
export type Store = 'tracks' | 'covers' | 'local' | 'kv';

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of ['tracks', 'covers', 'local', 'kv']) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function get<T>(store: Store, key: string): Promise<T | undefined> {
  const db = await open();
  return wrap(db.transaction(store).objectStore(store).get(key));
}

export async function put(store: Store, key: string, value: unknown): Promise<void> {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value, key);
  await done(tx);
}

export async function putMany(store: Store, entries: [string, unknown][]): Promise<void> {
  if (!entries.length) return;
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  for (const [k, v] of entries) os.put(v, k);
  await done(tx);
}

export async function del(store: Store, key: string): Promise<void> {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  await done(tx);
}

export async function delMany(store: Store, keys: string[]): Promise<void> {
  if (!keys.length) return;
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  for (const k of keys) os.delete(k);
  await done(tx);
}

export async function all<T>(store: Store): Promise<T[]> {
  const db = await open();
  return wrap(db.transaction(store).objectStore(store).getAll() as IDBRequest<T[]>);
}

export async function keys(store: Store): Promise<string[]> {
  const db = await open();
  return wrap(db.transaction(store).objectStore(store).getAllKeys() as IDBRequest<string[]>);
}

export async function clear(store: Store): Promise<void> {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).clear();
  await done(tx);
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
