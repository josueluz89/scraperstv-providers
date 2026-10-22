// pelisplusto — provider para pelisplushd.bz (el mismo sitio que usa pelisplus;
// el dominio .to es otro espejo y NO se usa aquí: si un título no está en este,
// el provider devuelve []).
//
// Flujo:
//   1. TMDB: el título (original y localizado) y el año salen SOLO del id.
//   2. Búsqueda en el sitio y elección de la ficha por puntaje.
//   3. La ficha declara sus servidores: páginas cifradas de embed69
//      (/f/<id>/, ver ./embed69.js) y, en fichas viejas, enlaces
//      embed69.org/uqlink.php que desenvuelven a un host directo.
//   4. Cada servidor se resuelve a video DIRECTO; el que no se puede resolver
//      se entrega como embed con sus cabeceras y lo filtra la validación
//      final compartida (solo pasa video real).
//
// Presupuesto de tiempo, diseñado para este sitio (medido 2026-10-22): los
// hosts son lentos — páginas embed de 4–7 s habituales, picos de >20 s — y una
// película trae hasta 6 entradas en paralelo, así que un tope corto por fetch
// mata lecturas sanas. Cada etapa tiene el suyo y el total queda bajo el
// límite duro de Nuvio (<60 s), con el corte de 40 s del index:
//   TMDB 8 s · páginas del sitio 12 s · página embed69/uqlink 15 s ·
//   cada fetch al resolver un host 12 s (las entradas van en paralelo).

import { fetchText, fetchJson } from '../shared/http.js';
import { getEmbedResolver, mapDomain } from '../shared/embedResolvers.js';
import { decodeEmbed69Page, resolveHostStream, familyOf } from './embed69.js';

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------

var TMDB_API_KEY = '1f54bd990f1cdfb230adb312546d765d';
var SITE = 'https://pelisplushd.bz';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

var TMDB_MS = 8000;
var PAGE_MS = 12000;
var EMBED_MS = 15000;
var HOST_MS = 12000;

var EMBED69_ORIGIN = 'https://embed69.org';

// ---------------------------------------------------------------------------
// Utilidades de texto (sin String.normalize: QuickJS no trae ICU)
// ---------------------------------------------------------------------------

var ACCENTS = {
  'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u', 'ü': 'u', 'ñ': 'n',
  'Á': 'a', 'É': 'e', 'Í': 'i', 'Ó': 'o', 'Ú': 'u', 'Ü': 'u', 'Ñ': 'n',
  'à': 'a', 'è': 'e', 'ì': 'i', 'ò': 'o', 'ù': 'u',
  'â': 'a', 'ê': 'e', 'î': 'i', 'ô': 'o', 'û': 'u',
  'ä': 'a', 'ë': 'e', 'ï': 'i', 'ö': 'o', 'ç': 'c', 'ã': 'a', 'õ': 'o'
};

function stripAccents(s) {
  return (s || '').replace(/[^\x00-\x7F]/g, function(c) { return ACCENTS[c] || ''; });
}

function normalizeText(text) {
  if (!text) return '';
  return stripAccents(String(text).toLowerCase())
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Los títulos de las fichas vienen como "Ver Dune: Parte Dos (2024) Online…".
function cleanTitle(raw) {
  if (!raw) return '';
  return String(raw)
    .replace(/^ver\s+/i, '')
    .replace(/\s*\(\d{4}\)\s*/g, ' ')
    .split(' Online')[0]
    .split(' online')[0]
    .split(' (')[0]
    .replace(/\s+/g, ' ')
    .trim();
}

function originOf(url) {
  var m = String(url || '').match(/^(https?:\/\/[^\/]+)/i);
  return m ? m[1] : '';
}

// ---------------------------------------------------------------------------
// 1. TMDB: título y año desde el id (única fuente del título)
// ---------------------------------------------------------------------------

function resolveTitle(tmdbId, tmdbType) {
  var url = 'https://api.themoviedb.org/3/' + tmdbType + '/' + tmdbId +
    '?api_key=' + TMDB_API_KEY + '&language=es-MX';
  return fetchJson(url, null, TMDB_MS)
    .then(function(data) {
      if (!data) return null;
      var isMovie = tmdbType === 'movie';
      var date = isMovie ? data.release_date : data.first_air_date;
      return {
        title: isMovie ? data.title : data.name,
        originalTitle: isMovie ? data.original_title : data.original_name,
        year: date && date.length >= 4 ? date.slice(0, 4) : null
      };
    })
    .catch(function() { return null; });
}

// ---------------------------------------------------------------------------
// 2. Búsqueda en el sitio y elección de ficha
// ---------------------------------------------------------------------------

var KIND_MARKERS = ['/pelicula/', '/serie/', '/anime/'];

function parseSearchResults(html) {
  var candidates = [];
  var anchorRe = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  var m;
  while ((m = anchorRe.exec(html)) !== null) {
    var href = m[1];
    var inner = m[2];
    if (!href || href.indexOf('/temporada/') !== -1) continue;

    var marker = null;
    for (var i = 0; i < KIND_MARKERS.length; i++) {
      if (href.indexOf(KIND_MARKERS[i]) !== -1) { marker = KIND_MARKERS[i]; break; }
    }
    if (!marker) continue;

    var rest = href.slice(href.indexOf(marker) + marker.length);
    var slug = rest.split('/')[0].split('?')[0].split('#')[0];
    if (!slug) continue;
    if (marker === '/anime/') slug = 'anime/' + slug;

    var title = '';
    var dataTitle = m[0].match(/data-title="([^"]*)"/i);
    if (dataTitle) title = dataTitle[1];
    if (!title) {
      var alt = inner.match(/<img\b[^>]*alt="([^"]*)"/i);
      if (alt) title = alt[1];
    }
    if (!title) {
      var h = inner.match(/<(h2|p|span)\b[^>]*>([^<]*)<\/(h2|p|span)>/i);
      if (h) title = h[2];
    }
    title = cleanTitle(title.replace(/<[^>]*>/g, ''));
    if (!title) continue;

    candidates.push({ title: title, slug: slug, kind: marker === '/pelicula/' ? 'movie' : 'tv' });
  }
  var seen = {};
  return candidates.filter(function(c) {
    var k = c.kind + '|' + c.slug;
    if (seen[k]) return false;
    seen[k] = true;
    return true;
  });
}

function searchSite(query) {
  var url = SITE + '/search?s=' + encodeURIComponent(query);
  return fetchText(url, null, PAGE_MS)
    .then(parseSearchResults)
    .catch(function() { return []; });
}

// Busca con el título original y, si difiere, con el localizado; acumula.
function searchAll(media) {
  var queries = [];
  if (media.originalTitle) queries.push(media.originalTitle);
  if (media.title && media.title !== media.originalTitle) queries.push(media.title);
  var found = [];
  var chain = Promise.resolve();
  queries.forEach(function(q) {
    chain = chain.then(function() {
      return searchSite(q).then(function(c) { found = found.concat(c); });
    });
  });
  return chain.then(function() { return found; });
}

function uniqueWords(text) {
  var seen = {};
  return normalizeText(text).split(' ').filter(function(w) {
    if (!w || seen[w]) return false;
    seen[w] = true;
    return true;
  });
}

function scoreCandidate(candidate, media, expectedKind) {
  var nc = normalizeText(candidate.title);
  var no = normalizeText(media.originalTitle || '');
  var nt = normalizeText(media.title || '');
  var score = 0;

  if (nc && (nc === no || nc === nt)) {
    score = 100;
  } else if ((no && (nc.indexOf(no) !== -1 || no.indexOf(nc) !== -1)) ||
             (nt && (nc.indexOf(nt) !== -1 || nt.indexOf(nc) !== -1))) {
    score = 80;
  } else {
    var qWords = uniqueWords((media.originalTitle || '') + ' ' + (media.title || ''));
    var cWords = nc.split(' ').filter(Boolean);
    var inTitle = 0, inCandidate = 0, a, b;
    for (a = 0; a < qWords.length; a++) {
      if (nc.indexOf(qWords[a]) !== -1) inTitle++;
    }
    for (b = 0; b < cWords.length; b++) {
      if (qWords.indexOf(cWords[b]) !== -1) inCandidate++;
    }
    score = inTitle * 8 + inCandidate * 5;
  }

  if (media.year && candidate.title.indexOf(media.year) !== -1) score += 5;
  if (candidate.kind === expectedKind) score += 3;
  return score;
}

// Sin una ficha con puntaje mínimo no hay match: mejor [] que un título ajeno.
function pickMatch(candidates, media, expectedKind) {
  var best = null, bestScore = -1;
  for (var i = 0; i < candidates.length; i++) {
    var s = scoreCandidate(candidates[i], media, expectedKind);
    if (s > bestScore) { bestScore = s; best = candidates[i]; }
  }
  if (!best || bestScore < 15) return null;
  return best;
}

// ---------------------------------------------------------------------------
// 3. Servidores declarados en la ficha
// ---------------------------------------------------------------------------

function parseServers(html) {
  var byIndex = {};
  var videoRe = /video\[(\d+)\]\s*=\s*['"]([^'"]+)['"]/g;
  var vm;
  while ((vm = videoRe.exec(html)) !== null) {
    byIndex[parseInt(vm[1], 10)] = vm[2];
  }

  var labels = {};
  var liRe = /<li[^>]*data-id="(\d+)"[^>]*>([\s\S]*?)<\/li>/gi;
  var lm;
  while ((lm = liRe.exec(html)) !== null) {
    var label = lm[2].replace(/<[^>]*>/g, '').trim();
    if (label) labels[parseInt(lm[1], 10)] = label;
  }

  var servers = [];
  for (var idx in byIndex) {
    if (!Object.prototype.hasOwnProperty.call(byIndex, idx)) continue;
    var src = byIndex[idx];
    if (!src || src.indexOf('http') !== 0) continue;
    servers.push({ src: src, label: labels[idx] || ('Server ' + idx) });
  }

  if (servers.length === 0) {
    var iframeRe = /<iframe\b[^>]*src="([^"]+)"[^>]*>/gi;
    var im, n = 0;
    while ((im = iframeRe.exec(html)) !== null) {
      var isrc = im[1];
      if (isrc.indexOf('//') === 0) isrc = 'https:' + isrc;
      if (isrc.indexOf('http') !== 0) continue;
      n++;
      servers.push({ src: isrc, label: 'Embed ' + n });
    }
  }

  var seen = {};
  return servers.filter(function(s) {
    if (seen[s.src]) return false;
    seen[s.src] = true;
    return true;
  });
}

// ---------------------------------------------------------------------------
// 4. Resolución de servidores a video directo
// ---------------------------------------------------------------------------

// `resolved` es { url, quality, headers } o null; sin resolución se usa el
// fallback (la URL del embed con sus cabeceras), si lo hay.
function buildStream(label, language, resolved, fallbackUrl, fallbackHeaders) {
  var url = (resolved && resolved.url) || fallbackUrl;
  if (!url) return null;
  return {
    title: ((resolved && resolved.quality) || 'HD') + ' · ' + language + ' · ' + label,
    quality: (resolved && resolved.quality) || 'HD',
    language: language,
    url: url,
    headers: (resolved && resolved.headers) || fallbackHeaders
  };
}

// Resuelve una URL de embed con los resolvers compartidos (con el dominio ya
// rotado por mapDomain). Nunca lanza: devuelve stream o null.
function resolveViaShared(url, label, language, fallbackUrl, fallbackHeaders) {
  var fixed = mapDomain(url);
  var resolver = null;
  try { resolver = getEmbedResolver(fixed); } catch (e) { resolver = null; }
  var attempt = resolver
    ? Promise.resolve().then(function() { return resolver(fixed); }).catch(function() { return null; })
    : Promise.resolve(null);
  return attempt.then(function(res) {
    if (res && res.url) return buildStream(label, language, res, null, fallbackHeaders);
    if (fallbackUrl) return buildStream(label, language, null, fallbackUrl, fallbackHeaders);
    return null;
  });
}

// Servidor directo de la ficha (sin embed69 de por medio). Sin resolver
// compartido no hay stream: no se entrega el embed crudo en esta ruta.
function resolveDirect(src, label) {
  var headers = { Referer: originOf(mapDomain(src)) + '/', 'User-Agent': UA };
  return resolveViaShared(src, label, 'Latino', null, headers);
}

// Una entrada descifrada de embed69 -> stream. Las familias conocidas
// (streamwish/vidhide) se resuelven con el resolver propio del módulo
// embed69; el resto pasa por los resolvers compartidos. Si nada resuelve,
// queda el embed mismo como fallback con cabeceras.
function resolveEntry(entry) {
  var label = entry.servidor
    ? entry.servidor.charAt(0).toUpperCase() + entry.servidor.slice(1)
    : 'Embed';
  var headers = {
    Referer: originOf(entry.url) + '/',
    Origin: EMBED69_ORIGIN,
    'User-Agent': UA
  };
  var fam = familyOf(entry.servidor, entry.url);
  if (fam) {
    return resolveHostStream(entry.url, fam, HOST_MS)
      .catch(function() { return null; })
      .then(function(res) {
        return buildStream(label, entry.language, res, entry.url, headers);
      });
  }
  return resolveViaShared(entry.url, label, entry.language, entry.url, headers);
}

// Página embed69.org/f/<id>/: trae el dataLink cifrado (PoW + AES-256-CBC)
// que decodeEmbed69Page — función SINCRÓNICA — convierte en entradas.
function resolveEmbed69(src) {
  return fetchText(src, {
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      Referer: SITE + '/',
      Origin: EMBED69_ORIGIN,
      'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
      'User-Agent': UA
    }
  }, EMBED_MS)
    .then(function(html) {
      var entries = decodeEmbed69Page(html);
      if (!entries.length) return [];
      return Promise.all(entries.map(resolveEntry));
    })
    .then(function(streams) {
      return streams.filter(function(s) { return !!s; });
    })
    .catch(function() { return []; });
}

// Ruta vieja de PelisPlusHD: uqlink.php desenvuelve a un iframe directo.
// Hoy el sitio ya no la entrega en estas fichas, pero el comportamiento se
// conserva: si aparece, se desenvuelve y se resuelve como host directo.
function unwrapUqlink(src) {
  return fetchText(src, { headers: { Referer: SITE + '/', 'User-Agent': UA } }, EMBED_MS)
    .then(function(html) {
      var m = html.match(/<iframe\b[^>]*src="([^"]+)"[^>]*>/i);
      if (!m) return null;
      var url = m[1];
      if (url.indexOf('//') === 0) url = 'https:' + url;
      return url.indexOf('http') === 0 ? url : null;
    })
    .catch(function() { return null; });
}

function resolveServer(server) {
  var src = server.src;
  if (src.indexOf('embed69.org/uqlink.php') !== -1) {
    return unwrapUqlink(src).then(function(url) {
      if (!url) return [];
      return resolveDirect(url, server.label).then(function(st) { return st ? [st] : []; });
    });
  }
  if (src.indexOf('embed69.org/') !== -1) return resolveEmbed69(src);
  return resolveDirect(src, server.label).then(function(st) { return st ? [st] : []; });
}

// Todos los servidores en paralelo; la salida va sin duplicados por URL.
function resolveServers(servers) {
  return Promise.all(servers.map(resolveServer)).then(function(lists) {
    var out = [];
    var seen = {};
    for (var i = 0; i < lists.length; i++) {
      var list = lists[i] || [];
      for (var j = 0; j < list.length; j++) {
        var st = list[j];
        if (!st || !st.url || seen[st.url]) continue;
        seen[st.url] = true;
        out.push(st);
      }
    }
    return out;
  });
}

// ---------------------------------------------------------------------------
// 5. Flujo por tipo de contenido
// ---------------------------------------------------------------------------

function movieStreams(slug) {
  return fetchText(SITE + '/pelicula/' + slug, null, PAGE_MS)
    .then(function(html) { return resolveServers(parseServers(html)); })
    .catch(function() { return []; });
}

// El enlace del episodio se busca por segmento exacto: un regex laxo captura
// la comilla de cierre dentro de la URL y el fetch del episodio da 500.
function findEpisodeUrl(html, season, episode) {
  var needle = '/temporada/' + season + '/capitulo/' + episode;
  var re = /href="([^"]+)"/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    var href = m[1];
    var i = href.indexOf(needle);
    if (i === -1) continue;
    var next = href.charAt(i + needle.length);
    if (next !== '' && next !== '/' && next !== '?' && next !== '#') continue;
    if (href.indexOf('/serie/') === -1 && href.indexOf('/anime/') === -1) continue;
    return href;
  }
  return null;
}

function episodeStreams(slug, season, episode) {
  var basePath = slug.indexOf('anime/') === 0
    ? SITE + '/' + slug
    : SITE + '/serie/' + slug;
  return fetchText(basePath, null, PAGE_MS)
    .then(function(html) {
      var epUrl = findEpisodeUrl(html, season, episode);
      if (!epUrl) epUrl = basePath + '/temporada/' + season + '/capitulo/' + episode;
      if (epUrl.indexOf('http') !== 0) {
        epUrl = SITE + (epUrl.charAt(0) === '/' ? '' : '/') + epUrl;
      }
      return fetchText(epUrl, null, PAGE_MS);
    })
    .then(function(html) { return resolveServers(parseServers(html)); })
    .catch(function() { return []; });
}

// ---------------------------------------------------------------------------
// Entrada (contrato): nunca lanza; ante cualquier fallo devuelve [].
// ---------------------------------------------------------------------------

export function extractStreams(tmdbId, mediaType, season, episode) {
  // Nuvio manda "movie"/"series"/"anime"; TMDB necesita "movie"/"tv".
  var tmdbType = (mediaType === 'tv' || mediaType === 'series' || mediaType === 'anime') ? 'tv' : 'movie';
  return resolveTitle(tmdbId, tmdbType)
    .then(function(media) {
      if (!media) return [];
      return searchAll(media).then(function(candidates) {
        var match = pickMatch(candidates, media, tmdbType);
        if (!match) return [];
        if (tmdbType === 'movie') return movieStreams(match.slug);
        return episodeStreams(match.slug, season || 1, episode || 1);
      });
    })
    .catch(function(err) {
      console.error('[pelisplusto] ' + (err && err.message ? err.message : err));
      return [];
    });
}
