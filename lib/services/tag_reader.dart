// Lecture des métadonnées audio en Dart pur (aucune dépendance native).
// Prend en charge : ID3v2.2 / 2.3 / 2.4, ID3v1, FLAC (Vorbis comments + PICTURE),
// et l'estimation de durée des MP3 (en-têtes Xing/Info/VBRI ou débit constant).

import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

class AudioTags {
  String? title;
  String? artist;
  String? album;
  String? albumArtist;
  String? genre;
  int? year;
  int? trackNo;
  int? discNo;
  int? durationMs;
  Uint8List? picture;
  String? pictureMime;

  bool get hasPicture => picture != null && picture!.isNotEmpty;
}

class TagReader {
  static const int _maxTagBytes = 24 * 1024 * 1024;

  /// Lit les tags d'un fichier. Ne lève jamais d'exception : en cas
  /// d'erreur, renvoie ce qui a pu être lu.
  static AudioTags read(String path, {bool withPicture = true}) {
    final tags = AudioTags();
    RandomAccessFile? raf;
    try {
      raf = File(path).openSync();
      final length = raf.lengthSync();
      if (length < 4) return tags;
      final head = raf.readSync(10);
      if (head.length >= 4 &&
          head[0] == 0x66 &&
          head[1] == 0x4C &&
          head[2] == 0x61 &&
          head[3] == 0x43) {
        _readFlac(raf, tags, withPicture);
        return tags;
      }
      var audioStart = 0;
      if (head.length == 10 &&
          head[0] == 0x49 &&
          head[1] == 0x44 &&
          head[2] == 0x33) {
        final size = _syncsafe(head, 6);
        final footer = (head[5] & 0x10) != 0 ? 10 : 0;
        audioStart = 10 + size + footer;
        if (size > 0 && size < _maxTagBytes) {
          raf.setPositionSync(10);
          final body = raf.readSync(size);
          try {
            parseId3v2(head, body, tags, withPicture);
          } catch (_) {}
        }
      }
      if (_isEmpty(tags) && length > 128) {
        raf.setPositionSync(length - 128);
        final v1 = raf.readSync(128);
        try {
          parseId3v1(v1, tags);
        } catch (_) {}
      }
      if (path.toLowerCase().endsWith('.mp3') && tags.durationMs == null) {
        try {
          raf.setPositionSync(audioStart);
          final frameData = raf.readSync(64 * 1024);
          tags.durationMs =
              estimateMp3Duration(frameData, length - audioStart);
        } catch (_) {}
      }
    } catch (_) {
      // Fichier illisible : on renvoie ce qu'on a.
    } finally {
      try {
        raf?.closeSync();
      } catch (_) {}
    }
    return tags;
  }

  static bool _isEmpty(AudioTags t) =>
      (t.title == null || t.title!.isEmpty) &&
      (t.artist == null || t.artist!.isEmpty) &&
      (t.album == null || t.album!.isEmpty);

  static int _syncsafe(List<int> b, int o) =>
      ((b[o] & 0x7F) << 21) |
      ((b[o + 1] & 0x7F) << 14) |
      ((b[o + 2] & 0x7F) << 7) |
      (b[o + 3] & 0x7F);

  static int _be32(List<int> b, int o) =>
      (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];

  static int _le32(List<int> b, int o) =>
      b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);

  static Uint8List _removeUnsync(Uint8List data) {
    final out = BytesBuilder(copy: false);
    final buf = Uint8List(data.length);
    var j = 0;
    for (var i = 0; i < data.length; i++) {
      buf[j++] = data[i];
      if (data[i] == 0xFF && i + 1 < data.length && data[i + 1] == 0x00) {
        i++;
      }
    }
    out.add(Uint8List.sublistView(buf, 0, j));
    return out.takeBytes();
  }

  /// [header] : les 10 octets d'en-tête, [body] : le contenu du tag.
  static void parseId3v2(
      List<int> header, Uint8List body, AudioTags tags, bool withPicture) {
    final major = header[3];
    final flags = header[5];
    var data = body;
    if (major < 4 && (flags & 0x80) != 0) data = _removeUnsync(data);
    var pos = 0;
    if ((flags & 0x40) != 0 && major >= 3 && data.length >= 4) {
      // En-tête étendu.
      pos = major == 4 ? _syncsafe(data, 0) : _be32(data, 0) + 4;
    }
    final idLen = major == 2 ? 3 : 4;
    final headLen = major == 2 ? 6 : 10;
    Uint8List? bestPic;
    String? bestMime;
    var bestPicType = -1;

    while (pos + headLen <= data.length) {
      if (data[pos] == 0) break; // remplissage
      final id = String.fromCharCodes(data.sublist(pos, pos + idLen));
      if (!RegExp(r'^[A-Z0-9]+$').hasMatch(id)) break;
      int size;
      var fflags = 0;
      if (major == 2) {
        size = (data[pos + 3] << 16) | (data[pos + 4] << 8) | data[pos + 5];
      } else if (major == 4) {
        size = _syncsafe(data, pos + 4);
        // Certains logiciels écrivent une taille non synchsafe en v2.4.
        final raw = _be32(data, pos + 4);
        if (raw != size &&
            pos + headLen + raw <= data.length &&
            (pos + headLen + size > data.length ||
                !_looksLikeFrame(data, pos + headLen + size)) &&
            _looksLikeFrame(data, pos + headLen + raw)) {
          size = raw;
        }
        fflags = (data[pos + 8] << 8) | data[pos + 9];
      } else {
        size = _be32(data, pos + 4);
        fflags = (data[pos + 8] << 8) | data[pos + 9];
      }
      final start = pos + headLen;
      final end = start + size;
      if (size <= 0 || end > data.length) break;
      pos = end;

      var frame = Uint8List.sublistView(data, start, end);
      if (major == 4) {
        if ((fflags & 0x000C) != 0) continue; // compressé / chiffré
        if ((fflags & 0x0001) != 0 && frame.length >= 4) {
          frame = Uint8List.sublistView(frame, 4);
        }
        if ((fflags & 0x0002) != 0) frame = _removeUnsync(frame);
      } else if (major == 3) {
        if ((fflags & 0x00C0) != 0) continue;
      }

      switch (id) {
        case 'TIT2':
        case 'TT2':
          tags.title ??= _text(frame);
        case 'TPE1':
        case 'TP1':
          tags.artist ??= _text(frame);
        case 'TALB':
        case 'TAL':
          tags.album ??= _text(frame);
        case 'TPE2':
        case 'TP2':
          tags.albumArtist ??= _text(frame);
        case 'TCON':
        case 'TCO':
          tags.genre ??= _genre(_text(frame));
        case 'TRCK':
        case 'TRK':
          tags.trackNo ??= _leadingInt(_text(frame));
        case 'TPOS':
        case 'TPA':
          tags.discNo ??= _leadingInt(_text(frame));
        case 'TYER':
        case 'TYE':
        case 'TDRC':
        case 'TDOR':
          tags.year ??= _leadingInt(_text(frame));
        case 'TLEN':
        case 'TLE':
          final ms = _leadingInt(_text(frame));
          if (ms != null && ms > 1000) tags.durationMs ??= ms;
        case 'APIC':
        case 'PIC':
          if (!withPicture) break;
          final pic = _picture(frame, major == 2);
          if (pic != null) {
            final rank = pic.$3 == 3 ? 2 : (pic.$3 == 0 ? 1 : 0);
            if (rank > bestPicType) {
              bestPicType = rank;
              bestPic = pic.$1;
              bestMime = pic.$2;
            }
          }
      }
    }
    if (bestPic != null) {
      tags.picture = bestPic;
      tags.pictureMime = bestMime;
    }
  }

  static bool _looksLikeFrame(Uint8List d, int p) {
    if (p == d.length) return true;
    if (p + 4 > d.length) return false;
    if (d[p] == 0) return true;
    for (var i = 0; i < 4; i++) {
      final c = d[p + i];
      final ok = (c >= 0x41 && c <= 0x5A) || (c >= 0x30 && c <= 0x39);
      if (!ok) return false;
    }
    return true;
  }

  static int? _leadingInt(String? s) {
    if (s == null) return null;
    final m = RegExp(r'\d+').firstMatch(s);
    return m == null ? null : int.tryParse(m.group(0)!);
  }

  static String? _genre(String? g) {
    if (g == null || g.isEmpty) return null;
    final m = RegExp(r'^\((\d+)\)(.*)$').firstMatch(g);
    if (m != null) {
      final rest = m.group(2)!.trim();
      if (rest.isNotEmpty) return rest;
      return id3Genre(int.parse(m.group(1)!));
    }
    final n = int.tryParse(g);
    if (n != null) return id3Genre(n);
    return g;
  }

  static String? id3Genre(int n) =>
      n >= 0 && n < _genres.length ? _genres[n] : null;

  /// Décode une chaîne selon l'octet d'encodage ID3.
  static String _decode(int enc, List<int> bytes) {
    try {
      switch (enc) {
        case 0:
          return latin1.decode(bytes);
        case 3:
          return utf8.decode(bytes, allowMalformed: true);
        case 1:
        case 2:
          var bigEndian = enc == 2;
          var start = 0;
          if (bytes.length >= 2) {
            if (bytes[0] == 0xFF && bytes[1] == 0xFE) {
              bigEndian = false;
              start = 2;
            } else if (bytes[0] == 0xFE && bytes[1] == 0xFF) {
              bigEndian = true;
              start = 2;
            }
          }
          final units = <int>[];
          for (var i = start; i + 1 < bytes.length; i += 2) {
            units.add(bigEndian
                ? (bytes[i] << 8) | bytes[i + 1]
                : bytes[i] | (bytes[i + 1] << 8));
          }
          return String.fromCharCodes(units);
      }
    } catch (_) {}
    return latin1.decode(bytes, allowInvalid: true);
  }

  static String? _text(Uint8List frame) {
    if (frame.isEmpty) return null;
    final enc = frame[0];
    final raw = _decode(enc, frame.sublist(1));
    final parts = raw
        .split('\u0000')
        .map((s) => s.replaceAll('﻿', '').trim())
        .where((s) => s.isNotEmpty)
        .toList();
    if (parts.isEmpty) return null;
    return parts.join(', ');
  }

  /// Renvoie (données, mime, type d'image).
  static (Uint8List, String, int)? _picture(Uint8List f, bool v22) {
    if (f.length < 6) return null;
    final enc = f[0];
    var p = 1;
    String mime;
    if (v22) {
      final fmt = String.fromCharCodes(f.sublist(1, 4)).toUpperCase();
      mime = fmt == 'PNG' ? 'image/png' : 'image/jpeg';
      p = 4;
    } else {
      final z = f.indexOf(0, 1);
      if (z < 0) return null;
      mime = latin1.decode(f.sublist(1, z), allowInvalid: true).toLowerCase();
      p = z + 1;
    }
    if (p >= f.length) return null;
    final type = f[p];
    p++;
    // Description terminée par 0 (ou 00 00 en UTF-16).
    if (enc == 1 || enc == 2) {
      while (p + 1 < f.length && !(f[p] == 0 && f[p + 1] == 0)) {
        p += 2;
      }
      p += 2;
    } else {
      while (p < f.length && f[p] != 0) {
        p++;
      }
      p++;
    }
    if (p >= f.length) return null;
    final data = Uint8List.fromList(f.sublist(p));
    if (data.length < 64) return null;
    if (data[0] == 0x89 && data[1] == 0x50) mime = 'image/png';
    if (data[0] == 0xFF && data[1] == 0xD8) mime = 'image/jpeg';
    if (!mime.startsWith('image/')) mime = 'image/jpeg';
    return (data, mime, type);
  }

  static void parseId3v1(List<int> b, AudioTags tags) {
    if (b.length < 128 || b[0] != 0x54 || b[1] != 0x41 || b[2] != 0x47) {
      return;
    }
    String field(int o, int l) {
      final s = b.sublist(o, o + l);
      final z = s.indexOf(0);
      return latin1
          .decode(z >= 0 ? s.sublist(0, z) : s, allowInvalid: true)
          .trim();
    }

    final title = field(3, 30);
    final artist = field(33, 30);
    final album = field(63, 30);
    final year = int.tryParse(field(93, 4));
    if (title.isNotEmpty) tags.title ??= title;
    if (artist.isNotEmpty) tags.artist ??= artist;
    if (album.isNotEmpty) tags.album ??= album;
    if (year != null && year > 0) tags.year ??= year;
    if (b[125] == 0 && b[126] != 0) tags.trackNo ??= b[126];
    tags.genre ??= id3Genre(b[127]);
  }

  // ---------------------------------------------------------------- MP3

  static const _brV1L1 = [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448];
  static const _brV1L2 = [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384];
  static const _brV1L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  static const _brV2L1 = [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256];
  static const _brV2L23 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];

  /// Estime la durée (ms) d'un MP3 à partir du début des données audio.
  static int? estimateMp3Duration(Uint8List d, int audioBytes) {
    for (var i = 0; i + 4 < d.length; i++) {
      if (d[i] != 0xFF || (d[i + 1] & 0xE0) != 0xE0) continue;
      final h = _parseFrameHeader(d, i);
      if (h == null) continue;
      // Vérifie que la trame suivante commence bien par une synchro.
      final next = i + h.frameLength;
      if (next + 1 < d.length &&
          !(d[next] == 0xFF && (d[next + 1] & 0xE0) == 0xE0)) {
        continue;
      }
      final mono = h.channelMode == 3;
      final xingOff = i +
          4 +
          (h.version == 3 ? (mono ? 17 : 32) : (mono ? 9 : 17));
      if (xingOff + 12 <= d.length) {
        final tag = String.fromCharCodes(d.sublist(xingOff, xingOff + 4));
        if (tag == 'Xing' || tag == 'Info') {
          final flags = _be32(d, xingOff + 4);
          if ((flags & 1) != 0) {
            final frames = _be32(d, xingOff + 8);
            if (frames > 0) {
              return (frames * h.samplesPerFrame * 1000 / h.sampleRate)
                  .round();
            }
          }
        }
      }
      final vbri = i + 36;
      if (vbri + 18 <= d.length &&
          String.fromCharCodes(d.sublist(vbri, vbri + 4)) == 'VBRI') {
        final frames = _be32(d, vbri + 14);
        if (frames > 0) {
          return (frames * h.samplesPerFrame * 1000 / h.sampleRate).round();
        }
      }
      final bytes = audioBytes - i;
      if (h.bitrate <= 0 || bytes <= 0) return null;
      return (bytes * 8 / h.bitrate).round(); // bitrate en kbit/s → ms
    }
    return null;
  }

  static _FrameHeader? _parseFrameHeader(Uint8List d, int i) {
    final b1 = d[i + 1], b2 = d[i + 2], b3 = d[i + 3];
    final version = (b1 >> 3) & 3; // 0: 2.5, 2: 2, 3: 1
    final layer = (b1 >> 1) & 3; // 1: L3, 2: L2, 3: L1
    if (version == 1 || layer == 0) return null;
    final brIdx = (b2 >> 4) & 0xF;
    final srIdx = (b2 >> 2) & 3;
    if (brIdx == 0 || brIdx == 15 || srIdx == 3) return null;
    final padding = (b2 >> 1) & 1;
    final channelMode = (b3 >> 6) & 3;
    const srV1 = [44100, 48000, 32000];
    var sampleRate = srV1[srIdx];
    if (version == 2) sampleRate ~/= 2;
    if (version == 0) sampleRate ~/= 4;
    int bitrate;
    if (version == 3) {
      bitrate = layer == 3
          ? _brV1L1[brIdx]
          : layer == 2
              ? _brV1L2[brIdx]
              : _brV1L3[brIdx];
    } else {
      bitrate = layer == 3 ? _brV2L1[brIdx] : _brV2L23[brIdx];
    }
    int samples;
    if (layer == 3) {
      samples = 384;
    } else if (layer == 2) {
      samples = 1152;
    } else {
      samples = version == 3 ? 1152 : 576;
    }
    int frameLength;
    if (layer == 3) {
      frameLength = ((12 * bitrate * 1000 ~/ sampleRate) + padding) * 4;
    } else {
      frameLength = (samples ~/ 8) * bitrate * 1000 ~/ sampleRate + padding;
    }
    if (frameLength < 21) return null;
    return _FrameHeader(
        version, bitrate, sampleRate, samples, channelMode, frameLength);
  }

  // --------------------------------------------------------------- FLAC

  static void _readFlac(RandomAccessFile raf, AudioTags tags, bool withPic) {
    raf.setPositionSync(4);
    var last = false;
    var guard = 0;
    while (!last && guard++ < 128) {
      final h = raf.readSync(4);
      if (h.length < 4) break;
      last = (h[0] & 0x80) != 0;
      final type = h[0] & 0x7F;
      final len = (h[1] << 16) | (h[2] << 8) | h[3];
      final pos = raf.positionSync();
      if (type == 0 && len >= 18) {
        final s = raf.readSync(18);
        final sampleRate = (s[10] << 12) | (s[11] << 4) | (s[12] >> 4);
        final total = ((s[13] & 0x0F) << 32) |
            (s[14] << 24) |
            (s[15] << 16) |
            (s[16] << 8) |
            s[17];
        if (sampleRate > 0 && total > 0) {
          tags.durationMs = (total * 1000 / sampleRate).round();
        }
      } else if (type == 4 && len < _maxTagBytes) {
        parseVorbisComments(raf.readSync(len), tags);
      } else if (type == 6 && withPic && len < _maxTagBytes) {
        final b = raf.readSync(len);
        try {
          var p = 0;
          final picType = _be32(b, p);
          p += 4;
          final ml = _be32(b, p);
          p += 4;
          final mime = latin1.decode(b.sublist(p, p + ml));
          p += ml;
          final dl = _be32(b, p);
          p += 4 + dl + 16;
          final datalen = _be32(b, p);
          p += 4;
          if (!tags.hasPicture || picType == 3) {
            tags.picture = Uint8List.fromList(b.sublist(p, p + datalen));
            tags.pictureMime = mime;
          }
        } catch (_) {}
      }
      raf.setPositionSync(pos + len);
    }
  }

  static void parseVorbisComments(Uint8List b, AudioTags tags) {
    var p = 0;
    final vl = _le32(b, p);
    p += 4 + vl;
    final count = _le32(b, p);
    p += 4;
    for (var i = 0; i < count && p + 4 <= b.length; i++) {
      final l = _le32(b, p);
      p += 4;
      if (p + l > b.length) break;
      final c = utf8.decode(b.sublist(p, p + l), allowMalformed: true);
      p += l;
      final eq = c.indexOf('=');
      if (eq <= 0) continue;
      final k = c.substring(0, eq).toUpperCase();
      final v = c.substring(eq + 1).trim();
      if (v.isEmpty) continue;
      switch (k) {
        case 'TITLE':
          tags.title ??= v;
        case 'ARTIST':
          tags.artist = tags.artist == null ? v : '${tags.artist}, $v';
        case 'ALBUM':
          tags.album ??= v;
        case 'ALBUMARTIST':
        case 'ALBUM ARTIST':
          tags.albumArtist ??= v;
        case 'GENRE':
          tags.genre ??= v;
        case 'DATE':
        case 'YEAR':
          tags.year ??= _leadingInt(v);
        case 'TRACKNUMBER':
          tags.trackNo ??= _leadingInt(v);
        case 'DISCNUMBER':
          tags.discNo ??= _leadingInt(v);
      }
    }
  }

  static const _genres = [
    'Blues', 'Classic Rock', 'Country', 'Dance', 'Disco', 'Funk', 'Grunge',
    'Hip-Hop', 'Jazz', 'Metal', 'New Age', 'Oldies', 'Other', 'Pop', 'R&B',
    'Rap', 'Reggae', 'Rock', 'Techno', 'Industrial', 'Alternative', 'Ska',
    'Death Metal', 'Pranks', 'Soundtrack', 'Euro-Techno', 'Ambient',
    'Trip-Hop', 'Vocal', 'Jazz+Funk', 'Fusion', 'Trance', 'Classical',
    'Instrumental', 'Acid', 'House', 'Game', 'Sound Clip', 'Gospel', 'Noise',
    'AlternRock', 'Bass', 'Soul', 'Punk', 'Space', 'Meditative',
    'Instrumental Pop', 'Instrumental Rock', 'Ethnic', 'Gothic', 'Darkwave',
    'Techno-Industrial', 'Electronic', 'Pop-Folk', 'Eurodance', 'Dream',
    'Southern Rock', 'Comedy', 'Cult', 'Gangsta', 'Top 40', 'Christian Rap',
    'Pop/Funk', 'Jungle', 'Native American', 'Cabaret', 'New Wave',
    'Psychedelic', 'Rave', 'Showtunes', 'Trailer', 'Lo-Fi', 'Tribal',
    'Acid Punk', 'Acid Jazz', 'Polka', 'Retro', 'Musical', 'Rock & Roll',
    'Hard Rock',
  ];
}

class _FrameHeader {
  final int version;
  final int bitrate;
  final int sampleRate;
  final int samplesPerFrame;
  final int channelMode;
  final int frameLength;
  _FrameHeader(this.version, this.bitrate, this.sampleRate,
      this.samplesPerFrame, this.channelMode, this.frameLength);
}
