// PelisPlus — puerto a JS de lib/data/extractors/providers/pelisplus_extractor.dart
// Formato que ejecuta el motor de MasterScrap: CommonJS `module.exports = { getStreams }`,
// solo fetch + RegExp (+ JSON), nunca lanza (devuelve [] ante cualquier fallo).
//
// Flujo del sitio (estructura propia, no es un embed directo por TMDB):
//   1) Titulos desde TMDB (es-MX, es-ES, en-US) + variantes
//   2) /search?s=<titulo>  ->  ficha /pelicula/<slug>  (o /serie/<slug>)
//   3) Serie: /serie/<slug>/temporada/<S>/capitulo/<E>
//   4) Los embeds vienen en el HTML de la ficha. Formatos soportados:
//        A) <li data-url="..." data-name="Español Latino" class="playurl">   (peliculas)
//        B) <span lid="1" url="https://host/embed-x.html">                   (capitulos)
//        C) var options = { "Latino": [ {name, url} ] }                      (tema viejo)
//        D) var video = []; video[1] = 'https://host/f/ttID/';               (mirror viejo)
//      NO se resuelve HLS: se devuelven los embeds y el motor (masters.js) aplica
//      getEmbedResolver()/mapDomain() para streamwish, vidhide, voe, embed69...
//
// Notas del puerto:
//  - El Dart detectaba idioma con `name + TODO el html`, asi que cualquier
//    "latino" en la pagina marcaba todos los servidores como Latino y
//    _isLanguageSupported() tiraba los subtitulados. Aqui se detecta por
//    servidor (data-name / tab / host) y se conservan TODOS, etiquetados.
//  - El dominio rota y www.pelisplushd.la redirige a pelisplushd.to. Se prueban
//    varios dominios en orden; si uno responde el challenge de Cloudflare
//    ("Just a moment..." / 403) se descarta y se pasa al siguiente.
var UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

var ACCEPT =
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";

// .to = sitio bueno (trae idiomas y mas servidores); .bz = espejo viejo.
// www.pelisplushd.la (el del Dart) ya solo es un 302 a pelisplushd.to, asi que
// no aporta nada: incluirlo costaba un request extra por busqueda.
var DOMAINS = ["https://pelisplushd.to", "https://pelisplushd.bz"];

var TMDB_KEY = "439c478a771f35c05022f9feabcca01c";
var TIMEOUT = 12000;
var MAX_TITULOS = 4; // por dominio
var MAX_CANDIDATOS = 3; // fichas que se llegan a abrir

var muertos = {}; // dominio -> challenge de Cloudflare (se salta)

// ─────────────────────────────────────────────────────────
// HTTP
// ─────────────────────────────────────────────────────────

function conTimeout(url, opts, ms) {
  var o = opts || {};
  if (typeof AbortController === "undefined" || typeof setTimeout === "undefined") {
    return fetch(url, o);
  }
  var ctrl = new AbortController();
  o.signal = ctrl.signal;
  var t = setTimeout(function () {
    try {
      ctrl.abort();
    } catch (e) {}
  }, ms || TIMEOUT);
  return fetch(url, o).then(
    function (r) {
      clearTimeout(t);
      return r;
    },
    function (e) {
      clearTimeout(t);
      throw e;
    }
  );
}

function esChallenge(status, body) {
  if (status === 403 || status === 503) return true;
  var b = String(body || "");
  return b.length < 20000 && /just a moment|cf-mitigated|enable javascript and cookies/i.test(b);
}

function fetchText(url, referer) {
  var headers = {
    "User-Agent": UA,
    Accept: ACCEPT,
    "Accept-Language": "es-ES,es;q=0.9",
    "Cache-Control": "no-cache",
  };
  if (referer) headers.Referer = referer;
  return conTimeout(url, { headers: headers, redirect: "follow" }, TIMEOUT)
    .then(function (res) {
      if (!res) return null;
      return res.text().then(function (body) {
        if (!res.ok || esChallenge(res.status, body)) return null;
        return body;
      });
    })
    .catch(function () {
      return null;
    });
}

function origen(url) {
  var m = String(url || "").match(/^https?:\/\/[^\/]+/i);
  return m ? m[0] : "";
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
// TMDB — titulos (es-MX, es-ES, en-US) + variantes de busqueda
// ─────────────────────────────────────────────────────────

function push(arr, v) {
  var s = String(v == null ? "" : v).trim();
  if (s && arr.indexOf(s) < 0) arr.push(s);
}

function tmdbTitulo(type, id, lang) {
  var url =
    "https://api.themoviedb.org/3/" + type + "/" + id + "?api_key=" + TMDB_KEY +
    (lang ? "&language=" + lang : "");
  return fetchJson(url).then(function (d) {
    if (!d) return "";
    var t = d.title != null ? d.title : d.name;
    return t == null ? "" : String(t).trim();
  });
}

function getTmdbTitulos(tmdbId, type) {
  var langs = ["es-MX", "es-ES", "en-US"];
  var base = [];
  var i = 0;

  function paso() {
    if (i >= langs.length) return Promise.resolve(base);
    var lang = langs[i++];
    return tmdbTitulo(type, tmdbId, lang).then(function (t) {
      if (t && base.indexOf(t) < 0) base.push(t);
      return paso();
    });
  }

  return paso()
    .then(function (list) {
      if (list.length) return list;
      return tmdbTitulo(type, tmdbId, null).then(function (t) {
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
      // Variantes cortas ("Matrix" en vez de "Matrix: Revoluciones")
      for (var j = 0; j < list.length; j++) {
        var corto = String(list[j]).split(/[:(\-]/)[0].trim();
        if (corto.length > 3) push(out, corto);
      }
      return out.slice(0, MAX_TITULOS * 3);
    });
}

// ─────────────────────────────────────────────────────────
// Normalizacion y matching de titulos
// ─────────────────────────────────────────────────────────

function normTitle(title) {
  var s = String(title == null ? "" : title).toLowerCase();
  return s
    .replace(/á|à|ä|â/g, "a")
    .replace(/é|è|ë|ê/g, "e")
    .replace(/í|ì|ï|î/g, "i")
    .replace(/ó|ò|ö|ô/g, "o")
    .replace(/ú|ù|ü|û/g, "u")
    .replace(/ñ/g, "n")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 100 = titulos identicos. Si no, ratio de palabras significativas (>=80%) con
 * penalizacion por palabras extra ("matrix" le gana a "matrix revoluciones").
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
  return ratio * 10 - (tWords.length - hits);
}

function stripTags(html) {
  return String(html == null ? "" : html)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ─────────────────────────────────────────────────────────
// Busqueda: <a href="/pelicula/slug" data-title="VER ... Online Gratis HD">
// ─────────────────────────────────────────────────────────

function parseResultados(html, mediaType) {
  var out = [];
  var tipo = mediaType === "movie" ? "pelicula" : "serie";
  var re = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    var href = m[1] || "";
    // El mirror .bz publica hrefs absolutos; se valida siempre por la ruta.
    var ruta = href.replace(/^https?:\/\/[^\/]+/i, "");
    if (!new RegExp("^/?" + tipo + "/[^/?\"#]+/?$", "i").test(ruta)) continue;

    var title = "";
    var dt = m[0].match(/data-title="([^"]*)"/i);
    if (dt) title = stripTags(dt[1]);
    if (!title) {
      var p = (m[2] || "").match(/<p[^>]*>([\s\S]*?)<\/p>/i);
      title = p ? stripTags(p[1]) : stripTags(m[2] || "");
    }
    title = title
      .replace(/^ver\s+/i, "")
      .replace(/\s+online\s+gratis\s+hd\s*$/i, "")
      .replace(/\s+online\s+(latino|castellano|español)\s+hd\s*$/i, "")
      .replace(/\s+online\s+hd\s*$/i, "")
      .replace(/\(\d{4}\)\s*$/, "")
      .trim();
    if (!title) continue;

    out.push({ href: href, title: title });
  }
  return out;
}

/** Devuelve fichas candidatas ordenadas por score (mejor primero). */
function buscarFichas(titulos, mediaType) {
  var cands = [];
  var vistos = {};
  var d = 0;

  function porDominio() {
    if (d >= DOMAINS.length) return Promise.resolve(cands);
    var base = DOMAINS[d++];
    if (muertos[base]) return porDominio();

    var i = 0;
    var exacto = false;

    function porTitulo() {
      if (i >= titulos.length || i >= MAX_TITULOS || exacto) return Promise.resolve();
      var t = titulos[i++];
      var url = base + "/search?s=" + encodeURIComponent(t);
      return fetchText(url, base + "/").then(function (html) {
        if (html === null) {
          muertos[base] = 1;
          return;
        }
        var res = parseResultados(html, mediaType);
        for (var k = 0; k < res.length; k++) {
          var sc = matchScore(t, res[k].title);
          if (sc <= 0) continue;
          var abs = /^https?:/i.test(res[k].href) ? res[k].href : base + res[k].href;
          if (vistos[abs]) continue;
          vistos[abs] = 1;
          cands.push({ url: abs, score: sc, base: base });
          if (sc >= 100) exacto = true;
        }
        if (exacto) return;
        return porTitulo();
      });
    }

    return porTitulo().then(function () {
      if (exacto || cands.length) {
        cands.sort(function (a, b) {
          return b.score - a.score;
        });
        if (exacto) return cands;
      }
      return porDominio();
    });
  }

  return porDominio().then(function () {
    cands.sort(function (a, b) {
      return b.score - a.score;
    });
    return cands.slice(0, MAX_CANDIDATOS);
  });
}

// ─────────────────────────────────────────────────────────
// Servidores embebidos
// ─────────────────────────────────────────────────────────

function hostLabel(url) {
  var m = String(url || "").match(/^https?:\/\/(?:www\.)?([^\/:]+)/i);
  if (!m) return "Servidor";
  var nombre = m[1].toLowerCase().split(".")[0];
  return nombre.charAt(0).toUpperCase() + nombre.slice(1);
}

function esUrlServidor(url) {
  if (!/^https?:\/\//i.test(url)) return false;
  if (/pelisplushd|pelisplus|google|cloudflare|sharethis|platform-api|doubleclick|w3\.org/i.test(url))
    return false;
  return (
    /\/(e|v|embed|f|w|d|play|u|file)\/[^\/\s"']/i.test(url) ||
    /embed-[a-z0-9]+\.html/i.test(url) ||
    /\.(html?|php|mp4|m3u8)(\?|$)/i.test(url)
  );
}

function leerAttr(tag, attr) {
  var m =
    tag.match(new RegExp(attr + '\\s*=\\s*"([^"]*)"', "i")) ||
    tag.match(new RegExp(attr + "\\s*=\\s*'([^']*)'", "i"));
  return m ? m[1] : "";
}

function extractServers(html) {
  var out = [];
  var seen = {};
  var m;

  function agregar(url, name, lang) {
    url = String(url || "").trim();
    if (!url || seen[url] || !esUrlServidor(url)) return;
    seen[url] = 1;
    out.push({ url: url, name: name || "", language: lang || "" });
  }

  // A) <li ... data-url="..." ... data-name="...">  (orden de atributos libre)
  var reLi = /<li\b[^>]*data-url="([^"]+)"[^>]*>/gi;
  while ((m = reLi.exec(html)) !== null) {
    var nom = leerAttr(m[0], "data-name");
    agregar(m[1], nom, detectLanguage(nom, html));
  }

  // B) <span lid="1" url="https://host/embed-x.html">
  if (!out.length) {
    var reSpan = /<span\b[^>]*\burl="([^"]+)"[^>]*>/gi;
    while ((m = reSpan.exec(html)) !== null) {
      agregar(m[1], hostLabel(m[1]), detectLanguage("", html));
    }
  }

  // C) var options = { "Latino": [ {name, url}, ... ] }
  if (!out.length) {
    var mo = html.match(/var\s+options\s*=\s*(\{[\s\S]*?\});/i);
    if (mo) {
      var opts = parseJsObject(mo[1]);
      Object.keys(opts).forEach(function (key) {
        var val = opts[key];
        if (Object.prototype.toString.call(val) !== "[object Array]") return;
        for (var i = 0; i < val.length; i++) {
          var it = val[i];
          if (it && typeof it === "object" && it.url) agregar(it.url, it.name || key, key);
        }
      });
    }
  }

  // D) var video = []; video[1] = 'https://host/f/ttID/';  (+ tabs data-id)
  if (!out.length) {
    var tabs = {};
    var reTab = /<li[^>]*data-id="(\d+)"[^>]*>[\s\S]{0,300}?<a[^>]*>([^<]*)<\/a>/gi;
    var t;
    while ((t = reTab.exec(html)) !== null) tabs[t[1]] = stripTags(t[2]);

    var reVideo = /video\[(\d+)\]\s*=\s*['"]([^'"]+)['"]/gi;
    while ((m = reVideo.exec(html)) !== null) {
      agregar(m[2], tabs[m[1]] || hostLabel(m[2]), detectLanguage(tabs[m[1]] || "", html));
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
// Idioma → etiqueta (mismo criterio que unlimplay.js)
// ─────────────────────────────────────────────────────────

function idomaLabel(lang) {
  var l = String(lang || "").toLowerCase();
  if (l.indexOf("latino") >= 0 || /\blat\b/.test(l) || l.indexOf("es_mx") >= 0) return "Latino";
  if (
    l.indexOf("castellano") >= 0 ||
    l.indexOf("español") >= 0 ||
    l.indexOf("espanol") >= 0 ||
    /\besp\b/.test(l) ||
    l.indexOf("es_es") >= 0
  )
    return "Español";
  if (l.indexOf("sub") >= 0 || l.indexOf("english") >= 0 || l.indexOf("ingl") >= 0)
    return "Subtitulado";
  return "";
}

/**
 * Por servidor: data-name / tab ("Español Latino" -> Latino). Si el servidor no
 * trae idioma, la etiqueta <title> de la ficha ("... Capitulo 1 Online Latino HD").
 * Si tampoco hay pista, Latino (mismo default que el Dart). NO se escanea todo el
 * HTML: el boilerplate ("...en español sin coste...") etiquetaba todo mal.
 */
function detectLanguage(name, html) {
  var n = idomaLabel(name);
  if (n) return n;

  var t = String(html || "").match(/<title>([\s\S]*?)<\/title>/i);
  var cab = t ? idomaLabel(t[1]) : "";
  if (cab) return cab;

  return "Latino";
}

// ─────────────────────────────────────────────────────────
// getStreams
// ─────────────────────────────────────────────────────────

function urlCapitulo(base, season, episode) {
  return (
    base.replace(/\/+$/, "") + "/temporada/" + (season || 1) + "/capitulo/" + (episode || 1)
  );
}

async function getStreams(tmdbId, mediaType, season, episode) {
  try {
    var id = parseInt(tmdbId, 10);
    if (!id || id <= 0) return [];
    var esPelicula = mediaType !== "tv";

    var titulos = await getTmdbTitulos(id, esPelicula ? "movie" : "tv");
    if (!titulos.length) return [];

    var fichas = await buscarFichas(titulos, esPelicula ? "movie" : "tv");
    if (!fichas.length) return [];

    for (var c = 0; c < fichas.length; c++) {
      var ficha = fichas[c];
      var pageUrl = esPelicula ? ficha.url : urlCapitulo(ficha.url, season, episode);
      var html = await fetchText(pageUrl, ficha.base + "/");

      // Ficha inexistente / sin player: probar las rutas directas por id TMDB.
      if (!html || !/data-url="https?:|url="https?:|var video\s*=|var options\s*=/i.test(html)) {
        var alt = esPelicula
          ? ficha.base + "/pelicula/" + id
          : urlCapitulo(ficha.base + "/serie/" + id, season, episode);
        var html2 = await fetchText(alt, ficha.base + "/");
        if (html2 && /data-url="https?:|url="https?:|var video\s*=|var options\s*=/i.test(html2)) {
          html = html2;
          pageUrl = alt;
        }
      }
      if (!html) continue;

      var raw = extractServers(html);
      if (!raw.length) continue;

      var orden = { Latino: 0, "Español": 1, Subtitulado: 2 };
      raw.sort(function (x, y) {
        return (orden[x.language] || 0) - (orden[y.language] || 0);
      });

      var usados = {};
      var streams = [];
      for (var i = 0; i < raw.length; i++) {
        var s = raw[i];
        var idioma = idomaLabel(s.language) || "Latino";
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
    }
    return [];
  } catch (e) {
    return [];
  }
}

module.exports = { getStreams };
