import 'dart:io';

import 'package:flutter/gestures.dart';
import 'package:flutter/services.dart';
import 'package:just_audio_background/just_audio_background.dart';
import 'package:material_ui/material_ui.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'navigation.dart';
import 'screens/shell.dart';
import 'services/paths.dart';
import 'services/permissions.dart';
import 'state/library_state.dart';
import 'state/player_state.dart';
import 'theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Sur Windows, le lecteur natif (just_audio_windows) gère déjà les touches
  // multimédia du clavier : la lecture en arrière-plan mobile n'existe pas.
  if (Platform.isAndroid || Platform.isIOS) {
    await JustAudioBackground.init(
      androidNotificationChannelId: 'com.choutify.app.playback',
      androidNotificationChannelName: 'Lecture',
      androidNotificationOngoing: true,
      notificationColor: AppColors.violet,
      androidNotificationIcon: 'drawable/ic_notification',
    );
  }
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
    statusBarColor: Colors.transparent,
    systemNavigationBarColor: AppColors.bg,
  ));

  final codec = await PathCodec.init();
  await codec.ensureDirs();
  final prefs = await SharedPreferences.getInstance();
  final library = LibraryState(codec, prefs);
  await library.load();
  final player = PlayerState(library, prefs);
  await player.restore();

  runApp(ChoutifyApp(library: library, player: player));

  // Analyse incrémentale au démarrage pour détecter les nouveaux fichiers.
  if (library.hasFolders) {
    if (!Platform.isAndroid || await StoragePermissions.ensure()) {
      library.rescan();
    }
  }
}

class ChoutifyApp extends StatefulWidget {
  const ChoutifyApp({super.key, required this.library, required this.player});
  final LibraryState library;
  final PlayerState player;

  @override
  State<ChoutifyApp> createState() => _ChoutifyAppState();
}

class _ChoutifyAppState extends State<ChoutifyApp> with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused || state == AppLifecycleState.detached) {
      widget.player.persist();
    }
  }

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: widget.library),
        ChangeNotifierProvider.value(value: widget.player),
      ],
      child: MaterialApp(
        title: 'Choutify',
        debugShowCheckedModeBanner: false,
        // Sur PC, les listes horizontales se font aussi glisser à la souris.
        scrollBehavior: Platform.isWindows
            ? const MaterialScrollBehavior().copyWith(dragDevices: PointerDeviceKind.values.toSet())
            : null,
        navigatorKey: AppNav.rootKey,
        theme: buildTheme(),
        darkTheme: buildTheme(),
        themeMode: ThemeMode.dark,
        home: Selector<LibraryState, bool>(
          selector: (_, l) => l.needsOnboarding,
          builder: (_, needs, _) => needs ? const OnboardingScreen() : const AppShell(),
        ),
      ),
    );
  }
}
