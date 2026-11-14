import 'package:material_ui/material_ui.dart';
import 'package:provider/provider.dart';

import '../models/track.dart';
import '../state/library_state.dart';
import '../state/player_state.dart';
import '../theme.dart';
import '../widgets/artwork.dart';
import '../widgets/collection_header.dart';
import '../widgets/track_widgets.dart';
import 'album_screen.dart';

typedef TracksOf = List<Track> Function(LibraryState lib);

/// Liste de titres générique (tous les titres d'un artiste, un genre, un dossier).
class TrackListScreen extends StatelessWidget {
  const TrackListScreen({
    super.key,
    required this.title,
    required this.tracksOf,
    this.icon = Icons.music_note_rounded,
    this.subtitle,
  });

  final String title;
  final TracksOf tracksOf;
  final IconData icon;
  final String? subtitle;

  @override
  Widget build(BuildContext context) {
    final lib = context.watch<LibraryState>();
    final player = context.read<PlayerState>();
    final tracks = tracksOf(lib);
    final art = tracks.map((t) => t.artPath).whereType<String>().toSet().take(4).toList();
    final total = tracks.fold<int>(0, (s, t) => s + (t.durationMs ?? 0));
    return CollectionScaffold(
      artPath: art.isEmpty ? null : art.first,
      title: title,
      header: CollectionHeader(
        art: art.length >= 4
            ? PlaylistCover(arts: art, size: 200, seed: title)
            : Artwork(path: art.isEmpty ? null : art.first, size: 200, seed: title, icon: icon),
        title: title,
        subtitle: subtitle == null
            ? null
            : Text(subtitle!, style: const TextStyle(color: AppColors.textMuted, fontSize: 12)),
        meta: [plural(tracks.length, 'titre'), if (total > 0) formatLongDuration(total)].join(' • '),
        actions: [
          IconButton(
            icon: const Icon(Icons.more_horiz_rounded),
            onPressed: () => showCollectionMenu(context, tracks, title),
          ),
        ],
        buttons: PlayButtons(tracks: tracks, label: title),
      ),
      children: [
        for (var i = 0; i < tracks.length; i++)
          TrackTile(
            track: tracks[i],
            onTap: () => player.playTracks(tracks, index: i, label: title),
          ),
      ],
    );
  }
}
