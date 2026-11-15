import { useEffect, useRef, useState } from 'preact/hooks';
import { Cover, DragList, PlayingBars, playlistPicker, trackMenu } from './components';
import { Icon } from './icons';
import { cacheState } from './lib/audiocache';
import { useCover } from './lib/covers';
import { albumKey, lib, norm, splitArtists, toggleLike, type Track } from './lib/library';
import {
  clearUpcoming,
  currentTrack,
  cycleRepeat,
  jumpTo,
  moveInQueue,
  next,
  player,
  prev,
  removeFromQueue,
  seek,
  setSleep,
  toggleShuffle,
  togglePlay,
} from './lib/player';
import { useObs } from './lib/store';
import { closeSheet, formatDuration, openSheet, toast, ui } from './lib/ui';
import { navigate } from './router';

function useCurrent(): Track | undefined {
  useObs(player, (s) => (s.index >= 0 ? s.queue[s.index] : null));
  useObs(lib, (s) => s.version);
  return currentTrack();
}

// ------------------------------------------------------------- mini-lecteur

export function MiniPlayer() {
  const t = useCurrent();
  const playing = useObs(player, (s) => s.playing);
  const loading = useObs(player, (s) => s.loading);
  const pos = useObs(player, (s) => Math.floor(s.position));
  const dur = useObs(player, (s) => s.duration);
  const dl = useObs(cacheState, (s) => (t ? s.downloading[t.id] : undefined));
  const color = useCover(t?.coverId)?.color;
  if (!t) return null;
  const pct = dl != null ? dl * 100 : dur ? (pos / dur) * 100 : 0;
  return (
    <div class="mini" style={color ? { '--c': color } : undefined} onClick={() => ui.set({ nowPlaying: true })}>
      <div class="mini-cover">
        <Cover id={t.coverId} seed={t.album} />
      </div>
      <div class="mini-text">
        <div class="mini-title">{t.title}</div>
        <div class="mini-sub">{dl != null ? `Chargement… ${Math.round(dl * 100)} %` : t.artist}</div>
      </div>
      <LikeButton id={t.id} />
      <button
        class="icon-btn"
        aria-label={playing ? 'Pause' : 'Lecture'}
        onClick={(e) => {
          e.stopPropagation();
          togglePlay();
        }}
      >
        {loading && !playing ? <div class="spinner sm" /> : <Icon name={playing ? 'pause' : 'play'} size={28} />}
      </button>
      <div class={`mini-progress ${dl != null ? 'dl' : ''}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function LikeButton({ id, size = 24 }: { id: string; size?: number }) {
  const liked = useObs(lib, (s) => s.likes.has(id));
  return (
    <button
      class={`icon-btn like ${liked ? 'on' : ''}`}
      aria-label={liked ? 'Retirer des titres aimés' : 'Ajouter aux titres aimés'}
      onClick={(e) => {
        e.stopPropagation();
        toggleLike(id);
      }}
    >
      <Icon name={liked ? 'heartFill' : 'heart'} size={size} />
    </button>
  );
}

// ------------------------------------------------------- lecteur plein écran

export function NowPlaying() {
  const open = useObs(ui, (s) => s.nowPlaying);
  const t = useCurrent();
  const [dragY, setDragY] = useState(0);
  const start = useRef<number | null>(null);
  useEffect(() => {
    if (!t && open) ui.set({ nowPlaying: false });
  }, [t, open]);
  useEffect(() => {
    // Le geste « retour » ferme le lecteur plutôt que de quitter la page.
    if (!open) return;
    history.pushState({ np: 1 }, '');
    const onPop = () => ui.set({ nowPlaying: false, queue: false });
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (history.state?.np) history.back();
    };
  }, [open]);
  if (!t) return null;
  const close = () => ui.set({ nowPlaying: false });
  return (
    <div
      class={`np ${open ? 'open' : ''}`}
      style={dragY ? { transform: `translateY(${dragY}px)`, transition: 'none' } : undefined}
      onTouchStart={(e) => {
        const el = e.target as HTMLElement;
        if (el.closest('input,button,.np-queue')) return;
        start.current = e.touches[0].clientY;
      }}
      onTouchMove={(e) => {
        if (start.current == null) return;
        setDragY(Math.max(0, e.touches[0].clientY - start.current));
      }}
      onTouchEnd={() => {
        if (start.current == null) return;
        start.current = null;
        if (dragY > 120) close();
        setDragY(0);
      }}
    >
      {open && <NowPlayingBody t={t} close={close} />}
    </div>
  );
}

function NowPlayingBody({ t, close }: { t: Track; close: () => void }) {
  const playing = useObs(player, (s) => s.playing);
  const loading = useObs(player, (s) => s.loading);
  const shuffle = useObs(player, (s) => s.shuffle);
  const repeat = useObs(player, (s) => s.repeat);
  const context = useObs(player, (s) => s.context);
  const sleep = useObs(player, (s) => s.sleepAt != null || s.sleepEndOfTrack);
  const showQueue = useObs(ui, (s) => s.queue);
  const cover = useCover(t.coverId);
  const dl = useObs(cacheState, (s) => s.downloading[t.id]);
  const artists = splitArtists(t.artist);
  return (
    <div class="np-inner" style={cover ? { '--c': cover.color } : undefined}>
      <div class="np-bg" />
      <div class="np-head">
        <button class="icon-btn" aria-label="Fermer" onClick={close}>
          <Icon name="down" size={30} />
        </button>
        <div class="np-context">
          <small>En lecture</small>
          <span>{context || t.album}</span>
        </div>
        <button class="icon-btn" aria-label="Plus d'options" onClick={() => trackMenu(t)}>
          <Icon name="more" />
        </button>
      </div>
      {showQueue ? (
        <QueueView />
      ) : (
        <div class="np-art">
          <div class={`np-cover ${playing ? 'playing' : ''}`}>
            <Cover id={t.coverId} seed={t.album} />
          </div>
        </div>
      )}
      <div class="np-meta">
        <div class="np-text">
          <button
            class="np-title"
            onClick={() => {
              close();
              navigate(`/album/${albumKey(t)}`);
            }}
          >
            {t.title}
          </button>
          <div class="np-artist">
            {artists.map((a, i) => (
              <span key={a}>
                {i > 0 && ', '}
                <button
                  onClick={() => {
                    close();
                    navigate(`/artist/${norm(a)}`);
                  }}
                >
                  {a}
                </button>
              </span>
            ))}
          </div>
        </div>
        <LikeButton id={t.id} size={28} />
      </div>
      <Seek />
      {dl != null && <div class="np-dl">Chargement depuis Google Drive… {Math.round(dl * 100)} %</div>}
      <div class="np-controls">
        <button class={`icon-btn ${shuffle ? 'active' : ''}`} aria-label="Aléatoire" onClick={toggleShuffle}>
          <Icon name="shuffle" size={26} />
        </button>
        <button class="icon-btn xl" aria-label="Précédent" onClick={prev}>
          <Icon name="prev" size={40} />
        </button>
        <button class="np-play" aria-label={playing ? 'Pause' : 'Lecture'} onClick={togglePlay}>
          {loading && !playing ? <div class="spinner dark" /> : <Icon name={playing ? 'pause' : 'play'} size={38} />}
        </button>
        <button class="icon-btn xl" aria-label="Suivant" onClick={() => next()}>
          <Icon name="next" size={40} />
        </button>
        <button class={`icon-btn ${repeat !== 'off' ? 'active' : ''}`} aria-label="Répétition" onClick={cycleRepeat}>
          <Icon name={repeat === 'one' ? 'repeatOne' : 'repeat'} size={26} />
        </button>
      </div>
      <div class="np-foot">
        <button class={`icon-btn ${sleep ? 'active' : ''}`} aria-label="Minuterie" onClick={sleepMenu}>
          <Icon name="timer" size={22} />
        </button>
        <button class="icon-btn" aria-label="Ajouter à une playlist" onClick={() => playlistPicker([t.id])}>
          <Icon name="playlistAdd" size={24} />
        </button>
        <button class={`icon-btn ${showQueue ? 'active' : ''}`} aria-label="File d'attente" onClick={() => ui.set({ queue: !showQueue })}>
          <Icon name="queue" size={24} />
        </button>
      </div>
    </div>
  );
}

function Seek() {
  const pos = useObs(player, (s) => s.position);
  const dur = useObs(player, (s) => s.duration);
  const [drag, setDrag] = useState<number | null>(null);
  const v = drag ?? pos;
  const pct = dur ? Math.min(100, (v / dur) * 100) : 0;
  return (
    <div class="seek">
      <input
        type="range"
        min={0}
        max={dur || 1}
        step={0.5}
        value={v}
        style={{ '--p': `${pct}%` }}
        aria-label="Position"
        onInput={(e) => setDrag(Number((e.target as HTMLInputElement).value))}
        onChange={(e) => {
          seek(Number((e.target as HTMLInputElement).value));
          setDrag(null);
        }}
      />
      <div class="seek-times">
        <span>{formatDuration(v * 1000) || '0:00'}</span>
        <span>{dur ? `-${formatDuration(Math.max(0, dur - v) * 1000) || '0:00'}` : ''}</span>
      </div>
    </div>
  );
}

function sleepMenu() {
  const s = player.get();
  const active = s.sleepAt != null || s.sleepEndOfTrack;
  const opts: [string, number | 'end'][] = [
    ['5 minutes', 5],
    ['15 minutes', 15],
    ['30 minutes', 30],
    ['45 minutes', 45],
    ['1 heure', 60],
    ['À la fin du titre', 'end'],
  ];
  const remaining = s.sleepAt ? Math.max(1, Math.round((s.sleepAt - Date.now()) / 60000)) : 0;
  openSheet({
    title: 'Minuterie de mise en veille',
    subtitle: active ? (s.sleepEndOfTrack ? 'Arrêt à la fin du titre' : `Arrêt dans ${remaining} min`) : 'La musique s’arrêtera toute seule',
    actions: [
      ...(active ? [{ label: 'Désactiver la minuterie', icon: 'close', onClick: () => setSleep(null) }] : []),
      ...opts.map(([label, v]) => ({
        label,
        icon: 'timer',
        onClick: () => {
          setSleep(v);
          toast(v === 'end' ? 'Arrêt à la fin du titre' : `Arrêt dans ${label}`);
        },
      })),
    ],
  });
}

// --------------------------------------------------------- file d'attente

function QueueView() {
  const queue = useObs(player, (s) => s.queue);
  const index = useObs(player, (s) => s.index);
  const playing = useObs(player, (s) => s.playing);
  useObs(lib, (s) => s.version);
  const tracks = lib.get().tracks;
  const cur = tracks.get(queue[index]);
  const upcoming = queue.slice(index + 1).map((id, i) => ({ id, i: index + 1 + i }));
  return (
    <div class="np-queue">
      {cur && (
        <>
          <h3>En cours</h3>
          <div class="row track current">
            <div class="row-cover">
              <Cover id={cur.coverId} seed={cur.album} />
              <div class="cover-overlay">
                <PlayingBars paused={!playing} />
              </div>
            </div>
            <div class="row-text">
              <div class="row-title">{cur.title}</div>
              <div class="row-sub">{cur.artist}</div>
            </div>
          </div>
        </>
      )}
      <div class="queue-head">
        <h3>À suivre</h3>
        {upcoming.length > 0 && (
          <button class="text-btn" onClick={clearUpcoming}>
            Tout effacer
          </button>
        )}
      </div>
      {!upcoming.length && <p class="muted">La file d’attente est vide.</p>}
      <DragList
        items={upcoming}
        keyOf={(u) => `${u.id}:${u.i}`}
        onMove={(from, to) => moveInQueue(upcoming[from].i, upcoming[to].i)}
        render={(u, _i, handle) => {
          const t = tracks.get(u.id);
          if (!t) return null;
          return (
            <div class="row track" onClick={() => jumpTo(u.i)}>
              <div class="row-cover">
                <Cover id={t.coverId} seed={t.album} />
              </div>
              <div class="row-text">
                <div class="row-title">{t.title}</div>
                <div class="row-sub">{t.artist}</div>
              </div>
              <button
                class="icon-btn"
                aria-label="Retirer de la file"
                onClick={(e) => {
                  e.stopPropagation();
                  removeFromQueue(u.i);
                }}
              >
                <Icon name="close" size={20} />
              </button>
              {handle}
            </div>
          );
        }}
      />
    </div>
  );
}

// ------------------------------------------------------------- superpositions

export function Overlays() {
  const sheet = useObs(ui, (s) => s.sheet);
  const prompt = useObs(ui, (s) => s.prompt);
  const confirm = useObs(ui, (s) => s.confirm);
  const t = useObs(ui, (s) => s.toast);
  const updateReady = useObs(ui, (s) => s.updateReady);
  return (
    <>
      {sheet && (
        <div class="backdrop" onClick={closeSheet}>
          <div class="sheet" onClick={(e) => e.stopPropagation()}>
            <div class="sheet-handle" />
            {(sheet.title || sheet.coverId) && (
              <div class="sheet-head">
                {sheet.coverId !== undefined && (
                  <div class="row-cover">
                    <Cover id={sheet.coverId} seed={sheet.title} />
                  </div>
                )}
                <div class="row-text">
                  <div class="row-title">{sheet.title}</div>
                  {sheet.subtitle && <div class="row-sub">{sheet.subtitle}</div>}
                </div>
              </div>
            )}
            <div class="sheet-body">
              {sheet.content?.()}
              {sheet.actions?.map((a) => (
                <button
                  key={a.label}
                  class={`sheet-action ${a.danger ? 'danger' : ''}`}
                  onClick={() => {
                    closeSheet();
                    a.onClick();
                  }}
                >
                  {a.icon && <Icon name={a.icon} />}
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {prompt && <PromptDialog />}
      {confirm && (
        <div class="backdrop center">
          <div class="dialog">
            <h3>{confirm.title}</h3>
            {confirm.message && <p>{confirm.message}</p>}
            <div class="dialog-actions">
              <button
                class="btn"
                onClick={() => {
                  ui.set({ confirm: null });
                  confirm.resolve(false);
                }}
              >
                Annuler
              </button>
              <button
                class={`btn ${confirm.danger ? 'danger' : 'primary'}`}
                onClick={() => {
                  ui.set({ confirm: null });
                  confirm.resolve(true);
                }}
              >
                {confirm.confirm}
              </button>
            </div>
          </div>
        </div>
      )}
      {(t || updateReady) && (
        <div class="toast-wrap">
          {updateReady ? (
            <div class="toast">
              <span>Nouvelle version disponible</span>
              <button onClick={() => location.reload()}>Mettre à jour</button>
            </div>
          ) : (
            t && (
              <div class="toast" key={t.id}>
                <span>{t.text}</span>
                {t.action && (
                  <button
                    onClick={() => {
                      ui.set({ toast: null });
                      t.action!.run();
                    }}
                  >
                    {t.action.label}
                  </button>
                )}
              </div>
            )
          )}
        </div>
      )}
    </>
  );
}

function PromptDialog() {
  const prompt = ui.get().prompt!;
  const [v, setV] = useState(prompt.value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const done = (val: string | null) => {
    ui.set({ prompt: null });
    prompt.resolve(val);
  };
  return (
    <div class="backdrop center" onClick={() => done(null)}>
      <form
        class="dialog"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          done(v);
        }}
      >
        <h3>{prompt.title}</h3>
        <input ref={ref} class="input" value={v} placeholder={prompt.placeholder} onInput={(e) => setV((e.target as HTMLInputElement).value)} />
        <div class="dialog-actions">
          <button type="button" class="btn" onClick={() => done(null)}>
            Annuler
          </button>
          <button type="submit" class="btn primary" disabled={!v.trim()}>
            {prompt.confirm}
          </button>
        </div>
      </form>
    </div>
  );
}
