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

class PlaylistScreen extends StatefulWidget {
  const PlaylistScreen({super.key, this.playlistId, this.favorites = false});
  final String? playlistId;
  final bool favorites;

  @override
  State<PlaylistScreen> createState() => _PlaylistScreenState();
}

class _PlaylistScreenState extends State<PlaylistScreen> {
  bool _editing = false;

  @override
  Widget build(BuildContext context) {
    final lib = context.watch<LibraryState>();
    final player = context.read<PlayerState>();
    final Playlist? pl = widget.favorites ? null : lib.playlistById(widget.playlistId!);
    if (!widget.favorites && pl == null) {
      return Scaffold(appBar: AppBar(), body: const Center(child: Text('Playlist supprimée')));
    }
    final name = widget.favorites ? 'Titres aimés' : pl!.name;
    final tracks = widget.favorites ? lib.favoriteTracks : lib.playlistTracks(pl!);
    final total = tracks.fold<int>(0, (s, t) => s + (t.durationMs ?? 0));
    final arts = widget.favorites ? <String?>[] : lib.playlistArt(pl!);

    final header = CollectionHeader(
      art: widget.favorites
          ? PlaylistCover(arts: const [], size: 200, icon: Icons.favorite_rounded)
          : PlaylistCover(arts: arts, size: 200, seed: name),
      title: name,
      meta: [
        'Playlist',
        plural(tracks.length, 'titre'),
        if (total > 0) formatLongDuration(total),
      ].join(' • '),
      actions: [
        if (pl != null) ...[
          IconButton(
            tooltip: _editing ? 'Terminer' : 'Réorganiser',
            icon: Icon(_editing ? Icons.check_rounded : Icons.swap_vert_rounded),
            onPressed: () => setState(() => _editing = !_editing),
          ),
          IconButton(
            icon: const Icon(Icons.more_horiz_rounded),
            onPressed: () => showCollectionMenu(context, tracks, name, extra: [
              ListTile(
                leading: const Icon(Icons.edit_rounded),
                title: const Text('Renommer'),
                onTap: () async {
                  Navigator.of(context, rootNavigator: true).pop();
                  final n = await askPlaylistName(context, initial: pl.name, title: 'Renommer');
                  if (n != null) lib.renamePlaylist(pl, n);
                },
              ),
              ListTile(
                leading: const Icon(Icons.delete_outline_rounded, color: AppColors.coral),
                title: const Text('Supprimer la playlist'),
                onTap: () async {
                  Navigator.of(context, rootNavigator: true).pop();
                  final ok = await showDialog<bool>(
                    context: context,
                    useRootNavigator: true,
                    builder: (ctx) => AlertDialog(
                      title: const Text('Supprimer la playlist ?'),
                      content: Text('« ${pl.name} » sera supprimée. Les fichiers audio ne sont pas touchés.'),
                      actions: [
                        TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Annuler')),
                        FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Supprimer')),
                      ],
                    ),
                  );
                  if (ok == true) {
                    lib.deletePlaylist(pl);
                    if (context.mounted) Navigator.of(context).maybePop();
                  }
                },
              ),
            ]),
          ),
        ] else
          IconButton(
            icon: const Icon(Icons.more_horiz_rounded),
            onPressed: () => showCollectionMenu(context, tracks, name),
          ),
      ],
      buttons: PlayButtons(tracks: tracks, label: name),
    );

    final empty = tracks.isEmpty
        ? [
            const Padding(
              padding: EdgeInsets.all(32),
              child: Text(
                'Cette playlist est vide.\nAjoute des titres avec le menu ⋮ d\'un morceau.',
                textAlign: TextAlign.center,
                style: TextStyle(color: AppColors.textMuted),
              ),
            ),
          ]
        : <Widget>[];

    if (pl != null && _editing) {
      // On travaille sur les index de la playlist (titres manquants inclus).
      final ids = pl.trackIds;
      return CollectionScaffold(
        artPath: arts.isEmpty ? null : arts.first,
        title: name,
        header: header,
        reorderable: SliverReorderableList(
          itemCount: ids.length,
          onReorderItem: (from, to) => lib.movePlaylistItem(pl, from, to),
          itemBuilder: (ctx, i) {
            final t = lib.trackById(ids[i]);
            return Material(
              key: ValueKey('${ids[i]}#$i'),
              color: Colors.transparent,
              child: ListTile(
                leading: Artwork(path: t?.artPath, size: 44, seed: t?.title ?? ''),
                title: Text(t?.title ?? 'Fichier introuvable', maxLines: 1, overflow: TextOverflow.ellipsis),
                subtitle: Text(t?.displayArtist ?? '', maxLines: 1),
                trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                  IconButton(
                    icon: const Icon(Icons.remove_circle_outline_rounded, color: AppColors.coral),
                    onPressed: () => lib.removeFromPlaylist(pl, i),
                  ),
                  ReorderableDragStartListener(
                    index: i,
                    child: const Padding(
                      padding: EdgeInsets.all(8),
                      child: Icon(Icons.drag_handle_rounded),
                    ),
                  ),
                ]),
              ),
            );
          },
        ),
        children: empty,
      );
    }

    final indexInPlaylist = <int>[];
    if (pl != null) {
      for (var i = 0; i < pl.trackIds.length; i++) {
        if (lib.trackById(pl.trackIds[i]) != null) indexInPlaylist.add(i);
      }
    }

    return CollectionScaffold(
      artPath: widget.favorites
          ? (tracks.isEmpty ? null : tracks.first.artPath)
          : (arts.isEmpty ? null : arts.first),
      title: name,
      header: header,
      children: [
        ...empty,
        for (var i = 0; i < tracks.length; i++)
          TrackTile(
            track: tracks[i],
            playlist: pl,
            playlistIndex: pl == null ? null : indexInPlaylist[i],
            onTap: () => player.playTracks(tracks, index: i, label: name),
          ),
      ],
    );
  }
}
