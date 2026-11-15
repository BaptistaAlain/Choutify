import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from './icons';
import { useCover } from './lib/covers';
import { cacheState, downloadForOffline, removeFromCache } from './lib/audiocache';
import {
  addToPlaylist,
  albumKey,
  createPlaylist,
  deleteTracks,
  getDerived,
  lib,
  norm,
  splitArtists,
  toggleLike,
  updatePlaylist,
  type Album,
  type Artist,
  type Track,
} from './lib/library';
import { addToQueue, player, playNext, playTracks } from './lib/player';
import { useObs } from './lib/store';
import { ask, closeSheet, confirmDialog, formatDuration, openSheet, toast } from './lib/ui';
import { back, navigate } from './router';

// ------------------------------------------------------------------ pochettes

function hue(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

export function Cover({
  id,
  seed = '',
  round,
  icon = 'note',
  class: cls = '',
}: {
  id?: string;
  seed?: string;
  round?: boolean;
  icon?: string;
  class?: string;
}) {
  const c = useCover(id);
  const h = hue(seed);
  return (
    <div
      class={`cover ${round ? 'round' : ''} ${cls}`}
      style={c ? undefined : { background: `linear-gradient(135deg, hsl(${h} 55% 32%), hsl(${(h + 40) % 360} 60% 18%))` }}
    >
      {c ? <img src={c.url} alt="" loading="lazy" decoding="async" /> : <Icon name={icon} class="ph" />}
    </div>
  );
}

/** Pochette de playlist : mosaïque des 4 premières pochettes différentes. */
export function Mosaic({ tracks, seed, liked }: { tracks: Track[]; seed: string; liked?: boolean }) {
  if (liked) {
    return (
      <div class="cover liked-cover">
        <Icon name="heartFill" class="ph" />
      </div>
    );
  }
  const ids: string[] = [];
  for (const t of tracks) {
    if (t.coverId && !ids.includes(t.coverId)) ids.push(t.coverId);
    if (ids.length === 4) break;
  }
  if (ids.length < 4) return <Cover id={ids[0]} seed={seed} icon="queue" />;
  return (
    <div class="cover mosaic">
      {ids.map((id) => (
        <Cover key={id} id={id} />
      ))}
    </div>
  );
}

// -------------------------------------------------------------------- titres

export function PlayingBars({ paused }: { paused?: boolean }) {
  return (
    <span class={`bars ${paused ? 'paused' : ''}`} aria-label="En lecture">
      <i />
      <i />
      <i />
    </span>
  );
}

export function useCurrentId() {
  return useObs(player, (s) => (s.index >= 0 ? s.queue[s.index] : null));
}

export function TrackRow({
  track,
  onPlay,
  number,
  showCover = true,
  playlistId,
  index,
}: {
  track: Track;
  onPlay: () => void;
  number?: number;
  showCover?: boolean;
  playlistId?: string;
  index?: number;
}) {
  const current = useCurrentId() === track.id;
  const playing = useObs(player, (s) => s.playing);
  const liked = useObs(lib, (s) => s.likes.has(track.id));
  const offline = useObs(cacheState, (s) => !!s.index[track.id]?.pinned);
  const progress = useObs(cacheState, (s) => s.downloading[track.id]);
  return (
    <div class={`row track ${current ? 'current' : ''}`} onClick={onPlay}>
      {showCover ? (
        <div class="row-cover">
          <Cover id={track.coverId} seed={track.album} />
          {current && (
            <div class="cover-overlay">
              <PlayingBars paused={!playing} />
            </div>
          )}
        </div>
      ) : (
        <div class="row-num">{current ? <PlayingBars paused={!playing} /> : number ?? track.trackNo ?? ''}</div>
      )}
      <div class="row-text">
        <div class="row-title">{track.title}</div>
        <div class="row-sub">
          {liked && <Icon name="heartFill" size={12} class="tiny-heart" />}
          {(offline || track.source === 'local') && <Icon name="downloaded" size={12} class="tiny-dl" />}
          {progress != null ? `Téléchargement… ${Math.round(progress * 100)} %` : showCover ? `${track.artist} · ${track.album}` : track.artist}
        </div>
      </div>
      <div class="row-dur">{formatDuration(track.durationMs)}</div>
      <button
        class="icon-btn"
        aria-label="Plus d'options"
        onClick={(e) => {
          e.stopPropagation();
          trackMenu(track, { playlistId, index });
        }}
      >
        <Icon name="more" />
      </button>
    </div>
  );
}

export function TrackList({
  tracks,
  numbered,
  context,
  playlistId,
}: {
  tracks: Track[];
  numbered?: boolean;
  context?: string;
  playlistId?: string;
}) {
  const ids = tracks.map((t) => t.id);
  return (
    <div class="list">
      {tracks.map((t, i) => (
        <TrackRow
          key={t.id + i}
          track={t}
          showCover={!numbered}
          number={numbered ? t.trackNo ?? i + 1 : undefined}
          playlistId={playlistId}
          index={i}
          onPlay={() => playTracks(ids, i, { context, shuffle: false })}
        />
      ))}
    </div>
  );
}

// ------------------------------------------------------------ menus d'actions

export function trackMenu(track: Track, opts: { playlistId?: string; index?: number } = {}) {
  const liked = lib.get().likes.has(track.id);
  const pinned = cacheState.get().index[track.id]?.pinned;
  const actions = [
    { label: 'Lire ensuite', icon: 'playNext', onClick: () => playNext([track.id]) },
    { label: 'Ajouter à la file d’attente', icon: 'queue', onClick: () => addToQueue([track.id]) },
    { label: 'Ajouter à une playlist', icon: 'playlistAdd', onClick: () => playlistPicker([track.id]) },
    {
      label: liked ? 'Retirer des titres aimés' : 'Ajouter aux titres aimés',
      icon: liked ? 'heartFill' : 'heart',
      onClick: () => toggleLike(track.id).then((on) => toast(on ? 'Ajouté aux titres aimés' : 'Retiré des titres aimés')),
    },
    { label: 'Voir l’album', icon: 'album', onClick: () => navigate(`/album/${albumKey(track)}`) },
  ];
  const artists = splitArtists(track.artist);
  for (const a of artists.slice(0, 3)) {
    actions.push({ label: artists.length > 1 ? `Voir ${a}` : 'Voir l’artiste', icon: 'person', onClick: () => navigate(`/artist/${norm(a)}`) });
  }
  if (track.source === 'drive') {
    actions.push(
      pinned
        ? { label: 'Retirer du hors ligne', icon: 'downloaded', onClick: () => removeFromCache([track.id]) }
        : {
            label: 'Garder hors ligne',
            icon: 'download',
            onClick: () => {
              downloadForOffline([track]).then(
                (r) => toast(r.failed ? 'Téléchargement impossible' : 'Disponible hors ligne'),
                (e) => toast(e.message),
              );
            },
          },
    );
  }
  if (opts.playlistId && opts.index != null) {
    const pid = opts.playlistId;
    const idx = opts.index;
    actions.push({
      label: 'Retirer de cette playlist',
      icon: 'minus',
      onClick: () => {
        const p = lib.get().playlists.find((x) => x.id === pid);
        if (p) updatePlaylist(pid, { trackIds: p.trackIds.filter((_, i) => i !== idx) });
      },
    });
  }
  if (track.source === 'local') {
    actions.push({
      label: 'Supprimer de l’appareil',
      icon: 'trash',
      onClick: async () => {
        if (await confirmDialog('Supprimer ce titre ?', `« ${track.title} » sera effacé de cet appareil.`, 'Supprimer', true)) {
          await deleteTracks([track.id]);
        }
      },
    });
  }
  openSheet({ title: track.title, subtitle: `${track.artist} · ${track.album}`, coverId: track.coverId, actions });
}

export function collectionMenu(title: string, subtitle: string, tracks: Track[], coverId?: string, extra: { label: string; icon: string; danger?: boolean; onClick: () => void }[] = []) {
  const ids = tracks.map((t) => t.id);
  const drive = tracks.filter((t) => t.source === 'drive');
  const idx = cacheState.get().index;
  const allPinned = drive.length > 0 && drive.every((t) => idx[t.id]?.pinned);
  openSheet({
    title,
    subtitle,
    coverId,
    actions: [
      { label: 'Lire ensuite', icon: 'playNext', onClick: () => playNext(ids) },
      { label: 'Ajouter à la file d’attente', icon: 'queue', onClick: () => addToQueue(ids) },
      { label: 'Ajouter à une playlist', icon: 'playlistAdd', onClick: () => playlistPicker(ids) },
      ...(drive.length
        ? [
            allPinned
              ? { label: 'Retirer du hors ligne', icon: 'downloaded', onClick: () => removeFromCache(drive.map((t) => t.id)) }
              : { label: 'Télécharger pour le hors ligne', icon: 'download', onClick: () => offline(drive) },
          ]
        : []),
      ...extra,
    ],
  });
}

export function offline(tracks: Track[]) {
  toast(`Téléchargement de ${tracks.length} titre${tracks.length > 1 ? 's' : ''}…`);
  downloadForOffline(tracks).then(
    (r) => toast(r.failed ? `${r.done} titres téléchargés, ${r.failed} en échec` : 'Disponible hors ligne'),
    (e) => toast(e.message),
  );
}

export function playlistPicker(ids: string[]) {
  const add = async (pid: string, name: string) => {
    closeSheet();
    const n = await addToPlaylist(pid, ids);
    toast(n ? `Ajouté à « ${name} »` : `Déjà dans « ${name} »`);
  };
  openSheet({
    title: 'Ajouter à une playlist',
    content: () => <PlaylistPickerContent onPick={add} ids={ids} />,
  });
}

function PlaylistPickerContent({ onPick, ids }: { onPick: (id: string, name: string) => void; ids: string[] }) {
  const playlists = useObs(lib, (s) => s.playlists);
  return (
    <div class="list">
      <button
        class="row sheet-row"
        onClick={async () => {
          closeSheet();
          const name = await ask('Nouvelle playlist', '', 'Créer', 'Nom de la playlist');
          if (name?.trim()) {
            await createPlaylist(name.trim(), ids);
            toast(`Playlist « ${name.trim()} » créée`);
          }
        }}
      >
        <div class="row-cover">
          <div class="cover new-pl">
            <Icon name="plus" class="ph" />
          </div>
        </div>
        <div class="row-text">
          <div class="row-title">Nouvelle playlist</div>
        </div>
      </button>
      {playlists.map((p) => (
        <button key={p.id} class="row sheet-row" onClick={() => onPick(p.id, p.name)}>
          <div class="row-cover">
            <Mosaic tracks={p.trackIds.map((id) => lib.get().tracks.get(id)).filter(Boolean) as Track[]} seed={p.name} />
          </div>
          <div class="row-text">
            <div class="row-title">{p.name}</div>
            <div class="row-sub">{p.trackIds.length} titres</div>
          </div>
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ cartes

export function AlbumCard({ album }: { album: Album }) {
  return (
    <a class="card" href={`#/album/${encodeURI(album.key)}`}>
      <Cover id={album.coverId} seed={album.title} icon="album" />
      <div class="card-title">{album.title}</div>
      <div class="card-sub">{album.artist}</div>
    </a>
  );
}

export function ArtistCard({ artist }: { artist: Artist }) {
  return (
    <a class="card artist" href={`#/artist/${encodeURI(norm(artist.name))}`}>
      <Cover id={artist.coverId} seed={artist.name} icon="person" round />
      <div class="card-title">{artist.name}</div>
      <div class="card-sub">Artiste</div>
    </a>
  );
}

export function Shelf({ title, children, more }: { title: string; children: ComponentChildren; more?: string }) {
  return (
    <section class="shelf">
      <div class="shelf-head">
        <h2>{title}</h2>
        {more && (
          <a class="shelf-more" href={`#${more}`}>
            Tout afficher
          </a>
        )}
      </div>
      <div class="shelf-row">{children}</div>
    </section>
  );
}

// ----------------------------------------------------------------- en-têtes

export function TopBar({ title, backTo, right, solidAfter = 120 }: { title: string; backTo?: string; right?: ComponentChildren; solidAfter?: number }) {
  const [solid, setSolid] = useState(false);
  useEffect(() => {
    const on = () => setSolid(window.scrollY > solidAfter);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, [solidAfter]);
  return (
    <div class={`topbar ${solid ? 'solid' : ''}`}>
      {backTo !== undefined && (
        <button class="icon-btn" aria-label="Retour" onClick={() => back(backTo)}>
          <Icon name="back" size={28} />
        </button>
      )}
      <div class="topbar-title">{title}</div>
      <div class="topbar-right">{right}</div>
    </div>
  );
}

export function PlayButtons({ ids, context, extra }: { ids: string[]; context: string; extra?: ComponentChildren }) {
  return (
    <div class="play-row">
      {extra}
      <div class="spacer" />
      <button class="icon-btn lg" aria-label="Lecture aléatoire" onClick={() => playTracks(ids, 0, { shuffle: true, context })}>
        <Icon name="shuffle" size={28} />
      </button>
      <button class="play-fab" aria-label="Lecture" onClick={() => playTracks(ids, 0, { shuffle: false, context })}>
        <Icon name="play" size={30} />
      </button>
    </div>
  );
}

export function Empty({ icon, title, text, children }: { icon: string; title: string; text?: string; children?: ComponentChildren }) {
  return (
    <div class="empty">
      <Icon name={icon} size={48} />
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {children}
    </div>
  );
}

// ------------------------------------------------- liste réorganisable

export function DragList<T>({
  items,
  keyOf,
  render,
  onMove,
}: {
  items: T[];
  keyOf: (t: T, i: number) => string;
  render: (t: T, i: number, handle: ComponentChildren) => ComponentChildren;
  onMove: (from: number, to: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ from: number; to: number; dy: number } | null>(null);
  const start = (i: number) => (e: PointerEvent) => {
    e.preventDefault();
    const el = ref.current;
    if (!el) return;
    const rows = [...el.children] as HTMLElement[];
    const h = rows[i]?.offsetHeight || 60;
    const y0 = e.clientY;
    let to = i;
    const move = (ev: PointerEvent) => {
      const dy = ev.clientY - y0;
      to = Math.max(0, Math.min(items.length - 1, i + Math.round(dy / h)));
      setDrag({ from: i, to, dy });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setDrag(null);
      if (to !== i) onMove(i, to);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    setDrag({ from: i, to: i, dy: 0 });
  };
  return (
    <div class="list" ref={ref}>
      {items.map((t, i) => {
        let style: Record<string, string> | undefined;
        if (drag) {
          const h = 60;
          if (i === drag.from) style = { transform: `translateY(${drag.dy}px)`, zIndex: '2', position: 'relative', background: 'var(--surface-high)' };
          else if (drag.from < drag.to && i > drag.from && i <= drag.to) style = { transform: `translateY(-${h}px)`, transition: 'transform .15s' };
          else if (drag.from > drag.to && i < drag.from && i >= drag.to) style = { transform: `translateY(${h}px)`, transition: 'transform .15s' };
          else style = { transition: 'transform .15s' };
        }
        const handle = (
          <span class="drag-handle" onPointerDown={start(i)} onClick={(e) => e.stopPropagation()} aria-label="Déplacer">
            <Icon name="drag" />
          </span>
        );
        return (
          <div key={keyOf(t, i)} style={style}>
            {render(t, i, handle)}
          </div>
        );
      })}
    </div>
  );
}

export function tracksOf(ids: string[]) {
  const m = lib.get().tracks;
  return ids.map((id) => m.get(id)).filter(Boolean) as Track[];
}

export { getDerived };
