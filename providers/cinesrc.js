// CineSRC — embedding oficial del sitio (cinesrc.st). Verificado 2026-09-23.
//
// QUÉ ES: CineSrc es una "Free Video Streaming API" (Next.js) que expone
//    movie : https://cinesrc.st/embed/movie/<tmdbId>
//    tv    : https://cinesrc.st/embed/tv/<tmdbId>?s=<S>&e=<E>
// Documentación: https://cinesrc.st/docs (parámetros abajo). El sitio NO publica
// una lista de servidores ni un .m3u8: el reproductor del embed elige el servidor
// adentro, así que este provider emite UN stream que ES el embed.
//
// POR QUÉ NO SE RESUELVE EL m3u8 AQUÍ (no perder tiempo reintentándolo):
// el embed está detrás de una barrera proof-of-work. El flujo real es
//   1) POST /api/c/bootstrap   header x-cs-q = base64url(JSON [tipo,id,S,E]) -> {r, p}
//   2) GET  /api/c/issue       headers x-cs-r, x-cs-q, x-cs-p -> reto {w:"CSP3…", t, n, s}
//   3) GET  /api/c/stage2/issue headers x-cs-r, x-cs-q -> segundo reto {pack:[hash,52,…]}
// y el reto lo resuelve el propio embed con WebAssembly (/pow-worker-v3.js +
// /pow-v3.wasm, 11 KB) más un script ofuscado (/300726c-prod.js, 150 KB). El
// runtime de los providers (QuickJS) no tiene WebAssembly, ni Workers, ni
// crypto.subtle, así que el reto no se puede resolver dentro del provider. Los
// endpoints que devolverían el medio (/api/c/media, /resolve, /pack, /stream,
// /sources, /video…) no existen: dan 404. Conclusión: esto solo funciona si el
// reproductor de la app abre el embed en un WebView con WASM.
//
// CAMBIOS respecto al Dart original: se usan los parámetros documentados en
// /docs (autoskip y seek no estaban) y se deja constancia de lo de arriba.
//
// Nota sobre la comprobación: el shell del embed responde 200 incluso con un
// TMDB id inventado (probado con /embed/movie/1 y /embed/movie/abc), así que
// esto detecta caídas reales del sitio (404/410/5xx, DNS) pero no contenido
// inexistente. Si falla la red NO se descarta el enlace (puede ser bloqueo al
// host que consulta, no al usuario que reproduce).
const BASE = 'https://cinesrc.st';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const FETCH_TIMEOUT = 12000;

// Parámetros documentados en https://cinesrc.st/docs
//   seek (1-99, def 10) · autoplay (def true) · muted (def false) · controls (def true)
//   back ("close" = postMessage al padre) · autonext (def true) · autoskip (def false)
//   prioritize (def false) · lastserver · t/time · continueprompt · quality · color
const PARAMS = [
  'color=%2300ff66',
  'autoplay=true',
  'autonext=true',
  'autoskip=true',
  'seek=15',
  'controls=true',
  'back=close',
  'prioritize=true',
].join('&');

function buildEmbedUrl(tmdbId, isMovie, season, episode) {
  var base = isMovie
    ? BASE + '/embed/movie/' + tmdbId
    : BASE + '/embed/tv/' + tmdbId + '?s=' + season + '&e=' + episode;
  var sep = base.indexOf('?') >= 0 ? '&' : '?';
  return base + sep + PARAMS;
}

/** true = el embed responde; false = error definitivo del servidor. */
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
          title: isMovie ? 'CineSRC · Película' : 'CineSRC · ' + s + 'x' + e,
          quality: 'HD',
          language: 'Multi',
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
