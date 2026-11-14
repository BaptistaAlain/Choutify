import 'package:material_ui/material_ui.dart';
import 'package:provider/provider.dart';

import '../models/track.dart';
import '../navigation.dart';
import '../state/library_state.dart';
import '../state/player_state.dart';
import '../theme.dart';
import '../widgets/artwork.dart';
import '../widgets/cards.dart';
import '../widgets/track_widgets.dart';
import 'settings_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final int _seed = DateTime.now().day;

  String get _greeting {
    final h = DateTime.now().hour;
    if (h < 5) return 'Bonne nuit';
    if (h < 12) return 'Bonjour';
    if (h < 18) return 'Bon après-midi';
    return 'Bonsoir';
  }

  @override
  Widget build(BuildContext context) {
    final lib = context.watch<LibraryState>();
    final player = context.read<PlayerState>();

    final quick = <Widget>[
      _QuickTile(
        title: 'Titres aimés',
        leading: const PlaylistCover(arts: [], size: 52, icon: Icons.favorite_rounded),
        onTap: AppNav.openFavorites,
      ),
      for (final item in lib.recentlyPlayedItems.take(5))
        if (item is Album)
          _QuickTile(
            title: item.title,
            leading: Artwork(path: item.artPath, size: 52, radius: 0, seed: item.title),
            onTap: () => AppNav.openAlbum(item),
          )
        else if (item is Track)
          _QuickTile(
            title: item.title,
            leading: Artwork(path: item.artPath, size: 52, radius: 0, seed: item.title),
            onTap: () => player.playTracks([item]),
          ),
      for (final pl in lib.playlists.take(2))
        _QuickTile(
          title: pl.name,
          leading: PlaylistCover(arts: lib.playlistArt(pl), size: 52, seed: pl.name),
          onTap: () => AppNav.openPlaylist(pl.id),
        ),
    ].take(8).toList();

    return Scaffold(
      body: RefreshIndicator(
        onRefresh: () => lib.rescan(),
        child: CustomScrollView(
          slivers: [
            SliverAppBar(
              floating: true,
              title: Text(_greeting),
              actions: [
                IconButton(
                  tooltip: 'Paramètres',
                  icon: const Icon(Icons.settings_outlined),
                  onPressed: () => Navigator.of(context)
                      .push(MaterialPageRoute(builder: (_) => const SettingsScreen())),
                ),
              ],
            ),
            if (lib.scanning) SliverToBoxAdapter(child: ScanBanner(lib: lib)),
            if (lib.isEmpty && !lib.scanning)
              const SliverFillRemaining(hasScrollBody: false, child: EmptyLibrary())
            else ...[
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                sliver: SliverGrid(
                  gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                    maxCrossAxisExtent: 260,
                    mainAxisExtent: 56,
                    crossAxisSpacing: 8,
                    mainAxisSpacing: 8,
                  ),
                  delegate: SliverChildListDelegate(quick),
                ),
              ),
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
                  child: _ShuffleAllCard(count: lib.tracks.length, onTap: () {
                    player.playTracks(lib.tracks, label: 'Toute la musique', shuffled: true);
                  }),
                ),
              ),
              if (lib.recentlyAddedAlbums.isNotEmpty) ...[
                const SliverToBoxAdapter(child: SectionTitle('Ajoutés récemment')),
                SliverToBoxAdapter(child: AlbumCarousel(albums: lib.recentlyAddedAlbums)),
              ],
              if (lib.mostPlayed.isNotEmpty) ...[
                const SliverToBoxAdapter(child: SectionTitle('Vos titres favoris du moment')),
                SliverList.builder(
                  itemCount: lib.mostPlayed.take(5).length,
                  itemBuilder: (_, i) => TrackTile(
                    track: lib.mostPlayed[i],
                    onTap: () => player.playTracks(lib.mostPlayed, index: i, label: 'Les plus écoutés'),
                  ),
                ),
              ],
              if (lib.topArtists.isNotEmpty) ...[
                const SliverToBoxAdapter(child: SectionTitle('Vos artistes')),
                SliverToBoxAdapter(
                  child: SizedBox(
                    height: 150,
                    child: ListView.separated(
                      scrollDirection: Axis.horizontal,
                      padding: const EdgeInsets.symmetric(horizontal: 20),
                      itemCount: lib.topArtists.length,
                      separatorBuilder: (_, _) => const SizedBox(width: 16),
                      itemBuilder: (_, i) => ArtistCircle(artist: lib.topArtists[i]),
                    ),
                  ),
                ),
              ],
              if (lib.albums.length > 3) ...[
                const SliverToBoxAdapter(child: SectionTitle('À redécouvrir')),
                SliverToBoxAdapter(child: AlbumCarousel(albums: lib.discoverAlbums(_seed))),
              ],
              const SliverToBoxAdapter(child: SizedBox(height: 32)),
            ],
          ],
        ),
      ),
    );
  }
}

class _QuickTile extends StatelessWidget {
  const _QuickTile({required this.title, required this.leading, required this.onTap});
  final String title;
  final Widget leading;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Material(
        color: AppColors.surfaceHigh,
        borderRadius: BorderRadius.circular(8),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Row(children: [
            SizedBox(width: 56, height: 56, child: FittedBox(fit: BoxFit.cover, child: leading)),
            const SizedBox(width: 10),
            Expanded(
              child: Text(title,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
            ),
            const SizedBox(width: 8),
          ]),
        ),
      );
}

class _ShuffleAllCard extends StatelessWidget {
  const _ShuffleAllCard({required this.count, required this.onTap});
  final int count;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Material(
        borderRadius: BorderRadius.circular(16),
        clipBehavior: Clip.antiAlias,
        child: Ink(
          decoration: const BoxDecoration(gradient: AppColors.brandGradient),
          child: InkWell(
            onTap: onTap,
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Row(children: [
                const Icon(Icons.shuffle_rounded, size: 32, color: Colors.white),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    const Text('Lecture aléatoire',
                        style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: Colors.white)),
                    Text('Toute votre musique • ${plural(count, 'titre')}',
                        style: TextStyle(color: Colors.white.withValues(alpha: 0.85), fontSize: 13)),
                  ]),
                ),
                const Icon(Icons.play_circle_fill_rounded, size: 40, color: Colors.white),
              ]),
            ),
          ),
        ),
      );
}

class ScanBanner extends StatelessWidget {
  const ScanBanner({super.key, required this.lib});
  final LibraryState lib;

  @override
  Widget build(BuildContext context) {
    final p = lib.progress;
    final value = (p == null || p.total == 0) ? null : p.done / p.total;
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 4, 20, 8),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(
          p == null
              ? 'Analyse de la bibliothèque…'
              : p.total == 0
                  ? p.phase
                  : '${p.phase} ${p.done}/${p.total}',
          style: const TextStyle(color: AppColors.textMuted, fontSize: 12),
        ),
        const SizedBox(height: 6),
        ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: LinearProgressIndicator(value: value, minHeight: 4),
        ),
      ]),
    );
  }
}

class EmptyLibrary extends StatelessWidget {
  const EmptyLibrary({super.key});

  @override
  Widget build(BuildContext context) {
    final lib = context.watch<LibraryState>();
    return Padding(
      padding: const EdgeInsets.all(32),
      child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
        const Icon(Icons.library_music_outlined, size: 72, color: AppColors.textMuted),
        const SizedBox(height: 16),
        const Text('Aucun titre trouvé',
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
        const SizedBox(height: 8),
        Text(
          lib.lastError ??
              'Choisis le dossier qui contient ta musique dans les paramètres, '
                  'puis lance une analyse.',
          textAlign: TextAlign.center,
          style: const TextStyle(color: AppColors.textMuted),
        ),
        const SizedBox(height: 20),
        FilledButton.icon(
          icon: const Icon(Icons.folder_open_rounded),
          label: const Text('Gérer mes dossiers'),
          onPressed: () => Navigator.of(context)
              .push(MaterialPageRoute(builder: (_) => const SettingsScreen())),
        ),
      ]),
    );
  }
}
