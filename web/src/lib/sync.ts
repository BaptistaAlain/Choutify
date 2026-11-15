// Synchronisation des playlists, titres aimés et écoutes avec les autres
// appareils (l'app Windows notamment) via le dossier « Choutify-synchro » de
// Google Drive. La logique de fusion est dans synccore.ts.
import * as db from './db';
import * as g from './google';
import { lib, type Playlist, type Stat, type Track } from './library';
import { Observable } from './store';
import * as core from './synccore';

export interface SyncDevice {
  name: string;
  updated: number;
  self: boolean;
}

export interface SyncStatus {
  running: boolean;
  last?: number;
  error?: string;
  /** Chemin du dossier de synchronisation, pour l'affichage. */
  folder?: string;
  devices: SyncDevice[];
}

export const syncState = new Observable<SyncStatus>({ running: false, devices: [] });

/** Correspondance entre un dossier source et le dossier de synchronisation. */
interface SourceMap {
  prefix: string[];
  strip: string[];
}

interface Place {
  folderId: string;
  folderPath: string;
  sourcesSig: string;
  sources: Record<string, SourceMap>;
}

interface Saved {
  deviceId: string;
  fileId?: string;
  place?: Place;
  doc: core.SyncDoc;
  base: core.SyncBase;
  written?: string;
  last?: number;
}

const KEY = 'sync';
let saved: Saved | null = null;
const remoteCache = new Map<string, { modified?: string; doc: core.SyncDoc }>();

async function loadSaved(): Promise<Saved> {
  if (saved) return saved;
  const s = await db.get<Saved>('kv', KEY);
  saved = s ?? {
    deviceId: Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4),
    doc: core.emptyDoc(),
    base: core.emptyBase(),
  };
  return saved;
}

async function persist() {
  if (saved) await db.put('kv', KEY, saved);
}

function deviceName() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/Android/.test(ua)) return 'Android (web)';
  return 'Navigateur';
}

export function isAvailable() {
  return g.isConnected() && lib.get().sources.length > 0;
}

// ------------------------------------------------------ dossier de synchro

type Node = { id: string; name: string };

async function chainOf(id: string, cache: Map<string, Node & { parent?: string }>): Promise<Node[]> {
  const out: Node[] = [];
  let cur: string | undefined = id;
  for (let i = 0; cur && i < 40; i++) {
    let m = cache.get(cur);
    if (!m) {
      const meta = await g.getMeta(cur);
      m = { id: meta.id, name: meta.name, parent: meta.parents?.[0] };
      cache.set(cur, m);
      cache.set(meta.id, m);
    }
    out.push({ id: m.id, name: m.name });
    cur = m.parent;
  }
  return out;
}

function mapSource(sourceChain: Node[], parentChain: Node[]): SourceMap | null {
  const idx = sourceChain.findIndex((n) => n.id === parentChain[0].id);
  // Dossier de synchro au-dessus de (ou dans) la source.
  if (idx >= 0) return { prefix: sourceChain.slice(0, idx).map((n) => n.name).reverse(), strip: [] };
  // Dossier de synchro dans un sous-dossier de la source.
  const j = parentChain.findIndex((n) => n.id === sourceChain[0].id);
  if (j >= 1) return { prefix: [], strip: parentChain.slice(0, j).map((n) => n.name).reverse() };
  return null;
}

async function locate(): Promise<Place> {
  const { sources } = lib.get();
  const cache = new Map<string, Node & { parent?: string }>();
  const chains = new Map<string, Node[]>();
  for (const s of sources) chains.set(s.id, await chainOf(s.id, cache));
  const sig = sources.map((s) => s.id).join(',');

  const build = async (folderId: string, parentId: string): Promise<Place | null> => {
    const pc = await chainOf(parentId, cache);
    const maps: Record<string, SourceMap> = {};
    for (const s of sources) {
      const m = mapSource(chains.get(s.id)!, pc);
      if (m) maps[s.id] = m;
    }
    if (!Object.keys(maps).length) return null;
    const path = [...pc.map((n) => n.name).reverse(), core.SYNC_DIR].join(' › ');
    return { folderId, folderPath: path, sourcesSig: sig, sources: maps };
  };

  const found = (await g.findFoldersNamed(core.SYNC_DIR)).sort((a, b) => (a.createdTime ?? '').localeCompare(b.createdTime ?? ''));
  let best: Place | null = null;
  for (const f of found) {
    const parent = f.parents?.[0];
    if (!parent) continue;
    const p = await build(f.id, parent).catch(() => null);
    if (p && (!best || Object.keys(p.sources).length > Object.keys(best.sources).length)) best = p;
  }
  if (best) return best;
  // Aucun dossier : on le crée dans le premier dossier de musique.
  const first = chains.get(sources[0].id)![0];
  const created = await g.createFolder(core.SYNC_DIR, first.id);
  return (await build(created.id, first.id))!;
}

// ---------------------------------------------------------------- clés

function keyOf(t: Track, place: Place): string | null {
  if (t.source !== 'drive' || !t.rootId) return null;
  const m = place.sources[t.rootId];
  if (!m) return null;
  const src = lib.get().sources.find((s) => s.id === t.rootId);
  if (!src) return null;
  if (t.folder !== src.name && !t.folder.startsWith(`${src.name}/`)) return null;
  const rest = t.folder === src.name ? [] : t.folder.slice(src.name.length + 1).split('/');
  for (let i = 0; i < m.strip.length; i++) if (rest[i] !== m.strip[i]) return null;
  return core.syncKey([...m.prefix, ...rest.slice(m.strip.length), t.name].join('/'));
}

// -------------------------------------------------------------- synchro

let running: Promise<void> | null = null;
let again = false;

/** Lance une synchronisation (une seule à la fois). */
export function syncNow(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = doSync()
    .catch((e) => {
      syncState.set({ error: e instanceof Error ? e.message : String(e) });
      throw e;
    })
    .finally(() => {
      running = null;
      syncState.set({ running: false });
      if (again) {
        again = false;
        syncNow().catch(() => {});
      }
    });
  return running;
}

async function doSync() {
  if (!isAvailable() || !g.canWrite()) return;
  syncState.set({ running: true });
  const s = await loadSaved();
  const sig = lib.get().sources.map((x) => x.id).join(',');
  if (!s.place || s.place.sourcesSig !== sig) s.place = await locate();
  const own = `web-${s.deviceId}.json`;

  // 1. Lecture des fichiers des autres appareils (et du nôtre).
  let files: g.DriveFile[];
  try {
    files = await g.listChildren(s.place.folderId);
  } catch {
    s.place = await locate();
    files = await g.listChildren(s.place.folderId);
  }
  const place = s.place;
  const remotes: core.SyncDoc[] = [];
  const devices: SyncDevice[] = [];
  for (const f of files) {
    if (!f.name.endsWith('.json') || f.mimeType === g.FOLDER) continue;
    if (f.name === own && !s.fileId) s.fileId = f.id;
    let entry = remoteCache.get(f.id);
    if (!entry || entry.modified !== f.modifiedTime) {
      try {
        const doc = core.parseDoc(JSON.parse(await g.downloadText(f.id)));
        if (!doc) continue;
        entry = { modified: f.modifiedTime, doc };
        remoteCache.set(f.id, entry);
      } catch {
        continue; // fichier en cours d'écriture ou abîmé : il sera relu la prochaine fois
      }
    }
    remotes.push(entry.doc);
    if (f.name !== own && entry.doc.device) devices.push({ name: entry.doc.device.name, updated: entry.doc.device.updated, self: false });
  }

  // 2. Fusion (synchrone : aucune modification locale ne peut s'intercaler).
  const now = Date.now();
  const st = lib.get();
  const keyById = new Map<string, string>();
  const idByKey = new Map<string, string>();
  for (const t of st.tracks.values()) {
    const k = keyOf(t, place);
    if (!k) continue;
    keyById.set(t.id, k);
    if (!idByKey.has(k)) idByKey.set(k, t.id);
  }
  const known = new Set(idByKey.keys());
  const toKeys = (ids: Iterable<string>) => [...ids].map((id) => keyById.get(id)).filter((k): k is string => !!k);
  const plays: core.LocalView['plays'] = {};
  for (const [id, v] of Object.entries(st.stats)) {
    const k = keyById.get(id);
    if (k && idByKey.get(k) === id) plays[k] = { count: v.p, last: v.l };
  }
  const view: core.LocalView = {
    likes: toKeys(st.likes),
    playlists: st.playlists.map((p) => ({ id: p.id, name: p.name, createdAt: p.createdAt, keys: toKeys(p.trackIds) })),
    plays,
    known,
  };
  let doc = core.applyLocal(s.doc, s.base, view, s.deviceId, now);
  for (const r of remotes) doc = core.mergeDocs(doc, r);
  const proj = core.project(doc, known);
  const synced = (id: string) => keyById.has(id);

  const likes = new Set([...[...st.likes].filter((id) => !synced(id)), ...proj.likes.map((k) => idByKey.get(k)!)]);
  const oldById = new Map(st.playlists.map((p) => [p.id, p]));
  const playlists: Playlist[] = proj.playlists.map((pp) => {
    const old = oldById.get(pp.id);
    const ids = pp.keys.map((k) => idByKey.get(k)!);
    const trackIds = old ? core.keepUnsynced(old.trackIds, ids, synced) : ids;
    if (old && old.name === pp.name && sameList(old.trackIds, trackIds)) return old;
    return { id: pp.id, name: pp.name, trackIds, createdAt: old?.createdAt ?? pp.createdAt, updatedAt: now };
  });
  const stats: Record<string, Stat> = { ...st.stats };
  for (const [k, v] of Object.entries(proj.plays)) stats[idByKey.get(k)!] = { p: v.count, l: v.last };

  const patch: Partial<typeof st> = {};
  if (!sameList([...st.likes], [...likes])) patch.likes = likes;
  if (playlists.length !== st.playlists.length || playlists.some((p, i) => p !== st.playlists[i])) patch.playlists = playlists;
  if (JSON.stringify(stats) !== JSON.stringify(st.stats)) patch.stats = stats;
  if (Object.keys(patch).length) lib.set(patch);
  s.doc = doc;
  s.base = core.baseFrom(proj);
  await Promise.all([
    patch.likes ? db.put('kv', 'likes', [...likes]) : null,
    patch.playlists ? db.put('kv', 'playlists', playlists) : null,
    patch.stats ? db.put('kv', 'stats', stats) : null,
    persist(),
  ]);

  // 3. Écriture de notre fichier si quelque chose a changé.
  const body = core.canonicalJson(doc);
  if (body !== s.written || !s.fileId) {
    const content = core.canonicalJson({ ...doc, device: { id: s.deviceId, name: deviceName(), updated: now } });
    let f = s.fileId ? await g.updateJsonFile(s.fileId, content) : null;
    if (!f) f = await g.createJsonFile(own, place.folderId, content);
    s.fileId = f.id;
    s.written = body;
  }
  s.last = now;
  await persist();
  syncState.set({ last: now, error: undefined, folder: place.folderPath, devices: [{ name: deviceName(), updated: now, self: true }, ...devices] });
}

function sameList(a: string[], b: string[]) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

// ------------------------------------------------------------ déclencheurs

let timer: ReturnType<typeof setTimeout> | undefined;
function syncSoon(ms: number) {
  clearTimeout(timer);
  timer = setTimeout(() => syncNow().catch(() => {}), ms);
}

/** À appeler une fois la bibliothèque chargée. */
export async function startSync() {
  const s = await loadSaved().catch(() => null);
  if (s?.place) syncState.set({ folder: s.place.folderPath, last: s.last });
  window.addEventListener('choutify:userdata', () => syncSoon(4000));
  window.addEventListener('choutify:scanned', () => syncSoon(500));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - (syncState.get().last ?? 0) > 60_000) syncSoon(1000);
  });
  setInterval(() => {
    if (document.visibilityState === 'visible') syncNow().catch(() => {});
  }, 3 * 60_000);
  syncSoon(1500);
}

/** Oublie le dossier de synchronisation (après changement de compte, par exemple). */
export async function resetSyncPlace() {
  const s = await loadSaved();
  s.place = undefined;
  s.fileId = undefined;
  s.written = undefined;
  await persist();
}
