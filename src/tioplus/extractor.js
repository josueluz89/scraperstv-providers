import { fetchText, fetchJson } from '../shared/http.js';
import { unpackPacked } from '../shared/embedResolvers.js';

var TMDB_API_KEY = '1f54bd990f1cdfb230adb312546d765d';
var BASE_URL = 'https://tioplus.app';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

var ACCENT_MAP = { 'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u', 'ü': 'u', 'ñ': 'n', 'Á': 'a', 'É': 'e', 'Í': 'i', 'Ó': 'o', 'Ú': 'u', 'Ü': 'u', 'Ñ': 'n', 'à': 'a', 'è': 'e', 'ì': 'i', 'ò': 'o', 'ù': 'u', 'â': 'a', 'ê': 'e', 'î': 'i', 'ô': 'o', 'û': 'u', 'ä': 'a', 'ë': 'e', 'ï': 'i', 'ö': 'o', 'ç': 'c', 'ã': 'a', 'õ': 'o' };
function stripAccents(s) {
  return String(s || '').replace(/[^\x00-\x7F]/g, function (c) { return ACCENT_MAP[c] || ''; });
}
function norm(s) {
  return stripAccents(String(s || '').toLowerCase()).replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function base64Encode(str) {
  // btoa UTF-8 safe
  var utf8 = unescape(encodeURIComponent(str));
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var out = '', i;
  for (i = 0; i < utf8.length; i += 3) {
    var a = utf8.charCodeAt(i), b = utf8.charCodeAt(i + 1), c = utf8.charCodeAt(i + 2);
    var n = (a << 16) | ((isNaN(b) ? 0 : b) << 8) | (isNaN(c) ? 0 : c);
    out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63] + (isNaN(b) ? '=' : chars[(n >> 6) & 63]) + (isNaN(c) ? '=' : chars[n & 63]);
  }
  return out;
}

function getMediaTitle(tmdbId) {
  var url = 'https://api.themoviedb.org/3/movie/' + tmdbId + '?api_key=' + TMDB_API_KEY + '&language=es-MX';
  return fetchJson(url, { headers: { 'User-Agent': UA } }).then(function (d) {
    return { title: d.title || d.original_title, year: (d.release_date || '').slice(0, 4) };
  }).catch(function () { return null; });
}

function searchMovie(query) {
  var url = BASE_URL + '/api/search/' + encodeURIComponent(query);
  return fetchText(url, { headers: { 'User-Agent': UA, Referer: BASE_URL + '/' } }).then(function (html) {
    var out = [];
    var re = /<a[^>]*class=['"]itemA['"][^>]*href="([^"]+)"[\s\S]*?<h2>([^<]+)<\/h2>/gi;
    var m;
    while ((m = re.exec(html)) !== null) {
      out.push({ url: m[1], title: m[2].replace(/\s+/g, ' ').trim() });
    }
    return out;
  }).catch(function () { return []; });
}

function scoreCandidate(candTitle, mediaTitle) {
  var nc = norm(candTitle), nt = norm(mediaTitle);
  if (!nc || !nt) return 0;
  if (nc === nt) return 100;
  // quitar año entre paréntesis del candidato: "el club de la lucha 1999"
  nc = nc.replace(/\b(19|20)\d{2}\b/g, '').replace(/\s+/g, ' ').trim();
  if (nc === nt) return 100;
  if (nc.indexOf(nt) !== -1 || nt.indexOf(nc) !== -1) return 80;
  var wn = nt.split(' '), wc = nc.split(' ');
  var hit = 0;
  for (var i = 0; i < wn.length; i++) if (wc.indexOf(wn[i]) !== -1) hit++;
  if (wn.length && hit / wn.length >= 0.6) return 50;
  return 0;
}

function extractServers(html) {
  var out = [];
  var re = /<li[^>]*data-server=["']([^"']+)["'][^>]*>[\s\S]*?<span>([^<]+)<\/span>/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    var ds = String(m[1] || '').trim();
    var name = String(m[2] || '').replace(/\s+/g, ' ').trim();
    if (ds && name) out.push({ dataServer: ds, name: name });
  }
  return out;
}

function extractEmbedUrl(playerHtml) {
  var html = String(playerHtml || '');
  var m = html.match(/(?:window\.)?location\.href\s*=\s*['"]([^'"]+)['"]/);
  if (m) return m[1];
  m = html.match(/<iframe[^>]*src=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

function resolveVidhide(embedUrl, referer) {
  // vidhideplus.com/v/xxx -> 301 a callistanise.com/v/xxx; el HTML trae JS
  // empaquetado con los m3u8.
  return fetchText(embedUrl, {
    headers: { 'User-Agent': UA, Referer: referer || BASE_URL + '/' }
  }).then(function (html) {
    var packed = null;
    try { packed = unpackPacked(html); } catch (e) {}
    var script = packed || html;
    var m = script.match(/:\s*"([^"]*\.m3u8[^"]*)"/i);
    if (!m) return null;
    var url = m[1];
    // preferir URL absoluta con dominio
    if (url.indexOf('http') !== 0) {
      var om = embedUrl.match(/^(https?:\/\/[^\/]+)/);
      url = (om ? om[1] : BASE_URL) + (url.charAt(0) === '/' ? '' : '/') + url;
    }
    return {
      name: 'TioPlus',
      title: 'TioPlus HD Latino',
      url: url,
      quality: 'HD',
      language: 'Latino',
      headers: { Referer: BASE_URL + '/', 'User-Agent': UA }
    };
  }).catch(function () { return null; });
}

function resolveServer(item, referer) {
  var playerUrl = BASE_URL + '/player/' + base64Encode(item.dataServer);
  return fetchText(playerUrl, { headers: { 'User-Agent': UA, Referer: referer } }).then(function (playerHtml) {
    var embed = extractEmbedUrl(playerHtml);
    if (!embed) return null;
    // vidhide / dood / etc: resolución directa
    if (/vidhide|callistanise|dhtpre|vibuxer|streamwish/i.test(embed)) {
      return resolveVidhide(embed, playerUrl);
    }
    return null;
  }).catch(function () { return null; });
}

function extractStreams(tmdbId, mediaType, season, episode) {
  // tioplus es películas; TV no soportado por el sitio actualmente
  if (mediaType && mediaType !== 'movie') return Promise.resolve([]);
  return getMediaTitle(tmdbId).then(function (media) {
    if (!media || !media.title) return [];
    var queries = [media.title];
    var words = norm(media.title).split(' ').filter(function (w) { return w.length >= 4; });
    // agregar 1-2 keywords distintivas
    for (var i = 0; i < Math.min(2, words.length); i++) {
      if (queries.indexOf(words[i]) < 0) queries.push(words[i]);
    }
    var searches = queries.map(function (q) { return searchMovie(q); });
    return Promise.all(searches).then(function (results) {
      var cands = [], seen = {};
      results.forEach(function (list) {
        list.forEach(function (c) {
          if (!seen[c.url]) { seen[c.url] = 1; cands.push(c); }
        });
      });
      if (!cands.length) return [];
      var best = null, bestScore = -1;
      cands.forEach(function (c) {
        var s = scoreCandidate(c.title, media.title);
        if (s > bestScore) { bestScore = s; best = c; }
      });
      if (!best || bestScore < 50) return [];
      return fetchText(best.url, { headers: { 'User-Agent': UA, Referer: BASE_URL + '/' } }).then(function (html) {
        var servers = extractServers(html);
        if (!servers.length) return [];
        // resolver en serie, máximo 4 servidores
        var chain = Promise.resolve([]);
        servers.slice(0, 4).forEach(function (srv) {
          chain = chain.then(function (acc) {
            return resolveServer(srv, best.url).then(function (r) {
              if (r) acc.push(r);
              return acc;
            });
          });
        });
        return chain;
      }).catch(function () { return []; });
    });
  }).catch(function () { return []; });
}

export { extractStreams };
