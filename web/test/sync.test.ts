// Synchronisation côté web, avec un faux Google Drive en mémoire.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const kv = new Map<string, unknown>();
vi.mock('../src/lib/db', () => ({
  get: async (_s: string, k: string) => kv.get(k),
  put: async (_s: string, k: string, v: unknown) => void kv.set(k, structuredClone(v)),
  putMany: async () => {},
  delMany: async () => {},
  all: async () => [],
  clear: async () => {},
}));

interface FakeFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  content?: string;
  modifiedTime: string;
  createdTime: string;
}
const drive = new Map<string, FakeFile>();
let tick = 0;
const stamp = () => new Date(Date.UTC(2026, 0, 1) + ++tick * 1000).toISOString();
const FOLDER = 'application/vnd.google-apps.folder';
const add = (f: Omit<FakeFile, 'modifiedTime' | 'createdTime'>) => drive.set(f.id, { ...f, modifiedTime: stamp(), createdTime: stamp() });

vi.mock('../src/lib/google', () => ({
  FOLDER: 'application/vnd.google-apps.folder',
  AuthError: class extends Error {},
  isConnected: () => true,
  canWrite: () => true,
  getMeta: async (id: string) => {
    const f = drive.get(id === 'root' ? 'myroot' : id)!;
    return { id: f.id, name: f.name, parents: f.parents };
  },
  findFoldersNamed: async (name: string) => [...drive.values()].filter((f) => f.name === name && f.mimeType === FOLDER),
  listChildren: async (id: string) => [...drive.values()].filter((f) => f.parents.includes(id)),
  createFolder: async (name: string, parent: string) => {
    const id = `f${++tick}`;
    add({ id, name, mimeType: FOLDER, parents: [parent] });
    return drive.get(id);
  },
  createJsonFile: async (name: string, parent: string, content: string) => {
    const id = `j${++tick}`;
    add({ id, name, mimeType: 'application/json', parents: [parent], content });
    return drive.get(id);
  },
  updateJsonFile: async (id: string, content: string) => {
    const f = drive.get(id);
    if (!f) return null;
    f.content = content;
    f.modifiedTime = stamp();
    return f;
  },
  downloadText: async (id: string) => drive.get(id)!.content!,
}));

import * as core from '../src/lib/synccore';
let lib: typeof import('../src/lib/library').lib;
let syncNow: typeof import('../src/lib/sync').syncNow;
let syncState: typeof import('../src/lib/sync').syncState;

function track(id: string, folder: string, name: string) {
  return { id, source: 'drive' as const, fileId: id, rootId: 'src', folderId: 'x', name, folder, title: name, artist: 'A', album: 'B', size: 1, mime: 'audio/mpeg', addedAt: 0 };
}

beforeEach(async () => {
  vi.resetModules();
  ({ lib } = await import('../src/lib/library'));
  ({ syncNow, syncState } = await import('../src/lib/sync'));
  kv.clear();
  drive.clear();
  add({ id: 'myroot', name: 'Mon Drive', mimeType: FOLDER, parents: [] });
  add({ id: 'src', name: 'Musique', mimeType: FOLDER, parents: ['myroot'] });
  const tracks = [
    track('d:1', 'Musique/Noir Désir', '01 - Le Vent.mp3'),
    track('d:2', 'Musique/Noir Désir', '02 - Tostaky.mp3'),
    track('d:3', 'Musique/Daft Punk', 'One More Time.mp3'),
    { ...track('l:1', 'Fichiers importés', 'local.mp3'), source: 'local' as const, rootId: undefined },
  ];
  lib.set({
    ready: true,
    tracks: new Map(tracks.map((t) => [t.id, t])),
    sources: [{ id: 'src', name: 'Musique' }],
    playlists: [{ id: 'plw', name: 'iPhone', trackIds: ['l:1', 'd:2'], createdAt: 1, updatedAt: 1 }],
    likes: new Set(['d:1']),
    stats: { 'd:3': { p: 2, l: 500 } },
  });
});

describe('synchronisation web', () => {
  it('crée le dossier, fusionne le fichier du PC et écrit le sien', async () => {
    await syncNow();
    expect(syncState.get().error).toBeUndefined();
    const folder = [...drive.values()].find((f) => f.name === core.SYNC_DIR)!;
    expect(folder.parents).toEqual(['src']);
    expect(syncState.get().folder).toBe('Mon Drive › Musique › Choutify-synchro');
    const mine = [...drive.values()].find((f) => f.name.startsWith('web-'))!;
    const doc = core.parseDoc(JSON.parse(mine.content!))!;
    expect(Object.keys(doc.playlists.plw.items)).toEqual(['noir desir/02 - tostaky.mp3']);
    expect(doc.likes['noir desir/01 - le vent.mp3']?.[0]).toBe(1);

    // Le PC (chemins Windows) ajoute un titre à la playlist et en crée une.
    const pc = core.mergeDocs(doc, core.emptyDoc());
    pc.playlists.plw.items['daft punk/one more time.mp3'] = { on: 1, t: Date.now() + 10, pos: 5, pt: Date.now() + 10 };
    pc.playlists.plpc = { name: 'PC', nt: 10, c: 10, del: 0, items: { 'noir desir/01 - le vent.mp3': { on: 1, t: 10, pos: 0, pt: 10 } } };
    pc.plays['daft punk/one more time.mp3'] = { ...pc.plays['daft punk/one more time.mp3'], pcdevice: [3, 900] };
    add({ id: 'win', name: 'windows-abc.json', mimeType: 'application/json', parents: [folder.id], content: JSON.stringify({ ...pc, device: { id: 'abc', name: 'PC Windows', updated: 5 } }) });

    await syncNow();
    const st = lib.get();
    expect(st.playlists.map((p) => p.name)).toEqual(['iPhone', 'PC']);
    // Le fichier importé (non synchronisé) garde sa place.
    expect(st.playlists[0].trackIds).toEqual(['l:1', 'd:2', 'd:3']);
    expect(st.playlists[1].trackIds).toEqual(['d:1']);
    expect(st.stats['d:3']).toEqual({ p: 5, l: 900 });
    expect(syncState.get().devices.map((d) => d.name)).toContain('PC Windows');

    // Sans changement : pas de réécriture.
    const before = drive.get(mine.id)!.modifiedTime;
    await syncNow();
    expect(drive.get(mine.id)!.modifiedTime).toBe(before);
  });

  it('retrouve un dossier créé par le PC plus haut dans le Drive', async () => {
    add({ id: 'up', name: core.SYNC_DIR, mimeType: FOLDER, parents: ['myroot'] });
    const pcDoc = core.emptyDoc();
    pcDoc.likes['musique/daft punk/one more time.mp3'] = [1, 10];
    add({ id: 'w', name: 'windows-x.json', mimeType: 'application/json', parents: ['up'], content: JSON.stringify(pcDoc) });
    await syncNow();
    expect([...lib.get().likes].sort()).toEqual(['d:1', 'd:3']);
  });
});
