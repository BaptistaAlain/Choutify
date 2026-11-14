import 'dart:async';
import 'dart:math';

import 'package:audio_session/audio_session.dart';
import 'package:flutter/foundation.dart';
import 'package:just_audio/just_audio.dart';
import 'package:just_audio_background/just_audio_background.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/track.dart';
import 'library_state.dart';

enum PlayRepeat { off, all, one }

/// Ordre aléatoire où les titres ajoutés se placent de façon prévisible :
/// juste après le titre courant (« Lire ensuite ») ou à la fin.
class QueueShuffleOrder extends ShuffleOrder {
  final _random = Random();
  @override
  final indices = <int>[];

  /// Index (dans la file) du titre courant au moment d'une insertion.
  int? anchor;
  bool insertNext = false;

  @override
  void shuffle({int? initialIndex}) {
    if (indices.length <= 1) return;
    indices.shuffle(_random);
    if (initialIndex == null) return;
    final swapPos = indices.indexOf(initialIndex);
    if (swapPos < 0) return;
    indices[swapPos] = indices[0];
    indices[0] = initialIndex;
  }

  @override
  void insert(int index, int count) {
    for (var i = 0; i < indices.length; i++) {
      if (indices[i] >= index) indices[i] += count;
    }
    final newIndices = List.generate(count, (i) => index + i);
    if (insertNext && anchor != null) {
      final a = anchor! >= index ? anchor! + count : anchor!;
      final pos = indices.indexOf(a);
      indices.insertAll(pos < 0 ? 0 : pos + 1, newIndices);
    } else {
      indices.addAll(newIndices);
    }
    insertNext = false;
  }

  @override
  void removeRange(int start, int end) {
    final count = end - start;
    indices.removeWhere((i) => i >= start && i < end);
    for (var i = 0; i < indices.length; i++) {
      if (indices[i] >= end) indices[i] -= count;
    }
  }

  @override
  void clear() => indices.clear();
}

class PlayerState extends ChangeNotifier {
  PlayerState(this.library, this.prefs) {
    _init();
  }

  final LibraryState library;
  final SharedPreferences prefs;
  final AudioPlayer player = AudioPlayer();

  /// File de lecture dans l'ordre d'origine (miroir des sources du lecteur).
  List<Track> _queue = [];
  String? queueLabel;
  int? _index;
  bool shuffle = false;
  PlayRepeat repeat = PlayRepeat.off;

  Timer? _sleepTimer;
  DateTime? sleepAt;
  bool sleepAtEndOfTrack = false;

  QueueShuffleOrder _order = QueueShuffleOrder();
  String? _countedKey;
  Timer? _persistTimer;
  final _subs = <StreamSubscription>[];

  List<Track> get queue => _queue;
  int? get index => _index;
  Track? get current =>
      (_index != null && _index! >= 0 && _index! < _queue.length)
          ? _queue[_index!]
          : null;
  bool get hasQueue => _queue.isNotEmpty;

  /// Ordre de lecture effectif (tient compte du mode aléatoire).
  List<int> get playOrder {
    final order = player.effectiveIndices;
    if (order.length == _queue.length) return order;
    return List.generate(_queue.length, (i) => i);
  }

  /// Titres à venir après le titre courant.
  List<int> get upNext {
    final order = playOrder;
    final pos = _index == null ? -1 : order.indexOf(_index!);
    return order.sublist(pos + 1);
  }

  Stream<Duration> get positionStream => player.positionStream;
  Stream<bool> get playingStream => player.playingStream;

  Future<void> _init() async {
    try {
      final session = await AudioSession.instance;
      await session.configure(const AudioSessionConfiguration.music());
    } catch (_) {}

    _subs.add(player.currentIndexStream.listen((i) {
      if (i != _index) {
        _index = i;
        _countedKey = null;
        if (sleepAtEndOfTrack && i != null) {
          // Le titre précédent s'est terminé.
          sleepAtEndOfTrack = false;
          player.pause();
        }
        _persistSoon();
        notifyListeners();
      }
    }));
    _subs.add(player.playerStateStream.listen((s) {
      if (s.processingState == ProcessingState.completed &&
          repeat == PlayRepeat.off) {
        player.pause();
        player.seek(Duration.zero, index: playOrder.isEmpty ? 0 : playOrder.first);
      }
      notifyListeners();
    }));
    _subs.add(player.positionStream.listen(_onPosition));
    _subs.add(player.durationStream.listen((_) => notifyListeners()));

    shuffle = prefs.getBool('shuffle') ?? false;
    repeat = PlayRepeat.values[prefs.getInt('repeat') ?? 0];
    await _applyLoopMode();
  }

  void _onPosition(Duration pos) {
    final t = current;
    if (t == null) return;
    final key = '${t.id}#$_index';
    if (_countedKey == key) return;
    final dur = player.duration ?? t.duration ?? const Duration(minutes: 3);
    final threshold = dur.inSeconds < 60
        ? Duration(seconds: max(1, dur.inSeconds ~/ 2))
        : const Duration(seconds: 30);
    if (pos >= threshold) {
      _countedKey = key;
      library.recordPlay(t);
    }
  }

  AudioSource _source(Track t) => AudioSource.file(
        t.path,
        tag: MediaItem(
          id: t.id,
          title: t.title,
          artist: t.displayArtist,
          album: t.album,
          genre: t.genre,
          duration: t.duration,
          artUri: t.artPath == null ? null : Uri.file(t.artPath!),
        ),
      );

  /// Restaure la dernière file de lecture (sans lancer la lecture).
  Future<void> restore() async {
    final ids = prefs.getStringList('queue') ?? [];
    final tracks =
        ids.map(library.trackById).whereType<Track>().toList();
    if (tracks.isEmpty) return;
    final idx = (prefs.getInt('queueIndex') ?? 0).clamp(0, tracks.length - 1);
    final pos = Duration(milliseconds: prefs.getInt('queuePos') ?? 0);
    queueLabel = prefs.getString('queueLabel');
    await _load(tracks, idx, pos, play: false);
  }

  Future<void> _load(List<Track> tracks, int index, Duration position,
      {required bool play}) async {
    _queue = [...tracks];
    _index = index;
    _countedKey = null;
    notifyListeners();
    try {
      await player.setShuffleModeEnabled(false);
      _order = QueueShuffleOrder();
      await player.setAudioSources(
        tracks.map(_source).toList(),
        initialIndex: index,
        initialPosition: position,
        preload: play,
        shuffleOrder: _order,
      );
      if (shuffle) {
        // Le titre choisi est placé en tête de l'ordre aléatoire.
        await player.shuffle();
        await player.setShuffleModeEnabled(true);
      }
      if (play) await player.play();
    } catch (e) {
      debugPrint('Lecture impossible : $e');
    }
    _persistSoon();
  }

  /// Joue [tracks] à partir de [index].
  Future<void> playTracks(List<Track> tracks,
      {int index = 0, String? label, bool? shuffled}) async {
    if (tracks.isEmpty) return;
    if (shuffled != null && shuffled != shuffle) {
      shuffle = shuffled;
      await prefs.setBool('shuffle', shuffle);
    }
    queueLabel = label;
    if (shuffled == true) index = Random().nextInt(tracks.length);
    await _load(tracks, index, Duration.zero, play: true);
  }

  Future<void> togglePlay() async {
    if (player.playing) {
      await player.pause();
      _persistNow();
    } else {
      if (player.processingState == ProcessingState.idle && hasQueue) {
        await player.load();
      }
      await player.play();
    }
  }

  Future<void> next() async {
    if (player.hasNext) {
      await player.seekToNext();
    } else if (hasQueue) {
      await player.seek(Duration.zero, index: playOrder.first);
    }
  }

  Future<void> previous() async {
    if (player.position > const Duration(seconds: 3) || !player.hasPrevious) {
      await player.seek(Duration.zero);
    } else {
      await player.seekToPrevious();
    }
  }

  Future<void> seek(Duration d) => player.seek(d);

  Future<void> jumpTo(int queueIndex) async {
    await player.seek(Duration.zero, index: queueIndex);
    if (!player.playing) await player.play();
  }

  Future<void> toggleShuffle() async {
    shuffle = !shuffle;
    await prefs.setBool('shuffle', shuffle);
    if (shuffle) await player.shuffle();
    await player.setShuffleModeEnabled(shuffle);
    notifyListeners();
  }

  Future<void> cycleRepeat() async {
    repeat = PlayRepeat.values[(repeat.index + 1) % PlayRepeat.values.length];
    await prefs.setInt('repeat', repeat.index);
    await _applyLoopMode();
    notifyListeners();
  }

  Future<void> _applyLoopMode() => player.setLoopMode(switch (repeat) {
        PlayRepeat.off => LoopMode.off,
        PlayRepeat.all => LoopMode.all,
        PlayRepeat.one => LoopMode.one,
      });

  /// Insère après le titre courant (dans l'ordre de lecture).
  Future<void> playNext(List<Track> tracks) async {
    if (!hasQueue) return playTracks(tracks);
    final insertAt = (_index ?? -1) + 1;
    _queue.insertAll(insertAt, tracks);
    _order
      ..anchor = _index
      ..insertNext = true;
    await player.insertAudioSources(insertAt, tracks.map(_source).toList());
    _persistSoon();
    notifyListeners();
  }

  Future<void> addToQueue(List<Track> tracks) async {
    if (!hasQueue) return playTracks(tracks);
    _queue.addAll(tracks);
    await player.addAudioSources(tracks.map(_source).toList());
    _persistSoon();
    notifyListeners();
  }

  Future<void> removeAt(int queueIndex) async {
    if (queueIndex == _index) {
      if (_queue.length == 1) {
        await clear();
        return;
      }
    }
    _queue.removeAt(queueIndex);
    await player.removeAudioSourceAt(queueIndex);
    _index = player.currentIndex;
    _persistSoon();
    notifyListeners();
  }

  Future<void> move(int from, int to) async {
    final t = _queue.removeAt(from);
    _queue.insert(to, t);
    await player.moveAudioSource(from, to);
    _index = player.currentIndex;
    _persistSoon();
    notifyListeners();
  }

  Future<void> clear() async {
    await player.stop();
    await player.clearAudioSources();
    _queue = [];
    _index = null;
    queueLabel = null;
    _persistNow();
    notifyListeners();
  }

  // ---------------------------------------------------------- minuterie

  void setSleepTimer(Duration? d, {bool endOfTrack = false}) {
    _sleepTimer?.cancel();
    sleepAt = null;
    sleepAtEndOfTrack = endOfTrack;
    if (d != null) {
      sleepAt = DateTime.now().add(d);
      _sleepTimer = Timer(d, () {
        player.pause();
        sleepAt = null;
        notifyListeners();
      });
    }
    notifyListeners();
  }

  bool get sleepTimerActive => sleepAt != null || sleepAtEndOfTrack;

  // -------------------------------------------------------- persistance

  void _persistSoon() {
    _persistTimer?.cancel();
    _persistTimer = Timer(const Duration(seconds: 2), _persistNow);
  }

  void _persistNow() {
    prefs.setStringList('queue', _queue.map((t) => t.id).toList());
    prefs.setInt('queueIndex', _index ?? 0);
    prefs.setInt('queuePos', player.position.inMilliseconds);
    if (queueLabel != null) {
      prefs.setString('queueLabel', queueLabel!);
    } else {
      prefs.remove('queueLabel');
    }
  }

  /// Appelé quand l'application passe en arrière-plan.
  void persist() => _persistNow();

  @override
  void dispose() {
    for (final s in _subs) {
      s.cancel();
    }
    player.dispose();
    super.dispose();
  }
}
