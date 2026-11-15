import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:path/path.dart' as p;
import 'package:shared_preferences/shared_preferences.dart';

import '../models/track.dart';
import '../services/library_scanner.dart';
import '../services/paths.dart';

enum TrackSort { title, artist, album, recent, duration }

enum AlbumSort { title, artist, year, recent }

String normalize(String s) {
  const from = 'àáâãäåçèéêëìíîïñòóôõöùúûüýÿœæ';
  const to = 'aaaaaaceeeeiiiinooooouuuuyyoa';
  final lower = s.toLowerCase();
  final b = StringBuffer();
  for (final ch in lower.split('')) {
    final i = from.indexOf(ch);
    b.write(i >= 0 ? to[i] : ch);
  }
  return b.toString();
}

class SearchResults {
  final List<Track> tracks;
  final List<Album> albums;
  final List<Artist> artists;
  final List<Playlist> playlists;
  const SearchResults(this.tracks, this.albums, this.artists, this.playlists);
  bool get isEmpty =>
      tracks.isEmpty && albums.isEmpty && artists.isEmpty && playlists.isEmpty;
}

class LibraryState extends ChangeNotifier {
  LibraryState(this.codec, this.prefs);

  final PathCodec codec;
  final SharedPreferences prefs;

  List<Track> _tracks = [];
  Map<String, Track> _byId = {};
  List<Album> _albums = [];
  List<Artist> _artists = [];
  Map<String, List<Track>> _genres = {};
  Map<String, List<Track>> _folders = {};
  final Map<String, Album> _albumByKey = {};
  final Map<String, Artist> _artistByName = {};

  List<Playlist> playlists = [];
  Set<String> favorites = {};
  Map<String, int> playCounts = {};
  Map<String, int> lastPlayed = {};

  /// Appelé après chaque modification des playlists, favoris ou écoutes
  /// (synchronisation), et à la fin de chaque analyse.
  VoidCallback? onUserDataChanged;
  VoidCallback? onScanned;

  bool loaded = false;
  bool scanning = false;
  ScanProgress? progress;
  String? lastError;

  List<Track> get tracks => _tracks;
  List<Album> get albums => _albums;
  List<Artist> get artists => _artists;
  Map<String, List<Track>> get genres => _genres;
  Map<String, List<Track>> get folderGroups => _folders;
  Track? trackById(String id) => _byId[id];
  Album? albumByKey(String key) => _albumByKey[key];
  Artist? artistByName(String name) => _artistByName[name];
  bool get isEmpty => _tracks.isEmpty;

  // ----------------------------------------------------------- dossiers

  List<String> get musicFolders {
    final list = prefs.getStringList('folders') ?? [];
    return list.map(codec.decode).toList();
  }

  /// Dossiers effectivement analysés (sur iOS, le dossier Documents/Musique
  /// est toujours inclus).
  List<String> get scanRoots {
    final roots = [...musicFolders];
    if (Platform.isIOS && !roots.contains(codec.iosMusicDir)) {
      roots.add(codec.iosMusicDir);
    }
    return roots;
  }

  bool get hasFolders => Platform.isIOS || musicFolders.isNotEmpty;

  bool get needsOnboarding =>
      _tracks.isEmpty &&
      (Platform.isIOS
          ? !(prefs.getBool('onboarded') ?? false)
          : musicFolders.isEmpty);

  Future<void> markOnboarded() async {
    await prefs.setBool('onboarded', true);
    notifyListeners();
  }

  Future<void> addFolder(String path) async {
    final list = musicFolders;
    if (list.contains(path)) return;
    // Évite les dossiers imbriqués en double.
    list.removeWhere((f) => p.isWithin(path, f));
    if (list.any((f) => p.isWithin(f, path))) {
      notifyListeners();
      return;
    }
    list.add(path);
    await prefs.setStringList('folders', list.map(codec.encode).toList());
    notifyListeners();
  }

  Future<void> removeFolder(String path) async {
    final list = musicFolders..remove(path);
    await prefs.setStringList('folders', list.map(codec.encode).toList());
    notifyListeners();
    await rescan();
  }

  // ------------------------------------------------------- persistance

  File get _libraryFile => File('${codec.dataDir}/library.json');
  File get _userFile => File('${codec.dataDir}/user.json');

  Future<void> load() async {
    try {
      if (await _libraryFile.exists()) {
        final data = jsonDecode(await _libraryFile.readAsString()) as List;
        _setTracks(data
            .map((j) =>
                Track.fromJson((j as Map).cast<String, dynamic>(), codec.decode))
            .toList());
      }
    } catch (e) {
      debugPrint('Lecture de la bibliothèque impossible : $e');
    }
    try {
      if (await _userFile.exists()) {
        final j = jsonDecode(await _userFile.readAsString()) as Map;
        playlists = (j['playlists'] as List? ?? [])
            .map((e) => Playlist.fromJson((e as Map).cast<String, dynamic>()))
            .toList();
        favorites = (j['favorites'] as List? ?? []).cast<String>().toSet();
        playCounts = (j['counts'] as Map? ?? {}).cast<String, int>();
        lastPlayed = (j['last'] as Map? ?? {}).cast<String, int>();
      }
    } catch (e) {
      debugPrint('Lecture des données utilisateur impossible : $e');
    }
    loaded = true;
    notifyListeners();
  }

  Future<void> _saveLibrary() async {
    final tmp = File('${_libraryFile.path}.tmp');
    await tmp.writeAsString(
        jsonEncode(_tracks.map((t) => t.toJson(codec.encode)).toList()));
    await tmp.rename(_libraryFile.path);
  }

  Timer? _saveUserTimer;
  void _saveUserSoon() {
    onUserDataChanged?.call();
    _saveUserTimer?.cancel();
    _saveUserTimer = Timer(const Duration(milliseconds: 600), _saveUser);
  }

  Future<void> _saveUser() async {
    final tmp = File('${_userFile.path}.tmp');
    await tmp.writeAsString(jsonEncode({
      'playlists': playlists.map((e) => e.toJson()).toList(),
      'favorites': favorites.toList(),
      'counts': playCounts,
      'last': lastPlayed,
    }));
    await tmp.rename(_userFile.path);
  }

  // ------------------------------------------------------------ analyse

  Future<void> rescan({bool full = false}) async {
    if (scanning) return;
    scanning = true;
    lastError = null;
    progress = null;
    notifyListeners();
    try {
      if (full) {
        final dir = Directory(codec.coversDir);
        if (await dir.exists()) {
          await for (final f in dir.list()) {
            try {
              await f.delete();
            } catch (_) {}
          }
        }
      }
      final previous = full
          ? {for (final t in _tracks) t.id: t.withArt(null).copyWith()}
          : _byId;
      var result = await LibraryScanner.scan(
        folders: scanRoots,
        previous: full ? <String, Track>{} : previous,
        codec: codec,
        onProgress: (pr) {
          progress = pr;
          notifyListeners();
        },
      );
      if (full) {
        // Conserve la date d'ajout d'origine.
        result = result
            .map((t) => previous[t.id] == null
                ? t
                : t.copyWith(addedAt: previous[t.id]!.addedAt))
            .toList();
      }
      _setTracks(result);
      await _saveLibrary();
      onScanned?.call();
    } catch (e) {
      lastError = '$e';
    } finally {
      scanning = false;
      progress = null;
      notifyListeners();
    }
  }

  void _setTracks(List<Track> list) {
    list.sort((a, b) => normalize(a.title).compareTo(normalize(b.title)));
    _tracks = list;
    _byId = {for (final t in list) t.id: t};

    final albumMap = <String, List<Track>>{};
    final artistTracks = <String, List<Track>>{};
    final genreMap = <String, List<Track>>{};
    final folderMap = <String, List<Track>>{};
    final displayName = <String, String>{};
    for (final t in list) {
      if (t.hasAlbum) albumMap.putIfAbsent(t.albumKey, () => []).add(t);
      final names = {t.mainArtist, ...t.artistNames};
      for (final n in names) {
        final k = n.toLowerCase();
        displayName.putIfAbsent(k, () => n);
        artistTracks.putIfAbsent(k, () => []).add(t);
      }
      if (t.genre != null && t.genre!.isNotEmpty) {
        genreMap.putIfAbsent(t.genre!, () => []).add(t);
      }
      folderMap.putIfAbsent(t.folder, () => []).add(t);
    }

    _albumByKey.clear();
    _albums = albumMap.entries.map((e) {
      final ts = e.value
        ..sort((a, b) {
          final d = (a.discNo ?? 1).compareTo(b.discNo ?? 1);
          if (d != 0) return d;
          final n = (a.trackNo ?? 9999).compareTo(b.trackNo ?? 9999);
          if (n != 0) return n;
          return a.title.compareTo(b.title);
        });
      final album = Album(e.key, ts.first.album!, ts.first.mainArtist, ts);
      _albumByKey[e.key] = album;
      return album;
    }).toList()
      ..sort((a, b) => normalize(a.title).compareTo(normalize(b.title)));

    _artistByName.clear();
    _artists = artistTracks.entries.map((e) {
      final name = displayName[e.key]!;
      final albs = _albums
          .where((a) => a.artist.toLowerCase() == e.key)
          .toList()
        ..sort((a, b) => (b.year ?? 0).compareTo(a.year ?? 0));
      final artist = Artist(name, e.value, albs);
      _artistByName[name] = artist;
      return artist;
    }).toList()
      ..sort((a, b) {
        if (a.name == unknownArtist) return 1;
        if (b.name == unknownArtist) return -1;
        return normalize(a.name).compareTo(normalize(b.name));
      });

    _genres = Map.fromEntries(genreMap.entries.toList()
      ..sort((a, b) => normalize(a.key).compareTo(normalize(b.key))));
    _folders = Map.fromEntries(folderMap.entries.toList()
      ..sort((a, b) => normalize(p.basename(a.key))
          .compareTo(normalize(p.basename(b.key)))));
    for (final f in _folders.values) {
      f.sort((a, b) => p.basename(a.path).compareTo(p.basename(b.path)));
    }
  }

  // ------------------------------------------------------------- tris

  List<Track> sortedTracks(TrackSort sort) {
    final l = [..._tracks];
    switch (sort) {
      case TrackSort.title:
        break;
      case TrackSort.artist:
        l.sort((a, b) =>
            normalize(a.displayArtist).compareTo(normalize(b.displayArtist)));
      case TrackSort.album:
        l.sort((a, b) =>
            normalize(a.album ?? '~').compareTo(normalize(b.album ?? '~')));
      case TrackSort.recent:
        l.sort((a, b) => b.addedAt.compareTo(a.addedAt));
      case TrackSort.duration:
        l.sort((a, b) => (b.durationMs ?? 0).compareTo(a.durationMs ?? 0));
    }
    return l;
  }

  List<Album> sortedAlbums(AlbumSort sort) {
    final l = [..._albums];
    switch (sort) {
      case AlbumSort.title:
        break;
      case AlbumSort.artist:
        l.sort((a, b) => normalize(a.artist).compareTo(normalize(b.artist)));
      case AlbumSort.year:
        l.sort((a, b) => (b.year ?? 0).compareTo(a.year ?? 0));
      case AlbumSort.recent:
        l.sort((a, b) => b.addedAt.compareTo(a.addedAt));
    }
    return l;
  }

  // ------------------------------------------------------- accueil

  List<Album> get recentlyAddedAlbums {
    final l = [..._albums]..sort((a, b) => b.addedAt.compareTo(a.addedAt));
    return l.take(20).toList();
  }

  List<Track> get recentlyPlayed {
    final ids = lastPlayed.entries.toList()
      ..sort((a, b) => b.value.compareTo(a.value));
    return ids
        .map((e) => _byId[e.key])
        .whereType<Track>()
        .take(30)
        .toList();
  }

  /// Albums (ou titres sans album) récemment écoutés, sans doublon.
  List<Object> get recentlyPlayedItems {
    final out = <Object>[];
    final seen = <String>{};
    for (final t in recentlyPlayed) {
      final key = t.hasAlbum ? t.albumKey : t.id;
      if (!seen.add(key)) continue;
      out.add(t.hasAlbum ? (_albumByKey[t.albumKey] ?? t) : t);
      if (out.length >= 8) break;
    }
    return out;
  }

  List<Track> get mostPlayed {
    final ids = playCounts.entries.toList()
      ..sort((a, b) => b.value.compareTo(a.value));
    return ids
        .map((e) => _byId[e.key])
        .whereType<Track>()
        .take(25)
        .toList();
  }

  List<Artist> get topArtists {
    final score = <String, int>{};
    for (final e in playCounts.entries) {
      final t = _byId[e.key];
      if (t == null) continue;
      score[t.mainArtist] = (score[t.mainArtist] ?? 0) + e.value;
    }
    final l = _artists.where((a) => a.name != unknownArtist).toList()
      ..sort((a, b) {
        final s = (score[b.name] ?? 0).compareTo(score[a.name] ?? 0);
        return s != 0 ? s : b.tracks.length.compareTo(a.tracks.length);
      });
    return l.take(12).toList();
  }

  List<Album> discoverAlbums(int seed) {
    final l = _albums
        .where((a) => (playCounts.keys.toSet()
            .intersection(a.tracks.map((t) => t.id).toSet())
            .isEmpty))
        .toList();
    final source = l.length >= 4 ? l : [..._albums];
    source.shuffle(Random(seed));
    return source.take(12).toList();
  }

  // --------------------------------------------------- statistiques

  void recordPlay(Track t) {
    playCounts[t.id] = (playCounts[t.id] ?? 0) + 1;
    lastPlayed[t.id] = DateTime.now().millisecondsSinceEpoch;
    _saveUserSoon();
    notifyListeners();
  }

  // ------------------------------------------------------- favoris

  bool isFavorite(Track t) => favorites.contains(t.id);

  void toggleFavorite(Track t) {
    if (!favorites.remove(t.id)) favorites.add(t.id);
    _saveUserSoon();
    notifyListeners();
  }

  List<Track> get favoriteTracks =>
      favorites.map((id) => _byId[id]).whereType<Track>().toList().reversed.toList();

  // ----------------------------------------------------- playlists

  Playlist? playlistById(String id) {
    for (final pl in playlists) {
      if (pl.id == id) return pl;
    }
    return null;
  }

  List<Track> playlistTracks(Playlist pl) =>
      pl.trackIds.map((id) => _byId[id]).whereType<Track>().toList();

  Playlist createPlaylist(String name, [List<Track> initial = const []]) {
    final now = DateTime.now().millisecondsSinceEpoch;
    final pl = Playlist(
      id: 'pl_$now${Random().nextInt(9999)}',
      name: name,
      trackIds: initial.map((t) => t.id).toList(),
      createdAt: now,
      updatedAt: now,
    );
    playlists.insert(0, pl);
    _saveUserSoon();
    notifyListeners();
    return pl;
  }

  void renamePlaylist(Playlist pl, String name) {
    pl.name = name;
    pl.updatedAt = DateTime.now().millisecondsSinceEpoch;
    _saveUserSoon();
    notifyListeners();
  }

  void deletePlaylist(Playlist pl) {
    playlists.remove(pl);
    _saveUserSoon();
    notifyListeners();
  }

  /// Ajoute des titres ; renvoie le nombre réellement ajoutés.
  int addToPlaylist(Playlist pl, List<Track> tracks) {
    var n = 0;
    for (final t in tracks) {
      if (!pl.trackIds.contains(t.id)) {
        pl.trackIds.add(t.id);
        n++;
      }
    }
    pl.updatedAt = DateTime.now().millisecondsSinceEpoch;
    _saveUserSoon();
    notifyListeners();
    return n;
  }

  void removeFromPlaylist(Playlist pl, int index) {
    pl.trackIds.removeAt(index);
    pl.updatedAt = DateTime.now().millisecondsSinceEpoch;
    _saveUserSoon();
    notifyListeners();
  }

  /// Remplace les playlists, favoris et écoutes par ceux issus de la
  /// synchronisation, sans relancer de synchronisation.
  Future<void> applySync({
    required List<Playlist> playlists,
    required Set<String> favorites,
    required Map<String, int> playCounts,
    required Map<String, int> lastPlayed,
  }) async {
    this.playlists = playlists;
    this.favorites = favorites;
    this.playCounts = playCounts;
    this.lastPlayed = lastPlayed;
    notifyListeners();
    _saveUserTimer?.cancel();
    await _saveUser();
  }

  void movePlaylistItem(Playlist pl, int from, int to) {
    final id = pl.trackIds.removeAt(from);
    pl.trackIds.insert(to, id);
    _saveUserSoon();
    notifyListeners();
  }

  List<String?> playlistArt(Playlist pl) {
    final arts = <String>[];
    for (final t in playlistTracks(pl)) {
      if (t.artPath != null && !arts.contains(t.artPath)) arts.add(t.artPath!);
      if (arts.length == 4) break;
    }
    return arts;
  }

  // -------------------------------------------------------- recherche

  SearchResults search(String query) {
    final q = normalize(query.trim());
    if (q.isEmpty) return const SearchResults([], [], [], []);
    final words = q.split(RegExp(r'\s+'));
    bool match(String s) {
      final n = normalize(s);
      return words.every(n.contains);
    }

    final tracks = _tracks
        .where((t) => match('${t.title} ${t.displayArtist} ${t.album ?? ''}'))
        .take(60)
        .toList();
    final albums =
        _albums.where((a) => match('${a.title} ${a.artist}')).take(20).toList();
    final artists = _artists.where((a) => match(a.name)).take(20).toList();
    final pls = playlists.where((pl) => match(pl.name)).toList();
    // Les correspondances au début du titre en premier.
    tracks.sort((a, b) {
      final sa = normalize(a.title).startsWith(q) ? 0 : 1;
      final sb = normalize(b.title).startsWith(q) ? 0 : 1;
      return sa.compareTo(sb);
    });
    return SearchResults(tracks, albums, artists, pls);
  }
}
