import 'package:material_ui/material_ui.dart';
import 'package:provider/provider.dart';

import '../screens/now_playing.dart';
import '../state/player_state.dart';
import '../theme.dart';
import 'artwork.dart';

class MiniPlayer extends StatefulWidget {
  const MiniPlayer({super.key});

  @override
  State<MiniPlayer> createState() => _MiniPlayerState();
}

class _MiniPlayerState extends State<MiniPlayer> {
  Color _color = AppColors.surfaceHigh;
  String? _for;

  @override
  Widget build(BuildContext context) {
    final player = context.watch<PlayerState>();
    final t = player.current;
    if (t == null) return const SizedBox.shrink();
    if (_for != t.artPath) {
      _for = t.artPath;
      ArtColors.dominant(t.artPath).then((c) {
        if (mounted) setState(() => _color = Color.lerp(c, AppColors.surfaceHigh, 0.35)!);
      });
    }
    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 0, 8, 4),
      child: GestureDetector(
        onTap: () => openNowPlaying(context),
        onVerticalDragEnd: (d) {
          if (d.velocity.pixelsPerSecond.dy < -200) openNowPlaying(context);
        },
        onHorizontalDragEnd: (d) {
          final v = d.velocity.pixelsPerSecond.dx;
          if (v < -300) player.next();
          if (v > 300) player.previous();
        },
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 400),
          height: 60,
          decoration: BoxDecoration(color: _color, borderRadius: BorderRadius.circular(10)),
          clipBehavior: Clip.antiAlias,
          child: Column(children: [
            Expanded(
              child: Row(children: [
                const SizedBox(width: 8),
                Artwork(path: t.artPath, size: 44, radius: 6, seed: t.album ?? t.title),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(t.title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
                      Text(t.displayArtist,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(color: Colors.white70, fontSize: 12)),
                    ],
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.skip_previous_rounded),
                  onPressed: player.previous,
                ),
                StreamBuilder<bool>(
                  stream: player.playingStream,
                  builder: (_, snap) => IconButton(
                    iconSize: 32,
                    icon: Icon((snap.data ?? false) ? Icons.pause_rounded : Icons.play_arrow_rounded),
                    onPressed: player.togglePlay,
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.skip_next_rounded),
                  onPressed: player.next,
                ),
                const SizedBox(width: 2),
              ]),
            ),
            StreamBuilder<Duration>(
              stream: player.positionStream,
              builder: (_, snap) {
                final dur = player.player.duration ?? t.duration;
                final v = (dur == null || dur.inMilliseconds == 0)
                    ? 0.0
                    : ((snap.data?.inMilliseconds ?? 0) / dur.inMilliseconds).clamp(0.0, 1.0);
                return LinearProgressIndicator(
                  value: v,
                  minHeight: 2,
                  backgroundColor: Colors.white12,
                  valueColor: const AlwaysStoppedAnimation(Colors.white),
                );
              },
            ),
          ]),
        ),
      ),
    );
  }
}
