import 'dart:convert';
import 'dart:io';

import 'package:package_info_plus/package_info_plus.dart';

const githubRepo = 'BaptistaAlain/Choutify';
const releasesUrl = 'https://github.com/$githubRepo/releases/latest';

class UpdateInfo {
  final String version;
  final String notes;
  final String pageUrl;
  final String? downloadUrl;
  const UpdateInfo(this.version, this.notes, this.pageUrl, this.downloadUrl);
}

class UpdateService {
  static Future<String> currentVersion() async =>
      (await PackageInfo.fromPlatform()).version;

  /// Compare deux versions « 1.2.3 ». Renvoie > 0 si [a] est plus récente.
  static int compareVersions(String a, String b) {
    List<int> parse(String v) => v
        .replaceFirst(RegExp(r'^v'), '')
        .split(RegExp(r'[.+\-]'))
        .map((e) => int.tryParse(e) ?? 0)
        .toList();
    final pa = parse(a), pb = parse(b);
    for (var i = 0; i < 3; i++) {
      final x = i < pa.length ? pa[i] : 0;
      final y = i < pb.length ? pb[i] : 0;
      if (x != y) return x.compareTo(y);
    }
    return 0;
  }

  /// Interroge la dernière release GitHub. Renvoie null si l'application est
  /// à jour ou si la vérification échoue.
  static Future<UpdateInfo?> check() async {
    final client = HttpClient()..connectionTimeout = const Duration(seconds: 8);
    try {
      final req = await client.getUrl(
          Uri.parse('https://api.github.com/repos/$githubRepo/releases/latest'));
      req.headers.set('Accept', 'application/vnd.github+json');
      req.headers.set('User-Agent', 'Choutify');
      final res = await req.close().timeout(const Duration(seconds: 10));
      if (res.statusCode != 200) return null;
      final body = await res.transform(utf8.decoder).join();
      final j = jsonDecode(body) as Map<String, dynamic>;
      final tag = (j['tag_name'] as String?) ?? '';
      final current = await currentVersion();
      if (compareVersions(tag, current) <= 0) return null;
      String? apk;
      String? ipa;
      String? exe;
      for (final a in (j['assets'] as List? ?? [])) {
        final name = (a['name'] as String).toLowerCase();
        final url = a['browser_download_url'] as String;
        if (name.endsWith('.apk') && (apk == null || name.contains('universal'))) {
          apk = url;
        }
        if (name.endsWith('.ipa')) ipa = url;
        if (name.endsWith('.exe') && name.contains('setup')) exe = url;
      }
      return UpdateInfo(
        tag.replaceFirst(RegExp(r'^v'), ''),
        (j['body'] as String?) ?? '',
        (j['html_url'] as String?) ?? releasesUrl,
        Platform.isAndroid ? apk : (Platform.isWindows ? exe : ipa),
      );
    } catch (_) {
      return null;
    } finally {
      client.close(force: true);
    }
  }

  /// Windows : télécharge l'installateur dans le dossier temporaire, le lance
  /// en mode silencieux puis ferme Choutify pour qu'il puisse remplacer les
  /// fichiers. L'installateur relance Choutify à la fin.
  static Future<void> installWindowsUpdate(
      String url, void Function(double progress) onProgress) async {
    final client = HttpClient()..connectionTimeout = const Duration(seconds: 15);
    try {
      final req = await client.getUrl(Uri.parse(url));
      req.headers.set('User-Agent', 'Choutify');
      final res = await req.close();
      if (res.statusCode != 200) {
        throw HttpException('Téléchargement impossible (${res.statusCode})');
      }
      final file = File(
          '${Directory.systemTemp.path}${Platform.pathSeparator}Choutify-setup.exe');
      final sink = file.openWrite();
      final total = res.contentLength;
      var received = 0;
      await for (final chunk in res) {
        sink.add(chunk);
        received += chunk.length;
        if (total > 0) onProgress(received / total);
      }
      await sink.close();
      await Process.start(
        file.path,
        ['/SILENT', '/SUPPRESSMSGBOXES', '/NORESTART'],
        mode: ProcessStartMode.detached,
      );
      exit(0);
    } finally {
      client.close(force: true);
    }
  }
}
