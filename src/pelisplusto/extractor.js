import { fetchText, fetchJson } from '../shared/http.js';
import { getEmbedResolver, mapDomain } from '../shared/embedResolvers.js';
import { decodeEmbed69Page, resolveHostStream, familyOf } from './embed69.js';

const TMDB_API_KEY = '1f54bd990f1cdfb230adb312546d765d';
const MAIN_URL = 'https://pelisplushd.bz';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const RESOLVE_TIMEOUT = 15000;

var ACCENT_MAP = { 'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u', 'ü': 'u', 'ñ': 'n', 'Á': 'a', 'É': 'e', 'Í': 'i', 'Ó': 'o', 'Ú': 'u', 'Ü': 'u', 'Ñ': 'n', 'à': 'a', 'è': 'e', 'ì': 'i', 'ò': 'o', 'ù': 'u', 'â': 'a', 'ê': 'e', 'î': 'i', 'ô': 'o', 'û': 'u', 'ä': 'a', 'ë': 'e', 'ï': 'i', 'ö': 'o', 'ç': 'c', 'ã': 'a', 'õ': 'o' };
function stripAccents(s) {
  return (s || '').replace(/[^\x00-\x7F]/g, function(c) { return ACCENT_MAP[c] || ''; });
}
function normalizeText(text) {
  if (!text) return '';
  return stripAccents(text.toLowerCase())
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanTitle(raw) {
  if (!raw) return '';
  return raw
    .replace(/^ver\s+/i, '')
    .replace(/\s*\(\d{4}\)\s*/g, ' ')
    .split(' Online')[0]
    .split(' online')[0]
    .split(' (')[0]
    .replace(/\s+/g, ' ')
    .trim();
}

function getMediaTitle(tmdbId, mediaType) {
  var url = 'https://api.themoviedb.org/3/' + mediaType + '/' + tmdbId + '?api_key=' + TMDB_API_KEY + '&language=es-MX';
  return fetchJson(url).then(function(data) {
    var title = mediaType === 'movie' ? data.title : data.name;
    var originalTitle = mediaType === 'movie' ? data.original_title : data.original_name;
    var year = null;
    var date = mediaType === 'movie' ? data.release_date : data.first_air_date;
    if (date && date.length >= 4) year = date.slice(0, 4);
    return { title: title, originalTitle: originalTitle, year: year };
  });
}

function extractSearchCandidates(html) {
  var candidates = [];
  var anchorRegex = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  var m;
  while ((m = anchorRegex.exec(html)) !== null) {
    var href = m[1];
    var inner = m[2];
    if (!href) continue;
    var kind = null;
    if (href.indexOf('/pelicula/') !== -1) kind = 'movie';
    else if (href.indexOf('/serie/') !== -1) kind = 'tv';
    else if (href.indexOf('/anime/') !== -1) kind = 'tv';
    if (!kind) continue;
    if (href.indexOf('/temporada/') !== -1) continue;

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
    title = cleanTitle(title.replace(/<[^>]*>/g, '').trim());
    if (!title) continue;

    var slug = href.split('/pelicula/').pop().split('/serie/').pop().split('/anime/').pop()
      .split('/')[0].split('?')[0];
    if (!slug) continue;
    var prefix = href.indexOf('/anime/') !== -1 ? 'anime/' : '';
    candidates.push({ title: title, slug: prefix + slug, kind: kind });
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
  var url = MAIN_URL + '/search?s=' + encodeURIComponent(query);
  return fetchText(url).then(function(html) {
    return extractSearchCandidates(html);
  }).catch(function() { return []; });
}

function scoreCandidates(candidates, media, expectedKind) {
  var no = normalizeText(media.originalTitle || '');
  var nt = normalizeText(media.title || '');
  var words = (no + ' ' + nt).split(' ').filter(Boolean);
  var unique = {};
  words = words.filter(function(w) { if (unique[w]) return false; unique[w] = true; return true; });

  var best = null, bestScore = -1;
  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i];
    var nc = normalizeText(c.title);
    var score = 0;
    if (nc === no || nc === nt) score = 100;
    else if ((no && (nc.indexOf(no) !== -1 || no.indexOf(nc) !== -1)) ||
             (nt && (nc.indexOf(nt) !== -1 || nt.indexOf(nc) !== -1))) score = 80;
    if (score === 0) {
      var qMatch = 0, cMatch = 0, w;
      var cWords = nc.split(' ').filter(Boolean);
      for (var a = 0; a < words.length; a++) {
        if (nc.indexOf(words[a]) !== -1) qMatch++;
      }
      for (var b = 0; b < cWords.length; b++) {
        for (var q = 0; q < words.length; q++) {
          if (words[q] === cWords[b]) { cMatch++; break; }
        }
      }
      score = qMatch * 8 + cMatch * 5;
    }
    if (media.year && c.title.indexOf(media.year) !== -1) score += 5;
    if (c.kind === expectedKind) score += 3;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  if (!best || bestScore < 15) return null;
  return best;
}

function getServersFromDetail(html) {
  var videoMap = {};
  var vRegex = /video\[(\d+)\]\s*=\s*['"]([^'"]+)['"]/g;
  var vm;
  while ((vm = vRegex.exec(html)) !== null) {
    videoMap[parseInt(vm[1], 10)] = vm[2];
  }
  var labels = {};
  var liRegex = /<li[^>]*data-id="(\d+)"[^>]*>([\s\S]*?)<\/li>/gi;
  var lm;
  while ((lm = liRegex.exec(html)) !== null) {
    var label = lm[2].replace(/<[^>]*>/g, '').trim() || 'Server';
    labels[parseInt(lm[1], 10)] = label;
  }
  var servers = [];
  for (var idx in videoMap) {
    if (!Object.prototype.hasOwnProperty.call(videoMap, idx)) continue;
    var src = videoMap[idx];
    if (!src || src.indexOf('http') !== 0) continue;
    servers.push({ src: src, label: labels[idx] || ('Server ' + idx) });
  }
  if (servers.length === 0) {
    var ifRegex = /<iframe\b[^>]*src="([^"]+)"[^>]*>/gi;
    var im, n = 0;
    while ((im = ifRegex.exec(html)) !== null) {
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

function unwrapEmbed69(src) {
  // Rutas viejas de PelisPlusHD (uqlink.php) desenvuelven a un iframe directo.
  // Hoy el sitio usa /f/<imdb_id>/ (pagina cifrada, ver decodeEmbed69Page).
  if (src.indexOf('embed69.org/uqlink.php') === -1) return Promise.resolve(null);
  return fetchText(src, { headers: { Referer: MAIN_URL + '/', 'User-Agent': UA } }, RESOLVE_TIMEOUT)
    .then(function(html) {
      var m = html.match(/<iframe\b[^>]*src="([^"]+)"[^>]*>/i);
      if (!m) return null;
      var isrc = m[1];
      if (isrc.indexOf('//') === 0) isrc = 'https:' + isrc;
      return isrc.indexOf('http') === 0 ? isrc : null;
    })
    .catch(function() { return null; });
}

function originOfUrl(url) {
  var m = String(url || '').match(/^(https?:\/\/[^\/]+)/i);
  return m ? m[1] : '';
}

function makeStream(serverLabel, language, resolucion, fallbackUrl, fallbackHeaders) {
  var url = (resolucion && resolucion.url) || fallbackUrl;
  if (!url) return null;
  var quality = (resolucion && resolucion.quality) || 'HD';
  var headers = (resolucion && resolucion.headers) || fallbackHeaders;
  return {
    title: quality + ' · ' + language + ' · ' + serverLabel,
    quality: quality,
    language: language,
    url: url,
    headers: headers,
  };
}

// Host directo (sin embed69 de por medio) resuelto con los resolvers compartidos.
function resolveDirect(src, serverLabel) {
  var fixed = mapDomain(src);
  var resolver = getEmbedResolver(fixed);
  if (!resolver) return Promise.resolve(null);
  var origin = originOfUrl(fixed);
  return resolver(fixed)
    .then(function(result) {
      return makeStream(serverLabel, 'Latino', result, null, { Referer: origin + '/', 'User-Agent': UA });
    })
    .catch(function() { return null; });
}

// Entrada descifrada de embed69 -> stream publicable. Si el .m3u8 no se puede
// resolver, se entrega el propio embed con sus cabeceras (igual que hace el
// provider embed69) para que la app lo resuelva por su relay.
function streamFromEntry(entry) {
  var fam = familyOf(entry.servidor, entry.url);
  var serverLabel = entry.servidor ? entry.servidor.charAt(0).toUpperCase() + entry.servidor.slice(1) : 'Embed';
  var prom;
  if (fam) {
    prom = resolveHostStream(entry.url, fam, RESOLVE_TIMEOUT);
  } else {
    var fixed = mapDomain(entry.url);
    var resolver = getEmbedResolver(fixed);
    prom = resolver ? resolver(fixed) : Promise.resolve(null);
  }
  var origin = originOfUrl(entry.url);
  var fallbackHeaders = { Referer: origin + '/', Origin: 'https://embed69.org', 'User-Agent': UA };
  return prom
    .catch(function() { return null; })
    .then(function(res) {
      return makeStream(serverLabel, entry.language, res, entry.url, fallbackHeaders);
    });
}

// Pagina embed69.org/f/<id>/: trae `dataLink` cifrado (PoW + AES-256-CBC).
function resolveEmbed69(src) {
  return fetchText(src, {
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      Referer: MAIN_URL + '/',
      Origin: 'https://embed69.org',
      'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
      'User-Agent': UA,
    },
  }, RESOLVE_TIMEOUT)
    .then(function(html) { return decodeEmbed69Page(html); })
    .then(function(entries) {
      if (!entries.length) return [];
      return Promise.all(entries.map(function(e) { return streamFromEntry(e); }));
    })
    .catch(function() { return []; });
}

function resolveServers(servers) {
  var promises = servers.map(function(s) {
    var src = s.src;
    if (src.indexOf('embed69.org/uqlink.php') !== -1) {
      return unwrapEmbed69(src).then(function(unwrapped) {
        if (!unwrapped) return [];
        return resolveDirect(unwrapped, s.label).then(function(st) { return st ? [st] : []; });
      });
    }
    if (src.indexOf('embed69.org/') !== -1) return resolveEmbed69(src);
    return resolveDirect(src, s.label).then(function(st) { return st ? [st] : []; });
  });
  return Promise.all(promises).then(function(lists) {
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

function getMovieStreams(slug) {
  return fetchText(MAIN_URL + '/pelicula/' + slug)
    .then(function(html) {
      return resolveServers(getServersFromDetail(html));
    })
    .catch(function() { return []; });
}

// El href de la temporada se busca por segmento exacto: el regex anterior
// capturaba la comilla de cierre dentro de la URL (`href=".../capitulo/1"` ->
// `...1"\n class=`), así que el fetch del episodio daba 500.
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

function getEpisodeStreams(slug, season, episode) {
  var basePath = slug.indexOf('anime/') === 0
    ? MAIN_URL + '/' + slug
    : MAIN_URL + '/serie/' + slug;
  return fetchText(basePath)
    .then(function(html) {
      var epUrl = findEpisodeUrl(html, season, episode);
      if (!epUrl) epUrl = basePath + '/temporada/' + season + '/capitulo/' + episode;
      if (epUrl.indexOf('http') !== 0) epUrl = MAIN_URL + (epUrl.charAt(0) === '/' ? '' : '/') + epUrl;
      return fetchText(epUrl);
    })
    .then(function(html) {
      return resolveServers(getServersFromDetail(html));
    })
    .catch(function() { return []; });
}

export function extractStreams(tmdbId, mediaType, season, episode) {
  // Nuvio passes Stremio content types ("movie"/"series"); TMDB needs "movie"/"tv".
  var tmdbType = (mediaType === 'tv' || mediaType === 'series' || mediaType === 'anime') ? 'tv' : 'movie';
  var expectedKind = tmdbType;
  return getMediaTitle(tmdbId, tmdbType)
    .then(function(media) {
      var queries = [];
      if (media.originalTitle) queries.push(media.originalTitle);
      if (media.title && media.title !== media.originalTitle) queries.push(media.title);
      if (queries.length === 0) return [];
      var all = [];
      var chain = Promise.resolve();
      queries.forEach(function(q) {
        chain = chain.then(function() {
          return searchSite(q).then(function(c) { all = all.concat(c); });
        });
      });
      return chain.then(function() {
        var best = scoreCandidates(all, media, expectedKind);
        if (!best) return [];
        if (expectedKind === 'movie') return getMovieStreams(best.slug);
        return getEpisodeStreams(best.slug, season || 1, episode || 1);
      });
    })
    .catch(function(err) {
      console.error('[Pelisplusto] Error: ' + (err && err.message ? err.message : err));
      return [];
    });
}
