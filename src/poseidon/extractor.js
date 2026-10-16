// Poseidon — src/poseidon/extractor.js
//
// Flujo: TMDB (3 idiomas) -> slug -> pagina /pelicula/ o /serie/ ->
// __NEXT_DATA__.props.pageProps -> videos -> player.php -> URL del cyberlocker
// -> resolvers compartidos (filemoon/mixdrop/mp4upload/filelions/ok.ru/etc.)
// -> SOLO video directo mp4/m3u8.
//
// v1.0.3: antes se devolvian las paginas HTML de los cyberlockers tal cual
// (streamwish.to/e/...); la validacion estricta v2 las descarta todas porque
// exigen video real (video/*, mpegurl o extension de video). Ahora cada
// cyberlocker se resuelve a su stream directo con getEmbedResolver y solo
// sobreviven enlaces de video. Se elimino el mapeo de dominios viejo
// (DOMAIN_MAP/replaceDomain): los resolvers ya apuntan a los espejos vivos.

import { fetchText } from '../shared/http.js';
import { getEmbedResolver, getServerLabel } from '../shared/embedResolvers.js';

var TMDB_KEY = 'a2d9bbed370d9f678e34006f8750a5a5';
var TMDB_BASE = 'https://api.themoviedb.org/3';
var BASE = 'https://www.poseidonhd2.co';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Claves de idioma del JSON -> etiqueta del contrato JS.
var LANG_MAP = [
  ['latino', 'Latino'],
  ['spanish', 'Espanol'],
  ['english', 'Subtitulado'],
  ['japanese', 'Subtitulado'],
];

// Hosts de cyberlockers que ya no resuelven -> espejos vivos del mismo
// servicio (verificado 2026-10-07: streamwish.to/e/ muere pero
// hgplaycdn.com/e/ sirve el mismo video). Se aplica ANTES de pasar la URL al
// resolver compartido; solo cambia el host, conserva esquema y ruta.
var MIRRORS = {
  'streamwish.to': 'hgplaycdn.com',
  'vidhidepro.com': 'callistanise.com',
  'filelions.to': 'callistanise.com',
};

function mirrorHost(url) {
  var out = String(url == null ? '' : url);
  for (var from in MIRRORS) {
    if (!Object.prototype.hasOwnProperty.call(MIRRORS, from)) continue;
    var re = new RegExp('(https?://)([^/]*\\.)?' + from.replace(/\./g, '\\.') + '(?=[/:]|$)', 'i');
    if (re.test(out)) {
      out = out.replace(re, function (m, esquema) { return esquema + MIRRORS[from]; });
      break;
    }
  }
  return out;
}

function origen(url) {
  var m = String(url || '').match(/^(https?:\/\/[^\/]+)/i);
  return m ? m[1] : '';
}

function absolutizar(base, u) {
  var s = String(u == null ? '' : u).trim();
  if (!s) return '';
  if (s.indexOf('//') === 0) return 'https:' + s;
  if (/^https?:\/\//i.test(s)) return s;
  if (s.charAt(0) === '/') return origen(base) + s;
  return base.replace(/\/+$/, '') + '/' + s;
}

/** _slugify: minusculas, sin acentos, todo lo que no sea a-z0-9 a guiones. */
function slugify(title) {
  var s = String(title == null ? '' : title).trim().toLowerCase();
  var acc = {
    'á': 'a', 'à': 'a', 'ä': 'a', 'â': 'a', 'ã': 'a',
    'é': 'e', 'è': 'e', 'ë': 'e', 'ê': 'e',
    'í': 'i', 'ì': 'i', 'ï': 'i', 'î': 'i',
    'ó': 'o', 'ò': 'o', 'ö': 'o', 'ô': 'o', 'õ': 'o',
    'ú': 'u', 'ù': 'u', 'ü': 'u', 'û': 'u',
    'ñ': 'n', 'ç': 'c',
  };
  for (var k in acc) {
    if (Object.prototype.hasOwnProperty.call(acc, k)) s = s.split(k).join(acc[k]);
  }
  s = s.replace(/[^a-z0-9\s-]/g, '');
  s = s.replace(/[\s-]+/g, '-');
  return s.replace(/^-+|-+$/g, '');
}

// ─── TMDB (para los slugs candidatos) ─────────────────────────────────────

function tmdbLang(tmdbId, mediaType, lang) {
  var endpoint = mediaType === 'movie' ? 'movie' : 'tv';
  var url = TMDB_BASE + '/' + endpoint + '/' + tmdbId + '?api_key=' + TMDB_KEY + '&language=' + lang;
  return fetchText(url, { headers: { 'Accept': 'application/json', 'User-Agent': UA } }, 12000)
    .then(function (t) {
      try {
        var d = JSON.parse(t);
        if (!d || typeof d !== 'object' || d.success === false) return null;
        return d;
      } catch (e) { return null; }
    })
    .catch(function () { return null; });
}

function yearDe(dateStr) {
  if (dateStr && String(dateStr).length >= 4) {
    var y = parseInt(String(dateStr).slice(0, 4), 10);
    if (!isNaN(y)) return y;
  }
  return null;
}

function getTmdbInfo(tmdbId, mediaType) {
  return Promise.all([
    tmdbLang(tmdbId, mediaType, 'es-MX'),
    tmdbLang(tmdbId, mediaType, 'es-ES'),
    tmdbLang(tmdbId, mediaType, 'en-US'),
  ]).then(function (arr) {
    var es = arr[0], eses = arr[1], en = arr[2];
    var esPeli = mediaType === 'movie';
    var pick = function (d) {
      if (!d) return '';
      var a = esPeli ? d.title : d.name;
      return a == null ? '' : String(a);
    };
    var dateEs = es ? (esPeli ? es.release_date : es.first_air_date) : null;
    var dateEn = en ? (esPeli ? en.release_date : en.first_air_date) : null;
    return {
      id: tmdbId,
      latino: pick(es),
      castellano: pick(eses),
      ingles: pick(en),
      year: yearDe(dateEs || dateEn),
    };
  });
}

// ─── candidatos de URL ────────────────────────────────────────────────────

/** Pelicula: /pelicula/{tmdbId}/{slug} (+ variante con el anio). */
function buildMovieCandidates(t) {
  var titles = [t.latino, t.castellano, t.ingles];
  var out = [], seen = {};
  for (var i = 0; i < titles.length; i++) {
    if (!titles[i] || !String(titles[i]).trim()) continue;
    var slug = slugify(titles[i]);
    if (!slug) continue;
    var urls = [BASE + '/pelicula/' + t.id + '/' + slug];
    if (t.year != null) urls.push(BASE + '/pelicula/' + t.id + '/' + slug + '-' + t.year);
    for (var j = 0; j < urls.length; j++) {
      if (!seen[urls[j]]) { seen[urls[j]] = 1; out.push(urls[j]); }
    }
  }
  return out;
}

/** Serie: /serie/{tmdbId}/{slug}/temporada/{s}/episodio/{e}. */
function buildEpisodeCandidates(t, season, episode) {
  var titles = [t.latino, t.castellano, t.ingles];
  var out = [], seen = {};
  for (var i = 0; i < titles.length; i++) {
    if (!titles[i] || !String(titles[i]).trim()) continue;
    var slug = slugify(titles[i]);
    if (!slug) continue;
    var u = BASE + '/serie/' + t.id + '/' + slug + '/temporada/' + season + '/episodio/' + episode;
    if (!seen[u]) { seen[u] = 1; out.push(u); }
  }
  return out;
}

/** _findWorkingUrl: primer candidato que sirve __NEXT_DATA__ con la clave util. */
function findWorkingUrl(candidates, isMovie) {
  var needle = isMovie ? '"thisMovie"' : '"episode"';
  var headers = { 'Referer': BASE + '/' };
  var i = 0;
  function next() {
    if (i >= candidates.length) return Promise.resolve(null);
    var url = candidates[i++];
    return fetchText(url, { headers: headers }, 12000).then(function (html) {
      if (html && html.indexOf('__NEXT_DATA__') >= 0 && html.indexOf(needle) >= 0) {
        return { url: url, html: html };
      }
      return next();
    }).catch(function () { return next(); });
  }
  return next();
}

// ─── parseo de __NEXT_DATA__ ──────────────────────────────────────────────

function extractNextData(html) {
  var m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return null;
  try {
    var data = JSON.parse(m[1]);
    var pageProps = data && data.props && data.props.pageProps;
    return pageProps && typeof pageProps === 'object' ? pageProps : null;
  } catch (e) { return null; }
}

/** Genera [{language, videos:[{cyberlocker,url,quality}]}] como _getVideoGroupsFromData. */
function videoGroupsFromData(videos) {
  var groups = [];
  for (var i = 0; i < LANG_MAP.length; i++) {
    var key = LANG_MAP[i][0], label = LANG_MAP[i][1];
    var listRaw = videos[key];
    if (!Array.isArray(listRaw) || !listRaw.length) continue;
    var videosList = [];
    for (var j = 0; j < listRaw.length; j++) {
      var v = listRaw[j];
      if (!v || typeof v !== 'object') continue;
      var url = v.result == null ? '' : String(v.result);
      if (!url) continue;
      videosList.push({
        cyberlocker: v.cyberlocker == null ? '' : String(v.cyberlocker),
        url: url,
        quality: v.quality == null ? 'HD' : String(v.quality),
      });
    }
    if (videosList.length) groups.push({ language: label, videos: videosList });
  }
  return groups;
}

// ─── player.php -> URL del cyberlocker -> stream directo ──────────────────

/** Saca la URL del cyberlocker desde el HTML de player.php. */
function extractCyberlockerUrl(playerHtml, playerUrl) {
  if (!playerHtml) return '';
  var m = playerHtml.match(/var\s+url\s*=\s*'([^']+)'/) ||
          playerHtml.match(/var\s+url\s*=\s*"([^"]+)"/) ||
          playerHtml.match(/window\.location\.href\s*=\s*'([^']+)'/) ||
          playerHtml.match(/(?:file|src|source)\s*[:=]\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i);
  if (!m) return '';
  return absolutizar(playerUrl, m[1]);
}

function esVideoDirecto(url) {
  return /\.(mp4|m3u8|mkv|webm|ts|m4v|mov)(\?|#|$)/i.test(url || '');
}

/**
 * Resuelve UN item de videos: player.php -> cyberlocker -> stream directo.
 * Devuelve {url, quality, headers} o null. Nunca lanza.
 */
function resolveOne(item) {
  return fetchText(item.url, { headers: { 'Referer': BASE + '/' } }, 12000)
    .then(function (html) {
      var cyberUrl = mirrorHost(extractCyberlockerUrl(html, item.url));
      if (!cyberUrl || !/^https?:\/\//i.test(cyberUrl)) return null;
      // Si player.php ya entrega video directo, no hay nada que resolver.
      if (esVideoDirecto(cyberUrl)) {
        return { url: cyberUrl, cyber: cyberUrl, quality: item.quality, headers: { 'Referer': BASE + '/', 'User-Agent': UA } };
      }
      var resolver = getEmbedResolver(cyberUrl);
      if (!resolver) return null;
      return resolver(cyberUrl).then(function (r) {
        if (!r || !r.url) return null;
        var q = r.quality && r.quality !== 'Unknown' ? r.quality : (item.quality || 'HD');
        return {
          url: r.url,
          cyber: cyberUrl,
          quality: q,
          headers: r.headers || { 'Referer': origen(cyberUrl) + '/' },
        };
      }).catch(function () { return null; });
    })
    .catch(function () { return null; });
}

/** Resuelve en paralelo con tope de concurrencia y fecha limite. */
function resolveAll(items, limit, deadline) {
  var out = new Array(items.length);
  var idx = 0, activos = 0, terminado = false;
  return new Promise(function (resolve) {
    function fin() {
      if (terminado) return;
      terminado = true;
      resolve(out);
    }
    function pump() {
      if (terminado) return;
      if (Date.now() > deadline) return fin();
      if (idx >= items.length && activos === 0) return fin();
      while (activos < limit && idx < items.length && Date.now() <= deadline) {
        (function (pos) {
          activos++;
          resolveOne(items[pos]).then(function (r) {
            out[pos] = r;
            activos--;
            pump();
          }).catch(function () {
            out[pos] = null;
            activos--;
            pump();
          });
        })(idx++);
      }
    }
    if (!items.length) return fin();
    pump();
  });
}

function bonito(name) {
  var s = String(name == null ? '' : name).trim();
  if (!s) return 'Servidor';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── flujo principal ──────────────────────────────────────────────────────

function extractStreams(tmdbId, mediaType, season, episode) {
  var id = parseInt(tmdbId, 10);
  if (!id || id <= 0) return Promise.resolve([]);
  var tipo = String(mediaType == null ? 'movie' : mediaType).toLowerCase();
  var mt = (tipo === 'tv' || tipo === 'series' || tipo === 'anime') ? 'tv' : 'movie';
  var esPelicula = mt !== 'tv';
  var s = parseInt(season, 10) || 1;
  var e = parseInt(episode, 10) || 1;

  return getTmdbInfo(id, mt).then(function (tmdb) {
    if (!tmdb || (!tmdb.latino && !tmdb.castellano && !tmdb.ingles)) return [];

    var candidatos = esPelicula
      ? buildMovieCandidates(tmdb)
      : buildEpisodeCandidates(tmdb, s, e);
    if (!candidatos.length) return [];

    return findWorkingUrl(candidatos, esPelicula).then(function (found) {
      if (!found) return [];

      var pageProps = extractNextData(found.html);
      if (!pageProps) return [];

      var ep = pageProps[esPelicula ? 'thisMovie' : 'episode'] || pageProps.thisEpisode;
      if (!ep || typeof ep !== 'object') return [];

      var groups = videoGroupsFromData(ep.videos || {});
      if (!groups.length) return [];

      var pendientes = [];
      for (var i = 0; i < groups.length; i++) {
        var g = groups[i];
        for (var j = 0; j < g.videos.length; j++) {
          pendientes.push({
            language: g.language,
            cyberlocker: g.videos[j].cyberlocker,
            quality: g.videos[j].quality,
            url: g.videos[j].url,
          });
        }
      }

      // 32s para la fase de resolucion; el resto del presupuesto queda para la
      // validacion de enlaces en vivo que hace el motor.
      return resolveAll(pendientes, 4, Date.now() + 32000).then(function (resueltas) {
        var streams = [], seen = {};
        for (var i = 0; i < pendientes.length; i++) {
          var r = resueltas[i];
          if (!r || !r.url || seen[r.url]) continue;
          seen[r.url] = 1;
          var p = pendientes[i];
          var label = getServerLabel(r.cyber || '') !== 'Online' ? getServerLabel(r.cyber || '') : bonito(p.cyberlocker);
          streams.push({
            title: 'Poseidon · ' + label,
            quality: r.quality || 'HD',
            language: p.language,
            url: r.url,
            headers: r.headers,
          });
        }
        return streams;
      });
    });
  });
}

export { extractStreams };
