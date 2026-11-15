import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:path/path.dart' as p;
import 'package:shared_preferences/shared_preferences.dart';

import '../models/track.dart';
import '../state/library_state.dart';
import 'sync_core.dart';

class SyncDevice {
  final String name;
  final DateTime updated;
  const SyncDevice(this.name, this.updated);
}

/// Synchronise les playlists, titres aimés et écoutes avec l'app web
/// (iPhone) via le dossier « Choutify-synchro » de Google Drive, que
/// « Google Drive pour ordinateur » rend accessible comme un dossier local.
/// Disponible sur Windows uniquement.
class SyncService extends ChangeNotifier {
  SyncService(this.library, this.prefs);

  final LibraryState library;
  final SharedPreferences prefs;

  static bool get supported => Platform.isWindows || debugEnabled;

  @visibleForTesting
  static bool debugEnabled = false;

  Directory? folder;
  DateTime? last;
  String? error;
  bool running = false;
  List<SyncDevice> devices = [];

  late final String deviceId = _deviceId();
  SyncDoc _doc = SyncDoc();
  SyncBase _base = SyncBase();
  String? _written;
  Timer? _soon;
  Timer? _periodic;
  bool _again = false;

  String _deviceId() {
    var id = prefs.getString('sync.device');
    if (id == null) {
      final r = Random.secure();
      id = List.generate(10, (_) => 'abcdefghijklmnopqrstuvwxyz0123456789'[r.nextInt(36)]).join();
      prefs.setString('sync.device', id);
    }
    return id;
  }

  File get _stateFile => File(p.join(library.codec.dataDir, 'sync.json'));
  String get _ownName => 'windows-$deviceId.json';

  Future<void> start() async {
    if (!supported) return;
    try {
      if (await _stateFile.exists()) {
        final j = jsonDecode(await _stateFile.readAsString()) as Map;
        _doc = SyncDoc.parse(j['doc']) ?? SyncDoc();
        _base = SyncBase.fromJson(j['base'] as Map? ?? {});
        _written = j['written'] as String?;
        final l = j['last'];
        if (l is int) last = DateTime.fromMillisecondsSinceEpoch(l);
      }
    } catch (e) {
      debugPrint('État de synchronisation illisible : $e');
    }
    library.onUserDataChanged = () => syncSoon(const Duration(seconds: 5));
    library.onScanned = () {
      _lastDeepSearch = null;
      syncSoon(const Duration(milliseconds: 500));
    };
    _periodic = Timer.periodic(const Duration(seconds: 90), (_) => syncNow());
    syncSoon(const Duration(seconds: 2));
  }

  @override
  void dispose() {
    _soon?.cancel();
    _periodic?.cancel();
    super.dispose();
  }

  void syncSoon(Duration d) {
    if (!supported) return;
    _soon?.cancel();
    _soon = Timer(d, syncNow);
  }

  // ------------------------------------------------------------ dossier

  DateTime? _lastDeepSearch;

  /// Cherche « Choutify-synchro » dans les dossiers de musique, leurs
  /// dossiers parents et (au plus toutes les 10 minutes, car c'est plus
  /// long) leurs sous-dossiers sur 3 niveaux.
  Future<Directory?> _locate() async {
    final roots = library.scanRoots;
    for (final r in roots) {
      final d = Directory(p.join(r, syncDirName));
      if (await d.exists()) return d;
    }
    for (final r in roots) {
      var d = Directory(r).parent;
      while (true) {
        final c = Directory(p.join(d.path, syncDirName));
        if (await c.exists()) return c;
        if (d.parent.path == d.path) break;
        d = d.parent;
      }
    }
    final last = _lastDeepSearch;
    if (last != null && DateTime.now().difference(last).inMinutes < 10) return null;
    _lastDeepSearch = DateTime.now();
    for (final r in roots) {
      final found = await _searchDown(Directory(r), 3);
      if (found != null) return found;
    }
    return null;
  }

  Future<Directory?> _searchDown(Directory dir, int depth) async {
    if (depth == 0) return null;
    final subs = <Directory>[];
    try {
      await for (final e in dir.list(followLinks: false)) {
        if (e is Directory) {
          if (p.basename(e.path) == syncDirName) return e;
          subs.add(e);
        }
      }
    } catch (_) {
      return null;
    }
    for (final s in subs) {
      final f = await _searchDown(s, depth - 1);
      if (f != null) return f;
    }
    return null;
  }

  /// Crée le dossier de synchronisation dans le premier dossier de musique.
  Future<void> createFolder() async {
    final roots = library.musicFolders;
    if (roots.isEmpty) return;
    final d = Directory(p.join(roots.first, syncDirName));
    await d.create(recursive: true);
    folder = d;
    notifyListeners();
    await syncNow();
  }

  String? _keyOf(Track t, String baseDir) {
    if (!p.isWithin(baseDir, t.path)) return null;
    return syncKey(p.relative(t.path, from: baseDir));
  }

  // ------------------------------------------------------------ synchro

  Future<void> syncNow() async {
    if (!supported || !library.loaded) return;
    if (running) {
      _again = true;
      return;
    }
    running = true;
    notifyListeners();
    try {
      await _sync();
      error = null;
    } catch (e) {
      error = '$e';
      debugPrint('Synchronisation impossible : $e');
    } finally {
      running = false;
      notifyListeners();
      if (_again) {
        _again = false;
        syncSoon(const Duration(milliseconds: 200));
      }
    }
  }

  Future<void> _sync() async {
    final dir = (folder != null && await folder!.exists()) ? folder : await _locate();
    folder = dir;
    if (dir == null) return;
    final baseDir = dir.parent.path;

    // 1. Lecture des fichiers de tous les appareils.
    final remotes = <SyncDoc>[];
    final devs = <SyncDevice>[];
    await for (final f in dir.list(followLinks: false)) {
      if (f is! File || !f.path.toLowerCase().endsWith('.json')) continue;
      try {
        final doc = SyncDoc.parse(jsonDecode(await f.readAsString()));
        if (doc == null) continue;
        remotes.add(doc);
        if (p.basename(f.path) != _ownName && doc.deviceName != null && doc.deviceUpdated != null) {
          devs.add(SyncDevice(doc.deviceName!, DateTime.fromMillisecondsSinceEpoch(doc.deviceUpdated!.toInt())));
        }
      } catch (_) {
        // Fichier en cours de téléchargement par Google Drive : relu plus tard.
      }
    }

    // 2. Fusion (sans attente : aucune modification ne peut s'intercaler).
    final now = DateTime.now().millisecondsSinceEpoch;
    final keyById = <String, String>{};
    final idByKey = <String, String>{};
    for (final t in library.tracks) {
      final k = _keyOf(t, baseDir);
      if (k == null) continue;
      keyById[t.id] = k;
      idByKey.putIfAbsent(k, () => t.id);
    }
    final known = idByKey.keys.toSet();
    List<String> toKeys(Iterable<String> ids) => [
          for (final id in ids)
            if (keyById[id] != null) keyById[id]!
        ];
    final plays = <String, ({num count, num last})>{};
    for (final e in library.playCounts.entries) {
      final k = keyById[e.key];
      if (k != null && idByKey[k] == e.key) {
        plays[k] = (count: e.value, last: library.lastPlayed[e.key] ?? 0);
      }
    }
    final view = SyncView(
      toKeys(library.favorites),
      [for (final pl in library.playlists) SyncPlaylistView(pl.id, pl.name, pl.createdAt, toKeys(pl.trackIds))],
      plays,
    );
    var doc = applyLocal(_doc, _base, view, known, deviceId, now);
    for (final r in remotes) {
      doc = mergeDocs(doc, r);
    }
    final proj = project(doc, known);
    bool synced(String id) => keyById.containsKey(id);

    final favorites = <String>{
      ...library.favorites.where((id) => !synced(id)),
      for (final k in proj.likes) idByKey[k]!,
    };
    final oldById = {for (final pl in library.playlists) pl.id: pl};
    var changed = false;
    final playlists = <Playlist>[];
    for (final pp in proj.playlists.reversed) {
      final old = oldById[pp.id];
      final ids = [for (final k in pp.keys) idByKey[k]!];
      final trackIds = old == null ? ids : keepUnsynced(old.trackIds, ids, synced);
      if (old != null && old.name == pp.name && listEquals(old.trackIds, trackIds)) {
        playlists.add(old);
        continue;
      }
      changed = true;
      playlists.add(Playlist(
        id: pp.id,
        name: pp.name,
        trackIds: trackIds,
        createdAt: old?.createdAt ?? pp.createdAt.toInt(),
        updatedAt: now,
      ));
    }
    if (playlists.length != library.playlists.length) changed = true;
    final counts = {...library.playCounts};
    final lastPlayed = {...library.lastPlayed};
    for (final e in proj.plays.entries) {
      final id = idByKey[e.key]!;
      final c = e.value.count.toInt();
      final l = e.value.last.toInt();
      if (counts[id] != c) {
        counts[id] = c;
        changed = true;
      }
      if (l != 0 && lastPlayed[id] != l) {
        lastPlayed[id] = l;
        changed = true;
      }
    }
    if (!listEquals(favorites.toList(), library.favorites.toList())) changed = true;
    if (changed) {
      await library.applySync(
        playlists: playlists,
        favorites: favorites,
        playCounts: counts,
        lastPlayed: lastPlayed,
      );
    }
    _doc = doc;
    _base = baseFrom(proj);

    // 3. Écriture de notre fichier si quelque chose a changé.
    final body = canonicalJson(doc.toJson());
    final own = File(p.join(dir.path, _ownName));
    if (body != _written || !await own.exists()) {
      final content = canonicalJson(doc.toJson(deviceId: deviceId, name: _deviceName(), updated: now));
      await own.writeAsString(content, flush: true);
      _written = body;
    }
    last = DateTime.fromMillisecondsSinceEpoch(now);
    devices = devs;
    await _saveState();
  }

  String _deviceName() {
    final host = Platform.localHostname;
    return host.isEmpty ? 'PC Windows' : 'PC Windows ($host)';
  }

  Future<void> _saveState() async {
    final tmp = File('${_stateFile.path}.tmp');
    await tmp.writeAsString(jsonEncode({
      'doc': _doc.toJson(),
      'base': _base.toJson(),
      'written': _written,
      'last': last?.millisecondsSinceEpoch,
    }));
    await tmp.rename(_stateFile.path);
  }
}
