import 'dart:async';

import 'package:material_ui/material_ui.dart';
import 'package:provider/provider.dart';

import '../models/track.dart';
import '../navigation.dart';
import '../state/library_state.dart';
import '../state/player_state.dart';
import '../theme.dart';
import '../widgets/artwork.dart';
import '../widgets/track_widgets.dart';
import 'queue_screen.dart';

void openNowPlaying(BuildContext context) {
  Navigator.of(context, rootNavigator: true).push(PageRouteBuilder(
    opaque: false,
    transitionDuration: const Duration(milliseconds: 320),
    reverseTransitionDuration: const Duration(milliseconds: 260),
    pageBuilder: (_, _, _) => const NowPlayingScreen(),
    transitionsBuilder: (_, anim, _, child) => SlideTransition(
      position: Tween(begin: const Offset(0, 1), end: Offset.zero)
          .animate(CurvedAnimation(parent: anim, curve: Curves.easeOutCubic)),
      child: child,
    ),
  ));
}

class NowPlayingScreen extends StatefulWidget {
  const NowPlayingScreen({super.key});

  @override
  State<NowPlayingScreen> createState() => _NowPlayingScreenState();
}

class _NowPlayingScreenState extends State<NowPlayingScreen> {
  Color _color = const Color(0xFF2E2456);
  String? _colorFor;
  double _drag = 0;

  void _updateColor(Track? t) {
    if (t?.artPath == _colorFor) return;
    _colorFor = t?.artPath;
    ArtColors.dominant(t?.artPath).then((c) {
      if (mounted) setState(() => _color = c);
    });
  }

  @override
  Widget build(BuildContext context) {
    final player = context.watch<PlayerState>();
    final lib = context.watch<LibraryState>();
    final t = player.current;
    _updateColor(t);
    if (t == null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) Navigator.of(context).maybePop();
      });
      return const SizedBox.shrink();
    }
    final size = MediaQuery.sizeOf(context);
    final artSize = (size.width - 56).clamp(160.0, size.height * 0.42);

    return GestureDetector(
      onVerticalDragUpdate: (d) => setState(() => _drag = (_drag + d.delta.dy).clamp(0, size.height)),
      onVerticalDragEnd: (d) {
        if (_drag > 140 || d.velocity.pixelsPerSecond.dy > 700) {
          Navigator.of(context).pop();
        } else {
          setState(() => _drag = 0);
        }
      },
      child: Transform.translate(
        offset: Offset(0, _drag),
        child: Scaffold(
          backgroundColor: AppColors.bg,
          body: AnimatedContainer(
            duration: const Duration(milliseconds: 500),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [_color, Color.lerp(_color, AppColors.bg, 0.75)!, AppColors.bg],
                stops: const [0, 0.6, 1],
              ),
            ),
            child: SafeArea(
              // Sur grand écran, les commandes restent groupées au centre.
              child: Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 620),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 28),
                    child: Column(children: [
                      Row(children: [
                        IconButton(
                          icon: const Icon(Icons.keyboard_arrow_down_rounded, size: 32),
                          onPressed: () => Navigator.of(context).pop(),
                        ),
                        Expanded(
                          child: Column(children: [
                            const Text('EN LECTURE',
                                style: TextStyle(fontSize: 11, letterSpacing: 1.4, color: Colors.white70)),
                            Text(player.queueLabel ?? t.album ?? '',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                          ]),
                        ),
                        IconButton(
                          icon: const Icon(Icons.more_vert_rounded),
                          onPressed: () => showTrackMenu(context, t),
                        ),
                      ]),
                      const Spacer(),
                      GestureDetector(
                        onHorizontalDragEnd: (d) {
                          final v = d.velocity.pixelsPerSecond.dx;
                          if (v < -300) player.next();
                          if (v > 300) player.previous();
                        },
                        child: AnimatedSwitcher(
                          duration: const Duration(milliseconds: 250),
                          child: DecoratedBox(
                            key: ValueKey(t.id),
                            decoration: BoxDecoration(boxShadow: [
                              BoxShadow(
                                  color: Colors.black.withValues(alpha: 0.5),
                                  blurRadius: 40,
                                  offset: const Offset(0, 18)),
                            ]),
                            child: Artwork(
                                path: t.artPath, size: artSize, radius: 14, seed: t.album ?? t.title),
                          ),
                        ),
                      ),
                      const Spacer(),
                      Row(children: [
                        Expanded(
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text(t.title,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
                            const SizedBox(height: 2),
                            GestureDetector(
                              onTap: () {
                                final a = lib.artistByName(t.mainArtist);
                                if (a != null) AppNav.openArtist(a);
                              },
                              child: Text(t.displayArtist,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(fontSize: 15, color: Colors.white70)),
                            ),
                          ]),
                        ),
                        IconButton(
                          iconSize: 28,
                          icon: Icon(
                            lib.isFavorite(t) ? Icons.favorite_rounded : Icons.favorite_border_rounded,
                            color: lib.isFavorite(t) ? AppColors.coral : Colors.white,
                          ),
                          onPressed: () => lib.toggleFavorite(t),
                        ),
                      ]),
                      const SizedBox(height: 8),
                      const SeekBar(),
                      const SizedBox(height: 4),
                      const _Controls(),
                      const SizedBox(height: 12),
                      Row(children: [
                        IconButton(
                          tooltip: 'Minuterie de mise en veille',
                          icon: Icon(Icons.bedtime_outlined,
                              color: player.sleepTimerActive ? AppColors.coral : Colors.white70),
                          onPressed: () => showSleepTimer(context),
                        ),
                        if (player.sleepAt != null) _SleepCountdown(at: player.sleepAt!),
                        if (player.sleepAtEndOfTrack)
                          const Text('Fin du titre', style: TextStyle(color: AppColors.coral, fontSize: 12)),
                        const Spacer(),
                        IconButton(
                          tooltip: 'Ajouter à une playlist',
                          icon: const Icon(Icons.playlist_add_rounded, color: Colors.white70),
                          onPressed: () => showAddToPlaylist(context, [t]),
                        ),
                        IconButton(
                          tooltip: 'File d\'attente',
                          icon: const Icon(Icons.queue_music_rounded, color: Colors.white70),
                          onPressed: () => Navigator.of(context)
                              .push(MaterialPageRoute(builder: (_) => const QueueScreen())),
                        ),
                      ]),
                      const SizedBox(height: 8),
                    ]),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _SleepCountdown extends StatefulWidget {
  const _SleepCountdown({required this.at});
  final DateTime at;
  @override
  State<_SleepCountdown> createState() => _SleepCountdownState();
}

class _SleepCountdownState extends State<_SleepCountdown> {
  late final Timer _t;
  @override
  void initState() {
    super.initState();
    _t = Timer.periodic(const Duration(seconds: 1), (_) => setState(() {}));
  }

  @override
  void dispose() {
    _t.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final left = widget.at.difference(DateTime.now());
    return Text(formatDuration(left.isNegative ? Duration.zero : left),
        style: const TextStyle(color: AppColors.coral, fontSize: 12));
  }
}

class SeekBar extends StatefulWidget {
  const SeekBar({super.key});
  @override
  State<SeekBar> createState() => _SeekBarState();
}

class _SeekBarState extends State<SeekBar> {
  double? _dragValue;

  @override
  Widget build(BuildContext context) {
    final player = context.read<PlayerState>();
    return StreamBuilder<Duration>(
      stream: player.positionStream,
      builder: (context, snap) {
        final pos = snap.data ?? Duration.zero;
        final dur = player.player.duration ?? player.current?.duration ?? Duration.zero;
        final max = dur.inMilliseconds.toDouble().clamp(1.0, double.infinity);
        final value = (_dragValue ?? pos.inMilliseconds.toDouble()).clamp(0.0, max);
        return Column(children: [
          SizedBox(
            height: 28,
            child: Slider(
              value: value,
              max: max,
              onChanged: (v) => setState(() => _dragValue = v),
              onChangeEnd: (v) {
                player.seek(Duration(milliseconds: v.round()));
                setState(() => _dragValue = null);
              },
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8),
            child: Row(children: [
              Text(formatDuration(Duration(milliseconds: value.round())),
                  style: const TextStyle(fontSize: 12, color: Colors.white70)),
              const Spacer(),
              Text(formatDuration(dur), style: const TextStyle(fontSize: 12, color: Colors.white70)),
            ]),
          ),
        ]);
      },
    );
  }
}

class _Controls extends StatelessWidget {
  const _Controls();

  @override
  Widget build(BuildContext context) {
    final player = context.watch<PlayerState>();
    return Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
      IconButton(
        tooltip: 'Aléatoire',
        icon: Icon(Icons.shuffle_rounded, color: player.shuffle ? AppColors.coral : Colors.white70),
        onPressed: player.toggleShuffle,
      ),
      IconButton(
        iconSize: 44,
        icon: const Icon(Icons.skip_previous_rounded),
        onPressed: player.previous,
      ),
      StreamBuilder<bool>(
        stream: player.playingStream,
        builder: (context, snap) {
          final playing = snap.data ?? false;
          return GestureDetector(
            onTap: player.togglePlay,
            child: Container(
              width: 72,
              height: 72,
              decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle),
              child: Icon(playing ? Icons.pause_rounded : Icons.play_arrow_rounded,
                  size: 44, color: Colors.black),
            ),
          );
        },
      ),
      IconButton(
        iconSize: 44,
        icon: const Icon(Icons.skip_next_rounded),
        onPressed: player.next,
      ),
      IconButton(
        tooltip: 'Répéter',
        icon: Icon(
          player.repeat == PlayRepeat.one ? Icons.repeat_one_rounded : Icons.repeat_rounded,
          color: player.repeat == PlayRepeat.off ? Colors.white70 : AppColors.coral,
        ),
        onPressed: player.cycleRepeat,
      ),
    ]);
  }
}

void showSleepTimer(BuildContext context) {
  final player = context.read<PlayerState>();
  showModalBottomSheet(
    context: context,
    useRootNavigator: true,
    builder: (ctx) => SafeArea(
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        const Padding(
          padding: EdgeInsets.only(bottom: 8),
          child: Text('Minuterie de mise en veille',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
        ),
        for (final m in [5, 15, 30, 45, 60, 90])
          ListTile(
            title: Text('$m minutes'),
            onTap: () {
              player.setSleepTimer(Duration(minutes: m));
              Navigator.pop(ctx);
            },
          ),
        ListTile(
          title: const Text('À la fin du titre'),
          onTap: () {
            player.setSleepTimer(null, endOfTrack: true);
            Navigator.pop(ctx);
          },
        ),
        if (player.sleepTimerActive)
          ListTile(
            title: const Text('Désactiver la minuterie', style: TextStyle(color: AppColors.coral)),
            onTap: () {
              player.setSleepTimer(null);
              Navigator.pop(ctx);
            },
          ),
        const SizedBox(height: 8),
      ]),
    ),
  );
}
