import { fetchText } from '../shared/http.js';
import { extractIframeSrc, resolveCapituloIframe } from './extractor.js';

var BASE_URL = 'https://www.lacartoons.com';

function absUrl(u) {
  if (!u) return null;
  u = String(u).replace(/&amp;/g, '&');
  if (u.indexOf('http') === 0) return u;
  if (u.indexOf('//') === 0) return 'https:' + u;
  if (u.indexOf('/') === 0) return BASE_URL + u;
  return BASE_URL + '/' + u;
}

function textClean(s) {
  return (s || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

/**
 * Catálogo del sitio: GET /?page=N (16 series por página).
 * Devuelve [{id, title, img, year, canal}].
 */
export function getCatalogo(page) {
  page = parseInt(page, 10) || 1;
  if (page < 1) page = 1;
  return fetchText(BASE_URL + '/?page=' + page, { headers: { Referer: BASE_URL + '/' } }).then(function(html) {
    var out = [];
    var seen = {};
    var re = /<a\s+href="\/serie\/(\d+)"[^>]*>([\s\S]*?)<\/a>/gi;
    var m;
    while ((m = re.exec(html)) !== null) {
      var id = m[1];
      if (seen[id]) continue;
      var block = m[2];
      if (block.indexOf('nombre-serie') < 0) continue;
      var tm = block.match(/nombre-serie[^>]*>([^<]+)</i);
      var title = tm ? textClean(tm[1]) : null;
      if (!title) continue;
      seen[id] = 1;
      var im = block.match(/<img[^>]*src="([^"]+)"/i);
      var ym = block.match(/marcador-ano[^>]*>(\d{4})</i);
      var cm = block.match(/marcadorSeries[^>]*>\s*([^<]+?)\s*</i);
      out.push({
        id: id,
        title: title,
        img: absUrl(im ? im[1] : null),
        year: ym ? ym[1] : null,
        canal: cm ? textClean(cm[1]) : null
      });
    }
    return out;
  }).catch(function(){ return []; });
}

/**
 * Ficha de serie: GET /serie/{id}.
 * Devuelve {id, title, temporadas: [{temporada, episodios: [{numero, titulo, capituloId, temporada}]}]}
 * o null si falla.
 */
export function getSerie(serieId) {
  serieId = String(serieId || '').replace(/\D/g, '');
  if (!serieId) return Promise.resolve(null);
  return fetchText(BASE_URL + '/serie/' + serieId, { headers: { Referer: BASE_URL + '/' } }).then(function(html) {
    var tm = html.match(/subtitulo-serie-seccion[^>]*>([^<]+)/i);
    var title = tm ? textClean(tm[1]) : ('Serie ' + serieId);
    var temporadas = [];
    var seenEp = {};
    var h4re = /<h4[^>]*data-temporada-id="(\d+)"[^>]*>[\s\S]*?<\/h4>([\s\S]*?)(?=<h4[^>]*data-temporada-id=|<\/section>)/gi;
    var m;
    while ((m = h4re.exec(html)) !== null) {
      var tid = parseInt(m[1], 10) || 1;
      var eps = extraerEpisodiosBloque(m[2], tid, seenEp);
      if (eps.length) temporadas.push({ temporada: tid, episodios: eps });
    }
    // sin bloques de temporada: lista plana como temporada 1
    if (!temporadas.length) {
      var flat = extraerEpisodiosBloque(html, 1, seenEp);
      if (flat.length) temporadas.push({ temporada: 1, episodios: flat });
    }
    return { id: serieId, title: title, temporadas: temporadas };
  }).catch(function(){ return null; });
}

function extraerEpisodiosBloque(html, temporada, seenEp) {
  var eps = [];
  var epRe = /<a[^>]*href="\/serie\/capitulo\/(\d+)[^"]*"[^>]*>\s*<span>\s*Capitulo\s*(\d+)-\s*<\/span>\s*([^<]*?)\s*<\/a>/gi;
  var em;
  while ((em = epRe.exec(html)) !== null) {
    var key = temporada + ':' + em[2];
    if (seenEp[key]) continue;
    seenEp[key] = 1;
    eps.push({
      numero: parseInt(em[2], 10),
      titulo: textClean(em[3]) || ('Capitulo ' + em[2]),
      capituloId: em[1],
      temporada: temporada
    });
  }
  return eps;
}

/**
 * Resuelve el capítulo a stream directo: GET /serie/capitulo/{id}?t={temporada}.
 * Devuelve {name, title, url, quality, headers} o null.
 */
export function getStreamCapitulo(capituloId, temporada) {
  capituloId = String(capituloId || '').replace(/\D/g, '');
  temporada = parseInt(temporada, 10) || 1;
  if (!capituloId) return Promise.resolve(null);
  var epUrl = BASE_URL + '/serie/capitulo/' + capituloId + '?t=' + temporada;
  return fetchText(epUrl, { headers: { Referer: BASE_URL + '/' } }).then(function(capHtml) {
    var iframeSrc = extractIframeSrc(capHtml);
    return resolveCapituloIframe(iframeSrc, temporada, 1).then(function(streams) {
      if (streams && streams.length && streams[0].url) return streams[0];
      return null;
    });
  }).catch(function(){ return null; });
}
