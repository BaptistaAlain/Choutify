import { describe, expect, it } from 'vitest';
import {
  applyLocal,
  baseFrom,
  emptyBase,
  emptyDoc,
  keepUnsynced,
  mergeDocs,
  parseDoc,
  project,
  syncKey,
  type LocalView,
  type SyncBase,
  type SyncDoc,
} from '../src/lib/synccore';

const known = new Set(['a', 'b', 'c', 'd', 'e']);

function view(p: Partial<LocalView>): LocalView {
  return { likes: [], playlists: [], plays: {}, known, ...p };
}

/** Simule un appareil : état local + document + base. */
class Device {
  doc: SyncDoc = emptyDoc();
  base: SyncBase = emptyBase();
  local: LocalView;
  constructor(
    public id: string,
    init: Partial<LocalView> = {},
  ) {
    this.local = view(init);
  }
  sync(now: number, ...others: Device[]) {
    let doc = applyLocal(this.doc, this.base, this.local, this.id, now);
    for (const o of others) doc = mergeDocs(doc, o.doc);
    const p = project(doc, this.local.known);
    this.doc = doc;
    this.base = baseFrom(p);
    this.local = { ...p, known: this.local.known };
  }
}

describe('syncKey', () => {
  it('normalise séparateurs, casse et accents', () => {
    expect(syncKey('Rock\\Noir Désir\\01 - Le Vent.MP3')).toBe('rock/noir desir/01 - le vent.mp3');
    expect(syncKey('Été/Œuvre.mp3')).toBe('ete/oeuvre.mp3');
    // Forme décomposée (e + accent combinant).
    expect(syncKey('Café/a.mp3')).toBe('cafe/a.mp3');
    expect(syncKey('AC:DC/Back?.mp3')).toBe('ac_dc/back_.mp3');
  });
});

describe('fusion', () => {
  it('est commutative et idempotente', () => {
    const a = new Device('A', { likes: ['a'], playlists: [{ id: 'p1', name: 'Route', createdAt: 1, keys: ['a', 'b'] }] });
    const b = new Device('B', { likes: ['c'], playlists: [{ id: 'p2', name: 'Sport', createdAt: 2, keys: ['c'] }] });
    a.sync(10);
    b.sync(11);
    const ab = mergeDocs(a.doc, b.doc);
    expect(mergeDocs(b.doc, a.doc)).toEqual(ab);
    expect(mergeDocs(ab, ab)).toEqual(ab);
    expect(mergeDocs(mergeDocs(ab, a.doc), b.doc)).toEqual(ab);
  });

  it('réunit les playlists et favoris des deux appareils', () => {
    const pc = new Device('pc', { likes: ['a'], playlists: [{ id: 'p1', name: 'Route', createdAt: 1, keys: ['a', 'b'] }] });
    const phone = new Device('phone', { likes: ['c'], playlists: [{ id: 'p2', name: 'Sport', createdAt: 2, keys: ['c'] }] });
    pc.sync(10);
    phone.sync(20, pc);
    pc.sync(30, phone);
    for (const d of [pc, phone]) {
      expect(d.local.likes.sort()).toEqual(['a', 'c']);
      expect(d.local.playlists.map((p) => [p.name, p.keys])).toEqual([
        ['Route', ['a', 'b']],
        ['Sport', ['c']],
      ]);
    }
  });

  it('ne perd rien quand les deux appareils modifient la même playlist', () => {
    const pc = new Device('pc', { playlists: [{ id: 'p', name: 'Mix', createdAt: 1, keys: ['a', 'b'] }] });
    const phone = new Device('phone');
    pc.sync(10);
    phone.sync(11, pc);
    // Hors ligne : le PC ajoute c, le téléphone ajoute d et retire a.
    pc.local.playlists[0].keys.push('c');
    phone.local.playlists[0].keys = ['b', 'd'];
    pc.sync(20);
    phone.sync(21);
    pc.sync(30, phone);
    phone.sync(31, pc);
    expect(pc.local.playlists[0].keys).toEqual(['b', 'c', 'd']);
    expect(phone.local.playlists[0].keys).toEqual(pc.local.playlists[0].keys);
  });

  it('applique le renommage, la réorganisation et la suppression', () => {
    const pc = new Device('pc', { playlists: [{ id: 'p', name: 'Mix', createdAt: 1, keys: ['a', 'b', 'c'] }, { id: 'q', name: 'Vieux', createdAt: 2, keys: ['e'] }] });
    const phone = new Device('phone');
    pc.sync(10);
    phone.sync(11, pc);
    phone.local.playlists[0].keys = ['c', 'a', 'b'];
    phone.local.playlists[0].name = 'Mix 2';
    phone.local.playlists = phone.local.playlists.filter((p) => p.id !== 'q');
    phone.sync(20, pc);
    pc.sync(30, phone);
    expect(pc.local.playlists.map((p) => [p.name, p.keys])).toEqual([['Mix 2', ['c', 'a', 'b']]]);
  });

  it('insère un titre ajouté au milieu à la bonne place', () => {
    const pc = new Device('pc', { playlists: [{ id: 'p', name: 'Mix', createdAt: 1, keys: ['a', 'c'] }] });
    const phone = new Device('phone');
    pc.sync(10);
    phone.sync(11, pc);
    phone.local.playlists[0].keys = ['a', 'b', 'c'];
    phone.sync(20, pc);
    pc.sync(30, phone);
    expect(pc.local.playlists[0].keys).toEqual(['a', 'b', 'c']);
  });

  it("garde les titres que l'autre appareil ne connaît pas", () => {
    const pc = new Device('pc', { playlists: [{ id: 'p', name: 'Mix', createdAt: 1, keys: ['a', 'z'] }], known: new Set(['a', 'z']) });
    const phone = new Device('phone', { known: new Set(['a']) });
    pc.sync(10);
    phone.sync(11, pc);
    expect(phone.local.playlists[0].keys).toEqual(['a']);
    phone.sync(12, pc);
    pc.sync(20, phone);
    expect(pc.local.playlists[0].keys).toEqual(['a', 'z']);
  });

  it('additionne les écoutes des deux appareils sans les compter deux fois', () => {
    const pc = new Device('pc', { plays: { a: { count: 3, last: 100 } } });
    const phone = new Device('phone', { plays: { a: { count: 2, last: 200 } } });
    pc.sync(10);
    phone.sync(11, pc);
    pc.sync(12, phone);
    pc.sync(13, phone);
    expect(pc.local.plays.a).toEqual({ count: 5, last: 200 });
    phone.local.plays.a = { count: 6, last: 300 };
    phone.sync(20, pc);
    pc.sync(21, phone);
    phone.sync(22, pc);
    expect(pc.local.plays.a).toEqual({ count: 6, last: 300 });
    expect(phone.local.plays.a).toEqual({ count: 6, last: 300 });
  });

  it("retire un favori retiré sur l'autre appareil", () => {
    const pc = new Device('pc', { likes: ['a', 'b'] });
    const phone = new Device('phone');
    pc.sync(10);
    phone.sync(11, pc);
    phone.local.likes = ['b'];
    phone.sync(20, pc);
    pc.sync(30, phone);
    expect(pc.local.likes).toEqual(['b']);
  });

  it('relit un fichier JSON et ignore les fichiers étrangers', () => {
    const d = new Device('pc', { likes: ['a'], playlists: [{ id: 'p', name: 'Mix', createdAt: 1, keys: ['a'] }], plays: { a: { count: 1, last: 5 } } });
    d.sync(10);
    expect(parseDoc(JSON.parse(JSON.stringify(d.doc)))).toEqual(d.doc);
    expect(parseDoc({ hello: 1 })).toBeNull();
    expect(parseDoc(null)).toBeNull();
  });
});

describe('keepUnsynced', () => {
  it('garde les titres non synchronisés à leur place', () => {
    const synced = (id: string) => !id.startsWith('l:');
    expect(keepUnsynced(['l:1', 'a', 'l:2', 'b'], ['b', 'a', 'c'], synced)).toEqual(['l:1', 'b', 'a', 'l:2', 'c']);
    expect(keepUnsynced(['a', 'l:1'], [], synced)).toEqual(['l:1']);
  });
});

describe('table des accents', () => {
  it('correspond à la décomposition Unicode', () => {
    const src = 'àáâãäåāăąçćčďèéêëēėęěìíîïīįñńňòóôõöōőŕřśšşťùúûüūůűųýÿźżž';
    for (const ch of src) expect(syncKey(ch)).toBe(ch.normalize('NFD')[0]);
    expect(syncKey('łø')).toBe('lo');
  });
});
