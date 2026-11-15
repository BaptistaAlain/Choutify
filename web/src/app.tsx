import { Icon } from './icons';
import { useObs } from './lib/store';
import { lib } from './lib/library';
import { player } from './lib/player';
import { MiniPlayer, NowPlaying, Overlays } from './playerui';
import { navigate, useRoute } from './router';
import { DrivePicker, ScanBanner, Settings } from './settings';
import { AlbumPage, ArtistPage, GenrePage, Home, Library, NotFound, PlaylistPage, Search } from './views';

function Page({ path }: { path: string }) {
  const [, section, ...rest] = path.split('/');
  const arg = rest.join('/');
  switch (section) {
    case '':
      return <Home />;
    case 'search':
      return <Search />;
    case 'library':
      return <Library tab={arg} />;
    case 'album':
      return <AlbumPage id={arg} />;
    case 'artist':
      return <ArtistPage id={arg} />;
    case 'playlist':
      return <PlaylistPage id={arg} />;
    case 'genre':
      return <GenrePage id={decodeURIComponent(arg)} />;
    case 'settings':
      return <Settings />;
    case 'drive':
      return <DrivePicker />;
    default:
      return <NotFound />;
  }
}

const TABS = [
  { key: '', label: 'Accueil', icon: 'home', match: ['', 'settings', 'drive'] },
  { key: 'search', label: 'Rechercher', icon: 'search', match: ['search', 'genre'] },
  { key: 'library', label: 'Bibliothèque', icon: 'library', match: ['library', 'album', 'artist', 'playlist'] },
];

export function App() {
  const path = useRoute();
  const ready = useObs(lib, (s) => s.ready);
  const hasTrack = useObs(player, (s) => s.index >= 0);
  const section = path.split('/')[1] ?? '';
  if (!ready) {
    return (
      <div class="boot">
        <div class="spinner" />
      </div>
    );
  }
  return (
    <div class={`app ${hasTrack ? 'with-mini' : ''}`}>
      <main key={path}>
        <Page path={path} />
      </main>
      <div class="bottom">
        <ScanBanner />
        <MiniPlayer />
        <nav class="tabbar">
          {TABS.map((t) => {
            const on = t.match.includes(section);
            return (
              <button
                key={t.key}
                class={on ? 'on' : ''}
                onClick={() => {
                  const target = `/${t.key}`;
                  if (path !== target) navigate(target);
                  else window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              >
                <Icon name={t.icon} size={26} />
                <span>{t.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
      <NowPlaying />
      <Overlays />
    </div>
  );
}
