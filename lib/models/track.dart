import 'package:path/path.dart' as p;

const unknownArtist = 'Artiste inconnu';
const unknownAlbum = 'Album inconnu';

class Track {
  /// Identifiant stable (chemin encodé, indépendant du conteneur iOS).
  final String id;

  /// Chemin absolu du fichier.
  final String path;
  final String title;
  final String? artist;
  final String? album;
  final String? albumArtist;
  final String? genre;
  final int? year;
  final int? trackNo;
  final int? discNo;
  final int? durationMs;

  /// Chemin absolu de la pochette (cache ou image du dossier).
  final String? artPath;
  final int mtime;
  final int size;
  final int addedAt;

  const Track({
    required this.id,
    required this.path,
    required this.title,
    this.artist,
    this.album,
    this.albumArtist,
    this.genre,
    this.year,
    this.trackNo,
    this.discNo,
    this.durationMs,
    this.artPath,
    required this.mtime,
    required this.size,
    required this.addedAt,
  });

  String get displayArtist =>
      (artist == null || artist!.isEmpty) ? unknownArtist : artist!;

  String get mainArtist =>
      (albumArtist != null && albumArtist!.isNotEmpty)
          ? albumArtist!
          : displayArtist;

  bool get hasAlbum => album != null && album!.isNotEmpty;

  String get albumKey =>
      hasAlbum ? '${mainArtist.toLowerCase()}\u0001${album!.toLowerCase()}' : '';

  String get folder => p.dirname(path);

  Duration? get duration =>
      durationMs == null ? null : Duration(milliseconds: durationMs!);

  /// Liste des artistes individuels (« A feat. B, C » → [A, B, C]).
  List<String> get artistNames {
    final a = displayArtist;
    final parts = a
        .split(RegExp(r'\s*(?:,|;|/| & | feat\.? | ft\.? | featuring )\s*',
            caseSensitive: false))
        .map((s) => s.trim())
        .where((s) => s.isNotEmpty)
        .toList();
    return parts.isEmpty ? [a] : parts;
  }

  Track copyWith({String? artPath, int? addedAt}) => Track(
        id: id,
        path: path,
        title: title,
        artist: artist,
        album: album,
        albumArtist: albumArtist,
        genre: genre,
        year: year,
        trackNo: trackNo,
        discNo: discNo,
        durationMs: durationMs,
        artPath: artPath ?? this.artPath,
        mtime: mtime,
        size: size,
        addedAt: addedAt ?? this.addedAt,
      );

  Track withArt(String? art) => Track(
        id: id,
        path: path,
        title: title,
        artist: artist,
        album: album,
        albumArtist: albumArtist,
        genre: genre,
        year: year,
        trackNo: trackNo,
        discNo: discNo,
        durationMs: durationMs,
        artPath: art,
        mtime: mtime,
        size: size,
        addedAt: addedAt,
      );

  Map<String, dynamic> toJson(String Function(String) encode) => {
        'p': encode(path),
        't': title,
        if (artist != null) 'a': artist,
        if (album != null) 'al': album,
        if (albumArtist != null) 'aa': albumArtist,
        if (genre != null) 'g': genre,
        if (year != null) 'y': year,
        if (trackNo != null) 'n': trackNo,
        if (discNo != null) 'd': discNo,
        if (durationMs != null) 'ms': durationMs,
        if (artPath != null) 'art': encode(artPath!),
        'm': mtime,
        's': size,
        'ad': addedAt,
      };

  static Track fromJson(
      Map<String, dynamic> j, String Function(String) decode) {
    final encodedPath = j['p'] as String;
    return Track(
      id: encodedPath,
      path: decode(encodedPath),
      title: j['t'] as String,
      artist: j['a'] as String?,
      album: j['al'] as String?,
      albumArtist: j['aa'] as String?,
      genre: j['g'] as String?,
      year: j['y'] as int?,
      trackNo: j['n'] as int?,
      discNo: j['d'] as int?,
      durationMs: j['ms'] as int?,
      artPath: j['art'] == null ? null : decode(j['art'] as String),
      mtime: j['m'] as int,
      size: j['s'] as int,
      addedAt: j['ad'] as int,
    );
  }
}

class Album {
  final String key;
  final String title;
  final String artist;
  final List<Track> tracks;
  Album(this.key, this.title, this.artist, this.tracks);

  String? get artPath {
    for (final t in tracks) {
      if (t.artPath != null) return t.artPath;
    }
    return null;
  }

  int? get year {
    for (final t in tracks) {
      if (t.year != null) return t.year;
    }
    return null;
  }

  int get addedAt => tracks.fold(0, (m, t) => t.addedAt > m ? t.addedAt : m);

  int get durationMs => tracks.fold(0, (s, t) => s + (t.durationMs ?? 0));

  bool get isSingle => tracks.length <= 3;
}

class Artist {
  final String name;
  final List<Track> tracks;
  final List<Album> albums;
  Artist(this.name, this.tracks, this.albums);

  String? get artPath {
    for (final a in albums) {
      if (a.artPath != null) return a.artPath;
    }
    for (final t in tracks) {
      if (t.artPath != null) return t.artPath;
    }
    return null;
  }
}

class Playlist {
  final String id;
  String name;
  final List<String> trackIds;
  final int createdAt;
  int updatedAt;

  Playlist({
    required this.id,
    required this.name,
    required this.trackIds,
    required this.createdAt,
    required this.updatedAt,
  });

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'tracks': trackIds,
        'c': createdAt,
        'u': updatedAt,
      };

  static Playlist fromJson(Map<String, dynamic> j) => Playlist(
        id: j['id'] as String,
        name: j['name'] as String,
        trackIds: (j['tracks'] as List).cast<String>().toList(),
        createdAt: j['c'] as int,
        updatedAt: j['u'] as int,
      );
}
