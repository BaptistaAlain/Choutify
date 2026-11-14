import 'dart:io';
import 'dart:isolate';

import 'package:path/path.dart' as p;

import '../models/track.dart';
import 'paths.dart';
import 'tag_reader.dart';

const audioExtensions = {
  '.mp3', '.m4a', '.aac', '.flac', '.ogg', '.opus', '.wav',
};
const _imageExtensions = {'.jpg', '.jpeg', '.png', '.webp'};
const _preferredCoverNames = [
  'cover', 'folder', 'front', 'album', 'albumart', 'albumartsmall', 'artwork',
];

class ScanProgress {
  final int done;
  final int total;
  final String phase;
  const ScanProgress(this.done, this.total, this.phase);
}

class _FileEntry {
  final String path;
  final int mtime;
  final int size;
  _FileEntry(this.path, this.mtime, this.size);
}

/// Hash FNV-1a 64 bits en hexadécimal (nom de fichier de pochette).
String stableHash(String s) {
  var h = 0xcbf29ce484222325;
  for (final c in s.codeUnits) {
    h ^= c;
    h = (h * 0x100000001b3) & 0xFFFFFFFFFFFFFFFF;
  }
  return h.toUnsigned(64).toRadixString(16);
}

class LibraryScanner {
  /// Analyse [folders] et renvoie la liste complète des titres. Les titres
  /// inchangés depuis [previous] sont réutilisés sans relire le fichier.
  static Future<List<Track>> scan({
    required List<String> folders,
    required Map<String, Track> previous,
    required PathCodec codec,
    void Function(ScanProgress)? onProgress,
  }) async {
    onProgress?.call(const ScanProgress(0, 0, 'Recherche des fichiers…'));
    final docs = codec.docsDir;
    final support = codec.supportDir;

    final listing = await _runList(folders);
    final files = listing.$1;
    final folderArt = listing.$2;

    final result = <Track>[];
    final toParse = <_FileEntry>[];
    final now = DateTime.now().millisecondsSinceEpoch;
    for (final f in files) {
      final id = PathCodec(docs, support).encode(f.path);
      final old = previous[id];
      if (old != null && old.mtime == f.mtime && old.size == f.size) {
        var t = old;
        // La pochette du dossier a pu apparaître ou disparaître.
        final hasCachedArt = t.artPath != null &&
            t.artPath!.startsWith(codec.coversDir) &&
            File(t.artPath!).existsSync();
        if (!hasCachedArt) {
          final art = folderArt[p.dirname(f.path)];
          if (art != t.artPath) t = t.withArt(art);
        }
        result.add(t);
      } else {
        toParse.add(f);
      }
    }

    const batch = 40;
    for (var i = 0; i < toParse.length; i += batch) {
      onProgress?.call(
          ScanProgress(i, toParse.length, 'Lecture des métadonnées…'));
      final chunk = toParse.sublist(
          i, i + batch > toParse.length ? toParse.length : i + batch);
      final entries = chunk.map((e) => (e.path, e.mtime, e.size)).toList();
      final parsed =
          await _runParse(entries, docs, support, codec.coversDir, folderArt);
      for (final j in parsed) {
        final t = Track.fromJson(j, codec.decode);
        final old = previous[t.id];
        result.add(old == null ? t.copyWith(addedAt: now) : t.copyWith(addedAt: old.addedAt));
      }
    }
    onProgress?.call(
        ScanProgress(toParse.length, toParse.length, 'Terminé'));
    return result;
  }

  // Les travaux lourds tournent dans un isolate séparé pour ne pas figer l'UI.
  static Future<(List<_FileEntry>, Map<String, String>)> _runList(
          List<String> folders) =>
      Isolate.run(() => _listFiles(folders));

  static Future<List<Map<String, dynamic>>> _runParse(
      List<(String, int, int)> entries,
      String docs,
      String support,
      String coversDir,
      Map<String, String> folderArt) {
    return Isolate.run(() {
      final c = PathCodec(docs, support);
      return entries
          .map((e) => _parseOne(e.$1, e.$2, e.$3, coversDir, folderArt, c)
              .toJson(c.encode))
          .toList();
    });
  }

  static (List<_FileEntry>, Map<String, String>) _listFiles(
      List<String> folders) {
    final files = <_FileEntry>[];
    final seen = <String>{};
    final images = <String, List<String>>{};
    for (final folder in folders) {
      final dir = Directory(folder);
      if (!dir.existsSync()) continue;
      final stack = <Directory>[dir];
      while (stack.isNotEmpty) {
        final d = stack.removeLast();
        List<FileSystemEntity> children;
        try {
          children = d.listSync(followLinks: false);
        } catch (_) {
          continue;
        }
        for (final e in children) {
          final name = p.basename(e.path);
          if (name.startsWith('.')) continue;
          if (e is Directory) {
            stack.add(e);
          } else if (e is File) {
            final ext = p.extension(name).toLowerCase();
            if (audioExtensions.contains(ext)) {
              if (!seen.add(e.path)) continue;
              try {
                final st = e.statSync();
                if (st.size < 1024) continue;
                files.add(_FileEntry(
                    e.path, st.modified.millisecondsSinceEpoch, st.size));
              } catch (_) {}
            } else if (_imageExtensions.contains(ext)) {
              images.putIfAbsent(d.path, () => []).add(e.path);
            }
          }
        }
      }
    }
    final art = <String, String>{};
    images.forEach((dir, list) {
      String? best;
      var bestRank = 1 << 30;
      for (final img in list) {
        final base = p.basenameWithoutExtension(img).toLowerCase();
        var rank = _preferredCoverNames.indexWhere((n) => base.startsWith(n));
        if (rank < 0) rank = 100 + base.length;
        if (rank < bestRank) {
          bestRank = rank;
          best = img;
        }
      }
      if (best != null) art[dir] = best;
    });
    return (files, art);
  }

  static Track _parseOne(String path, int mtime, int size, String coversDir,
      Map<String, String> folderArt, PathCodec codec) {
    final tags = TagReader.read(path);
    final base = p.basenameWithoutExtension(path);
    var title = tags.title;
    var artist = tags.artist;
    var trackNo = tags.trackNo;
    if (title == null || title.isEmpty) {
      // Déduit « 01 - Artiste - Titre » du nom de fichier.
      var name = base.replaceAll('_', ' ');
      final num = RegExp(r'^(\d{1,3})[\s.\-_)]+').firstMatch(name);
      if (num != null) {
        trackNo ??= int.tryParse(num.group(1)!);
        name = name.substring(num.end);
      }
      final parts = name.split(RegExp(r'\s+-\s+'));
      if (parts.length >= 2 && (artist == null || artist.isEmpty)) {
        artist = parts.first.trim();
        title = parts.sublist(1).join(' - ').trim();
      } else {
        title = name.trim().isEmpty ? base : name.trim();
      }
    }

    String? artPath;
    if (tags.hasPicture) {
      final album = tags.album;
      final mainArtist = (tags.albumArtist?.isNotEmpty ?? false)
          ? tags.albumArtist!
          : (artist ?? '');
      final key = (album != null && album.isNotEmpty)
          ? 'album:${mainArtist.toLowerCase()}|${album.toLowerCase()}'
          : 'file:$path';
      final ext = tags.pictureMime == 'image/png' ? 'png' : 'jpg';
      final file = File('$coversDir/${stableHash(key)}.$ext');
      try {
        if (!file.existsSync()) file.writeAsBytesSync(tags.picture!);
        artPath = file.path;
      } catch (_) {}
    }
    artPath ??= folderArt[p.dirname(path)];

    return Track(
      id: codec.encode(path),
      path: path,
      title: title,
      artist: artist,
      album: tags.album,
      albumArtist: tags.albumArtist,
      genre: tags.genre,
      year: tags.year,
      trackNo: trackNo,
      discNo: tags.discNo,
      durationMs: tags.durationMs,
      artPath: artPath,
      mtime: mtime,
      size: size,
      addedAt: 0,
    );
  }
}
