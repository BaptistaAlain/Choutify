import 'package:material_ui/material_ui.dart';

import 'models/track.dart';
import 'screens/album_screen.dart';
import 'screens/artist_screen.dart';
import 'screens/playlist_screen.dart';

/// Navigation globale : une pile par onglet, plus la pile racine
/// (lecteur plein écran, feuilles modales).
class AppNav {
  static final rootKey = GlobalKey<NavigatorState>();
  static final tabKeys = List.generate(3, (_) => GlobalKey<NavigatorState>());
  static final currentTab = ValueNotifier<int>(0);

  static NavigatorState? get _tab => tabKeys[currentTab.value].currentState;

  static void _closeOverlays() {
    rootKey.currentState?.popUntil((r) => r.isFirst);
  }

  static void push(Widget page) {
    _closeOverlays();
    _tab?.push(MaterialPageRoute(builder: (_) => page));
  }

  static void openAlbum(Album a) => push(AlbumScreen(albumKey: a.key));
  static void openArtist(Artist a) => push(ArtistScreen(name: a.name));
  static void openPlaylist(String id) => push(PlaylistScreen(playlistId: id));
  static void openFavorites() => push(const PlaylistScreen(favorites: true));
}
