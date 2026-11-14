import 'package:material_ui/material_ui.dart';
import 'package:provider/provider.dart';

import '../navigation.dart';
import '../services/library_scanner.dart';
import '../state/library_state.dart';
import '../state/player_state.dart';
import '../theme.dart';
import '../widgets/artwork.dart';
import '../widgets/cards.dart';
import '../widgets/track_widgets.dart';
import 'track_list_screen.dart';

class SearchScreen extends StatefulWidget {
  const SearchScreen({super.key});

  @override
  State<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends State<SearchScreen> {
  final _ctrl = TextEditingController();
  String _query = '';

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  static const _tileColors = [
    Color(0xFF8B5CF6), Color(0xFFFF6A88), Color(0xFF22C3A6), Color(0xFFFFB547),
    Color(0xFF4F8CFF), Color(0xFFE357D8), Color(0xFF2FB36B), Color(0xFFFF7A45),
  ];

  @override
  Widget build(BuildContext context) {
    final lib = context.watch<LibraryState>();
    final player = context.read<PlayerState>();
    final r = lib.search(_query);

    return Scaffold(
      appBar: AppBar(title: const Text('Rechercher')),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
          child: TextField(
            controller: _ctrl,
            onChanged: (v) => setState(() => _query = v),
            textInputAction: TextInputAction.search,
            style: const TextStyle(color: Colors.black87, fontWeight: FontWeight.w600),
            decoration: InputDecoration(
              filled: true,
              fillColor: Colors.white,
              hintText: 'Titres, artistes, albums, playlists',
              hintStyle: const TextStyle(color: Colors.black45),
              prefixIcon: const Icon(Icons.search_rounded, color: Colors.black87),
              suffixIcon: _query.isEmpty
                  ? null
                  : IconButton(
                      icon: const Icon(Icons.close_rounded, color: Colors.black54),
                      onPressed: () => setState(() {
                        _ctrl.clear();
                        _query = '';
                      }),
                    ),
              border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
              contentPadding: const EdgeInsets.symmetric(vertical: 12),
            ),
          ),
        ),
        Expanded(
          child: _query.trim().isEmpty
              ? _browse(lib)
              : r.isEmpty
                  ? Center(
                      child: Padding(
                        padding: const EdgeInsets.all(32),
                        child: Text('Aucun résultat pour « $_query »',
                            textAlign: TextAlign.center,
                            style: const TextStyle(color: AppColors.textMuted)),
                      ),
                    )
                  : ListView(
                      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                      children: [
                        if (r.artists.isNotEmpty) ...[
                          const SectionTitle('Artistes'),
                          SizedBox(
                            height: 150,
                            child: ListView.separated(
                              scrollDirection: Axis.horizontal,
                              padding: const EdgeInsets.symmetric(horizontal: 20),
                              itemCount: r.artists.length,
                              separatorBuilder: (_, _) => const SizedBox(width: 16),
                              itemBuilder: (_, i) => ArtistCircle(artist: r.artists[i]),
                            ),
                          ),
                        ],
                        if (r.tracks.isNotEmpty) ...[
                          const SectionTitle('Titres'),
                          for (var i = 0; i < r.tracks.length && i < 20; i++)
                            TrackTile(
                              track: r.tracks[i],
                              onTap: () => player.playTracks([r.tracks[i]], label: r.tracks[i].title),
                            ),
                        ],
                        if (r.albums.isNotEmpty) ...[
                          const SectionTitle('Albums'),
                          AlbumCarousel(albums: r.albums),
                        ],
                        if (r.playlists.isNotEmpty) ...[
                          const SectionTitle('Playlists'),
                          for (final pl in r.playlists)
                            ListTile(
                              leading: PlaylistCover(arts: lib.playlistArt(pl), size: 48, seed: pl.name),
                              title: Text(pl.name),
                              subtitle: Text(plural(pl.trackIds.length, 'titre')),
                              onTap: () => AppNav.openPlaylist(pl.id),
                            ),
                        ],
                        const SizedBox(height: 24),
                      ],
                    ),
        ),
      ]),
    );
  }

  Widget _browse(LibraryState lib) {
    final genres = lib.genres.entries.toList()
      ..sort((a, b) => b.value.length.compareTo(a.value.length));
    if (genres.isEmpty) {
      return const Center(
        child: Text('Tape pour chercher dans ta bibliothèque',
            style: TextStyle(color: AppColors.textMuted)),
      );
    }
    return CustomScrollView(slivers: [
      const SliverToBoxAdapter(child: SectionTitle('Parcourir les genres')),
      SliverPadding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
        sliver: SliverGrid(
          gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
            maxCrossAxisExtent: 220,
            mainAxisExtent: 96,
            crossAxisSpacing: 12,
            mainAxisSpacing: 12,
          ),
          delegate: SliverChildBuilderDelegate(
            childCount: genres.length,
            (context, i) {
              final g = genres[i];
              final color = _tileColors[
                  int.parse(stableHash(g.key).substring(0, 2), radix: 16) % _tileColors.length];
              final art = g.value.map((t) => t.artPath).whereType<String>().firstOrNull;
              return Material(
                color: color,
                borderRadius: BorderRadius.circular(12),
                clipBehavior: Clip.antiAlias,
                child: InkWell(
                  onTap: () => Navigator.of(context).push(MaterialPageRoute(
                    builder: (_) => TrackListScreen(
                      title: g.key,
                      icon: Icons.category_rounded,
                      tracksOf: (l) => l.genres[g.key] ?? [],
                    ),
                  )),
                  child: Stack(children: [
                    Positioned(
                      right: -14,
                      bottom: -8,
                      child: Transform.rotate(
                        angle: 0.42,
                        child: Artwork(path: art, size: 70, radius: 6, seed: g.key),
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.all(12),
                      child: Text(g.key,
                          maxLines: 2,
                          style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                    ),
                  ]),
                ),
              );
            },
          ),
        ),
      ),
    ]);
  }
}
