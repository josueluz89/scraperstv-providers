// ─────────────────────────────────────────────────────────────────────────────
// Polyfills para el runtime de Nuvio (QuickJS): no trae atob/btoa, no trae ICU
// (String.normalize) y puede no traer matchAll / Promise.any / allSettled.
// ─────────────────────────────────────────────────────────────────────────────
var B64CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function atob(input) {
  var str = String(input == null ? "" : input).replace(/[^A-Za-z0-9+/]/g, "");
  var out = "";
  var bits = 0;
  var val = 0;
  for (var i = 0; i < str.length; i++) {
    var idx = B64CHARS.indexOf(str.charAt(i));
    if (idx < 0) continue;
    val = (val << 6) | idx;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((val >> bits) & 0xff);
    }
  }
  return out;
}

function btoa(input) {
  var str = String(input == null ? "" : input);
  var out = "";
  var i = 0;
  while (i < str.length) {
    var c1 = str.charCodeAt(i++) & 0xff;
    var c2 = i < str.length ? str.charCodeAt(i++) & 0xff : NaN;
    var c3 = i < str.length ? str.charCodeAt(i++) & 0xff : NaN;
    var e1 = c1 >> 2;
    var e2 = ((c1 & 3) << 4) | (isNaN(c2) ? 0 : c2 >> 4);
    var e3 = isNaN(c2) ? 64 : ((c2 & 15) << 2) | (isNaN(c3) ? 0 : c3 >> 6);
    var e4 = isNaN(c3) ? 64 : c3 & 63;
    out += B64CHARS.charAt(e1) + B64CHARS.charAt(e2) + (e3 === 64 ? "=" : B64CHARS.charAt(e3)) + (e4 === 64 ? "=" : B64CHARS.charAt(e4));
  }
  return out;
}

var ACENTOS = {
  "\u00e1": "a", "\u00e0": "a", "\u00e4": "a", "\u00e2": "a", "\u00e3": "a", "\u00e5": "a",
  "\u00e9": "e", "\u00e8": "e", "\u00eb": "e", "\u00ea": "e",
  "\u00ed": "i", "\u00ec": "i", "\u00ef": "i", "\u00ee": "i",
  "\u00f3": "o", "\u00f2": "o", "\u00f6": "o", "\u00f4": "o", "\u00f5": "o",
  "\u00fa": "u", "\u00f9": "u", "\u00fc": "u", "\u00fb": "u",
  "\u00f1": "n", "\u00e7": "c",
  "\u00c1": "A", "\u00c0": "A", "\u00c4": "A", "\u00c2": "A", "\u00c3": "A",
  "\u00c9": "E", "\u00c8": "E", "\u00cb": "E", "\u00ca": "E",
  "\u00cd": "I", "\u00cc": "I", "\u00cf": "I", "\u00ce": "I",
  "\u00d3": "O", "\u00d2": "O", "\u00d6": "O", "\u00d4": "O", "\u00d5": "O",
  "\u00da": "U", "\u00d9": "U", "\u00dc": "U", "\u00db": "U",
  "\u00d1": "N", "\u00c7": "C",
};

if (typeof String.prototype.normalize !== "function") {
  String.prototype.normalize = function (form) {
    if (form === "NFD" || form === "NFKD") {
      return String(this).replace(/[\u00c0-\u017f]/g, function (c) {
        return ACENTOS[c] || c;
      });
    }
    return String(this);
  };
}

if (typeof String.prototype.matchAll !== "function") {
  String.prototype.matchAll = function (re) {
    var g = re && re.global ? re : new RegExp(re.source, (re.flags || "").indexOf("g") >= 0 ? re.flags : (re.flags || "") + "g");
    var out = [];
    var s = String(this);
    var m;
    g.lastIndex = 0;
    while ((m = g.exec(s)) !== null) {
      out.push(m);
      if (m.index === g.lastIndex) g.lastIndex++;
    }
    return out;
  };
}

if (typeof Promise.any !== "function") {
  Promise.any = function (list) {
    return new Promise(function (resolve, reject) {
      var items = Array.prototype.slice.call(list || []);
      var pendientes = items.length;
      if (!pendientes) return reject(new Error("All promises were rejected"));
      items.forEach(function (p, i) {
        Promise.resolve(p).then(resolve, function () {
          if (--pendientes === 0) reject(new Error("All promises were rejected"));
        });
      });
    });
  };
}

if (typeof Promise.allSettled !== "function") {
  Promise.allSettled = function (list) {
    return Promise.all(
      Array.prototype.slice.call(list || []).map(function (p) {
        return Promise.resolve(p).then(
          function (value) { return { status: "fulfilled", value: value }; },
          function (reason) { return { status: "rejected", reason: reason }; }
        );
      })
    );
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SeriesFlixHD — https://seriesflixhd.team  (antes seriesflixhd.best, que ahora
// responde 301 hacia el dominio nuevo)
//
//   búsqueda : /buscar/<titulo>
//   serie    : /serie/<slug>/                 (slug = titulo + sufijo aleatorio, p.ej. the-boys-zbqm)
//   temporada: /temporada/<slug>-<N>/
//   episodio : /episodio/<slug>-<S>x<E>/      (p.ej. /episodio/the-boys-zbqm-3x1/)
//
// Cada episodio lista idiomas (LATINO / CASTELLANO / SUBTITULADO) con <div data-url="<base64>">
// que decodifican a reproductores:
//   - https://nupload.my/watch/<id>            -> mirror propio (sv4.ibra.lat/*.m3u8)
//   - https://nupload.my/iframe/?url=<voe url> -> voe.sx (o jamesbornmain.com)
// ─────────────────────────────────────────────────────────────────────────────

var SITE = "https://seriesflixhd.team";
var TMDB_KEY = "439c478a771f35c05022f9feabcca01c";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
var PRESUPUESTO_MS = 40000;
var MAX_EMBEDS_POR_IDIOMA = 4;
var IDIOMAS = ["Latino", "Castellano", "Subtitulado", "Espa\u00f1ol", "Ingl\u00e9s"];

function limit() {
  return Date.now() + PRESUPUESTO_MS;
}

function enc(s) {
  try {
    if (typeof encodeURIComponent === "function") return encodeURIComponent(String(s));
  } catch (e) {}
  return String(s).replace(/ /g, "%20");
}

function dec(s) {
  try {
    if (typeof decodeURIComponent === "function") return decodeURIComponent(String(s));
  } catch (e) {}
  return String(s);
}

function uaHeaders(extra) {
  var h = { "User-Agent": UA };
  if (extra) for (var k in extra) h[k] = extra[k];
  return h;
}

function fetchText(url, headers) {
  return fetch(url, { headers: headers || uaHeaders(), redirect: "follow" }).then(function (res) {
    if (!res.ok) throw new Error("HTTP " + res.status + " :: " + url);
    return res.text();
  });
}

function unescapeHtml(s) {
  var map = { "&amp;": "&", "&quot;": '"', "&#039;": "'", "&#39;": "'", "&apos;": "'", "&lt;": "<", "&gt;": ">", "&nbsp;": " " };
  return String(s == null ? "" : s).replace(/&(amp|quot|#0?39|apos|lt|gt|nbsp);/g, function (x) {
    return map[x] || x;
  });
}

// Normaliza un titulo a slug (el mismo que usa el sitio en /serie/ y /episodio/)
function slugify(n) {
  return String(n == null ? "" : n)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, "y")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function calidad(n, e) {
  return n >= 3840 || e >= 2160 ? "4K" : n >= 1920 || e >= 1080 ? "1080p" : n >= 1280 || e >= 720 ? "720p" : n >= 854 || e >= 480 ? "480p" : "360p";
}

function esM3u8(texto) {
  return texto && texto.indexOf("#EXTM3U") >= 0;
}

function pareceMuerto(texto) {
  if (!texto) return false;
  var t = texto.toLowerCase();
  return t.indexOf("dmca") >= 0 || t.indexOf("deleted") >= 0 || t.indexOf("not found") >= 0 || t.indexOf("no encontrado") >= 0;
}

// Calidad a partir del .m3u8 (RESOLUTION=) o del nombre de la URL. Devuelve null si el
// fichero esta claramente borrado (asi el idioma siguiente puede tomar el relevo).
function inspeccionarHls(url, headers) {
  var porNombre = function (u) {
    var m = String(u || "").match(/[_-](\d{3,4})p/);
    return m ? m[1] + "p" : null;
  };
  return fetch(url, { headers: headers || uaHeaders(), redirect: "follow" })
    .then(function (res) {
      return res.text().then(function (txt) {
        if (res.status >= 400) return { vivo: false, calidad: null, final: url };
        if (esM3u8(txt)) {
          if (txt.indexOf("#EXT-X-STREAM-INF") < 0) return { vivo: true, calidad: porNombre(url) || "HD", final: url };
          var w = 0, h = 0, s, re = /RESOLUTION=(\d+)x(\d+)/g;
          while ((s = re.exec(txt)) !== null) {
            var alto = parseInt(s[2], 10);
            if (alto > h) { h = alto; w = parseInt(s[1], 10); }
          }
          return { vivo: true, calidad: h > 0 ? calidad(w, h) : porNombre(url) || "HD", final: url };
        }
        if (pareceMuerto(txt)) return { vivo: false, calidad: null, final: url };
        return { vivo: true, calidad: porNombre(url) || "HD", final: url };
      });
    })
    .catch(function () {
      return { vivo: true, calidad: porNombre(url) || "HD", final: url };
    });
}

// ── TMDB ────────────────────────────────────────────────────────────────────
// Ojo: se usa res.text() + JSON.parse en vez de res.json() para que funcione en
// cualquier runtime (el sandbox QuickJS de Nuvio expone text() de forma fiable).
function tmdbJson(url) {
  return fetch(url)
    .then(function (r) {
      return r.ok === false ? null : r.text();
    })
    .then(function (raw) {
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch (e) {
        return null;
      }
    })
    .catch(function () {
      return null;
    });
}

function infoTmdb(tmdbId) {
  return Promise.all(
    ["es-ES", "es-MX", "en-US"].map(function (lang) {
      return tmdbJson("https://api.themoviedb.org/3/tv/" + tmdbId + "?api_key=" + TMDB_KEY + "&language=" + lang);
    })
  ).then(function (res) {
    var es = res[0], mx = res[1], en = res[2];
    var tituloEs = es ? (es.name || es.title) : null;
    var base = mx && !/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(mx.name || mx.title || "") ? mx : en;
    if (!base) base = es;
    if (!base) return null;
    var info = {
      title: base.name || base.title || "",
      originalTitle: base.original_name || base.original_title || "",
      titleEs: tituloEs || "",
      year: String(base.first_air_date || base.release_date || "").substring(0, 4),
    };
    console.log('[SeriesFlixHD] TMDB: "' + info.title + '" (' + info.year + ")");
    return info;
  });
}

// ── Búsqueda ────────────────────────────────────────────────────────────────
function buscarTitulo(titulo) {
  var url = SITE + "/buscar/" + enc(titulo);
  return fetchText(url, uaHeaders({ Accept: "text/html" }))
    .then(function (html) {
      var out = [];
      var re = /<a href="(\/serie\/[^"]+)"[\s\S]{0,400}?<h2 class="Title">([\s\S]*?)<\/h2>/g;
      var m;
      while ((m = re.exec(html)) !== null) {
        out.push({
          slug: m[1].replace(/^\/serie\//, "").replace(/\/+$/, ""),
          name: unescapeHtml(m[2].replace(/<[^>]*>/g, "")).trim(),
        });
      }
      console.log('[SeriesFlixHD] buscar "' + titulo + '": ' + out.length + " candidatos");
      return out;
    })
    .catch(function () {
      return [];
    });
}

function puntuar(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1000;
  var at = a.split("-");
  var bt = b.split("-");
  var hit = 0;
  for (var i = 0; i < at.length; i++) {
    if (at[i].length > 1 && bt.indexOf(at[i]) >= 0) hit++;
  }
  var s = hit * 20 - Math.abs(bt.length - at.length);
  if (b.indexOf(a) === 0 || a.indexOf(b) === 0) s += 30;
  return s;
}

function elegirSerie(candidatos, titulos) {
  var mejor = null;
  var mejorP = 19;
  for (var i = 0; i < candidatos.length; i++) {
    var candidato = candidatos[i];
    for (var j = 0; j < titulos.length; j++) {
      var p = puntuar(slugify(titulos[j]), slugify(candidato.name || candidato.slug));
      if (p > mejorP) {
        mejorP = p;
        mejor = candidato;
      }
    }
  }
  if (mejor) console.log('[SeriesFlixHD] serie elegida: /serie/' + mejor.slug + "/ (" + mejor.name + ") p=" + mejorP);
  return mejor;
}

// ── URL del episodio: /temporada/<slug>-<N>/ -> /episodio/<slug>-<S>x<E>/ ────
function episodioEnTemporada(slugSerie, s, e) {
  var url = SITE + "/temporada/" + slugSerie + "-" + s + "/";
  return fetchText(url, uaHeaders({ Accept: "text/html" }))
    .then(function (html) {
      var links = [];
      var re = /href="([^"]*\/episodio\/[^"]*)"/g;
      var m;
      while ((m = re.exec(html)) !== null) {
        var u = m[1];
        if (links.indexOf(u) < 0) links.push(u);
      }
      var objetivo = new RegExp("-" + s + "x" + e + "/?$");
      for (var i = 0; i < links.length; i++) {
        if (objetivo.test(links[i])) {
          return links[i].indexOf("http") === 0 ? links[i] : SITE + (links[i].charAt(0) === "/" ? "" : "/") + links[i];
        }
      }
      return null;
    })
    .catch(function () {
      return null;
    });
}

// Candidatos directos: el sitio redirige (301) /episodio/<slug-sin-sufijo>-SxE/ al canonical
function candidatosDirectos(titulos, slugSerie, s, e) {
  var out = [];
  var add = function (slug) {
    if (!slug) return;
    var u = SITE + "/episodio/" + slug + "-" + s + "x" + e + "/";
    if (out.indexOf(u) < 0) out.push(u);
  };
  add(slugSerie);
  for (var i = 0; i < titulos.length; i++) add(slugify(titulos[i]));
  return out;
}

function cargarEpisodio(url) {
  return fetchText(url, uaHeaders({ Accept: "text/html" }))
    .then(function (html) {
      if (!html || html.indexOf("data-url") < 0) return { url: url, html: null };
      return { url: url, html: html };
    })
    .catch(function () {
      return { url: url, html: null };
    });
}

function resolverEpisodio(titulos, slugSerie, s, e, fin) {
  var candidatos = candidatosDirectos(titulos, slugSerie, s, e);
  if (Date.now() > fin) return Promise.resolve(null);
  return Promise.all(candidatos.map(cargarEpisodio)).then(function (res) {
    for (var i = 0; i < res.length; i++) {
      if (res[i] && res[i].html) {
        console.log("[SeriesFlixHD] \u2713 episodio: " + res[i].url);
        return res[i];
      }
    }
    return null;
  });
}

// ── Parseo de idiomas + data-url ────────────────────────────────────────────
function parsearSecciones(html) {
  var out = {};
  var orden = [];
  var re = /<span>([^<]{2,25})<span>Idioma<\/span><\/span>([\s\S]*?)<\/ul>/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    var etiqueta = unescapeHtml(m[1].replace(/<[^>]*>/g, "")).trim();
    var clave = etiqueta.toUpperCase();
    var nombre = clave.indexOf("CASTELLANO") >= 0 ? "Castellano"
      : clave.indexOf("SUBTIT") >= 0 ? "Subtitulado"
      : clave.indexOf("LATINO") >= 0 ? "Latino"
      : etiqueta;
    var links = [];
    var reUrl = /data-url="([^"]+)"/g;
    var x;
    while ((x = reUrl.exec(m[2])) !== null) {
      var url = null;
      try {
        url = atob(x[1]);
      } catch (err) {
        url = null;
      }
      if (url && url.indexOf("http") === 0 && links.indexOf(url) < 0) links.push(url);
    }
    if (!links.length) continue;
    if (!out[nombre]) {
      out[nombre] = links;
      orden.push(nombre);
    } else {
      for (var i = 0; i < links.length; i++) if (out[nombre].indexOf(links[i]) < 0) out[nombre].push(links[i]);
    }
  }
  if (!orden.length) {
    // Estructura cambiada: usar todos los data-url de la pagina como idioma unico
    var todos = [];
    var reAll = /data-url="([^"]+)"/g;
    var y;
    while ((y = reAll.exec(html)) !== null) {
      var u = null;
      try {
        u = atob(y[1]);
      } catch (err) {
        u = null;
      }
      if (u && u.indexOf("http") === 0 && todos.indexOf(u) < 0) todos.push(u);
    }
    if (todos.length) {
      out["Latino"] = todos;
      orden.push("Latino");
    }
  }
  return { mapa: out, orden: orden };
}

// ── Resolvers ───────────────────────────────────────────────────────────────
function base64Voe(input) {
  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  var str = String(input).replace(/=+$/, "");
  var output = "";
  if (str.length % 4 === 1) return "";
  for (var i = 0, bc = 0, bs = 0; i < str.length; i++) {
    var indice = chars.indexOf(str.charAt(i));
    if (indice === -1) continue;
    bs = bc % 4 ? bs * 64 + indice : indice;
    if (bc++ % 4) output += String.fromCharCode(255 & (bs >> ((-2 * bc) & 6)));
  }
  return output;
}

function rot13(str) {
  return String(str).replace(/[A-Za-z]/g, function (c) {
    return String.fromCharCode(c.charCodeAt(0) + (c.toUpperCase() <= "M" ? 13 : -13));
  });
}

function patronesVoe(str) {
  var res = String(str);
  var patrones = ["@$", "^^", "~@", "%?", "*~", "!!", "#&"];
  for (var i = 0; i < patrones.length; i++) res = res.split(patrones[i]).join("_");
  return res;
}

function descifrarVoe(encoded) {
  try {
    var s = rot13(encoded);
    s = patronesVoe(s);
    s = s.split("_").join("");
    var d = base64Voe(s);
    if (!d) return null;
    d = d.split("").map(function (c) { return String.fromCharCode(c.charCodeAt(0) - 3); }).join("");
    d = d.split("").reverse().join("");
    d = base64Voe(d);
    if (!d) return null;
    return JSON.parse(d);
  } catch (e) {
    return null;
  }
}

function resolverVoe(embedUrl) {
  var headers = uaHeaders({ Referer: embedUrl });
  var analizar = function (html) {
    var json = html.match(/<script[^>]*type=['"]application\/json['"][^>]*>\s*\[\s*"([^"]+)"\s*\]\s*<\/script>/i);
    if (!json) {
      var directos = [];
      var re1 = /(?:mp4|hls)['"]\s*:\s*['"]([^'"]+)['"]/gi;
      var m;
      while ((m = re1.exec(html)) !== null) {
        var u = m[1];
        if (u.indexOf("aHR0") === 0) {
          try { u = base64Voe(u) || u; } catch (e) {}
        }
        if (u.indexOf("http") === 0) directos.push(u);
      }
      if (!directos.length) return Promise.resolve(null);
      return inspeccionarHls(directos[0], headers).then(function (info) {
        if (!info.vivo) return null;
        return { url: directos[0], quality: info.calidad, headers: headers, host: "Voe" };
      });
    }
    var dec = descifrarVoe(json[1]);
    if (!dec) return Promise.resolve(null);
    var url = dec.source || dec.direct_access_url;
    if (!url) return Promise.resolve(null);
    var clave = dec.file_code ? "voe:" + dec.file_code : null;
    return inspeccionarHls(url, headers).then(function (info) {
      if (!info.vivo) {
        console.log("[SeriesFlixHD] voe sin fichero vivo: " + url.substring(0, 70));
        return null;
      }
      return { url: url, quality: info.calidad, headers: headers, host: "Voe", clave: clave };
    });
  };
  return fetchText(embedUrl, headers)
    .then(function (html) {
      if (/permanentToken/i.test(html)) {
        var m = html.match(/window\.location\.href\s*=\s*'([^']+)'/i);
        if (m) {
          var destino = m[1];
          console.log("[SeriesFlixHD] voe redirect -> " + destino.substring(0, 80));
          return fetchText(destino, uaHeaders({ Referer: embedUrl })).then(analizar);
        }
      }
      return analizar(html);
    })
    .catch(function (e) {
      console.log("[SeriesFlixHD] voe error: " + e.message);
      return null;
    });
}

function resolverNupload(url) {
  var host = (url.match(/^https?:\/\/[^\/]+/) || ["https://nupload.my"])[0];
  var headers = uaHeaders({ Referer: host + "/" });
  return fetchText(url, headers)
    .then(function (html) {
      // Variante actual: la pagina solo envuelve un iframe de voe
      var iframe = html.match(/<iframe[^>]+src=["']([^"']*(?:voe\.sx|jamesbornmain\.com)[^"']*)["']/i);
      if (iframe) {
        var voe = iframe[1].indexOf("//") === 0 ? "https:" + iframe[1] : iframe[1];
        console.log("[SeriesFlixHD] nupload -> iframe " + voe.substring(0, 70));
        return resolverVoe(voe);
      }
      // Variante clasica: array ofuscado + sesz -> sv4.ibra.lat/?s=<token>
      var f = html.match(/([A-Za-z]+)\.forEach\s*\(\s*function\s*\w*\s*\([^)]*\)\s*\{[^}]+atob/);
      if (!f) {
        console.log("[SeriesFlixHD] nupload sin patron conocido (" + html.length + " bytes)");
        return null;
      }
      var nombre = f[1];
      var off = html.match(new RegExp(nombre + "\\.forEach[^-]+-\\s*(\\d+)"));
      var arr = html.match(new RegExp("var\\s+" + nombre + "\\s*=\\s*(\\[[^\\]]+\\])"));
      var sesz = html.match(/var sesz\s*=\s*"([^"]+)"/);
      if (!off || !arr || !sesz) return null;
      var offset = parseInt(off[1], 10);
      var valores;
      try {
        valores = JSON.parse(arr[1]);
      } catch (e) {
        return null;
      }
      var construida = "";
      valores.forEach(function (v) {
        var digitos = atob(v).replace(/\D/g, "");
        if (digitos) construida += String.fromCharCode(parseInt(digitos, 10) - offset);
      });
      if (construida.indexOf("http") !== 0) return null;
      var final = construida + "?s=" + sesz[1];
      return fetch(final, { headers: headers, redirect: "follow" })
        .then(function (res) {
          var real = res && res.url ? res.url : final;
          var url = /\.m3u8/.test(real) ? real : final;
          return inspeccionarHls(url, headers).then(function (info) {
            if (!info.vivo) {
              console.log("[SeriesFlixHD] nupload sin fichero vivo: " + url.substring(0, 70));
              return null;
            }
            return { url: url, quality: info.calidad, headers: headers, host: "Nupload" };
          });
        })
        .catch(function () {
          return null;
        });
    })
    .catch(function (e) {
      console.log("[SeriesFlixHD] nupload error: " + e.message);
      return null;
    });
}

function resolverEmbed(embedUrl) {
  try {
    if (/nupload\.(my|me)\/iframe\/\?url=/i.test(embedUrl)) {
      var interno = dec(embedUrl.split("url=")[1] || "");
      if (interno.indexOf("//") === 0) interno = "https:" + interno;
      if (!interno || interno.indexOf("http") !== 0) return Promise.resolve(null);
      return resolverVoe(interno);
    }
    if (/voe\.sx\/e\//i.test(embedUrl) || /jamesbornmain\.com\/e\//i.test(embedUrl)) return resolverVoe(embedUrl);
    if (/nupload\.(my|me)\/watch\//i.test(embedUrl)) return resolverNupload(embedUrl);
  } catch (e) {
    console.log("[SeriesFlixHD] embed raro: " + e.message);
  }
  return Promise.resolve(null);
}

function streamsDeIdioma(links, idioma) {
  var lote = links.slice(0, MAX_EMBEDS_POR_IDIOMA);
  return Promise.allSettled(lote.map(resolverEmbed)).then(function (res) {
    var out = [];
    var vistos = {};
    for (var i = 0; i < res.length; i++) {
      if (!res[i] || res[i].status !== "fulfilled" || !res[i].value) continue;
      var v = res[i].value;
      if (!v.url) continue;
      var clave = v.clave || v.url;
      if (vistos[clave]) continue;
      vistos[clave] = true;
      out.push({
        name: "SeriesFlixHD",
        title: (v.quality || "HD") + " \u00B7 " + idioma + " \u00B7 " + (v.host || "Embed"),
        language: idioma,
        quality: v.quality || "HD",
        url: v.url,
        headers: v.headers,
      });
    }
    return out;
  });
}

// ── API ─────────────────────────────────────────────────────────────────────
function getStreams(tmdbId, mediaType, season, episode) {
  var tipo = String(mediaType || "").toLowerCase();
  if (tipo === "series" || tipo === "anime") tipo = "tv";
  if (!tmdbId || tipo !== "tv") return Promise.resolve([]);

  var s = parseInt(season, 10);
  var e = parseInt(episode, 10);
  if (!s || !e) return Promise.resolve([]);

  var t0 = Date.now();
  var fin = limit();
  console.log("[SeriesFlixHD] Buscando: TMDB " + tmdbId + " S" + s + "E" + e);

  return infoTmdb(tmdbId)
    .then(function (info) {
      if (!info) return [];
      var titulos = [];
      [info.title, info.originalTitle, info.titleEs].forEach(function (t) {
        if (t && titulos.indexOf(t) < 0) titulos.push(t);
      });
      var slugSerie = null;
      var busqueda = titulos.length
        ? titleBuscar(titulos, fin)
        : Promise.resolve(null);
      return busqueda.then(function (slug) {
        slugSerie = slug;
        if (slug && Date.now() < fin) {
          return episodioEnTemporada(slug, s, e).then(function (directo) {
            if (!directo) return null;
            return cargarEpisodio(directo).then(function (pagina) {
              if (pagina && pagina.html) return pagina;
              return resolverEpisodio(titulos, slugSerie, s, e, fin);
            });
          });
        }
        return resolverEpisodio(titulos, slugSerie, s, e, fin);
      });
    })
    .then(function (pagina) {
      if (!pagina || !pagina.html) {
        console.log("[SeriesFlixHD] sin pagina de episodio");
        return [];
      }
      var sec = parsearSecciones(pagina.html);
      console.log("[SeriesFlixHD] idiomas: " + sec.orden.map(function (k) { return k + "=" + sec.mapa[k].length; }).join(" "));
      if (!sec.orden.length) return [];

      var orden = [];
      for (var i = 0; i < IDIOMAS.length; i++) if (sec.mapa[IDIOMAS[i]]) orden.push(IDIOMAS[i]);
      for (var j = 0; j < sec.orden.length; j++) if (orden.indexOf(sec.orden[j]) < 0) orden.push(sec.orden[j]);

      var acumulado = [];
      var i2 = 0;
      var paso = function () {
        if (i2 >= orden.length) return Promise.resolve(acumulado);
        var idioma = orden[i2++];
        if (!sec.mapa[idioma] || !sec.mapa[idioma].length) return paso();
        return streamsDeIdioma(sec.mapa[idioma], idioma).then(function (streams) {
          if (streams.length) {
            for (var k = 0; k < streams.length; k++) acumulado.push(streams[k]);
            return acumulado;
          }
          return paso();
        });
      };
      return paso();
    })
    .then(function (streams) {
      var seg = ((Date.now() - t0) / 1000).toFixed(2);
      console.log("[SeriesFlixHD] \u2713 " + streams.length + " streams en " + seg + "s");
      return streams;
    })
    .catch(function (err) {
      console.log("[SeriesFlixHD] Error: " + (err && err.message ? err.message : err));
      return [];
    });
}

function titleBuscar(titulos, fin) {
  var i = 0;
  var encontrado = null;
  var paso = function () {
    if (encontrado || i >= titulos.length || i >= 2 || Date.now() > fin) return Promise.resolve(encontrado);
    var titulo = titulos[i++];
    return buscarTitulo(titulo).then(function (candidatos) {
      var elegida = elegirSerie(candidatos, titulos);
      if (elegida) encontrado = elegida.slug;
      return encontrado ? encontrado : paso();
    });
  };
  return paso();
}

module.exports = { getStreams: getStreams };
