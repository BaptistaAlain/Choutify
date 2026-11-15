import 'dart:convert';
import 'dart:io';

import 'package:choutify/services/sync_core.dart';
import 'package:flutter_test/flutter_test.dart';

const _known = {'a', 'b', 'c', 'd', 'e'};

/// Simule un appareil : état local + document + base.
class _Device {
  _Device(this.id, {List<String>? likes, List<SyncPlaylistView>? playlists, Map<String, ({num count, num last})>? plays, Set<String>? known})
      : local = SyncView(likes ?? [], playlists ?? [], plays ?? {}),
        known = known ?? _known;
  final String id;
  final Set<String> known;
  SyncDoc doc = SyncDoc();
  SyncBase base = SyncBase();
  SyncView local;

  void sync(num now, [List<_Device> others = const []]) {
    var d = applyLocal(doc, base, local, known, id, now);
    for (final o in others) {
      d = mergeDocs(d, o.doc);
    }
    final p = project(d, known);
    doc = d;
    base = baseFrom(p);
    local = SyncView([...p.likes], [for (final pl in p.playlists) SyncPlaylistView(pl.id, pl.name, pl.createdAt, [...pl.keys])], {...p.plays});
  }
}

String _c(SyncDoc d) => canonicalJson(d.toJson());

void main() {
  test('fusion commutative et idempotente', () {
    final a = _Device('A', likes: ['a'], playlists: [SyncPlaylistView('p1', 'Route', 1, ['a', 'b'])])..sync(10);
    final b = _Device('B', likes: ['c'], playlists: [SyncPlaylistView('p2', 'Sport', 2, ['c'])])..sync(11);
    final ab = mergeDocs(a.doc, b.doc);
    expect(_c(mergeDocs(b.doc, a.doc)), _c(ab));
    expect(_c(mergeDocs(ab, ab)), _c(ab));
  });

  test('modifications concurrentes de la même playlist sans perte', () {
    final pc = _Device('pc', playlists: [SyncPlaylistView('p', 'Mix', 1, ['a', 'b'])])..sync(10);
    final phone = _Device('phone')..sync(11, [pc]);
    pc.local.playlists[0].keys.add('c');
    phone.local.playlists[0].keys
      ..clear()
      ..addAll(['b', 'd']);
    pc.sync(20);
    phone.sync(21);
    pc.sync(30, [phone]);
    phone.sync(31, [pc]);
    expect(pc.local.playlists[0].keys, ['b', 'c', 'd']);
    expect(phone.local.playlists[0].keys, ['b', 'c', 'd']);
  });

  test('écoutes additionnées sans double comptage', () {
    final pc = _Device('pc', plays: {'a': (count: 3, last: 100)})..sync(10);
    final phone = _Device('phone', plays: {'a': (count: 2, last: 200)})..sync(11, [pc]);
    pc.sync(12, [phone]);
    pc.sync(13, [phone]);
    expect(pc.local.plays['a'], (count: 5, last: 200));
  });

  test('garde les titres inconnus de cet appareil', () {
    final pc = _Device('pc', playlists: [SyncPlaylistView('p', 'Mix', 1, ['a', 'z'])], known: {'a', 'z'})..sync(10);
    final phone = _Device('phone', known: {'a'})..sync(11, [pc]);
    expect(phone.local.playlists[0].keys, ['a']);
    phone.sync(12, [pc]);
    pc.sync(20, [phone]);
    expect(pc.local.playlists[0].keys, ['a', 'z']);
  });

  test('keepUnsynced', () {
    bool synced(String id) => !id.startsWith('l:');
    expect(keepUnsynced(['l:1', 'a', 'l:2', 'b'], ['b', 'a', 'c'], synced), ['l:1', 'b', 'a', 'l:2', 'c']);
  });

  group('compatibilité avec l\'app web', () {
    final fx = jsonDecode(File('test/fixtures/sync_scenario.json').readAsStringSync()) as Map;

    test('mêmes clés de titres', () {
      for (final k in fx['keys'] as List) {
        expect(syncKey(k[0] as String), k[1]);
      }
    });

    test('même fusion et même projection', () {
      final docs = [for (final d in fx['docs'] as List) SyncDoc.parse(d)!];
      final merged = mergeDocs(docs[0], docs[1]);
      expect(canonicalJson(merged.toJson()), fx['merged']);
      expect(canonicalJson(mergeDocs(docs[1], docs[0]).toJson()), fx['merged']);
      final known = (fx['known'] as List).cast<String>().toSet();
      final p = project(merged, known);
      final expected = fx['projection'] as Map;
      expect(p.likes, expected['likes']);
      expect([for (final pl in p.playlists) {'id': pl.id, 'name': pl.name, 'keys': pl.keys}],
          [for (final pl in expected['playlists'] as List) {'id': pl['id'], 'name': pl['name'], 'keys': pl['keys']}]);
      expect({for (final e in p.plays.entries) e.key: [e.value.count, e.value.last]},
          {for (final e in (expected['plays'] as Map).entries) e.key: [e.value['count'], e.value['last']]});
    });
  });
}
