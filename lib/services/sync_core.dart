// Cœur de la synchronisation entre appareils (playlists, titres aimés,
// statistiques d'écoute). Logique pure, portée à l'identique depuis
// web/src/lib/synccore.ts : l'app web (iPhone) et l'app Windows lisent et
// écrivent le même format de fichier.
//
// Chaque appareil écrit son propre fichier JSON dans le dossier
// « Choutify-synchro » de Google Drive et lit ceux des autres. Chaque élément
// porte la date de sa dernière modification : la fusion garde, élément par
// élément, la version la plus récente, quel que soit l'ordre de lecture.
//
// Un titre est identifié par son chemin relatif au dossier qui contient
// « Choutify-synchro » (minuscules, sans accents).

import 'dart:convert';

const syncDirName = 'Choutify-synchro';
const syncFormat = 'choutify-sync';

class SyncItem {
  int on;
  num t;
  num pos;
  num pt;
  SyncItem(this.on, this.t, this.pos, this.pt);
  SyncItem copy() => SyncItem(on, t, pos, pt);
  Map<String, dynamic> toJson() => {'on': on, 't': t, 'pos': pos, 'pt': pt};
}

class SyncPlaylist {
  String name;
  num nt;
  num c;
  num del;
  final Map<String, SyncItem> items;
  SyncPlaylist(this.name, this.nt, this.c, this.del, this.items);
  SyncPlaylist copy() =>
      SyncPlaylist(name, nt, c, del, {for (final e in items.entries) e.key: e.value.copy()});
  Map<String, dynamic> toJson() => {
        'name': name,
        'nt': nt,
        'c': c,
        'del': del,
        'items': {for (final e in items.entries) e.key: e.value.toJson()},
      };
}

class SyncDoc {
  /// Titres aimés : clé → [actif (1) ou retiré (0), date].
  final Map<String, List<num>> likes;
  final Map<String, SyncPlaylist> playlists;

  /// Écoutes : clé → appareil → [nombre, dernière écoute].
  final Map<String, Map<String, List<num>>> plays;

  /// Appareil qui a écrit le fichier (nom, date), pour l'affichage.
  String? deviceName;
  num? deviceUpdated;

  SyncDoc([
    Map<String, List<num>>? likes,
    Map<String, SyncPlaylist>? playlists,
    Map<String, Map<String, List<num>>>? plays,
  ])  : likes = likes ?? {},
        playlists = playlists ?? {},
        plays = plays ?? {};

  Map<String, dynamic> toJson({String? deviceId, String? name, num? updated}) => {
        'format': syncFormat,
        'v': 1,
        if (deviceId != null) 'device': {'id': deviceId, 'name': name, 'updated': updated},
        'likes': likes,
        'playlists': {for (final e in playlists.entries) e.key: e.value.toJson()},
        'plays': plays,
      };

  static SyncDoc? parse(Object? raw) {
    if (raw is! Map) return null;
    if (raw['format'] != syncFormat || raw['v'] is! num || (raw['v'] as num) > 1) return null;
    num n(Object? x) => x is num && x.isFinite ? x : 0;
    Map obj(Object? x) => x is Map ? x : const {};
    final doc = SyncDoc();
    for (final e in obj(raw['likes']).entries) {
      final v = e.value;
      if (v is List && v.length >= 2) doc.likes['${e.key}'] = [n(v[0]) != 0 ? 1 : 0, n(v[1])];
    }
    for (final e in obj(raw['playlists']).entries) {
      final p = obj(e.value);
      final items = <String, SyncItem>{};
      for (final ie in obj(p['items']).entries) {
        final it = obj(ie.value);
        items['${ie.key}'] = SyncItem(n(it['on']) != 0 ? 1 : 0, n(it['t']), n(it['pos']), n(it['pt']));
      }
      doc.playlists['${e.key}'] = SyncPlaylist(
          p['name'] is String ? p['name'] as String : 'Playlist', n(p['nt']), n(p['c']), n(p['del']), items);
    }
    for (final e in obj(raw['plays']).entries) {
      final per = <String, List<num>>{};
      for (final pe in obj(e.value).entries) {
        final v = pe.value;
        if (v is List && v.length >= 2) per['${pe.key}'] = [n(v[0]), n(v[1])];
      }
      doc.plays['${e.key}'] = per;
    }
    final dev = raw['device'];
    if (dev is Map) {
      doc.deviceName = dev['name'] is String ? dev['name'] as String : null;
      doc.deviceUpdated = dev['updated'] is num ? dev['updated'] as num : null;
    }
    return doc;
  }
}

/// Ce que l'appareil a reçu lors de la dernière synchronisation.
class SyncBase {
  final List<String> likes;
  final Map<String, ({String name, List<String> keys})> playlists;
  final Map<String, num> plays;
  SyncBase([List<String>? likes, Map<String, ({String name, List<String> keys})>? playlists, Map<String, num>? plays])
      : likes = likes ?? [],
        playlists = playlists ?? {},
        plays = plays ?? {};

  Map<String, dynamic> toJson() => {
        'likes': likes,
        'playlists': {
          for (final e in playlists.entries) e.key: {'name': e.value.name, 'keys': e.value.keys}
        },
        'plays': plays,
      };

  static SyncBase fromJson(Map j) => SyncBase(
        (j['likes'] as List? ?? []).cast<String>().toList(),
        {
          for (final e in (j['playlists'] as Map? ?? {}).entries)
            '${e.key}': (
              name: (e.value as Map)['name'] as String,
              keys: ((e.value as Map)['keys'] as List).cast<String>().toList()
            )
        },
        (j['plays'] as Map? ?? {}).cast<String, num>(),
      );
}

class SyncPlaylistView {
  final String id;
  final String name;
  final num createdAt;
  final List<String> keys;
  SyncPlaylistView(this.id, this.name, this.createdAt, this.keys);
}

/// État local (ou projeté), exprimé avec les clés de synchronisation.
class SyncView {
  final List<String> likes;
  final List<SyncPlaylistView> playlists;
  final Map<String, ({num count, num last})> plays;
  SyncView(this.likes, this.playlists, this.plays);
}

// ------------------------------------------------------------------ clés

const _foldFrom = 'àáâãäåāăąçćčďèéêëēėęěìíîïīįłñńňòóôõöøōőŕřśšşťùúûüūůűųýÿźżž';
const _foldTo = 'aaaaaaaaacccdeeeeeeeeiiiiiilnnnoooooooorrssstuuuuuuuuyyzzz';

/// Normalise un chemin relatif : séparateurs « / », minuscules, accents
/// retirés, caractères interdits sous Windows remplacés par « _ ».
String syncKey(String relPath) {
  final s = relPath.replaceAll('\\', '/').toLowerCase();
  final out = StringBuffer();
  for (final rune in s.runes) {
    if (rune >= 0x300 && rune <= 0x36f) continue; // marques combinantes
    final ch = String.fromCharCode(rune);
    final i = _foldFrom.indexOf(ch);
    if (i >= 0) {
      out.write(_foldTo[i]);
    } else if (ch == 'œ') {
      out.write('oe');
    } else if (ch == 'æ') {
      out.write('ae');
    } else if (ch == 'ß') {
      out.write('ss');
    } else if ('<>:"|?*'.contains(ch)) {
      out.write('_');
    } else {
      out.write(ch);
    }
  }
  return out
      .toString()
      .split('/')
      .map((p) => p.trim())
      .where((p) => p.isNotEmpty && p != '.')
      .join('/');
}

// ---------------------------------------------------------------- fusion

int _cmp(String a, String b) => a.compareTo(b);

List<num>? _newer(List<num>? a, List<num>? b) {
  if (a == null) return b;
  if (b == null) return a;
  if (a[1] != b[1]) return a[1] > b[1] ? a : b;
  return a[0] >= b[0] ? a : b;
}

SyncItem _mergeItem(SyncItem? a, SyncItem? b) {
  if (a == null) return b!.copy();
  if (b == null) return a.copy();
  final f = _newer([a.on, a.t], [b.on, b.t])!;
  num pos, pt;
  if (a.pt != b.pt) {
    (pos, pt) = a.pt > b.pt ? (a.pos, a.pt) : (b.pos, b.pt);
  } else {
    (pos, pt) = (a.pos < b.pos ? a.pos : b.pos, a.pt);
  }
  return SyncItem(f[0].toInt(), f[1], pos, pt);
}

SyncPlaylist _mergePlaylist(SyncPlaylist? a, SyncPlaylist? b) {
  if (a == null) return b!.copy();
  if (b == null) return a.copy();
  String name;
  num nt;
  if (a.nt != b.nt) {
    (name, nt) = a.nt > b.nt ? (a.name, a.nt) : (b.name, b.nt);
  } else {
    (name, nt) = (_cmp(a.name, b.name) >= 0 ? a.name : b.name, a.nt);
  }
  final items = <String, SyncItem>{};
  for (final k in {...a.items.keys, ...b.items.keys}) {
    items[k] = _mergeItem(a.items[k], b.items[k]);
  }
  return SyncPlaylist(name, nt, a.c < b.c ? a.c : b.c, a.del > b.del ? a.del : b.del, items);
}

num _max(num a, num b) => a > b ? a : b;

/// Fusionne deux états : commutative, associative et idempotente.
SyncDoc mergeDocs(SyncDoc a, SyncDoc b) {
  final out = SyncDoc();
  for (final k in {...a.likes.keys, ...b.likes.keys}) {
    out.likes[k] = [..._newer(a.likes[k], b.likes[k])!];
  }
  for (final id in {...a.playlists.keys, ...b.playlists.keys}) {
    out.playlists[id] = _mergePlaylist(a.playlists[id], b.playlists[id]);
  }
  for (final k in {...a.plays.keys, ...b.plays.keys}) {
    final pa = a.plays[k] ?? const {};
    final pb = b.plays[k] ?? const {};
    out.plays[k] = {
      for (final d in {...pa.keys, ...pb.keys})
        d: [
          _max((pa[d] ?? const [0, 0])[0], (pb[d] ?? const [0, 0])[0]),
          _max((pa[d] ?? const [0, 0])[1], (pb[d] ?? const [0, 0])[1]),
        ]
    };
  }
  return out;
}

// ---------------------------------------------------- modifications locales

bool _sameSeq(List<String> a, List<String> b) {
  if (a.length != b.length) return false;
  for (var i = 0; i < a.length; i++) {
    if (a[i] != b[i]) return false;
  }
  return true;
}

num _maxPos(SyncPlaylist p) {
  num m = -1;
  for (final it in p.items.values) {
    if (it.on != 0 && it.pos > m) m = it.pos;
  }
  return m;
}

/// Inscrit dans le document les changements faits sur cet appareil depuis la
/// dernière synchronisation (différence entre l'état local et [base]). Un
/// titre absent de cet appareil n'est jamais considéré comme retiré.
SyncDoc applyLocal(SyncDoc docIn, SyncBase base, SyncView local, Set<String> known, String deviceId, num now) {
  final doc = mergeDocs(docIn, SyncDoc());

  final liked = local.likes.toSet();
  final baseLiked = base.likes.toSet();
  for (final k in liked) {
    if (!baseLiked.contains(k)) doc.likes[k] = [1, now];
  }
  for (final k in baseLiked) {
    if (!liked.contains(k) && known.contains(k)) doc.likes[k] = [0, now];
  }

  final localIds = local.playlists.map((p) => p.id).toSet();
  for (final id in base.playlists.keys) {
    final sp = doc.playlists[id];
    if (!localIds.contains(id) && sp != null) sp.del = _max(sp.del, now);
  }
  for (final pl in local.playlists) {
    final keys = pl.keys.toSet().toList();
    final b = base.playlists[pl.id];
    var sp = doc.playlists[pl.id];
    if (sp == null) {
      sp = SyncPlaylist(pl.name, now, pl.createdAt == 0 ? now : pl.createdAt, 0, {});
      doc.playlists[pl.id] = sp;
    } else if (b == null) {
      sp.name = pl.name;
      sp.nt = _max(now, sp.del + 1);
    } else if (pl.name != b.name) {
      sp.name = pl.name;
      sp.nt = now;
    }
    final baseKeys = b?.keys ?? const <String>[];
    final baseSet = baseKeys.toSet();
    final keySet = keys.toSet();
    for (final k in baseKeys) {
      final it = sp.items[k];
      if (!keySet.contains(k) && known.contains(k) && it != null) {
        sp.items[k] = SyncItem(0, now, it.pos, it.pt);
      }
    }
    final commonLocal = keys.where(baseSet.contains).toList();
    final commonBase = baseKeys.where(keySet.contains).toList();
    if (!_sameSeq(commonLocal, commonBase)) {
      for (var i = 0; i < keys.length; i++) {
        final it = sp.items[keys[i]];
        sp.items[keys[i]] = SyncItem(1, it != null && baseSet.contains(keys[i]) ? it.t : now, i, now);
      }
    } else {
      for (var i = 0; i < keys.length; i++) {
        final k = keys[i];
        if (baseSet.contains(k)) continue;
        final prev = i > 0 ? sp.items[keys[i - 1]]?.pos : null;
        num? next;
        for (var j = i + 1; j < keys.length; j++) {
          if (baseSet.contains(keys[j]) && sp.items[keys[j]] != null) {
            next = sp.items[keys[j]]!.pos;
            break;
          }
        }
        num pos;
        if (next == null) {
          pos = _max(prev ?? -1, _maxPos(sp)) + 1;
        } else if (prev == null) {
          pos = next - 1;
        } else {
          pos = (prev + next) / 2;
        }
        sp.items[k] = SyncItem(1, now, pos, now);
      }
    }
  }

  for (final e in local.plays.entries) {
    final delta = e.value.count - (base.plays[e.key] ?? 0);
    final per = doc.plays.putIfAbsent(e.key, () => {});
    final mine = per[deviceId] ?? const [0, 0];
    final knownLast = per.values.fold<num>(0, (m, v) => _max(m, v[1]));
    if (delta > 0 || e.value.last > knownLast) {
      per[deviceId] = [mine[0] + (delta > 0 ? delta : 0), _max(mine[1], e.value.last)];
    }
  }
  return doc;
}

// ------------------------------------------------------------- projection

/// État à afficher sur cet appareil, limité aux titres qu'il connaît.
SyncView project(SyncDoc doc, Set<String> known) {
  final likeEntries = doc.likes.entries.where((e) => e.value[0] != 0 && known.contains(e.key)).toList()
    ..sort((a, b) {
      final d = a.value[1].compareTo(b.value[1]);
      return d != 0 ? d : _cmp(a.key, b.key);
    });
  final pls = doc.playlists.entries.where((e) => e.value.nt > e.value.del).toList()
    ..sort((a, b) {
      final d = a.value.c.compareTo(b.value.c);
      return d != 0 ? d : _cmp(a.key, b.key);
    });
  final playlists = [
    for (final e in pls)
      SyncPlaylistView(
        e.key,
        e.value.name,
        e.value.c,
        (e.value.items.entries.where((i) => i.value.on != 0 && known.contains(i.key)).toList()
              ..sort((a, b) {
                final d = a.value.pos.compareTo(b.value.pos);
                return d != 0 ? d : _cmp(a.key, b.key);
              }))
            .map((i) => i.key)
            .toList(),
      )
  ];
  final plays = <String, ({num count, num last})>{};
  for (final e in doc.plays.entries) {
    if (!known.contains(e.key)) continue;
    num count = 0, last = 0;
    for (final v in e.value.values) {
      count += v[0];
      last = _max(last, v[1]);
    }
    if (count != 0 || last != 0) plays[e.key] = (count: count, last: last);
  }
  return SyncView(likeEntries.map((e) => e.key).toList(), playlists, plays);
}

SyncBase baseFrom(SyncView p) => SyncBase(
      [...p.likes],
      {for (final pl in p.playlists) pl.id: (name: pl.name, keys: [...pl.keys])},
      {for (final e in p.plays.entries) e.key: e.value.count},
    );

/// Remplace les titres synchronisés d'une liste par [synced], en gardant les
/// titres non synchronisés à leur place.
List<String> keepUnsynced(List<String> old, List<String> synced, bool Function(String) isSynced) {
  final out = [...synced];
  String? anchor;
  var hasAnchor = false;
  for (final id in old) {
    if (isSynced(id)) {
      if (out.contains(id)) {
        anchor = id;
        hasAnchor = true;
      }
      continue;
    }
    if (out.contains(id)) continue;
    final at = hasAnchor ? out.indexOf(anchor!) + 1 : 0;
    out.insert(at, id);
    anchor = id;
    hasAnchor = true;
  }
  return out;
}

/// JSON aux clés triées : deux états identiques donnent le même texte.
String canonicalJson(Object? v) {
  if (v is List) return '[${v.map(canonicalJson).join(',')}]';
  if (v is Map) {
    final keys = v.keys.map((k) => '$k').toList()..sort();
    return '{${keys.where((k) => v[k] != null).map((k) => '${jsonEncode(k)}:${canonicalJson(v[k])}').join(',')}}';
  }
  if (v is double && v == v.truncateToDouble() && v.abs() < 1e15) return '${v.toInt()}';
  return jsonEncode(v);
}
