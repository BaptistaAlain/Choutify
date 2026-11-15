import { useEffect, useRef, useState } from 'preact/hooks';
import { TopBar } from './components';
import { Icon } from './icons';
import { cacheState, cacheUsage, clearCache } from './lib/audiocache';
import * as g from './lib/google';
import { addSource, deleteTracks, importFiles, lib, removeSource, resetLibrary, saveSettings, scanDrive } from './lib/library';
import { useObs } from './lib/store';
import { confirmDialog, formatBytes, plural, toast } from './lib/ui';
import { navigate } from './router';

declare const __APP_VERSION__: string;

const GUIDE = 'https://github.com/BaptistaAlain/Choutify/blob/main/web/README.md#connecter-google-drive';

export function ScanBanner() {
  const scan = useObs(lib, (s) => s.scan);
  if (!scan.running && !scan.error) return null;
  if (scan.error) {
    return (
      <div class="scan-banner error" onClick={() => navigate('/settings')}>
        <Icon name="cloud" size={18} />
        <span>Analyse interrompue : {scan.error}</span>
      </div>
    );
  }
  const pct = scan.total ? Math.round((scan.done / scan.total) * 100) : 0;
  return (
    <div class="scan-banner">
      <div class="spinner" />
      <span>{scan.total ? `${scan.phase} · ${scan.done} / ${scan.total}` : scan.phase}</span>
      {scan.total > 0 && <div class="scan-progress" style={{ width: `${pct}%` }} />}
    </div>
  );
}

export function Settings() {
  const sources = useObs(lib, (s) => s.sources);
  const account = useObs(lib, (s) => s.account);
  const scan = useObs(lib, (s) => s.scan);
  const version = useObs(lib, (s) => s.version);
  const settings = useObs(lib, (s) => s.settings);
  useObs(cacheState, (s) => s.index);
  const [, refresh] = useState(0);
  const connected = g.isConnected();
  const configured = g.isConfigured();
  const fileRef = useRef<HTMLInputElement>(null);
  const tracks = [...lib.get().tracks.values()];
  const localCount = tracks.filter((t) => t.source === 'local').length;
  const driveCount = tracks.length - localCount;
  const usage = cacheUsage();
  const [storage, setStorage] = useState<{ usage?: number; quota?: number } | null>(null);
  useEffect(() => {
    navigator.storage?.estimate?.().then(setStorage).catch(() => {});
  }, [version, usage.total]);

  useEffect(() => {
    const on = () => refresh((x) => x + 1);
    window.addEventListener('choutify:signed-out', on);
    return () => window.removeEventListener('choutify:signed-out', on);
  }, []);

  return (
    <div class="page">
      <TopBar title="Réglages" backTo="/" solidAfter={10} />
      <h1 class="page-title">Réglages</h1>

      <section class="card-section">
        <h2>
          <Icon name="cloud" /> Google Drive
        </h2>
        {!configured ? (
          <GoogleSetup onDone={() => refresh((x) => x + 1)} />
        ) : !connected ? (
          <>
            <p class="muted">Connecte ton compte Google pour lire la musique de ton Drive en streaming, sans la stocker sur ton iPhone.</p>
            <button
              class="btn primary"
              onClick={() =>
                g.startLogin('#/settings').catch((e) => {
                  toast(e.message);
                })
              }
            >
              <Icon name="cloud" /> Se connecter avec Google
            </button>
            <details class="details">
              <summary>Modifier l’identifiant client Google</summary>
              <GoogleSetup onDone={() => refresh((x) => x + 1)} />
            </details>
          </>
        ) : (
          <>
            <div class="account">
              <div class="avatar">{(account?.name || account?.email || 'G').slice(0, 1).toUpperCase()}</div>
              <div>
                <b>{account?.name || 'Compte Google'}</b>
                <div class="muted">{account?.email || 'Connecté'}</div>
              </div>
            </div>
            <h3>Dossiers de musique</h3>
            {sources.length === 0 && <p class="muted">Choisis le dossier de ton Drive où se trouve ta musique.</p>}
            <div class="list">
              {sources.map((s) => (
                <div key={s.id} class="row">
                  <div class="row-icon">
                    <Icon name="folder" />
                  </div>
                  <div class="row-text">
                    <div class="row-title">{s.name}</div>
                    <div class="row-sub">{plural(tracks.filter((t) => t.rootId === s.id).length, 'titre', 'titres')}</div>
                  </div>
                  <button
                    class="icon-btn"
                    aria-label="Retirer"
                    onClick={async () => {
                      if (await confirmDialog('Retirer ce dossier ?', `Les titres de « ${s.name} » disparaîtront de Choutify (rien n’est supprimé de ton Drive).`, 'Retirer', true)) {
                        removeSource(s.id);
                      }
                    }}
                  >
                    <Icon name="close" size={20} />
                  </button>
                </div>
              ))}
            </div>
            <div class="btn-row">
              <a class="btn primary" href="#/drive">
                <Icon name="plus" /> Ajouter un dossier
              </a>
              {sources.length > 0 && (
                <button
                  class="btn"
                  disabled={scan.running}
                  onClick={() =>
                    scanDrive().then(
                      () => toast('Bibliothèque à jour'),
                      (e) => toast(e.message),
                    )
                  }
                >
                  <Icon name="refresh" /> {scan.running ? 'Analyse…' : 'Actualiser'}
                </button>
              )}
            </div>
            <p class="muted small">
              {plural(driveCount, 'titre', 'titres')} depuis Google Drive. Choutify actualise la bibliothèque à chaque ouverture et ne lit que le
              début de chaque fichier pour les titres et pochettes.
            </p>
            <button
              class="text-btn danger"
              onClick={async () => {
                if (await confirmDialog('Se déconnecter de Google ?', 'Tes titres restent affichés, mais ne pourront plus être lus (sauf ceux gardés hors ligne).', 'Se déconnecter', true)) {
                  await g.signOut();
                  lib.set({ account: null });
                  refresh((x) => x + 1);
                }
              }}
            >
              Se déconnecter
            </button>
          </>
        )}
      </section>

      <section class="card-section">
        <h2>
          <Icon name="upload" /> Fichiers de l’iPhone
        </h2>
        <p class="muted">Importe des fichiers audio depuis l’app Fichiers (iCloud Drive, Sur mon iPhone…). Ils sont copiés dans Choutify et lisibles hors ligne.</p>
        <input
          ref={fileRef}
          type="file"
          accept="audio/*,.mp3,.m4a,.flac,.wav,.aac,.ogg,.opus"
          multiple
          hidden
          onChange={async (e) => {
            const input = e.target as HTMLInputElement;
            const files = [...(input.files ?? [])];
            input.value = '';
            if (!files.length) return;
            const n = await importFiles(files);
            toast(n ? `${plural(n, 'titre importé', 'titres importés')}` : 'Aucun nouveau fichier audio');
          }}
        />
        <div class="btn-row">
          <button class="btn" onClick={() => fileRef.current?.click()} disabled={scan.running}>
            <Icon name="upload" /> Importer des fichiers
          </button>
          {localCount > 0 && (
            <button
              class="btn"
              onClick={async () => {
                if (await confirmDialog('Supprimer les fichiers importés ?', `${plural(localCount, 'titre sera effacé', 'titres seront effacés')} de cet appareil.`, 'Supprimer', true)) {
                  await deleteTracks(tracks.filter((t) => t.source === 'local').map((t) => t.id));
                }
              }}
            >
              <Icon name="trash" /> Supprimer ({localCount})
            </button>
          )}
        </div>
      </section>

      <section class="card-section">
        <h2>
          <Icon name="download" /> Cache et hors ligne
        </h2>
        <p class="muted">
          Les titres écoutés sont gardés pour être relus sans réseau. Les albums et playlists téléchargés (bouton <Icon name="download" size={14} />) ne
          sont jamais effacés automatiquement.
        </p>
        <div class="kv">
          <span>Titres en cache</span>
          <b>
            {usage.count} · {formatBytes(usage.total)}
          </b>
        </div>
        <div class="kv">
          <span>Dont hors ligne</span>
          <b>{formatBytes(usage.pinned)}</b>
        </div>
        {storage?.quota ? (
          <div class="kv">
            <span>Espace utilisé par Choutify</span>
            <b>
              {formatBytes(storage.usage ?? 0)} / {formatBytes(storage.quota)}
            </b>
          </div>
        ) : null}
        <label class="kv">
          <span>Taille maximale du cache</span>
          <select value={String(settings.cacheLimitMB)} onChange={(e) => saveSettings({ cacheLimitMB: Number((e.target as HTMLSelectElement).value) })}>
            {[500, 1000, 2000, 5000, 10000, 20000].map((v) => (
              <option key={v} value={String(v)}>
                {v >= 1000 ? `${v / 1000} Go` : `${v} Mo`}
              </option>
            ))}
          </select>
        </label>
        <button
          class="btn"
          onClick={async () => {
            if (await confirmDialog('Vider le cache ?', 'Les titres (y compris hors ligne) seront de nouveau téléchargés depuis Google Drive à la prochaine écoute.', 'Vider', true)) {
              await clearCache();
              toast('Cache vidé');
            }
          }}
        >
          <Icon name="trash" /> Vider le cache
        </button>
      </section>

      <section class="card-section">
        <h2>
          <Icon name="settings" /> À propos
        </h2>
        <div class="kv">
          <span>Version</span>
          <b>{__APP_VERSION__}</b>
        </div>
        <p class="muted small">
          Choutify web se met à jour automatiquement à chaque ouverture. Sur iPhone, la lecture continue écran verrouillé tant que l’app reste
          ouverte en arrière-plan.
        </p>
        <a class="text-btn" href="https://github.com/BaptistaAlain/Choutify" target="_blank" rel="noopener">
          Code source sur GitHub
        </a>
        <a class="text-btn" href="./confidentialite.html" target="_blank" rel="noopener">
          Règles de confidentialité
        </a>
        <button
          class="text-btn danger"
          onClick={async () => {
            if (await confirmDialog('Réinitialiser la bibliothèque ?', 'Les dossiers, titres, pochettes et fichiers importés seront effacés de cet appareil. Les playlists sont conservées.', 'Réinitialiser', true)) {
              await resetLibrary();
              toast('Bibliothèque réinitialisée');
            }
          }}
        >
          Réinitialiser la bibliothèque
        </button>
      </section>
    </div>
  );
}

function GoogleSetup({ onDone }: { onDone: () => void }) {
  const cfg = g.getConfig();
  const [clientId, setClientId] = useState(cfg.clientId);
  const [secret, setSecret] = useState(cfg.clientSecret);
  const uri = g.redirectUri();
  const origin = location.origin;
  const copy = (v: string) =>
    navigator.clipboard?.writeText(v).then(
      () => toast('Copié'),
      () => toast(v),
    );
  return (
    <div class="setup">
      <p>
        Pour accéder à ton Drive, Choutify a besoin d’un identifiant client Google gratuit (à créer une seule fois, environ 10 minutes).{' '}
        <a href={GUIDE} target="_blank" rel="noopener">
          Voir le guide pas à pas
        </a>
        .
      </p>
      <div class="copy-field">
        <label>Origine JavaScript autorisée</label>
        <button onClick={() => copy(origin)}>
          <code>{origin}</code>
          <Icon name="copy" size={16} />
        </button>
      </div>
      <div class="copy-field">
        <label>URI de redirection autorisé</label>
        <button onClick={() => copy(uri)}>
          <code>{uri}</code>
          <Icon name="copy" size={16} />
        </button>
      </div>
      <label class="field">
        <span>ID client</span>
        <input value={clientId} onInput={(e) => setClientId((e.target as HTMLInputElement).value)} placeholder="xxxx.apps.googleusercontent.com" autocapitalize="off" autocomplete="off" spellcheck={false} />
      </label>
      <label class="field">
        <span>Code secret du client</span>
        <input value={secret} onInput={(e) => setSecret((e.target as HTMLInputElement).value)} placeholder="GOCSPX-…" autocapitalize="off" autocomplete="off" spellcheck={false} />
      </label>
      <button
        class="btn primary"
        disabled={!clientId.trim().endsWith('.apps.googleusercontent.com') || !secret.trim()}
        onClick={() => {
          g.saveConfig({ clientId, clientSecret: secret });
          onDone();
          g.startLogin('#/settings').catch((e) => toast(e.message));
        }}
      >
        Enregistrer et se connecter
      </button>
      <p class="muted small">Ces informations restent sur ton iPhone.</p>
    </div>
  );
}

// ------------------------------------------------------ choix d'un dossier

export function DrivePicker() {
  const [stack, setStack] = useState<{ id: string; name: string }[]>([{ id: 'root', name: 'Mon Drive' }]);
  const [folders, setFolders] = useState<g.DriveFile[] | null>(null);
  const [error, setError] = useState('');
  const cur = stack[stack.length - 1];
  useEffect(() => {
    let alive = true;
    setFolders(null);
    setError('');
    g.listFolders(cur.id).then(
      (f) => alive && setFolders(f),
      (e) => alive && setError(e.message),
    );
    return () => {
      alive = false;
    };
  }, [cur.id]);
  if (!g.isConnected()) {
    return (
      <div class="page">
        <TopBar title="Choisir un dossier" backTo="/settings" solidAfter={0} />
        <div class="pad">
          <p>Connecte d’abord ton compte Google dans les réglages.</p>
        </div>
      </div>
    );
  }
  const root = stack.length === 1;
  return (
    <div class="page picker">
      <TopBar title="Choisir un dossier" backTo="/settings" solidAfter={0} />
      <div class="chips">
        <button class={`chip ${stack[0].id === 'root' ? 'on' : ''}`} onClick={() => setStack([{ id: 'root', name: 'Mon Drive' }])}>
          Mon Drive
        </button>
        <button class={`chip ${stack[0].id === 'shared' ? 'on' : ''}`} onClick={() => setStack([{ id: 'shared', name: 'Partagés avec moi' }])}>
          Partagés avec moi
        </button>
      </div>
      <div class="crumbs">
        {stack.map((s, i) => (
          <span key={s.id}>
            {i > 0 && <Icon name="chevron" size={16} />}
            <button onClick={() => setStack(stack.slice(0, i + 1))}>{s.name}</button>
          </span>
        ))}
      </div>
      {error && <p class="error pad">{error}</p>}
      {!folders && !error && (
        <div class="pad center">
          <div class="spinner" />
        </div>
      )}
      {folders && (
        <div class="list">
          {folders.length === 0 && <p class="muted pad">Aucun sous-dossier.</p>}
          {folders.map((f) => (
            <button key={f.id} class="row" onClick={() => setStack([...stack, { id: f.id, name: f.name }])}>
              <div class="row-icon">
                <Icon name="folder" />
              </div>
              <div class="row-text">
                <div class="row-title">{f.name}</div>
              </div>
              <Icon name="chevron" class="muted" />
            </button>
          ))}
        </div>
      )}
      <div class="picker-bar">
        <button
          class="btn primary wide"
          disabled={cur.id === 'shared'}
          onClick={() => {
            const name = root && cur.id === 'root' ? 'Mon Drive' : cur.name;
            navigate('/', true);
            toast(`Analyse de « ${name} »…`);
            addSource({ id: cur.id, name }).then(
              () => toast('Bibliothèque prête'),
              (e) => toast(e.message),
            );
          }}
        >
          {cur.id === 'shared' ? 'Ouvre un dossier partagé' : `Choisir « ${cur.name} »`}
        </button>
      </div>
    </div>
  );
}
