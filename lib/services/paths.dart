import 'dart:io';

import 'package:path_provider/path_provider.dart';

/// Encode les chemins de façon stable. Sur iOS, le chemin du conteneur de
/// l'application change à chaque mise à jour : on remplace donc les
/// répertoires de l'application par des préfixes symboliques.
class PathCodec {
  final String docsDir;
  final String supportDir;

  const PathCodec(this.docsDir, this.supportDir);

  static late PathCodec instance;

  static Future<PathCodec> init() async {
    final docs = await getApplicationDocumentsDirectory();
    final support = await getApplicationSupportDirectory();
    instance = PathCodec(docs.path, support.path);
    return instance;
  }

  String encode(String path) {
    if (path.startsWith('$docsDir/')) {
      return '@docs${path.substring(docsDir.length)}';
    }
    if (path.startsWith('$supportDir/')) {
      return '@support${path.substring(supportDir.length)}';
    }
    return path;
  }

  String decode(String id) {
    if (id.startsWith('@docs/')) return '$docsDir${id.substring(5)}';
    if (id.startsWith('@support/')) return '$supportDir${id.substring(8)}';
    return id;
  }

  String get coversDir => '$supportDir/covers';
  String get dataDir => '$supportDir/data';

  /// Dossier « Musique » visible dans l'app Fichiers sur iOS.
  String get iosMusicDir => '$docsDir/Musique';

  Future<void> ensureDirs() async {
    await Directory(coversDir).create(recursive: true);
    await Directory(dataDir).create(recursive: true);
    if (Platform.isIOS) await Directory(iosMusicDir).create(recursive: true);
  }
}
