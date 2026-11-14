import 'package:material_ui/material_ui.dart';
import 'package:path/path.dart' as p;
import 'package:provider/provider.dart';

import '../navigation.dart';
import '../state/library_state.dart';
import '../state/player_state.dart';
import '../theme.dart';
import '../widgets/artwork.dart';
import '../widgets/cards.dart';
import '../widgets/track_widgets.dart';
import 'track_list_screen.dart';

enum LibraryView { playlists, albums, artists, tracks, folders }

class LibraryScreen extends StatefulWidget {
  const LibraryScreen({super.key});

  @override
  State<LibraryScreen> createState() => _LibraryScreenState();
}

class _LibraryScreenState extends State<LibraryScreen> {
  LibraryView _view = LibraryView.playlists;
  TrackSort _trackSort = TrackSort.title;
  AlbumSort _albumSort = AlbumSort.title;

  @override
  void initState() {
    super.initState();
    final prefs = context.read<LibraryState>().prefs;
    _view = LibraryView.values[(prefs.getInt('libView') ?? 0).clamp(0, LibraryView.values.length - 1)];
    _trackSort = TrackSort.values[(prefs.getInt('trackSort') ?? 0).clamp(0, TrackSort.values.length - 1)];
    _albumSort = AlbumSort.values[(prefs.getInt('albumSort') ?? 0).clamp(0, AlbumSort.values.length - 1)];
  }

  void _setView(LibraryView v) {
    setState(() => _view = v);
    context.read<LibraryState>().prefs.setInt('libView', v.index);
  }

  static const _labels = {
    LibraryView.playlists: 'Playlists',
    LibraryView.albums: 'Albums',
    LibraryView.artists: 'Artistes',
    LibraryView.tracks: 'Titres',
    LibraryView.folders: 'Dossiers',
  };

  @override
  Widget build(BuildContext context) {
    final lib = context.watch<LibraryState>();
    return Scaffold(
      appBar: AppBar(
        title: const Text('Bibliothèque'),
        actions: [
          if (_view == LibraryView.tracks || _view == LibraryView.albums)
            IconButton(tooltip: 'Trier', icon: const Icon(Icons.sort_rounded), onPressed: _pickSort),
          IconButton(
            tooltip: 'Nouvelle playlist',
            icon: const Icon(Icons.add_rounded),
            onPressed: () async {
              final name = await askPlaylistName(context);
              if (name != null) {
                final pl = lib.createPlaylist(name);
                AppNav.openPlaylist(pl.id);
              }
            },
          ),
        ],
      ),
      body: Column(children: [
        SizedBox(
          height: 48,
          child: ListView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            children: [
              for (final v in LibraryView.values)
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ChoiceChip(
                    label: Text(_labels[v]!),
                    selected: _view == v,
                    showCheckmark: false,
                    onSelected: (_) => _setView(v),
                  ),
                ),
            ],
          ),
        ),
        Expanded(child: _body(lib)),
      ]),
    );
  }

  Widget _body(LibraryState lib) {
    final player = context.read<PlayerState>();
    switch (_view) {
      case LibraryView.playlists:
        return ListView(children: [
          ListTile(
            leading: const PlaylistCover(arts: [], size: 56, icon: Icons.favorite_rounded),
            title: const Text('Titres aimés', style: TextStyle(fontWeight: FontWeight.w700)),
            subtitle: Text('Playlist • ${plural(lib.favoriteTracks.length, 'titre')}'),
            onTap: AppNav.openFavorites,
          ),
          for (final pl in lib.playlists)
            ListTile(
              leading: PlaylistCover(arts: lib.playlistArt(pl), size: 56, seed: pl.name),
              title: Text(pl.name, style: const TextStyle(fontWeight: FontWeight.w700)),
              subtitle: Text('Playlist • ${plural(pl.trackIds.length, 'titre')}'),
              onTap: () => AppNav.openPlaylist(pl.id),
            ),
          if (lib.playlists.isEmpty)
            const Padding(
              padding: EdgeInsets.all(24),
              child: Text('Crée ta première playlist avec le bouton +',
                  textAlign: TextAlign.center, style: TextStyle(color: AppColors.textMuted)),
            ),
        ]);
      case LibraryView.albums:
        final albums = lib.sortedAlbums(_albumSort);
        if (albums.isEmpty) return _empty('Aucun album');
        return AlbumGrid(albums: albums);
      case LibraryView.artists:
        if (lib.artists.isEmpty) return _empty('Aucun artiste');
        return ListView.builder(
          itemCount: lib.artists.length,
          itemBuilder: (_, i) {
            final a = lib.artists[i];
            return ListTile(
              leading: Artwork(path: a.artPath, size: 56, circle: true, seed: a.name, icon: Icons.person_rounded),
              title: Text(a.name, style: const TextStyle(fontWeight: FontWeight.w700)),
              subtitle: Text([
                if (a.albums.isNotEmpty) plural(a.albums.length, 'album'),
                plural(a.tracks.length, 'titre'),
              ].join(' • ')),
              onTap: () => AppNav.openArtist(a),
            );
          },
        );
      case LibraryView.tracks:
        final tracks = lib.sortedTracks(_trackSort);
        if (tracks.isEmpty) return _empty('Aucun titre');
        return ListView.builder(
          itemCount: tracks.length + 1,
          itemBuilder: (_, i) {
            if (i == 0) {
              return Padding(
                padding: const EdgeInsets.fromLTRB(20, 4, 12, 4),
                child: Row(children: [
                  Text(plural(tracks.length, 'titre'),
                      style: const TextStyle(color: AppColors.textMuted)),
                  const Spacer(),
                  PlayButtons(tracks: tracks, label: 'Tous les titres'),
                ]),
              );
            }
            return TrackTile(
              track: tracks[i - 1],
              onTap: () => player.playTracks(tracks, index: i - 1, label: 'Tous les titres'),
            );
          },
        );
      case LibraryView.folders:
        final folders = lib.folderGroups.entries.toList();
        if (folders.isEmpty) return _empty('Aucun dossier');
        return ListView.builder(
          itemCount: folders.length,
          itemBuilder: (_, i) {
            final f = folders[i];
            final art = f.value.map((t) => t.artPath).whereType<String>().firstOrNull;
            return ListTile(
              leading: Artwork(path: art, size: 56, seed: f.key, icon: Icons.folder_rounded),
              title: Text(p.basename(f.key), style: const TextStyle(fontWeight: FontWeight.w700)),
              subtitle: Text(plural(f.value.length, 'titre')),
              onTap: () => Navigator.of(context).push(MaterialPageRoute(
                builder: (_) => TrackListScreen(
                  title: p.basename(f.key),
                  subtitle: f.key,
                  icon: Icons.folder_rounded,
                  tracksOf: (l) => l.folderGroups[f.key] ?? [],
                ),
              )),
            );
          },
        );
    }
  }

  Widget _empty(String text) => Center(
        child: Text(text, style: const TextStyle(color: AppColors.textMuted)),
      );

  void _pickSort() {
    final prefs = context.read<LibraryState>().prefs;
    showModalBottomSheet(
      context: context,
      useRootNavigator: true,
      builder: (ctx) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          const Padding(
            padding: EdgeInsets.only(bottom: 8),
            child: Text('Trier par', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
          ),
          if (_view == LibraryView.tracks)
            for (final (s, label) in [
              (TrackSort.title, 'Titre'),
              (TrackSort.artist, 'Artiste'),
              (TrackSort.album, 'Album'),
              (TrackSort.recent, 'Ajout récent'),
              (TrackSort.duration, 'Durée'),
            ])
              ListTile(
                title: Text(label),
                trailing: _trackSort == s ? const Icon(Icons.check_rounded, color: AppColors.coral) : null,
                onTap: () {
                  setState(() => _trackSort = s);
                  prefs.setInt('trackSort', s.index);
                  Navigator.pop(ctx);
                },
              )
          else
            for (final (s, label) in [
              (AlbumSort.title, 'Titre'),
              (AlbumSort.artist, 'Artiste'),
              (AlbumSort.year, 'Année'),
              (AlbumSort.recent, 'Ajout récent'),
            ])
              ListTile(
                title: Text(label),
                trailing: _albumSort == s ? const Icon(Icons.check_rounded, color: AppColors.coral) : null,
                onTap: () {
                  setState(() => _albumSort = s);
                  prefs.setInt('albumSort', s.index);
                  Navigator.pop(ctx);
                },
              ),
          const SizedBox(height: 8),
        ]),
      ),
    );
  }
}
