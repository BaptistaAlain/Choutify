// Lecteur : file d'attente, aléatoire, répétition, écran de verrouillage
// (Media Session), minuterie et reprise de la lecture.
//
// Les fichiers Google Drive sont téléchargés (puis gardés en cache) avant
// d'être lus : sur iPhone c'est le moyen le plus fiable de continuer la
// lecture écran verrouillé. Le titre suivant est préchargé pendant l'écoute
// pour enchaîner sans réseau.
import * as db from './db';
import { getAudio } from './audiocache';
import { coverDataUrl } from './covers';
import { AuthError } from './google';
import { lib, recordPlay, updateTrack, type Track } from './library';
import { Observable } from './store';
import { toast } from './ui';

export type Repeat = 'off' | 'all' | 'one';

interface PlayerState {
  queue: string[];
  unshuffled: string[] | null;
  index: number;
  shuffle: boolean;
  repeat: Repeat;
  playing: boolean;
  loading: boolean;
  position: number; // secondes
  duration: number;
  sleepAt: number | null;
  sleepEndOfTrack: boolean;
  context: string; // ce qui est en lecture (« Album X »)
}

export const player = new Observable<PlayerState>({
  queue: [],
  unshuffled: null,
  index: -1,
  shuffle: false,
  repeat: 'off',
  playing: false,
  loading: false,
  position: 0,
  duration: 0,
  sleepAt: null,
  sleepEndOfTrack: false,
  context: '',
});

const audio = new Audio();
audio.preload = 'auto';
audio.setAttribute('playsinline', '');
(audio as HTMLAudioElement & { disableRemotePlayback?: boolean }).disableRemotePlayback = false;
document.body.appendChild(audio);
audio.style.display = 'none';

// WAV silencieux très court pour « débloquer » l'élément audio lors d'un
// geste de l'utilisateur (iOS refuse ensuite les play() hors geste sinon).
const SILENT = (() => {
  const n = 800;
  const buf = new ArrayBuffer(44 + n);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  v.setUint32(4, 36 + n, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true);
  v.setUint32(28, 8000, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  w(36, 'data');
  v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
  let s = '';
  new Uint8Array(buf).forEach((b) => (s += String.fromCharCode(b)));
  return `data:audio/wav;base64,${btoa(s)}`;
})();

let unlocked = false;
function unlock() {
  if (unlocked) return;
  unlocked = true;
  if (!audio.src) {
    audio.src = SILENT;
    audio.play().catch(() => {});
  }
}

let loadedId: string | null = null;
let currentUrl: string | null = null;
let loadSeq = 0;
let pendingSeek = 0;
let counted = false;
let failures = 0;

export function currentTrack(): Track | undefined {
  const s = player.get();
  return s.index >= 0 ? lib.get().tracks.get(s.queue[s.index]) : undefined;
}

function shuffled<T>(a: T[]): T[] {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

async function load(index: number, autoplay: boolean, seek = 0) {
  const s = player.get();
  const id = s.queue[index];
  const t = id ? lib.get().tracks.get(id) : undefined;
  if (!t) return;
  const seq = ++loadSeq;
  player.set({ index, loading: true, position: seek, duration: (t.durationMs ?? 0) / 1000 });
  counted = false;
  updateMediaSession(t);
  try {
    const blob = await getAudio(t);
    if (seq !== loadSeq) return;
    const url = URL.createObjectURL(blob);
    const old = currentUrl;
    currentUrl = url;
    loadedId = t.id;
    pendingSeek = seek;
    audio.src = url;
    audio.load();
    if (old) setTimeout(() => URL.revokeObjectURL(old), 2000);
    if (autoplay) {
      try {
        await audio.play();
        failures = 0;
      } catch (e) {
        if ((e as Error).name === 'NotAllowedError') {
          player.set({ playing: false });
          toast('Touche lecture pour démarrer.');
        }
      }
    }
  } catch (e) {
    if (seq !== loadSeq) return;
    player.set({ loading: false, playing: false });
    const msg = e instanceof Error ? e.message : String(e);
    toast(e instanceof AuthError ? msg : `Impossible de lire « ${t.title} » : ${msg}`);
    if (!(e instanceof AuthError) && autoplay && ++failures < 3) setTimeout(() => next(true), 1200);
  } finally {
    if (seq === loadSeq) player.set({ loading: false });
  }
}

function prefetch() {
  const s = player.get();
  if (s.repeat === 'one') return;
  let i = s.index + 1;
  if (i >= s.queue.length) {
    if (s.repeat !== 'all') return;
    i = 0;
  }
  const t = lib.get().tracks.get(s.queue[i]);
  if (t && t.source === 'drive') getAudio(t).catch(() => {});
}

// ------------------------------------------------------------------ actions

export function playTracks(ids: string[], start = 0, opts: { shuffle?: boolean; context?: string } = {}) {
  if (!ids.length) return;
  unlock();
  failures = 0;
  const shuffle = opts.shuffle ?? player.get().shuffle;
  let queue = ids.slice();
  let index = Math.max(0, Math.min(start, ids.length - 1));
  let unshuffled: string[] | null = null;
  if (shuffle) {
    unshuffled = queue;
    const firstIdx = opts.shuffle && start === 0 ? Math.floor(Math.random() * queue.length) : index;
    queue = [queue[firstIdx], ...shuffled(queue.filter((_, i) => i !== firstIdx))];
    index = 0;
  }
  player.set({ queue, unshuffled, index, shuffle, context: opts.context ?? '' });
  load(index, true);
  saveResume();
}

export function togglePlay() {
  unlock();
  const s = player.get();
  if (s.index < 0) {
    const all = [...lib.get().tracks.keys()];
    if (all.length) playTracks(all, 0, { shuffle: true, context: 'Toute la bibliothèque' });
    return;
  }
  if (loadedId !== s.queue[s.index]) {
    load(s.index, true, pendingSeek || s.position);
    return;
  }
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
}

export function pause() {
  audio.pause();
}

export function next(auto = false) {
  unlock();
  const s = player.get();
  if (!s.queue.length) return;
  let i = s.index + 1;
  if (i >= s.queue.length) {
    if (s.repeat === 'all' || !auto) i = 0;
    else {
      audio.pause();
      audio.currentTime = 0;
      player.set({ playing: false, position: 0 });
      return;
    }
  }
  load(i, true);
}

export function prev() {
  unlock();
  const s = player.get();
  if (!s.queue.length) return;
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }
  let i = s.index - 1;
  if (i < 0) i = s.repeat === 'all' ? s.queue.length - 1 : 0;
  load(i, true);
}

export function jumpTo(i: number) {
  unlock();
  load(i, true);
}

export function seek(sec: number) {
  const s = player.get();
  if (loadedId !== s.queue[s.index]) {
    pendingSeek = sec;
    player.set({ position: sec });
    return;
  }
  audio.currentTime = Math.max(0, Math.min(sec, audio.duration || sec));
  player.set({ position: audio.currentTime });
  updatePosition();
}

export function playNext(ids: string[]) {
  const s = player.get();
  if (s.index < 0) return playTracks(ids);
  const queue = s.queue.slice();
  queue.splice(s.index + 1, 0, ...ids);
  player.set({ queue, unshuffled: s.unshuffled ? [...s.unshuffled, ...ids] : null });
  saveResume();
  toast(ids.length > 1 ? `${ids.length} titres seront lus ensuite` : 'Sera lu ensuite');
}

export function addToQueue(ids: string[]) {
  const s = player.get();
  if (s.index < 0) return playTracks(ids);
  player.set({ queue: [...s.queue, ...ids], unshuffled: s.unshuffled ? [...s.unshuffled, ...ids] : null });
  saveResume();
  toast(ids.length > 1 ? `${ids.length} titres ajoutés à la file` : 'Ajouté à la file d’attente');
}

export function removeFromQueue(i: number) {
  const s = player.get();
  if (i === s.index) return;
  const queue = s.queue.slice();
  const [id] = queue.splice(i, 1);
  let unshuffled = s.unshuffled;
  if (unshuffled) {
    unshuffled = unshuffled.slice();
    const k = unshuffled.indexOf(id);
    if (k >= 0) unshuffled.splice(k, 1);
  }
  player.set({ queue, unshuffled, index: i < s.index ? s.index - 1 : s.index });
  saveResume();
}

export function moveInQueue(from: number, to: number) {
  const s = player.get();
  if (from === to) return;
  const queue = s.queue.slice();
  const [id] = queue.splice(from, 1);
  queue.splice(to, 0, id);
  let index = s.index;
  if (from === s.index) index = to;
  else if (from < s.index && to >= s.index) index--;
  else if (from > s.index && to <= s.index) index++;
  player.set({ queue, index });
  saveResume();
}

export function clearUpcoming() {
  const s = player.get();
  player.set({ queue: s.queue.slice(0, s.index + 1), unshuffled: null });
  saveResume();
}

export function toggleShuffle() {
  const s = player.get();
  if (!s.shuffle) {
    const cur = s.queue[s.index];
    const rest = s.queue.filter((_, i) => i !== s.index);
    const queue = cur ? [cur, ...shuffled(rest)] : shuffled(rest);
    player.set({ shuffle: true, unshuffled: s.queue, queue, index: cur ? 0 : -1 });
  } else {
    const cur = s.queue[s.index];
    const base = s.unshuffled ?? s.queue;
    const index = Math.max(0, base.indexOf(cur));
    player.set({ shuffle: false, unshuffled: null, queue: base, index: s.index < 0 ? -1 : index });
  }
  saveResume();
}

export function cycleRepeat() {
  const order: Repeat[] = ['off', 'all', 'one'];
  const r = order[(order.indexOf(player.get().repeat) + 1) % 3];
  player.set({ repeat: r });
  saveResume();
}

let sleepTimer: ReturnType<typeof setTimeout> | undefined;
export function setSleep(minutes: number | 'end' | null) {
  clearTimeout(sleepTimer);
  if (minutes === null) {
    player.set({ sleepAt: null, sleepEndOfTrack: false });
    return;
  }
  if (minutes === 'end') {
    player.set({ sleepAt: null, sleepEndOfTrack: true });
    return;
  }
  const at = Date.now() + minutes * 60_000;
  player.set({ sleepAt: at, sleepEndOfTrack: false });
  sleepTimer = setTimeout(() => {
    audio.pause();
    player.set({ sleepAt: null });
  }, minutes * 60_000);
}

// ---------------------------------------------------------- événements audio

audio.addEventListener('play', () => player.set({ playing: true }));
audio.addEventListener('playing', () => {
  player.set({ playing: true, loading: false });
  if (audio.src !== SILENT) prefetch();
  updatePosition();
});
audio.addEventListener('pause', () => {
  player.set({ playing: false });
  saveResume();
  updatePosition();
});
audio.addEventListener('waiting', () => player.set({ loading: true }));
audio.addEventListener('canplay', () => player.set({ loading: false }));
audio.addEventListener('loadedmetadata', () => {
  if (audio.src === SILENT) return;
  if (pendingSeek > 0) {
    audio.currentTime = pendingSeek;
    pendingSeek = 0;
  }
  const d = audio.duration;
  player.set({ duration: isFinite(d) ? d : player.get().duration });
  const t = currentTrack();
  if (t && isFinite(d) && d > 0 && Math.abs((t.durationMs ?? 0) - d * 1000) > 2000) {
    updateTrack(t.id, { durationMs: Math.round(d * 1000) });
  }
  updatePosition();
});

let lastSave = 0;
audio.addEventListener('timeupdate', () => {
  if (audio.src === SILENT) return;
  const pos = audio.currentTime;
  player.set({ position: pos });
  const t = currentTrack();
  if (t && !counted && (pos > 30 || (audio.duration > 0 && pos > audio.duration / 2))) {
    counted = true;
    recordPlay(t.id);
  }
  if (Date.now() - lastSave > 5000) {
    lastSave = Date.now();
    saveResume();
  }
});
audio.addEventListener('ended', () => {
  if (audio.src === SILENT) return;
  const s = player.get();
  if (s.sleepEndOfTrack) {
    player.set({ sleepEndOfTrack: false, playing: false });
    return;
  }
  if (s.repeat === 'one') {
    audio.currentTime = 0;
    audio.play().catch(() => {});
    counted = false;
    return;
  }
  next(true);
});
audio.addEventListener('error', () => {
  if (!audio.src || audio.src === SILENT) return;
  const t = currentTrack();
  player.set({ playing: false, loading: false });
  if (t) toast(`Format non pris en charge par ce navigateur : ${t.name}`);
});

// ------------------------------------------------------------- Media Session

const ms = 'mediaSession' in navigator ? navigator.mediaSession : null;

async function updateMediaSession(t: Track) {
  document.title = `${t.title} · ${t.artist}`;
  if (!ms) return;
  const base: MediaMetadataInit = { title: t.title, artist: t.artist, album: t.album };
  ms.metadata = new MediaMetadata(base);
  if (t.coverId) {
    const url = await coverDataUrl(t.coverId);
    if (url && currentTrack()?.id === t.id) {
      ms.metadata = new MediaMetadata({ ...base, artwork: [{ src: url, sizes: '512x512', type: 'image/jpeg' }] });
    }
  }
}

function updatePosition() {
  if (!ms || !ms.setPositionState) return;
  const d = audio.duration;
  if (!isFinite(d) || d <= 0) return;
  try {
    ms.setPositionState({ duration: d, position: Math.min(audio.currentTime, d), playbackRate: audio.playbackRate || 1 });
  } catch {
    /* ignore */
  }
}

if (ms) {
  const set = (a: MediaSessionAction, h: MediaSessionActionHandler) => {
    try {
      ms.setActionHandler(a, h);
    } catch {
      /* action non prise en charge */
    }
  };
  set('play', () => togglePlay());
  set('pause', () => audio.pause());
  set('previoustrack', () => prev());
  set('nexttrack', () => next());
  set('seekto', (d) => d.seekTime != null && seek(d.seekTime));
}

// ------------------------------------------------------------------ reprise

function saveResume() {
  const s = player.get();
  db.put('kv', 'resume', {
    queue: s.queue,
    unshuffled: s.unshuffled,
    index: s.index,
    position: loadedId === s.queue[s.index] ? audio.currentTime : s.position,
    shuffle: s.shuffle,
    repeat: s.repeat,
    context: s.context,
  }).catch(() => {});
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveResume();
});

export async function restorePlayer() {
  const r = await db.get<Partial<PlayerState>>('kv', 'resume');
  if (!r?.queue?.length) return;
  const tracks = lib.get().tracks;
  const cur = r.queue[r.index ?? 0];
  const queue = r.queue.filter((id) => tracks.has(id));
  if (!queue.length) return;
  const index = Math.max(0, queue.indexOf(cur));
  const t = tracks.get(queue[index]);
  pendingSeek = queue[index] === cur ? r.position ?? 0 : 0;
  player.set({
    queue,
    unshuffled: r.unshuffled?.filter((id) => tracks.has(id)) ?? null,
    index,
    shuffle: !!r.shuffle,
    repeat: r.repeat ?? 'off',
    position: pendingSeek,
    duration: (t?.durationMs ?? 0) / 1000,
    context: r.context ?? '',
  });
  if (t) updateMediaSession(t);
}
