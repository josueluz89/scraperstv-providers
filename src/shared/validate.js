/**
 * Validación de enlaces funcionales para los providers de MasterScrap.
 *
 * Garantiza que getStreams() solo devuelva streams cuyas URLs son VIDEO REAL
 * reproducible por el reproductor de la app (ExoPlayer). Cada URL candidata
 * se prueba con un GET de rango llevando los headers propios del stream
 * (Referer/Origin/User-Agent), que estos hosts exigen.
 *
 * ESTRICTO (v2): además de descartar enlaces muertos (4xx/5xx, errores de red,
 * timeouts), se RECHAZA toda respuesta que no sea video: páginas HTML de embed
 * sin resolver, landers, captchas, etc. Solo pasa si el content-type es de
 * video (video/*, mpegurl) o la URL termina en extensión de video con 2xx.
 * Las playlists m3u8 además deben contener #EXTM3U.
 *
 * Se eliminan duplicados y se ordena por calidad (mejor primero) para que la
 * app pruebe primero el mejor enlace funcional.
 *
 * QuickJS-safe: var/function, sin matchAll/normalize; funciona sin
 * setTimeout/AbortController (degrada a fetch plano; el límite de 60 s de la
 * app sigue aplicando).
 *
 * Estricto: ante cualquier fallo interno de la validación se devuelve []
 * (nunca enlaces sin validar).
 */

var VALIDATE_TIMEOUT_MS = 7000;
var VALIDATE_CONCURRENCY = 4;

function qualityRank(q) {
  if (!q) return 0;
  var s = String(q).toLowerCase();
  if (s.indexOf('4k') !== -1 || s.indexOf('2160') !== -1) return 2160;
  var m = s.match(/(\d{3,4})\s*p/);
  if (m) return parseInt(m[1], 10);
  return 0;
}

function isM3u8(url) {
  return /\.m3u8(\?|#|$)/i.test(url || '');
}

function hasVideoExtension(url) {
  return /\.(mp4|m3u8|mkv|webm|ts|m4v|mov)(\?|#|$)/i.test(url || '');
}

// ¿La respuesta es video real reproducible? Rechaza páginas HTML de embed,
// landers y cualquier otro contenido no-video. Algunos hosts sirven el mp4
// como application/octet-stream: se acepta solo si la URL termina en
// extensión de video.
function isVideoResponse(contentType, url) {
  var ct = '';
  try {
    ct = String(contentType || '').toLowerCase().split(';')[0].trim();
  } catch (e) {
    ct = '';
  }
  if (ct.indexOf('video/') === 0) return true;
  if (ct === 'application/vnd.apple.mpegurl' || ct === 'application/x-mpegurl') return true;
  if (ct === 'application/octet-stream' || ct === 'binary/octet-stream') {
    return hasVideoExtension(url);
  }
  if (!ct) {
    // Sin content-type: aceptar solo por extensión de video.
    return hasVideoExtension(url);
  }
  return false;
}

function getContentType(res) {
  try {
    if (res && res.headers && typeof res.headers.get === 'function') {
      return res.headers.get('content-type');
    }
  } catch (e) {}
  return '';
}

// Prueba una URL. Resuelve true solo si el host responde con VIDEO útil.
function checkUrl(url, headers, timeoutMs) {
  return new Promise(function (resolve) {
    var done = false;
    var timer = null;
    var controller = null;

    function finish(ok) {
      if (done) return;
      done = true;
      if (timer) {
        try { clearTimeout(timer); } catch (e) {}
        timer = null;
      }
      if (controller) {
        try { controller.abort(); } catch (e) {}
      }
      resolve(!!ok);
    }

    if (!url || typeof url !== 'string' || url.indexOf('http') !== 0) {
      resolve(false);
      return;
    }

    if (typeof setTimeout !== 'undefined') {
      timer = setTimeout(function () {
        timer = null;
        finish(false);
      }, timeoutMs || VALIDATE_TIMEOUT_MS);
    }

    var reqHeaders = {
      'Range': 'bytes=0-2047',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };
    if (headers) {
      for (var k in headers) {
        if (Object.prototype.hasOwnProperty.call(headers, k) && headers[k]) {
          reqHeaders[k] = headers[k];
        }
      }
    }

    var reqInit = { headers: reqHeaders, redirect: 'follow' };
    try {
      if (typeof AbortController !== 'undefined') {
        controller = new AbortController();
        reqInit.signal = controller.signal;
      }
    } catch (e) {
      controller = null;
    }

    fetch(url, reqInit).then(function (res) {
      var status = res.status;
      // 2xx o 416 (rango no satisfacible => el servidor está vivo) = alcanzable.
      // Los 3xx no se ven aquí (fetch sigue redirects).
      if (status === 200 || status === 206 || status === 416) {
        if (isM3u8(url)) {
          // Confirmar que es una playlist de verdad, no una página de error.
          res.text().then(function (t) {
            finish(t && t.indexOf('#EXTM3U') !== -1);
          }).catch(function () {
            finish(true);
          });
        } else if (status === 416) {
          // Sin cuerpo que inspeccionar: se acepta como vivo (raro).
          finish(true);
        } else if (!isVideoResponse(getContentType(res), url)) {
          // HTML de embed, lander, captcha, etc: no es reproducible.
          try { if (controller) controller.abort(); } catch (e) {}
          finish(false);
        } else {
          finish(true);
        }
      } else {
        finish(false);
      }
    }).catch(function () {
      finish(false);
    });
  });
}

// Reduce una lista de streams a solo enlaces funcionales.
// Nunca lanza: ante un fallo interno devuelve [] (estricto).
function filterWorkingStreams(streams, opts) {
  opts = opts || {};
  var timeout = opts.timeoutMs || VALIDATE_TIMEOUT_MS;
  var concurrency = opts.concurrency || VALIDATE_CONCURRENCY;

  var seen = {};
  var uniq = [];
  (streams || []).forEach(function (s) {
    if (!s || !s.url || seen[s.url]) return;
    seen[s.url] = 1;
    uniq.push(s);
  });
  if (uniq.length === 0) return Promise.resolve([]);

  var results = new Array(uniq.length);
  var cursor = 0;

  function worker() {
    if (cursor >= uniq.length) return Promise.resolve();
    var i = cursor++;
    var st = uniq[i];
    return checkUrl(st.url, st.headers, timeout).then(function (ok) {
      results[i] = ok ? st : null;
    }).catch(function () {
      results[i] = null;
    }).then(worker);
  }

  var workers = [];
  var n = Math.min(concurrency, uniq.length);
  for (var w = 0; w < n; w++) workers.push(worker());

  return Promise.all(workers).then(function () {
    var alive = [];
    for (var i = 0; i < results.length; i++) {
      if (results[i]) alive.push(results[i]);
    }
    alive.sort(function (a, b) {
      return qualityRank(b.quality) - qualityRank(a.quality);
    });
    return alive;
  }).catch(function () {
    // Estricto: si la validación falla por dentro, no se devuelve nada sin validar.
    return [];
  });
}

// Conveniencia: envuelve la promesa de extracción de un provider para que la
// app solo vea enlaces funcionales, mejor calidad primero.
function withWorkingStreams(extractPromise) {
  return Promise.resolve(extractPromise)
    .then(function (streams) { return filterWorkingStreams(streams); })
    .catch(function () { return []; });
}

export { filterWorkingStreams, withWorkingStreams };
