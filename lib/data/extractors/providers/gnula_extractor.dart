// lib/data/extractors/providers/gnula_extractor.dart
//
// Extractor de servidores de GnulaHD (https://ww3.gnulahd.nu).
//
// Puerto a Dart del provider `masters.js` (id `masters`, "Masters (GnulaHD)")
// del repo catalogo-webs. Cadena verificada en vivo:
//
//   1. TMDB (es-MX) -> titulo + titulo original (queries de busqueda).
//   2. https://ww3.gnulahd.nu/?s=<q> -> tarjetas `gnrd-card` (href + title).
//   3. Puntuar candidatos (100 exacto / 80 contiene / resto por palabras) y
//      elegir el mejor `tv` o `movie` segun el tipo pedido.
//   4. Series: la pagina de la serie trae los episodios como `gnrd-epc` con
//      data-s / data-e -> href del capitulo exacto.
//   5. Pagina de play: `_gnrdPid`, `_gnrdTok` y (para the.tube) `RESOLVE`/`AUTH`.
//   6. GET /wp-json/gnrd/v1/player?id=<pid>&t=<tok> -> campo `p`.
//   7. Payload `p`: base64 variante + XOR con la clave fija [103,78,55,100]
//      -> JSON { langs: [ { label, servers: [ {title, src} ] } ] }.
//
// Solo encuentra embeds (NO resuelve HLS): igual que PelisPlus/HackStore, la
// app resuelve la fuente al reproducir (NativeResolvers o WebView).
// Excepcion: los servidores the.tube/they.tube se resuelven aqui mismo via
// /panel/the-tube-resolve.php y se emiten como `type: 'direct'` con headers.
//
// Fallbacks (como el provider original): busqueda por palabras sueltas y
// sonda de slug directa `/ver/<slug>/`.

import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;

class GnulaService {
  static const String _main = 'https://ww3.gnulahd.nu';
  static const String _fallback = 'https://gnulahd.nu';
  static const String _tmdbApiKey = '439c478a771f35c05022f9feabcca01c';
  static const String _userAgent =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  static const Duration _timeout = Duration(seconds: 15);

  /// Clave XOR del payload `p` de la API de GnulaHD (fija en su JS).
  static const List<int> _xorKey = [103, 78, 55, 100];

  /// Scrape progresivo. Emite mapas listos para el modal / MainFuentes.
  static Stream<Map<String, dynamic>> scrape({
    required int tmdbId,
    required bool isMovie,
    int season = 1,
    int episode = 1,
  }) async* {
    if (tmdbId <= 0) return;

    try {
      final tmdbType = isMovie ? 'movie' : 'tv';
      final media = await _tmdbMedia(tmdbId, tmdbType);
      if (media == null) return;

      final queries = <String>[];
      if (media.originalTitle.isNotEmpty) queries.add(media.originalTitle);
      if (media.title.isNotEmpty && media.title != media.originalTitle) {
        queries.add(media.title);
      }
      if (queries.isEmpty) return;

      final target = await _findTarget(
        media: media,
        queries: queries,
        isMovie: isMovie,
      );
      if (target == null) return;

      final pageUrl = target.url;
      final esSerie = !isMovie || target.type == 'tv';

      var playUrl = pageUrl;
      if (esSerie) {
        final serieHtml = await _get(pageUrl, referer: _main + '/');
        if (serieHtml == null) return;
        final epHref = _episodioHref(serieHtml, season, episode);
        if (epHref == null) return;
        playUrl = _absoluta(epHref);
      }

      final servers = await _servidoresDe(playUrl);
      final seen = <String>{};
      for (final s in servers) {
        final url = s['servidor_url']?.toString() ?? '';
        if (url.isEmpty || !seen.add(url)) continue;
        yield s;
      }
    } catch (_) {
      // Silencioso: el agregador maneja errores por fuente.
    }
  }

  // ─────────────────────────────────────────────────────────
  // TMDB
  // ─────────────────────────────────────────────────────────

  static Future<_GnulaMedia?> _tmdbMedia(int tmdbId, String type) async {
    Future<Map<String, dynamic>?> pedir(String lang) async {
      final body = await _get(
        'https://api.themoviedb.org/3/$type/$tmdbId'
        '?api_key=$_tmdbApiKey&language=$lang',
      );
      if (body == null) return null;
      try {
        final j = jsonDecode(body);
        return j is Map<String, dynamic> ? j : null;
      } catch (_) {
        return null;
      }
    }

    final es = await pedir('es-MX');
    final en = es == null ? await pedir('es-ES') : null;
    final data = es ?? en;
    if (data == null) return null;

    final title = (data['title'] ?? data['name'])?.toString().trim() ?? '';
    final original =
        (data['original_title'] ?? data['original_name'])?.toString().trim() ??
            '';
    if (title.isEmpty && original.isEmpty) return null;
    return _GnulaMedia(title: title, originalTitle: original);
  }

  // ─────────────────────────────────────────────────────────
  // Seleccion del titulo en el sitio
  // ─────────────────────────────────────────────────────────

  static Future<_GnulaTarget?> _findTarget({
    required _GnulaMedia media,
    required List<String> queries,
    required bool isMovie,
  }) async {
    final normOriginals = <String>[_norm(media.originalTitle)]
        .where((e) => e.isNotEmpty)
        .toList();
    final normTitles =
        <String>[_norm(media.title)].where((e) => e.isNotEmpty).toList();

    var bestTvScore = -1;
    String? bestTvUrl;
    var bestMovieScore = -1;
    String? bestMovieUrl;

    void puntuar(_GnulaCand cand) {
      final nc = _norm(cand.title);
      if (nc.isEmpty) return;
      var score = 0;

      for (final no in normOriginals) {
        if (nc == no) {
          score = 100;
        } else if (nc.contains(no) || no.contains(nc)) {
          score = score > 80 ? score : 80;
        }
      }
      for (final nt in normTitles) {
        if (nc == nt) {
          score = score > 100 ? score : 100;
        } else if (nc.contains(nt) || nt.contains(nc)) {
          score = score > 80 ? score : 80;
        }
      }

      if (score == 0) {
        final qWords = <String>{}
          ..addAll(normOriginals.expand((e) => e.split(' ')))
          ..addAll(normTitles.expand((e) => e.split(' ')));
        final cWords = nc.split(' ').where((w) => w.isNotEmpty).toSet();
        var qMatch = 0;
        for (final w in qWords) {
          if (w.isNotEmpty && nc.contains(w)) qMatch++;
        }
        var cMatch = 0;
        for (final w in cWords) {
          if (qWords.contains(w)) cMatch++;
        }
        score = qMatch * 8 + cMatch * 5;
      }

      if (cand.type == 'tv' && score > bestTvScore) {
        bestTvScore = score;
        bestTvUrl = cand.href;
      }
      if (cand.type == 'movie' && score > bestMovieScore) {
        bestMovieScore = score;
        bestMovieUrl = cand.href;
      }
    }

    _GnulaTarget? seleccionar() {
      String? url;
      var type = 'movie';
      if (!isMovie && bestTvUrl != null) {
        url = bestTvUrl;
        type = 'tv';
      } else if (isMovie && bestMovieUrl != null) {
        url = bestMovieUrl;
      } else {
        url = bestTvUrl ?? bestMovieUrl;
        type = bestTvUrl != null ? 'tv' : 'movie';
      }
      if (url == null || url.isEmpty) return null;
      return _GnulaTarget(url: _absoluta(url), type: type);
    }

    for (final q in queries) {
      final cands = await _buscar(q);
      for (final c in cands) {
        puntuar(c);
      }
    }

    final directo = seleccionar();
    if (directo != null) return directo;

    // Fallback 1: buscar por palabras distintivas (max 3, sin stopwords).
    final palabras = _palabrasBusqueda(media);
    if (palabras.isNotEmpty) {
      final antesTv = bestTvScore;
      final antesMovie = bestMovieScore;
      for (final w in palabras) {
        final cands = await _buscar(w);
        for (final c in cands) {
          puntuar(c);
        }
      }
      final t = seleccionar();
      final mejoro = bestMovieScore > antesMovie || bestTvScore > antesTv;
      if (t != null && (mejoro || bestMovieScore >= 15 || bestTvScore >= 15)) {
        return t;
      }
    }

    // Fallback 2: sonda directa de slug (/ver/<slug>/) buscando _gnrdPid.
    final slugs = <String>{};
    for (final t in [media.title, media.originalTitle]) {
      final s = _slug(t);
      if (s.isNotEmpty) slugs.add(s);
    }
    for (final slug in slugs) {
      final url = '$_main/ver/$slug/';
      final html = await _get(url, referer: _main + '/');
      if (html != null && html.contains('_gnrdPid')) {
        return _GnulaTarget(url: url, type: 'movie');
      }
    }
    return null;
  }

  static Future<List<_GnulaCand>> _buscar(String query) async {
    var html = await _get(
      '$_main/?s=${Uri.encodeComponent(query)}',
      referer: _main + '/',
    );
    // El sitio rota subdominios (ww3 / gnulahd): reintento en el dominio pelado.
    if (html == null) {
      html = await _get(
        '$_fallback/?s=${Uri.encodeComponent(query)}',
        referer: _fallback + '/',
      );
    }
    if (html == null) return const [];

    final cands = <_GnulaCand>[];
    final re = RegExp(
      r'<a[^>]*class="[^"]*gnrd-card[^"]*"[^>]*href="([^"]*)"[^>]*title="([^"]*)"',
      caseSensitive: false,
    );
    for (final m in re.allMatches(html)) {
      final href = m.group(1) ?? '';
      final title = _d(m.group(2) ?? '');
      if (href.isEmpty || title.isEmpty) continue;
      // El tipo (tv/movie) no se distingue en la tarjeta: se prueban ambos.
      cands.add(_GnulaCand(title: title, href: href, type: 'tv'));
      cands.add(_GnulaCand(title: title, href: href, type: 'movie'));
    }
    return cands;
  }

  // ─────────────────────────────────────────────────────────
  // Pagina de play
  // ─────────────────────────────────────────────────────────

  static String? _episodioHref(String html, int season, int episode) {
    final re = RegExp(
      r'<a[^>]*class="[^"]*gnrd-epc[^"]*"([\s\S]*?)>',
      caseSensitive: false,
    );
    for (final m in re.allMatches(html)) {
      final attrs = m.group(1) ?? '';
      final href = RegExp(r'href="([^"]*)"', caseSensitive: false)
          .firstMatch(attrs)
          ?.group(1);
      final s = RegExp(r'data-s="(\d+)"', caseSensitive: false)
          .firstMatch(attrs)
          ?.group(1);
      final e = RegExp(r'data-e="(\d+)"', caseSensitive: false)
          .firstMatch(attrs)
          ?.group(1);
      if (href == null || s == null || e == null) continue;
      if (int.tryParse(s) == season && int.tryParse(e) == episode) return href;
    }
    return null;
  }

  static Future<List<Map<String, dynamic>>> _servidoresDe(String playUrl) async {
    final html = await _get(playUrl, referer: _main + '/');
    if (html == null) return const [];

    final langs = await _langs(playUrl, html);
    if (langs.isEmpty) return const [];

    // Igual que el provider: primero los servidores latinos; si no hay
    // ninguno, se usan todos los idiomas disponibles.
    final latino = <Map<String, dynamic>>[];
    final otros = <Map<String, dynamic>>[];
    for (final l in langs) {
      final label = (l['label']?.toString() ?? '');
      final low = label.toLowerCase();
      if (low.contains('latino') || low.contains('mx')) {
        latino.add(l);
      } else {
        otros.add(l);
      }
    }
    final usar = latino.isNotEmpty ? latino : otros;
    final esFallback = latino.isEmpty;

    var resolvePath = '';
    var authParam = '';
    final rm = RegExp(r"var\s+RESOLVE\s*=\s*'([^']*)'\s*,\s*AUTH\s*=\s*'([^']*)'")
        .firstMatch(html);
    if (rm != null) {
      resolvePath = rm.group(1) ?? '';
      authParam = rm.group(2) ?? '';
    }

    final out = <Map<String, dynamic>>[];
    for (final lang in usar) {
      final label = lang['label']?.toString() ?? '';
      final lTag = esFallback ? label : 'Latino';
      final idioma = _idioma(label);
      final servers = lang['servers'];
      if (servers is! List) continue;

      for (final raw in servers) {
        if (raw is! Map) continue;
        var src = (raw['src']?.toString() ?? '').replaceAll(r'\/', '/');
        if (src.isEmpty) continue;
        if (src.startsWith('//')) src = 'https:$src';
        final srvTitle = raw['title']?.toString() ?? '';

        // the.tube / they.tube: se resuelve aqui (directo, sin WebView).
        if ((src.contains('they.tube') || src.contains('the.tube')) &&
            resolvePath.isNotEmpty &&
            authParam.isNotEmpty) {
          final codeM = RegExp(
            r'the(?:y)?\.tube/(?:e/)?([A-Za-z0-9_-]+?)(?:\.html)?(?:[?#]|$)',
            caseSensitive: false,
          ).firstMatch(src);
          if (codeM != null) {
            final res = await _resolverTheTube(
              codeM.group(1)!,
              resolvePath,
              authParam,
              playUrl,
            );
            if (res != null) {
              out.add({
                'servidor_url': res['url'],
                'servidor': 'GnulaHD (${srvTitle.isEmpty ? 'Tube' : srvTitle})',
                'server': 'GnulaHD Tube',
                'idioma': idioma,
                'language': idioma,
                'idioma_label': lTag,
                'type': 'direct',
                'url': res['url'],
                'quality': res['quality'],
                'headers': res['headers'],
                'provider': 'GnulaHD',
                'es_gnula': true,
              });
            }
            continue;
          }
        }

        final serverName = _etiquetaServidor(src);
        out.add({
          'servidor_url': src,
          'servidor': srvTitle.isEmpty ? serverName : srvTitle,
          'server': serverName,
          'idioma': idioma,
          'language': idioma,
          'idioma_label': lTag,
          'type': 'embed',
          'url': src,
          'quality': 'HD',
          'provider': 'GnulaHD',
          'es_gnula': true,
        });
      }
    }
    return out;
  }

  /// Lista de idiomas con sus servidores: API oficial o, si falla, la vieja
  /// variable `_gnpv_ep_langs` / `_gd` embebida en el HTML.
  static Future<List<Map<String, dynamic>>> _langs(
    String playUrl,
    String html,
  ) async {
    final pid =
        RegExp(r'_gnrdPid\s*=\s*(\d+)').firstMatch(html)?.group(1);
    final tok =
        RegExp(r'_gnrdTok\s*=\s*"([^"]+)"').firstMatch(html)?.group(1);
    if (pid == null || tok == null) return _langsLegacy(html);

    final body = await _get(
      '$_main/wp-json/gnrd/v1/player'
      '?id=$pid&t=${Uri.encodeComponent(tok)}',
      referer: playUrl,
    );
    if (body != null) {
      try {
        final j = jsonDecode(body);
        final p = j is Map ? j['p'] : null;
        final d = _gnrdUnpack(p?.toString());
        if (d != null && d['langs'] is List) {
          return (d['langs'] as List)
              .whereType<Map>()
              .map((e) => Map<String, dynamic>.from(e))
              .toList();
        }
      } catch (_) {}
    }
    return _langsLegacy(html);
  }

  static List<Map<String, dynamic>> _langsLegacy(String html) {
    final m = RegExp(
      r'var\s+(_gnpv_ep_langs|_gd)\s*=\s*(\[.*?\]);',
      dotAll: true,
    ).firstMatch(html);
    if (m == null) return const [];
    try {
      final j = jsonDecode(m.group(2)!);
      if (j is List) {
        return j
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList();
      }
    } catch (_) {}
    return const [];
  }

  /// Payload `p`: base64 variante + XOR con clave fija -> JSON de idiomas.
  static Map<String, dynamic>? _gnrdUnpack(String? s) {
    if (s == null || s.isEmpty) return null;
    try {
      const chars =
          'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
      final str = s.replaceFirst(RegExp(r'=+$'), '');
      final bytes = <int>[];
      var bs = 0, bc = 0;
      for (var i = 0; i < str.length; i++) {
        final idx = chars.indexOf(str[i]);
        if (idx == -1) continue;
        bs = bc % 4 != 0 ? bs * 64 + idx : idx;
        // `bc` se incrementa ANTES de calcular el desplazamiento (asi lo hace
        // el JS original: `if (bc++ % 4) bytes.push(... (bs >> ((-2 * bc) & 6)))`).
        if (bc % 4 != 0) {
          bc += 1;
          bytes.add(255 & (bs >> ((-2 * bc) & 6)));
        } else {
          bc += 1;
        }
      }
      for (var i = 0; i < bytes.length; i++) {
        bytes[i] = bytes[i] ^ _xorKey[i & 3];
      }
      final text = utf8.decode(Uint8List.fromList(bytes), allowMalformed: true);
      final j = jsonDecode(text);
      return j is Map<String, dynamic> ? j : null;
    } catch (_) {
      return null;
    }
  }

  /// Resuelve un embed the.tube con el endpoint propio del sitio.
  static Future<Map<String, dynamic>?> _resolverTheTube(
    String code,
    String resolvePath,
    String authParam,
    String pageUrl,
  ) async {
    final url = '$_main$resolvePath${Uri.encodeComponent(code)}$authParam';
    final body = await _get(url, referer: pageUrl);
    if (body == null) return null;
    try {
      final j = jsonDecode(body);
      final master = j is Map ? j['master']?.toString() : null;
      if (master == null || master.isEmpty) return null;
      return {
        'url': master,
        'quality': '1080p',
        'headers': {
          'Referer': 'https://they.tube/',
          'User-Agent': _userAgent,
        },
      };
    } catch (_) {
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────

  /// Etiqueta legible del host del embed (igual que el provider original).
  static String _etiquetaServidor(String url) {
    final s = url.toLowerCase();
    const voe = [
      'voe.sx',
      'tubeless',
      'simpulum',
      'uroch',
      'nathanfromsubject',
      'yip.su',
      'metagnath',
      'donaldlineelse',
      'crystal',
      'cloudwindow',
    ];
    if (voe.any(s.contains)) return 'VOE';
    if (s.contains('they.tube') || s.contains('the.tube')) return 'Tube';
    if (s.contains('filemoon') || s.contains('bysedi') || s.contains('byse')) {
      return 'FileMoon';
    }
    if (s.contains('streamwish') ||
        s.contains('hlswish') ||
        s.contains('vibuxer') ||
        s.contains('strwish') ||
        s.contains('vidsonic')) {
      return 'StreamWish';
    }
    if (s.contains('vidhide') ||
        s.contains('dintezuvio') ||
        s.contains('filelions')) {
      return 'VidHide';
    }
    if (s.contains('uqload')) return 'Uqload';
    if (s.contains('luluvid') || s.contains('lulus')) return 'Lulu';
    if (s.contains('ok.ru') || s.contains('ok video')) return 'OK';
    return 'Online';
  }

  static String _idioma(String label) {
    final l = label.toLowerCase();
    if (l.contains('castellan') || l.contains('españ') || l.contains('espana')) {
      return 'es_ES';
    }
    if (l.contains('sub') || l.contains('ingl') || l.contains('english')) {
      return 'en_US';
    }
    return 'es_MX';
  }

  static const Map<String, String> _accentMap = {
    'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u', 'ü': 'u', 'ñ': 'n',
    'Á': 'a', 'É': 'e', 'Í': 'i', 'Ó': 'o', 'Ú': 'u', 'Ü': 'u', 'Ñ': 'n',
    'à': 'a', 'è': 'e', 'ì': 'i', 'ò': 'o', 'ù': 'u', 'â': 'a', 'ê': 'e',
    'î': 'i', 'ô': 'o', 'û': 'u', 'ä': 'a', 'ë': 'e', 'ï': 'i', 'ö': 'o',
    'ç': 'c', 'ã': 'a', 'õ': 'o',
  };

  static String _sinAcentos(String s) {
    final sb = StringBuffer();
    for (final r in s.runes) {
      final c = String.fromCharCode(r);
      sb.write(_accentMap[c] ?? (r > 127 ? '' : c));
    }
    return sb.toString();
  }

  static String _norm(String text) => _sinAcentos(text.toLowerCase())
      .replaceAll(RegExp(r'[^a-z0-9]'), ' ')
      .replaceAll(RegExp(r'\s+'), ' ')
      .trim();

  static String _slug(String text) => _sinAcentos(text.toLowerCase())
      .replaceAll(RegExp(r'[^a-z0-9]+'), '-')
      .replaceAll(RegExp(r'^-|-$'), '')
      .trim();

  static const Set<String> _stopwords = {
    'y', 'de', 'la', 'el', 'los', 'las', 'un', 'una', 'del', 'al', 'e', 'u',
    'o', 'en', 'con', 'por', 'para', 'the', 'a', 'an', 'of', 'and', 'to', 'in',
    'on', 'vs',
  };

  /// Palabras mas distintivas del titulo (max 3, como el provider original).
  static List<String> _palabrasBusqueda(_GnulaMedia media) {
    final todas = <String>{}
      ..addAll(_norm(media.originalTitle).split(' '))
      ..addAll(_norm(media.title).split(' '));
    final out = todas
        .where((w) => w.length >= 3 && !_stopwords.contains(w))
        .toList()
      ..sort((a, b) => b.length.compareTo(a.length));
    return out.take(3).toList();
  }

  static String _absoluta(String href) {
    if (href.startsWith('http')) return href;
    if (href.startsWith('/')) return '$_main$href';
    return '$_main/$href';
  }

  static String _d(String s) => s
      .replaceAll('&#8211;', '-')
      .replaceAll('&amp;', '&')
      .replaceAll('&quot;', '"')
      .replaceAll('&#039;', "'")
      .replaceAll('&nbsp;', ' ')
      .replaceAll(RegExp(r'<[^>]*>'), '')
      .replaceAll(RegExp(r'\s+'), ' ')
      .trim();

  static Future<String?> _get(String url, {String? referer}) async {
    try {
      final res = await http
          .get(
            Uri.parse(url),
            headers: {
              'User-Agent': _userAgent,
              'Accept':
                  'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'es-MX,es;q=0.9',
              'Cache-Control': 'no-cache',
              if (referer != null) 'Referer': referer,
            },
          )
          .timeout(_timeout);
      if (res.statusCode != 200) return null;
      return utf8.decode(res.bodyBytes, allowMalformed: true);
    } catch (_) {
      return null;
    }
  }
}

class _GnulaMedia {
  final String title;
  final String originalTitle;

  const _GnulaMedia({required this.title, required this.originalTitle});
}

class _GnulaCand {
  final String title;
  final String href;
  final String type;

  const _GnulaCand({
    required this.title,
    required this.href,
    required this.type,
  });
}

class _GnulaTarget {
  final String url;
  final String type;

  const _GnulaTarget({required this.url, required this.type});
}
