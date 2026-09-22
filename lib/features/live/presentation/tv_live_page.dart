// lib/features/live/presentation/tv_live_page.dart
//
// Sección "En vivo" en modo TV (D-pad).
// Foco: pestañas arriba (←/→), ↓ entra en la rejilla, ↑ desde la primera fila
// devuelve al menú lateral, OK reproduce el canal.
import 'dart:async';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../data/live_repository.dart';
import '../data/live_sources.dart';
import '../domain/live_channel.dart';
import 'live_player_page.dart';

const _kAccent = Color(0xFFE50914);
const _kCard = Color(0xFF1A1A1A);
const _kCardW = 150.0;
const _kGap = 12.0;

class TvLivePage extends StatefulWidget {
  final VoidCallback? onRequestMenuFocus;
  final ValueChanged<FocusNode>? onMainFocusNodeCreated;

  const TvLivePage({
    super.key,
    this.onRequestMenuFocus,
    this.onMainFocusNodeCreated,
  });

  @override
  State<TvLivePage> createState() => _TvLivePageState();
}

class _TvLivePageState extends State<TvLivePage>
    with AutomaticKeepAliveClientMixin {
  final LiveRepository _repo = LiveRepository();
  final ScrollController _scroll = ScrollController();

  LiveSource _source = liveSources.first;
  List<LiveGroup> _groups = const [];
  List<LiveChannel> _display = const []; // orden visual (playlist del player)
  bool _loading = true;
  String? _error;

  late final List<FocusNode> _tabNodes;
  final Map<int, FocusNode> _chanNodes = {};
  final Map<int, GlobalKey> _chanKeys = {};
  int _cols = 6;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _tabNodes = [
      FocusNode(debugLabel: 'live_tab_0'),
      FocusNode(debugLabel: 'live_tab_1'),
    ];
    for (var i = 0; i < _tabNodes.length && i < liveSources.length; i++) {
      final idx = i;
      _tabNodes[i].addListener(() {
        if (_tabNodes[idx].hasFocus) _switchSource(liveSources[idx]);
      });
    }
    WidgetsBinding.instance.addPostFrameCallback((_) {
      widget.onMainFocusNodeCreated?.call(_tabNodes.first);
    });
    _load();
  }

  @override
  void dispose() {
    _scroll.dispose();
    for (final n in _tabNodes) {
      n.dispose();
    }
    for (final n in _chanNodes.values) {
      n.dispose();
    }
    super.dispose();
  }

  Future<void> _load({bool force = false}) async {
    setState(() {
      _loading = true;
      _error = null;
    });
    final result = await _repo.load(_source, force: force);
    if (!mounted) return;
    setState(() {
      _loading = false;
      _error = result.ok ? null : (result.error ?? 'Error');
      _applyChannels(result.channels);
    });
  }

  void _applyChannels(List<LiveChannel> channels) {
    _groups = groupChannels(channels);
    _display = [for (final g in _groups) ...g.channels];
    // Los nodos de foco son por índice visual: se recrean al cambiar la lista.
    for (final n in _chanNodes.values) {
      n.dispose();
    }
    _chanNodes.clear();
    _chanKeys.clear();
  }

  void _switchSource(LiveSource s) {
    if (s.id == _source.id) return;
    setState(() {
      _source = s;
      _groups = const [];
      _display = const [];
    });
    _load();
  }

  FocusNode _channelFocus(int index) {
    return _chanNodes.putIfAbsent(index, () {
      final node = FocusNode(debugLabel: 'live_chan_$index');
      node.addListener(() {
        if (node.hasFocus) _scrollTo(index);
      });
      return node;
    });
  }

  GlobalKey _channelKey(int index) =>
      _chanKeys.putIfAbsent(index, () => GlobalKey());

  void _scrollTo(int index) {
    final ctx = _chanKeys[index]?.currentContext;
    if (ctx != null) {
      Scrollable.ensureVisible(
        ctx,
        duration: const Duration(milliseconds: 180),
        alignment: 0.3,
      );
    }
  }

  void _open(int index) {
    if (index < 0 || index >= _display.length) return;
    LivePlayerPage.open(context, playlist: _display, index: index);
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);

    return LayoutBuilder(
      builder: (context, constraints) {
        final usable = constraints.maxWidth - 56;
        _cols = ((usable + _kGap) / (_kCardW + _kGap)).floor().clamp(1, 10);

        return Padding(
          padding: const EdgeInsets.fromLTRB(28, 20, 28, 0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildHeader(),
              const SizedBox(height: 14),
              if (_error != null)
                Text(
                  _error!,
                  style: const TextStyle(color: Colors.white54, fontSize: 14),
                ),
              if (_loading)
                const Expanded(
                  child: Center(
                    child: CircularProgressIndicator(color: _kAccent),
                  ),
                )
              else
                Expanded(child: _buildList()),
            ],
          ),
        );
      },
    );
  }

  Widget _buildHeader() {
    return Row(
      children: [
        const Icon(Icons.live_tv_rounded, color: _kAccent, size: 28),
        const SizedBox(width: 12),
        const Text(
          'En vivo',
          style: TextStyle(
            color: Colors.white,
            fontSize: 24,
            fontWeight: FontWeight.w800,
          ),
        ),
        const SizedBox(width: 24),
        for (var i = 0; i < liveSources.length; i++) ...[
          _tabPill(i),
          const SizedBox(width: 10),
        ],
        const Spacer(),
        if (_display.isNotEmpty)
          Text(
            '${_display.length} canales',
            style: TextStyle(
              color: Colors.white.withValues(alpha: 0.45),
              fontSize: 13,
            ),
          ),
        if (_error != null)
          TextButton(
            onPressed: () => _load(force: true),
            style: TextButton.styleFrom(foregroundColor: _kAccent),
            child: const Text('Reintentar'),
          ),
      ],
    );
  }

  Widget _buildList() {
    if (_display.isEmpty) {
      return const Center(
        child: Text(
          'No hay canales disponibles',
          style: TextStyle(color: Colors.white54),
        ),
      );
    }

    var cursor = 0;
    return ListView.builder(
      controller: _scroll,
      padding: const EdgeInsets.only(bottom: 28),
      itemCount: _groups.length,
      itemBuilder: (context, gi) {
        final group = _groups[gi];
        final start = cursor;
        cursor += group.channels.length;

        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(2, 16, 2, 10),
              child: Text(
                '${group.name} · ${group.channels.length}',
                style: const TextStyle(
                  color: Colors.white70,
                  fontSize: 15,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            Wrap(
              spacing: _kGap,
              runSpacing: _kGap,
              children: [
                for (var i = 0; i < group.channels.length; i++)
                  _channelCard(group.channels[i], start + i),
              ],
            ),
          ],
        );
      },
    );
  }

  Widget _tabPill(int i) {
    final s = liveSources[i];
    final active = s.id == _source.id;
    return Focus(
      focusNode: _tabNodes[i],
      onKeyEvent: (node, event) {
        if (event is! KeyDownEvent) return KeyEventResult.ignored;
        final key = event.logicalKey;
        if (key == LogicalKeyboardKey.select ||
            key == LogicalKeyboardKey.enter) {
          _switchSource(s);
          return KeyEventResult.handled;
        }
        if (key == LogicalKeyboardKey.arrowRight) {
          if (i < liveSources.length - 1) _tabNodes[i + 1].requestFocus();
          return KeyEventResult.handled;
        }
        if (key == LogicalKeyboardKey.arrowLeft) {
          if (i > 0) {
            _tabNodes[i - 1].requestFocus();
          } else {
            widget.onRequestMenuFocus?.call();
          }
          return KeyEventResult.handled;
        }
        if (key == LogicalKeyboardKey.arrowUp) {
          widget.onRequestMenuFocus?.call();
          return KeyEventResult.handled;
        }
        if (key == LogicalKeyboardKey.arrowDown) {
          if (_display.isNotEmpty) _channelFocus(0).requestFocus();
          return KeyEventResult.handled;
        }
        return KeyEventResult.ignored;
      },
      child: Builder(
        builder: (context) {
          final focused = Focus.of(context).hasFocus;
          return GestureDetector(
            onTap: () {
              _tabNodes[i].requestFocus();
              _switchSource(s);
            },
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 140),
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
              decoration: BoxDecoration(
                color: active
                    ? _kAccent.withValues(alpha: 0.22)
                    : Colors.white.withValues(alpha: 0.07),
                borderRadius: BorderRadius.circular(22),
                border: Border.all(
                  color: focused
                      ? Colors.white
                      : (active ? _kAccent : Colors.transparent),
                  width: focused ? 2 : 1.6,
                ),
              ),
              child: Text(
                s.tabLabel,
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 15,
                  fontWeight: active ? FontWeight.w800 : FontWeight.w500,
                ),
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _channelCard(LiveChannel c, int index) {
    return Focus(
      key: _channelKey(index),
      focusNode: _channelFocus(index),
      onKeyEvent: (node, event) {
        if (event is! KeyDownEvent) return KeyEventResult.ignored;
        final key = event.logicalKey;

        if (key == LogicalKeyboardKey.select ||
            key == LogicalKeyboardKey.enter) {
          _open(index);
          return KeyEventResult.handled;
        }
        if (key == LogicalKeyboardKey.arrowUp) {
          final up = index - _cols;
          if (up >= 0) {
            _channelFocus(up).requestFocus();
          } else {
            widget.onRequestMenuFocus?.call();
          }
          return KeyEventResult.handled;
        }
        if (key == LogicalKeyboardKey.arrowDown) {
          final down = index + _cols;
          if (down < _display.length) _channelFocus(down).requestFocus();
          return KeyEventResult.handled;
        }
        if (key == LogicalKeyboardKey.arrowRight) {
          if (index + 1 < _display.length) _channelFocus(index + 1).requestFocus();
          return KeyEventResult.handled;
        }
        if (key == LogicalKeyboardKey.arrowLeft) {
          if (index > 0) {
            _channelFocus(index - 1).requestFocus();
          } else {
            widget.onRequestMenuFocus?.call();
          }
          return KeyEventResult.handled;
        }
        return KeyEventResult.ignored;
      },
      child: Builder(
        builder: (context) {
          final focused = Focus.of(context).hasFocus;
          return GestureDetector(
            onTap: () {
              _channelFocus(index).requestFocus();
              _open(index);
            },
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 140),
              width: _kCardW,
              padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 6),
              decoration: BoxDecoration(
                color: focused ? _kAccent.withValues(alpha: 0.2) : _kCard,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(
                  color: focused ? Colors.white : Colors.transparent,
                  width: focused ? 2.2 : 1,
                ),
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  SizedBox(
                    height: 48,
                    child: c.logo.isEmpty
                        ? const Icon(Icons.live_tv_rounded, color: Colors.white38)
                        : CachedNetworkImage(
                            imageUrl: c.logo,
                            fit: BoxFit.contain,
                            memCacheWidth: 160,
                            errorWidget: (_, _, _) => const Icon(
                              Icons.live_tv_rounded,
                              color: Colors.white38,
                            ),
                          ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    c.name,
                    maxLines: 2,
                    textAlign: TextAlign.center,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}
