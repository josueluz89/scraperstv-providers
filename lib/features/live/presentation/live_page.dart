// lib/features/live/presentation/live_page.dart
//
// Sección "En vivo" en modo móvil: dos pestañas (TV / Deportes),
// buscador y lista de canales agrupada por categoría.
import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../data/live_repository.dart';
import '../data/live_sources.dart';
import '../domain/live_channel.dart';
import 'live_player_page.dart';

const _kAccent = Color(0xFFE50914);
const _kCard = Color(0xFF1C1C1E);

class LivePage extends StatefulWidget {
  const LivePage({super.key});

  @override
  State<LivePage> createState() => _LivePageState();
}

class _LivePageState extends State<LivePage>
    with AutomaticKeepAliveClientMixin {
  final LiveRepository _repo = LiveRepository();
  final TextEditingController _searchCtrl = TextEditingController();

  LiveSource _source = liveSources.first;
  List<LiveChannel> _channels = const [];
  bool _loading = true;
  String? _error;
  bool _fromCache = false;
  String _query = '';

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
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
      _channels = result.channels;
      _fromCache = result.fromCache;
    });
  }

  void _switchSource(LiveSource source) {
    if (source.id == _source.id) return;
    setState(() {
      _source = source;
      _channels = const [];
      _query = '';
      _searchCtrl.clear();
    });
    _load();
  }

  /// Índices de los canales que pasan el filtro, con su grupo.
  List<({String group, int index})> get _visible {
    final q = _query.trim().toLowerCase();
    final out = <({String group, int index})>[];
    for (var i = 0; i < _channels.length; i++) {
      final c = _channels[i];
      if (q.isEmpty ||
          c.name.toLowerCase().contains(q) ||
          c.group.toLowerCase().contains(q)) {
        out.add((group: c.group.trim().isEmpty ? 'Otros' : c.group, index: i));
      }
    }
    return out;
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final grouped = <String, List<int>>{};
    for (final v in _visible) {
      grouped.putIfAbsent(v.group, () => <int>[]).add(v.index);
    }
    final groupNames = grouped.keys.toList();

    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            _buildHeader(),
            _buildSearch(),
            if (_error != null) _buildError(),
            if (_loading)
              const Expanded(
                child: Center(
                  child: CircularProgressIndicator(color: _kAccent),
                ),
              )
            else if (_channels.isEmpty)
              const Expanded(
                child: Center(
                  child: Text(
                    'No hay canales disponibles',
                    style: TextStyle(color: Colors.white54),
                  ),
                ),
              )
            else
              Expanded(
                child: RefreshIndicator(
                  color: _kAccent,
                  backgroundColor: _kCard,
                  onRefresh: () => _load(force: true),
                  child: ListView.builder(
                    padding: const EdgeInsets.only(bottom: 110),
                    itemCount: groupNames.length,
                    itemBuilder: (context, gi) {
                      final name = groupNames[gi];
                      final indexes = grouped[name]!;
                      return Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Padding(
                            padding: const EdgeInsets.fromLTRB(16, 18, 16, 8),
                            child: Text(
                              '$name · ${indexes.length}',
                              style: const TextStyle(
                                color: Colors.white70,
                                fontSize: 14,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                          ...indexes.map((i) => _channelTile(_channels[i], i)),
                        ],
                      );
                    },
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 8, 4),
      child: Row(
        children: [
          const Icon(Icons.live_tv_rounded, color: _kAccent, size: 26),
          const SizedBox(width: 10),
          const Expanded(
            child: Text(
              'En vivo',
              style: TextStyle(
                color: Colors.white,
                fontSize: 22,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
          IconButton(
            onPressed: () => _load(force: true),
            tooltip: 'Actualizar',
            icon: Icon(
              Icons.refresh_rounded,
              color: Colors.white.withValues(alpha: 0.75),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSearch() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
          child: Row(
            children: [
              for (final s in liveSources) ...[
                _sourcePill(s),
                const SizedBox(width: 8),
              ],
              if (_fromCache && !_loading && _channels.isNotEmpty)
                Text(
                  'caché',
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.4),
                    fontSize: 12,
                  ),
                ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
          child: TextField(
            controller: _searchCtrl,
            onChanged: (v) => setState(() => _query = v),
            style: const TextStyle(color: Colors.white, fontSize: 15),
            decoration: InputDecoration(
              hintText: 'Buscar canal o categoría',
              hintStyle: TextStyle(color: Colors.white.withValues(alpha: 0.4)),
              prefixIcon: Icon(
                Icons.search_rounded,
                color: Colors.white.withValues(alpha: 0.5),
              ),
              filled: true,
              fillColor: _kCard,
              contentPadding: const EdgeInsets.symmetric(vertical: 12),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(14),
                borderSide: BorderSide.none,
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _sourcePill(LiveSource s) {
    final active = s.id == _source.id;
    return GestureDetector(
      onTap: () => _switchSource(s),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 140),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 9),
        decoration: BoxDecoration(
          color: active
              ? _kAccent.withValues(alpha: 0.22)
              : Colors.white.withValues(alpha: 0.07),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: active ? _kAccent : Colors.transparent,
            width: 1.6,
          ),
        ),
        child: Text(
          s.tabLabel,
          style: TextStyle(
            color: Colors.white,
            fontSize: 14,
            fontWeight: active ? FontWeight.w800 : FontWeight.w500,
          ),
        ),
      ),
    );
  }

  Widget _channelTile(LiveChannel c, int index) {
    return InkWell(
      onTap: () =>
          LivePlayerPage.open(context, playlist: _channels, index: index),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        child: Row(
          children: [
            Container(
              width: 54,
              height: 54,
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.06),
                borderRadius: BorderRadius.circular(12),
              ),
              clipBehavior: Clip.antiAlias,
              child: c.logo.isEmpty
                  ? const Icon(Icons.live_tv_rounded, color: Colors.white38)
                  : CachedNetworkImage(
                      imageUrl: c.logo,
                      fit: BoxFit.contain,
                      memCacheWidth: 120,
                      errorWidget: (_, _, _) => const Icon(
                        Icons.live_tv_rounded,
                        color: Colors.white38,
                      ),
                    ),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    c.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 15.5,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    c.urls.length > 1
                        ? '${c.group} · ${c.urls.length} enlaces'
                        : c.group,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: Colors.white.withValues(alpha: 0.45),
                      fontSize: 12.5,
                    ),
                  ),
                ],
              ),
            ),
            const Icon(
              Icons.play_circle_fill_rounded,
              color: _kAccent,
              size: 30,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildError() {
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 4, 16, 8),
      padding: const EdgeInsets.fromLTRB(16, 12, 12, 12),
      decoration: BoxDecoration(
        color: _kCard,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: _kAccent.withValues(alpha: 0.4)),
      ),
      child: Row(
        children: [
          const Icon(Icons.wifi_off_rounded, color: _kAccent, size: 22),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              _error!,
              style: const TextStyle(color: Colors.white70, fontSize: 13.5),
            ),
          ),
          TextButton(
            onPressed: () => _load(force: true),
            style: TextButton.styleFrom(foregroundColor: _kAccent),
            child: const Text('Reintentar'),
          ),
        ],
      ),
    );
  }
}
