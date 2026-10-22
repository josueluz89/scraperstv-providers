/**
 * FanPelis (fanpelis.to) — películas y series en latino. v2.0.0 (2026-10-07).
 *
 * La API vieja tmdb.fanpelis.to murió: el dominio ahora sirve una página
 * default de cPanel (404 en /v1/items y /v1/playback). El sitio es un
 * WordPress (tema gomovies) con SPA que se alimenta de su "fastApi"
 * (ver window.siteConfig en el front):
 *   buscar    GET https://fanpelis.to/api/rest/search?post_type=movies,tvshows,animes&query=<titulo>&posts_per_page=10
 *             -> data.posts[] {_id, title, type: "movies"|"tvshows", ...}
 *   player    GET https://fanpelis.to/api/rest/player?post_id=<id>&_any=1
 *             -> data.embeds[] {url, lang, quality}
 *   episodios GET https://fanpelis.to/api/rest/episodes?post_id=<serieId>
 *             -> data[] {_id, season_number, episode_number}
 *
 * Cadena: TMDB id -> título (API TMDB) -> search -> player -> embeds
 * (goodstream, hlswish, voe, filemoon, vimeos…) -> resolvers compartidos ->
 * solo video directo validado. QuickJS-safe: var/function, sin new Function.
 */
import { fetchJson, fetchWithTimeout } from '../shared/http.js';
import { getEmbedResolver, getServerLabel } from '../shared/embedResolvers.js';

var TMDB_API_KEY = '1f54bd990f1cdfb230adb312546d765d';
var API = 'https://fanpelis.to/api/rest';
var UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function hdrs() {
  return { 'User-Agent': UA, Accept: 'application/json' };
}

/** Título + año desde la API de TMDB (lo que otros extractores del repo usan). */
function tituloTmdb(tmdbId, mediaType) {
  var tipo = String(mediaType || 'movie').toLowerCase() === 'movie' ? 'movie' : 'tv';
  var url =
    'https://api.themoviedb.org/3/' + tipo + '/' + tmdbId +
    '?api_key=' + TMDB_API_KEY + '&language=es-MX';
  return fetchJson(url, { headers: hdrs() }, 10000).then(function (d) {
    if (!d) return null;
    var titulo = tipo === 'movie' ? d.title : d.name;
    var original = tipo === 'movie' ? d.original_title : d.original_name;
    var fecha = tipo === 'movie' ? d.release_date : d.first_air_date;
    var anio = fecha && fecha.length >= 4 ? parseInt(fecha.slice(0, 4), 10) : 0;
    return { titulo: titulo || '', original: original || '', anio: anio || 0 };
  }).catch(function () { return null; });
}

/** Normaliza para comparar títulos: minúsculas, solo alfanumérico. */
function norm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9áéíóúñü]/g, '');
}

/** Busca posts y devuelve el mejor candidato para el tipo y año dados. */
function buscar(titulo, tipoApi, anio) {
  var url = API + '/search?post_type=movies,tvshows,animes&query=' +
    encodeURIComponent(titulo) + '&posts_per_page=10';
  return fetchJson(url, { headers: hdrs() }, 12000).then(function (d) {
    if (!d || d.error || !d.data || !d.data.posts) return null;
    var posts = d.data.posts;
    var mejor = null;
    var mejorPts = -1;
    for (var i = 0; i < posts.length; i++) {
      var p = posts[i] || {};
      if (p.type !== tipoApi) continue;
      var pts = 0;
      var nt = norm(p.title);
      var nq = norm(titulo);
      if (nt === nq) pts += 4;
      else if (nt.indexOf(nq) >= 0 || nq.indexOf(nt) >= 0) pts += 2;
      else continue;
      if (anio && String(p.title || '').indexOf('(' + anio + ')') >= 0) pts += 3;
      if (pts > mejorPts) { mejorPts = pts; mejor = p; }
    }
    return mejor;
  }).catch(function () { return null; });
}

/** true si la URL del player responde y devuelve HLS/video de verdad. */
function urlReproducible(url, headers) {
  return fetchWithTimeout(url, { headers: headers }, 12000).then(function (res) {
    if (!res || !res.ok) return false;
    var ct = '';
    try {
      ct = String((res.headers && res.headers.get && res.headers.get('content-type')) || '');
    } catch (e) { ct = ''; }
    if (ct.indexOf('mpegurl') >= 0 || ct.indexOf('video/') >= 0 || ct.indexOf('octet-stream') >= 0) return true;
    return res.text().then(function (cuerpo) {
      return String(cuerpo || '').indexOf('#EXTM3U') >= 0;
    }).catch(function () { return false; });
  }).catch(function () { return false; });
}

/** Plazo máximo por embed. La versión anterior lanzaba todas las resoluciones
 *  sin ningún límite y esperaba a que terminara la más lenta: los hosts
 *  muertos o colgados (goodstream, hlswish) quemaban 30-50 s en reintentos y
 *  el tope global de getStreams devolvía [] aunque VOE/FileMoon ya hubieran
 *  resuelto. Cada embed corre ahora con su propio plazo (35 s) y los que
 *  funcionan entregan sin esperar a los caídos; el tope global queda en
 *  55 s como red de seguridad, bajo el límite de 60 s de la app. */
var PLAZO_EMBED_MS = 35000;

/** Corre una promesa con plazo; si vence, resuelve null. Sin setTimeout
 *  (QuickJS) la promesa corre sin plazo, como el resto del provider. */
function conPlazo(promesa, ms) {
  if (typeof setTimeout === 'undefined') return promesa;
  return Promise.race([
    promesa,
    new Promise(function (res) { setTimeout(function () { res(null); }, ms); })
  ]);
}

/** Resuelve UN embed a stream de video directo validado, o null. */
function resolverUno(em) {
  var url = em.url;
  var resolver = null;
  try { resolver = getEmbedResolver(url); } catch (e) { resolver = null; }
  if (typeof resolver !== 'function') return Promise.resolve(null); // sin resolver: no se emite
  return resolver(url).then(function (r) {
    if (!r || !r.url) return null;
    var cabeceras = { 'User-Agent': UA };
    if (r.headers) {
      var k;
      for (k in r.headers) cabeceras[k] = r.headers[k];
    }
    return urlReproducible(r.url, cabeceras).then(function (ok) {
      if (!ok) return null;
      var lang = em.lang || 'Latino';
      return {
        title: getServerLabel(url) + ' · ' + lang,
        quality: r.quality || em.quality || 'HD',
        language: lang,
        url: r.url,
        headers: cabeceras,
      };
    });
  }).catch(function () { return null; });
}

/** Resuelve los embeds a video directo validado (en paralelo, cada uno
 *  acotado por PLAZO_EMBED_MS). */
function resolverEmbeds(embeds) {
  var vistos = {};
  var lista = [];
  (embeds || []).forEach(function (em) {
    em = em || {};
    var url = em.url;
    if (!url || vistos[url]) return;
    vistos[url] = true;
    lista.push(em);
  });
  var promesas = lista.map(function (em) {
    return conPlazo(resolverUno(em), PLAZO_EMBED_MS);
  });
  return Promise.all(promesas).then(function (res) {
    var streams = [];
    for (var i = 0; i < res.length; i++) {
      if (res[i]) streams.push(res[i]);
    }
    return streams;
  });
}

function playerDe(postId) {
  var url = API + '/player?post_id=' + postId + '&_any=1';
  return fetchJson(url, { headers: hdrs() }, 12000).then(function (d) {
    if (!d || d.error || !d.data || !d.data.embeds) return [];
    return resolverEmbeds(d.data.embeds);
  }).catch(function () { return []; });
}

function episodioId(serieId, season, episode) {
  var url = API + '/episodes?post_id=' + serieId;
  return fetchJson(url, { headers: hdrs() }, 12000).then(function (d) {
    if (!d || d.error || !d.data || !Array.isArray(d.data)) return 0;
    var posts = d.data;
    for (var i = 0; i < posts.length; i++) {
      var p = posts[i] || {};
      if (parseInt(p.season_number, 10) === season && parseInt(p.episode_number, 10) === episode) {
        return p._id || 0;
      }
    }
    return 0;
  }).catch(function () { return 0; });
}

/** Variantes de búsqueda: la API a veces devuelve basura con el artículo inicial. */
function variantesTitulo(info) {
  var v = [];
  function push(t) {
    t = String(t || '').trim();
    if (t && v.indexOf(t) < 0) v.push(t);
  }
  push(info.original);
  push(info.titulo);
  var sinArt = String(info.titulo || '').replace(/^(el|la|los|las|un|una|the|a)\s+/i, '');
  push(sinArt);
  return v;
}

export function extractStreams(tmdbId, mediaType, season, episode) {
  var esPeli = String(mediaType || '').toLowerCase() === 'movie';
  var tipoApi = esPeli ? 'movies' : 'tvshows';
  return tituloTmdb(tmdbId, mediaType).then(function (info) {
    if (!info || !info.titulo) return [];
    var variantes = variantesTitulo(info);
    var cadena = Promise.resolve(null);
    variantes.forEach(function (t) {
      cadena = cadena.then(function (post) {
        if (post) return post;
        return buscar(t, tipoApi, info.anio);
      });
    });
    return cadena.then(function (post) {
      if (!post || !post._id) return [];
      if (esPeli) return playerDe(post._id);
      var s = parseInt(season, 10); if (isNaN(s) || s < 1) s = 1;
      var e = parseInt(episode, 10); if (isNaN(e) || e < 1) e = 1;
      return episodioId(post._id, s, e).then(function (epId) {
        if (!epId) return [];
        return playerDe(epId);
      });
    });
  }).catch(function () { return []; });
}
