import { fetchText, fetchJson } from '../shared/http.js';
import { getEmbedResolver, mapDomain } from '../shared/embedResolvers.js';

const TMDB_API_KEY = '1f54bd990f1cdfb230adb312546d765d';
const MAIN_URL = 'https://pelisplushd.bz';

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
  // PelisPlusHD routes most servers through embed69. The /f/ and /video/ pages
  // are PoW/bot protected and cannot be scraped server-side, but uqlink.php
  // unwraps to the direct host iframe which our resolvers handle.
  if (src.indexOf('embed69.org/uqlink.php') === -1) return Promise.resolve(null);
  return fetchText(src, { headers: { Referer: MAIN_URL + '/' } })
    .then(function(html) {
      var m = html.match(/<iframe\b[^>]*src="([^"]+)"[^>]*>/i);
      if (!m) return null;
      var isrc = m[1];
      if (isrc.indexOf('//') === 0) isrc = 'https:' + isrc;
      return isrc.indexOf('http') === 0 ? isrc : null;
    })
    .catch(function() { return null; });
}

function resolveServers(servers) {
  var streams = [];
  var promises = servers.map(function(s) {
    return unwrapEmbed69(s.src).then(function(unwrapped) {
      var target = unwrapped || s.src;
      // Skip PoW-protected embed69 pages with no direct host.
      if (target.indexOf('embed69.org/') !== -1) return null;
      var fixedUrl = mapDomain(target);
      var resolver = getEmbedResolver(fixedUrl);
      if (!resolver) return null;
      return resolver(fixedUrl).then(function(result) {
        if (result && result.url) {
          streams.push({
            name: 'Pelisplusto (' + s.label + ')',
            title: (result.quality || 'HD') + ' · LAT · ' + s.label,
            url: result.url,
            quality: result.quality || 'HD',
            headers: result.headers,
          });
        }
      }).catch(function() {});
    });
  });
  return Promise.all(promises).then(function() { return streams; });
}

function getMovieStreams(slug) {
  return fetchText(MAIN_URL + '/pelicula/' + slug)
    .then(function(html) {
      return resolveServers(getServersFromDetail(html));
    })
    .catch(function() { return []; });
}

function getEpisodeStreams(slug, season, episode) {
  var basePath = slug.indexOf('anime/') === 0
    ? MAIN_URL + '/' + slug
    : MAIN_URL + '/serie/' + slug;
  return fetchText(basePath)
    .then(function(html) {
      var epRegex = new RegExp('<a\\b[^>]*href="([^"]*\\/temporada\\/' + season + '\\/capitulo\\/' + episode + '(?:\\/|"|\\?)[^"]*)"[^>]*>', 'i');
      var m = epRegex.exec(html);
      var epUrl = m ? m[1] : (basePath + '/temporada/' + season + '/capitulo/' + episode);
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
