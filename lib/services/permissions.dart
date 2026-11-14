import 'dart:io';

import 'package:permission_handler/permission_handler.dart';

class StoragePermissions {
  /// Demande l'accès aux fichiers audio (et aux images pour les pochettes
  /// placées dans les dossiers). Renvoie true si la lecture est possible.
  static Future<bool> ensure() async {
    if (!Platform.isAndroid) return true;
    if (await Permission.manageExternalStorage.isGranted) return true;
    final res = await [
      Permission.audio,
      Permission.photos,
      Permission.storage,
    ].request();
    return (res[Permission.audio]?.isGranted ?? false) ||
        (res[Permission.storage]?.isGranted ?? false);
  }

  static Future<bool> get hasFullAccess async =>
      Platform.isAndroid && await Permission.manageExternalStorage.isGranted;

  /// Accès complet aux fichiers (utile pour les cartes SD ou les dossiers
  /// non indexés par Android).
  static Future<bool> requestFullAccess() async {
    if (!Platform.isAndroid) return true;
    final s = await Permission.manageExternalStorage.request();
    return s.isGranted;
  }
}
