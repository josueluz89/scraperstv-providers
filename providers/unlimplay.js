// ===== MasterScrap: validacion de enlaces funcionales (inyectado) =====
// Prueba cada URL con sus headers reales; descarta muertos (4xx/5xx/timeout),
// elimina duplicados y ordena por calidad. QuickJS-safe.
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
          } else finish(true);
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

// Unlimplay — https://unlimplay.com (verificado 2026-09-24).
//
// El sitio cambió de flujo: ya no existe /f/embed/… ni los bloques EMBEDS +
// finalizePlayer del HTML. Ahora cada embed trae
//   var LANGS = { latino: { servers: [ {link_name, server, link, play} ] }, es: …, sub: … }
// donde `link` es un sobre cifrado del propio servidor, y el m3u8 se pide a su API:
//   POST https://unlimplay.com/edge-data   (form-urlencoded, X-Requested-With: XMLHttpRequest)
//     1) { action: 'token' }                                    -> { validtime, token }
//     2) { streaming: <link>, validtime, token }                -> { codigo:200, url, original }
// `url` viene cuando el sitio logró limpiar el m3u8; si no, `original` es el embed
// real (p.ej. morencius.com/embed/<code>) y se emite tal cual. La API de unlimplay
// falla de forma intermitente (504/timeouts): cada servidor se reintenta y el
// token se refresca antes de resolver.
var UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

var ORDEN_IDIOMAS = ['latino', 'es', 'sub', 'subtitulado', 'espanol', 'español'];
var MAX_POR_IDIOMA = 4;
var MAX_STREAMS = 10;
var MAX_INTENTOS_SERVIDOR = 2;

function idiomaDe(clave) {
  var k = String(clave || '').toLowerCase();
  if (k.indexOf('latino') >= 0 || k === 'lat' || k === 'mx') return 'Latino';
  if (k.indexOf('sub') >= 0 || k === 'en' || k === 'english') return 'Subtitulado';
  return 'Español';
}

function conTimeout(url, opts, ms) {
  try {
    if (typeof AbortController !== 'undefined') {
      var c = new AbortController();
      if (c && c.signal !== null && c.signal !== undefined && typeof setTimeout !== 'undefined') {
        setTimeout(function () {
          try {
            c.abort();
          } catch (e) {}
        }, ms);
      }
      if (c && c.signal !== undefined && c.signal !== null) {
        opts = Object.assign({}, opts, { signal: c.signal });
      }
    }
  } catch (e) {}
  return fetch(url, opts);
}

/** Extrae el objeto JSON que sigue a `var <nombre> = {` contando llaves. */
function bloqueJson(html, nombre) {
  var marca = html.indexOf('var ' + nombre);
  if (marca < 0) marca = html.indexOf(nombre + ' = {');
  if (marca < 0) return null;
  var ini = html.indexOf('{', marca);
  if (ini < 0) return null;
  var nivel = 0;
  var enTexto = false;
  for (var i = ini; i < html.length; i++) {
    var c = html.charAt(i);
    if (enTexto) {
      if (c === '\\') i++;
      else if (c === '"') enTexto = false;
      continue;
    }
    if (c === '"') {
      enTexto = true;
      continue;
    }
    if (c === '{') nivel++;
    else if (c === '}') {
      nivel--;
      if (nivel === 0) {
        try {
          return JSON.parse(html.slice(ini, i + 1));
        } catch (e) {
          return null;
        }
      }
    }
  }
  return null;
}

function captura(html, re) {
  var m = html.match(re);
  return m ? m[1] : '';
}

function pageUrl(tmdbId, esPelicula, season, episode) {
  if (esPelicula) return 'https://unlimplay.com/embed/movie/' + tmdbId;
  return 'https://unlimplay.com/embed/tv/' + tmdbId + '/' + (season || 1) + '/' + (episode || 1);
}

function pedirEdge(page, datos) {
  return conTimeout(
    'https://unlimplay.com/edge-data',
    {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: page,
        Origin: 'https://unlimplay.com',
      },
      body: new URLSearchParams(datos).toString(),
    },
    15000
  )
    .then(function (res) {
      return res.text().then(function (t) {
        try {
          return JSON.parse(t);
        } catch (e) {
          return null;
        }
      });
    })
    .catch(function () {
      return null;
    });
}

function tokenDe(html, page) {
  var validtime = captura(html, /validtime:\s*"([^"]+)"/);
  var token = captura(html, /token:\s*"([^"]+)"/);
  return pedirEdge(page, { action: 'token' }).then(function (fresco) {
    if (fresco && fresco.codigo === 200 && fresco.validtime && fresco.token) {
      return { validtime: fresco.validtime, token: fresco.token };
    }
    if (token && validtime) return { validtime: validtime, token: token };
    return null;
  });
}

/** Resuelve un servidor (link cifrado -> url|original), con un reintento. */
function resolverServidor(page, srv, tok, intento) {
  if (!srv || !srv.link || !tok) return Promise.resolve(null);
  var nombre = srv.link_name || srv.server || 'Servidor';
  return pedirEdge(page, { streaming: srv.link, validtime: tok.validtime, token: tok.token }).then(function (res) {
    var url = res && res.codigo === 200 ? res.url || res.original || '' : '';
    if (url) return { url: url, nombre: nombre };
    if (intento < MAX_INTENTOS_SERVIDOR) return resolverServidor(page, srv, tok, intento + 1);
    return null;
  });
}

function getStreams(tmdbId, mediaType, season, episode) {
  var tipo = String(mediaType || '').toLowerCase();
  var esPelicula = tipo === 'movie';
  var page = pageUrl(tmdbId, esPelicula, parseInt(season, 10) || 1, parseInt(episode, 10) || 1);

  return conTimeout(
    page,
    {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'es-ES,es;q=0.9',
      },
    },
    15000
  )
    .then(function (res) {
      if (!res.ok) return [];
      return res.text();
    })
    .then(function (html) {
      if (!html) return [];
      var langs = bloqueJson(html, 'LANGS');
      if (!langs || !Object.keys(langs).length) return [];
      return tokenDe(html, page).then(function (tok) {
        if (!tok) return [];
        var claves = ORDEN_IDIOMAS.filter(function (k) {
          return langs[k];
        }).concat(
          Object.keys(langs).filter(function (k) {
            return ORDEN_IDIOMAS.indexOf(k) < 0;
          })
        );

        var streams = [];
        var vistos = {};
        var cadena = Promise.resolve();

        for (var i = 0; i < claves.length; i++) {
          (function (clave) {
            var servidores = (langs[clave] && langs[clave].servers) || [];
            var idioma = idiomaDe(clave);
            for (var j = 0; j < servidores.length && j < MAX_POR_IDIOMA; j++) {
              (function (srv) {
                cadena = cadena
                  .then(function () {
                    if (streams.length >= MAX_STREAMS) return null;
                    return resolverServidor(page, srv, tok, 0);
                  })
                  .then(function (r) {
                    if (!r || !r.url || vistos[r.url]) return;
                    vistos[r.url] = true;
                    streams.push({
                      title: r.nombre + ' · ' + idioma,
                      quality: 'HD',
                      language: idioma,
                      url: r.url,
                      headers: { Referer: page, 'User-Agent': UA },
                    });
                  })
                  .catch(function () {});
              })(servidores[j]);
            }
          })(claves[i]);
        }

        return cadena.then(function () {
          return streams;
        });
      });
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
