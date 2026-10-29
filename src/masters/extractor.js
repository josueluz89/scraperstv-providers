import { fetchText, fetchJson } from '../shared/http.js';
import { getEmbedResolver, mapDomain, getServerLabel } from '../shared/embedResolvers.js';

const TMDB_API_KEY = '1f54bd990f1cdfb230adb312546d765d';
const MAIN_URL = 'https://ww3.gnulahd.nu';
const MIRRORS = [
  'https://ww3.gnulahd.nu',
  'https://gnulahd.click',
  'https://gnulahd.bid'
];

var ACCENT_MAP = {
  'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u', 'ü': 'u', 'ñ': 'n',
  'Á': 'a', 'É': 'e', 'Í': 'i', 'Ó': 'o', 'Ú': 'u', 'Ü': 'u', 'Ñ': 'n',
  'à': 'a', 'è': 'e', 'ì': 'i', 'ò': 'o', 'ù': 'u', 'â': 'a', 'ê': 'e',
  'î': 'i', 'ô': 'o', 'û': 'u', 'ä': 'a', 'ë': 'e', 'ï': 'i', 'ö': 'o',
  'ç': 'c', 'ã': 'a', 'õ': 'o'
};
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
var STOPWORDS = { y: 1, de: 1, la: 1, el: 1, los: 1, las: 1, un: 1, una: 1, del: 1, al: 1, e: 1, u: 1, o: 1, en: 1, con: 1, por: 1, para: 1, the: 1, a: 1, an: 1, of: 1, and: 1, to: 1, in: 1, on: 1, vs: 1 };
function searchWords(media) {
  var all = normalizeText((media.originalTitle || '') + ' ' + (media.title || '') + ' ' + (media.esTitle || '') + ' ' + (media.enTitle || ''));
  var words = all.replace(/[^a-z0-9]/g, ' ').split(' ').filter(Boolean);
  var unique = {}, out = [];
  for (var i = 0; i < words.length; i++) {
    var w = words[i];
    if (w.length < 3 || STOPWORDS[w] || unique[w]) continue;
    unique[w] = true;
    out.push(w);
  }
  out.sort(function(a, b) { return b.length - a.length; });
  return out.slice(0, 3);
}
function slugify(text) {
  return stripAccents((text || '').toLowerCase()).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').trim();
}

function classifyLanguage(label) {
  if (!label) return null;
  var s = String(label).toLowerCase();
  // Regla del repo (METODO.md §5): el castellano de España se descarta siempre
  if (s.indexOf('castellano') !== -1 || s.indexOf('españa') !== -1 || s.indexOf('espana') !== -1 || s.indexOf('es_es') !== -1) {
    return null;
  }
  if (s.indexOf('latino') !== -1 || s.indexOf('mx') !== -1 || s.indexOf('lat') !== -1) {
    return 'Latino';
  }
  if (s.indexOf('sub') !== -1 || s.indexOf('vose') !== -1) {
    return 'Subtitulado';
  }
  if (s.indexOf('ingles') !== -1 || s.indexOf('english') !== -1 || s === 'en') {
    return 'Inglés';
  }
  if (s.indexOf('japones') !== -1 || s.indexOf('japanese') !== -1 || s === 'ja') {
    return 'Japonés';
  }
  return null;
}

function extractSearchResults(html) {
  var candidates = [];
  var cardRegex = /<a[^>]*class="[^"]*gnrd-card[^"]*"[^>]*href="([^"]*)"[^>]*title="([^"]*)"[^>]*>/gi;
  var card;
  while ((card = cardRegex.exec(html)) !== null) {
    var href = card[1];
    var title = card[2];
    if (!href || !title) continue;

    var cleanTitle = title.replace(/&#8211;/g, '-').replace(/<[^>]*>/g, '').trim();
    
    // Push the candidate as both tv and movie since we cannot distinguish the type directly from the search card
    candidates.push({ title: cleanTitle, href: href, type: 'tv' });
    candidates.push({ title: cleanTitle, href: href, type: 'movie' });
  }
  return candidates;
}

function extractEpisodes(html, season, episode) {
  var targetSeason = parseInt(season, 10);
  var targetEpisode = parseInt(episode, 10);
  
  var epRegex = /<a[^>]*class="[^"]*gnrd-epc[^"]*"([\s\S]*?)>/gi;
  var match;
  while ((match = epRegex.exec(html)) !== null) {
    var attrs = match[1];
    var hrefMatch = attrs.match(/href="([^"]*)"/i);
    var sMatch = attrs.match(/data-s="(\d+)"/i);
    var eMatch = attrs.match(/data-e="(\d+)"/i);
    
    if (hrefMatch && sMatch && eMatch) {
      var href = hrefMatch[1];
      var s = parseInt(sMatch[1], 10);
      var e = parseInt(eMatch[1], 10);
      if (s === targetSeason && e === targetEpisode) {
        return href;
      }
    }
  }
  return null;
}

function getMediaTitle(tmdbId, mediaType) {
  var base = 'https://api.themoviedb.org/3/' + mediaType + '/' + tmdbId;
  function req(url) {
    return fetchText(url).then(function(raw) {
      try { return JSON.parse(raw); } catch (e) { return null; }
    }).catch(function() { return null; });
  }

  return Promise.all([
    req(base + '?api_key=' + TMDB_API_KEY + '&language=es-MX'),
    req(base + '?api_key=' + TMDB_API_KEY + '&language=es-ES'),
    req(base + '?api_key=' + TMDB_API_KEY + '&language=en-US'),
  ]).then(function(res) {
    var esMx = res[0] || {};
    var esEs = res[1] || {};
    var enUs = res[2] || {};

    var title = mediaType === 'movie' ? esMx.title : esMx.name;
    var esTitle = mediaType === 'movie' ? esEs.title : esEs.name;
    var enTitle = mediaType === 'movie' ? enUs.title : enUs.name;
    var originalTitle = mediaType === 'movie' ? esMx.original_title : esMx.original_name;

    return {
      title: title || esTitle || enTitle || '',
      esTitle: esTitle || '',
      enTitle: enTitle || '',
      originalTitle: originalTitle || ''
    };
  });
}

function resolveTheyTube(code, resolvePath, authParam, pageUrl) {
  var hostMatch = pageUrl.match(/^(https?:\/\/[^\/]+)/);
  var baseHost = hostMatch ? hostMatch[1] : MAIN_URL;
  var resolveUrl = baseHost + resolvePath + encodeURIComponent(code) + authParam;
  return fetchText(resolveUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36', Referer: pageUrl }
  })
    .then(function(raw) {
      var data = JSON.parse(raw);
      if (data && data.master) {
        return { url: data.master, quality: '1080p', headers: { Referer: 'https://they.tube/', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' } };
      }
      return null;
    })
    .catch(function() { return null; });
}

function searchSite(query) {
  var q = encodeURIComponent(query);
  function tryMirror(idx) {
    if (idx >= MIRRORS.length) return Promise.resolve([]);
    var base = MIRRORS[idx];
    var searchUrl = base + '/?s=' + q;
    return fetchText(searchUrl, { headers: { Referer: base + '/', 'Accept-Language': 'es-MX,es;q=0.9' } })
      .then(function(html) {
        return extractSearchResults(html);
      })
      .catch(function() {
        return tryMirror(idx + 1);
      });
  }
  return tryMirror(0);
}

export function extractStreams(tmdbId, mediaType, season, episode) {
  // Nuvio passes Stremio content types ("movie"/"series"); TMDB needs "movie"/"tv".
  var tmdbType = (mediaType === 'tv' || mediaType === 'series' || mediaType === 'anime') ? 'tv' : 'movie';
  return getMediaTitle(tmdbId, tmdbType)
    .then(function(media) {
      var queries = [];
      var seen = {};
      function addQ(t) {
        if (!t || typeof t !== 'string') return;
        var s = t.trim();
        var k = normalizeText(s);
        if (!k || seen[k]) return;
        seen[k] = true;
        queries.push(s);
      }

      addQ(media.originalTitle);
      addQ(media.title);
      addQ(media.esTitle);
      addQ(media.enTitle);

      if (queries.length === 0) return [];

      var normalizedOriginals = [normalizeText(media.originalTitle || '')].filter(Boolean);
      var normalizedTitles = [
        normalizeText(media.title || ''),
        normalizeText(media.esTitle || ''),
        normalizeText(media.enTitle || '')
      ].filter(Boolean);
      var expectedType = tmdbType;

      var bestTvScore = -1, bestTvUrl = null, bestTvType = 'movie';
      var bestMovieScore = -1, bestMovieUrl = null, bestMovieType = 'movie';

      function scoreCandidate(cand) {
        var normalizedCand = normalizeText(cand.title);
        var score = 0;

        for (var n = 0; n < normalizedOriginals.length; n++) {
          var no = normalizedOriginals[n];
          if (normalizedCand === no) score = 100;
          else if (normalizedCand.indexOf(no) !== -1 || no.indexOf(normalizedCand) !== -1) score = Math.max(score, 80);
        }
        for (var n = 0; n < normalizedTitles.length; n++) {
          var nt = normalizedTitles[n];
          if (normalizedCand === nt) score = Math.max(score, 100);
          else if (normalizedCand.indexOf(nt) !== -1 || nt.indexOf(normalizedCand) !== -1) score = Math.max(score, 80);
        }

        if (score === 0) {
          var qWords = [];
          for (var n = 0; n < normalizedOriginals.length; n++)
            qWords = qWords.concat(normalizedOriginals[n].split(' ').filter(Boolean));
          for (var n = 0; n < normalizedTitles.length; n++)
            qWords = qWords.concat(normalizedTitles[n].split(' ').filter(Boolean));
          var uq = {};
          qWords = qWords.filter(function(w) { if (uq[w]) return false; uq[w] = true; return true; });
          var cWords = normalizedCand.split(' ').filter(Boolean);
          var qMatch = 0, cMatch = 0;
          for (var w = 0; w < qWords.length; w++) {
            if (normalizedCand.indexOf(qWords[w]) !== -1) qMatch++;
          }
          for (var w = 0; w < cWords.length; w++) {
            for (var q = 0; q < qWords.length; q++) {
              if (qWords[q] === cWords[w]) { cMatch++; break; }
            }
          }
          score = qMatch * 8 + cMatch * 5;
        }

        if (cand.type === 'tv' && score > bestTvScore) { bestTvScore = score; bestTvUrl = cand.href; bestTvType = cand.type; }
        if (cand.type === 'movie' && score > bestMovieScore) { bestMovieScore = score; bestMovieUrl = cand.href; bestMovieType = cand.type; }
      }

      function selectTarget() {
        var targetUrl, targetType = 'movie';
        if (expectedType === 'tv' && bestTvUrl) { targetUrl = bestTvUrl; targetType = bestTvType; }
        else if (expectedType === 'movie' && bestMovieUrl) { targetUrl = bestMovieUrl; targetType = bestMovieType; }
        else { targetUrl = bestTvUrl || bestMovieUrl; targetType = bestTvType || bestMovieType; }

        if (!targetUrl) return null;
        if (targetUrl.indexOf('http') !== 0) targetUrl = MAIN_URL + targetUrl;
        return { url: targetUrl, type: targetType };
      }

      var searchIndex = 0;
      function doSearch() {
        if (searchIndex >= queries.length) return selectTarget();

        return searchSite(queries[searchIndex++])
          .then(function(candidates) {
            for (var i = 0; i < candidates.length; i++) scoreCandidate(candidates[i]);
            return doSearch();
          });
      }

      function trySlugProbe() {
        var slugs = [];
        var seenSlugs = {};
        [media.title, media.esTitle, media.enTitle, media.originalTitle].forEach(function(t) {
          var s = slugify(t);
          if (s && !seenSlugs[s]) { seenSlugs[s] = true; slugs.push(s); }
        });
        var chain = Promise.resolve(null);
        slugs.forEach(function(slug) {
          chain = chain.then(function(found) {
            if (found) return found;
            var url = MAIN_URL + '/ver/' + slug + '/';
            return fetchText(url, { headers: { Referer: MAIN_URL + '/' } })
              .then(function(html) {
                if (html && html.indexOf('_gnrdPid') !== -1) return { url: url, type: 'movie' };
                return null;
              })
              .catch(function() { return null; });
          });
        });
        return chain;
      }

      function tryWordSearch() {
        var words = searchWords(media);
        if (!words.length) return Promise.resolve(null);
        var chain = Promise.resolve();
        var savedBestTvScore = bestTvScore, savedBestMovieScore = bestMovieScore;
        var savedBestTvUrl = bestTvUrl, savedBestMovieUrl = bestMovieUrl;
        // Try each distinctive word as separate search
        words.forEach(function(w) {
          chain = chain.then(function() {
            return searchSite(w).then(function(cands) {
              for (var i = 0; i < cands.length; i++) scoreCandidate(cands[i]);
            });
          });
        });
        return chain.then(function() {
          var t = selectTarget();
          if (t && (bestMovieScore > savedBestMovieScore || bestTvScore > savedBestTvScore)) return t;
          if (t && (bestMovieScore >= 15 || bestTvScore >= 15)) return t;
          return null;
        });
      }

      return doSearch().then(function(target) {
        if (target) return getPageContent(target.url, tmdbType, target.type, season, episode, media);
        // Fallback 1: word-level search (avengers -> vengadores via infinity/war)
        return tryWordSearch().then(function(wordTarget) {
          if (wordTarget) return getPageContent(wordTarget.url, tmdbType, wordTarget.type, season, episode, media);
          // Fallback 2: direct slug probe
          return trySlugProbe().then(function(slugTarget) {
            if (slugTarget) return getPageContent(slugTarget.url, tmdbType, slugTarget.type, season, episode, media);
            return [];
          });
        });
      });
    })
    .catch(function(err) {
      console.error('[Masters] Error: ' + (err.message || err));
      return [];
    });
}

function getPageContent(pageUrl, mediaType, targetType, season, episode, media) {
  var isTv = mediaType === 'tv' || targetType === 'tv';

  if (isTv) {
    return fetchText(pageUrl)
      .then(function(tvHtml) {
        var epUrl = extractEpisodes(tvHtml, season, episode);
        if (!epUrl) return [];
        if (epUrl.indexOf('http') !== 0) {
          var hostMatch = pageUrl.match(/^(https?:\/\/[^\/]+)/);
          var baseHost = hostMatch ? hostMatch[1] : MAIN_URL;
          epUrl = baseHost + epUrl;
        }
        return getPlayPage(epUrl);
      });
  }

  return getPlayPage(pageUrl);
}

function getPlayerLangs(pageUrl, playHtml) {
  var pidMatch = playHtml.match(/_gnrdPid\s*=\s*(\d+)/);
  var tokMatch = playHtml.match(/_gnrdTok\s*=\s*"([^"]+)"/);
  if (pidMatch && tokMatch) {
    var hostMatch = pageUrl.match(/^(https?:\/\/[^\/]+)/);
    var baseHost = hostMatch ? hostMatch[1] : MAIN_URL;
    var apiUrl = baseHost + '/wp-json/gnrd/v1/player?id=' + pidMatch[1] + '&t=' + encodeURIComponent(tokMatch[1]);
    return fetchJson(apiUrl, {
      headers: { Referer: pageUrl }
    })
      .then(function(raw) { return gnrdUnpack(raw && raw.p); })
      .then(function(d) { return (d && d.langs) || []; })
      .catch(function() { return legacyLangs(playHtml); });
  }
  return Promise.resolve(legacyLangs(playHtml));
}

function legacyLangs(playHtml) {
  try {
    var regex = /var\s+(_gnpv_ep_langs|_gd)\s*=\s*(\[.*?\]);/;
    var match = regex.exec(playHtml);
    if (!match) return [];
    return JSON.parse(match[2]);
  } catch (e) { return []; }
}

function gnrdUnpack(s) {
  try {
    if (typeof s !== 'string' || !s) return [];
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    var str = s.replace(/=+$/, '');
    var bytes = [];
    var bs = 0, bc = 0, i, idx;
    for (i = 0; i < str.length; i++) {
      idx = chars.indexOf(str.charAt(i));
      if (idx === -1) continue;
      bs = bc % 4 ? bs * 64 + idx : idx;
      if (bc++ % 4) bytes.push(255 & (bs >> ((-2 * bc) & 6)));
    }
    var k = [103, 78, 55, 100];
    for (i = 0; i < bytes.length; i++) bytes[i] = bytes[i] ^ k[i & 3];
    return JSON.parse(utf8DecodeBytes(bytes));
  } catch (e) { return []; }
}

function utf8DecodeBytes(bytes) {
  var out = '', i = 0, c, c2, c3, cp;
  while (i < bytes.length) {
    c = bytes[i++];
    if (c < 128) { out += String.fromCharCode(c); continue; }
    if ((c & 0xE0) === 0xC0 && i < bytes.length) {
      c2 = bytes[i++];
      out += String.fromCharCode(((c & 31) << 6) | (c2 & 63));
      continue;
    }
    if ((c & 0xF0) === 0xE0 && i + 1 < bytes.length) {
      c2 = bytes[i++]; c3 = bytes[i++];
      out += String.fromCharCode(((c & 15) << 12) | ((c2 & 63) << 6) | (c3 & 63));
      continue;
    }
    if ((c & 0xF8) === 0xF0 && i + 2 < bytes.length) {
      c2 = bytes[i++]; c3 = bytes[i++]; var c4 = bytes[i++];
      cp = ((c & 7) << 18) | ((c2 & 63) << 12) | ((c3 & 63) << 6) | (c4 & 63);
      cp -= 0x10000;
      out += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
      continue;
    }
    out += '\uFFFD';
  }
  return out;
}

function getPlayPage(pageUrl) {
  return fetchText(pageUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
  })
    .then(function(playHtml) {
      return getPlayerLangs(pageUrl, playHtml).then(function(langs) {
        return buildStreamsFromLangs(pageUrl, playHtml, langs);
      });
    });
}

function buildStreamsFromLangs(pageUrl, playHtml, langs) {
  var resolvePath = null, authParam = null;
  var resolveMatch = playHtml.match(/var\s+RESOLVE\s*=\s*'([^']*)'\s*,\s*AUTH\s*=\s*'([^']*)'/);
  if (resolveMatch) {
    resolvePath = resolveMatch[1];
    authParam = resolveMatch[2];
  }

  var streams = [];
  if (!langs || !langs.length) return streams;

  // Clasificación de idiomas permitidos (METODO.md §5: Latino, Subtitulado, Inglés, Japonés; nada de España)
  var langGroups = [];
  for (var fl = 0; fl < langs.length; fl++) {
    var tag = classifyLanguage(langs[fl].label);
    if (tag) {
      langGroups.push({ tag: tag, servers: langs[fl].servers || [] });
    }
  }
  if (!langGroups.length) return streams;

  // Orden de preferencia: Latino primero, luego Subtitulado / Inglés / Japonés
  langGroups.sort(function(a, b) {
    if (a.tag === 'Latino' && b.tag !== 'Latino') return -1;
    if (a.tag !== 'Latino' && b.tag === 'Latino') return 1;
    return 0;
  });

  var promises = [];
  for (var g = 0; g < langGroups.length; g++) {
    var grp = langGroups[g];
    var langTag = grp.tag;
    var servers = grp.servers;

    for (var s = 0; s < servers.length; s++) {
      var srv = servers[s];
      var cleanSrc = (srv.src || '').replace(/\\\//g, '/');
      if (!cleanSrc) continue;
      if (cleanSrc.indexOf('//') === 0) cleanSrc = 'https:' + cleanSrc;

      if ((cleanSrc.indexOf('they.tube') !== -1 || cleanSrc.indexOf('the.tube') !== -1) && resolvePath && authParam) {
        var codeMatch = cleanSrc.match(/the(?:y)?\.tube\/(?:e\/)?([A-Za-z0-9_-]+?)(?:\.html)?(?:[?#]|$)/i);
        if (codeMatch) {
          (function(src, title, lTag) {
            promises.push(
              resolveTheyTube(codeMatch[1], resolvePath, authParam, pageUrl)
                .then(function(result) {
                  if (result) {
                    streams.push({
                      name: 'GnulaHD (' + (title || 'Tube') + ')',
                      title: (result.quality || 'HD') + ' · ' + lTag + ' · ' + (title || 'Tube'),
                      url: result.url,
                      quality: result.quality || 'HD',
                      language: lTag,
                      headers: result.headers,
                    });
                  }
                })
            );
          })(cleanSrc, srv.title, langTag);
          continue;
        }
      }

      var serverLabel = getServerLabel(cleanSrc);
      (function(srcUrl, srvTitle, sLabel, lTag) {
        var fixedUrl = mapDomain(srcUrl);
        var resolver = getEmbedResolver(fixedUrl);
        if (resolver) {
          promises.push(
            resolver(fixedUrl)
              .then(function(result) {
                if (result && result.url) {
                  streams.push({
                    name: 'GnulaHD Direct (' + (srvTitle || sLabel) + ')',
                    title: (result.quality || 'HD') + ' · ' + lTag + ' · ' + (srvTitle || sLabel),
                    url: result.url,
                    quality: result.quality || 'HD',
                    language: lTag,
                    headers: result.headers,
                  });
                }
              })
              .catch(function() {
                // Do nothing, skip non-working link
              })
          );
        }
      })(cleanSrc, srv.title, serverLabel, langTag);
    }
  }

  if (promises.length > 0) {
    return Promise.all(promises).then(function() { return streams; });
  }
  return streams;
}
