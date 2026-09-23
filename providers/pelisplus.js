// PelisPlus (pelisplushd) — puerto a JS de
// lib/data/extractors/providers/pelisplus_extractor.dart
//
// El sitio tiene estructura propia:
//   1) Se busca la ficha por titulo (TMDB es-MX / es-ES / en-US) en /search?s=
//   2) Pelicula  -> /pelicula/<slug>
//      Serie     -> /serie/<slug>/temporada/<S>/capitulo/<E>
//   3) Los servidores viven en el HTML de la ficha, en dos formatos:
//        a) peliculas:  <li data-url="https://host/e/id" data-name="Español Latino">
//        b) capitulos:  <div id="link_url"><span lid="1" url="https://host/embed-x.html">
//      (tambien existe el formato viejo `var options = {...}`)
//   4) NO se resuelve HLS: se devuelven los embeds; el motor (masters.js) ya
//      trae getEmbedResolver()/mapDomain() para streamwish, vidhide, voe, etc.
//
// Notas del puerto:
//  - El Dart detectaba el idioma con `name + TODO el html`, asi que cualquier
//    palabra "latino" en la pagina marcaba todos los servidores como Latino y
//    _isLanguageSupported() descartaba los subtitulados. Aqui se detecta por
//    servidor (data-name / host) y se conservan TODOS los idiomas, etiquetados.
//  - El dominio rota: www.pelisplushd.la hoy redirige a pelisplushd.to, por eso
//    se prueban varios dominios en orden.
var UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

var ACCEPT_HTML =
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";

var DOMAINS = ["https://pelisplushd.to", "https://www.pelisplushd.la"];
var TMDB_KEY = "439c478a771f35c05022f9feabcca01c";
var TIMEOUT = 12000;
var MAX_TITLES = 6; // el Dart probaba 12; con 6 basta y ahorra requests

// ─────────────────────────────────────────────────────────
// HTTP
// ─────────────────────────────────────────────────────────

function conTimeout(url, opts, ms) {
  if (typeof AbortController === "undefined" || typeof setTimeout === "undefined") {
    return fetch(url, opts);
  }
  var ctrl = new AbortController();
  var o = opts || {};
  o.signal = ctrl.signal;
  var timer = setTimeout(function () {
    try {
      ctrl.abort();
    } catch (e) {}
  }, ms || TIMEOUT);
  return fetch(url, o).then(
    function (r) {
      clearTimeout(timer);
      return r;
    },
    function (e) {
      clearTimeout(timer);
      throw e;
    }
  );
}

function fetchText(url, referer) {
  var headers = {
    "User-Agent": UA,
    Accept: ACCEPT_HTML,
    "Accept-Language": "es-ES,es;q=0.9",
    "Cache-Control": "no-cache",
  };
  if (referer) headers.Referer = referer;
  return conTimeout(url, { headers: headers, redirect: "follow" }, TIMEOUT)
    .then(function (res) {
      if (!res || !res.ok) return null;
      return res.text();
    })
    .catch(function () {
      return null;
    });
}

function fetchJson(url) {
  return fetchText(url, null).then(function (body) {
    if (!body) return null;
    try {
      var d = JSON.parse(body);
      return d && typeof d === "object" ? d : null;
    } catch (e) {
      return null;
    }
  });
}

// ─────────────────────────────────────────────────────────
// TMDB — titulos (es-MX, es-ES, en-US) + variantes
// ─────────────────────────────────────────────────────────

function tmdbTitle(type, id, lang) {
  var url =
    "https://api.themoviedb.org/3/" +
    type +
    "/" +
    id +
    "?api_key=" +
    TMDB_KEY +
    (lang ? "&language=" + lang : "");
  return fetchJson(url).then(function (data) {
    if (!data) return "";
    var t = data.title != null ? data.title : data.name;
    t = t == null ? "" : String(t).trim();
    return t;
  });
}

function getTmdbTitles(tmdbId, type) {
  var langs = ["es-MX", "es-ES", "en-US"];
  var base = [];
  var i = 0;

  function paso() {
    if (i >= langs.length) return Promise.resolve(base);
    var lang = langs[i++];
    return tmdbTitle(type, tmdbId, lang).then(function (t) {
      if (t && base.indexOf(t) < 0) base.push(t);
      return paso();
    });
  }

  return paso()
    .then(function (list) {
      if (list.length) return list;
      return tmdbTitle(type, tmdbId, null).then(function (t) {
        return t ? [t] : [];
      });
    })
    .then(function (list) {
      var out = [];
      for (var k = 0; k < list.length; k++) {
        var t = list[k];
        push(out, t);
        push(out, t.replace(/:/g, ""));
        push(out, t.replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑüÜ\s]/g, ""));
        push(out, t.replace(/\(\d{4}\)/g, "").trim());
      }
      // Variantes cortas: util cuando el sitio titula distinto ("Matrix (1999)")
      for (var j = 0; j < list.length; j++) {
        var corte = String(list[j]).split(/[:(\-]/)[0].trim();
        if (corte.length > 3) push(out, corte);
      }
      return out.slice(0, MAX_TITLES * 2);
    });
}

function push(arr, v) {
  var s = String(v == null ? "" : v).trim();
  if (s && arr.indexOf(s) < 0) arr.push(s);
}

// ─────────────────────────────────────────────────────────
// Normalizacion / matching de titulos
// ─────────────────────────────────────────────────────────

function normTitle(title) {
  var s = String(title == null ? "" : title).toLowerCase();
  s = s.replace(/á|à|ä|â/g, "a");
  s = s.replace(/é|è|ë|ê/g, "e");
  s = s.replace(/í|ì|ï|î/g, "i");
  s = s.replace(/ó|ò|ö|ô/g, "o");
  s = s.replace(/ú|ù|ü|û/g, "u");
  s = s.replace(/ñ/g, "n");
  s = s.replace(/[^a-z0-9\s]/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/**
 * 100 = identicos. Si no, ratio de palabras significativas (>=80%), con
 * penalizacion por palabras extra ("matrix" gana a "matrix revoluciones").
 */
function matchScore(query, target) {
  var q = normTitle(query);
  var t = normTitle(target);
  if (!q || !t) return 0;
  if (q === t) return 100;

  var qWords = q.split(" ").filter(function (w) {
    return w.length > 2;
  });
  if (!qWords.length) return 0;

  var tWords = t.split(" ");
  var hits = 0;
  for (var i = 0; i < qWords.length; i++) {
    if (tWords.indexOf(qWords[i]) >= 0) hits++;
  }
  var ratio = hits / qWords.length;
  if (ratio < 0.8) return 0;
  var extra = tWords.length - hits;
  return ratio * 10 - extra;
}

function stripTags(html) {
  return String(html == null ? "" : html)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ─────────────────────────────────────────────────────────
// Busqueda en el sitio
// ─────────────────────────────────────────────────────────

/** <a href="/pelicula/slug" class="Posters-link" data-title="VER ... Online Gratis HD"> */
function parseSearchResults(html, mediaType) {
  var out = [];
  var tipo = mediaType === "movie" ? "/pelicula/" : "/serie/";
  var re = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    var href = m[1] || "";
    if (href.indexOf(tipo) < 0) continue;
    // Excluye las rutas de listado ( /peliculas, /series ) y los generos.
    if (!/^\/(pelicula|serie)\/[^/?"]+\/?$/i.test(href)) continue;

    var tag = m[0];
    var title = "";
    var dt = tag.match(/data-title="([^"]*)"/i);
    if (dt) title = stripTags(dt[1]);
    if (!title) {
      var p = (m[2] || "").match(/<p[^>]*>([\s\S]*?)<\/p>/i);
      title = p ? stripTags(p[1]) : stripTags(m[2] || "");
    }
    title = title
      .replace(/^ver\s+/i, "")
      .replace(/\s+online\s+gratis\s+hd\s*$/i, "")
      .replace(/\s+online\s+latino\s+hd\s*$/i, "")
      .replace(/\s+online\s+castellano\s+hd\s*$/i, "")
      .replace(/\s+online\s+hd\s*$/i, "")
      .replace(/\(\d{4}\)\s*$/, "")
      .trim();
    if (!title) continue;

    if (!/^https?:/i.test(href)) {
      href = href.charAt(0) === "/" ? href : "/" + href;
    }
    out.push({ href: href, title: title });
  }
  return out;
}

function absolutizar(base, href) {
  if (/^https?:/i.test(href)) return href;
  return base + (href.charAt(0) === "/" ? href : "/" + href);
}

/**
 * Devuelve {url, dominio} de la ficha. Busca por cada titulo en cada dominio
 * candidato y escoge el mejor match (exacto > parcial).
 */
function findPageUrl(titles, mediaType) {
  var best = null; // { score, href, base }
  var d = 0;

  function porDominio() {
    if (d >= DOMAINS.length) return Promise.resolve(best);
    var base = DOMAINS[d++];
    var i = 0;

    function porTitulo() {
      if (i >= titles.length || (best && best.score >= 100)) {
        return Promise.resolve();
      }
      var t = titles[i++];
      var url = base + "/search?s=" + encodeURIComponent(t);
      return fetchText(url, base + "/").then(function (html) {
        if (html) {
          var res = parseSearchResults(html, mediaType);
          for (var k = 0; k < res.length; k++) {
            var sc = matchScore(t, res[k].title);
            if (sc > 0 && (!best || sc > best.score)) {
              best = { score: sc, href: res[k].href, base: base };
            }
          }
        }
        if (best && best.score >= 100) return;
        return porTitulo();
      });
    }

    return porTitulo().then(function () {
      if (best && best.score > 0) return best;
      return porDominio();
    });
  }

  return porDominio();
}

// ─────────────────────────────────────────────────────────
// Servidores embebidos
// ─────────────────────────────────────────────────────────

function hostLabel(url) {
  var m = String(url || "").match(/^https?:\/\/(?:www\.)?([^\/:]+)/i);
  if (!m) return "Servidor";
  var host = m[1].toLowerCase();
  var nombre = host.split(".")[0];
  return nombre.charAt(0).toUpperCase() + nombre.slice(1);
}

function esUrlServidor(url) {
  if (!/^https?:\/\//i.test(url)) return false;
  if (/pelisplushd|google|cloudflare|sharethis|platform-api|doubleclick/i.test(url)) return false;
  // Embeds utiles: /e/ID, /v/ID, /embed/..., embed-xxx.html, /f/ID
  return (
    /\/(e|v|embed|f|w|d|play)\/[^\/\s]+/i.test(url) ||
    /embed-[a-z0-9]+\.html/i.test(url) ||
    /\.(html?|php|mp4|m3u8)(\?|$)/i.test(url)
  );
}

function leerAttr(tag, attr) {
  var m = tag.match(new RegExp(attr + '\\s*=\\s*"([^"]*)"', "i")) ||
    tag.match(new RegExp(attr + "\\s*=\\s*'([^']*)'", "i"));
  return m ? m[1] : "";
}

function extractServers(html) {
  var out = [];
  var seen = {};

  function agregar(url, name, lang) {
    url = String(url || "").trim();
    if (!url || seen[url]) return;
    if (!esUrlServidor(url)) return;
    seen[url] = 1;
    out.push({ url: url, name: name || "", language: lang || "" });
  }

  // Metodo 1: <li ... data-url="..." ... data-name="..." class="playurl">
  // (orden de atributos libre; el Dart exigia data-url antes de data-name)
  var reLi = /<li\b[^>]*data-url="([^"]+)"[^>]*>/gi;
  var m;
  while ((m = reLi.exec(html)) !== null) {
    var tag = m[0];
    var name = leerAttr(tag, "data-name");
    agregar(m[1], name, detectLanguage(name, html));
  }

  // Metodo 2: <div id="link_url"><span lid="1" url="https://host/embed-x.html">
  if (!out.length) {
    var reSpan = /<span\b[^>]*\burl="([^"]+)"[^>]*>/gi;
    while ((m = reSpan.exec(html)) !== null) {
      var u = m[1];
      agregar(u, hostLabel(u), detectLanguage("", html));
    }
  }

  // Metodo 3: var options = { "Latino": [ {name, url}, ... ] }
  if (!out.length) {
    var m3 = html.match(/var\s+options\s*=\s*(\{[\s\S]*?\});/i);
    if (m3) {
      var opts = parseJsObject(m3[1]);
      Object.keys(opts).forEach(function (key) {
        var val = opts[key];
        if (Object.prototype.toString.call(val) !== "[object Array]") return;
        for (var i = 0; i < val.length; i++) {
          var item = val[i];
          if (item && typeof item === "object" && item.url) {
            agregar(item.url, item.name || key, key);
          }
        }
      });
    }
  }

  return out;
}

function parseJsObject(str) {
  var s = String(str || "").replace(/'/g, '"').replace(/,\s*\}/g, "}");
  try {
    var d = JSON.parse(s);
    if (d && typeof d === "object") return d;
  } catch (e) {}
  var result = {};
  var re = /"([^"]+)"\s*:\s*(\[[^\]]*\]|[^{,]*)/g;
  var m;
  while ((m = re.exec(s)) !== null) {
    var key = m[1];
    var value = String(m[2] || "").trim();
    if (!key) continue;
    if (value.charAt(0) === "[") {
      var items = [];
      var itemRe = /\{[^}]*\}/g;
      var im;
      while ((im = itemRe.exec(value)) !== null) {
        var item = {};
        var propRe = /"([^"]+)"\s*:\s*"([^"]*)"/g;
        var pm;
        while ((pm = propRe.exec(im[0])) !== null) item[pm[1]] = pm[2];
        if (Object.keys(item).length) items.push(item);
      }
      result[key] = items;
    } else {
      result[key] = value.replace(/"/g, "");
    }
  }
  return result;
}

// ─────────────────────────────────────────────────────────
// Idioma → etiqueta (igual criterio que unlimplay.js)
// ─────────────────────────────────────────────────────────

function langToCode(lang) {
  var l = String(lang || "").toLowerCase();
  if (l.indexOf("latino") >= 0 || /\blat\b/.test(l) || l.indexOf("es_mx") >= 0) return "es_MX";
  if (l.indexOf("castellano") >= 0 || l.indexOf("español") >= 0 || l.indexOf("espanol") >= 0 || /\besp\b/.test(l))
    return "es_ES";
  if (l.indexOf("sub") >= 0 || l.indexOf("english") >= 0 || l.indexOf("ingles") >= 0 || l.indexOf("inglés") >= 0)
    return "en_US";
  return "es_MX";
}

function idiomaDe(lang) {
  var c = langToCode(lang);
  if (c === "es_ES") return "Español";
  if (c === "en_US") return "Subtitulado";
  return "Latino";
}

/**
 * Idioma por servidor: primero el data-name ("Español Latino" → Latino),
 * y si no hay nombre, la etiqueta <title> de la ficha ("... Online Latino HD").
 * Solo como ultimo recurso se mira todo el HTML.
 */
function detectLanguage(name, html) {
  var n = String(name || "").toLowerCase();
  if (n && /\blat\b|latino/.test(n)) return "Latino";
  if (n.indexOf("castellano") >= 0 || n.indexOf("español") >= 0 || n.indexOf("espanol") >= 0)
    return "Español";
  if (n.indexOf("sub") >= 0) return "Subtitulado";
  if (n.indexOf("ingl") >= 0) return "Subtitulado";

  var t = String(html || "").match(/<title>([\s\S]*?)<\/title>/i);
  var cabeza = t ? t[1].toLowerCase() : "";
  if (/\blat\b|latino/.test(cabeza)) return "Latino";
  if (cabeza.indexOf("castellano") >= 0 || cabeza.indexOf("español") >= 0) return "Español";
  if (cabeza.indexOf("subtitulad") >= 0) return "Subtitulado";

  var todo = String(html || "").toLowerCase();
  if (/\blat\b|latino/.test(todo)) return "Latino";
  if (todo.indexOf("castellano") >= 0 || todo.indexOf("español") >= 0) return "Español";
  return "Latino";
}

// ─────────────────────────────────────────────────────────
// getStreams
// ─────────────────────────────────────────────────────────

async function getStreams(tmdbId, mediaType, season, episode) {
  try {
    var id = parseInt(tmdbId, 10);
    if (!id || id <= 0) return [];
    var esPelicula = mediaType !== "tv";
    var tipo = esPelicula ? "movie" : "tv";

    var titles = await getTmdbTitles(id, tipo);
    if (!titles.length) return [];

    var page = await findPageUrl(titles, tipo);
    if (!page) return [];

    var pageUrl = absolutizar(page.base, page.href);
    if (!esPelicula) {
      pageUrl =
        pageUrl.replace(/\/+$/, "") +
        "/temporada/" + (season || 1) + "/capitulo/" + (episode || 1);
    }

    var html = await fetchText(pageUrl, page.base + "/");

    // Fallback: rutas directas por id TMDB (raras veces existen en el sitio).
    if (!html || !/data-url=|url="https?:/i.test(html)) {
      var alternas = [page.base + "/pelicula/" + id, page.base + "/serie/" + id];
      for (var a = 0; a < alternas.length; a++) {
        var alt = await fetchText(alternas[a], page.base + "/");
        if (alt && /data-url="https?:|url="https?:/i.test(alt)) {
          html = alt;
          pageUrl = alternas[a];
          break;
        }
      }
    }
    if (!html) return [];

    var raw = extractServers(html);
    if (!raw.length) return [];

    var orden = { Latino: 0, "Español": 1, Subtitulado: 2 };
    raw.sort(function (x, y) {
      var ix = orden[idiomaDe(x.language)];
      var iy = orden[idiomaDe(y.language)];
      return (ix == null ? 9 : ix) - (iy == null ? 9 : iy);
    });

    var usados = {};
    var streams = [];
    for (var i = 0; i < raw.length; i++) {
      var s = raw[i];
      var idioma = idiomaDe(s.language);
      var nombre = String(s.name || "").trim() || hostLabel(s.url);
      var etiqueta = idioma + " · " + nombre;
      if (usados[etiqueta]) {
        usados[etiqueta]++;
        etiqueta = etiqueta + " " + usados[etiqueta];
      } else {
        usados[etiqueta] = 1;
      }
      streams.push({
        title: etiqueta,
        quality: "HD",
        language: idioma,
        url: s.url,
        headers: { Referer: pageUrl, "User-Agent": UA },
      });
    }
    return streams;
  } catch (e) {
    return [];
  }
}

module.exports = { getStreams };
