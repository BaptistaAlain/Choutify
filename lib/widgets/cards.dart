import 'package:material_ui/material_ui.dart';

import '../models/track.dart';
import '../navigation.dart';
import '../theme.dart';
import 'artwork.dart';

class SectionTitle extends StatelessWidget {
  const SectionTitle(this.text, {super.key, this.action});
  final String text;
  final Widget? action;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(20, 24, 12, 10),
        child: Row(children: [
          Expanded(
            child: Text(text,
                style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
          ),
          ?action,
        ]),
      );
}

class AlbumCard extends StatelessWidget {
  const AlbumCard({super.key, required this.album, this.size = 150});
  final Album album;
  final double size;

  @override
  Widget build(BuildContext context) => InkWell(
        borderRadius: BorderRadius.circular(10),
        onTap: () => AppNav.openAlbum(album),
        child: SizedBox(
          width: size,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Artwork(path: album.artPath, size: size, radius: 10, seed: album.title, icon: Icons.album_rounded),
              const SizedBox(height: 8),
              Text(album.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
              Text(
                [album.artist, if (album.year != null) '${album.year}'].join(' • '),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(color: AppColors.textMuted, fontSize: 12),
              ),
            ],
          ),
        ),
      );
}

class AlbumCarousel extends StatelessWidget {
  const AlbumCarousel({super.key, required this.albums, this.size = 150});
  final List<Album> albums;
  final double size;

  @override
  Widget build(BuildContext context) => SizedBox(
        height: size + 52,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 20),
          itemCount: albums.length,
          separatorBuilder: (_, _) => const SizedBox(width: 14),
          itemBuilder: (_, i) => AlbumCard(album: albums[i], size: size),
        ),
      );
}

class ArtistCircle extends StatelessWidget {
  const ArtistCircle({super.key, required this.artist, this.size = 110});
  final Artist artist;
  final double size;

  @override
  Widget build(BuildContext context) => InkWell(
        customBorder: const CircleBorder(),
        onTap: () => AppNav.openArtist(artist),
        child: SizedBox(
          width: size,
          child: Column(children: [
            Artwork(path: artist.artPath, size: size, circle: true, seed: artist.name, icon: Icons.person_rounded),
            const SizedBox(height: 8),
            Text(artist.name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
                style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
          ]),
        ),
      );
}

/// Grille d'albums adaptée à la largeur de l'écran.
class AlbumGrid extends StatelessWidget {
  const AlbumGrid({super.key, required this.albums});
  final List<Album> albums;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(builder: (context, c) {
      final cols = (c.maxWidth / 180).floor().clamp(2, 6);
      final size = (c.maxWidth - 40 - (cols - 1) * 14) / cols;
      return GridView.builder(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
        gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: cols,
          mainAxisSpacing: 16,
          crossAxisSpacing: 14,
          childAspectRatio: size / (size + 48),
        ),
        itemCount: albums.length,
        itemBuilder: (_, i) => AlbumCard(album: albums[i], size: size),
      );
    });
  }
}
