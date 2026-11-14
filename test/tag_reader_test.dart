import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:choutify/services/library_scanner.dart';
import 'package:choutify/services/paths.dart';
import 'package:choutify/services/tag_reader.dart';
import 'package:choutify/services/update_service.dart';
import 'package:flutter_test/flutter_test.dart';

List<int> _be32(int v) => [(v >> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255];
List<int> _le32(int v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >> 24) & 255];
List<int> _syncsafe(int v) => [(v >> 21) & 127, (v >> 14) & 127, (v >> 7) & 127, v & 127];

List<int> _frame(String id, List<int> data, int major) => [
      ...ascii.encode(id),
      ...(major == 4 ? _syncsafe(data.length) : _be32(data.length)),
      0, 0,
      ...data,
    ];

List<int> _text(String s, {int enc = 3}) {
  if (enc == 1) {
    final units = <int>[0xFF, 0xFE];
    for (final c in s.codeUnits) {
      units..add(c & 255)..add(c >> 8);
    }
    return [1, ...units];
  }
  return [enc, ...(enc == 0 ? latin1.encode(s) : utf8.encode(s))];
}

final _fakeJpeg = Uint8List.fromList([0xFF, 0xD8, 0xFF, 0xE0, ...List.filled(200, 7), 0xFF, 0xD9]);

/// Trame MPEG1 Layer III 128 kbit/s 44,1 kHz stéréo (417 octets), avec un
/// en-tête Xing annonçant [frames] trames.
List<int> _mpegFrames({int? xingFrames, int count = 3}) {
  const header = [0xFF, 0xFB, 0x90, 0x00];
  const len = 417;
  final out = <int>[];
  for (var i = 0; i < count; i++) {
    final f = List<int>.filled(len, 0);
    f.setRange(0, 4, header);
    if (i == 0 && xingFrames != null) {
      f.setRange(36, 40, ascii.encode('Xing'));
      f.setRange(40, 44, _be32(1));
      f.setRange(44, 48, _be32(xingFrames));
    }
    out.addAll(f);
  }
  return out;
}

List<int> _id3(int major, List<List<int>> frames) {
  final body = frames.expand((f) => f).toList()..addAll(List.filled(64, 0));
  return [...ascii.encode('ID3'), major, 0, 0, ..._syncsafe(body.length), ...body];
}

void main() {
  late Directory tmp;
  setUp(() => tmp = Directory.systemTemp.createTempSync('choutify_test'));
  tearDown(() => tmp.deleteSync(recursive: true));

  File write(String name, List<int> bytes) =>
      File('${tmp.path}/$name')..writeAsBytesSync(bytes);

  test('ID3v2.3 : tags UTF-16, pochette et durée Xing', () {
    final apic = [0, ...ascii.encode('image/jpeg'), 0, 3, ...ascii.encode('cover'), 0, ..._fakeJpeg];
    final f = write('a.mp3', [
      ..._id3(3, [
        _frame('TIT2', _text('Été indien', enc: 1), 3),
        _frame('TPE1', _text('Joe Dassin', enc: 1), 3),
        _frame('TALB', _text('Joe Dassin (Le Costume Blanc)', enc: 0), 3),
        _frame('TRCK', _text('3/12', enc: 0), 3),
        _frame('TYER', _text('1975', enc: 0), 3),
        _frame('TCON', _text('(13)', enc: 0), 3),
        _frame('APIC', apic, 3),
      ]),
      ..._mpegFrames(xingFrames: 10000),
    ]);
    final t = TagReader.read(f.path);
    expect(t.title, 'Été indien');
    expect(t.artist, 'Joe Dassin');
    expect(t.album, 'Joe Dassin (Le Costume Blanc)');
    expect(t.trackNo, 3);
    expect(t.year, 1975);
    expect(t.genre, 'Pop');
    expect(t.hasPicture, isTrue);
    expect(t.picture!.length, _fakeJpeg.length);
    expect(t.pictureMime, 'image/jpeg');
    // 10000 trames × 1152 échantillons / 44100 Hz ≈ 261,2 s
    expect(t.durationMs, closeTo(261224, 5));
  });

  test('ID3v2.4 : UTF-8, valeurs multiples, durée à débit constant', () {
    final audio = _mpegFrames(count: 200);
    final f = write('b.mp3', [
      ..._id3(4, [
        _frame('TIT2', _text('Démo'), 4),
        _frame('TPE1', _text('Artiste A\u0000Artiste B'), 4),
        _frame('TPE2', _text('Compilation'), 4),
        _frame('TDRC', _text('2021-05-01'), 4),
      ]),
      ...audio,
    ]);
    final t = TagReader.read(f.path);
    expect(t.title, 'Démo');
    expect(t.artist, 'Artiste A, Artiste B');
    expect(t.albumArtist, 'Compilation');
    expect(t.year, 2021);
    // 200 × 417 octets à 128 kbit/s ≈ 5,2 s
    expect(t.durationMs, closeTo(audio.length * 8 / 128, 2));
  });

  test('ID3v1 seul', () {
    final tag = List<int>.filled(128, 0);
    tag.setRange(0, 3, ascii.encode('TAG'));
    tag.setRange(3, 8, ascii.encode('Titre'));
    tag.setRange(33, 40, ascii.encode('Artiste'));
    tag.setRange(63, 68, ascii.encode('Album'));
    tag.setRange(93, 97, ascii.encode('1999'));
    tag[126] = 7;
    tag[127] = 17;
    final f = write('c.mp3', [..._mpegFrames(count: 5), ...tag]);
    final t = TagReader.read(f.path);
    expect(t.title, 'Titre');
    expect(t.artist, 'Artiste');
    expect(t.album, 'Album');
    expect(t.year, 1999);
    expect(t.trackNo, 7);
    expect(t.genre, 'Rock');
  });

  test('FLAC : commentaires Vorbis, image et durée', () {
    final si = List<int>.filled(34, 0);
    // 44100 Hz, 2 canaux, 16 bits, 441000 échantillons (10 s)
    const sr = 44100;
    si[10] = (sr >> 12) & 255;
    si[11] = (sr >> 4) & 255;
    si[12] = ((sr & 15) << 4) | (1 << 1);
    const total = 441000;
    si[13] = 0xF0 | ((total >> 32) & 15);
    si.setRange(14, 18, _be32(total & 0xFFFFFFFF));
    List<int> comment(String s) => [..._le32(utf8.encode(s).length), ...utf8.encode(s)];
    final vc = [
      ..._le32(3), ...ascii.encode('ref'),
      ..._le32(3),
      ...comment('TITLE=Chanson'),
      ...comment('ARTIST=Groupe'),
      ...comment('TRACKNUMBER=2'),
    ];
    final pic = [
      ..._be32(3), ..._be32(10), ...ascii.encode('image/jpeg'), ..._be32(0),
      ..._be32(1), ..._be32(1), ..._be32(24), ..._be32(0),
      ..._be32(_fakeJpeg.length), ..._fakeJpeg,
    ];
    List<int> block(int type, List<int> data, {bool last = false}) =>
        [(last ? 0x80 : 0) | type, (data.length >> 16) & 255, (data.length >> 8) & 255, data.length & 255, ...data];
    final f = write('d.flac', [
      ...ascii.encode('fLaC'),
      ...block(0, si),
      ...block(4, vc),
      ...block(6, pic, last: true),
      ...List.filled(2000, 0),
    ]);
    final t = TagReader.read(f.path);
    expect(t.title, 'Chanson');
    expect(t.artist, 'Groupe');
    expect(t.trackNo, 2);
    expect(t.durationMs, 10000);
    expect(t.hasPicture, isTrue);
  });

  test('Fichier corrompu : aucune exception', () {
    final f = write('e.mp3', [...ascii.encode('ID3'), 3, 0, 0, 0x7F, 0x7F, 0x7F, 0x7F, 1, 2, 3]);
    expect(() => TagReader.read(f.path), returnsNormally);
  });

  test('Analyse : pochette intégrée, image du dossier et nom de fichier', () async {
    final album = Directory('${tmp.path}/music/Album A')..createSync(recursive: true);
    final single = Directory('${tmp.path}/music/Singles')..createSync(recursive: true);
    final apic = [0, ...ascii.encode('image/jpeg'), 0, 3, 0, ..._fakeJpeg];
    File('${album.path}/01.mp3').writeAsBytesSync([
      ..._id3(3, [
        _frame('TIT2', _text('Un', enc: 0), 3),
        _frame('TPE1', _text('Moi', enc: 0), 3),
        _frame('TALB', _text('Album A', enc: 0), 3),
        _frame('APIC', apic, 3),
      ]),
      ..._mpegFrames(count: 10),
    ]);
    File('${single.path}/05 - Quelqu\'un - Mon single.mp3').writeAsBytesSync(_mpegFrames(count: 10));
    File('${single.path}/cover.jpg').writeAsBytesSync(_fakeJpeg);

    final codec = PathCodec('${tmp.path}/docs', '${tmp.path}/support');
    Directory(codec.coversDir).createSync(recursive: true);
    final tracks = await LibraryScanner.scan(
      folders: ['${tmp.path}/music'],
      previous: {},
      codec: codec,
    );
    expect(tracks, hasLength(2));
    final a = tracks.firstWhere((t) => t.title == 'Un');
    expect(a.artPath, startsWith(codec.coversDir));
    expect(File(a.artPath!).existsSync(), isTrue);
    final s = tracks.firstWhere((t) => t.title == 'Mon single');
    expect(s.artist, 'Quelqu\'un');
    expect(s.trackNo, 5);
    expect(s.artPath, endsWith('cover.jpg'));

    // Une seconde analyse réutilise le cache.
    final again = await LibraryScanner.scan(
      folders: ['${tmp.path}/music'],
      previous: {for (final t in tracks) t.id: t},
      codec: codec,
    );
    expect(again.map((t) => t.addedAt).toSet(), tracks.map((t) => t.addedAt).toSet());
  });

  test('Comparaison de versions', () {
    expect(UpdateService.compareVersions('v1.2.0', '1.1.9'), greaterThan(0));
    expect(UpdateService.compareVersions('1.0.0', '1.0.0'), 0);
    expect(UpdateService.compareVersions('v1.0.10', '1.0.9'), greaterThan(0));
    expect(UpdateService.compareVersions('1.0.0+5', '1.0.1'), lessThan(0));
  });

  test('Codage des chemins', () {
    const c = PathCodec('/data/docs', '/data/support');
    expect(c.encode('/data/docs/Musique/a.mp3'), '@docs/Musique/a.mp3');
    expect(c.decode('@docs/Musique/a.mp3'), '/data/docs/Musique/a.mp3');
    expect(c.decode(c.encode('/sdcard/Music/x.mp3')), '/sdcard/Music/x.mp3');
    expect(c.decode(c.encode('/data/support/covers/1.jpg')), '/data/support/covers/1.jpg');
  });
}
