// Cœur de la synchronisation entre appareils (playlists, titres aimés,
// statistiques d'écoute). Logique pure, sans accès au réseau ni au stockage,
// portée à l'identique en Dart dans lib/services/sync_core.dart : les deux
// apps doivent produire le même fichier.
//
// Principe : chaque appareil écrit son propre fichier JSON dans le dossier
// « Choutify-synchro » de Google Drive, et lit ceux des autres. Un fichier
// contient l'état complet, dont chaque élément porte la date de sa dernière
// modification : la fusion de deux fichiers garde, élément par élément, la
// version la plus récente. Elle ne dépend pas de l'ordre de lecture et peut
// être répétée sans effet, donc les modifications faites sur plusieurs
// appareils, même hors ligne, se rejoignent sans perte.
//
// Un titre est identifié par son chemin relatif au dossier qui contient
// « Choutify-synchro » (en minuscules, sans accents), le même sur l'iPhone et
// sur le PC puisque c'est le même Drive.

export const SYNC_DIR = 'Choutify-synchro';
export const FORMAT = 'choutify-sync';

/** [actif (1) ou retiré (0), date de modification en ms]. */
export type Flag = [number, number];

export interface SyncItem {
  on: number;
  t: number;
  pos: number;
  pt: number;
}

export interface SyncPlaylist {
  name: string;
  nt: number; // date du dernier renommage (ou de la création)
  c: number; // date de création
  del: number; // date de suppression, 0 si jamais supprimée
  items: Record<string, SyncItem>;
}

export interface SyncDoc {
  format: string;
  v: number;
  device?: { id: string; name: string; updated: number };
  likes: Record<string, Flag>;
  playlists: Record<string, SyncPlaylist>;
  /** Écoutes par titre puis par appareil : [nombre, dernière écoute]. */
  plays: Record<string, Record<string, [number, number]>>;
}

/** Ce que l'appareil a reçu lors de la dernière synchronisation. */
export interface SyncBase {
  likes: string[];
  playlists: Record<string, { name: string; keys: string[] }>;
  plays: Record<string, number>;
}

/** État local, exprimé avec les clés de synchronisation. */
export interface LocalView {
  likes: string[];
  playlists: { id: string; name: string; createdAt: number; keys: string[] }[];
  plays: Record<string, { count: number; last: number }>;
  /** Toutes les clés des titres présents sur cet appareil. */
  known: Set<string>;
}

export interface Projection {
  likes: string[];
  playlists: { id: string; name: string; createdAt: number; keys: string[] }[];
  plays: Record<string, { count: number; last: number }>;
}

export function emptyDoc(): SyncDoc {
  return { format: FORMAT, v: 1, likes: {}, playlists: {}, plays: {} };
}

export function emptyBase(): SyncBase {
  return { likes: [], playlists: {}, plays: {} };
}

// --------------------------------------------------------------- clés

const FOLD_FROM = 'àáâãäåāăąçćčďèéêëēėęěìíîïīįłñńňòóôõöøōőŕřśšşťùúûüūůűųýÿźżž';
const FOLD_TO = 'aaaaaaaaacccdeeeeeeeeiiiiiilnnnoooooooorrssstuuuuuuuuyyzzz';

/**
 * Normalise un chemin relatif : séparateurs « / », minuscules, accents
 * retirés, caractères interdits sous Windows remplacés (Google Drive pour
 * ordinateur les remplace aussi).
 */
export function syncKey(relPath: string): string {
  let s = relPath.normalize('NFC').replace(/\\/g, '/').toLowerCase();
  let out = '';
  for (const ch of s) {
    const i = FOLD_FROM.indexOf(ch);
    if (i >= 0) out += FOLD_TO[i];
    else if (ch === 'œ') out += 'oe';
    else if (ch === 'æ') out += 'ae';
    else if (ch === 'ß') out += 'ss';
    else if ('<>:"|?*'.includes(ch)) out += '_';
    else out += ch;
  }
  // Marques combinantes (texte décomposé).
  s = out.replace(/[̀-ͯ]/g, '');
  return s
    .split('/')
    .map((p) => p.trim())
    .filter((p) => p && p !== '.')
    .join('/');
}

// ------------------------------------------------------------- fusion

function newer(a: Flag | undefined, b: Flag | undefined): Flag | undefined {
  if (!a) return b;
  if (!b) return a;
  if (a[1] !== b[1]) return a[1] > b[1] ? a : b;
  return a[0] >= b[0] ? a : b;
}

function mergeItem(a: SyncItem | undefined, b: SyncItem | undefined): SyncItem {
  if (!a) return { ...b! };
  if (!b) return { ...a };
  const flag = newer([a.on, a.t], [b.on, b.t])!;
  let pos: number;
  let pt: number;
  if (a.pt !== b.pt) [pos, pt] = a.pt > b.pt ? [a.pos, a.pt] : [b.pos, b.pt];
  else [pos, pt] = [Math.min(a.pos, b.pos), a.pt];
  return { on: flag[0], t: flag[1], pos, pt };
}

function mergePlaylist(a: SyncPlaylist | undefined, b: SyncPlaylist | undefined): SyncPlaylist {
  if (!a) return clonePlaylist(b!);
  if (!b) return clonePlaylist(a);
  let name: string;
  let nt: number;
  if (a.nt !== b.nt) [name, nt] = a.nt > b.nt ? [a.name, a.nt] : [b.name, b.nt];
  else [name, nt] = [a.name >= b.name ? a.name : b.name, a.nt];
  const items: Record<string, SyncItem> = {};
  for (const k of new Set([...Object.keys(a.items), ...Object.keys(b.items)])) items[k] = mergeItem(a.items[k], b.items[k]);
  return { name, nt, c: Math.min(a.c, b.c), del: Math.max(a.del, b.del), items };
}

function clonePlaylist(p: SyncPlaylist): SyncPlaylist {
  const items: Record<string, SyncItem> = {};
  for (const [k, v] of Object.entries(p.items)) items[k] = { ...v };
  return { ...p, items };
}

/** Fusionne deux états : commutative, associative et idempotente. */
export function mergeDocs(a: SyncDoc, b: SyncDoc): SyncDoc {
  const out = emptyDoc();
  for (const k of new Set([...Object.keys(a.likes), ...Object.keys(b.likes)])) out.likes[k] = [...newer(a.likes[k], b.likes[k])!] as Flag;
  for (const id of new Set([...Object.keys(a.playlists), ...Object.keys(b.playlists)])) out.playlists[id] = mergePlaylist(a.playlists[id], b.playlists[id]);
  for (const k of new Set([...Object.keys(a.plays), ...Object.keys(b.plays)])) {
    const pa = a.plays[k] ?? {};
    const pb = b.plays[k] ?? {};
    const per: Record<string, [number, number]> = {};
    for (const d of new Set([...Object.keys(pa), ...Object.keys(pb)])) {
      const x = pa[d] ?? [0, 0];
      const y = pb[d] ?? [0, 0];
      per[d] = [Math.max(x[0], y[0]), Math.max(x[1], y[1])];
    }
    out.plays[k] = per;
  }
  return out;
}

/** Vérifie et nettoie un fichier lu sur le Drive (null s'il est illisible). */
export function parseDoc(raw: unknown): SyncDoc | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.format !== FORMAT || typeof r.v !== 'number' || r.v > 1) return null;
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
  const obj = (x: unknown) => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {});
  const doc = emptyDoc();
  for (const [k, v] of Object.entries(obj(r.likes))) {
    if (Array.isArray(v)) doc.likes[k] = [num(v[0]) ? 1 : 0, num(v[1])];
  }
  for (const [id, v] of Object.entries(obj(r.playlists))) {
    const p = obj(v);
    const items: Record<string, SyncItem> = {};
    for (const [k, iv] of Object.entries(obj(p.items))) {
      const it = obj(iv);
      items[k] = { on: num(it.on) ? 1 : 0, t: num(it.t), pos: num(it.pos), pt: num(it.pt) };
    }
    doc.playlists[id] = { name: typeof p.name === 'string' ? p.name : 'Playlist', nt: num(p.nt), c: num(p.c), del: num(p.del), items };
  }
  for (const [k, v] of Object.entries(obj(r.plays))) {
    const per: Record<string, [number, number]> = {};
    for (const [d, pv] of Object.entries(obj(v))) {
      if (Array.isArray(pv)) per[d] = [num(pv[0]), num(pv[1])];
    }
    doc.plays[k] = per;
  }
  const dev = obj(r.device);
  if (typeof dev.name === 'string') doc.device = { id: String(dev.id ?? ''), name: dev.name, updated: num(dev.updated) };
  return doc;
}

// ------------------------------------------------- modifications locales

function sameSeq(a: string[], b: string[]) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * Inscrit dans le document les changements faits sur cet appareil depuis la
 * dernière synchronisation (différence entre l'état local et `base`).
 * Un titre absent de cet appareil (clé inconnue) n'est jamais considéré
 * comme retiré.
 */
export function applyLocal(docIn: SyncDoc, base: SyncBase, local: LocalView, deviceId: string, now: number): SyncDoc {
  const doc = mergeDocs(docIn, emptyDoc()); // copie
  const known = local.known;

  // Titres aimés.
  const liked = new Set(local.likes);
  const baseLiked = new Set(base.likes);
  for (const k of liked) if (!baseLiked.has(k)) doc.likes[k] = [1, now];
  for (const k of baseLiked) if (!liked.has(k) && known.has(k)) doc.likes[k] = [0, now];

  // Playlists.
  const localIds = new Set(local.playlists.map((p) => p.id));
  for (const id of Object.keys(base.playlists)) {
    if (!localIds.has(id) && doc.playlists[id]) doc.playlists[id].del = Math.max(doc.playlists[id].del, now);
  }
  for (const pl of local.playlists) {
    const keys = [...new Set(pl.keys)];
    const b = base.playlists[pl.id];
    let sp = doc.playlists[pl.id];
    if (!sp) {
      sp = { name: pl.name, nt: now, c: pl.createdAt || now, del: 0, items: {} };
      doc.playlists[pl.id] = sp;
    } else if (!b) {
      // Créée ici sans avoir encore été synchronisée : la garde vivante.
      sp.name = pl.name;
      sp.nt = Math.max(now, sp.del + 1);
    } else if (pl.name !== b.name) {
      sp.name = pl.name;
      sp.nt = now;
    }
    const baseKeys = b?.keys ?? [];
    const baseSet = new Set(baseKeys);
    const keySet = new Set(keys);
    for (const k of baseKeys) {
      if (!keySet.has(k) && known.has(k) && sp.items[k]) sp.items[k] = { ...sp.items[k], on: 0, t: now };
    }
    const added = keys.filter((k) => !baseSet.has(k));
    const commonLocal = keys.filter((k) => baseSet.has(k));
    const commonBase = baseKeys.filter((k) => keySet.has(k));
    if (!sameSeq(commonLocal, commonBase)) {
      // Ordre modifié ici : nouvelles positions pour toute la playlist.
      keys.forEach((k, i) => {
        const it = sp!.items[k];
        sp!.items[k] = { on: 1, t: it && baseSet.has(k) ? it.t : now, pos: i, pt: now };
      });
    } else {
      for (const k of added) {
        // Insère entre le titre qui le précède ici et le suivant déjà connu.
        const i = keys.indexOf(k);
        const prev = i > 0 ? sp.items[keys[i - 1]]?.pos : undefined;
        const nextKey = keys.slice(i + 1).find((x) => baseSet.has(x) && sp!.items[x]);
        const next = nextKey !== undefined ? sp.items[nextKey].pos : undefined;
        let pos: number;
        if (next === undefined) pos = Math.max(prev ?? -1, maxPos(sp)) + 1;
        else if (prev === undefined) pos = next - 1;
        else pos = (prev + next) / 2;
        sp.items[k] = { on: 1, t: now, pos, pt: now };
      }
    }
  }

  // Écoutes : seules celles faites ici depuis la dernière fois s'ajoutent
  // au compteur de cet appareil.
  for (const [k, v] of Object.entries(local.plays)) {
    const delta = v.count - (base.plays[k] ?? 0);
    const per = (doc.plays[k] ??= {});
    const mine = per[deviceId] ?? [0, 0];
    const knownLast = Math.max(0, ...Object.values(per).map((x) => x[1]));
    if (delta > 0 || v.last > knownLast) per[deviceId] = [mine[0] + Math.max(0, delta), Math.max(mine[1], v.last)];
  }
  return doc;
}

function maxPos(p: SyncPlaylist) {
  let m = -1;
  for (const it of Object.values(p.items)) if (it.on && it.pos > m) m = it.pos;
  return m;
}

// ------------------------------------------------------------ projection

/** État à afficher sur cet appareil, limité aux titres qu'il connaît. */
export function project(doc: SyncDoc, known: Set<string>): Projection {
  const likes = Object.entries(doc.likes)
    .filter(([k, f]) => f[0] && known.has(k))
    .sort((a, b) => a[1][1] - b[1][1] || (a[0] < b[0] ? -1 : 1))
    .map(([k]) => k);
  const playlists = Object.entries(doc.playlists)
    .filter(([, p]) => p.nt > p.del)
    .sort((a, b) => a[1].c - b[1].c || (a[0] < b[0] ? -1 : 1))
    .map(([id, p]) => ({
      id,
      name: p.name,
      createdAt: p.c,
      keys: Object.entries(p.items)
        .filter(([k, it]) => it.on && known.has(k))
        .sort((a, b) => a[1].pos - b[1].pos || (a[0] < b[0] ? -1 : 1))
        .map(([k]) => k),
    }));
  const plays: Projection['plays'] = {};
  for (const [k, per] of Object.entries(doc.plays)) {
    if (!known.has(k)) continue;
    let count = 0;
    let last = 0;
    for (const [c, l] of Object.values(per)) {
      count += c;
      last = Math.max(last, l);
    }
    if (count || last) plays[k] = { count, last };
  }
  return { likes, playlists, plays };
}

export function baseFrom(p: Projection): SyncBase {
  const playlists: SyncBase['playlists'] = {};
  for (const pl of p.playlists) playlists[pl.id] = { name: pl.name, keys: [...pl.keys] };
  const plays: Record<string, number> = {};
  for (const [k, v] of Object.entries(p.plays)) plays[k] = v.count;
  return { likes: [...p.likes], playlists, plays };
}

/**
 * Remplace les titres synchronisés d'une liste par `synced`, en gardant les
 * titres non synchronisés (fichiers importés sur l'iPhone…) à leur place.
 */
export function keepUnsynced(old: string[], synced: string[], isSynced: (id: string) => boolean): string[] {
  const out = [...synced];
  let anchor: string | null = null;
  for (const id of old) {
    if (isSynced(id)) {
      if (out.includes(id)) anchor = id;
      continue;
    }
    if (out.includes(id)) continue;
    const at: number = anchor === null ? 0 : out.indexOf(anchor) + 1;
    out.splice(at, 0, id);
    anchor = id;
  }
  return out;
}

/** JSON aux clés triées : deux états identiques donnent le même texte. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}
