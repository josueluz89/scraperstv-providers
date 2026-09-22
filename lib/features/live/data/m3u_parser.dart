// lib/features/live/data/m3u_parser.dart
//
// Parser TOLERANTE de listas de canales/M3U8 de canales en vivo.
//
// Rarezas reales de las listas que usa la app (medidas sobre principal.m3u):
//   - 196 de 688 líneas son `EXTINF:` SIN `#` (mal formadas) → se aceptan igual.
//   - Antes de cada EXTINF viene una línea de texto suelto con el nombre.
//   - `#EXTVLCOPT:http-user-agent|http-referrer|http-origin` → headers de red.
//   - 85 entradas EXTINF no tienen URL detrás → se descartan.
//   - El mismo canal aparece varias veces (espejos) → mergeMirrors los une.
import 'dart:convert';

import '../domain/live_channel.dart';

class M3uParser {
  static final RegExp _attr = RegExp(r'([A-Za-z0-9\-]+)="([^"]*)"');

  /// Convierte el texto de una lista M3U en canales (sin fusionar espejos).
  static List<LiveChannel> parse(String content) {
    final out = <LiveChannel>[];
    String? pendingName; // texto suelto anterior (fallback de nombre)
    String name = '';
    String group = '';
    String logo = '';
    var headers = <String, String>{};

    for (final raw in const LineSplitter().convert(content)) {
      final line = raw.trim();
      if (line.isEmpty) continue;

      final noHash = line.startsWith('#') ? line.substring(1) : line;
      final upper = noHash.toUpperCase();

      if (upper.startsWith('EXTM3U')) continue;
      if (upper.startsWith('EXTGRP')) continue;

      if (upper.startsWith('EXTINF')) {
        final body = noHash.substring('EXTINF'.length);
        final attrs = <String, String>{
          for (final m in _attr.allMatches(body)) m.group(1)!: m.group(2)!,
        };
        final comma = body.lastIndexOf(',');
        name = comma >= 0 ? body.substring(comma + 1).trim() : '';
        group = attrs['group-title'] ?? '';
        logo = attrs['tvg-logo'] ?? '';
        headers = <String, String>{};
        continue;
      }

      if (upper.startsWith('EXTVLCOPT')) {
        final opt = _vlcOpt(noHash);
        if (opt != null) headers[opt.key] = opt.value;
        continue;
      }

      if (line.startsWith('#')) continue; // otras directivas #EXT-X-… se ignoran

      if (line.startsWith('http')) {
        final clean = cleanName(name.isNotEmpty ? name : (pendingName ?? ''));
        if (clean.isNotEmpty) {
          out.add(
            LiveChannel(
              name: clean,
              group: group,
              logo: logo,
              urls: [line],
              headers: Map<String, String>.of(headers),
            ),
          );
        }
        name = '';
        headers = <String, String>{};
        continue;
      }

      pendingName = line; // línea de texto suelto = nombre candidato
    }
    return out;
  }

  /// Fusiona duplicados (mismo grupo + nombre) en un canal con espejos.
  static List<LiveChannel> mergeMirrors(List<LiveChannel> input) {
    final byKey = <String, LiveChannel>{};
    final order = <String>[];

    for (final c in input) {
      if (c.urls.isEmpty) continue;
      final key = '${c.group}|${_fold(c.name)}';
      final prev = byKey[key];
      if (prev == null) {
        byKey[key] = LiveChannel(
          name: c.name,
          group: c.group,
          logo: c.logo,
          urls: List<String>.of(c.urls),
          headers: c.headers,
        );
        order.add(key);
        continue;
      }
      final urls = List<String>.of(prev.urls);
      for (final u in c.urls) {
        if (!urls.contains(u)) urls.add(u);
      }
      byKey[key] = LiveChannel(
        name: prev.name,
        group: prev.group,
        logo: prev.logo.isNotEmpty ? prev.logo : c.logo,
        urls: urls,
        headers: prev.headers.isNotEmpty ? prev.headers : c.headers,
      );
    }
    return [for (final k in order) byKey[k]!];
  }

  /// "✔️ America TV" → "America TV"; quita selectores de variación y zero-width.
  static String cleanName(String raw) {
    var s = raw.replaceAll(
      RegExp(r'[\uFE0E\uFE0F\u200B-\u200D\u2060\u00A0\u2028\u2029]'),
      ' ',
    );
    // Marcas al inicio (✔️, 🎬, espacios, guiones) hasta la primera letra/dígito.
    s = s.replaceFirst(RegExp(r'^[^0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+'), '');
    return s.replaceAll(RegExp(r'\s+'), ' ').trim();
  }

  /// `#EXTVLCOPT:http-user-agent=X` → {'User-Agent': 'X'} (null si no aplica).
  static MapEntry<String, String>? _vlcOpt(String noHash) {
    final colon = noHash.indexOf(':');
    if (colon < 0) return null;
    final kv = noHash.substring(colon + 1);
    final eq = kv.indexOf('=');
    if (eq < 0) return null;

    final rawKey = kv.substring(0, eq).trim().toLowerCase();
    final value = kv.substring(eq + 1).trim();
    if (value.isEmpty) return null;

    switch (rawKey) {
      case 'http-user-agent':
        return MapEntry('User-Agent', value);
      case 'http-referrer':
      case 'http-referer':
        return MapEntry('Referer', value);
      case 'http-origin':
        return MapEntry('Origin', value);
      default:
        return null;
    }
  }

  /// Normaliza para comparar nombres (sin acentos ni signos).
  static String _fold(String s) {
    const accents = {
      'á': 'a',
      'à': 'a',
      'ä': 'a',
      'â': 'a',
      'é': 'e',
      'è': 'e',
      'ë': 'e',
      'ê': 'e',
      'í': 'i',
      'ì': 'i',
      'ï': 'i',
      'î': 'i',
      'ó': 'o',
      'ò': 'o',
      'ö': 'o',
      'ô': 'o',
      'ú': 'u',
      'ù': 'u',
      'ü': 'u',
      'û': 'u',
      'ñ': 'n',
      'ç': 'c',
    };
    var out = s.toLowerCase();
    accents.forEach((k, v) => out = out.replaceAll(k, v));
    return out.replaceAll(RegExp(r'[^a-z0-9]+'), ' ').trim();
  }
}
