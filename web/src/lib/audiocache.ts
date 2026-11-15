// Cache des fichiers audio Google Drive (Cache Storage) : les titres déjà
// écoutés ou téléchargés se relisent sans réseau. Les plus anciens sont
// supprimés au-delà de la taille choisie, sauf ceux gardés hors ligne.
import * as db from './db';
import * as g from './google';
import { lib, type Track } from './library';
import { Observable } from './store';

const CACHE = 'choutify-audio-v1';
const keyUrl = (id: string) => new URL(`__audio/${encodeURIComponent(id)}`, location.href).href;

interface Entry {
  size: number;
  used: number;
  pinned?: boolean;
}

export const cacheState = new Observable<{ index: Record<string, Entry>; downloading: Record<string, number> }>({
  index: {},
  downloading: {},
});

let loaded: Promise<void> | null = null;
function ensureIndex() {
  if (!loaded) {
    loaded = db.get<Record<string, Entry>>('kv', 'audioIndex').then((index) => {
      cacheState.set({ index: index ?? {} });
    });
  }
  return loaded;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function saveIndex() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => db.put('kv', 'audioIndex', cacheState.get().index), 500);
}

function setEntry(id: string, e: Entry | null) {
  const index = { ...cacheState.get().index };
  if (e) index[id] = e;
  else delete index[id];
  cacheState.set({ index });
  saveIndex();
}

function setProgress(id: string, p: number | null) {
  const downloading = { ...cacheState.get().downloading };
  if (p == null) delete downloading[id];
  else downloading[id] = p;
  cacheState.set({ downloading });
}

export async function isCached(id: string) {
  await ensureIndex();
  return !!cacheState.get().index[id];
}

async function readCached(t: Track): Promise<Blob | null> {
  if (!('caches' in window)) return null;
  try {
    const cache = await caches.open(CACHE);
    const res = await cache.match(keyUrl(t.id));
    if (!res) {
      if (cacheState.get().index[t.id]) setEntry(t.id, null);
      return null;
    }
    const blob = await res.blob();
    const e = cacheState.get().index[t.id];
    setEntry(t.id, { size: blob.size, used: Date.now(), pinned: e?.pinned });
    return blob.type ? blob : new Blob([blob], { type: t.mime });
  } catch {
    return null;
  }
}

const inflight = new Map<string, Promise<Blob>>();

/** Renvoie le fichier audio d'un titre (cache, puis Google Drive). */
export async function getAudio(t: Track, opts: { pin?: boolean; signal?: AbortSignal } = {}): Promise<Blob> {
  if (t.source === 'local') {
    const blob = await db.get<Blob>('local', t.id);
    if (!blob) throw new Error('Fichier importé introuvable sur cet appareil.');
    return blob;
  }
  await ensureIndex();
  const hit = await readCached(t);
  if (hit) {
    if (opts.pin && !cacheState.get().index[t.id]?.pinned) setEntry(t.id, { size: hit.size, used: Date.now(), pinned: true });
    return hit;
  }
  let p = inflight.get(t.id);
  if (!p) {
    p = (async () => {
      setProgress(t.id, 0);
      try {
        const blob = await g.download(t.fileId!, t.size, t.mime, (x) => setProgress(t.id, x), opts.signal);
        await store(t, blob, !!opts.pin);
        return blob;
      } finally {
        setProgress(t.id, null);
        inflight.delete(t.id);
      }
    })();
    inflight.set(t.id, p);
  } else if (opts.pin) {
    p.then(() => {
      const e = cacheState.get().index[t.id];
      if (e) setEntry(t.id, { ...e, pinned: true });
    });
  }
  return p;
}

async function store(t: Track, blob: Blob, pinned: boolean) {
  if (!('caches' in window)) return;
  try {
    const cache = await caches.open(CACHE);
    await cache.put(
      keyUrl(t.id),
      new Response(blob, { headers: { 'Content-Type': t.mime, 'Content-Length': String(blob.size) } }),
    );
    setEntry(t.id, { size: blob.size, used: Date.now(), pinned });
    await evict();
  } catch {
    // Quota dépassé : on libère de la place et on continue sans cache.
    await evict(blob.size);
  }
}

async function evict(extra = 0) {
  const limit = lib.get().settings.cacheLimitMB * 1024 * 1024;
  const index = cacheState.get().index;
  let total = Object.values(index).reduce((a, e) => a + e.size, 0) + extra;
  if (total <= limit) return;
  const victims = Object.entries(index)
    .filter(([, e]) => !e.pinned)
    .sort((a, b) => a[1].used - b[1].used);
  const cache = await caches.open(CACHE);
  for (const [id, e] of victims) {
    if (total <= limit) break;
    await cache.delete(keyUrl(id));
    setEntry(id, null);
    total -= e.size;
  }
}

export async function unpin(ids: string[]) {
  await ensureIndex();
  for (const id of ids) {
    const e = cacheState.get().index[id];
    if (e?.pinned) setEntry(id, { ...e, pinned: false });
  }
  await evict();
}

export async function removeFromCache(ids: string[]) {
  await ensureIndex();
  const cache = await caches.open(CACHE);
  for (const id of ids) {
    await cache.delete(keyUrl(id));
    setEntry(id, null);
  }
}

export async function clearCache() {
  await caches.delete(CACHE);
  cacheState.set({ index: {} });
  await db.put('kv', 'audioIndex', {});
}

/** Garde une liste de titres hors ligne (album, playlist…). */
export async function downloadForOffline(tracks: Track[], onProgress?: (done: number, total: number) => void) {
  const drive = tracks.filter((t) => t.source === 'drive');
  let done = 0;
  let failed = 0;
  for (const t of drive) {
    try {
      await getAudio(t, { pin: true });
    } catch (e) {
      failed++;
      if (e instanceof g.AuthError) throw e;
    }
    onProgress?.(++done, drive.length);
  }
  return { done: done - failed, failed };
}

export function cacheUsage() {
  const index = cacheState.get().index;
  let total = 0,
    pinned = 0;
  for (const e of Object.values(index)) {
    total += e.size;
    if (e.pinned) pinned += e.size;
  }
  return { total, pinned, count: Object.keys(index).length };
}

ensureIndex();
