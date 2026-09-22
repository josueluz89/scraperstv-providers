import 'dart:async';

class CineSrcServer {
  final String lang;       // latino
  final String name;       // CineSRC
  final String url;
  final String idiomaCode; // es_MX

  const CineSrcServer({
    required this.lang,
    required this.name,
    required this.url,
    required this.idiomaCode,
  });

  Map<String, dynamic> toModalMap() {
    return {
      'servidor_nombre': name,
      'servicio': 'CineSrc',
      'servidor_url': url,
      'calidad': 'HD',
      'idioma': idiomaCode,
      'estado': 'activo',
      'es_cinesrc': true,
    };
  }
}

class CineSrcService {
  /// Construye la URL de embed de CineSRC con los datos de TMDB.
  static String buildEmbedUrl({
    required int tmdbId,
    required bool isMovie,
    int season = 1,
    int episode = 1,
  }) {
    final base = isMovie
        ? 'https://cinesrc.st/embed/movie/$tmdbId'
        : 'https://cinesrc.st/embed/tv/$tmdbId?s=$season&e=$episode';

    final sep = base.contains('?') ? '&' : '?';
    return '$base${sep}color=%2300ff66&autoplay=true&autonext=true&back=close&prioritize=true';
  }

  /// Emite el servidor de CineSRC (la URL del embed). MainFuentes se encarga
  /// del resto (extractor, verificación, etc.).
  ///
  /// OJO: no se inventan entradas «VideoApp»/«VidSrc» duplicando esta misma
  /// URL. La original muestra esos nombres porque su APK lee los reproductores
  /// que publica el propio sitio; duplicar la URL solo mete servidores falsos
  /// que abren el mismo embed (y el que falla, falla tres veces).
  static Stream<CineSrcServer> scrape({
    required int tmdbId,
    required bool isMovie,
    int season = 1,
    int episode = 1,
  }) async* {
    final url = buildEmbedUrl(
      tmdbId: tmdbId,
      isMovie: isMovie,
      season: season,
      episode: episode,
    );

    yield CineSrcServer(
      lang: 'Latino',
      name: 'CineSRC',
      url: url,
      idiomaCode: 'es_MX',
    );
  }
}