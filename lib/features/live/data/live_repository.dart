// lib/features/live/data/live_repository.dart
import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../../../data/scrapers/base/base_home_scraper.dart' show fetchHtml;
import '../domain/live_channel.dart';
import 'live_sources.dart';
import 'm3u_parser.dart';

class LiveResult {
  final bool ok;
  final String? error;
  final List<LiveChannel> channels;
  final bool fromCache;

  const LiveResult({
    required this.ok,
    this.error,
    this.channels = const [],
    this.fromCache = false,
  });
}

/// Descarga, parsea y cachea listas de canales de canales en vivo.
///
/// Estrategia (igual que el resto de la app):
///   1. caché fresca (< ttl)  → se usa sin tocar la red
///   2. red OK                → se parsea, se fusionan espejos y se cachea
///   3. red KO con caché      → se devuelve la caché vieja (fromCache: true)
///   4. red KO sin caché      → ok:false con mensaje para la UI
class LiveRepository {
  LiveRepository({Future<String?> Function(String url)? fetch})
    : _fetch = fetch ?? fetchHtml;

  final Future<String?> Function(String url) _fetch;

  Future<LiveResult> load(LiveSource source, {bool force = false}) async {
    final prefs = await SharedPreferences.getInstance();

    final cached = _readCache(prefs, source);
    if (!force && cached != null && _isFresh(prefs, source)) {
      return LiveResult(ok: true, channels: cached, fromCache: true);
    }

    String? body;
    try {
      body = await _fetch(source.url);
    } catch (_) {
      body = null;
    }

    if (body == null || body.trim().isEmpty) {
      if (cached != null && cached.isNotEmpty) {
        return LiveResult(ok: true, channels: cached, fromCache: true);
      }
      return const LiveResult(
        ok: false,
        error: 'No se pudo descargar la lista de canales',
      );
    }

    final parsed = M3uParser.mergeMirrors(M3uParser.parse(body));
    if (parsed.isEmpty) {
      if (cached != null && cached.isNotEmpty) {
        return LiveResult(ok: true, channels: cached, fromCache: true);
      }
      return const LiveResult(
        ok: false,
        error: 'La lista llegó vacía o con formato desconocido',
      );
    }

    await _writeCache(prefs, source, parsed);
    return LiveResult(ok: true, channels: parsed);
  }

  bool _isFresh(SharedPreferences prefs, LiveSource source) {
    final ts = prefs.getInt(source.cacheTsKey);
    if (ts == null) return false;
    final age = DateTime.now().millisecondsSinceEpoch - ts;
    return age >= 0 && age < source.ttl.inMilliseconds;
  }

  List<LiveChannel>? _readCache(SharedPreferences prefs, LiveSource source) {
    final raw = prefs.getString(source.cacheKey);
    if (raw == null || raw.isEmpty) return null;
    try {
      final list = jsonDecode(raw) as List;
      return list
          .whereType<Map>()
          .map((e) => LiveChannel.fromJson(Map<String, dynamic>.from(e)))
          .where((c) => c.urls.isNotEmpty)
          .toList();
    } catch (_) {
      return null;
    }
  }

  Future<void> _writeCache(
    SharedPreferences prefs,
    LiveSource source,
    List<LiveChannel> channels,
  ) async {
    try {
      await prefs.setString(
        source.cacheKey,
        jsonEncode([for (final c in channels) c.toJson()]),
      );
      await prefs.setInt(
        source.cacheTsKey,
        DateTime.now().millisecondsSinceEpoch,
      );
    } catch (_) {
      // caché best-effort: nunca debe romper la reproducción
    }
  }
}
