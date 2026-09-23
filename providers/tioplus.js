// TioPlus — puerto a JS de lib/data/extractors/providers/tioplus_extractor.dart
// (el TioplusService Dart del repo del proyecto) al formato que ejecuta el motor
// de MasterScrap: CommonJS `module.exports = { getStreams }`, solo fetch + RegExp.
//
// Flujo del original, tal cual:
//   1) datos de TMDb en es-MX / es-ES / en-US (títulos + año)
//   2) candidatos por slug: /pelicula/<slug> o /serie|anime/<slug>/season/S/episode/E
//   3) si nada sirve, fallback /api/search/<query>
//   4) en TV, último intento forzando /anime/<slug>/season/S/episode/E
//   5) la página buena se reconoce porque trae `data-server=` y `subselect`
//   6) <li data-server="..."> <span>Nombre</span>  →  /player/<base64(data-server)>
//   7) del HTML del player se saca `window.location.href = '<embed>'`
//   8) vidhideplus.com → callistanise.com (mismo host map que el PHP/Dart)
//
// Nota: el Dart usa base64Encode(); aquí se codifica a mano (UTF-8 → base64) para
// no depender de Buffer ni de crypto.
const TMDB_API_KEY = 'a2d9bbed370d9f678e34006f8750a5a5';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const TIOPLUS_BASE = 'https://tioplus.app';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const FETCH_TIMEOUT = 15000; // igual que el .timeout(Duration(seconds: 15)) del Dart
const DEADLINE_MS = 45000; // presupuesto total: el motor corta a los 40-45s

var DEADLINE = 0;

function restante() {
  if (!DEADLINE) return FETCH_TIMEOUT;
  return Math.max(600, Math.min(FETCH_TIMEOUT, DEADLINE - Date.now()));
}

function agotado() {
  return DEADLINE > 0 && Date.now() > DEADLINE;
}

/** GET que devuelve texto o null (nunca lanza): mismo `_fetchPage` del Dart. */
function fetchText(url, headers, timeoutMs) {
  if (agotado()) return Promise.resolve(null);
  var opts = {
    headers: Object.assign(
      {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-MX,es-ES,es;q=0.9,en;q=0.8',
      },
      headers || {}
    ),
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
      }, timeoutMs || restante());
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
      // El Dart acepta 2xx y 3xx (http.Client sigue redirects).
      if (res && res.status >= 200 && res.status < 400) return res.text();
      return null;
    })
    .catch(function () {
      limpiar();
      return null;
    });
}

function tryJson(raw) {
  try {
    var d = JSON.parse(raw);
    return d && typeof d === 'object' ? d : null;
  } catch (e) {
    return null;
  }
}

// ─── TMDB (igual patrón que Cinecalidad) ─────────────────────────────────

var TMDB_LANGS = [
  ['latino', 'es-MX'],
  ['castellano', 'es-ES'],
  ['ingles', 'en-US'],
];

function getTmdbData(tmdbId, type) {
  var data = { titles: {}, year: null };
  var path = type === 'tv' ? '/tv/' + tmdbId : '/movie/' + tmdbId;
  var cadena = Promise.resolve();
  TMDB_LANGS.forEach(function (par) {
    cadena = cadena.then(function () {
      if (agotado()) return null;
      var url = TMDB_BASE + path + '?api_key=' + TMDB_API_KEY + '&language=' + par[1];
      return fetchText(url, null, 10000).then(function (raw) {
        if (!raw) return null;
        var movie = tryJson(raw);
        if (!movie || movie.success === false) return null;
        var title = String(movie.title != null ? movie.title : movie.name != null ? movie.name : '');
        if (title) data.titles[par[0]] = title;
        if (data.year == null) {
          var release = movie.release_date != null ? String(movie.release_date) : movie.first_air_date != null ? String(movie.first_air_date) : null;
          if (release && release.length >= 4) {
            var y = parseInt(release.substring(0, 4), 10);
            if (!isNaN(y)) data.year = y;
          }
        }
        return null;
      });
    });
  });
  return cadena.then(function () {
    return data;
  });
}

// ─── Slugify (mismo mapa de acentos que el Dart) ─────────────────────────

var SLUG_MAP = {
  'Š': 'S', 'š': 's', 'Ž': 'Z', 'ž': 'z', 'À': 'A', 'Á': 'A', 'Â': 'A',
  'Ã': 'A', 'Ä': 'A', 'Å': 'A', 'Æ': 'A', 'Ç': 'C', 'È': 'E', 'É': 'E',
  'Ê': 'E', 'Ë': 'E', 'Ì': 'I', 'Í': 'I', 'Î': 'I', 'Ï': 'I', 'Ñ': 'N',
  'Ò': 'O', 'Ó': 'O', 'Ô': 'O', 'Õ': 'O', 'Ö': 'O', 'Ø': 'O', 'Ù': 'U',
  'Ú': 'U', 'Û': 'U', 'Ü': 'U', 'Ý': 'Y', 'Þ': 'B', 'ß': 'ss', 'à': 'a',
  'á': 'a', 'â': 'a', 'ã': 'a', 'ä': 'a', 'å': 'a', 'æ': 'a', 'ç': 'c',
  'è': 'e', 'é': 'e', 'ê': 'e', 'ë': 'e', 'ì': 'i', 'í': 'i', 'î': 'i',
  'ï': 'i', 'ð': 'o', 'ñ': 'n', 'ò': 'o', 'ó': 'o', 'ô': 'o', 'õ': 'o',
  'ö': 'o', 'ø': 'o', 'ù': 'u', 'ú': 'u', 'û': 'u', 'ý': 'y', 'þ': 'b',
  'ÿ': 'y', 'Ŕ': 'R', 'ŕ': 'r',
};

function slugify(title) {
  var s = String(title || '');
  for (var k in SLUG_MAP) {
    if (Object.prototype.hasOwnProperty.call(SLUG_MAP, k)) {
      s = s.split(k).join(SLUG_MAP[k]);
    }
  }
  s = s.toLowerCase().replace(/[^a-z0-9\s-]/g, '');
  s = s.replace(/\s+/g, '-');
  return s.replace(/^-+|-+$/g, '');
}

function decodeHtml(s) {
  return String(s || '')
    .split('&amp;').join('&')
    .split('&lt;').join('<')
    .split('&gt;').join('>')
    .split('&quot;').join('"')
    .split('&#39;').join("'")
    .split('&apos;').join("'");
}

// ─── Candidatos de URL ──────────────────────────────────────────────────

function generateCandidates(titles, year, isMovie, season, episode) {
  var slugs = [];
  var vistos = {};
  function push(s) {
    if (s && !vistos[s]) {
      vistos[s] = true;
      slugs.push(s);
    }
  }
  var valores = [];
  for (var lk in titles) {
    if (Object.prototype.hasOwnProperty.call(titles, lk) && titles[lk]) valores.push(titles[lk]);
  }
  for (var i = 0; i < valores.length; i++) {
    var title = valores[i];
    var s = slugify(title);
    if (!s) continue;
    push(s);
    // sin artículo inicial (el/la/los/las/the/a/an)
    var noArt = title.replace(/^(el|la|los|las|the|a|an)\s+/i, '');
    if (noArt !== title) {
      var s2 = slugify(noArt);
      if (s2) push(s2);
    }
    if (year != null) push(s + '-' + year);
  }

  var candidates = [];
  if (isMovie) {
    for (var p = 0; p < slugs.length; p++) {
      candidates.push({ kind: 'pelicula', slug: slugs[p], url: TIOPLUS_BASE + '/pelicula/' + slugs[p] });
    }
  } else {
    var kinds = ['serie', 'anime'];
    for (var k = 0; k < kinds.length; k++) {
      for (var q = 0; q < slugs.length; q++) {
        candidates.push({
          kind: kinds[k],
          slug: slugs[q],
          url: TIOPLUS_BASE + '/' + kinds[k] + '/' + slugs[q] + '/season/' + season + '/episode/' + episode,
        });
      }
    }
  }
  return candidates;
}

// ─── Búsqueda TioPlus (fallback) ────────────────────────────────────────

function searchTioplus(titles, year, isMovie, season, episode) {
  var queries = [];
  var vq = {};
  function add(q) {
    if (q && !vq[q]) {
      vq[q] = true;
      queries.push(q);
    }
  }
  for (var lk in titles) {
    if (Object.prototype.hasOwnProperty.call(titles, lk)) add(titles[lk]);
  }
  if (year != null) {
    for (var lk2 in titles) {
      if (Object.prototype.hasOwnProperty.call(titles, lk2)) add(titles[lk2] + ' ' + year);
    }
  }

  var found = {};
  var orden = [];
  var re = /href=["'](https?:\/\/tioplus\.app\/(pelicula|serie|anime)\/([^"'/?#]+))["']/gi;

  var cadena = Promise.resolve();
  queries.forEach(function (q) {
    cadena = cadena.then(function () {
      if (orden.length || agotado()) return null;
      var url = TIOPLUS_BASE + '/api/search/' + encodeURIComponent(q);
      return fetchText(url).then(function (html) {
        if (!html || html.indexOf('No hay resultados') >= 0) return null;
        var m;
        re.lastIndex = 0;
        while ((m = re.exec(html)) !== null) {
          var kind = String(m[2] || '').toLowerCase();
          var slug = m[3] || '';
          if (!slug) continue;
          if (isMovie && kind !== 'pelicula') continue;
          if (!isMovie && kind !== 'serie' && kind !== 'anime') continue;
          var u = m[1];
          if (kind !== 'pelicula') u = u + '/season/' + season + '/episode/' + episode;
          var key = kind + '|' + slug;
          if (!found[key]) {
            found[key] = { kind: kind, slug: slug, url: u };
            orden.push(key);
          }
        }
        return null;
      });
    });
  });

  return cadena.then(function () {
    var peso = { pelicula: 0, serie: 1, anime: 2 };
    var list = orden.map(function (k) {
      return found[k];
    });
    list.sort(function (a, b) {
      var pa = peso[a.kind] == null ? 9 : peso[a.kind];
      var pb = peso[b.kind] == null ? 9 : peso[b.kind];
      return pa - pb;
    });
    return list;
  });
}

// ─── Extracción data-server → /player/ → embed ──────────────────────────

function hasServers(html) {
  return !!html && html.indexOf('data-server=') >= 0 && html.indexOf('subselect') >= 0;
}

/** base64(utf8(str)) sin Buffer: el Dart hace base64Encode(utf8.encode(x)). */
function base64EncodeUtf8(str) {
  var s = String(str || '');
  var bytes = [];
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c < 0x80) {
      bytes.push(c);
    } else if (c < 0x800) {
      bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      var c2 = s.charCodeAt(i + 1);
      if (c2 >= 0xdc00 && c2 <= 0xdfff) {
        var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        i++;
        bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
      } else {
        bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      }
    } else {
      bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  var CH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var out = '';
  for (var b = 0; b < bytes.length; b += 3) {
    var b0 = bytes[b];
    var b1 = b + 1 < bytes.length ? bytes[b + 1] : null;
    var b2 = b + 2 < bytes.length ? bytes[b + 2] : null;
    out += CH.charAt(b0 >> 2);
    out += CH.charAt(((b0 & 3) << 4) | (b1 == null ? 0 : b1 >> 4));
    out += b1 == null ? '=' : CH.charAt(((b1 & 15) << 2) | (b2 == null ? 0 : b2 >> 6));
    out += b2 == null ? '=' : CH.charAt(b2 & 63);
  }
  return out;
}

function extractRedirect(playerHtml) {
  var m1 = String(playerHtml || '').match(/window\.location\.href\s*=\s*['"]([^'"]+)['"]/);
  if (m1) return m1[1];
  var m2 = String(playerHtml || '').match(/location\.href\s*=\s*['"]([^'"]+)['"]/);
  return m2 ? m2[1] : null;
}

/** vidhideplus.com → callistanise.com (mismo _kHostMap del Dart). */
function applyHostMap(url) {
  return String(url || '').replace(
    /^(https?:\/\/)vidhideplus\.com(:[0-9]+)?(?=\/|$)/i,
    function (todo, proto, puerto) {
      return proto + 'callistanise.com' + (puerto || '');
    }
  );
}

function resolveEmbeds(html, referer) {
  var result = [];
  var re = /<li[^>]*data-server=["']([^"']+)["'][^>]*>[\s\S]*?<span>([^<]+)<\/span>/gi;
  var m;
  var pendientes = [];
  while ((m = re.exec(html)) !== null) {
    var dataServer = String(m[1] || '').trim();
    var name = decodeHtml(String(m[2] || '').trim());
    if (!dataServer || !name) continue;
    pendientes.push({ dataServer: dataServer, name: name });
  }

  var cadena = Promise.resolve();
  pendientes.forEach(function (item) {
    cadena = cadena.then(function () {
      if (agotado()) return null;
      var playerUrl = TIOPLUS_BASE + '/player/' + base64EncodeUtf8(item.dataServer);
      return fetchText(playerUrl, { Referer: referer, Accept: 'text/html' }).then(function (playerHtml) {
        if (!playerHtml) return null;
        var embed = extractRedirect(playerHtml);
        if (!embed) return null;
        result.push({ name: item.name, embedUrl: applyHostMap(embed) });
        return null;
      });
    });
  });

  return cadena.then(function () {
    return result;
  });
}

// ─── Idioma ─────────────────────────────────────────────────────────────

function guessIdioma(serverName) {
  var n = String(serverName || '').toLowerCase();
  if (n.indexOf('castellano') >= 0 || (n.indexOf('español') >= 0 && n.indexOf('es') >= 0)) return 'es_ES';
  if (n.indexOf('latino') >= 0 || n.indexOf('lat') >= 0) return 'es_MX';
  if (n.indexOf('sub') >= 0 || n.indexOf('english') >= 0 || n.indexOf('inglés') >= 0) return 'en_US';
  return 'es_MX'; // TioPlus en español latino por defecto
}

/** es_MX / es_ES / en_US → etiqueta legible (igual que unlimplay.js). */
function idiomaLabel(code) {
  if (code === 'es_ES') return 'Español';
  if (code === 'en_US') return 'Subtitulado';
  return 'Latino';
}

// ─── Runner ─────────────────────────────────────────────────────────────

function run(tmdbId, mediaType, season, episode) {
  var tipo = String(mediaType || 'movie').toLowerCase();
  var isMovie = tipo !== 'tv' && tipo !== 'series' && tipo !== 'anime';
  var s = parseInt(season, 10);
  var e = parseInt(episode, 10);
  if (isNaN(s) || s < 1) s = 1;
  if (isNaN(e) || e < 1) e = 1;

  return getTmdbData(tmdbId, isMovie ? 'movie' : 'tv').then(function (tmdbData) {
    var valores = [];
    for (var lk in tmdbData.titles) {
      if (Object.prototype.hasOwnProperty.call(tmdbData.titles, lk)) valores.push(tmdbData.titles[lk]);
    }
    if (!valores.length) return [];

    var candidates = generateCandidates(tmdbData.titles, tmdbData.year, isMovie, s, e);
    var foundHtml = null;
    var foundUrl = null;
    var foundKind = null;

    function probar(lista) {
      var cadena = Promise.resolve(false);
      lista.forEach(function (c) {
        cadena = cadena.then(function (ok) {
          if (ok || agotado()) return ok;
          return fetchText(c.url).then(function (html) {
            if (html && hasServers(html)) {
              foundHtml = html;
              foundUrl = c.url;
              foundKind = c.kind;
              return true;
            }
            return false;
          });
        });
      });
      return cadena;
    }

    return probar(candidates)
      .then(function (ok) {
        if (ok) return null;
        return searchTioplus(tmdbData.titles, tmdbData.year, isMovie, s, e).then(function (fromSearch) {
          return probar(fromSearch);
        });
      })
      .then(function (ok) {
        if (ok || isMovie) return null;
        // 3) TV: si serie falló, forzar anime con los mismos slugs
        var lista = [];
        for (var lk in tmdbData.titles) {
          if (!Object.prototype.hasOwnProperty.call(tmdbData.titles, lk)) continue;
          var slug = slugify(tmdbData.titles[lk]);
          if (!slug) continue;
          lista.push({
            kind: 'anime',
            slug: slug,
            url: TIOPLUS_BASE + '/anime/' + slug + '/season/' + s + '/episode/' + e,
          });
        }
        return probar(lista);
      })
      .then(function () {
        if (!foundHtml || !foundUrl) return [];
        return resolveEmbeds(foundHtml, foundUrl).then(function (links) {
          var streams = [];
          for (var i = 0; i < links.length; i++) {
            streams.push({
              title: 'TioPlus · ' + links[i].name,
              quality: 'HD',
              language: idiomaLabel(guessIdioma(links[i].name, foundKind)),
              url: links[i].embedUrl,
              headers: { Referer: foundUrl, 'User-Agent': UA },
            });
          }
          return streams;
        });
      });
  });
}

function withTimeout(promise, ms) {
  if (typeof setTimeout === 'undefined') return promise;
  var timer = null;
  // El temporizador se limpia al ganar la carrera: si no, en Node el proceso
  // queda vivo hasta que dispare (y en el motor es un timer basura).
  return Promise.race([
    promise.then(function (v) {
      if (timer) {
        try {
          clearTimeout(timer);
        } catch (e) {}
        timer = null;
      }
      return v;
    }),
    new Promise(function (res) {
      timer = setTimeout(function () {
        timer = null;
        res([]);
      }, ms);
    }),
  ]);
}

function getStreams(tmdbId, mediaType, season, episode) {
  var id = parseInt(tmdbId, 10);
  if (isNaN(id) || id <= 0) return Promise.resolve([]);
  DEADLINE = Date.now() + DEADLINE_MS;
  return withTimeout(
    run(id, mediaType, season, episode).catch(function () {
      return [];
    }),
    DEADLINE_MS
  ).catch(function () {
    return [];
  });
}

module.exports = { getStreams };
