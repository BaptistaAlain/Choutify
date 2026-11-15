import { render } from 'preact';
import { App } from './app';
import { AuthError, handleRedirect, isConnected } from './lib/google';
import * as db from './lib/db';
import { lib, loadLibrary, scanDrive } from './lib/library';
import { restorePlayer } from './lib/player';
import { toast, ui } from './lib/ui';
import './styles.css';

render(<App />, document.getElementById('app')!);

async function boot() {
  // Retour de la page de connexion Google ?
  try {
    const r = await handleRedirect();
    if (r) toast('Connecté à Google Drive');
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), undefined, 6000);
  }
  try {
    await loadLibrary();
  } catch (e) {
    lib.set({ ready: true });
    toast(`Stockage indisponible : ${(e as Error).message}`, undefined, 8000);
    return;
  }
  await restorePlayer().catch(() => {});

  // Actualise la bibliothèque Google Drive en arrière-plan (au plus 1 fois / 30 min).
  const { sources } = lib.get();
  if (isConnected() && sources.length) {
    const last = (await db.get<number>('kv', 'lastScan').catch(() => 0)) ?? 0;
    if (Date.now() - last > 30 * 60_000 || !lib.get().tracks.size) {
      scanDrive().catch((e) => {
        if (e instanceof AuthError) toast(e.message, { label: 'Réglages', run: () => (location.hash = '#/settings') }, 8000);
      });
    }
  }
}

boot();

window.addEventListener('choutify:signed-out', () => {
  lib.set({ account: null });
  toast('La connexion Google a expiré : reconnecte-toi dans les réglages.', { label: 'Réglages', run: () => (location.hash = '#/settings') }, 8000);
});

// Service worker : fonctionnement hors ligne et mises à jour automatiques.
// La page étant toujours demandée au réseau d'abord, chaque ouverture charge
// la dernière version. Si l'app reste ouverte en arrière-plan, on vérifie
// version.json au retour au premier plan et on propose de recharger.
declare const __BUILD_ID__: string;
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
  let lastCheck = Date.now();
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || Date.now() - lastCheck < 5 * 60_000) return;
    lastCheck = Date.now();
    try {
      const r = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
      const v = await r.json();
      if (v.build && v.build !== __BUILD_ID__) ui.set({ updateReady: true });
    } catch {
      /* hors ligne */
    }
  });
}
