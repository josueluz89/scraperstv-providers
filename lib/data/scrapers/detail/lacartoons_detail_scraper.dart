// lib/data/scrapers/detail/lacartoons_detail_scraper.dart
//
// Detalle de serie en LACartoons (https://www.lacartoons.com/serie/ID).
//
// Extrae: título, canal, episodios, idioma, año, valoración, reseña,
// poster, backdrop, temporadas + capítulos (/serie/capitulo/ID?t=T).
// Enriquece con TMDB (poster/backdrop/sinopsis/tmdbId) como el resto.
//
// Los servidores se resuelven en fase 2 (ver capítulo y su embed).
import 'dart:convert';
import '../base/base_detail_scraper.dart';
import '../../models/scraper/detalle_model.dart';

class DetalleLACartoons {
  static const _tmdbKey = 'a2d9bbed370d9f678e34006f8750a5a5';

  static Future<DetalleContenido> fetch({
    required String url,
    required String titulo,
    required String tipo,
  }) async {
    // Fase 2: si la URL es de un capítulo, el reproductor vive en el embed de
    // ESA página (hoy cubeembed.rpmvid.com), no en la de la serie.
    if (esCapitulo(url)) {
      return _fetchCapitulo(url: url, titulo: titulo);
    }

    final html = await fetchHtml(url);
    if (html == null) {
      return DetalleContenido(
        ok: false,
        error: 'No se pudo cargar',
        servicio: 'lacartoons',
        titulo: titulo,
        tipo: 'tv',
      );
    }

    String tituloFinal = titulo;
    String? anio, sinopsis, poster, backdrop, logo, imdbId;
    double? rating;
    int? tmdbId;
    String idioma = 'es_MX';
    final generos = <String>[];
    final temporadasMap = <int, List<DetalleCapitulo>>{};

    // Título: <h2 class="... subtitulo-serie-seccion ">Nombre <span ...>
    final h2 = RegExp(
      r'<h2[^>]*subtitulo-serie-seccion[^>]*>([\s\S]*?)</h2>',
      dotAll: true,
    ).firstMatch(html);
    if (h2 != null) {
      var raw = h2.group(1)!;
      // Canal dentro del h2.
      final canalM = RegExp(
        r'<span[^>]*>\s*([^<]+?)\s*</span>',
      ).firstMatch(raw);
      if (canalM != null) {
        final c = _d(canalM.group(1)!);
        if (c.isNotEmpty) generos.add(c);
      }
      // Título = texto antes del <span> del canal (si no, TMDB no matchea).
      raw = raw.split('<span').first;
      raw = raw.replaceAll(RegExp(r'<[^>]*>'), ' ');
      final t = _d(raw);
      if (t.isNotEmpty) tituloFinal = t;
    }

    // Poster: <div class="imagen-serie"><img src="...">
    final imgM = RegExp(
      r'<div class="imagen-serie">[\s\S]*?<img src="([^"]+)"',
      dotAll: true,
    ).firstMatch(html);
    if (imgM != null) poster = _absUrl(imgM.group(1)!);

    // Backdrop: <img class="fondo-serie-seccion" src="...">
    final bgM = RegExp(
      r'<img class="fondo-serie-seccion" src="([^"]+)"',
    ).firstMatch(html);
    if (bgM != null) backdrop = _absUrl(bgM.group(1)!);

    // Bloque info: Episodios / Idioma / Año / Valoración / Reseña
    final infoM = RegExp(
      r'<div class="informacion-serie-seccion">([\s\S]*?)</div>\s*</div>',
      dotAll: true,
    ).firstMatch(html);
    final info = infoM?.group(1) ?? html;

    final anioM = RegExp(r'Año:<span[^>]*>(\d{4})</span>').firstMatch(info);
    if (anioM != null) anio = anioM.group(1);

    final ratM = RegExp(
      r'Valoraci[oó]n:<span[^>]*>(\d+)',
    ).firstMatch(info);
    if (ratM != null) rating = double.tryParse(ratM.group(1)!);

    final idiomaM = RegExp(
      r'Idioma:<span>([^<]+)</span>',
    ).firstMatch(info);
    if (idiomaM != null) idioma = _normIdioma(idiomaM.group(1)!);

    final resM = RegExp(
      r'Reseña:<br><span>([\s\S]*?)</span>',
      dotAll: true,
    ).firstMatch(info);
    if (resM != null) {
      final r = _d(resM.group(1)!.replaceAll(RegExp(r'<[^>]*>'), ' '));
      if (r.isNotEmpty) sinopsis = r;
    }

    // Temporadas: <h4 class="accordion ..." data-temporada-id="N"> + panel
    final panelRe = RegExp(
      r'<h4[^>]*data-temporada-id="(\d+)"[^>]*>[\s\S]*?</h4>\s*'
      r'<div class="episodio-panel">([\s\S]*?)</div>\s*(?=<h4|</div>\s*</div>|\z)',
      dotAll: true,
    );
    for (final pm in panelRe.allMatches(html)) {
      final tempNum = int.tryParse(pm.group(1)!) ?? 0;
      if (tempNum <= 0) continue;
      final panel = pm.group(2)!;

      final epRe = RegExp(
        r'<a[^>]+href="(/serie/capitulo/\d+\?t=\d+)"[^>]*>([\s\S]*?)</a>',
        dotAll: true,
      );
      for (final em in epRe.allMatches(panel)) {
        final epUrl = 'https://www.lacartoons.com${em.group(1)}';
        var epBlock = em.group(2)!;
        int num = 0;
        String epTitulo = '';
        final spanM = RegExp(
          r'<span>\s*Capitulo\s*(\d+)-?\s*</span>\s*([^<]*)',
        ).firstMatch(epBlock);
        if (spanM != null) {
          num = int.tryParse(spanM.group(1)!) ?? 0;
          epTitulo = _d(spanM.group(2) ?? '');
        }
        if (epTitulo.isEmpty) {
          epTitulo = _d(epBlock.replaceAll(RegExp(r'<[^>]*>'), ' '));
        }
        if (num <= 0) continue;
        temporadasMap.putIfAbsent(tempNum, () => []);
        temporadasMap[tempNum]!.add(
          DetalleCapitulo(
            temporada: tempNum,
            numero: num,
            titulo: epTitulo.isEmpty ? 'Capítulo $num' : epTitulo,
            url: epUrl,
          ),
        );
      }
    }

    // TMDB: enriquecer poster/backdrop/sinopsis/tmdbId (tipo tv).
    await _enriquecerTmdb(
      titulo: tituloFinal,
      anio: anio,
      onResult: ({p, b, s, r, id, imdb, lg}) {
        if (p != null) poster = p;
        if (b != null) backdrop = b;
        if (s != null && (sinopsis == null || sinopsis!.isEmpty)) {
          sinopsis = s;
        }
        if (r != null && rating == null) rating = r;
        tmdbId = id;
        imdbId = imdb;
        logo = lg;
      },
    );

    final temporadas =
        temporadasMap.entries
            .map(
              (e) => DetalleTemporada(
                numero: e.key,
                nombre: 'Temporada ${e.key}',
                episodios: e.value
                  ..sort((a, b) => a.numero.compareTo(b.numero)),
              ),
            )
            .toList()
          ..sort((a, b) => a.numero.compareTo(b.numero));

    return DetalleContenido(
      ok: true,
      servicio: 'lacartoons',
      titulo: tituloFinal,
      tipo: 'tv',
      anio: anio,
      sinopsis: sinopsis,
      poster: poster,
      backdrop: backdrop,
      logo: logo,
      rating: rating,
      tmdbId: tmdbId,
      imdbId: imdbId,
      generos: generos,
      servidores: const [],
      temporadas: temporadas,
      extra: {'idioma': idioma},
    );
  }

  /// ¿La URL es de un capítulo del sitio? (/serie/capitulo/ID?t=N)
  static bool esCapitulo(String url) =>
      RegExp(r'/capitulo/\d+').hasMatch(url);

  /// Capítulo: devuelve el/los embed(s) del reproductor como servidores.
  /// La app los resuelve con su extractor (WebView) al reproducir.
  static Future<DetalleContenido> _fetchCapitulo({
    required String url,
    required String titulo,
  }) async {
    final html = await fetchHtml(url);
    if (html == null) {
      return DetalleContenido(
        ok: false,
        error: 'No se pudo cargar el capítulo',
        servicio: 'lacartoons',
        titulo: titulo,
        tipo: 'tv',
      );
    }

    final servidores = <DetalleServidor>[];
    final vistos = <String>{};
    for (final m in RegExp(r'<iframe[^>]+src="([^"]+)"').allMatches(html)) {
      final src = _absUrl(m.group(1)!.trim());
      if (!src.startsWith('http') || !vistos.add(src)) continue;
      servidores.add(
        DetalleServidor(
          nombre: 'LACartoons',
          url: src,
          idioma: 'es_MX',
          calidad: 'HD',
        ),
      );
    }

    if (servidores.isEmpty) {
      return DetalleContenido(
        ok: false,
        error: 'El capítulo no tiene reproductor',
        servicio: 'lacartoons',
        titulo: titulo,
        tipo: 'tv',
      );
    }

    return DetalleContenido(
      ok: true,
      servicio: 'lacartoons',
      titulo: titulo,
      tipo: 'tv',
      servidores: servidores,
      extra: {'idioma': 'es_MX'},
    );
  }

  static Future<void> _enriquecerTmdb({
    required String titulo,
    required String? anio,
    required void Function({
      String? p,
      String? b,
      String? s,
      double? r,
      int? id,
      String? imdb,
      String? lg,
    })
    onResult,
  }) async {
    try {
      var api =
          'https://api.themoviedb.org/3/search/tv?api_key=$_tmdbKey'
          '&query=${Uri.encodeComponent(titulo)}&language=es-MX';
      if (anio != null) api += '&first_air_date_year=$anio';
      final r = await fetchHtml(api);
      if (r == null) return;
      final j = jsonDecode(r);
      if (j['results'] is! List || (j['results'] as List).isEmpty) return;
      final first = (j['results'] as List).first;
      final id = first['id'];
      if (id == null) return;

      final detail = await fetchHtml(
        'https://api.themoviedb.org/3/tv/$id?api_key=$_tmdbKey'
        '&language=es-MX&append_to_response=images,external_ids',
      );
      if (detail == null) {
        onResult(id: id is int ? id : int.tryParse('$id'));
        return;
      }
      final d = jsonDecode(detail);
      String? p, b, lg;
      if (d['poster_path'] != null) {
        p = 'https://image.tmdb.org/t/p/w500${d['poster_path']}';
      }
      if (d['backdrop_path'] != null) {
        b = 'https://image.tmdb.org/t/p/original${d['backdrop_path']}';
      }
      final logos = d['images']?['logos'] as List? ?? [];
      for (final l in logos) {
        if (l['iso_639_1'] == 'es') {
          lg = 'https://image.tmdb.org/t/p/w500${l['file_path']}';
          break;
        }
      }
      lg ??= logos.isNotEmpty
          ? 'https://image.tmdb.org/t/p/w500${logos[0]['file_path']}'
          : null;
      onResult(
        p: p,
        b: b,
        s: d['overview']?.toString(),
        r: (d['vote_average'] as num?)?.toDouble(),
        id: id is int ? id : int.tryParse('$id'),
        imdb: d['external_ids']?['imdb_id']?.toString(),
        lg: lg,
      );
    } catch (_) {}
  }

  static String _absUrl(String src) {
    if (src.startsWith('http')) return src;
    if (src.startsWith('/')) return 'https://www.lacartoons.com$src';
    return 'https://www.lacartoons.com/$src';
  }

  static String _normIdioma(String raw) {
    final l = raw.toLowerCase();
    if (l.contains('latin')) return 'es_MX';
    if (l.contains('castellan') || l.contains('españa')) return 'es_ES';
    if (l.contains('sub') || l.contains('ingl')) return 'en_US';
    return 'es_MX';
  }

  static String _d(String s) => s
      .replaceAll('&amp;', '&')
      .replaceAll('&quot;', '"')
      .replaceAll('&#039;', "'")
      .replaceAll('&nbsp;', ' ')
      .replaceAll(RegExp(r'\s+'), ' ')
      .trim();
}
