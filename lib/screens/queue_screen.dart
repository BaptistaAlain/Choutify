import 'package:material_ui/material_ui.dart';
import 'package:provider/provider.dart';

import '../state/player_state.dart';
import '../theme.dart';
import '../widgets/artwork.dart';
import '../widgets/track_widgets.dart';

class QueueScreen extends StatelessWidget {
  const QueueScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final player = context.watch<PlayerState>();
    final current = player.current;
    final upNext = player.upNext;
    // Réorganiser n'a de sens que dans l'ordre normal de la file.
    final canReorder = !player.shuffle;

    return Scaffold(
      appBar: AppBar(
        title: const Text('File d\'attente'),
        actions: [
          if (upNext.isNotEmpty)
            TextButton(
              onPressed: () async {
                for (final i in [...upNext]..sort((a, b) => b.compareTo(a))) {
                  await player.removeAt(i);
                }
              },
              child: const Text('Vider'),
            ),
        ],
      ),
      body: current == null
          ? const Center(child: Text('Rien en lecture', style: TextStyle(color: AppColors.textMuted)))
          : CustomScrollView(slivers: [
              const SliverToBoxAdapter(
                child: Padding(
                  padding: EdgeInsets.fromLTRB(20, 8, 20, 4),
                  child: Text('En cours de lecture',
                      style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
                ),
              ),
              SliverToBoxAdapter(
                child: ListTile(
                  leading: Artwork(path: current.artPath, size: 48, seed: current.title),
                  title: Text(current.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: AppColors.coral, fontWeight: FontWeight.w700)),
                  subtitle: Text(current.displayArtist, maxLines: 1),
                ),
              ),
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(20, 16, 20, 4),
                  child: Text(
                    upNext.isEmpty
                        ? 'Aucun titre à suivre'
                        : 'À suivre${player.queueLabel == null ? '' : ' • ${player.queueLabel}'}',
                    style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
                  ),
                ),
              ),
              SliverReorderableList(
                itemCount: upNext.length,
                onReorderItem: (from, to) {
                  if (canReorder) player.move(upNext[from], upNext[to]);
                },
                itemBuilder: (ctx, i) {
                  final qi = upNext[i];
                  final t = player.queue[qi];
                  return Dismissible(
                    key: ValueKey('${t.id}#$qi'),
                    direction: DismissDirection.endToStart,
                    background: Container(
                      color: AppColors.coral.withValues(alpha: 0.6),
                      alignment: Alignment.centerRight,
                      padding: const EdgeInsets.only(right: 24),
                      child: const Icon(Icons.delete_outline_rounded),
                    ),
                    onDismissed: (_) => player.removeAt(qi),
                    child: Material(
                      color: Colors.transparent,
                      child: ListTile(
                        onTap: () => player.jumpTo(qi),
                        onLongPress: () => showTrackMenu(context, t),
                        leading: Artwork(path: t.artPath, size: 44, seed: t.album ?? t.title),
                        title: Text(t.title, maxLines: 1, overflow: TextOverflow.ellipsis),
                        subtitle: Text(t.displayArtist,
                            maxLines: 1, style: const TextStyle(color: AppColors.textMuted)),
                        trailing: canReorder
                            ? ReorderableDragStartListener(
                                index: i,
                                child: const Padding(
                                  padding: EdgeInsets.all(8),
                                  child: Icon(Icons.drag_handle_rounded),
                                ),
                              )
                            : null,
                      ),
                    ),
                  );
                },
              ),
              const SliverToBoxAdapter(child: SizedBox(height: 32)),
            ]),
    );
  }
}
