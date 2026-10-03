import { fetchText, fetchJson } from '../shared/http.js';
import { isRpmvidIframe, resolveRpmvidStream } from '../shared/rpmvid.js';
import { getEmbedResolver } from '../shared/embedResolvers.js';

var TMDB_API_KEY = '1f54bd990f1cdfb230adb312546d765d';
var BASE_URL = 'https://www.lacartoons.com';
var EMBED_ORIGIN = 'https://cubeembed.rpmvid.com';

// ---------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------
var ACCENT_MAP = {
  '\u00e1': 'a', '\u00e9': 'e', '\u00ed': 'i', '\u00f3': 'o', '\u00fa': 'u',
  '\u00fc': 'u', '\u00f1': 'n', '\u00c1': 'a', '\u00c9': 'e', '\u00cd': 'i',
  '\u00d3': 'o', '\u00da': 'u', '\u00dc': 'u', '\u00d1': 'n', '\u00e0': 'a',
  '\u00e8': 'e', '\u00ec': 'i', '\u00f2': 'o', '\u00f9': 'u', '\u00e2': 'a',
  '\u00ea': 'e', '\u00ee': 'i', '\u00f4': 'o', '\u00fb': 'u', '\u00e4': 'a',
  '\u00eb': 'e', '\u00ef': 'i', '\u00f6': 'o', '\u00e7': 'c', '\u00e3': 'a',
  '\u00f5': 'o'
};
function stripAccents(s) {
  return String(s || '').replace(/[^\x00-\x7F]/g, function (c) { return ACCENT_MAP[c] || ''; });
}
function norm(s) {
  return stripAccents(String(s || '').toLowerCase()).replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}
// El sitio es 100% español: queries en japonés/chino/coreano nunca dan resultados.
function isLatin(s) {
  var n = norm(s);
  return n.length >= 2 && /[a-z]/.test(n);
}
function keywords(s) {
  return norm(s).split(' ').filter(function (w) { return w.length >= 4; });
}

// ---------------------------------------------------------------------------
// TMDB
// ---------------------------------------------------------------------------
function getMediaTitle(tmdbId, tmdbType) {
  var base = 'https://api.themoviedb.org/3/' + tmdbType + '/' + tmdbId + '?api_key=' + TMDB_API_KEY;
  return Promise.all([
    fetchJson(base + '&language=es-MX').catch(function () { return null; }),
    fetchJson(base + '&language=en-US').catch(function () { return null; })
  ]).then(function (rs) {
    var es = rs[0] || {}, en = rs[1] || {};
    var isMovie = tmdbType === 'movie';
    return {
      title: isMovie ? (es.title || en.title) : (es.name || en.name),
      englishTitle: isMovie ? en.title : en.name,
      originalTitle: isMovie ? (es.original_title || en.original_title) : (es.original_name || en.original_name)
    };
  });
}

// Aliases conocidos: título TMDB -> cómo lo cataloga el sitio.
var TITLE_ALIASES = [
  { match: ['casper'], extra: ['gasparin', 'gasparin y sus amigos'] },
  { match: ['saint seiya'], extra: ['caballeros del zodiaco', 'los caballeros del zodiaco'] }
];
function aliasQueries(title) {
  var n = ' ' + norm(title) + ' ';
  var out = [];
  for (var i = 0; i < TITLE_ALIASES.length; i++) {
    var a = TITLE_ALIASES[i];
    for (var j = 0; j < a.match.length; j++) {
      if (n.indexOf(' ' + a.match[j] + ' ') !== -1) {
        for (var k = 0; k < a.extra.length; k++) {
          if (out.indexOf(a.extra[k]) < 0) out.push(a.extra[k]);
        }
        break;
      }
    }
  }
  return out;
}

function buildQueries(media) {
  var seen = {};
  var out = [];
  function add(q) {
    var nq = norm(q);
    if (nq && nq.length >= 2 && !seen[nq]) { seen[nq] = 1; out.push(q); }
  }
  var titles = [media.title, media.englishTitle, media.originalTitle];
  for (var i = 0; i < titles.length; i++) {
    if (titles[i] && isLatin(titles[i])) {
      add(titles[i]);
      var kw = keywords(titles[i]);
      for (var j = 0; j < kw.length; j++) add(kw[j]);
    }
  }
  var aliases = aliasQueries(media.title || '').concat(aliasQueries(media.englishTitle || ''));
  for (var k = 0; k < aliases.length; k++) add(aliases[k]);
  return out.slice(0, 12);
}

// ---------------------------------------------------------------------------
// Búsqueda en el sitio: GET /?Titulo={q}
// ---------------------------------------------------------------------------
function searchSite(query) {
  var url = BASE_URL + '/?Titulo=' + encodeURIComponent(query);
  return fetchText(url, { headers: { Referer: BASE_URL + '/' } }).then(function (html) {
    var out = [];
    var seen = {};
    var re = /<a[^>]*href="\/serie\/(\d+)"[^>]*>([\s\S]*?)<\/a>/gi;
    var m;
    while ((m = re.exec(html)) !== null) {
      var id = m[1];
      if (seen[id]) continue;
      var tm = m[2].match(/nombre-serie[^>]*>([^<]+)</i);
      if (!tm) continue;
      var title = tm[1].replace(/\s+/g, ' ').trim();
      if (!title) continue;
      seen[id] = 1;
      out.push({ id: id, title: title });
    }
    return out;
  }).catch(function () { return []; });
}

function scoreCandidate(candTitle, media) {
  var nc = norm(candTitle);
  var names = [];
  [media.title, media.englishTitle, media.originalTitle].forEach(function (t) {
    var nt = norm(t);
    if (nt && names.indexOf(nt) < 0) names.push(nt);
  });
  // Los aliases también cuentan como nombre válido (p. ej. "gasparin").
  var aliases = aliasQueries(media.title || '').concat(aliasQueries(media.englishTitle || ''));
  aliases.forEach(function (a) {
    var na = norm(a);
    if (na && names.indexOf(na) < 0) names.push(na);
  });
  if (names.indexOf(nc) !== -1) return 100;
  var best = 0;
  for (var i = 0; i < names.length; i++) {
    var n = names[i];
    if (!n) continue;
    if (nc.indexOf(n) !== -1 || n.indexOf(nc) !== -1) best = Math.max(best, 80);
    else {
      var wn = n.split(' '), wc = nc.split(' ');
      var hit = 0;
      for (var j = 0; j < wn.length; j++) if (wc.indexOf(wn[j]) !== -1) hit++;
      if (wn.length && hit / wn.length >= 0.6) best = Math.max(best, 50);
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Serie: GET /serie/{id} -> temporadas y episodios
// Estructura actual del sitio:
//   <h4 ... data-temporada-id="1">Temporada 1</h4>
//   <a href="/serie/capitulo/{capId}?t={temp}"><span>Capitulo {n}-</span> ...</a>
// ---------------------------------------------------------------------------
function parseSerie(html) {
  var seasons = [];
  var re = /data-temporada-id="(\d+)"[^>]*>[\s\S]*?Temporada\s*(\d+)|<a[^>]*href="\/serie\/capitulo\/(\d+)\?t=(\d+)"[^>]*>[\s\S]*?<span[^>]*>\s*Capitulo\s*(\d+)/gi;
  var m;
  var current = null;
  // Dos pasadas: primero temporadas, luego episodios por temporada.
  var h4re = /<h4[^>]*data-temporada-id="(\d+)"[^>]*>/gi;
  var blocks = [];
  while ((m = h4re.exec(html)) !== null) {
    blocks.push({ temp: parseInt(m[1], 10), index: m.index });
  }
  for (var b = 0; b < blocks.length; b++) {
    var start = blocks[b].index;
    var end = b + 1 < blocks.length ? blocks[b + 1].index : html.length;
    var chunk = html.slice(start, end);
    var eps = [];
    var are = /<a[^>]*href="\/serie\/capitulo\/(\d+)\?t=(\d+)"[^>]*>[\s\S]*?<span[^>]*>\s*Capitulo\s*(\d+)/gi;
    var am;
    while ((am = are.exec(chunk)) !== null) {
      eps.push({ numero: parseInt(am[3], 10), capituloId: am[1], temporada: parseInt(am[2], 10) });
    }
    eps.sort(function (x, y) { return x.numero - y.numero; });
    seasons.push({ temporada: blocks[b].temp, episodios: eps });
  }
  return seasons;
}

function findEpisode(seasons, season, episode) {
  for (var i = 0; i < seasons.length; i++) {
    if (seasons[i].temporada === season) {
      var eps = seasons[i].episodios;
      for (var j = 0; j < eps.length; j++) {
        if (eps[j].numero === episode) return eps[j];
      }
      return null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Capítulo: GET /serie/capitulo/{capId}?t={temp} -> iframe -> stream
// El sitio usa varios hosts (cubeembed/rpmvid, ok.ru, etc.)
// ---------------------------------------------------------------------------
function extractIframe(html) {
  var m = html.match(/<iframe[^>]*src="([^"]+)"/i);
  if (m) return m[1].replace(/&amp;/g, '&');
  m = html.match(/https?:\/\/cubeembed\.rpmvid\.com\/#[A-Za-z0-9]+/);
  return m ? m[0] : null;
}

function resolveIframe(iframeSrc) {
  if (!iframeSrc) return Promise.resolve(null);
  if (iframeSrc.indexOf('//') === 0) iframeSrc = 'https:' + iframeSrc;
  if (isRpmvidIframe(iframeSrc)) {
    return resolveRpmvidStream(iframeSrc).catch(function () { return null; });
  }
  var fixed = iframeSrc;
  try { fixed = decodeURIComponent(fixed); } catch (e) {}
  var resolver = getEmbedResolver(fixed);
  if (!resolver) return Promise.resolve(null);
  return resolver(fixed).catch(function () { return null; });
}

// ---------------------------------------------------------------------------
// Flujo principal
// ---------------------------------------------------------------------------
function extractStreams(tmdbId, mediaType, season, episode) {
  var tmdbType = mediaType === 'movie' ? 'movie' : 'tv';
  return getMediaTitle(tmdbId, tmdbType).then(function (media) {
    if (!media.title && !media.englishTitle) return [];
    var queries = buildQueries(media);
    var searches = queries.map(function (q) { return searchSite(q); });
    return Promise.all(searches).then(function (results) {
      var cands = [];
      var seen = {};
      results.forEach(function (list) {
        list.forEach(function (c) {
          if (!seen[c.id]) { seen[c.id] = 1; cands.push(c); }
        });
      });
      if (!cands.length) return [];
      var best = null, bestScore = -1;
      cands.forEach(function (c) {
        var s = scoreCandidate(c.title, media);
        if (s > bestScore) { bestScore = s; best = c; }
      });
      if (!best || bestScore < 50) return [];
      return fetchText(BASE_URL + '/serie/' + best.id, { headers: { Referer: BASE_URL + '/' } })
        .then(function (html) {
          var seasons = parseSerie(html);
          var ep = findEpisode(seasons, season, episode);
          if (!ep) return [];
          var capUrl = BASE_URL + '/serie/capitulo/' + ep.capituloId + '?t=' + ep.temporada;
          return fetchText(capUrl, { headers: { Referer: BASE_URL + '/serie/' + best.id } })
            .then(function (capHtml) {
              var iframe = extractIframe(capHtml);
              if (!iframe) return [];
              return resolveIframe(iframe).then(function (r) {
                if (!r || !r.url) return [];
                var host = '';
                try { host = iframe.split('/')[2] || ''; } catch (e) {}
                return [{
                  name: 'LaCartoons',
                  title: 'LaCartoons ' + (r.quality || '720p') + ' Latino',
                  url: r.url,
                  quality: r.quality || '720p',
                  language: 'Latino',
                  headers: r.headers || { Referer: EMBED_ORIGIN + '/', Origin: EMBED_ORIGIN }
                }];
              });
            });
        })
        .catch(function () { return []; });
    });
  }).catch(function () { return []; });
}

export { extractStreams, extractIframe, parseSerie, resolveIframe, searchSite, getMediaTitle, norm };
