// Pochettes : réduites à 512 px et stockées dans IndexedDB, avec une couleur
// dominante pour colorer le lecteur.
import { useEffect, useState } from 'preact/hooks';
import * as db from './db';

export interface CoverRecord {
  blob: Blob;
  color: string; // « r,g,b »
}

const SIZE = 512;
const urls = new Map<string, { url: string; color: string }>();
const loading = new Map<string, Promise<{ url: string; color: string } | null>>();

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image illisible'));
    };
    img.src = url;
  });
}

function dominantColor(img: CanvasImageSource): string {
  const c = document.createElement('canvas');
  c.width = c.height = 24;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, 24, 24);
  const d = ctx.getImageData(0, 0, 24, 24).data;
  let r = 0,
    g = 0,
    b = 0,
    w = 0;
  for (let i = 0; i < d.length; i += 4) {
    const R = d[i],
      G = d[i + 1],
      B = d[i + 2];
    const max = Math.max(R, G, B),
      min = Math.min(R, G, B);
    const sat = max === 0 ? 0 : (max - min) / max;
    const lum = (max + min) / 510;
    // Favorise les couleurs saturées et ni trop claires ni trop sombres.
    const weight = 0.15 + sat * sat * 2 + (lum > 0.15 && lum < 0.85 ? 0.5 : 0);
    r += R * weight;
    g += G * weight;
    b += B * weight;
    w += weight;
  }
  r /= w;
  g /= w;
  b /= w;
  // Assombrit légèrement pour garder un texte blanc lisible.
  const l = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const k = l > 0.55 ? 0.55 / l : 1;
  return `${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)}`;
}

/** Réduit une image et calcule sa couleur. */
export async function makeCover(src: Blob): Promise<CoverRecord | null> {
  try {
    const img = await loadImage(src);
    const scale = Math.min(1, SIZE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d')!.drawImage(img, 0, 0, w, h);
    const color = dominantColor(c);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.85));
    return blob ? { blob, color } : null;
  } catch {
    return null;
  }
}

export async function saveCover(id: string, rec: CoverRecord) {
  await db.put('covers', id, rec);
  const old = urls.get(id);
  if (old) URL.revokeObjectURL(old.url);
  urls.delete(id);
}

export function loadCover(id: string): Promise<{ url: string; color: string } | null> {
  const hit = urls.get(id);
  if (hit) return Promise.resolve(hit);
  let p = loading.get(id);
  if (!p) {
    p = db
      .get<CoverRecord>('covers', id)
      .then((rec) => {
        if (!rec) return null;
        const v = { url: URL.createObjectURL(rec.blob), color: rec.color };
        urls.set(id, v);
        return v;
      })
      .catch(() => null)
      .finally(() => loading.delete(id));
    loading.set(id, p);
  }
  return p;
}

export function peekCover(id?: string) {
  return id ? urls.get(id) ?? null : null;
}

export function useCover(id?: string) {
  const [v, setV] = useState(() => peekCover(id));
  useEffect(() => {
    if (!id) {
      setV(null);
      return;
    }
    const hit = peekCover(id);
    if (hit) {
      setV(hit);
      return;
    }
    let alive = true;
    setV(null);
    loadCover(id).then((r) => alive && setV(r));
    return () => {
      alive = false;
    };
  }, [id]);
  return v;
}

export async function coverDataUrl(id: string): Promise<string | null> {
  const rec = await db.get<CoverRecord>('covers', id);
  if (!rec) return null;
  return new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => resolve(null);
    fr.readAsDataURL(rec.blob);
  });
}
