// Service worker de Choutify : l'app fonctionne hors ligne et se met à jour
// toute seule (la page est toujours demandée au réseau d'abord).
const BUILD = '__BUILD_ID__';
const SHELL = `choutify-shell-${BUILD}`;
const KEEP = new Set([SHELL, 'choutify-audio-v1']);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(['./', './manifest.webmanifest', './icons/apple-touch-icon.png']))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (!KEEP.has(k)) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Ne touche jamais aux requêtes Google (API Drive, connexion).
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/__audio/') || url.pathname.endsWith('/version.json')) return;

  if (req.mode === 'navigate') {
    // Réseau d'abord : on récupère toujours la dernière version publiée.
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          const c = await caches.open(SHELL);
          c.put('./', res.clone());
          return res;
        } catch {
          return (await caches.match('./')) || Response.error();
        }
      })(),
    );
    return;
  }

  // Fichiers versionnés (assets/…-hash.js) : cache d'abord.
  event.respondWith(
    (async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') {
        const c = await caches.open(SHELL);
        c.put(req, res.clone());
      }
      return res;
    })(),
  );
});
