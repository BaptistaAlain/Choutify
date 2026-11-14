import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:material_ui/material_ui.dart';
import 'package:path/path.dart' as p;
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../services/library_scanner.dart';
import '../services/permissions.dart';
import '../services/update_service.dart';
import '../state/library_state.dart';
import '../theme.dart';
import '../widgets/track_widgets.dart';
import 'home_screen.dart';

/// Choisit un dossier et l'ajoute à la bibliothèque (Android), ou le copie
/// dans le dossier de l'application (iOS).
Future<void> pickMusicFolder(BuildContext context) async {
  final lib = context.read<LibraryState>();
  if (Platform.isAndroid && !await StoragePermissions.ensure()) {
    if (context.mounted) {
      showSnack(context, 'Autorise l\'accès à la musique pour continuer');
    }
    return;
  }
  final dir = await FilePicker.getDirectoryPath(dialogTitle: 'Dossier de musique');
  if (dir == null) return;
  if (Platform.isIOS) {
    if (!context.mounted) return;
    await _importIntoApp(context, dir);
    await lib.markOnboarded();
  } else {
    await lib.addFolder(dir);
  }
  await lib.rescan();
}

Future<void> _importIntoApp(BuildContext context, String source) async {
  final lib = context.read<LibraryState>();
  final dest = Directory(p.join(lib.codec.iosMusicDir, p.basename(source)));
  var copied = 0;
  try {
    final files = Directory(source).listSync(recursive: true, followLinks: false);
    for (final f in files.whereType<File>()) {
      final ext = p.extension(f.path).toLowerCase();
      final isImage = ['.jpg', '.jpeg', '.png'].contains(ext);
      if (!audioExtensions.contains(ext) && !isImage) continue;
      final target = File(p.join(dest.path, p.relative(f.path, from: source)));
      if (await target.exists()) continue;
      await target.parent.create(recursive: true);
      await f.copy(target.path);
      if (!isImage) copied++;
    }
    if (context.mounted) showSnack(context, plural(copied, 'titre importé', 'titres importés'));
  } catch (e) {
    if (context.mounted) {
      showSnack(context,
          'Import impossible. Copie ta musique dans Fichiers › Sur mon iPhone › Choutify › Musique.');
    }
  }
}

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  String _version = '';
  bool _fullAccess = false;
  bool _checking = false;

  @override
  void initState() {
    super.initState();
    UpdateService.currentVersion().then((v) => mounted ? setState(() => _version = v) : null);
    StoragePermissions.hasFullAccess.then((v) => mounted ? setState(() => _fullAccess = v) : null);
  }

  Future<void> _checkUpdate() async {
    setState(() => _checking = true);
    final info = await UpdateService.check();
    if (!mounted) return;
    setState(() => _checking = false);
    if (info == null) {
      showSnack(context, 'Choutify est à jour');
    } else {
      showUpdateDialog(context, info);
    }
  }

  @override
  Widget build(BuildContext context) {
    final lib = context.watch<LibraryState>();
    return Scaffold(
      appBar: AppBar(title: const Text('Paramètres')),
      body: ListView(children: [
        if (lib.scanning) ScanBanner(lib: lib),
        const _Header('Bibliothèque'),
        if (Platform.isIOS) ...[
          const ListTile(
            leading: Icon(Icons.info_outline_rounded),
            title: Text('Où mettre ma musique ?'),
            subtitle: Text(
                'Dans l\'app Fichiers : Sur mon iPhone › Choutify › Musique. '
                'Tu peux aussi importer un dossier ci-dessous.'),
          ),
          ListTile(
            leading: const Icon(Icons.drive_folder_upload_rounded),
            title: const Text('Importer un dossier'),
            subtitle: const Text('Copie la musique dans Choutify'),
            onTap: () => pickMusicFolder(context),
          ),
        ] else ...[
          for (final f in lib.musicFolders)
            ListTile(
              leading: const Icon(Icons.folder_rounded, color: AppColors.violet),
              title: Text(p.basename(f)),
              subtitle: Text(f, maxLines: 2, overflow: TextOverflow.ellipsis),
              trailing: IconButton(
                tooltip: 'Retirer',
                icon: const Icon(Icons.close_rounded),
                onPressed: () => lib.removeFolder(f),
              ),
            ),
          ListTile(
            leading: const Icon(Icons.create_new_folder_rounded),
            title: Text(lib.musicFolders.isEmpty ? 'Choisir mon dossier de musique' : 'Ajouter un dossier'),
            onTap: () => pickMusicFolder(context),
          ),
        ],
        ListTile(
          leading: const Icon(Icons.refresh_rounded),
          title: const Text('Analyser à nouveau'),
          subtitle: const Text('Détecte les nouveaux fichiers et les modifications'),
          enabled: !lib.scanning,
          onTap: () => lib.rescan(),
        ),
        ListTile(
          leading: const Icon(Icons.image_search_rounded),
          title: const Text('Reconstruire la bibliothèque'),
          subtitle: const Text('Relit tous les tags et les pochettes'),
          enabled: !lib.scanning,
          onTap: () => lib.rescan(full: true),
        ),
        if (Platform.isAndroid)
          SwitchListTile(
            secondary: const Icon(Icons.sd_storage_rounded),
            title: const Text('Accès complet aux fichiers'),
            subtitle: const Text(
                'À activer si certains titres ou pochettes n\'apparaissent pas (carte SD, dossiers particuliers)'),
            value: _fullAccess,
            onChanged: (v) async {
              if (!v) {
                showSnack(context, 'Désactive l\'accès dans les réglages Android');
                return;
              }
              final ok = await StoragePermissions.requestFullAccess();
              if (!mounted) return;
              setState(() => _fullAccess = ok);
              if (ok) lib.rescan();
            },
          ),
        ListTile(
          leading: const Icon(Icons.bar_chart_rounded),
          title: const Text('Statistiques'),
          subtitle: Text('${plural(lib.tracks.length, 'titre')} • '
              '${plural(lib.albums.length, 'album')} • '
              '${plural(lib.artists.length, 'artiste')} • '
              '${plural(lib.playlists.length, 'playlist')}'),
        ),
        const _Header('Application'),
        ListTile(
          leading: const Icon(Icons.system_update_rounded),
          title: const Text('Rechercher une mise à jour'),
          subtitle: Text('Version installée : $_version'),
          trailing: _checking
              ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
              : null,
          onTap: _checking ? null : _checkUpdate,
        ),
        ListTile(
          leading: const Icon(Icons.code_rounded),
          title: const Text('Code source et versions'),
          subtitle: const Text('github.com/$githubRepo'),
          onTap: () => launchUrl(Uri.parse('https://github.com/$githubRepo'),
              mode: LaunchMode.externalApplication),
        ),
        const SizedBox(height: 32),
      ]),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header(this.text);
  final String text;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(20, 20, 20, 6),
        child: Text(text.toUpperCase(),
            style: const TextStyle(
                color: AppColors.coral, fontWeight: FontWeight.w800, fontSize: 12, letterSpacing: 1.2)),
      );
}

void showUpdateDialog(BuildContext context, UpdateInfo info) {
  showDialog(
    context: context,
    useRootNavigator: true,
    builder: (ctx) => AlertDialog(
      title: Text('Version ${info.version} disponible'),
      content: SingleChildScrollView(
        child: Text(info.notes.isEmpty ? 'Une nouvelle version de Choutify est disponible.' : info.notes),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Plus tard')),
        FilledButton(
          onPressed: () {
            Navigator.pop(ctx);
            launchUrl(Uri.parse(info.downloadUrl ?? info.pageUrl),
                mode: LaunchMode.externalApplication);
          },
          child: Text(Platform.isAndroid ? 'Télécharger' : 'Voir'),
        ),
      ],
    ),
  );
}
