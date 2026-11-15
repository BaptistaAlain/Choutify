import 'dart:io';

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';
import 'package:provider/provider.dart';

import '../navigation.dart';
import '../services/update_service.dart';
import '../state/library_state.dart';
import '../theme.dart';
import '../widgets/mini_player.dart';
import 'home_screen.dart';
import 'library_screen.dart';
import 'search_screen.dart';
import 'settings_screen.dart';

class AppShell extends StatefulWidget {
  const AppShell({super.key});

  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> {
  static const _roots = <Widget>[HomeScreen(), SearchScreen(), LibraryScreen()];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _checkUpdate());
  }

  Future<void> _checkUpdate() async {
    final lib = context.read<LibraryState>();
    final info = await UpdateService.check();
    if (info == null || !mounted) return;
    // Ne propose chaque version qu'une seule fois automatiquement.
    if (lib.prefs.getString('updateShown') == info.version) return;
    await lib.prefs.setString('updateShown', info.version);
    if (mounted) showUpdateDialog(context, info);
  }

  void _select(int i) {
    if (i == AppNav.currentTab.value) {
      AppNav.tabKeys[i].currentState?.popUntil((r) => r.isFirst);
    } else {
      setState(() => AppNav.currentTab.value = i);
    }
  }

  @override
  Widget build(BuildContext context) {
    final tab = AppNav.currentTab.value;
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        final nav = AppNav.tabKeys[tab].currentState;
        if (nav != null && nav.canPop()) {
          nav.pop();
        } else if (tab != 0) {
          setState(() => AppNav.currentTab.value = 0);
        } else {
          // Ferme l'interface ; la lecture continue en arrière-plan.
          await SystemNavigator.pop();
        }
      },
      child: LayoutBuilder(builder: (context, box) {
        final stack = IndexedStack(
          index: tab,
          children: [
            for (var i = 0; i < _roots.length; i++)
              Navigator(
                key: AppNav.tabKeys[i],
                onGenerateRoute: (_) => MaterialPageRoute(builder: (_) => _roots[i]),
              ),
          ],
        );
        // Grande fenêtre sur PC : menu à gauche plutôt qu'en bas.
        if (Platform.isWindows && box.maxWidth >= 840) {
          return Scaffold(
            body: Row(children: [
              NavigationRail(
                selectedIndex: tab,
                onDestinationSelected: _select,
                labelType: NavigationRailLabelType.all,
                backgroundColor: AppColors.bg,
                leading: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  child: Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                      gradient: AppColors.brandGradient,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: const Icon(Icons.graphic_eq_rounded, color: Colors.white),
                  ),
                ),
                destinations: const [
                  NavigationRailDestination(
                      icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home_rounded), label: Text('Accueil')),
                  NavigationRailDestination(
                      icon: Icon(Icons.search_rounded),
                      selectedIcon: Icon(Icons.manage_search_rounded),
                      label: Text('Rechercher')),
                  NavigationRailDestination(
                      icon: Icon(Icons.library_music_outlined),
                      selectedIcon: Icon(Icons.library_music_rounded),
                      label: Text('Bibliothèque')),
                ],
              ),
              Expanded(child: stack),
            ]),
            bottomNavigationBar: const Padding(
              padding: EdgeInsets.symmetric(vertical: 4),
              child: MiniPlayer(),
            ),
          );
        }
        return Scaffold(
          body: stack,
          bottomNavigationBar: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const MiniPlayer(),
              NavigationBar(
                selectedIndex: tab,
                onDestinationSelected: _select,
                destinations: const [
                  NavigationDestination(
                      icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home_rounded), label: 'Accueil'),
                  NavigationDestination(
                      icon: Icon(Icons.search_rounded), selectedIcon: Icon(Icons.manage_search_rounded), label: 'Rechercher'),
                  NavigationDestination(
                      icon: Icon(Icons.library_music_outlined),
                      selectedIcon: Icon(Icons.library_music_rounded),
                      label: 'Bibliothèque'),
                ],
              ),
            ],
          ),
        );
      }),
    );
  }
}

/// Premier lancement : choix du dossier de musique.
class OnboardingScreen extends StatelessWidget {
  const OnboardingScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final lib = context.watch<LibraryState>();
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [Color(0xFF2A1B5E), AppColors.bg, Color(0xFF4A1430)],
          ),
        ),
        child: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(28),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Spacer(),
              Container(
                width: 84,
                height: 84,
                decoration: BoxDecoration(
                  gradient: AppColors.brandGradient,
                  borderRadius: BorderRadius.circular(24),
                ),
                child: const Icon(Icons.graphic_eq_rounded, size: 52, color: Colors.white),
              ),
              const SizedBox(height: 28),
              const Text('Choutify',
                  style: TextStyle(fontSize: 40, fontWeight: FontWeight.w900, letterSpacing: -1)),
              const SizedBox(height: 8),
              Text(
                  'Toute ta musique, sur ${Platform.isWindows ? 'ton PC' : 'ton téléphone'}.\n'
                  'Sans compte, sans abonnement, sans internet.',
                  style: TextStyle(fontSize: 17, color: Colors.white70, height: 1.4)),
              const Spacer(),
              if (lib.scanning) ScanBanner(lib: lib),
              SizedBox(
                width: double.infinity,
                height: 56,
                child: FilledButton.icon(
                  style: FilledButton.styleFrom(
                    backgroundColor: Colors.white,
                    foregroundColor: Colors.black,
                    textStyle: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
                  ),
                  icon: const Icon(Icons.folder_open_rounded),
                  label: Text(Platform.isIOS ? 'Importer un dossier de musique' : 'Choisir mon dossier de musique'),
                  onPressed: lib.scanning ? null : () => pickMusicFolder(context),
                ),
              ),
              if (Platform.isWindows && windowsMusicDir() != null) ...[
                const SizedBox(height: 10),
                SizedBox(
                  width: double.infinity,
                  height: 48,
                  child: OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(foregroundColor: Colors.white),
                    icon: const Icon(Icons.library_music_rounded),
                    label: const Text('Utiliser mon dossier « Musique »'),
                    onPressed: lib.scanning
                        ? null
                        : () async {
                            await lib.addFolder(windowsMusicDir()!);
                            await lib.rescan();
                          },
                  ),
                ),
              ],
              if (Platform.isIOS) ...[
                const SizedBox(height: 14),
                const Text(
                  'Astuce : tu peux aussi déposer tes fichiers dans l\'app Fichiers › Sur mon iPhone › Choutify › Musique.',
                  style: TextStyle(color: Colors.white60, fontSize: 13),
                ),
                TextButton(
                  onPressed: () => context.read<LibraryState>().markOnboarded(),
                  child: const Text('Continuer sans importer'),
                ),
              ],
              const SizedBox(height: 12),
            ]),
          ),
        ),
      ),
    );
  }
}
