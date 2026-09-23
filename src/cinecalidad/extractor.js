import { fetchText, fetchJson } from '../shared/http.js';
import { getEmbedResolver, mapDomain } from '../shared/embedResolvers.js';

const TMDB_API_KEY = '1f54bd990f1cdfb230adb312546d765d';
const SEARCH_URL = 'https://www.cinecalidad.ec';
const FALLBACK_URLS = ['https://www.cinecalidad.ec', 'https://cinecalidad.ec', 'https://cinecalidad.to'];

var ACCENT_MAP = { 'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u', 'ü': 'u', 'ñ': 'n', 'Á': 'a', 'É': 'a', 'Í': 'i', 'Ó': 'o', 'Ú': 'u', 'Ü': 'u', 'Ñ': 'n', 'à': 'a', 'è': 'e', 'ì': 'i', 'ò': 'o', 'ù': 'u', 'â': 'a', 'ê': 'e', 'î': 'i', 'ô': 'o', 'û': 'u', 'ä': 'a', 'ë': 'e', 'ï': 'i', 'ö': 'o', 'ç': 'c', 'ã': 'a', 'õ': 'o' };

function stripAccents(s) {
  return (s || '').replace(/[^\x00-\x7F]/g, function(c) { return ACCENT_MAP[c] || ''; });
}

// QuickJS (Nuvio) has no String.normalize: explicit accent map instead.
function normalizeText(text) {
  if (!text) return '';
  return stripAccents(text.toLowerCase())
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getMediaTitle(tmdbId, tmdbType) {
  var url = 'https://api.themoviedb.org/3/' + tmdbType + '/' + tmdbId + '?api_key=' + TMDB_API_KEY + '&language=es-MX';
  return fetchJson(url).then(function(data) {
    var isMovie = tmdbType === 'movie';
    var date = isMovie ? data.release_date : data.first_air_date;
    return {
      title: isMovie ? data.title : data.name,
      originalTitle: isMovie ? data.original_title : data.original_name,
      year: date && date.length >= 4 ? date.slice(0, 4) : null,
    };
  });
}

function searchSite(query) {
  function tryUrls(idx) {
    if (idx >= FALLBACK_URLS.length) return Promise.resolve([]);
    var url = FALLBACK_URLS[idx] + '/?s=' + encodeURIComponent(query);
    return fetchText(url, { headers: { Referer: FALLBACK_URLS[idx] + '/' } }).then(function(html) {
      var out = [];
      var artRe = /<article[\s\S]*?<\/article>/gi;
      var am;
      while ((am = artRe.exec(html)) !== null) {
        var lm = am[0].match(/<a\b[^>]*href="([^"]+)"/i);
        if (!lm) continue;
        var href = lm[1];
        if (href.indexOf('/ver-pelicula/') === -1 && href.indexOf('/ver-serie/') === -1) continue;
        var title = am[0].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        out.push({ title: title.slice(0, 80), href: href });
      }
      if (out.length > 0) return out;
      return tryUrls(idx + 1);
    }).catch(function() { return tryUrls(idx + 1); });
  }
  return tryUrls(0);
}

function pickBest(cands, media, wantTv, ignoreYear) {
  var no = normalizeText(media.originalTitle || '');
  var nt = normalizeText(media.title || '');
  var best = null, bestScore = -1;
  for (var i = 0; i < cands.length; i++) {
    var c = cands[i];
    var isTv = c.href.indexOf('/ver-serie/') !== -1;
    if (wantTv !== isTv) continue;
    var nc = normalizeText(c.title);
    var score = 0;
    if (nc === no || nc === nt) score = 100;
    else if ((no && (nc.indexOf(no) !== -1 || no.indexOf(nc) !== -1)) ||
             (nt && (nc.indexOf(nt) !== -1 || nt.indexOf(nc) !== -1))) score = 80;
    if (score === 0) {
      var words = (no + ' ' + nt).split(' ').filter(function(w) { return w.length >= 4; });
      var qm = 0;
      for (var w = 0; w < words.length; w++) {
        if (nc.indexOf(words[w]) !== -1) qm++;
      }
      if (qm === 0) continue;
      score = qm * 10;
    }
    if (!ignoreYear && media.year && c.title.indexOf(media.year) !== -1) score += 5;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  if (!best || bestScore < 10) return null;
  return best;
}

function optionsFromPage(html) {
  var out = [];
  var re = /<li[^>]*data-option=["']([^"']+)["'][^>]*>/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    var url = m[1];
    if (!url || url.indexOf('http') !== 0) continue;
    if (url.indexOf('youtube.com') !== -1 || url.indexOf('youtu.be') !== -1) continue;
    out.push(url);
  }
  var seen = {};
  return out.filter(function(u) {
    if (seen[u]) return false;
    seen[u] = true;
    return true;
  });
}

function resolveOptions(urls) {
  var streams = [];
  var jobs = urls.map(function(src) {
    var fixed = mapDomain(src);
    var resolver = getEmbedResolver(fixed);
    if (!resolver) return Promise.resolve();
    var host = '';
    try { host = fixed.split('/')[2]; } catch (e) {}
    return resolver(fixed).then(function(r) {
      if (r && r.url) {
        streams.push({
          name: 'CineCalidad (' + host + ')',
          title: (r.quality || 'HD') + ' · LAT · ' + host,
          url: r.url,
          quality: r.quality || 'HD',
          headers: r.headers,
        });
      }
    }).catch(function() {});
  });
  return Promise.all(jobs).then(function() { return streams; });
}

function movieStreams(pageUrl) {
  return fetchText(pageUrl, { headers: { Referer: SEARCH_URL + '/' } })
    .then(function(html) { return resolveOptions(optionsFromPage(html)); })
    .catch(function() { return []; });
}

function episodeStreams(serieUrl, season, episode) {
  return fetchText(serieUrl, { headers: { Referer: SEARCH_URL + '/' } })
    .then(function(html) {
      var target = '-' + season + 'x' + episode + '/';
      var re = /href="([^"]*ver-el-episodio[^"]*)"/gi;
      var m, epUrl = null;
      while ((m = re.exec(html)) !== null) {
        if (m[1].indexOf(target) !== -1) { epUrl = m[1]; break; }
        if (!epUrl) epUrl = m[1];
      }
      if (!epUrl) return [];
      return fetchText(epUrl, { headers: { Referer: serieUrl } });
    })
    .then(function(html) {
      if (!html) return [];
      return resolveOptions(optionsFromPage(html));
    })
    .catch(function() { return []; });
}

export function extractStreams(tmdbId, mediaType, season, episode) {
  // Nuvio passes Stremio content types ("movie"/"series"); TMDB needs "movie"/"tv".
  var tmdbType = (mediaType === 'tv' || mediaType === 'series' || mediaType === 'anime') ? 'tv' : 'movie';
  var wantTv = tmdbType === 'tv';
  return getMediaTitle(tmdbId, tmdbType)
    .then(function(media) {
      var queries = [];
      if (media.originalTitle) queries.push(media.originalTitle);
      if (media.title && media.title !== media.originalTitle) queries.push(media.title);
      if (!queries.length) return [];
      var all = [];
      var chain = Promise.resolve();
      queries.forEach(function(q) {
        chain = chain.then(function() {
          return searchSite(q).then(function(c) { all = all.concat(c); });
        });
      });
      return chain.then(function() {
        var best = pickBest(all, media, wantTv, false);
        if (!best) best = pickBest(all, media, wantTv, true);
        if (!best) return [];
        if (!wantTv) return movieStreams(best.href);
        return episodeStreams(best.href, parseInt(season, 10) || 1, parseInt(episode, 10) || 1);
      });
    })
    .catch(function(err) {
      console.error('[CineCalidad] Error: ' + (err && err.message ? err.message : err));
      return [];
    });
}
