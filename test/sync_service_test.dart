import 'dart:convert';
import 'dart:io';

import 'package:choutify/models/track.dart';
import 'package:choutify/services/paths.dart';
import 'package:choutify/services/sync_core.dart';
import 'package:choutify/services/sync_service.dart';
import 'package:choutify/state/library_state.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  late Directory tmp;
  late String music;
  late LibraryState lib;
  late SyncService sync;

  setUp(() async {
    SyncService.debugEnabled = true;
    tmp = await Directory.systemTemp.createTemp('choutify_sync');
    music = p.join(tmp.path, 'Mon Drive', 'Musique');
    final data = p.join(tmp.path, 'support');
    await Directory(p.join(data, 'data')).create(recursive: true);
    Map<String, dynamic> track(String rel, String title) => Track(
          id: '',
          path: p.join(music, rel),
          title: title,
          mtime: 0,
          size: 1,
          addedAt: 0,
        ).toJson((s) => s);
    await File(p.join(data, 'data', 'library.json')).writeAsString(jsonEncode([
      track('Noir Désir/01 - Le Vent.mp3', 'Le Vent'),
      track('Noir Désir/02 - Tostaky.mp3', 'Tostaky'),
      track('Daft Punk/One More Time.mp3', 'One More Time'),
    ]));
    SharedPreferences.setMockInitialValues({'folders': [music]});
    final prefs = await SharedPreferences.getInstance();
    lib = LibraryState(PathCodec(p.join(tmp.path, 'docs'), data), prefs);
    await lib.load();
    sync = SyncService(lib, prefs);
  });

  tearDown(() async {
    sync.dispose();
    await tmp.delete(recursive: true);
  });

  test('récupère les playlists de l\'iPhone et écrit son propre fichier', () async {
    final dir = Directory(p.join(music, syncDirName))..createSync(recursive: true);
    // Fichier écrit par l'app web (clés : chemins relatifs normalisés).
    await File(p.join(dir.path, 'web-iphone1.json')).writeAsString(jsonEncode({
      'format': 'choutify-sync',
      'v': 1,
      'device': {'id': 'iphone1', 'name': 'iPhone', 'updated': 1000},
      'likes': {
        'daft punk/one more time.mp3': [1, 900],
      },
      'playlists': {
        'plweb': {
          'name': 'Route',
          'nt': 800,
          'c': 800,
          'del': 0,
          'items': {
            'noir desir/02 - tostaky.mp3': {'on': 1, 't': 800, 'pos': 0, 'pt': 800},
            'noir desir/01 - le vent.mp3': {'on': 1, 't': 800, 'pos': 1, 'pt': 800},
            'inconnu/absent.mp3': {'on': 1, 't': 800, 'pos': 2, 'pt': 800},
          },
        },
      },
      'plays': {
        'noir desir/01 - le vent.mp3': {
          'iphone1': [4, 950],
        },
      },
    }));
    // Playlist créée sur le PC avant la synchro.
    final vent = lib.tracks.firstWhere((t) => t.title == 'Le Vent');
    final daft = lib.tracks.firstWhere((t) => t.title == 'One More Time');
    lib.createPlaylist('PC', [daft]);
    lib.recordPlay(vent);

    await sync.syncNow();
    expect(sync.error, isNull);
    expect(sync.folder?.path, dir.path);

    final names = lib.playlists.map((pl) => pl.name).toList();
    expect(names, containsAll(['PC', 'Route']));
    final route = lib.playlists.firstWhere((pl) => pl.name == 'Route');
    expect(lib.playlistTracks(route).map((t) => t.title), ['Tostaky', 'Le Vent']);
    expect(lib.isFavorite(daft), isTrue);
    expect(lib.playCounts[vent.id], 5);
    expect(sync.devices.single.name, 'iPhone');

    final own = dir.listSync().whereType<File>().where((f) => p.basename(f.path).startsWith('windows-')).single;
    final doc = SyncDoc.parse(jsonDecode(own.readAsStringSync()))!;
    final pcList = doc.playlists.values.firstWhere((pl) => pl.name == 'PC');
    expect(pcList.items.keys, ['daft punk/one more time.mp3']);
    // Le titre absent du PC reste dans la playlist partagée.
    expect(doc.playlists['plweb']!.items.containsKey('inconnu/absent.mp3'), isTrue);
    expect(doc.plays['noir desir/01 - le vent.mp3']!.values.map((v) => v[0]).fold<num>(0, (a, b) => a + b), 5);

    // Sans changement, le fichier n'est pas réécrit.
    final before = own.lastModifiedSync();
    await Future<void>.delayed(const Duration(milliseconds: 20));
    await sync.syncNow();
    expect(own.lastModifiedSync(), before);

    // Retrait d'un titre sur le PC : inscrit dans le fichier.
    lib.removeFromPlaylist(route, 0);
    await sync.syncNow();
    final doc2 = SyncDoc.parse(jsonDecode(own.readAsStringSync()))!;
    expect(doc2.playlists['plweb']!.items['noir desir/02 - tostaky.mp3']!.on, 0);
  });

  test('sans dossier de synchronisation, ne fait rien', () async {
    await Directory(music).create(recursive: true);
    await sync.syncNow();
    expect(sync.folder, isNull);
    expect(sync.error, isNull);
    await sync.createFolder();
    expect(Directory(p.join(music, syncDirName)).existsSync(), isTrue);
  });
}
