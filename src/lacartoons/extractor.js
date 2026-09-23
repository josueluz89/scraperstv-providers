import { fetchText, fetchJson } from '../shared/http.js';
import { getEmbedResolver } from '../shared/embedResolvers.js';
import { isRpmvidIframe, resolveRpmvidStream } from '../shared/rpmvid.js';

var TMDB_API_KEY = '1f54bd990f1cdfb230adb312546d765d';
var BASE_URL = 'https://www.lacartoons.com';

var ACCENT_MAP = { '\u00e1': 'a', '\u00e9': 'e', '\u00ed': 'i', '\u00f3': 'o', '\u00fa': 'u', '\u00fc': 'u', '\u00f1': 'n', '\u00c1': 'a', '\u00c9': 'a', '\u00cd': 'i', '\u00d3': 'o', '\u00da': 'u', '\u00dc': 'u', '\u00d1': 'n', '\u00e0': 'a', '\u00e8': 'e', '\u00ec': 'i', '\u00f2': 'o', '\u00f9': 'u', '\u00e2': 'a', '\u00ea': 'e', '\u00ee': 'i', '\u00f4': 'o', '\u00fb': 'u', '\u00e4': 'a', '\u00eb': 'e', '\u00ef': 'i', '\u00f6': 'o', '\u00e7': 'c', '\u00e3': 'a', '\u00f5': 'o' };
function stripAccents(s) { return (s || '').replace(/[^\x00-\x7F]/g, function(c) { return ACCENT_MAP[c] || ''; }); }
function normalizeText(text) {
  if (!text) return '';
  return stripAccents(text.toLowerCase()).replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

function getMediaTitle(tmdbId, tmdbType) {
  var url = 'https://api.themoviedb.org/3/' + tmdbType + '/' + tmdbId + '?api_key=' + TMDB_API_KEY + '&language=es-MX';
  return fetchJson(url).then(function(data) {
    var isMovie = tmdbType === 'movie';
    var date = isMovie ? data.release_date : data.first_air_date;
    return {
      title: isMovie ? data.title : data.name,
      originalTitle: isMovie ? data.original_title : data.original_name,
      year: date && date.length >= 4 ? date.slice(0, 4) : null
    };
  });
}

function searchSite(query) {
  var url = BASE_URL + '/?Titulo=' + encodeURIComponent(query);
  return fetchText(url, { headers: { Referer: BASE_URL + '/' } }).then(function(html) {
    var out = [];
    // primary: <a href="/serie/123"> ... <p class="nombre-serie">Title</p>
    var re = /<a[^>]*href="\/serie\/(\d+)"[^>]*>[\s\S]*?<p[^>]*class="[^"]*nombre-serie[^"]*"[^>]*>([^<]+)<\/p>/gi;
    var m;
    while ((m = re.exec(html)) !== null) {
      var id = m[1];
      var title = m[2].replace(/<[^>]*>/g, '').trim();
      if (!id || !title) continue;
      out.push({ id: id, title: title, href: BASE_URL + '/serie/' + id });
    }
    // fallback: any /serie/ link with nearby title
    if (out.length === 0) {
      var re2 = /<a[^>]*href="\/serie\/(\d+)"[^>]*>[\s\S]*?<\/a>/gi;
      var seen = {};
      while ((m = re2.exec(html)) !== null) {
        var id2 = m[1];
        if (seen[id2]) continue;
        seen[id2] = 1;
        // try to extract title near link
        var snippet = html.slice(m.index, m.index + 800);
        var tm = snippet.match(/nombre-serie[^>]*>([^<]+)</i);
        var t = tm ? tm[1].trim() : 'Serie ' + id2;
        out.push({ id: id2, title: t, href: BASE_URL + '/serie/' + id2 });
      }
    }
    return out;
  }).catch(function() { return []; });
}

function pickBest(cands, media) {
  var no = normalizeText(media.originalTitle || '');
  var nt = normalizeText(media.title || '');
  var best = null, bestScore = -1;
  for (var i = 0; i < cands.length; i++) {
    var c = cands[i];
    var nc = normalizeText(c.title);
    var score = 0;
    if (nc === no || nc === nt) score = 100;
    else if ((no && (nc.indexOf(no) !== -1 || no.indexOf(nc) !== -1)) || (nt && (nc.indexOf(nt) !== -1 || nt.indexOf(nc) !== -1))) score = 80;
    if (score === 0) {
      var words = (no + ' ' + nt).split(' ').filter(function(w){ return w.length >= 3; });
      var qm = 0;
      for (var w = 0; w < words.length; w++) if (nc.indexOf(words[w]) !== -1) qm++;
      if (qm === 0) continue;
      score = qm * 15;
    }
    if (media.year && c.title.indexOf(media.year) !== -1) score += 5;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  if (!best || bestScore < 10) return null;
  return best;
}

function extractEpisodeUrl(serieHtml, season, episode) {
  season = parseInt(season, 10) || 1;
  episode = parseInt(episode, 10) || 1;
  // Try temporada blocks
  var temporadaRe = /<h4[^>]*data-temporada-id="(\d+)"[^>]*>[\s\S]*?<\/h4>([\s\S]*?)(?=<h4[^>]*data-temporada-id=|<\/section>)/gi;
  var m;
  var found = null;
  while ((m = temporadaRe.exec(serieHtml)) !== null) {
    var tid = parseInt(m[1], 10);
    var block = m[2];
    var epRe = /<a[^>]*href="(\/serie\/capitulo\/[^"]+)"[^>]*>/gi;
    var links = [];
    var em;
    while ((em = epRe.exec(block)) !== null) {
      var href = em[1];
      // html decode &amp;
      href = href.replace(/&amp;/g, '&');
      if (href.indexOf('/serie/capitulo/') === 0) links.push(href);
    }
    if (tid === season) {
      if (episode >= 1 && episode <= links.length) return links[episode - 1];
      // if not found but block exists, return null to avoid wrong season
      return null;
    }
    // also collect for flat fallback
    if (!found) found = links;
  }
  // fallback: flat list of all capitulo links in order
  if (!found) {
    var flatRe = /<a[^>]*href="(\/serie\/capitulo\/[^"]+)"[^>]*>/gi;
    var flat = [];
    while ((m = flatRe.exec(serieHtml)) !== null) {
      var h = m[1].replace(/&amp;/g, '&');
      flat.push(h);
    }
    // global index: (season-1)*? + episode -> if multi-season assume sequential
    var idx = episode - 1;
    // if season>1 try to estimate offset by counting but we don't know per-season count, so just take episode-1 globally if season==1
    if (season === 1 && flat[idx]) return flat[idx];
    if (flat[idx]) return flat[idx];
  }
  return null;
}

function extractIframeSrc(capituloHtml) {
  var m = capituloHtml.match(/<iframe[^>]*src="([^"]+)"[^>]*>/i);
  if (m) return m[1].replace(/&amp;/g, '&');
  // fallback: any cubeembed/rpmvid url in page
  var m2 = capituloHtml.match(/https?:\/\/[^"']*rpmvid[^"']*/i);
  if (m2) return m2[0];
  var m3 = capituloHtml.match(/https?:\/\/[^"']*cubeembed[^"']*/i);
  if (m3) return m3[0];
  return null;
}

export function extractStreams(tmdbId, mediaType, season, episode) {
  var tmdbType = (mediaType === 'tv' || mediaType === 'series' || mediaType === 'anime') ? 'tv' : 'movie';
  // lacartoons is series-only; movies return []
  if (tmdbType === 'movie') return Promise.resolve([]);
  season = parseInt(season, 10) || 1;
  episode = parseInt(episode, 10) || 1;

  return getMediaTitle(tmdbId, tmdbType).then(function(media) {
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
      if (all.length > 0) return all;
      // fallback: search by keywords (lacartoons search is strict)
      var STOPWORDS = { y:1, de:1, la:1, el:1, los:1, las:1, un:1, una:1, del:1, al:1, e:1, u:1, o:1, en:1, con:1, por:1, para:1, the:1, a:1, an:1, of:1, and:1, to:1, in:1, on:1, vs:1 };
      var allText = normalizeText((media.originalTitle||'') + ' ' + (media.title||''));
      var words = allText.split(' ').filter(function(w){ return w.length>=3 && !STOPWORDS[w]; });
      var unique = {}; var keywords=[];
      for(var i=0;i<words.length;i++){ if(!unique[words[i]]){ unique[words[i]]=1; keywords.push(words[i]); }}
      keywords.sort(function(a,b){ return b.length - a.length; });
      keywords = keywords.slice(0,3);
      if (!keywords.length) return all;
      var kChain = Promise.resolve();
      keywords.forEach(function(kw){
        kChain = kChain.then(function(){ return searchSite(kw).then(function(c){ all = all.concat(c); }); });
      });
      return kChain.then(function(){ return all; });
    }).then(function(cands) {
      var best = pickBest(cands, media);
      if (!best) return [];
      return fetchText(best.href, { headers: { Referer: BASE_URL + '/' } }).then(function(serieHtml) {
        var epPath = extractEpisodeUrl(serieHtml, season, episode);
        if (!epPath) return [];
        var epUrl = epPath.indexOf('http') === 0 ? epPath : BASE_URL + epPath;
        return fetchText(epUrl, { headers: { Referer: best.href } }).then(function(capHtml) {
          var iframeSrc = extractIframeSrc(capHtml);
          if (!iframeSrc) return [];
          // normalize protocol-relative
          if (iframeSrc.indexOf('//') === 0) iframeSrc = 'https:' + iframeSrc;
          if (iframeSrc.indexOf('http') !== 0) {
            if (iframeSrc.indexOf('/') === 0) iframeSrc = 'https://cubeembed.rpmvid.com' + iframeSrc;
            else iframeSrc = 'https://' + iframeSrc;
          }

          if (isRpmvidIframe(iframeSrc)) {
            return resolveRpmvidStream(iframeSrc).then(function(r) {
              if (r && r.url) {
                return [{ name: 'LaCartoons (Rpmvid)', title: (r.quality || '720p') + ' \u00b7 LAT \u00b7 Rpmvid S' + season + 'E' + episode, url: r.url, quality: r.quality || '720p', headers: r.headers }];
              }
              return [];
            }).catch(function(){ return []; });
          }

          // fallback to generic resolvers (ok.ru etc)
          var fixed = iframeSrc;
          try { fixed = decodeURIComponent(fixed); } catch(e){}
          var resolver = getEmbedResolver(fixed);
          if (!resolver) return [];
          return resolver(fixed).then(function(r) {
            if (r && r.url) {
              var host = '';
              try { host = fixed.split('/')[2]; } catch(e){}
              return [{ name: 'LaCartoons (' + host + ')', title: (r.quality || 'HD') + ' \u00b7 LAT \u00b7 ' + host + ' S' + season + 'E' + episode, url: r.url, quality: r.quality || 'HD', headers: r.headers }];
            }
            return [];
          }).catch(function(){ return []; });
        });
      });
    });
  }).catch(function(err){
    console.error('[LaCartoons] Error: ' + (err && err.message ? err.message : err));
    return [];
  });
}