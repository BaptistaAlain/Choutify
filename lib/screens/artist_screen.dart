import 'package:material_ui/material_ui.dart';
import 'package:provider/provider.dart';

import '../models/track.dart';
import '../state/library_state.dart';
import '../state/player_state.dart';
import '../theme.dart';
import '../widgets/artwork.dart';
import '../widgets/cards.dart';
import '../widgets/collection_header.dart';
import '../widgets/track_widgets.dart';
import 'album_screen.dart';
import 'track_list_screen.dart';

class ArtistScreen extends StatelessWidget {
  const ArtistScreen({super.key, required this.name});
  final String name;

  @override
  Widget build(BuildContext context) {
    final lib = context.watch<LibraryState>();
    final artist = lib.artistByName(name);
    if (artist == null) {
      return Scaffold(appBar: AppBar(), body: const Center(child: Text('Artiste introuvable')));
    }
    final player = context.read<PlayerState>();
    final popular = [...artist.tracks]
      ..sort((a, b) => (lib.playCounts[b.id] ?? 0).compareTo(lib.playCounts[a.id] ?? 0));
    final top = popular.take(5).toList();
    final loose = artist.tracks.where((t) => !t.hasAlbum).toList();
    // Albums où l'artiste apparaît sans en être l'artiste principal.
    final featured = <Album>{
      for (final t in artist.tracks)
        if (t.hasAlbum && lib.albumByKey(t.albumKey) != null &&
            !artist.albums.contains(lib.albumByKey(t.albumKey)))
          lib.albumByKey(t.albumKey)!,
    }.toList();

    return CollectionScaffold(
      artPath: artist.artPath,
      title: artist.name,
      header: CollectionHeader(
        art: Artwork(path: artist.artPath, size: 200, circle: true, seed: artist.name, icon: Icons.person_rounded),
        title: artist.name,
        meta: [
          if (artist.albums.isNotEmpty) plural(artist.albums.length, 'album'),
          plural(artist.tracks.length, 'titre'),
        ].join(' • '),
        actions: [
          IconButton(
            icon: const Icon(Icons.more_horiz_rounded),
            onPressed: () => showCollectionMenu(context, artist.tracks, artist.name),
          ),
        ],
        buttons: PlayButtons(tracks: artist.tracks, label: artist.name),
      ),
      children: [
        const SectionTitle('Populaires'),
        for (var i = 0; i < top.length; i++)
          TrackTile(
            track: top[i],
            onTap: () => player.playTracks(popular, index: i, label: artist.name),
          ),
        if (artist.tracks.length > top.length)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Align(
              alignment: Alignment.centerLeft,
              child: TextButton(
                onPressed: () => Navigator.of(context).push(MaterialPageRoute(
                    builder: (_) => TrackListScreen(
                        title: artist.name, tracksOf: (l) => l.artistByName(name)?.tracks ?? []))),
                child: Text('Voir les ${artist.tracks.length} titres'),
              ),
            ),
          ),
        if (artist.albums.isNotEmpty) ...[
          const SectionTitle('Discographie'),
          AlbumCarousel(albums: artist.albums),
        ],
        if (featured.isNotEmpty) ...[
          const SectionTitle('Apparaît sur'),
          AlbumCarousel(albums: featured),
        ],
        if (loose.isNotEmpty) ...[
          const SectionTitle('Singles et titres hors album'),
          for (var i = 0; i < loose.length; i++)
            TrackTile(track: loose[i], onTap: () => player.playTracks(loose, index: i, label: artist.name)),
        ],
      ],
    );
  }
}
