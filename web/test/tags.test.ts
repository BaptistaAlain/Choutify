import { describe, expect, it } from 'vitest';
import { blobSource, bufferedSource, estimateMp3Duration, guessFromFilename, readTags } from '../src/lib/tags';

const enc = new TextEncoder();
const bytes = (...parts: (number[] | Uint8Array | string)[]) => {
  const arr = parts.map((p) => (typeof p === 'string' ? enc.encode(p) : p instanceof Uint8Array ? p : Uint8Array.from(p)));
  const out = new Uint8Array(arr.reduce((a, b) => a + b.length, 0));
  let o = 0;
  for (const a of arr) {
    out.set(a, o);
    o += a.length;
  }
  return out;
};
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const syncsafe = (n: number) => [(n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127];

function frame(id: string, body: Uint8Array, v4 = false) {
  return bytes(id, v4 ? syncsafe(body.length) : be32(body.length), [0, 0], body);
}
const textFrame = (id: string, s: string, v4 = false) => frame(id, bytes([3], s), v4);

// Une trame MPEG1 Layer III 128 kbit/s 44,1 kHz (417 octets) répétée.
function mp3Frames(n: number) {
  const f = new Uint8Array(417);
  f.set([0xff, 0xfb, 0x90, 0x00]);
  const out = new Uint8Array(417 * n);
  for (let i = 0; i < n; i++) out.set(f, i * 417);
  return out;
}

function id3(major: 3 | 4, frames: Uint8Array[]) {
  const body = bytes(...frames);
  return bytes('ID3', [major, 0, 0], syncsafe(body.length), body);
}

const jpeg = bytes([0xff, 0xd8, 0xff, 0xe0], new Uint8Array(200));

describe('readTags', () => {
  it('lit un tag ID3v2.3 avec pochette', async () => {
    const tag = id3(3, [
      textFrame('TIT2', 'Lumière'),
      textFrame('TPE1', 'Les Étoiles'),
      textFrame('TALB', 'Nuit'),
      textFrame('TRCK', '3/12'),
      textFrame('TCON', '(13)'),
      textFrame('TYER', '2021'),
      frame('APIC', bytes([0], 'image/jpeg', [0, 3, 0], jpeg)),
    ]);
    const file = new Blob([tag, mp3Frames(200)]);
    const t = await readTags(blobSource(file), 'x.mp3');
    expect(t.title).toBe('Lumière');
    expect(t.artist).toBe('Les Étoiles');
    expect(t.album).toBe('Nuit');
    expect(t.trackNo).toBe(3);
    expect(t.genre).toBe('Pop');
    expect(t.year).toBe(2021);
    expect(t.pictureMime).toBe('image/jpeg');
    expect(t.picture?.length).toBe(jpeg.length);
    // 200 trames × 1152 échantillons / 44100 Hz ≈ 5,2 s
    expect(t.durationMs).toBeGreaterThan(5000);
    expect(t.durationMs).toBeLessThan(5500);
  });

  it('lit un tag ID3v2.4 (tailles synchsafe)', async () => {
    const tag = id3(4, [textFrame('TIT2', 'Titre', true), textFrame('TPE1', 'Artiste', true)]);
    const t = await readTags(blobSource(new Blob([tag, mp3Frames(10)])), 'a.mp3');
    expect(t.title).toBe('Titre');
    expect(t.artist).toBe('Artiste');
  });

  it('ignore la pochette quand le tag est tronqué', async () => {
    const tag = id3(3, [textFrame('TIT2', 'Court'), frame('APIC', bytes([0], 'image/jpeg', [0, 3, 0], new Uint8Array(5000).fill(1)))]);
    const t = await readTags(blobSource(new Blob([tag])), 'a.mp3', 200);
    expect(t.title).toBe('Court');
    expect(t.picture).toBeUndefined();
  });

  it('lit un ID3v1 en fin de fichier', async () => {
    const v1 = new Uint8Array(128);
    v1.set(enc.encode('TAG'));
    v1.set(enc.encode('Vieux titre'), 3);
    v1.set(enc.encode('Vieil artiste'), 33);
    v1[127] = 17;
    const t = await readTags(blobSource(new Blob([mp3Frames(5), v1])), 'a.mp3');
    expect(t.title).toBe('Vieux titre');
    expect(t.artist).toBe('Vieil artiste');
    expect(t.genre).toBe('Rock');
  });

  it('lit un FLAC (Vorbis comments + durée)', async () => {
    const streaminfo = new Uint8Array(34);
    // 44100 Hz, 441000 échantillons → 10 s
    const sr = 44100;
    streaminfo[10] = (sr >> 12) & 255;
    streaminfo[11] = (sr >> 4) & 255;
    streaminfo[12] = (sr & 15) << 4;
    streaminfo.set(be32(441000), 14);
    const vendor = enc.encode('test');
    const comments = ['TITLE=Forêt', 'ARTIST=Marin', 'ALBUM=Côtes', 'TRACKNUMBER=2'].map((c) => enc.encode(c));
    const le = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255];
    const vc = bytes(le(vendor.length), vendor, le(comments.length), ...comments.flatMap((c) => [Uint8Array.from(le(c.length)), c]));
    const file = bytes('fLaC', [0, 0, 0, 34], streaminfo, [0x84, (vc.length >> 16) & 255, (vc.length >> 8) & 255, vc.length & 255], vc);
    const t = await readTags(blobSource(new Blob([file])), 'f.flac');
    expect(t.title).toBe('Forêt');
    expect(t.album).toBe('Côtes');
    expect(t.trackNo).toBe(2);
    expect(t.durationMs).toBe(10000);
  });

  it('regroupe les lectures par plages', async () => {
    const data = new Uint8Array(1_000_000).map((_, i) => i & 255);
    const calls: [number, number][] = [];
    const src = bufferedSource(data.length, async (s, e) => {
      calls.push([s, e]);
      return data.slice(s, e);
    });
    expect((await src.read(0, 10))[5]).toBe(5);
    expect((await src.read(100, 200))[0]).toBe(100);
    expect(calls.length).toBe(1);
    const tail = await src.read(999_000, 1_000_000);
    expect(tail[0]).toBe(999_000 & 255);
  });
});

describe('noms de fichiers', () => {
  it('déduit le numéro, l’artiste et le titre', () => {
    expect(guessFromFilename('01 - Daft Punk - One More Time.mp3')).toEqual({ trackNo: 1, artist: 'Daft Punk', title: 'One More Time' });
    expect(guessFromFilename('Intro.mp3')).toEqual({ title: 'Intro', trackNo: undefined });
  });
});

describe('durée MP3', () => {
  it('estime la durée à débit constant', () => {
    const d = estimateMp3Duration(mp3Frames(20), 417 * 1000);
    expect(d).toBeGreaterThan(25000);
    expect(d).toBeLessThan(27000);
  });
});
