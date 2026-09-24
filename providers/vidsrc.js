// vidsrc — puerto a JS de lib/data/extractors/providers/vidsrc_extractor.dart
// (el codigo Dart del repo del proyecto) al formato que ejecuta el motor de
// MasterScrap: CommonJS `module.exports = { getStreams }`, solo fetch + RegExp.
//
// QUE CAMBIO DESDE EL DART
// -----------------------
// El extractor Dart parseaba HTML estatico: `<div data-hash="...">` (servidores),
// `/rcp/<hash>` y `<iframe src="...">`. Ese layout ya NO existe: vidsrc.me ahora
// responde 301 -> https://vidsrc.sh y la pagina del embed se sirve sin ningun
// data-hash, sin iframe y sin /rcp/ (el HTML solo trae un bundle ofuscado).
//
// El flujo actual (verificado en vivo) es:
//   1) GET  /embed/movie/{tmdb}            -> HTML con <iframe id="player_iframe"
//                                             data-api="/vs_src.php?type=movie&id={tmdb}">
//                                             (el iframe NO trae src: se pide en runtime
//                                             porque la URL lleva un token corto y atado al host)
//   2) GET  /vs_src.php?type=...&id=...    -> JSON {"src":"https://<player>/embed/movie/{tmdb}?vs=<token>"}
//   3) GET  ese src                        -> pagina del player con
//                                             window.CFG = {metaApi, playerUrl, ...}
//   4) GET  {metaApi}&stream_urls          -> data.stream_urls (ver nota abajo)
//
// Este provider hace 1+2 y devuelve el `src` (el player real) como stream. Si el
// paso 4 devuelve los enlaces DIRECTOS en claro (array), se devuelven esos en su
// lugar, que es lo mejor para el reproductor.
//
// DOS DETALLES MEDIDOS EN VIVO (si se cambian, el enlace muere):
//   - El token `vs=` del paso 2 esta atado al host que lo emitio: la peticion al
//     player solo da 200 si el header Referer es esa MISMA pagina del embed
//     (p.ej. https://vidsrc.sh/embed/movie/278). Con otro Referer (o sin el) da
//     403 "Expired". Por eso el stream del player sale con ese Referer.
//   - El token caduca solo: sirvio a los ~30s y ya daba 403 a los ~90s. Asi que
//     ademas del player tokenizado se devuelve la pagina del embed (estable), que
//     pide un token nuevo cada vez que se carga (requiere un reproductor con JS).
//
// NOTA (bloqueo conocido): cuando la proteccion esta activa, `data.stream_urls`
// viene CIFRADO (string base64 ChaCha20 con nonce = primeros 12 bytes) y solo se
// descifra ejecutando el WebAssembly que acompaña la respuesta
// (vs: {w, wasm_url} -> /wasm.php?w=...) desde vsdec.js en el navegador. El motor
// QuickJS no expone WebAssembly (y el contrato no permite Buffer/crypto/atob), asi
// que aqui solo se usan los enlaces si vienen en claro; si vienen cifrados se deja
// el player `src` (paso 2) en la lista. No se inventa ningun enlace.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const TIMEOUT_MS = 18000; // igual que _timeout del Dart
const BUDGET_MS = 35000; // presupuesto total: el motor corta a los 40s

// El contenido de vidsrc es audio ingles; en el Dart iba 'idioma': 'en_US' y en
// el resto de providers JS el equivalente es esta etiqueta.
const IDIOMA = "Subtitulado";

// Dominios del Dart + los que hoy siguen vivos (vidsrc.me redirige a vidsrc.sh,
// vsembed.ru sirve la misma pagina del player). Los muertos caen solos por timeout.
const DOMINIOS = [
  "https://vidsrc.me",
  "https://vidsrc.sh",
  "https://vidsrc.to",
  "https://vidsrc.xyz",
  "https://vidsrc.ru",
  "https://vsembed.ru",
];

/** Resuelve una URL relativa contra el origen base (sin usar `URL`). */
function abs(base, u) {
  var s = String(u == null ? "" : u).trim();
  if (!s) return "";
  if (s.indexOf("//") === 0) return "https:" + s;
  if (/^https?:\/\//i.test(s)) return s;
  if (s.charAt(0) === "/") return base + s;
  return base + "/" + s;
}

/** Origen (esquema + host) de una URL, sin `URL`. */
function origen(u) {
  var m = String(u || "").match(/^(https?:\/\/[^\/?#]+)/i);
  return m ? m[1] : "";
}

function sinAmp(s) {
  return String(s == null ? "" : s).replace(/&amp;/g, "&");
}

/**
 * GET de texto. Nunca lanza: devuelve { html, url } (url = la final tras los
 * redirects, que es lo que da el host real del token) o null.
 */
function fetchTexto(url, referer) {
  var ctl = null;
  var timer = null;
  var p;
  try {
    if (typeof AbortController !== "undefined") {
      ctl = new AbortController();
      timer = setTimeout(function () {
        try {
          ctl.abort();
        } catch (e) {}
      }, TIMEOUT_MS);
    }
    var headers = {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9,es;q=0.8",
      Referer: referer || "https://vidsrc.me/",
    };
    p = fetch(url, ctl ? { headers: headers, signal: ctl.signal } : { headers: headers });
  } catch (e) {
    if (timer) clearTimeout(timer);
    return Promise.resolve(null);
  }
  return p
    .then(function (res) {
      if (!res || res.status < 200 || res.status >= 400) return null;
      return res
        .text()
        .then(function (html) {
          return html ? { html: html, url: res.url || url } : null;
        })
        .catch(function () {
          return null;
        });
    })
    .catch(function () {
      return null;
    })
    .then(function (out) {
      if (timer) clearTimeout(timer);
      return out;
    });
}

/** GET de JSON. Nunca lanza. */
function fetchJson(url, referer) {
  return fetchTexto(url, referer).then(function (r) {
    if (!r || !r.html) return null;
    try {
      var d = JSON.parse(r.html);
      return d && typeof d === "object" ? d : null;
    } catch (e) {
      return null;
    }
  });
}

/** Candidatos de embed: rutas movie/tv sobre cada dominio (como _buildEmbedCandidates). */
function candidatos(id, esPelicula, s, e) {
  var rutas = esPelicula
    ? ["/embed/movie/" + id, "/embed/" + id]
    : ["/embed/tv/" + id + "/" + s + "-" + e, "/embed/" + id + "/" + s + "-" + e];
  var out = [];
  for (var i = 0; i < DOMINIOS.length; i++) {
    for (var j = 0; j < rutas.length; j++) out.push(DOMINIOS[i] + rutas[j]);
  }
  return out;
}

/** data-api="/vs_src.php?..." del <iframe id="player_iframe"> (flujo nuevo). */
function parseDataApi(html) {
  var m = html.match(/data-api\s*=\s*["']([^"']+)["']/i);
  if (!m) return "";
  return sinAmp(m[1]).trim();
}

/** Paso 2: el endpoint propio devuelve {"src": "<player con token>"}. */
function resolverSrc(base, apiPath, referer) {
  var api = abs(base, apiPath);
  if (!api) return Promise.resolve("");
  return fetchJson(api, referer).then(function (j) {
    var src = j && typeof j.src === "string" ? sinAmp(j.src).trim() : "";
    if (!src) return "";
    return abs(base, src);
  });
}

/** window.CFG de la pagina del player (metaApi + playerUrl). */
function parseCfg(html) {
  var m = html.match(/window\.CFG\s*=\s*(\{[\s\S]*?\})\s*;/);
  if (!m) return null;
  try {
    var d = JSON.parse(sinAmp(m[1]));
    return d && typeof d === "object" ? d : null;
  } catch (e) {
    return null;
  }
}

/**
 * Solo se aceptan URLs http(s) reales de una lista de stream_urls EN CLARO.
 * Ojo: cuando la proteccion esta activa `stream_urls` es un STRING base64 cifrado
 * (tiene .length y es indexable), asi que hay que exigir Array de verdad o se
 * acabaria troceando el texto cifrado en basura.
 */
function urlsDeLista(arr, base) {
  var out = [];
  if (!Array.isArray(arr)) return out;
  for (var i = 0; i < arr.length; i++) {
    var it = arr[i];
    var u = "";
    if (typeof it === "string") u = it;
    else if (it && typeof it === "object") u = it.url || it.file || it.link || it.src || "";
    u = abs(base, u);
    if (/^https?:\/\//i.test(u)) out.push(u);
  }
  return out;
}

/** "1080p" del file_name del API, como pista de calidad; si no, HD. */
function calidadDe(fileName) {
  var m = String(fileName || "").match(/(\d{3,4})[pi]\b/i);
  return m ? m[1] + "p" : "HD";
}

/** Servidores legacy del Dart: data-hash="..." (+ nombre) / data-hash='...' / solo hash. */
function parseServidores(html) {
  var out = [];
  var vistos = {};
  var patrones = [
    /data-hash=["']([^"']+)["'][^>]*>([^<]*)/gi,
    /data-hash=["']([^"']+)["']/gi,
  ];
  for (var p = 0; p < patrones.length; p++) {
    var re = patrones[p];
    var m;
    while ((m = re.exec(html)) !== null) {
      var hash = String(m[1] || "").trim();
      if (!hash || vistos[hash]) continue;
      vistos[hash] = 1;
      var nombre = String(m[2] || "").trim();
      out.push({ hash: hash, name: nombre || "Server" });
    }
    if (out.length) break;
  }
  return out;
}

/** iframes del embed (para cuando el layout viejo vuelva o cambie de host). */
function parseIframes(html, base) {
  var out = [];
  var re = /<iframe[^>]+src\s*=\s*["']([^"']+)["']/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    var src = abs(base, m[1]);
    if (/^https?:\/\//i.test(src)) out.push(src);
  }
  return out;
}

/** /rcp/<hash> -> src: '...' (prorcp), como _resolveProrcpFromRcp. */
function resolverProrcp(base, rcpUrl, referer) {
  return fetchTexto(rcpUrl, referer).then(function (r) {
    if (!r || !r.html) return "";
    var html = r.html;
    var path = "";
    var m = html.match(/src:\s*'([^']+)'/);
    if (m) path = String(m[1]).trim();
    if (!path) {
      m = html.match(/src:\s*"([^"]+)"/);
      if (m) path = String(m[1]).trim();
    }
    if (!path) {
      m = html.match(/<iframe[^>]+src\s*=\s*["']([^"']+)["']/i);
      if (m) path = String(m[1]).trim();
    }
    if (!path) return "";
    return abs(base, path);
  });
}

function stream(url, title, quality, headers) {
  var base = origen(url);
  var h = {
    "User-Agent": UA,
    Referer: base ? base + "/" : "https://vidsrc.me/",
    Origin: base || "https://vidsrc.me",
  };
  if (headers) {
    for (var k in headers) {
      if (Object.prototype.hasOwnProperty.call(headers, k)) h[k] = headers[k];
    }
  }
  return {
    title: title,
    quality: quality || "HD",
    language: IDIOMA,
    url: url,
    headers: h,
  };
}

async function getStreams(tmdbId, mediaType, season, episode) {
  var streams = [];
  var vistos = {};
  var deadline = Date.now() + BUDGET_MS;
  var fallback = "";

  function push(url, title, quality, headers) {
    if (!url || vistos[url]) return false;
    if (!/^https?:\/\//i.test(url)) return false;
    vistos[url] = 1;
    streams.push(stream(url, title, quality, headers));
    return true;
  }

  try {
    var id = parseInt(tmdbId, 10);
    if (!(id > 0)) return [];
    // Nuvio manda tipos de Stremio ("movie"/"series", tambien "anime"): solo "movie"
    // es pelicula. Comparar contra "tv" a secas convertia toda serie en pelicula.
    var tipo = String(mediaType == null ? "movie" : mediaType).toLowerCase();
    var esPelicula = tipo === "movie";
    var s = parseInt(season, 10) || 1;
    var e = parseInt(episode, 10) || 1;
    var lista = candidatos(id, esPelicula, s, e);

    for (var i = 0; i < lista.length; i++) {
      if (Date.now() > deadline) break;
      var embedUrl = lista[i];
      var res = await fetchTexto(embedUrl, "https://vidsrc.me/");
      if (!res || !res.html) continue;
      var html = res.html;
      var base = origen(res.url) || origen(embedUrl);
      if (!base) continue;
      if (!fallback) {
        fallback = base + (esPelicula ? "/embed/movie/" + id : "/embed/tv/" + id + "/" + s + "-" + e);
      }

      // --- Flujo nuevo: data-api -> /vs_src.php -> player con token ---
      var apiPath = parseDataApi(html);
      if (apiPath) {
        var src = await resolverSrc(base, apiPath, res.url);
        if (src) {
          // Intento de enriquecer con el API de metadatos del player: si esta vez
          // vienen los stream_urls EN CLARO, son los enlaces directos y se usan.
          var directos = [];
          var titulo = "";
          var calidad = "HD";
          if (Date.now() < deadline) {
            var pag = await fetchTexto(src, base + "/");
            var cfg = pag && pag.html ? parseCfg(pag.html) : null;
            if (cfg && cfg.metaApi) {
              var meta = await fetchJson(sinAmp(cfg.metaApi) + "&stream_urls", base + "/");
              var data = meta && meta.data ? meta.data : null;
              if (data) {
                if (data.title) titulo = String(data.title);
                calidad = calidadDe(data.file_name);
                directos = urlsDeLista(data.stream_urls, base);
              }
            }
          }
          if (directos.length) {
            for (var d = 0; d < directos.length; d++) {
              push(directos[d], (titulo ? titulo + " · " : "") + "VidSrc Directo", calidad);
            }
          } else {
            // El player SOLO responde si el Referer es la misma pagina del embed que
            // emitio el token (cualquier otro host/origen -> 403 "Expired"), y el
            // token caduca en ~60s, asi que se manda la URL final del embed.
            var hGate = { Referer: res.url || embedUrl, Origin: base };
            push(src, titulo ? "VidSrc · " + titulo : "VidSrc (Player)", calidad, hGate);
            // Segundo enlace, estable: la propia pagina del embed, que pide un token
            // nuevo en cada carga (necesita un reproductor que ejecute JS).
            push(res.url || embedUrl, "VidSrc Embed", calidad);
          }
          if (streams.length) break;
        }
      }

      // --- Flujo legacy del Dart: data-hash / /rcp/<hash> / prorcp / iframes ---
      var servidores = parseServidores(html);
      for (var k = 0; k < servidores.length; k++) {
        if (Date.now() > deadline) break;
        var sv = servidores[k];
        var nombre = sv.name || "Server " + (k + 1);
        var rcpUrl = base + "/rcp/" + sv.hash;
        push(rcpUrl, "VidSrc " + nombre, "HD");
        var prorcp = await resolverProrcp(base, rcpUrl, base + "/");
        if (prorcp) push(prorcp, "VidSrc " + nombre + " · Pro", "HD");
      }
      var iframes = parseIframes(html, base);
      for (var f = 0; f < iframes.length; f++) push(iframes[f], "VidSrc Embed", "HD");

      if (streams.length) break; // como el Dart: primer candidato con resultados
    }

    // Ultimo recurso, igual que el Dart cuando no encuentra nada: la propia pagina
    // del embed (es un player real, no un enlace inventado).
    if (!streams.length && fallback) push(fallback, "VidSrc (Embed)", "HD");
  } catch (e) {
    // NUNCA lanza: devolvemos lo que se haya podido juntar.
  }

  return streams;
}

module.exports = { getStreams };
