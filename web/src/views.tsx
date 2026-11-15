import type { ComponentChildren } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import {
  AlbumCard,
  ArtistCard,
  collectionMenu,
  Cover,
  DragList,
  Empty,
  Mosaic,
  offline,
  PlayButtons,
  Shelf,
  TopBar,
  TrackList,
  TrackRow,
  tracksOf,
} from './components';
import { Icon } from './icons';
import { useCover } from './lib/covers';
import { getDerived, lib, norm, search, deletePlaylist, updatePlaylist, createPlaylist, type Album, type Track } from './lib/library';
import { playTracks } from './lib/player';
import { useObs } from './lib/store';
import { ask, confirmDialog, formatTotal, plural, toast } from './lib/ui';
import { navigate } from './router';

function useLib() {
  // Re-rend quand la bibliothèque, les favoris, les playlists ou les stats changent.
  useObs(lib, (s) => s.version);
  useObs(lib, (s) => s.playlists);
  useObs(lib, (s) => s.likes);
  return getDerived();
}

function totalMs(tracks: Track[]) {
  return tracks.reduce((a, t) => a + (t.durationMs ?? 0), 0);
}

// ------------------------------------------------------------------ accueil

export function Home() {
  const d = useLib();
  const stats = useObs(lib, (s) => s.stats);
  const scan = useObs(lib, (s) => s.scan);
  const sources = useObs(lib, (s) => s.sources);
  const likes = useObs(lib, (s) => s.likes);
  const playlists = useObs(lib, (s) => s.playlists);
  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'Bonne nuit' : hour < 18 ? 'Bonjour' : 'Bonsoir';

  const shelves = useMemo(() => {
    const albumLast = new Map<string, number>();
    const albumPlays = new Map<string, number>();
    const artistPlays = new Map<string, number>();
    for (const a of d.albums) {
      for (const t of a.tracks) {
        const s = stats[t.id];
        if (!s) continue;
        albumLast.set(a.key, Math.max(albumLast.get(a.key) ?? 0, s.l));
        albumPlays.set(a.key, (albumPlays.get(a.key) ?? 0) + s.p);
      }
    }
    for (const ar of d.artists) {
      let p = 0;
      for (const t of ar.tracks) p += stats[t.id]?.p ?? 0;
      if (p) artistPlays.set(ar.name, p);
    }
    const recent = d.albums.filter((a) => albumLast.has(a.key)).sort((a, b) => albumLast.get(b.key)! - albumLast.get(a.key)!).slice(0, 12);
    const added = d.albums.slice().sort((a, b) => b.addedAt - a.addedAt).slice(0, 12);
    const top = d.all.filter((t) => stats[t.id]).sort((a, b) => stats[b.id].p - stats[a.id].p).slice(0, 10);
    const artists = d.artists.filter((a) => artistPlays.has(a.name)).sort((a, b) => artistPlays.get(b.name)! - artistPlays.get(a.name)!).slice(0, 12);
    const monthAgo = Date.now() - 30 * 86400_000;
    const rediscover = d.albums
      .filter((a) => (albumPlays.get(a.key) ?? 0) >= 2 && (albumLast.get(a.key) ?? 0) < monthAgo)
      .slice(0, 12);
    const random = d.albums.length > 12 ? shuffleSeeded(d.albums, new Date().toDateString()).slice(0, 12) : [];
    return { recent, added, top, artists, rediscover, random };
    // stats change à chaque écoute : on ne recalcule pas en pleine lecture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, Object.keys(stats).length]);

  const quick: { label: string; href: string; cover: ComponentChildren }[] = [];
  if (likes.size) quick.push({ label: 'Titres aimés', href: '/playlist/liked', cover: <Mosaic tracks={[]} seed="" liked /> });
  for (const p of playlists.slice(-3).reverse()) {
    quick.push({ label: p.name, href: `/playlist/${p.id}`, cover: <Mosaic tracks={tracksOf(p.trackIds)} seed={p.name} /> });
  }
  for (const a of (shelves.recent.length ? shelves.recent : shelves.added).slice(0, 6 - quick.length)) {
    quick.push({ label: a.title, href: `/album/${a.key}`, cover: <Cover id={a.coverId} seed={a.title} icon="album" /> });
  }

  return (
    <div class="page">
      <TopBar
        title={greeting}
        solidAfter={10}
        right={
          <a class="icon-btn" href="#/settings" aria-label="Réglages">
            <Icon name="settings" />
          </a>
        }
      />
      <h1 class="page-title">{greeting}</h1>
      <InstallHint />
      {!d.all.length && !scan.running ? (
        <Welcome hasSources={sources.length > 0} />
      ) : (
        <>
          <div class="quick-grid">
            {quick.map((q) => (
              <a key={q.href} class="quick" href={`#${encodeURI(q.href)}`}>
                {q.cover}
                <span>{q.label}</span>
              </a>
            ))}
          </div>
          <button class="big-shuffle" onClick={() => playTracks(d.all.map((t) => t.id), 0, { shuffle: true, context: 'Toute la bibliothèque' })}>
            <Icon name="shuffle" />
            Lecture aléatoire de toute la bibliothèque
            <span>{plural(d.all.length, 'titre', 'titres')}</span>
          </button>
          {shelves.recent.length > 0 && <AlbumShelf title="Écoutés récemment" albums={shelves.recent} />}
          {shelves.top.length > 0 && (
            <section class="shelf">
              <div class="shelf-head">
                <h2>Tes titres les plus écoutés</h2>
              </div>
              <TrackList tracks={shelves.top} context="Les plus écoutés" />
            </section>
          )}
          {shelves.artists.length > 0 && (
            <Shelf title="Tes artistes">
              {shelves.artists.map((a) => (
                <ArtistCard key={a.name} artist={a} />
              ))}
            </Shelf>
          )}
          <AlbumShelf title="Ajoutés récemment" albums={shelves.added} more="/library/albums" />
          {shelves.rediscover.length > 0 && <AlbumShelf title="À redécouvrir" albums={shelves.rediscover} />}
          {shelves.random.length > 0 && <AlbumShelf title="Au hasard dans ta bibliothèque" albums={shelves.random} />}
        </>
      )}
    </div>
  );
}

function shuffleSeeded<T>(a: T[], seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const rnd = () => ((h = (h * 1103515245 + 12345) | 0), ((h >>> 16) & 0x7fff) / 0x7fff);
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

function AlbumShelf({ title, albums, more }: { title: string; albums: Album[]; more?: string }) {
  return (
    <Shelf title={title} more={more}>
      {albums.map((a) => (
        <AlbumCard key={a.key} album={a} />
      ))}
    </Shelf>
  );
}

function Welcome({ hasSources }: { hasSources: boolean }) {
  return (
    <div class="welcome">
      <div class="welcome-logo">
        <Icon name="note" size={40} />
      </div>
      <h2>Bienvenue dans Choutify</h2>
      <p>Écoute la musique de ton Google Drive sans la stocker sur ton téléphone, ou importe des fichiers depuis l’app Fichiers.</p>
      <a class="btn primary" href="#/settings">
        <Icon name="cloud" />
        {hasSources ? 'Ouvrir les réglages Google Drive' : 'Connecter Google Drive'}
      </a>
      <a class="btn" href="#/settings">
        <Icon name="upload" />
        Importer des fichiers
      </a>
    </div>
  );
}

function InstallHint() {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem('choutify.installHint') === '0';
    } catch {
      return false;
    }
  });
  const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (hidden || standalone || !ios) return null;
  return (
    <div class="hint">
      <Icon name="share" />
      <div>
        <b>Installe Choutify sur ton iPhone</b>
        <p>
          Dans Safari, touche <Icon name="share" size={14} /> Partager, puis « Sur l’écran d’accueil ». L’app s’ouvrira en plein écran et se mettra à
          jour toute seule.
        </p>
      </div>
      <button
        class="icon-btn"
        aria-label="Masquer"
        onClick={() => {
          try {
            localStorage.setItem('choutify.installHint', '0');
          } catch {
            /* ignore */
          }
          setHidden(true);
        }}
      >
        <Icon name="close" size={20} />
      </button>
    </div>
  );
}

// -------------------------------------------------------------- recherche

export function Search() {
  const d = useLib();
  const [q, setQ] = useState(() => sessionStorage.getItem('choutify.q') ?? '');
  const r = useMemo(() => search(q), [q, d]);
  const genres = useMemo(() => [...d.genres.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 24), [d]);
  return (
    <div class="page">
      <h1 class="page-title">Rechercher</h1>
      <div class="search-box">
        <Icon name="search" />
        <input
          type="search"
          placeholder="Titres, artistes, albums…"
          value={q}
          autocomplete="off"
          autocapitalize="off"
          onInput={(e) => {
            const v = (e.target as HTMLInputElement).value;
            setQ(v);
            sessionStorage.setItem('choutify.q', v);
          }}
        />
        {q && (
          <button
            class="icon-btn"
            aria-label="Effacer"
            onClick={() => {
              setQ('');
              sessionStorage.removeItem('choutify.q');
            }}
          >
            <Icon name="close" size={20} />
          </button>
        )}
      </div>
      {!r ? (
        genres.length > 0 && (
          <>
            <h2 class="section-title">Parcourir par genre</h2>
            <div class="genre-grid">
              {genres.map(([g, ts]) => (
                <a key={g} class="genre" href={`#/genre/${encodeURIComponent(g)}`} style={{ '--h': String(hueOf(g)) }}>
                  <span>{g}</span>
                  <small>{ts.length}</small>
                </a>
              ))}
            </div>
          </>
        )
      ) : !r.tracks.length && !r.albums.length && !r.artists.length && !r.playlists.length ? (
        <Empty icon="search" title="Aucun résultat" text={`Rien ne correspond à « ${q} ».`} />
      ) : (
        <>
          {r.artists.length > 0 && (
            <Shelf title="Artistes">
              {r.artists.map((a) => (
                <ArtistCard key={a.name} artist={a} />
              ))}
            </Shelf>
          )}
          {r.tracks.length > 0 && (
            <section class="shelf">
              <div class="shelf-head">
                <h2>Titres</h2>
              </div>
              <div class="list">
                {r.tracks.map((t) => (
                  <TrackRow key={t.id} track={t} onPlay={() => playTracks([t.id], 0, { shuffle: false, context: 'Recherche' })} />
                ))}
              </div>
            </section>
          )}
          {r.albums.length > 0 && <AlbumShelf title="Albums" albums={r.albums} />}
          {r.playlists.length > 0 && (
            <section class="shelf">
              <div class="shelf-head">
                <h2>Playlists</h2>
              </div>
              <PlaylistRows ids={r.playlists.map((p) => p.id)} />
            </section>
          )}
        </>
      )}
    </div>
  );
}

function hueOf(s: string) {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

// ----------------------------------------------------------- bibliothèque

const TABS = [
  ['playlists', 'Playlists'],
  ['albums', 'Albums'],
  ['artists', 'Artistes'],
  ['tracks', 'Titres'],
  ['genres', 'Genres'],
] as const;

export function Library({ tab }: { tab?: string }) {
  const d = useLib();
  const current = TABS.some((t) => t[0] === tab) ? tab! : 'playlists';
  const [sort, setSort] = useState(() => localStorage.getItem('choutify.sort.' + current) ?? 'name');
  const sortKey = localStorage.getItem('choutify.sort.' + current) ?? sort;
  const setSortKey = (v: string) => {
    try {
      localStorage.setItem('choutify.sort.' + current, v);
    } catch {
      /* ignore */
    }
    setSort(v);
  };
  const sortOptions: Record<string, [string, string][]> = {
    albums: [
      ['name', 'Nom'],
      ['artist', 'Artiste'],
      ['recent', 'Ajout récent'],
      ['year', 'Année'],
    ],
    tracks: [
      ['name', 'Titre'],
      ['artist', 'Artiste'],
      ['recent', 'Ajout récent'],
    ],
  };
  const albums = useMemo(() => {
    const a = d.albums.slice();
    if (sortKey === 'artist') a.sort((x, y) => x.artist.localeCompare(y.artist, 'fr') || (x.year ?? 0) - (y.year ?? 0));
    else if (sortKey === 'recent') a.sort((x, y) => y.addedAt - x.addedAt);
    else if (sortKey === 'year') a.sort((x, y) => (y.year ?? 0) - (x.year ?? 0));
    return a;
  }, [d, sortKey]);
  const tracks = useMemo(() => {
    const t = d.all.slice();
    if (sortKey === 'artist') t.sort((x, y) => x.artist.localeCompare(y.artist, 'fr') || x.album.localeCompare(y.album, 'fr'));
    else if (sortKey === 'recent') t.sort((x, y) => y.addedAt - x.addedAt);
    return t;
  }, [d, sortKey]);

  return (
    <div class="page">
      <TopBar
        title="Bibliothèque"
        solidAfter={10}
        right={
          <button
            class="icon-btn"
            aria-label="Nouvelle playlist"
            onClick={async () => {
              const name = await ask('Nouvelle playlist', '', 'Créer', 'Nom de la playlist');
              if (name?.trim()) {
                const p = await createPlaylist(name.trim());
                navigate(`/playlist/${p.id}`);
              }
            }}
          >
            <Icon name="plus" />
          </button>
        }
      />
      <h1 class="page-title">Bibliothèque</h1>
      <div class="chips">
        {TABS.map(([k, label]) => (
          <button key={k} class={`chip ${current === k ? 'on' : ''}`} onClick={() => navigate(`/library/${k}`, true)}>
            {label}
          </button>
        ))}
      </div>
      {sortOptions[current] && (
        <div class="sort-row">
          <Icon name="sort" size={18} />
          <select value={sortKey} onChange={(e) => setSortKey((e.target as HTMLSelectElement).value)}>
            {sortOptions[current].map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
          <span class="muted">{current === 'albums' ? plural(albums.length, 'album', 'albums') : plural(tracks.length, 'titre', 'titres')}</span>
        </div>
      )}
      {current === 'playlists' && <PlaylistRows withLiked />}
      {current === 'albums' &&
        (albums.length ? (
          <div class="grid">
            {albums.map((a) => (
              <AlbumCard key={a.key} album={a} />
            ))}
          </div>
        ) : (
          <Empty icon="album" title="Aucun album" text="Ajoute un dossier Google Drive ou importe des fichiers dans les réglages." />
        ))}
      {current === 'artists' && (
        <div class="list">
          {d.artists.map((a) => (
            <a key={a.name} class="row" href={`#/artist/${encodeURI(norm(a.name))}`}>
              <div class="row-cover">
                <Cover id={a.coverId} seed={a.name} round icon="person" />
              </div>
              <div class="row-text">
                <div class="row-title">{a.name}</div>
                <div class="row-sub">
                  {plural(a.albums.length, 'album', 'albums')} · {plural(a.tracks.length, 'titre', 'titres')}
                </div>
              </div>
              <Icon name="chevron" class="muted" />
            </a>
          ))}
        </div>
      )}
      {current === 'tracks' && (tracks.length ? <TrackList tracks={tracks} context="Tous les titres" /> : <Empty icon="note" title="Aucun titre" />)}
      {current === 'genres' && (
        <div class="list">
          {[...d.genres.entries()]
            .sort((a, b) => a[0].localeCompare(b[0], 'fr'))
            .map(([g, ts]) => (
              <a key={g} class="row" href={`#/genre/${encodeURIComponent(g)}`}>
                <div class="row-cover">
                  <div class="cover genre-cover" style={{ '--h': String(hueOf(g)) }}>
                    {g.slice(0, 2)}
                  </div>
                </div>
                <div class="row-text">
                  <div class="row-title">{g}</div>
                  <div class="row-sub">{plural(ts.length, 'titre', 'titres')}</div>
                </div>
                <Icon name="chevron" class="muted" />
              </a>
            ))}
        </div>
      )}
    </div>
  );
}

function PlaylistRows({ withLiked, ids }: { withLiked?: boolean; ids?: string[] }) {
  const playlists = useObs(lib, (s) => s.playlists);
  const likes = useObs(lib, (s) => s.likes);
  const shown = ids ? playlists.filter((p) => ids.includes(p.id)) : playlists;
  return (
    <div class="list">
      {withLiked && (
        <a class="row" href="#/playlist/liked">
          <div class="row-cover">
            <Mosaic tracks={[]} seed="" liked />
          </div>
          <div class="row-text">
            <div class="row-title">Titres aimés</div>
            <div class="row-sub">{plural(likes.size, 'titre', 'titres')}</div>
          </div>
          <Icon name="chevron" class="muted" />
        </a>
      )}
      {shown.map((p) => (
        <a key={p.id} class="row" href={`#/playlist/${p.id}`}>
          <div class="row-cover">
            <Mosaic tracks={tracksOf(p.trackIds)} seed={p.name} />
          </div>
          <div class="row-text">
            <div class="row-title">{p.name}</div>
            <div class="row-sub">Playlist · {plural(p.trackIds.length, 'titre', 'titres')}</div>
          </div>
          <Icon name="chevron" class="muted" />
        </a>
      ))}
      {withLiked && !playlists.length && <p class="muted pad">Crée une playlist avec le bouton + en haut, ou depuis le menu ··· d’un titre.</p>}
    </div>
  );
}

// ------------------------------------------------------------------ album

function Hero({ coverId, seed, kind, title, sub, meta, round, cover }: { coverId?: string; seed: string; kind: string; title: string; sub?: ComponentChildren; meta?: string; round?: boolean; cover?: ComponentChildren }) {
  return (
    <div class="hero">
      <div class={`hero-cover ${round ? 'round' : ''}`}>{cover ?? <Cover id={coverId} seed={seed} round={round} icon={round ? 'person' : 'album'} />}</div>
      <div class="hero-kind">{kind}</div>
      <h1 class="hero-title">{title}</h1>
      {sub && <div class="hero-sub">{sub}</div>}
      {meta && <div class="hero-meta">{meta}</div>}
    </div>
  );
}

function HeroBg({ coverId }: { coverId?: string }) {
  return <HeroBgInner key={coverId} coverId={coverId} />;
}
function HeroBgInner({ coverId }: { coverId?: string }) {
  const c = useCoverColor(coverId);
  return <div class="hero-bg" style={c ? { '--c': c } : undefined} />;
}
function useCoverColor(id?: string) {
  return useCover(id)?.color;
}

export function AlbumPage({ id }: { id: string }) {
  const d = useLib();
  const album = d.albumMap.get(id);
  if (!album) return <NotFound />;
  const ids = album.tracks.map((t) => t.id);
  const discs = new Set(album.tracks.map((t) => t.discNo ?? 1));
  const firstArtist = album.tracks[0].albumArtist || album.tracks[0].artist;
  return (
    <div class="page has-hero">
      <HeroBg coverId={album.coverId} />
      <TopBar title={album.title} backTo="/library/albums" />
      <Hero
        coverId={album.coverId}
        seed={album.title}
        kind="Album"
        title={album.title}
        sub={
          album.artist === 'Artistes variés' ? (
            album.artist
          ) : (
            <a href={`#/artist/${encodeURI(norm(firstArtist.split(',')[0]))}`}>{album.artist}</a>
          )
        }
        meta={[album.year, plural(album.tracks.length, 'titre', 'titres'), formatTotal(totalMs(album.tracks))].filter(Boolean).join(' · ')}
      />
      <PlayButtons
        ids={ids}
        context={`Album · ${album.title}`}
        extra={
          <>
            <button class="icon-btn lg" aria-label="Télécharger" onClick={() => offline(album.tracks)}>
              <Icon name="download" />
            </button>
            <button class="icon-btn lg" aria-label="Plus" onClick={() => collectionMenu(album.title, album.artist, album.tracks, album.coverId)}>
              <Icon name="more" />
            </button>
          </>
        }
      />
      {[...discs].sort().map((disc) => (
        <div key={disc}>
          {discs.size > 1 && <h3 class="disc">Disque {disc}</h3>}
          <TrackList tracks={album.tracks.filter((t) => (t.discNo ?? 1) === disc)} numbered context={`Album · ${album.title}`} />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- artiste

export function ArtistPage({ id }: { id: string }) {
  const d = useLib();
  const stats = useObs(lib, (s) => s.stats);
  const artist = d.artistMap.get(id);
  const [all, setAll] = useState(false);
  if (!artist) return <NotFound />;
  const popular = artist.tracks
    .slice()
    .sort((a, b) => (stats[b.id]?.p ?? 0) - (stats[a.id]?.p ?? 0))
    .slice(0, all ? undefined : 5);
  return (
    <div class="page has-hero">
      <HeroBg coverId={artist.coverId} />
      <TopBar title={artist.name} backTo="/library/artists" />
      <Hero
        coverId={artist.coverId}
        seed={artist.name}
        round
        kind="Artiste"
        title={artist.name}
        meta={`${plural(artist.albums.length, 'album', 'albums')} · ${plural(artist.tracks.length, 'titre', 'titres')}`}
      />
      <PlayButtons
        ids={artist.tracks.map((t) => t.id)}
        context={`Artiste · ${artist.name}`}
        extra={
          <button class="icon-btn lg" aria-label="Plus" onClick={() => collectionMenu(artist.name, 'Artiste', artist.tracks, artist.coverId)}>
            <Icon name="more" />
          </button>
        }
      />
      <section class="shelf">
        <div class="shelf-head">
          <h2>{Object.keys(stats).length ? 'Populaires' : 'Titres'}</h2>
        </div>
        <TrackList tracks={popular} context={`Artiste · ${artist.name}`} />
        {artist.tracks.length > 5 && (
          <button class="text-btn" onClick={() => setAll(!all)}>
            {all ? 'Afficher moins' : `Afficher les ${artist.tracks.length} titres`}
          </button>
        )}
      </section>
      <section class="shelf">
        <div class="shelf-head">
          <h2>Albums</h2>
        </div>
        <div class="grid">
          {artist.albums.map((a) => (
            <AlbumCard key={a.key} album={a} />
          ))}
        </div>
      </section>
    </div>
  );
}

// --------------------------------------------------------------- playlist

export function PlaylistPage({ id }: { id: string }) {
  useLib();
  const playlists = useObs(lib, (s) => s.playlists);
  const likes = useObs(lib, (s) => s.likes);
  const [editing, setEditing] = useState(false);
  const liked = id === 'liked';
  const p = liked ? null : playlists.find((x) => x.id === id);
  if (!liked && !p) return <NotFound />;
  const tracks = liked ? tracksOf([...likes].reverse()) : tracksOf(p!.trackIds);
  const name = liked ? 'Titres aimés' : p!.name;
  const context = `Playlist · ${name}`;
  const extra = !liked
    ? [
        {
          label: 'Renommer',
          icon: 'edit',
          onClick: async () => {
            const n = await ask('Renommer la playlist', p!.name, 'Renommer');
            if (n?.trim()) updatePlaylist(p!.id, { name: n.trim() });
          },
        },
        { label: 'Modifier l’ordre', icon: 'drag', onClick: () => setEditing(true) },
        {
          label: 'Supprimer la playlist',
          icon: 'trash',
          danger: true,
          onClick: async () => {
            if (await confirmDialog('Supprimer la playlist ?', `« ${p!.name} » sera supprimée. Les titres restent dans ta bibliothèque.`, 'Supprimer', true)) {
              await deletePlaylist(p!.id);
              navigate('/library/playlists', true);
              toast('Playlist supprimée');
            }
          },
        },
      ]
    : [];
  return (
    <div class="page has-hero">
      <HeroBg coverId={tracks.find((t) => t.coverId)?.coverId} />
      <TopBar
        title={name}
        backTo="/library/playlists"
        right={
          editing && (
            <button class="text-btn" onClick={() => setEditing(false)}>
              OK
            </button>
          )
        }
      />
      <Hero
        seed={name}
        kind="Playlist"
        title={name}
        cover={<Mosaic tracks={tracks} seed={name} liked={liked} />}
        meta={`${plural(tracks.length, 'titre', 'titres')}${tracks.length ? ' · ' + formatTotal(totalMs(tracks)) : ''}`}
      />
      {tracks.length > 0 && !editing && (
        <PlayButtons
          ids={tracks.map((t) => t.id)}
          context={context}
          extra={
            <>
              <button class="icon-btn lg" aria-label="Télécharger" onClick={() => offline(tracks)}>
                <Icon name="download" />
              </button>
              <button class="icon-btn lg" aria-label="Plus" onClick={() => collectionMenu(name, 'Playlist', tracks, undefined, extra)}>
                <Icon name="more" />
              </button>
            </>
          }
        />
      )}
      {!tracks.length && (
        <Empty
          icon={liked ? 'heart' : 'queue'}
          title={liked ? 'Aucun titre aimé' : 'Playlist vide'}
          text={liked ? 'Touche le cœur dans le lecteur pour retrouver tes titres ici.' : 'Ajoute des titres avec le menu ··· d’un titre ou d’un album.'}
        >
          {!liked && (
            <button class="btn" onClick={() => collectionMenu(name, 'Playlist', [], undefined, extra)}>
              Options de la playlist
            </button>
          )}
        </Empty>
      )}
      {editing && p ? (
        <DragList
          items={tracks}
          keyOf={(t, i) => t.id + i}
          onMove={(from, to) => {
            const ids = p.trackIds.slice();
            const [x] = ids.splice(from, 1);
            ids.splice(to, 0, x);
            updatePlaylist(p.id, { trackIds: ids });
          }}
          render={(t, i, handle) => (
            <div class="row track">
              <button
                class="icon-btn"
                aria-label="Retirer"
                onClick={() => updatePlaylist(p.id, { trackIds: p.trackIds.filter((_, k) => k !== i) })}
              >
                <Icon name="minus" />
              </button>
              <div class="row-cover">
                <Cover id={t.coverId} seed={t.album} />
              </div>
              <div class="row-text">
                <div class="row-title">{t.title}</div>
                <div class="row-sub">{t.artist}</div>
              </div>
              {handle}
            </div>
          )}
        />
      ) : (
        <TrackList tracks={tracks} context={context} playlistId={liked ? undefined : p!.id} />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ genre

export function GenrePage({ id }: { id: string }) {
  const d = useLib();
  const tracks = d.genres.get(id) ?? [];
  return (
    <div class="page">
      <TopBar title={id} backTo="/search" solidAfter={10} />
      <h1 class="page-title">{id}</h1>
      {tracks.length > 0 && <PlayButtons ids={tracks.map((t) => t.id)} context={`Genre · ${id}`} />}
      <TrackList tracks={tracks} context={`Genre · ${id}`} />
    </div>
  );
}

export function NotFound() {
  return (
    <div class="page">
      <TopBar title="" backTo="/" />
      <Empty icon="note" title="Introuvable" text="Cet élément n’est plus dans ta bibliothèque.">
        <a class="btn" href="#/">
          Retour à l’accueil
        </a>
      </Empty>
    </div>
  );
}
