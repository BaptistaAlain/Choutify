import 'dart:io';
import 'dart:ui' as ui;

import 'package:material_ui/material_ui.dart';

import '../services/library_scanner.dart';
import '../theme.dart';

/// Pochette d'album avec une vignette générée si aucune image n'existe.
class Artwork extends StatelessWidget {
  const Artwork({
    super.key,
    required this.path,
    required this.size,
    this.radius = 8,
    this.seed = '',
    this.circle = false,
    this.icon = Icons.music_note_rounded,
  });

  final String? path;
  final double size;
  final double radius;
  final String seed;
  final bool circle;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final dpr = MediaQuery.devicePixelRatioOf(context);
    final placeholder = _Placeholder(seed: seed, size: size, icon: icon);
    Widget child = placeholder;
    if (path != null) {
      child = Image.file(
        File(path!),
        width: size,
        height: size,
        fit: BoxFit.cover,
        cacheWidth: (size * dpr).round().clamp(48, 1400),
        gaplessPlayback: true,
        filterQuality: FilterQuality.medium,
        errorBuilder: (_, _, _) => placeholder,
      );
    }
    return SizedBox(
      width: size,
      height: size,
      child: circle
          ? ClipOval(child: child)
          : ClipRRect(borderRadius: BorderRadius.circular(radius), child: child),
    );
  }
}

class _Placeholder extends StatelessWidget {
  const _Placeholder({required this.seed, required this.size, required this.icon});
  final String seed;
  final double size;
  final IconData icon;

  static const _palettes = [
    [Color(0xFF8B5CF6), Color(0xFF3B1D8F)],
    [Color(0xFFFF6A88), Color(0xFF7A1F45)],
    [Color(0xFF22C3A6), Color(0xFF0B4F57)],
    [Color(0xFFFFB547), Color(0xFF8A3B12)],
    [Color(0xFF4F8CFF), Color(0xFF1B2C7A)],
    [Color(0xFFE357D8), Color(0xFF4A1466)],
  ];

  @override
  Widget build(BuildContext context) {
    final h = int.parse(stableHash(seed).padLeft(2, '0').substring(0, 2), radix: 16);
    final pal = _palettes[h % _palettes.length];
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: pal,
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
      child: Icon(icon,
          color: Colors.white.withValues(alpha: 0.85), size: size * 0.42),
    );
  }
}

/// Mosaïque de 1 à 4 pochettes pour une playlist.
class PlaylistCover extends StatelessWidget {
  const PlaylistCover(
      {super.key, required this.arts, required this.size, this.seed = '', this.icon});
  final List<String?> arts;
  final double size;
  final String seed;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    if (icon != null) {
      return Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          gradient: AppColors.brandGradient,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Icon(icon, color: Colors.white, size: size * 0.45),
      );
    }
    if (arts.length < 4) {
      return Artwork(
          path: arts.isEmpty ? null : arts.first,
          size: size,
          seed: seed,
          icon: Icons.queue_music_rounded);
    }
    final half = size / 2;
    return ClipRRect(
      borderRadius: BorderRadius.circular(8),
      child: SizedBox(
        width: size,
        height: size,
        child: Wrap(
          children: [
            for (final a in arts.take(4))
              Artwork(path: a, size: half, radius: 0),
          ],
        ),
      ),
    );
  }
}

/// Couleur dominante (moyenne saturée) d'une image, mise en cache.
class ArtColors {
  static final _cache = <String, Color>{};

  static Future<Color> dominant(String? path) async {
    const fallback = Color(0xFF3A2A6E);
    if (path == null) return fallback;
    final cached = _cache[path];
    if (cached != null) return cached;
    try {
      final bytes = await File(path).readAsBytes();
      final codec =
          await ui.instantiateImageCodec(bytes, targetWidth: 24, targetHeight: 24);
      final frame = await codec.getNextFrame();
      final data =
          await frame.image.toByteData(format: ui.ImageByteFormat.rawRgba);
      frame.image.dispose();
      if (data == null) return fallback;
      double r = 0, g = 0, b = 0, w = 0;
      for (var i = 0; i < data.lengthInBytes; i += 4) {
        final cr = data.getUint8(i), cg = data.getUint8(i + 1), cb = data.getUint8(i + 2);
        final mx = [cr, cg, cb].reduce((a, c) => a > c ? a : c);
        final mn = [cr, cg, cb].reduce((a, c) => a < c ? a : c);
        // Les pixels saturés et pas trop sombres pèsent plus.
        final weight = 0.15 + (mx - mn) / 255.0 * (mx / 255.0);
        r += cr * weight;
        g += cg * weight;
        b += cb * weight;
        w += weight;
      }
      var c = Color.fromARGB(255, (r / w).round(), (g / w).round(), (b / w).round());
      final hsl = HSLColor.fromColor(c);
      c = hsl
          .withLightness(hsl.lightness.clamp(0.22, 0.42))
          .withSaturation((hsl.saturation * 1.2).clamp(0.0, 0.85))
          .toColor();
      _cache[path] = c;
      return c;
    } catch (_) {
      return fallback;
    }
  }
}
