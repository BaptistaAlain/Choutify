// Lecture des métadonnées audio, portée depuis lib/services/tag_reader.dart.
// Prend en charge ID3v2.2/2.3/2.4, ID3v1, FLAC (Vorbis + PICTURE), MP4/M4A
// (atomes ilst) et l'estimation de durée des MP3. Les octets sont lus à la
// demande via une ByteSource, ce qui permet de ne télécharger que le début
// d'un fichier Google Drive.

export interface ByteSource {
  size: number;
  read(start: number, end: number): Promise<Uint8Array>; // end exclusif
}

export interface AudioTags {
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  genre?: string;
  year?: number;
  trackNo?: number;
  discNo?: number;
  durationMs?: number;
  picture?: Uint8Array;
  pictureMime?: string;
}

const MAX_TAG = 16 * 1024 * 1024;

export async function readTags(src: ByteSource, name = '', maxId3 = MAX_TAG): Promise<AudioTags> {
  const tags: AudioTags = {};
  try {
    if (src.size < 8) return tags;
    const head = await src.read(0, Math.min(src.size, 16));
    if (ascii(head, 0, 4) === 'fLaC') {
      await readFlac(src, tags);
      return tags;
    }
    if (ascii(head, 4, 8) === 'ftyp') {
      await readMp4(src, tags);
      return tags;
    }
    let audioStart = 0;
    if (ascii(head, 0, 3) === 'ID3') {
      const size = syncsafe(head, 6);
      const footer = (head[5] & 0x10) !== 0 ? 10 : 0;
      audioStart = 10 + size + footer;
      if (size > 0 && size < MAX_TAG) {
        const body = await src.read(10, Math.min(src.size, 10 + Math.min(size, maxId3)));
        try {
          parseId3v2(head.subarray(0, 10), body, tags);
        } catch {
          /* tag abîmé : on garde ce qui a été lu */
        }
      }
    }
    if (isEmpty(tags) && src.size > 128) {
      try {
        parseId3v1(await src.read(src.size - 128, src.size), tags);
      } catch {
        /* ignore */
      }
    }
    const lower = name.toLowerCase();
    if (tags.durationMs == null && (lower.endsWith('.mp3') || !lower.includes('.'))) {
      try {
        const frames = await src.read(audioStart, Math.min(src.size, audioStart + 16 * 1024));
        tags.durationMs = estimateMp3Duration(frames, src.size - audioStart) ?? undefined;
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* fichier illisible */
  }
  return tags;
}

function isEmpty(t: AudioTags) {
  return !t.title && !t.artist && !t.album;
}

function ascii(b: Uint8Array, s: number, e: number) {
  let r = '';
  for (let i = s; i < e && i < b.length; i++) r += String.fromCharCode(b[i]);
  return r;
}
const syncsafe = (b: Uint8Array, o: number) =>
  ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
const be32 = (b: Uint8Array, o: number) =>
  ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const le32 = (b: Uint8Array, o: number) =>
  (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

function removeUnsync(d: Uint8Array): Uint8Array {
  const out = new Uint8Array(d.length);
  let j = 0;
  for (let i = 0; i < d.length; i++) {
    out[j++] = d[i];
    if (d[i] === 0xff && i + 1 < d.length && d[i + 1] === 0x00) i++;
  }
  return out.subarray(0, j);
}

const latin1 = new TextDecoder('latin1');
const utf8 = new TextDecoder('utf-8');

function decode(enc: number, b: Uint8Array): string {
  try {
    if (enc === 0) return latin1.decode(b);
    if (enc === 3) return utf8.decode(b);
    if (enc === 1 || enc === 2) {
      let big = enc === 2;
      let s = 0;
      if (b.length >= 2) {
        if (b[0] === 0xff && b[1] === 0xfe) {
          big = false;
          s = 2;
        } else if (b[0] === 0xfe && b[1] === 0xff) {
          big = true;
          s = 2;
        }
      }
      let r = '';
      for (let i = s; i + 1 < b.length; i += 2) {
        r += String.fromCharCode(big ? (b[i] << 8) | b[i + 1] : b[i] | (b[i + 1] << 8));
      }
      return r;
    }
  } catch {
    /* ignore */
  }
  return latin1.decode(b);
}

function text(frame: Uint8Array): string | undefined {
  if (!frame.length) return undefined;
  const parts = decode(frame[0], frame.subarray(1))
    .split('\u0000')
    .map((s) => s.replace(/﻿/g, '').trim())
    .filter(Boolean);
  return parts.length ? parts.join(', ') : undefined;
}

function leadingInt(s?: string): number | undefined {
  if (!s) return undefined;
  const m = /\d+/.exec(s);
  return m ? parseInt(m[0], 10) : undefined;
}

function genre(g?: string): string | undefined {
  if (!g) return undefined;
  const m = /^\((\d+)\)(.*)$/.exec(g);
  if (m) return m[2].trim() || GENRES[+m[1]];
  if (/^\d+$/.test(g)) return GENRES[+g];
  return g;
}

function looksLikeFrame(d: Uint8Array, p: number) {
  if (p === d.length) return true;
  if (p + 4 > d.length) return false;
  if (d[p] === 0) return true;
  for (let i = 0; i < 4; i++) {
    const c = d[p + i];
    if (!((c >= 0x41 && c <= 0x5a) || (c >= 0x30 && c <= 0x39))) return false;
  }
  return true;
}

export function parseId3v2(header: Uint8Array, body: Uint8Array, tags: AudioTags) {
  const major = header[3];
  const flags = header[5];
  let data = body;
  if (major < 4 && (flags & 0x80) !== 0) data = removeUnsync(data);
  let pos = 0;
  if ((flags & 0x40) !== 0 && major >= 3 && data.length >= 4) {
    pos = major === 4 ? syncsafe(data, 0) : be32(data, 0) + 4;
  }
  const idLen = major === 2 ? 3 : 4;
  const headLen = major === 2 ? 6 : 10;
  let bestRank = -1;
  while (pos + headLen <= data.length) {
    if (data[pos] === 0) break;
    const id = ascii(data, pos, pos + idLen);
    if (!/^[A-Z0-9]+$/.test(id)) break;
    let size: number;
    let fflags = 0;
    if (major === 2) {
      size = (data[pos + 3] << 16) | (data[pos + 4] << 8) | data[pos + 5];
    } else if (major === 4) {
      size = syncsafe(data, pos + 4);
      const raw = be32(data, pos + 4);
      if (
        raw !== size &&
        pos + headLen + raw <= data.length &&
        (pos + headLen + size > data.length || !looksLikeFrame(data, pos + headLen + size)) &&
        looksLikeFrame(data, pos + headLen + raw)
      ) {
        size = raw;
      }
      fflags = (data[pos + 8] << 8) | data[pos + 9];
    } else {
      size = be32(data, pos + 4);
      fflags = (data[pos + 8] << 8) | data[pos + 9];
    }
    const start = pos + headLen;
    const end = start + size;
    if (size <= 0 || end > data.length) break;
    pos = end;
    let frame = data.subarray(start, end);
    if (major === 4) {
      if ((fflags & 0x000c) !== 0) continue;
      if ((fflags & 0x0001) !== 0 && frame.length >= 4) frame = frame.subarray(4);
      if ((fflags & 0x0002) !== 0) frame = removeUnsync(frame);
    } else if (major === 3 && (fflags & 0x00c0) !== 0) {
      continue;
    }
    switch (id) {
      case 'TIT2':
      case 'TT2':
        tags.title ??= text(frame);
        break;
      case 'TPE1':
      case 'TP1':
        tags.artist ??= text(frame);
        break;
      case 'TALB':
      case 'TAL':
        tags.album ??= text(frame);
        break;
      case 'TPE2':
      case 'TP2':
        tags.albumArtist ??= text(frame);
        break;
      case 'TCON':
      case 'TCO':
        tags.genre ??= genre(text(frame));
        break;
      case 'TRCK':
      case 'TRK':
        tags.trackNo ??= leadingInt(text(frame));
        break;
      case 'TPOS':
      case 'TPA':
        tags.discNo ??= leadingInt(text(frame));
        break;
      case 'TYER':
      case 'TYE':
      case 'TDRC':
      case 'TDOR':
        tags.year ??= leadingInt(text(frame));
        break;
      case 'TLEN':
      case 'TLE': {
        const ms = leadingInt(text(frame));
        if (ms && ms > 1000) tags.durationMs ??= ms;
        break;
      }
      case 'APIC':
      case 'PIC': {
        const pic = picture(frame, major === 2);
        if (pic) {
          const rank = pic.type === 3 ? 2 : pic.type === 0 ? 1 : 0;
          if (rank > bestRank) {
            bestRank = rank;
            tags.picture = pic.data;
            tags.pictureMime = pic.mime;
          }
        }
        break;
      }
    }
  }
}

function sniffMime(data: Uint8Array, fallback: string) {
  if (data[0] === 0x89 && data[1] === 0x50) return 'image/png';
  if (data[0] === 0xff && data[1] === 0xd8) return 'image/jpeg';
  return fallback.startsWith('image/') ? fallback : 'image/jpeg';
}

function picture(f: Uint8Array, v22: boolean) {
  if (f.length < 6) return null;
  const enc = f[0];
  let p: number;
  let mime: string;
  if (v22) {
    mime = ascii(f, 1, 4).toUpperCase() === 'PNG' ? 'image/png' : 'image/jpeg';
    p = 4;
  } else {
    const z = f.indexOf(0, 1);
    if (z < 0) return null;
    mime = latin1.decode(f.subarray(1, z)).toLowerCase();
    p = z + 1;
  }
  if (p >= f.length) return null;
  const type = f[p++];
  if (enc === 1 || enc === 2) {
    while (p + 1 < f.length && !(f[p] === 0 && f[p + 1] === 0)) p += 2;
    p += 2;
  } else {
    while (p < f.length && f[p] !== 0) p++;
    p++;
  }
  if (p >= f.length) return null;
  const data = f.slice(p);
  if (data.length < 64) return null;
  return { data, mime: sniffMime(data, mime), type };
}

export function parseId3v1(b: Uint8Array, tags: AudioTags) {
  if (b.length < 128 || ascii(b, 0, 3) !== 'TAG') return;
  const field = (o: number, l: number) => {
    const s = b.subarray(o, o + l);
    const z = s.indexOf(0);
    return latin1.decode(z >= 0 ? s.subarray(0, z) : s).trim();
  };
  const title = field(3, 30);
  const artist = field(33, 30);
  const album = field(63, 30);
  const year = parseInt(field(93, 4), 10);
  if (title) tags.title ??= title;
  if (artist) tags.artist ??= artist;
  if (album) tags.album ??= album;
  if (year > 0) tags.year ??= year;
  if (b[125] === 0 && b[126] !== 0) tags.trackNo ??= b[126];
  tags.genre ??= GENRES[b[127]];
}

// ------------------------------------------------------------------ MP3

const BR_V1L1 = [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448];
const BR_V1L2 = [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384];
const BR_V1L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BR_V2L1 = [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256];
const BR_V2L23 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];

function frameHeader(d: Uint8Array, i: number) {
  const b1 = d[i + 1],
    b2 = d[i + 2],
    b3 = d[i + 3];
  const version = (b1 >> 3) & 3;
  const layer = (b1 >> 1) & 3;
  if (version === 1 || layer === 0) return null;
  const brIdx = (b2 >> 4) & 0xf;
  const srIdx = (b2 >> 2) & 3;
  if (brIdx === 0 || brIdx === 15 || srIdx === 3) return null;
  const padding = (b2 >> 1) & 1;
  const channelMode = (b3 >> 6) & 3;
  let sampleRate = [44100, 48000, 32000][srIdx];
  if (version === 2) sampleRate /= 2;
  if (version === 0) sampleRate /= 4;
  const bitrate =
    version === 3
      ? (layer === 3 ? BR_V1L1 : layer === 2 ? BR_V1L2 : BR_V1L3)[brIdx]
      : (layer === 3 ? BR_V2L1 : BR_V2L23)[brIdx];
  const samples = layer === 3 ? 384 : layer === 2 ? 1152 : version === 3 ? 1152 : 576;
  const frameLength =
    layer === 3
      ? (Math.floor((12 * bitrate * 1000) / sampleRate) + padding) * 4
      : Math.floor(((samples / 8) * bitrate * 1000) / sampleRate) + padding;
  if (frameLength < 21) return null;
  return { version, bitrate, sampleRate, samples, channelMode, frameLength };
}

export function estimateMp3Duration(d: Uint8Array, audioBytes: number): number | null {
  for (let i = 0; i + 4 < d.length; i++) {
    if (d[i] !== 0xff || (d[i + 1] & 0xe0) !== 0xe0) continue;
    const h = frameHeader(d, i);
    if (!h) continue;
    const next = i + h.frameLength;
    if (next + 1 < d.length && !(d[next] === 0xff && (d[next + 1] & 0xe0) === 0xe0)) continue;
    const mono = h.channelMode === 3;
    const xing = i + 4 + (h.version === 3 ? (mono ? 17 : 32) : mono ? 9 : 17);
    if (xing + 12 <= d.length) {
      const tag = ascii(d, xing, xing + 4);
      if ((tag === 'Xing' || tag === 'Info') && (be32(d, xing + 4) & 1) !== 0) {
        const frames = be32(d, xing + 8);
        if (frames > 0) return Math.round((frames * h.samples * 1000) / h.sampleRate);
      }
    }
    const vbri = i + 36;
    if (vbri + 18 <= d.length && ascii(d, vbri, vbri + 4) === 'VBRI') {
      const frames = be32(d, vbri + 14);
      if (frames > 0) return Math.round((frames * h.samples * 1000) / h.sampleRate);
    }
    const bytes = audioBytes - i;
    if (h.bitrate <= 0 || bytes <= 0) return null;
    return Math.round((bytes * 8) / h.bitrate);
  }
  return null;
}

// ----------------------------------------------------------------- FLAC

async function readFlac(src: ByteSource, tags: AudioTags) {
  let pos = 4;
  let last = false;
  let guard = 0;
  while (!last && guard++ < 64 && pos + 4 <= src.size) {
    const h = await src.read(pos, pos + 4);
    last = (h[0] & 0x80) !== 0;
    const type = h[0] & 0x7f;
    const len = (h[1] << 16) | (h[2] << 8) | h[3];
    const start = pos + 4;
    if (type === 0 && len >= 18) {
      const s = await src.read(start, start + 18);
      const sampleRate = (s[10] << 12) | (s[11] << 4) | (s[12] >> 4);
      const total = (s[13] & 0x0f) * 2 ** 32 + be32(s, 14);
      if (sampleRate > 0 && total > 0) tags.durationMs = Math.round((total * 1000) / sampleRate);
    } else if (type === 4 && len < MAX_TAG) {
      parseVorbisComments(await src.read(start, start + len), tags);
    } else if (type === 6 && len < MAX_TAG) {
      try {
        const b = await src.read(start, start + len);
        let p = 0;
        const picType = be32(b, p);
        p += 4;
        const ml = be32(b, p);
        p += 4;
        const mime = latin1.decode(b.subarray(p, p + ml));
        p += ml;
        const dl = be32(b, p);
        p += 4 + dl + 16;
        const dataLen = be32(b, p);
        p += 4;
        if (!tags.picture || picType === 3) {
          tags.picture = b.slice(p, p + dataLen);
          tags.pictureMime = sniffMime(tags.picture, mime);
        }
      } catch {
        /* ignore */
      }
    }
    pos = start + len;
  }
}

export function parseVorbisComments(b: Uint8Array, tags: AudioTags) {
  let p = 0;
  const vl = le32(b, p);
  p += 4 + vl;
  const count = le32(b, p);
  p += 4;
  for (let i = 0; i < count && p + 4 <= b.length; i++) {
    const l = le32(b, p);
    p += 4;
    if (p + l > b.length) break;
    const c = utf8.decode(b.subarray(p, p + l));
    p += l;
    const eq = c.indexOf('=');
    if (eq <= 0) continue;
    const k = c.substring(0, eq).toUpperCase();
    const v = c.substring(eq + 1).trim();
    if (!v) continue;
    switch (k) {
      case 'TITLE':
        tags.title ??= v;
        break;
      case 'ARTIST':
        tags.artist = tags.artist ? `${tags.artist}, ${v}` : v;
        break;
      case 'ALBUM':
        tags.album ??= v;
        break;
      case 'ALBUMARTIST':
      case 'ALBUM ARTIST':
        tags.albumArtist ??= v;
        break;
      case 'GENRE':
        tags.genre ??= v;
        break;
      case 'DATE':
      case 'YEAR':
        tags.year ??= leadingInt(v);
        break;
      case 'TRACKNUMBER':
        tags.trackNo ??= leadingInt(v);
        break;
      case 'DISCNUMBER':
        tags.discNo ??= leadingInt(v);
        break;
    }
  }
}

// ------------------------------------------------------------------ MP4

async function readMp4(src: ByteSource, tags: AudioTags) {
  // Parcourt les atomes de premier niveau pour trouver « moov », qui peut
  // se trouver au début ou à la fin du fichier.
  let pos = 0;
  let guard = 0;
  while (pos + 8 <= src.size && guard++ < 64) {
    const h = await src.read(pos, pos + 16);
    let size = be32(h, 0);
    const type = ascii(h, 4, 8);
    let headLen = 8;
    if (size === 1) {
      size = be32(h, 8) * 2 ** 32 + be32(h, 12);
      headLen = 16;
    } else if (size === 0) {
      size = src.size - pos;
    }
    if (size < headLen) return;
    if (type === 'moov') {
      if (size > MAX_TAG) return;
      const moov = await src.read(pos + headLen, pos + size);
      parseMoov(moov, tags);
      return;
    }
    pos += size;
  }
}

function* atoms(b: Uint8Array, start: number, end: number) {
  let p = start;
  while (p + 8 <= end) {
    const size = be32(b, p);
    if (size < 8 || p + size > end) return;
    yield { type: ascii(b, p + 4, p + 8), start: p + 8, end: p + size };
    p += size;
  }
}

function find(b: Uint8Array, start: number, end: number, type: string) {
  for (const a of atoms(b, start, end)) if (a.type === type) return a;
  return null;
}

function parseMoov(b: Uint8Array, tags: AudioTags) {
  const mvhd = find(b, 0, b.length, 'mvhd');
  if (mvhd) {
    const v = b[mvhd.start];
    const scale = v === 1 ? be32(b, mvhd.start + 20) : be32(b, mvhd.start + 12);
    const dur =
      v === 1 ? be32(b, mvhd.start + 24) * 2 ** 32 + be32(b, mvhd.start + 28) : be32(b, mvhd.start + 16);
    if (scale > 0 && dur > 0) tags.durationMs = Math.round((dur * 1000) / scale);
  }
  const udta = find(b, 0, b.length, 'udta');
  if (!udta) return;
  const meta = find(b, udta.start, udta.end, 'meta');
  if (!meta) return;
  // « meta » est un full box : 4 octets version/flags avant les enfants.
  const ilst = find(b, meta.start + 4, meta.end, 'ilst');
  if (!ilst) return;
  for (const item of atoms(b, ilst.start, ilst.end)) {
    const data = find(b, item.start, item.end, 'data');
    if (!data) continue;
    const kind = be32(b, data.start) & 0xffffff;
    const payload = b.subarray(data.start + 8, data.end);
    const str = () => utf8.decode(payload).trim() || undefined;
    switch (item.type) {
      case '©nam':
        tags.title ??= str();
        break;
      case '©ART':
        tags.artist ??= str();
        break;
      case 'aART':
        tags.albumArtist ??= str();
        break;
      case '©alb':
        tags.album ??= str();
        break;
      case '©gen':
        tags.genre ??= str();
        break;
      case 'gnre':
        if (payload.length >= 2) tags.genre ??= GENRES[((payload[0] << 8) | payload[1]) - 1];
        break;
      case '©day':
        tags.year ??= leadingInt(str());
        break;
      case 'trkn':
        if (payload.length >= 4) tags.trackNo ??= (payload[2] << 8) | payload[3] || undefined;
        break;
      case 'disk':
        if (payload.length >= 4) tags.discNo ??= (payload[2] << 8) | payload[3] || undefined;
        break;
      case 'covr':
        if (!tags.picture && payload.length > 64) {
          tags.picture = payload.slice();
          tags.pictureMime = sniffMime(payload, kind === 14 ? 'image/png' : 'image/jpeg');
        }
        break;
    }
  }
}

/** Déduit artiste/titre/numéro d'un nom de fichier « 01 - Artiste - Titre.mp3 ». */
export function guessFromFilename(file: string): { title: string; artist?: string; trackNo?: number } {
  let base = file.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
  let trackNo: number | undefined;
  const num = /^(\d{1,3})[\s.\-)]+(.+)$/.exec(base);
  if (num) {
    trackNo = parseInt(num[1], 10);
    base = num[2].trim();
  }
  const parts = base.split(/\s+-\s+/);
  if (parts.length >= 2) {
    return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim(), trackNo };
  }
  return { title: base, trackNo };
}

const GENRES = [
  'Blues', 'Classic Rock', 'Country', 'Dance', 'Disco', 'Funk', 'Grunge', 'Hip-Hop', 'Jazz',
  'Metal', 'New Age', 'Oldies', 'Other', 'Pop', 'R&B', 'Rap', 'Reggae', 'Rock', 'Techno',
  'Industrial', 'Alternative', 'Ska', 'Death Metal', 'Pranks', 'Soundtrack', 'Euro-Techno',
  'Ambient', 'Trip-Hop', 'Vocal', 'Jazz+Funk', 'Fusion', 'Trance', 'Classical', 'Instrumental',
  'Acid', 'House', 'Game', 'Sound Clip', 'Gospel', 'Noise', 'AlternRock', 'Bass', 'Soul', 'Punk',
  'Space', 'Meditative', 'Instrumental Pop', 'Instrumental Rock', 'Ethnic', 'Gothic', 'Darkwave',
  'Techno-Industrial', 'Electronic', 'Pop-Folk', 'Eurodance', 'Dream', 'Southern Rock', 'Comedy',
  'Cult', 'Gangsta', 'Top 40', 'Christian Rap', 'Pop/Funk', 'Jungle', 'Native American', 'Cabaret',
  'New Wave', 'Psychedelic', 'Rave', 'Showtunes', 'Trailer', 'Lo-Fi', 'Tribal', 'Acid Punk',
  'Acid Jazz', 'Polka', 'Retro', 'Musical', 'Rock & Roll', 'Hard Rock',
];

/** Source d'octets à partir d'un Blob (fichiers importés). */
export function blobSource(blob: Blob): ByteSource {
  return {
    size: blob.size,
    async read(start, end) {
      return new Uint8Array(await blob.slice(start, end).arrayBuffer());
    },
  };
}

/**
 * Enveloppe une fonction de lecture par plages avec un tampon contigu depuis
 * le début du fichier : la plupart des lectures (tags) se font au début, on
 * regroupe donc les petites requêtes en blocs plus gros.
 */
export function bufferedSource(
  size: number,
  fetchRange: (start: number, end: number) => Promise<Uint8Array>,
  chunk = 128 * 1024,
): ByteSource {
  let head = new Uint8Array(0);
  return {
    size,
    async read(start, end) {
      end = Math.min(end, size);
      if (start >= end) return new Uint8Array(0);
      if (end <= head.length) return head.subarray(start, end);
      if (start <= head.length + chunk && end <= 24 * 1024 * 1024) {
        const want = Math.min(size, Math.max(end, head.length + chunk));
        const more = await fetchRange(head.length, want);
        const merged = new Uint8Array(head.length + more.length);
        merged.set(head);
        merged.set(more, head.length);
        head = merged;
        return head.subarray(start, Math.min(end, head.length));
      }
      return fetchRange(start, end);
    },
  };
}
