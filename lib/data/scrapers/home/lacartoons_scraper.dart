// lib/data/scrapers/home/lacartoons_scraper.dart
//
// Catálogo de LACartoons (https://www.lacartoons.com).
// Solo series animadas clásicas, casi todo en español latino.
//
// Listado:    GET /?page=N
// Categorías: GET /?Categoria_id=1..8[&page=N]
// Búsqueda:   ver BuscadorScraper.searchLACartoons (GET /?Titulo=...)
import '../base/base_home_scraper.dart';

class LACartoonsScraper {
  static const String base = 'https://www.lacartoons.com';

  /// slug -> Categoria_id del sitio.
  static const Map<String, String> categorias = {
    'nickelodeon': '1',
    'cartoon-network': '2',
    'fox-kids': '3',
    'hanna-barbera': '4',
    'disney': '5',
    'warner': '6',
    'marvel': '7',
    'otros': '8',
  };

  static const List<String> generos = [
    'nickelodeon',
    'cartoon-network',
    'fox-kids',
    'hanna-barbera',
    'disney',
    'warner',
    'marvel',
    'otros',
  ];

  static List<String> tiposDisponibles() => ['tv'];

  static Future<ScraperResult> fetch({
    required String tipo,
    String? genero,
    int page = 1,
  }) async {
    if (tipo != 'tv' && tipo != 'serie' && tipo != 'series') {
      return ScraperResult(
        ok: false,
        error: 'LACartoons solo tiene series (tipo tv)',
      );
    }

    String? catId;
    if (genero != null && genero.isNotEmpty) {
      catId = categorias[genero];
      if (catId == null) {
        return ScraperResult(ok: false, error: 'Categoría desconocida: $genero');
      }
    }

    final qp = <String, String>{};
    if (catId != null) qp['Categoria_id'] = catId;
    if (page > 1) qp['page'] = '$page';
    final url = qp.isEmpty
        ? '$base/'
        : '$base/?${qp.entries.map((e) => '${e.key}=${e.value}').join('&')}';

    final html = await fetchHtml(url);
    if (html == null) {
      return ScraperResult(
        ok: false,
        error: 'No se pudo cargar la página',
        url: url,
      );
    }

    final items = _parseItems(html);
    final pagination = _parsePagination(html, page);

    return ScraperResult(
      ok: true,
      section: catId != null ? _generoLabel(_categoriaSlug(catId)) : 'Series clásicas',
      url: url,
      currentPage: pagination['current'] as int,
      totalPages: pagination['total'] as int,
      hasNext: pagination['has_next'] as bool,
      items: items,
    );
  }

  static List<ScraperItem> _parseItems(String html) {
    final items = <ScraperItem>[];
    final seen = <String>{};

    // Cards: <a href="/serie/ID"> ... <img src=".."> ...
    //   <p class="nombre-serie">Titulo</p> ... marcador-ano>AÑO ... valoracion>N
    final cards = RegExp(
      r'<a href="(/serie/\d+)"[^>]*>([\s\S]*?)</a>',
    ).allMatches(html);

    for (final card in cards) {
      final href = card.group(1)!;
      final block = card.group(2)!;
      if (!block.contains('nombre-serie')) continue;

      final url = '$base$href';
      if (!seen.add(url)) continue;

      String titulo = '';
      final t = RegExp(
        r'<p class="nombre-serie">([^<]+)</p>',
      ).firstMatch(block);
      if (t != null) titulo = _decode(t.group(1)!.trim());

      String poster = '';
      final img = RegExp(r'<img src="([^"]+)"').firstMatch(block);
      if (img != null) {
        final src = img.group(1)!;
        poster = src.startsWith('http') ? src : '$base$src';
      }

      int? anio;
      final y = RegExp(r'marcador-ano">(\d{4})<').firstMatch(block);
      if (y != null) anio = int.tryParse(y.group(1)!);

      double? rating;
      final r = RegExp(r'valoracion">(\d+)').firstMatch(block);
      if (r != null) rating = double.tryParse(r.group(1)!);

      final generos = <String>[];
      final canal = RegExp(
        r'<span class="marcador[^"]*">\s*([^<]+?)\s*</span>',
      ).firstMatch(block);
      if (canal != null) {
        final c = _decode(canal.group(1)!.trim());
        if (c.isNotEmpty && !RegExp(r'^\d+$').hasMatch(c)) generos.add(c);
      }

      if (titulo.isNotEmpty) {
        items.add(
          ScraperItem(
            titulo: titulo,
            tipo: 'tv',
            url: url,
            poster: poster,
            year: anio,
            rating: rating,
            generos: generos,
          ),
        );
      }
    }
    return items;
  }

  static Map<String, dynamic> _parsePagination(String html, int page) {
    // El paginador enlaza /?page=N (con o sin Categoria_id delante).
    int total = page;
    final nums = RegExp(r'[?&]page=(\d+)').allMatches(html).map(
      (m) => int.tryParse(m.group(1)!) ?? 0,
    );
    for (final n in nums) {
      if (n > total) total = n;
    }

    return {
      'current': page,
      'total': total,
      'has_next': total > page,
      'has_prev': page > 1,
    };
  }

  static String _categoriaSlug(String id) {
    for (final e in categorias.entries) {
      if (e.value == id) return e.key;
    }
    return 'otros';
  }

  static String _generoLabel(String slug) => slug
      .replaceAll('-', ' ')
      .split(' ')
      .map((w) => w.isEmpty ? w : '${w[0].toUpperCase()}${w.substring(1)}')
      .join(' ');

  static String _decode(String s) => s
      .replaceAll('&amp;', '&')
      .replaceAll('&quot;', '"')
      .replaceAll('&#039;', "'")
      .replaceAll('&nbsp;', ' ')
      .replaceAll(RegExp(r'\s+'), ' ')
      .trim();
}
