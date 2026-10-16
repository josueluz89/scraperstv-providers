// ===== MasterScrap: validacion de enlaces funcionales (inyectado) =====
// Prueba cada URL con sus headers reales; descarta muertos (4xx/5xx/timeout),
// elimina duplicados y ordena por calidad. ESTRICTO v2: solo pasa VIDEO REAL
// reproducible (video/*, mpegurl o extension de video con 2xx); las paginas
// HTML de embed sin resolver se descartan. QuickJS-safe.
var __msValidate = (function () {
  var TIMEOUT_MS = 7000;
  var CONCURRENCY = 4;
  function qualityRank(q) {
    if (!q) return 0;
    var s = String(q).toLowerCase();
    if (s.indexOf('4k') !== -1 || s.indexOf('2160') !== -1) return 2160;
    var m = s.match(/(\d{3,4})\s*p/);
    if (m) return parseInt(m[1], 10);
    return 0;
  }
  function isM3u8(url) { return /\.m3u8(\?|#|$)/i.test(url || ''); }
  function hasVideoExt(url) { return /\.(mp4|m3u8|mkv|webm|ts|m4v|mov)(\?|#|$)/i.test(url || ''); }
  function isVideoResp(ct, url) {
    var c = '';
    try { c = String(ct || '').toLowerCase().split(';')[0].trim(); } catch (e) {}
    if (c.indexOf('video/') === 0) return true;
    if (c === 'application/vnd.apple.mpegurl' || c === 'application/x-mpegurl') return true;
    if (c === 'application/octet-stream' || c === 'binary/octet-stream') return hasVideoExt(url);
    if (!c) return hasVideoExt(url);
    return false;
  }
  function getCT(res) {
    try { if (res && res.headers && typeof res.headers.get === 'function') return res.headers.get('content-type'); } catch (e) {}
    return '';
  }
  function checkUrl(url, headers, timeoutMs) {
    return new Promise(function (resolve) {
      var done = false, timer = null, controller = null;
      function finish(ok) {
        if (done) return; done = true;
        if (timer) { try { clearTimeout(timer); } catch (e) {} timer = null; }
        if (controller) { try { controller.abort(); } catch (e) {} }
        resolve(!!ok);
      }
      if (!url || typeof url !== 'string' || url.indexOf('http') !== 0) { resolve(false); return; }
      if (typeof setTimeout !== 'undefined') {
        timer = setTimeout(function () { timer = null; finish(false); }, timeoutMs || TIMEOUT_MS);
      }
      var reqHeaders = { 'Range': 'bytes=0-2047',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' };
      if (headers) for (var k in headers) {
        if (Object.prototype.hasOwnProperty.call(headers, k) && headers[k]) reqHeaders[k] = headers[k];
      }
      var reqInit = { headers: reqHeaders, redirect: 'follow' };
      try {
        if (typeof AbortController !== 'undefined') { controller = new AbortController(); reqInit.signal = controller.signal; }
      } catch (e) { controller = null; }
      fetch(url, reqInit).then(function (res) {
        var st = res.status;
        if (st === 200 || st === 206 || st === 416) {
          if (isM3u8(url)) {
            res.text().then(function (t) { finish(t && t.indexOf('#EXTM3U') !== -1); }).catch(function () { finish(true); });
          } else if (st === 416) { finish(true); }
          else if (!isVideoResp(getCT(res), url)) { finish(false); }
          else finish(true);
        } else finish(false);
      }).catch(function () { finish(false); });
    });
  }
  function filterWorkingStreams(streams, opts) {
    opts = opts || {};
    var timeout = opts.timeoutMs || TIMEOUT_MS, concurrency = opts.concurrency || CONCURRENCY;
    var seen = {}, uniq = [];
    (streams || []).forEach(function (s) { if (!s || !s.url || seen[s.url]) return; seen[s.url] = 1; uniq.push(s); });
    if (uniq.length === 0) return Promise.resolve([]);
    var results = new Array(uniq.length), cursor = 0;
    function worker() {
      if (cursor >= uniq.length) return Promise.resolve();
      var i = cursor++, st = uniq[i];
      return checkUrl(st.url, st.headers, timeout).then(function (ok) { results[i] = ok ? st : null; })
        .catch(function () { results[i] = null; }).then(worker);
    }
    var workers = [], n = Math.min(concurrency, uniq.length);
    for (var w = 0; w < n; w++) workers.push(worker());
    return Promise.all(workers).then(function () {
      var alive = [];
      for (var i = 0; i < results.length; i++) if (results[i]) alive.push(results[i]);
      alive.sort(function (a, b) { return qualityRank(b.quality) - qualityRank(a.quality); });
      return alive;
    }).catch(function () { return []; });
  }
  function withWorkingStreams(p) {
    return Promise.resolve(p).then(filterWorkingStreams).catch(function () { return []; });
  }
  return { withWorkingStreams: withWorkingStreams, filterWorkingStreams: filterWorkingStreams };
})();
// ===== fin validacion inyectada =====

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

// ===== MasterScrap: getStreams solo devuelve enlaces funcionales =====
(function () {
  try {
    var __origGetStreams = module.exports.getStreams;
    if (typeof __origGetStreams === 'function') {
      module.exports = {
        getStreams: function (tmdbId, mediaType, season, episode) {
          return __msValidate.withWorkingStreams(__origGetStreams(tmdbId, mediaType, season, episode));
        }
      };
    }
  } catch (e) {}
})();
