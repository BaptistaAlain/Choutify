import 'package:material_ui/material_ui.dart';

import '../theme.dart';
import 'artwork.dart';

/// Page de collection (album, artiste, playlist) avec un dégradé tiré de
/// la couleur dominante de la pochette.
class CollectionScaffold extends StatefulWidget {
  const CollectionScaffold({
    super.key,
    required this.artPath,
    required this.header,
    required this.children,
    this.reorderable,
    this.title,
  });

  final String? artPath;
  final Widget header;
  final List<Widget> children;
  final Widget? reorderable;
  final String? title;

  @override
  State<CollectionScaffold> createState() => _CollectionScaffoldState();
}

class _CollectionScaffoldState extends State<CollectionScaffold> {
  Color _color = const Color(0xFF2E2456);
  final _scroll = ScrollController();
  bool _showTitle = false;

  @override
  void initState() {
    super.initState();
    _loadColor();
    _scroll.addListener(() {
      final show = _scroll.offset > 260;
      if (show != _showTitle) setState(() => _showTitle = show);
    });
  }

  @override
  void didUpdateWidget(covariant CollectionScaffold old) {
    super.didUpdateWidget(old);
    if (old.artPath != widget.artPath) _loadColor();
  }

  Future<void> _loadColor() async {
    final c = await ArtColors.dominant(widget.artPath);
    if (mounted) setState(() => _color = c);
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      extendBodyBehindAppBar: true,
      appBar: AppBar(
        backgroundColor: _showTitle ? Color.lerp(_color, AppColors.bg, 0.35) : Colors.transparent,
        title: AnimatedOpacity(
          opacity: _showTitle ? 1 : 0,
          duration: const Duration(milliseconds: 200),
          child: Text(widget.title ?? '', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
        ),
      ),
      body: Stack(
        children: [
          AnimatedContainer(
            duration: const Duration(milliseconds: 400),
            height: 520,
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [_color, AppColors.bg],
              ),
            ),
          ),
          CustomScrollView(
            controller: _scroll,
            slivers: [
              SliverToBoxAdapter(child: widget.header),
              if (widget.reorderable != null) widget.reorderable!,
              SliverList(delegate: SliverChildListDelegate(widget.children)),
              const SliverToBoxAdapter(child: SizedBox(height: 24)),
            ],
          ),
        ],
      ),
    );
  }
}

class CollectionHeader extends StatelessWidget {
  const CollectionHeader({
    super.key,
    required this.art,
    required this.title,
    this.subtitle,
    this.meta,
    this.buttons,
    this.actions = const [],
    this.centered = true,
  });

  final Widget art;
  final String title;
  final Widget? subtitle;
  final String? meta;
  final Widget? buttons;
  final List<Widget> actions;
  final bool centered;

  @override
  Widget build(BuildContext context) {
    final top = MediaQuery.paddingOf(context).top + kToolbarHeight;
    return Padding(
      padding: EdgeInsets.fromLTRB(20, top, 20, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Center(
            child: DecoratedBox(
              decoration: BoxDecoration(boxShadow: [
                BoxShadow(color: Colors.black.withValues(alpha: 0.45), blurRadius: 30, offset: const Offset(0, 12)),
              ]),
              child: art,
            ),
          ),
          const SizedBox(height: 20),
          Text(title,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800, height: 1.15)),
          if (subtitle != null) ...[const SizedBox(height: 6), subtitle!],
          if (meta != null) ...[
            const SizedBox(height: 4),
            Text(meta!, style: const TextStyle(color: AppColors.textMuted, fontSize: 13)),
          ],
          const SizedBox(height: 4),
          Row(
            children: [
              ...actions,
              const Spacer(),
              ?buttons,
            ],
          ),
        ],
      ),
    );
  }
}
