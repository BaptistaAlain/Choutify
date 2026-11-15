// Bibliothèque : titres (Google Drive ou fichiers importés), analyse des
// dossiers, playlists, favoris et statistiques d'écoute.
import * as db from './db';
import * as g from './google';
import { Observable } from './store';
import { blobSource, bufferedSource, guessFromFilename, readTags, type AudioTags } from './tags';
import { makeCover, saveCover } from './covers';

export interface Track {
  id: string;
  source: 'drive' | 'local';
  fileId?: string;
  rootId?: string;
  folderId?: string;
  name: string;
  folder: string;
  title: string;
  artist: string;
  album: string;
  albumArtist?: string;
  genre?: string;
  year?: number;
  trackNo?: number;
  discNo?: number;
  durationMs?: number;
  size: number;
  mime: string;
  modified?: string;
  coverId?: string;
  addedAt: number;
}

export interface DriveSource {
  id: string;
  name: string;
}

export interface Playlist {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface Stat {
  p: number; // nombre d'écoutes
  l: number; // dernière écoute
}

export interface Settings {
  cacheLimitMB: number;
}

export interface ScanState {
  running: boolean;
  phase: string;
  done: number;
  total: number;
  error?: string;
}

interface LibState {
  ready: boolean;
  tracks: Map<string, Track>;
  version: number;
  sources: DriveSource[];
  playlists: Playlist[];
  likes: Set<string>;
  stats: Record<string, Stat>;
  settings: Settings;
  scan: ScanState;
  account: { name: string; email: string } | null;
}

export const lib = new Observable<LibState>({
  ready: false,
  tracks: new Map(),
  version: 0,
  sources: [],
  playlists: [],
  likes: new Set(),
  stats: {},
  settings: { cacheLimitMB: 2000 },
  scan: { running: false, phase: '', done: 0, total: 0 },
  account: null,
});

export const UNKNOWN_ARTIST = 'Artiste inconnu';
export const UNKNOWN_ALBUM = 'Album inconnu';

const AUDIO_EXT = /\.(mp3|m4a|aac|flac|wav|ogg|opus|oga|aif|aiff|alac|mp4)$/i;
const COVER_NAMES = /^(cover|folder|front|album|albumart|albumartsmall|pochette|jaquette)\.(jpe?g|png|webp)$/i;

export function norm(s: string) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

// ---------------------------------------------------------------- chargement

export async function loadLibrary() {
  const [tracks, sources, playlists, likes, stats, settings] = await Promise.all([
    db.all<Track>('tracks'),
    db.get<DriveSource[]>('kv', 'sources'),
    db.get<Playlist[]>('kv', 'playlists'),
    db.get<string[]>('kv', 'likes'),
    db.get<Record<string, Stat>>('kv', 'stats'),
    db.get<Settings>('kv', 'settings'),
  ]);
  lib.set((s) => ({
    ready: true,
    tracks: new Map(tracks.map((t) => [t.id, t])),
    version: s.version + 1,
    sources: sources ?? [],
    playlists: playlists ?? [],
    likes: new Set(likes ?? []),
    stats: stats ?? {},
    settings: { ...s.settings, ...settings },
  }));
  if (g.isConnected()) {
    g.getAbout()
      .then((account) => lib.set({ account }))
      .catch(() => {});
  }
}

function bump(mutate: (m: Map<string, Track>) => void) {
  lib.set((s) => {
    const m = new Map(s.tracks);
    mutate(m);
    return { tracks: m, version: s.version + 1 };
  });
}

// ------------------------------------------------------------ construction

function buildTrack(base: Omit<Track, 'title' | 'artist' | 'album'>, tags: AudioTags): Track {
  const guess = guessFromFilename(base.name);
  const folderName = base.folder.split('/').filter(Boolean).pop();
  return {
    ...base,
    title: tags.title || guess.title || base.name,
    artist: tags.artist || guess.artist || tags.albumArtist || UNKNOWN_ARTIST,
    album: tags.album || (base.source === 'drive' && folderName ? folderName : UNKNOWN_ALBUM),
    albumArtist: tags.albumArtist,
    genre: tags.genre,
    year: tags.year,
    trackNo: tags.trackNo ?? guess.trackNo,
    discNo: tags.discNo,
    durationMs: tags.durationMs,
  };
}

function mimeFor(name: string, fallback?: string) {
  if (fallback && fallback.startsWith('audio/')) return fallback;
  const ext = name.split('.').pop()?.toLowerCase();
  return (
    {
      mp3: 'audio/mpeg',
      m4a: 'audio/mp4',
      mp4: 'audio/mp4',
      aac: 'audio/aac',
      flac: 'audio/flac',
      wav: 'audio/wav',
      ogg: 'audio/ogg',
      oga: 'audio/ogg',
      opus: 'audio/ogg',
      aif: 'audio/aiff',
      aiff: 'audio/aiff',
    }[ext ?? ''] ?? 'audio/mpeg'
  );
}

async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

// ------------------------------------------------------------- Google Drive

export async function addSource(src: DriveSource) {
  const sources = lib.get().sources.filter((s) => s.id !== src.id).concat(src);
  lib.set({ sources });
  await db.put('kv', 'sources', sources);
  return scanDrive();
}

export async function removeSource(id: string) {
  const sources = lib.get().sources.filter((s) => s.id !== id);
  lib.set({ sources });
  await db.put('kv', 'sources', sources);
  const gone = [...lib.get().tracks.values()].filter((t) => t.rootId === id).map((t) => t.id);
  await db.delMany('tracks', gone);
  bump((m) => gone.forEach((k) => m.delete(k)));
}

let scanning: Promise<void> | null = null;

export function scanDrive(): Promise<void> {
  if (!scanning) {
    scanning = doScan().finally(() => {
      scanning = null;
    });
  }
  return scanning;
}

function setScan(p: Partial<ScanState>) {
  lib.set((s) => ({ scan: { ...s.scan, ...p } }));
}

interface Found {
  file: g.DriveFile;
  folder: string;
  folderId: string;
  rootId: string;
}

async function doScan() {
  const { sources } = lib.get();
  if (!sources.length || !g.isConnected()) return;
  setScan({ running: true, phase: 'Exploration des dossiers…', done: 0, total: 0, error: undefined });
  try {
    const found = new Map<string, Found>();
    const folderImages = new Map<string, g.DriveFile>();
    const visited = new Set<string>();
    let queue: { id: string; path: string; rootId: string }[] = sources.map((s) => ({ id: s.id, path: s.name, rootId: s.id }));
    let folders = 0;
    while (queue.length) {
      const next: typeof queue = [];
      await pool(queue, 4, async (f) => {
        if (visited.has(f.id)) return;
        visited.add(f.id);
        const children = await g.listChildren(f.id);
        folders++;
        setScan({ phase: `Exploration des dossiers… (${folders})` });
        for (const raw of children) {
          const c = g.resolveShortcut(raw);
          if (c.mimeType === g.FOLDER) {
            next.push({ id: c.id, path: `${f.path}/${c.name}`, rootId: f.rootId });
          } else if (AUDIO_EXT.test(c.name) || c.mimeType.startsWith('audio/')) {
            if (!found.has(c.id)) found.set(c.id, { file: c, folder: f.path, folderId: f.id, rootId: f.rootId });
          } else if (COVER_NAMES.test(c.name) && c.mimeType.startsWith('image/')) {
            const prev = folderImages.get(f.id);
            // Préfère cover.* / folder.* / front.* aux autres noms.
            if (!prev || /^(cover|folder|front)\./i.test(c.name)) folderImages.set(f.id, c);
          }
        }
      });
      queue = next;
    }

    const existing = new Map<string, Track>();
    for (const t of lib.get().tracks.values()) if (t.source === 'drive' && t.fileId) existing.set(t.fileId, t);

    // Titres disparus.
    const removed = [...existing.values()].filter((t) => !found.has(t.fileId!)).map((t) => t.id);
    if (removed.length) {
      await db.delMany('tracks', removed);
      bump((m) => removed.forEach((k) => m.delete(k)));
    }

    const toRead: Found[] = [];
    const moved: Track[] = [];
    for (const f of found.values()) {
      const old = existing.get(f.file.id);
      if (!old || old.modified !== f.file.modifiedTime || old.size !== Number(f.file.size ?? 0)) toRead.push(f);
      else if (old.folder !== f.folder || old.rootId !== f.rootId) moved.push({ ...old, folder: f.folder, folderId: f.folderId, rootId: f.rootId });
    }
    if (moved.length) {
      await db.putMany('tracks', moved.map((t) => [t.id, t]));
      bump((m) => moved.forEach((t) => m.set(t.id, t)));
    }

    setScan({ phase: 'Lecture des titres', done: 0, total: toRead.length });
    const folderCover = new Map<string, Promise<string | undefined>>();
    const pictureCovers = new Set<string>();
    const foldersWithPicture = new Set<string>();
    let batch: Track[] = [];
    let done = 0;
    const flush = async () => {
      const b = batch;
      batch = [];
      if (!b.length) return;
      await db.putMany('tracks', b.map((t) => [t.id, t]));
      bump((m) => b.forEach((t) => m.set(t.id, t)));
    };

    const coverFromFolder = (folderId: string) => {
      const img = folderImages.get(folderId);
      if (!img) return Promise.resolve(undefined);
      let p = folderCover.get(folderId);
      if (!p) {
        p = (async () => {
          const id = `f:${img.id}:${img.modifiedTime ?? ''}`;
          try {
            if (await db.get('covers', id)) return id;
            const blob = await g.download(img.id, Number(img.size ?? 0), img.mimeType);
            const rec = await makeCover(blob);
            if (!rec) return undefined;
            await saveCover(id, rec);
            return id;
          } catch {
            return undefined;
          }
        })();
        folderCover.set(folderId, p);
      }
      return p;
    };

    await pool(toRead, 6, async (f) => {
      const size = Number(f.file.size ?? 0);
      let tags: AudioTags = {};
      try {
        const src = bufferedSource(size, (s, e) => g.fetchRange(f.file.id, s, e));
        // Si le dossier a déjà sa pochette, inutile de télécharger l'image
        // intégrée des titres suivants : on ne lit que le début du tag.
        const partial = foldersWithPicture.has(f.folderId);
        tags = await readTags(src, f.file.name, partial ? 160 * 1024 : undefined);
        if (partial && !tags.title) tags = await readTags(src, f.file.name);
      } catch (e) {
        if (e instanceof g.AuthError) throw e;
      }
      const base = {
        id: `d:${f.file.id}`,
        source: 'drive' as const,
        fileId: f.file.id,
        rootId: f.rootId,
        folderId: f.folderId,
        name: f.file.name,
        folder: f.folder,
        size,
        mime: mimeFor(f.file.name, f.file.mimeType),
        modified: f.file.modifiedTime,
        addedAt: existing.get(f.file.id)?.addedAt ?? Date.now(),
      };
      const track = buildTrack(base, tags);
      if (tags.picture) {
        const coverId = `p:${f.folderId}:${norm(track.album)}`;
        if (!pictureCovers.has(coverId)) {
          pictureCovers.add(coverId);
          const rec = await makeCover(new Blob([tags.picture as Uint8Array<ArrayBuffer>], { type: tags.pictureMime }));
          if (rec) await saveCover(coverId, rec);
          else pictureCovers.delete(coverId);
        }
        if (pictureCovers.has(coverId)) {
          track.coverId = coverId;
          foldersWithPicture.add(f.folderId);
        }
      }
      if (!track.coverId) track.coverId = await coverFromFolder(f.folderId);
      batch.push(track);
      done++;
      setScan({ done });
      if (batch.length >= 25) await flush();
    });
    await flush();
    await fillMissingCovers();
    setScan({ running: false, phase: '', done: 0, total: 0 });
    await db.put('kv', 'lastScan', Date.now());
    window.dispatchEvent(new Event('choutify:scanned'));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setScan({ running: false, phase: '', error: msg });
    throw e;
  }
}

/** Donne aux titres sans pochette celle d'un autre titre du même album. */
async function fillMissingCovers() {
  const byAlbum = new Map<string, string>();
  const tracks = [...lib.get().tracks.values()];
  for (const t of tracks) if (t.coverId) byAlbum.set(albumKey(t), t.coverId);
  const fixed: Track[] = [];
  for (const t of tracks) {
    if (!t.coverId) {
      const c = byAlbum.get(albumKey(t));
      if (c) fixed.push({ ...t, coverId: c });
    }
  }
  if (fixed.length) {
    await db.putMany('tracks', fixed.map((t) => [t.id, t]));
    bump((m) => fixed.forEach((t) => m.set(t.id, t)));
  }
}

// --------------------------------------------------------- fichiers locaux

export async function importFiles(files: File[]) {
  const audio = files.filter((f) => AUDIO_EXT.test(f.name) || f.type.startsWith('audio/'));
  if (!audio.length) return 0;
  setScan({ running: true, phase: 'Import des fichiers', done: 0, total: audio.length, error: undefined });
  const existing = new Set([...lib.get().tracks.values()].filter((t) => t.source === 'local').map((t) => `${t.name}|${t.size}`));
  let done = 0;
  const added: Track[] = [];
  try {
    for (const file of audio) {
      done++;
      setScan({ done });
      if (existing.has(`${file.name}|${file.size}`)) continue;
      const id = `l:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      const tags = await readTags(blobSource(file), file.name);
      const track = buildTrack(
        {
          id,
          source: 'local',
          name: file.name,
          folder: 'Fichiers importés',
          size: file.size,
          mime: mimeFor(file.name, file.type),
          addedAt: Date.now(),
        },
        tags,
      );
      if (tags.picture) {
        const coverId = `p:local:${norm(track.albumArtist || track.artist)}:${norm(track.album)}`;
        const rec = await makeCover(new Blob([tags.picture as Uint8Array<ArrayBuffer>], { type: tags.pictureMime }));
        if (rec) {
          await saveCover(coverId, rec);
          track.coverId = coverId;
        }
      }
      await db.put('local', id, file);
      await db.put('tracks', id, track);
      added.push(track);
      bump((m) => m.set(id, track));
    }
    await fillMissingCovers();
  } finally {
    setScan({ running: false, phase: '', done: 0, total: 0 });
  }
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  return added.length;
}

export async function deleteTracks(ids: string[]) {
  await db.delMany('tracks', ids);
  await db.delMany('local', ids.filter((i) => i.startsWith('l:')));
  bump((m) => ids.forEach((k) => m.delete(k)));
}

export async function updateTrack(id: string, patch: Partial<Track>) {
  const t = lib.get().tracks.get(id);
  if (!t) return;
  const next = { ...t, ...patch };
  await db.put('tracks', id, next);
  bump((m) => m.set(id, next));
}

// ---------------------------------------------------------------- dérivés

export interface Album {
  key: string;
  title: string;
  artist: string;
  year?: number;
  coverId?: string;
  tracks: Track[];
  addedAt: number;
}

export interface Artist {
  name: string;
  tracks: Track[];
  albums: Album[];
  coverId?: string;
}

export function albumKey(t: Track) {
  return `${norm(t.album)}\u0001${t.albumArtist ? norm(t.albumArtist) : t.folderId ?? t.folder}`;
}

export function compareTracks(a: Track, b: Track) {
  return (a.discNo ?? 1) - (b.discNo ?? 1) || (a.trackNo ?? 999) - (b.trackNo ?? 999) || a.title.localeCompare(b.title, 'fr');
}

export function splitArtists(s: string) {
  return s
    .split(/\s*(?:,|;|\/|&|\bfeat\.?|\bft\.?|\bfeaturing\b)\s*/i)
    .map((x) => x.trim())
    .filter(Boolean);
}

let derivedVersion = -1;
let derived: { albums: Album[]; albumMap: Map<string, Album>; artists: Artist[]; artistMap: Map<string, Artist>; genres: Map<string, Track[]>; all: Track[] };

export function getDerived() {
  const s = lib.get();
  if (derivedVersion === s.version) return derived;
  derivedVersion = s.version;
  const all = [...s.tracks.values()].sort((a, b) => a.title.localeCompare(b.title, 'fr'));
  const albumMap = new Map<string, Album>();
  for (const t of all) {
    const k = albumKey(t);
    let a = albumMap.get(k);
    if (!a) {
      a = { key: k, title: t.album, artist: t.albumArtist || t.artist, tracks: [], addedAt: t.addedAt };
      albumMap.set(k, a);
    }
    a.tracks.push(t);
    a.coverId ??= t.coverId;
    a.year ??= t.year;
    a.addedAt = Math.max(a.addedAt, t.addedAt);
  }
  for (const a of albumMap.values()) {
    a.tracks.sort(compareTracks);
    if (!a.tracks[0].albumArtist) {
      const artists = new Set(a.tracks.map((t) => splitArtists(t.artist)[0] ?? t.artist));
      a.artist = artists.size > 3 ? 'Artistes variés' : [...artists].slice(0, 2).join(', ');
    }
  }
  const albums = [...albumMap.values()].sort((a, b) => a.title.localeCompare(b.title, 'fr'));
  const artistMap = new Map<string, Artist>();
  for (const t of all) {
    const names = new Set([...splitArtists(t.artist), ...(t.albumArtist ? [t.albumArtist] : [])]);
    for (const n of names) {
      const k = norm(n);
      let ar = artistMap.get(k);
      if (!ar) {
        ar = { name: n, tracks: [], albums: [] };
        artistMap.set(k, ar);
      }
      ar.tracks.push(t);
      ar.coverId ??= t.coverId;
    }
  }
  for (const ar of artistMap.values()) {
    const seen = new Set<string>();
    for (const t of ar.tracks) {
      const k = albumKey(t);
      if (!seen.has(k)) {
        seen.add(k);
        ar.albums.push(albumMap.get(k)!);
      }
    }
    ar.albums.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  }
  const artists = [...artistMap.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const genres = new Map<string, Track[]>();
  for (const t of all) {
    if (!t.genre) continue;
    for (const gname of t.genre.split(/\s*[,;/]\s*/)) {
      if (!gname) continue;
      const list = genres.get(gname) ?? [];
      list.push(t);
      genres.set(gname, list);
    }
  }
  derived = { albums, albumMap, artists, artistMap, genres, all };
  return derived;
}

export function search(query: string) {
  const q = norm(query);
  if (!q) return null;
  const words = q.split(/\s+/);
  const match = (s: string) => {
    const n = norm(s);
    return words.every((w) => n.includes(w));
  };
  const d = getDerived();
  return {
    tracks: d.all.filter((t) => match(`${t.title} ${t.artist} ${t.album}`)).slice(0, 100),
    albums: d.albums.filter((a) => match(`${a.title} ${a.artist}`)).slice(0, 30),
    artists: d.artists.filter((a) => match(a.name)).slice(0, 30),
    playlists: lib.get().playlists.filter((p) => match(p.name)),
  };
}

// ------------------------------------------------------- playlists, favoris

/** Signale une modification à synchroniser (playlists, favoris, écoutes). */
function userDataChanged() {
  window.dispatchEvent(new Event('choutify:userdata'));
}

async function savePlaylists(playlists: Playlist[]) {
  lib.set({ playlists });
  await db.put('kv', 'playlists', playlists);
  userDataChanged();
}

export async function createPlaylist(name: string, trackIds: string[] = []) {
  const p: Playlist = { id: `pl${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, trackIds, createdAt: Date.now(), updatedAt: Date.now() };
  await savePlaylists([...lib.get().playlists, p]);
  return p;
}

export async function updatePlaylist(id: string, patch: Partial<Playlist>) {
  await savePlaylists(lib.get().playlists.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p)));
}

export async function addToPlaylist(id: string, trackIds: string[]) {
  const p = lib.get().playlists.find((x) => x.id === id);
  if (!p) return 0;
  const have = new Set(p.trackIds);
  const add = trackIds.filter((t) => !have.has(t));
  await updatePlaylist(id, { trackIds: [...p.trackIds, ...add] });
  return add.length;
}

export async function deletePlaylist(id: string) {
  await savePlaylists(lib.get().playlists.filter((p) => p.id !== id));
}

export async function toggleLike(id: string) {
  const likes = new Set(lib.get().likes);
  if (likes.has(id)) likes.delete(id);
  else likes.add(id);
  lib.set({ likes });
  await db.put('kv', 'likes', [...likes]);
  userDataChanged();
  return likes.has(id);
}

let statsTimer: ReturnType<typeof setTimeout> | undefined;
export function recordPlay(id: string) {
  const stats = { ...lib.get().stats };
  const s = stats[id] ?? { p: 0, l: 0 };
  stats[id] = { p: s.p + 1, l: Date.now() };
  lib.set({ stats });
  clearTimeout(statsTimer);
  statsTimer = setTimeout(() => db.put('kv', 'stats', lib.get().stats), 1000);
  userDataChanged();
}

export async function saveSettings(patch: Partial<Settings>) {
  const settings = { ...lib.get().settings, ...patch };
  lib.set({ settings });
  await db.put('kv', 'settings', settings);
}

export async function resetLibrary() {
  await Promise.all([db.clear('tracks'), db.clear('covers'), db.clear('local')]);
  await db.put('kv', 'sources', []);
  lib.set((s) => ({ tracks: new Map(), sources: [], version: s.version + 1 }));
}
