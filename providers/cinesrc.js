// CineSRC — puerto a JS de lib/data/extractors/providers/cinesrc_extractor.dart
// (el CineSrcService Dart del repo del proyecto) al formato que ejecuta el motor
// de MasterScrap: CommonJS `module.exports = { getStreams }`.
//
// El original NO scrapea: solo construye la URL del embed con el ID de TMDb y
// emite UN servidor. El comentario del Dart es explícito: «MainFuentes se encarga
// del resto (extractor, verificación, etc.)» y avisa de que NO hay que duplicar
// entradas tipo «VideoApp»/«VidSrc» apuntando a la misma URL.
//
//   movie: https://cinesrc.st/embed/movie/<tmdbId>?color=%2300ff66&autoplay=true&...
//   tv   : https://cinesrc.st/embed/tv/<tmdbId>?s=<S>&e=<E>&color=%2300ff66&...
//
// Único añadido respecto al Dart: se comprueba que el embed responda. Si el
// servidor devuelve un error definitivo (404/410/5xx) se devuelve [] en vez de un
// enlace muerto; si es un fallo de red/timeout se mantiene el enlace (puede ser
// bloqueo del host, no que el sitio esté caído).
const BASE = 'https://cinesrc.st';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const FETCH_TIMEOUT = 12000;

function buildEmbedUrl(tmdbId, isMovie, season, episode) {
  var base = isMovie
    ? BASE + '/embed/movie/' + tmdbId
    : BASE + '/embed/tv/' + tmdbId + '?s=' + season + '&e=' + episode;
  var sep = base.indexOf('?') >= 0 ? '&' : '?';
  return (
    base + sep + 'color=%2300ff66&autoplay=true&autonext=true&back=close&prioritize=true'
  );
}

/** true = el embed vive; false = error definitivo del servidor. */
function embedVive(url) {
  var opts = {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'es-MX,es;q=0.9',
      Referer: BASE + '/',
    },
  };
  var timer = null;
  try {
    if (typeof AbortController !== 'undefined') {
      var controller = new AbortController();
      opts.signal = controller.signal;
      timer = setTimeout(function () {
        try {
          controller.abort();
        } catch (e) {}
      }, FETCH_TIMEOUT);
    }
  } catch (e) {
    timer = null;
  }
  function limpiar() {
    if (timer) {
      try {
        clearTimeout(timer);
      } catch (e) {}
      timer = null;
    }
  }
  return fetch(url, opts)
    .then(function (res) {
      limpiar();
      return !!res && res.status < 400;
    })
    .catch(function () {
      limpiar();
      return true; // fallo de red: no se descarta el enlace
    });
}

function getStreams(tmdbId, mediaType, season, episode) {
  var id = parseInt(tmdbId, 10);
  if (isNaN(id) || id <= 0) return Promise.resolve([]);
  var tipo = String(mediaType || 'movie').toLowerCase();
  var isMovie = tipo !== 'tv' && tipo !== 'series' && tipo !== 'anime';
  var s = parseInt(season, 10);
  var e = parseInt(episode, 10);
  if (isNaN(s) || s < 1) s = 1;
  if (isNaN(e) || e < 1) e = 1;

  var url = buildEmbedUrl(id, isMovie, s, e);

  return embedVive(url)
    .then(function (vive) {
      if (!vive) return [];
      return [
        {
          title: 'CineSRC',
          quality: 'HD',
          language: 'Latino',
          url: url,
          headers: { Referer: BASE + '/', 'User-Agent': UA },
        },
      ];
    })
    .catch(function () {
      return [];
    });
}

module.exports = { getStreams };
