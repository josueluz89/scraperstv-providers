/**
 * LaMovie (lamovie.org) — películas y series en latino. v3.0.0 (2026-10-07).
 *
 * La API vieja tmdb.lamovie.org (/v1/items y /v1/playback) murió: devuelve 404
 * en todo. El sitio ahora es un WordPress con SPA que se alimenta de su
 * "fastApi" (ver window.siteConfig en el front):
 *   buscar    GET https://lamovie.org/wp-api/v1/search?postType=any&q=<titulo>&postsPerPage=10
 *             -> data.posts[] {_id, title, type: "movies"|"tvshows", ...}
 *   player    GET https://lamovie.org/wp-api/v1/player?postId=<id>&demo=0
 *             -> data.embeds[] {url, lang, quality}
 *   episodios GET https://lamovie.org/wp-api/v1/single/episodes/list?_id=<serieId>&season=<s>&page=1&postsPerPage=40
 *             -> data.posts[] {_id, season_number, episode_number}
 *
 * Cadena: TMDB id -> título (API TMDB) -> search -> player -> embeds
 * (goodstream, hlswish, voe, filemoon, vimeos…) -> resolvers compartidos ->
 * solo video directo validado. QuickJS-safe: var/function, sin new Function.
 */
import { fetchJson, fetchWithTimeout } from '../shared/http.js';
import { getEmbedResolver, getServerLabel } from '../shared/embedResolvers.js';

var TMDB_API_KEY = '1f54bd990f1cdfb230adb312546d765d';
var API = 'https://lamovie.org/wp-api/v1';
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
  var url = API + '/search?postType=any&q=' + encodeURIComponent(titulo) + '&postsPerPage=10';
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

/** Resuelve los embeds a video directo validado (en paralelo). */
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
  var url = API + '/player?postId=' + postId + '&demo=0';
  return fetchJson(url, { headers: hdrs() }, 12000).then(function (d) {
    if (!d || d.error || !d.data || !d.data.embeds) return [];
    return resolverEmbeds(d.data.embeds);
  }).catch(function () { return []; });
}

function episodioId(serieId, season, episode) {
  var url = API + '/single/episodes/list?_id=' + serieId + '&season=' + season +
    '&page=1&postsPerPage=40';
  return fetchJson(url, { headers: hdrs() }, 12000).then(function (d) {
    if (!d || d.error || !d.data || !d.data.posts) return 0;
    var posts = d.data.posts;
    for (var i = 0; i < posts.length; i++) {
      var p = posts[i] || {};
      if (parseInt(p.season_number, 10) === season && parseInt(p.episode_number, 10) === episode) {
        return p._id || 0;
      }
    }
    return 0;
  }).catch(function () { return 0; });
}

export function extraer(tmdbId, mediaType, season, episode) {
  var esPeli = String(mediaType || '').toLowerCase() === 'movie';
  var tipoApi = esPeli ? 'movies' : 'tvshows';
  return tituloTmdb(tmdbId, mediaType).then(function (info) {
    if (!info || !info.titulo) return [];
    function conTitulo(t) {
      return buscar(t, tipoApi, info.anio);
    }
    return conTitulo(info.titulo).then(function (post) {
      if (!post && info.original && info.original !== info.titulo) {
        return conTitulo(info.original);
      }
      return post;
    }).then(function (post) {
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
