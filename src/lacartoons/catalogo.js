import { fetchText } from '../shared/http.js';
import { extractIframe, parseSerie, resolveIframe } from './extractor.js';
import { isRpmvidIframe } from '../shared/rpmvid.js';

var BASE_URL = 'https://www.lacartoons.com';
var EMBED_ORIGIN = 'https://cubeembed.rpmvid.com';

function absUrl(u) {
  if (!u) return null;
  u = String(u).replace(/&amp;/g, '&');
  if (u.indexOf('http') === 0) return u;
  if (u.indexOf('//') === 0) return 'https:' + u;
  if (u.indexOf('/') === 0) return BASE_URL + u;
  return BASE_URL + '/' + u;
}

function textClean(s) {
  return String(s || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

/**
 * Catálogo del sitio: GET /?page=N.
 * Devuelve [{id, title, img, year}].
 */
export function getCatalogo(page) {
  page = parseInt(page, 10) || 1;
  if (page < 1) page = 1;
  return fetchText(BASE_URL + '/?page=' + page, { headers: { Referer: BASE_URL + '/' } }).then(function (html) {
    var out = [];
    var seen = {};
    var re = /<a[^>]*href="\/serie\/(\d+)"[^>]*>([\s\S]*?)<\/a>/gi;
    var m;
    while ((m = re.exec(html)) !== null) {
      var id = m[1];
      if (seen[id]) continue;
      if (m[2].indexOf('nombre-serie') < 0) continue;
      var tm = m[2].match(/nombre-serie[^>]*>([^<]+)</i);
      var title = tm ? textClean(tm[1]) : null;
      if (!title) continue;
      seen[id] = 1;
      var im = m[2].match(/<img[^>]*src="([^"]+)"/i);
      out.push({ id: id, title: title, img: absUrl(im ? im[1] : null) });
    }
    return out;
  }).catch(function () { return []; });
}

/**
 * Ficha de serie: GET /serie/{id}.
 * Devuelve {id, temporadas: [{temporada, episodios: [{numero, capituloId}]}]}.
 */
export function getSerie(serieId) {
  return fetchText(BASE_URL + '/serie/' + serieId, { headers: { Referer: BASE_URL + '/' } }).then(function (html) {
    var seasons = parseSerie(html);
    var title = null;
    var tm = html.match(/<title>([^<]*)<\/title>/i);
    if (tm) title = textClean(tm[1]);
    return { id: String(serieId), title: title, temporadas: seasons };
  }).catch(function () { return null; });
}

/**
 * Stream de un capítulo: resuelve el iframe del capítulo.
 */
export function getStreamCapitulo(serieId, temporada, numero) {
  return getSerie(serieId).then(function (serie) {
    if (!serie) return [];
    var ep = null;
    serie.temporadas.forEach(function (s) {
      if (s.temporada === temporada) {
        s.episodios.forEach(function (e) { if (e.numero === numero) ep = e; });
      }
    });
    if (!ep) return [];
    var capUrl = BASE_URL + '/serie/capitulo/' + ep.capituloId + '?t=' + ep.temporada;
    return fetchText(capUrl, { headers: { Referer: BASE_URL + '/serie/' + serieId } }).then(function (html) {
      var iframe = extractIframe(html);
      if (!iframe) return [];
      return resolveIframe(iframe).then(function (r) {
        if (!r || !r.url) return [];
        return [{
          name: 'LaCartoons',
          title: 'LaCartoons ' + (r.quality || '720p') + ' Latino',
          url: r.url,
          quality: r.quality || '720p',
          language: 'Latino',
          headers: r.headers || { Referer: EMBED_ORIGIN + '/', Origin: EMBED_ORIGIN }
        }];
      });
    }).catch(function () { return []; });
  });
}
