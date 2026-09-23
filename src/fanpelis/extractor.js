import { fetchJson, fetchText } from '../shared/http.js';
import { getEmbedResolver, mapDomain } from '../shared/embedResolvers.js';

const TMDB_API_KEY = '1f54bd990f1cdfb230adb312546d765d';
const API_URL = 'https://fanpelis.to/api/rest/';
const API_FALLBACK = 'https://fanpelis.to/api/rest/';

var ACCENT_MAP = { 'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u', 'ü': 'u', 'ñ': 'n', 'Á': 'a', 'É': 'e', 'Í': 'i', 'Ó': 'o', 'Ú': 'u', 'Ü': 'u', 'Ñ': 'n', 'à': 'a', 'è': 'e', 'ì': 'i', 'ò': 'o', 'ù': 'u', 'â': 'a', 'ê': 'e', 'î': 'i', 'ô': 'o', 'û': 'u', 'ä': 'a', 'ë': 'e', 'ï': 'i', 'ö': 'o', 'ç': 'c', 'ã': 'a', 'õ': 'o' };
function stripAccents(s) { return (s || '').replace(/[^\x00-\x7F]/g, function(c) { return ACCENT_MAP[c] || ''; }); }
function normalizeText(text) {
  if (!text) return '';
  return stripAccents(text.toLowerCase())
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripYear(title) {
  return (title || '').replace(/\s*\(\d{4}\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

function getMediaTitle(tmdbId, mediaType) {
  var url = 'https://api.themoviedb.org/3/' + mediaType + '/' + tmdbId + '?api_key=' + TMDB_API_KEY + '&language=es-MX';
  return fetchJson(url).then(function(data) {
    var title = mediaType === 'movie' ? data.title : data.name;
    var originalTitle = mediaType === 'movie' ? data.original_title : data.original_name;
    var date = mediaType === 'movie' ? data.release_date : data.first_air_date;
    return {
      title: title,
      originalTitle: originalTitle,
      year: date && date.length >= 4 ? date.slice(0, 4) : null,
    };
  });
}

var STOPWORDS = { y: 1, de: 1, la: 1, el: 1, los: 1, las: 1, un: 1, una: 1, del: 1, al: 1, e: 1, u: 1, o: 1, en: 1, con: 1, por: 1, para: 1, the: 1, a: 1, an: 1, of: 1, and: 1, to: 1, in: 1, on: 1, vs: 1 };

function decodeEntities(s) {
  return (s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function searchWords(media) {
  var all = normalizeText((media.originalTitle || '') + ' ' + (media.title || ''));
  var words = all.replace(/[^a-z0-9]/g, ' ').split(' ').filter(Boolean);
  var unique = {}, out = [];
  for (var i = 0; i < words.length; i++) {
    var w = words[i];
    if (w.length < 3 || STOPWORDS[w] || unique[w]) continue;
    unique[w] = true;
    out.push(w);
  }
  // Longest first: most distinctive word queried first.
  out.sort(function(a, b) { return b.length - a.length; });
  return out.slice(0, 3);
}

function api(path) {
  return fetchJson(API_URL + path).then(function(res) {
    if (!res || res.error) throw new Error('Fanpelis API error');
    return res.data;
  }).catch(function(e) {
    // Try fallback domain on network/HTTP error
    if (API_FALLBACK !== API_URL) {
      return fetchJson(API_FALLBACK + path).then(function(res2) {
        if (!res2 || res2.error) throw new Error('Fanpelis API error');
        return res2.data;
      });
    }
    throw e;
  });
}

function pickPost(posts, media, wantTv, ignoreYear) {
  var no = normalizeText(media.originalTitle || '');
  var nt = normalizeText(media.title || '');
  var best = null, bestScore = -1;
  // Build word list for fuzzy fallback
  var allNorm = (no + ' ' + nt).trim();
  var qWords = allNorm ? allNorm.split(' ').filter(Boolean) : [];
  for (var i = 0; i < posts.length; i++) {
    var p = posts[i];
    var isTv = p.type === 'tvshows' || p.type === 'animes';
    if (wantTv !== isTv) continue;
    var pt = normalizeText(stripYear(decodeEntities(p.title || '')));
    var score = 0;
    if (pt === no || pt === nt) score = 100;
    else if ((no && (pt.indexOf(no) !== -1 || no.indexOf(pt) !== -1)) ||
             (nt && (pt.indexOf(nt) !== -1 || nt.indexOf(pt) !== -1))) score = 80;
    if (score === 0) {
      // Fuzzy word overlap (ES-friendly: Los Vengadores vs Avengers)
      var ptWords = pt.split(' ').filter(Boolean);
      var qMatch = 0, cMatch = 0;
      for (var qi = 0; qi < qWords.length; qi++) {
        if (pt.indexOf(qWords[qi]) !== -1) qMatch++;
      }
      for (var ci = 0; ci < ptWords.length; ci++) {
        for (var qj = 0; qj < qWords.length; qj++) {
          if (qWords[qj] === ptWords[ci]) { cMatch++; break; }
        }
      }
      score = qMatch * 8 + cMatch * 5;
      if (score < 10) continue;
    }
    if (!ignoreYear) {
      if (media.year && (p.title || '').indexOf(media.year) !== -1) score += 5;
      else if (media.year && p.release_date && p.release_date.indexOf(media.year) === 0) score += 5;
    }
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return best;
}

function resolveEmbeds(embeds) {
  var streams = [];
  var jobs = (embeds || []).map(function(e) {
    var url = e.url || '';
    if (!url || url.indexOf('magnet:') === 0) return Promise.resolve();
    var fixedUrl = mapDomain(url);
    var resolver = getEmbedResolver(fixedUrl);
    if (!resolver) return Promise.resolve();
    var lang = e.lang || 'LAT';
    var q = e.quality || 'HD';
    return resolver(fixedUrl).then(function(result) {
      if (result && result.url) {
        streams.push({
          name: 'Fanpelis (' + lang + ')',
          title: (result.quality || q) + ' · ' + lang + ' · ' + fixedUrl.split('/')[2],
          url: result.url,
          quality: result.quality || q,
          headers: result.headers,
        });
      }
    }).catch(function() {});
  });
  return Promise.all(jobs).then(function() { return streams; });
}

function movieStreams(postId) {
  return api('player?post_id=' + postId + '&_any=1')
    .then(function(data) { return resolveEmbeds(data.embeds); })
    .catch(function() { return []; });
}

function episodeStreams(postId, season, episode) {
  return api('episodes?post_id=' + postId)
    .then(function(list) {
      var eps = list || [];
      for (var i = 0; i < eps.length; i++) {
        if (eps[i].season_number === season && eps[i].episode_number === episode) {
          return api('player?post_id=' + eps[i]._id + '&_any=1')
            .then(function(data) { return resolveEmbeds(data.embeds); });
        }
      }
      return [];
    })
    .catch(function() { return []; });
}

export function extractStreams(tmdbId, mediaType, season, episode) {
  // Nuvio passes Stremio content types ("movie"/"series"); TMDB needs "movie"/"tv".
  var tmdbType = (mediaType === 'tv' || mediaType === 'series' || mediaType === 'anime') ? 'tv' : 'movie';
  var wantTv = tmdbType === 'tv';
  return getMediaTitle(tmdbId, tmdbType)
    .then(function(media) {
      // The API only matches single-word queries; try distinctive words.
      var words = searchWords(media);
      if (words.length === 0) return [];
      var posts = [];
      var seen = {};
      var chain = Promise.resolve();
      words.forEach(function(w) {
        chain = chain.then(function() {
          var path = 'search?query=' + encodeURIComponent(w) + '&page=1&post_type=movies,tvshows,animes&posts_per_page=16';
          return api(path).then(function(data) {
            var list = (data && data.posts) || [];
            for (var i = 0; i < list.length; i++) {
              if (!seen[list[i]._id]) { seen[list[i]._id] = true; posts.push(list[i]); }
            }
          }).catch(function() {});
        });
      });
      return chain.then(function() {
        var best = pickPost(posts, media, wantTv, false);
        // Future/unreleased (2026) often indexed without year tag - retry ignoring year
        if (!best) best = pickPost(posts, media, wantTv, true);
        if (!best) return [];
        if (!wantTv) return movieStreams(best._id);
        return episodeStreams(best._id, parseInt(season, 10) || 1, parseInt(episode, 10) || 1);
      });
    })
    .catch(function(err) {
      console.error('[Fanpelis] Error: ' + (err && err.message ? err.message : err));
      return [];
    });
}
