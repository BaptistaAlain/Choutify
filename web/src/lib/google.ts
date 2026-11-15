// Connexion Google (OAuth 2.0, flux « authorization code » + PKCE) et accès
// à l'API Google Drive.
//
// Pourquoi ce flux plutôt que la fenêtre pop-up de Google Identity Services :
// sur iPhone, une app ajoutée à l'écran d'accueil gère mal les pop-ups, et le
// jeton d'accès expire au bout d'une heure. Ici on fait une redirection
// classique vers Google, puis on garde un « refresh token » sur l'appareil
// pour renouveler l'accès sans interrompre la musique.

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const API = 'https://www.googleapis.com/drive/v3';
// Accès complet au Drive : la lecture de la musique, et l'écriture du petit
// fichier de synchronisation dans le dossier « Choutify-synchro ». Choutify ne
// modifie ni ne supprime aucun autre fichier.
export const SCOPE = 'https://www.googleapis.com/auth/drive';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

const CONFIG_KEY = 'choutify.google.config';
const TOKEN_KEY = 'choutify.google.token';
const PENDING_KEY = 'choutify.google.pending';

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
}

interface TokenState {
  refreshToken?: string;
  scope?: string;
  accessToken?: string;
  expiresAt?: number;
}

export class AuthError extends Error {}

function readJson<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}
function writeJson(key: string, v: unknown) {
  try {
    if (v == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* stockage indisponible */
  }
}

export function getConfig(): GoogleConfig {
  const saved = readJson<GoogleConfig>(CONFIG_KEY);
  return {
    clientId: saved?.clientId || (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) || '',
    clientSecret: saved?.clientSecret || (import.meta.env.VITE_GOOGLE_CLIENT_SECRET as string | undefined) || '',
  };
}

export function saveConfig(c: GoogleConfig) {
  writeJson(CONFIG_KEY, { clientId: c.clientId.trim(), clientSecret: c.clientSecret.trim() });
}

export function isConfigured() {
  const c = getConfig();
  return !!c.clientId && !!c.clientSecret;
}

export function isConnected() {
  return !!readJson<TokenState>(TOKEN_KEY)?.refreshToken;
}

/** Vrai si la connexion autorise l'écriture (connexions d'avant la synchro : lecture seule). */
export function canWrite() {
  const scopes = (readJson<TokenState>(TOKEN_KEY)?.scope ?? '').split(/\s+/);
  return scopes.includes(SCOPE);
}

/** Adresse de retour à déclarer dans Google Cloud (l'adresse de l'app). */
export function redirectUri() {
  const u = new URL('./', location.href);
  u.search = '';
  u.hash = '';
  return u.href;
}

function b64url(bytes: Uint8Array) {
  let s = '';
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(n = 48) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b64url(b);
}

export async function startLogin(returnHash = location.hash) {
  const cfg = getConfig();
  if (!cfg.clientId) throw new AuthError("L'identifiant client Google n'est pas configuré.");
  const verifier = randomString(64);
  const state = randomString(16);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  writeJson(PENDING_KEY, { verifier, state, returnHash });
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    code_challenge: b64url(digest),
    code_challenge_method: 'S256',
    state,
  });
  location.assign(`${AUTH_URL}?${params}`);
}

/**
 * À appeler au démarrage : si on revient de Google avec un code, l'échange
 * contre des jetons. Renvoie le hash de la page à rouvrir, ou null.
 */
export async function handleRedirect(): Promise<{ returnHash: string } | null> {
  const url = new URL(location.href);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  if (!code && !error) return null;
  const pending = readJson<{ verifier: string; state: string; returnHash: string }>(PENDING_KEY);
  writeJson(PENDING_KEY, null);
  history.replaceState(null, '', redirectUri() + (pending?.returnHash || ''));
  window.dispatchEvent(new Event('choutify:route'));
  if (error) throw new AuthError(error === 'access_denied' ? 'Connexion annulée.' : `Google a refusé la connexion (${error}).`);
  if (!pending || pending.state !== url.searchParams.get('state')) {
    throw new AuthError('La connexion a expiré, réessaie.');
  }
  const cfg = getConfig();
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: code!,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
      code_verifier: pending.verifier,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new AuthError(describeTokenError(json));
  writeJson(TOKEN_KEY, {
    refreshToken: json.refresh_token,
    scope: json.scope,
    accessToken: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  } satisfies TokenState);
  return { returnHash: pending.returnHash };
}

function describeTokenError(json: { error?: string; error_description?: string }) {
  if (json.error === 'invalid_client') return 'Identifiant ou code secret client incorrect.';
  if (json.error === 'redirect_uri_mismatch') return "L'adresse de l'app n'est pas autorisée dans Google Cloud.";
  return json.error_description || json.error || 'Échec de la connexion à Google.';
}

let refreshing: Promise<string> | null = null;

export async function getAccessToken(): Promise<string> {
  const t = readJson<TokenState>(TOKEN_KEY);
  if (!t?.refreshToken) throw new AuthError('Non connecté à Google Drive.');
  if (t.accessToken && t.expiresAt && t.expiresAt - Date.now() > 90_000) return t.accessToken;
  if (!refreshing) {
    refreshing = (async () => {
      const cfg = getConfig();
      const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          refresh_token: t.refreshToken!,
          grant_type: 'refresh_token',
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (json.error === 'invalid_grant') {
          writeJson(TOKEN_KEY, null);
          window.dispatchEvent(new Event('choutify:signed-out'));
          throw new AuthError('La connexion Google a expiré : reconnecte-toi.');
        }
        throw new Error(describeTokenError(json));
      }
      const next: TokenState = {
        refreshToken: json.refresh_token || t.refreshToken,
        scope: json.scope || t.scope,
        accessToken: json.access_token,
        expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
      };
      writeJson(TOKEN_KEY, next);
      return next.accessToken!;
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

export async function signOut() {
  const t = readJson<TokenState>(TOKEN_KEY);
  writeJson(TOKEN_KEY, null);
  if (t?.refreshToken) {
    fetch(`${REVOKE_URL}?token=${encodeURIComponent(t.refreshToken)}`, { method: 'POST' }).catch(() => {});
  }
}

function forceExpire() {
  const t = readJson<TokenState>(TOKEN_KEY);
  if (t) writeJson(TOKEN_KEY, { ...t, accessToken: undefined, expiresAt: 0 });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Requête authentifiée avec renouvellement du jeton et nouvelles tentatives. */
export async function gfetch(url: string, init: RequestInit = {}, signal?: AbortSignal): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const token = await getAccessToken();
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    let res: Response;
    try {
      res = await fetch(url, { ...init, headers, signal });
    } catch (e) {
      if (signal?.aborted || attempt >= 3) throw e;
      await sleep(800 * 2 ** attempt);
      continue;
    }
    if (res.status === 401 && attempt === 0) {
      forceExpire();
      continue;
    }
    if ((res.status === 429 || res.status >= 500 || res.status === 403) && attempt < 4) {
      // 403 peut être une limite de débit (rateLimitExceeded).
      if (res.status === 403) {
        const body = await res.clone().json().catch(() => null);
        const reason = body?.error?.errors?.[0]?.reason;
        if (reason !== 'rateLimitExceeded' && reason !== 'userRateLimitExceeded') return res;
      }
      await sleep(1000 * 2 ** attempt + Math.random() * 500);
      continue;
    }
    return res;
  }
}

async function apiJson<T>(path: string, params: Record<string, string>): Promise<T> {
  const res = await gfetch(`${API}/${path}?${new URLSearchParams(params)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message || `Erreur Google Drive (${res.status})`);
  }
  return res.json();
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  createdTime?: string;
  md5Checksum?: string;
  parents?: string[];
  shortcutDetails?: { targetId: string; targetMimeType: string };
}

export const FOLDER = 'application/vnd.google-apps.folder';
const SHORTCUT = 'application/vnd.google-apps.shortcut';
const FIELDS = 'nextPageToken, files(id, name, mimeType, size, modifiedTime, createdTime, md5Checksum, shortcutDetails, parents)';

async function listAll(q: string, orderBy?: string): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const params: Record<string, string> = {
      q,
      fields: FIELDS,
      pageSize: '1000',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    };
    if (orderBy) params.orderBy = orderBy;
    if (pageToken) params.pageToken = pageToken;
    const r = await apiJson<{ files: DriveFile[]; nextPageToken?: string }>('files', params);
    out.push(...r.files);
    pageToken = r.nextPageToken;
  } while (pageToken);
  return out;
}

export function listChildren(folderId: string) {
  return listAll(`'${folderId}' in parents and trashed = false`);
}

/** Dossiers d'un dossier ('root' = Mon Drive, 'shared' = Partagés avec moi). */
export async function listFolders(parent: string): Promise<DriveFile[]> {
  const q =
    parent === 'shared'
      ? `sharedWithMe and (mimeType = '${FOLDER}' or mimeType = '${SHORTCUT}') and trashed = false`
      : `'${parent}' in parents and (mimeType = '${FOLDER}' or mimeType = '${SHORTCUT}') and trashed = false`;
  const files = await listAll(q, 'name');
  return files
    .filter((f) => f.mimeType === FOLDER || f.shortcutDetails?.targetMimeType === FOLDER)
    .map((f) => (f.mimeType === SHORTCUT ? { ...f, id: f.shortcutDetails!.targetId, mimeType: FOLDER } : f));
}

export function resolveShortcut(f: DriveFile): DriveFile {
  if (f.mimeType === SHORTCUT && f.shortcutDetails) {
    return { ...f, id: f.shortcutDetails.targetId, mimeType: f.shortcutDetails.targetMimeType };
  }
  return f;
}

export async function getAbout(): Promise<{ name: string; email: string }> {
  const r = await apiJson<{ user: { displayName: string; emailAddress: string } }>('about', { fields: 'user(displayName,emailAddress)' });
  return { name: r.user.displayName, email: r.user.emailAddress };
}

const mediaUrl = (id: string) => `${API}/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`;

/** Lit les octets [start, end) d'un fichier Drive. */
export async function fetchRange(id: string, start: number, end: number): Promise<Uint8Array> {
  const res = await gfetch(mediaUrl(id), { headers: { Range: `bytes=${start}-${end - 1}` } });
  if (!res.ok) throw new Error(`Lecture impossible (${res.status})`);
  if (res.status === 206) return new Uint8Array(await res.arrayBuffer());
  // Le serveur a ignoré la plage : on lit le flux jusqu'à avoir assez.
  const reader = res.body!.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  while (got < end) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
  }
  reader.cancel().catch(() => {});
  const all = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) {
    all.set(c, o);
    o += c.length;
  }
  return all.subarray(start, Math.min(end, got));
}

/** Télécharge un fichier entier en suivant la progression (0 → 1). */
export async function download(
  id: string,
  size: number,
  mime: string,
  onProgress?: (p: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  const res = await gfetch(mediaUrl(id), {}, signal);
  if (!res.ok) {
    if (res.status === 404) throw new Error('Fichier introuvable sur Google Drive.');
    throw new Error(`Téléchargement impossible (${res.status})`);
  }
  if (!res.body || !onProgress) return new Blob([await res.arrayBuffer()], { type: mime });
  const reader = res.body.getReader();
  const chunks: BlobPart[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value as Uint8Array<ArrayBuffer>);
    got += value.length;
    if (size > 0) onProgress(Math.min(1, got / size));
  }
  return new Blob(chunks, { type: mime });
}

// ------------------------------------------------- dossier de synchronisation

/** Dossiers portant ce nom, où qu'ils soient dans le Drive. */
export function findFoldersNamed(name: string) {
  return listAll(`name = '${name.replace(/'/g, "\\'")}' and mimeType = '${FOLDER}' and trashed = false`);
}

export async function getMeta(id: string): Promise<{ id: string; name: string; parents?: string[] }> {
  return apiJson(`files/${encodeURIComponent(id)}`, { fields: 'id, name, parents', supportsAllDrives: 'true' });
}

async function checked<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const reason = body?.error?.errors?.[0]?.reason;
    if (res.status === 403 && (reason === 'insufficientPermissions' || reason === 'forbidden')) {
      throw new AuthError("Choutify n'a pas le droit d'écrire dans ton Drive : autorise la synchronisation dans les réglages.");
    }
    throw new Error(body?.error?.message || `Erreur Google Drive (${res.status})`);
  }
  return res.json();
}

export async function createFolder(name: string, parentId: string): Promise<DriveFile> {
  const res = await gfetch(`${API}/files?supportsAllDrives=true&fields=${encodeURIComponent('id, name, mimeType, modifiedTime')}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER, parents: [parentId] }),
  });
  return checked(res);
}

/** Crée un fichier JSON dans un dossier. */
export async function createJsonFile(name: string, parentId: string, content: string): Promise<DriveFile> {
  const boundary = `choutify${randomString(12)}`;
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify({ name, parents: [parentId], mimeType: 'application/json' }) +
    `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n` +
    content +
    `\r\n--${boundary}--`;
  const res = await gfetch(`${UPLOAD}/files?uploadType=multipart&supportsAllDrives=true&fields=${encodeURIComponent('id, name, modifiedTime')}`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  return checked(res);
}

/** Remplace le contenu d'un fichier (renvoie null s'il n'existe plus). */
export async function updateJsonFile(id: string, content: string): Promise<DriveFile | null> {
  const res = await gfetch(`${UPLOAD}/files/${encodeURIComponent(id)}?uploadType=media&supportsAllDrives=true&fields=${encodeURIComponent('id, name, modifiedTime, trashed')}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: content,
  });
  if (res.status === 404) return null;
  const f = await checked<DriveFile & { trashed?: boolean }>(res);
  return f.trashed ? null : f;
}

export async function downloadText(id: string): Promise<string> {
  const res = await gfetch(mediaUrl(id), { cache: 'no-store' });
  if (!res.ok) throw new Error(`Lecture impossible (${res.status})`);
  return res.text();
}
