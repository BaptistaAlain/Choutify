import 'package:material_ui/material_ui.dart';
import 'package:provider/provider.dart';

import '../models/track.dart';
import '../navigation.dart';
import '../state/library_state.dart';
import '../state/player_state.dart';
import '../theme.dart';
import 'artwork.dart';

class TrackTile extends StatelessWidget {
  const TrackTile({
    super.key,
    required this.track,
    required this.onTap,
    this.number,
    this.showArt = true,
    this.playlist,
    this.playlistIndex,
    this.trailing,
  });

  final Track track;
  final VoidCallback onTap;
  final int? number;
  final bool showArt;
  final Playlist? playlist;
  final int? playlistIndex;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final player = context.watch<PlayerState>();
    final isCurrent = player.current?.id == track.id;
    final color = isCurrent ? AppColors.coral : Colors.white;
    Widget? leading;
    if (showArt) {
      leading = Artwork(path: track.artPath, size: 48, radius: 6, seed: track.album ?? track.title);
    } else if (number != null) {
      leading = SizedBox(
        width: 28,
        child: isCurrent
            ? const Icon(Icons.graphic_eq_rounded, color: AppColors.coral, size: 20)
            : Text('$number',
                textAlign: TextAlign.center,
                style: const TextStyle(color: AppColors.textMuted, fontSize: 15)),
      );
    }
    return ListTile(
      onTap: onTap,
      onLongPress: () => showTrackMenu(context, track,
          playlist: playlist, playlistIndex: playlistIndex),
      leading: leading,
      minLeadingWidth: 28,
      title: Text(track.title,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(color: color, fontWeight: FontWeight.w600, fontSize: 15)),
      subtitle: Text(
        [
          track.displayArtist,
          if (showArt && track.hasAlbum) track.album!,
        ].join(' • '),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(color: AppColors.textMuted, fontSize: 13),
      ),
      trailing: trailing ??
          IconButton(
            icon: const Icon(Icons.more_vert_rounded, color: AppColors.textMuted),
            onPressed: () => showTrackMenu(context, track,
                playlist: playlist, playlistIndex: playlistIndex),
          ),
    );
  }
}

void showSnack(BuildContext context, String message) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(message), duration: const Duration(seconds: 2)));
}

Future<void> showTrackMenu(BuildContext context, Track track,
    {Playlist? playlist, int? playlistIndex}) {
  final lib = context.read<LibraryState>();
  final player = context.read<PlayerState>();
  return showModalBottomSheet(
    context: context,
    useRootNavigator: true,
    isScrollControlled: true,
    builder: (ctx) {
      final fav = lib.isFavorite(track);
      return SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: Artwork(path: track.artPath, size: 52, seed: track.album ?? track.title),
              title: Text(track.title,
                  maxLines: 1, overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontWeight: FontWeight.w700)),
              subtitle: Text(track.displayArtist, maxLines: 1, overflow: TextOverflow.ellipsis),
            ),
            const Divider(height: 8),
            _MenuItem(
              icon: fav ? Icons.favorite_rounded : Icons.favorite_border_rounded,
              label: fav ? 'Retirer des titres aimés' : 'Ajouter aux titres aimés',
              color: fav ? AppColors.coral : null,
              onTap: () {
                Navigator.pop(ctx);
                lib.toggleFavorite(track);
              },
            ),
            _MenuItem(
              icon: Icons.playlist_play_rounded,
              label: 'Lire ensuite',
              onTap: () {
                Navigator.pop(ctx);
                player.playNext([track]);
                showSnack(context, 'Sera lu ensuite');
              },
            ),
            _MenuItem(
              icon: Icons.queue_music_rounded,
              label: 'Ajouter à la file d\'attente',
              onTap: () {
                Navigator.pop(ctx);
                player.addToQueue([track]);
                showSnack(context, 'Ajouté à la file d\'attente');
              },
            ),
            _MenuItem(
              icon: Icons.playlist_add_rounded,
              label: 'Ajouter à une playlist',
              onTap: () {
                Navigator.pop(ctx);
                showAddToPlaylist(context, [track]);
              },
            ),
            if (playlist != null && playlistIndex != null)
              _MenuItem(
                icon: Icons.remove_circle_outline_rounded,
                label: 'Retirer de cette playlist',
                onTap: () {
                  Navigator.pop(ctx);
                  lib.removeFromPlaylist(playlist, playlistIndex);
                },
              ),
            if (track.hasAlbum && lib.albumByKey(track.albumKey) != null)
              _MenuItem(
                icon: Icons.album_rounded,
                label: 'Voir l\'album',
                onTap: () {
                  Navigator.pop(ctx);
                  AppNav.openAlbum(lib.albumByKey(track.albumKey)!);
                },
              ),
            for (final name in {track.mainArtist, ...track.artistNames}.take(3))
              if (lib.artistByName(name) != null)
                _MenuItem(
                  icon: Icons.person_rounded,
                  label: 'Voir $name',
                  onTap: () {
                    Navigator.pop(ctx);
                    AppNav.openArtist(lib.artistByName(name)!);
                  },
                ),
            _MenuItem(
              icon: Icons.info_outline_rounded,
              label: 'Informations',
              onTap: () {
                Navigator.pop(ctx);
                showTrackInfo(context, track);
              },
            ),
            const SizedBox(height: 8),
          ],
        ),
      );
    },
  );
}

class _MenuItem extends StatelessWidget {
  const _MenuItem({required this.icon, required this.label, required this.onTap, this.color});
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final Color? color;

  @override
  Widget build(BuildContext context) => ListTile(
        leading: Icon(icon, color: color),
        title: Text(label),
        onTap: onTap,
        dense: true,
        visualDensity: const VisualDensity(vertical: 1),
      );
}

void showTrackInfo(BuildContext context, Track t) {
  final rows = <(String, String?)>[
    ('Titre', t.title),
    ('Artiste', t.artist),
    ('Album', t.album),
    ('Artiste de l\'album', t.albumArtist),
    ('Genre', t.genre),
    ('Année', t.year?.toString()),
    ('Piste', t.trackNo?.toString()),
    ('Disque', t.discNo?.toString()),
    ('Durée', t.durationMs == null ? null : formatDuration(t.duration)),
    ('Taille', '${(t.size / 1024 / 1024).toStringAsFixed(1)} Mo'),
    ('Fichier', t.path),
  ];
  showDialog(
    context: context,
    useRootNavigator: true,
    builder: (ctx) => AlertDialog(
      title: const Text('Informations'),
      content: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            for (final r in rows)
              if (r.$2 != null && r.$2!.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(r.$1, style: const TextStyle(color: AppColors.textMuted, fontSize: 12)),
                      SelectableText(r.$2!),
                    ],
                  ),
                ),
          ],
        ),
      ),
      actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Fermer'))],
    ),
  );
}

Future<String?> askPlaylistName(BuildContext context, {String initial = '', String title = 'Nouvelle playlist'}) {
  final ctrl = TextEditingController(text: initial);
  return showDialog<String>(
    context: context,
    useRootNavigator: true,
    builder: (ctx) => AlertDialog(
      title: Text(title),
      content: TextField(
        controller: ctrl,
        autofocus: true,
        textCapitalization: TextCapitalization.sentences,
        decoration: const InputDecoration(hintText: 'Nom de la playlist'),
        onSubmitted: (v) => Navigator.pop(ctx, v.trim()),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Annuler')),
        FilledButton(
            onPressed: () => Navigator.pop(ctx, ctrl.text.trim()),
            child: const Text('Valider')),
      ],
    ),
  ).then((v) => (v == null || v.isEmpty) ? null : v);
}

Future<void> showAddToPlaylist(BuildContext context, List<Track> tracks) {
  final lib = context.read<LibraryState>();
  return showModalBottomSheet(
    context: context,
    useRootNavigator: true,
    isScrollControlled: true,
    builder: (ctx) => SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(ctx).height * 0.7),
        child: ListView(
          shrinkWrap: true,
          children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(20, 0, 20, 8),
              child: Text('Ajouter à une playlist',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
            ),
            ListTile(
              leading: Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(
                    color: AppColors.surfaceHigh, borderRadius: BorderRadius.circular(8)),
                child: const Icon(Icons.add_rounded),
              ),
              title: const Text('Nouvelle playlist'),
              onTap: () async {
                Navigator.pop(ctx);
                final name = await askPlaylistName(context);
                if (name != null) {
                  lib.createPlaylist(name, tracks);
                  if (context.mounted) showSnack(context, 'Ajouté à « $name »');
                }
              },
            ),
            for (final pl in lib.playlists)
              ListTile(
                leading: PlaylistCover(arts: lib.playlistArt(pl), size: 48, seed: pl.name),
                title: Text(pl.name),
                subtitle: Text(plural(pl.trackIds.length, 'titre')),
                onTap: () {
                  Navigator.pop(ctx);
                  final n = lib.addToPlaylist(pl, tracks);
                  showSnack(context,
                      n == 0 ? 'Déjà dans « ${pl.name} »' : 'Ajouté à « ${pl.name} »');
                },
              ),
          ],
        ),
      ),
    ),
  );
}

/// Bouton rond Lecture + bouton aléatoire utilisés en tête des listes.
class PlayButtons extends StatelessWidget {
  const PlayButtons({super.key, required this.tracks, required this.label});
  final List<Track> tracks;
  final String label;

  @override
  Widget build(BuildContext context) {
    final player = context.read<PlayerState>();
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        IconButton(
          tooltip: 'Lecture aléatoire',
          iconSize: 28,
          icon: const Icon(Icons.shuffle_rounded),
          onPressed: tracks.isEmpty
              ? null
              : () => player.playTracks(tracks, label: label, shuffled: true),
        ),
        const SizedBox(width: 4),
        GestureDetector(
          onTap: tracks.isEmpty
              ? null
              : () => player.playTracks(tracks, label: label, shuffled: false),
          child: Container(
            width: 56,
            height: 56,
            decoration: const BoxDecoration(
                shape: BoxShape.circle, gradient: AppColors.brandGradient),
            child: const Icon(Icons.play_arrow_rounded, size: 34, color: Colors.white),
          ),
        ),
      ],
    );
  }
}
