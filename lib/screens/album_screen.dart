import 'package:material_ui/material_ui.dart';
import 'package:provider/provider.dart';

import '../models/track.dart';
import '../navigation.dart';
import '../state/library_state.dart';
import '../state/player_state.dart';
import '../theme.dart';
import '../widgets/artwork.dart';
import '../widgets/collection_header.dart';
import '../widgets/track_widgets.dart';

class AlbumScreen extends StatelessWidget {
  const AlbumScreen({super.key, required this.albumKey});
  final String albumKey;

  @override
  Widget build(BuildContext context) {
    final lib = context.watch<LibraryState>();
    final album = lib.albumByKey(albumKey);
    if (album == null) {
      return Scaffold(appBar: AppBar(), body: const Center(child: Text('Album introuvable')));
    }
    final player = context.read<PlayerState>();
    final multiDisc = album.tracks.map((t) => t.discNo ?? 1).toSet().length > 1;
    final children = <Widget>[];
    int? disc;
    for (var i = 0; i < album.tracks.length; i++) {
      final t = album.tracks[i];
      if (multiDisc && t.discNo != disc) {
        disc = t.discNo;
        children.add(Padding(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 4),
          child: Row(children: [
            const Icon(Icons.album_rounded, size: 18, color: AppColors.textMuted),
            const SizedBox(width: 8),
            Text('Disque ${disc ?? 1}',
                style: const TextStyle(color: AppColors.textMuted, fontWeight: FontWeight.w700)),
          ]),
        ));
      }
      children.add(TrackTile(
        track: t,
        showArt: false,
        number: t.trackNo ?? i + 1,
        onTap: () => player.playTracks(album.tracks, index: i, label: album.title),
      ));
    }

    return CollectionScaffold(
      artPath: album.artPath,
      title: album.title,
      header: CollectionHeader(
        art: Artwork(path: album.artPath, size: 220, radius: 10, seed: album.title, icon: Icons.album_rounded),
        title: album.title,
        subtitle: GestureDetector(
          onTap: () {
            final a = lib.artistByName(album.artist);
            if (a != null) AppNav.openArtist(a);
          },
          child: Text(album.artist,
              style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
        ),
        meta: [
          if (album.isSingle && album.tracks.length == 1) 'Single' else 'Album',
          if (album.year != null) '${album.year}',
          plural(album.tracks.length, 'titre'),
          if (album.durationMs > 0) formatLongDuration(album.durationMs),
        ].join(' • '),
        actions: [
          IconButton(
            tooltip: 'Plus',
            icon: const Icon(Icons.more_horiz_rounded),
            onPressed: () => showCollectionMenu(context, album.tracks, album.title),
          ),
        ],
        buttons: PlayButtons(tracks: album.tracks, label: album.title),
      ),
      children: children,
    );
  }
}

Future<void> showCollectionMenu(BuildContext context, List<Track> tracks, String label,
    {List<Widget> extra = const []}) {
  final player = context.read<PlayerState>();
  return showModalBottomSheet(
    context: context,
    useRootNavigator: true,
    builder: (ctx) => SafeArea(
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        ListTile(
          leading: const Icon(Icons.playlist_play_rounded),
          title: const Text('Lire ensuite'),
          onTap: () {
            Navigator.pop(ctx);
            player.playNext(tracks);
            showSnack(context, 'Sera lu ensuite');
          },
        ),
        ListTile(
          leading: const Icon(Icons.queue_music_rounded),
          title: const Text('Ajouter à la file d\'attente'),
          onTap: () {
            Navigator.pop(ctx);
            player.addToQueue(tracks);
            showSnack(context, 'Ajouté à la file d\'attente');
          },
        ),
        ListTile(
          leading: const Icon(Icons.playlist_add_rounded),
          title: const Text('Ajouter à une playlist'),
          onTap: () {
            Navigator.pop(ctx);
            showAddToPlaylist(context, tracks);
          },
        ),
        ...extra,
        const SizedBox(height: 8),
      ]),
    ),
  );
}
