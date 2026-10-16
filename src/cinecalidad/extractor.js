/**
 * CineCalidad (cinecalidad.am) — películas y series en latino. v3.0.0 (2026-10-07).
 *
 * La API vieja tmdb.cinecalidad.am (/v1/items y /v1/playback) murió: 404 en
 * todo. El sitio volvió a ser el WordPress clásico scrapeable:
 *   buscar    GET https://www.cinecalidad.am/?s=<titulo>
 *             -> <a href=".../ver-pelicula/<slug>/">TituloAño…</a>
 *                <a href=".../ver-serie/<slug>/">…</a>
 *   película  GET <url ver-pelicula> -> data-option="<embed>" (vimeos, voe…)
 *   episodio  GET https://www.cinecalidad.am/ver-el-episodio/<serieSlug>-<s>x<e>/
 *             -> data-option="<embed>"
 *
 * Cadena: TMDB id -> título (API TMDB) -> ?s= -> mejor match por título+año ->
 * data-option -> resolvers compartidos -> solo video directo validado.
 * QuickJS-safe: var/function, sin new Function, sin regex con grupos raros.
 */
import { fetchText, fetchWithTimeout } from '../shared/http.js';
import { getEmbedResolver, getServerLabel } from '../shared/embedResolvers.js';

var TMDB_API_KEY = '1f54bd990f1cdfb230adb312546d765d';
var BASE = 'https://www.cinecalidad.am';
var UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function hdrs() {
  return { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' };
}

/** Título + año desde la API de TMDB (lo que otros extractores del repo usan). */
function tituloTmdb(tmdbId, mediaType) {
  var tipo = String(mediaType || 'movie').toLowerCase() === 'movie' ? 'movie' : 'tv';
  var url =
    'https://api.themoviedb.org/3/' + tipo + '/' + tmdbId +
    '?api_key=' + TMDB_API_KEY + '&language=es-MX';
  return fetchWithTimeout(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } }, 10000)
    .then(function (res) {
      if (!res || !res.ok) return null;
      return res.json();
    }).then(function (d) {
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

/** Saca los links ver-pelicula/ver-serie del HTML de búsqueda. */
function linksDeBusqueda(html, tipo) {
  var marca = tipo === 'movie' ? 'ver-pelicula/' : 'ver-serie/';
  var res = [];
  var vistos = {};
  var re = /<a[^>]*href="([^"]*ver-(?:pelicula|serie)\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    var href = m[1];
    if (href.indexOf(marca) < 0 || vistos[href]) continue;
    vistos[href] = true;
    var txt = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    res.push({ href: href, texto: txt });
  }
  return res;
}

/** Mejor candidato por título (+año si viene en el texto del link). */
function mejorMatch(links, titulo, anio) {
  var mejor = null;
  var mejorPts = -1;
  var nq = norm(titulo);
  for (var i = 0; i < links.length; i++) {
    var l = links[i];
    var nt = norm(l.texto);
    var pts = 0;
    if (nt === nq) pts += 4;
    else if (nt.indexOf(nq) >= 0 || nq.indexOf(nt) >= 0) pts += 2;
    else continue;
    if (anio && l.texto.indexOf(String(anio)) >= 0) pts += 3;
    if (pts > mejorPts) { mejorPts = pts; mejor = l; }
  }
  return mejor;
}

function buscar(titulo, tipo, anio) {
  var url = BASE + '/?s=' + encodeURIComponent(titulo);
  return fetchText(url, { headers: hdrs() }, 12000).then(function (html) {
    var links = linksDeBusqueda(html, tipo);
    return mejorMatch(links, titulo, anio);
  }).catch(function () { return null; });
}

/** Embeds data-option de una página (se excluye youtube). */
function embedsDePagina(html) {
  var res = [];
  var vistos = {};
  var re = /data-option="([^"]+)"/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    var u = m[1];
    if (!u || vistos[u]) continue;
    if (u.indexOf('youtube.com') >= 0 || u.indexOf('youtu.be') >= 0) continue;
    vistos[u] = true;
    res.push({ url: u, lang: 'Latino', quality: 'HD' });
  }
  return res;
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
  var promesas = embeds.map(function (em) {
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
        return {
          title: getServerLabel(url) + ' · Latino',
          quality: r.quality || 'HD',
          language: 'Latino',
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

function paginaAStreams(url) {
  return fetchText(url, { headers: hdrs() }, 12000).then(function (html) {
    var embeds = embedsDePagina(html);
    if (!embeds.length) return [];
    return resolverEmbeds(embeds);
  }).catch(function () { return []; });
}

/** slug de serie desde su URL ver-serie. */
function slugSerie(href) {
  var m = String(href).match(/ver-serie\/([^\/\?#]+)/);
  return m ? m[1] : '';
}

export function extractStreams(tmdbId, mediaType, season, episode) {
  var esPeli = String(mediaType || '').toLowerCase() === 'movie';
  var tipo = esPeli ? 'movie' : 'tv';
  return tituloTmdb(tmdbId, mediaType).then(function (info) {
    if (!info || !info.titulo) return [];
    var titulos = [info.titulo];
    if (info.original && info.original !== info.titulo) titulos.push(info.original);
    var cadena = Promise.resolve(null);
    titulos.forEach(function (t) {
      cadena = cadena.then(function (hit) {
        if (hit) return hit;
        return buscar(t, tipo, info.anio);
      });
    });
    return cadena.then(function (hit) {
      if (!hit) return [];
      if (esPeli) return paginaAStreams(hit.href);
      var s = parseInt(season, 10); if (isNaN(s) || s < 1) s = 1;
      var e = parseInt(episode, 10); if (isNaN(e) || e < 1) e = 1;
      var slug = slugSerie(hit.href);
      if (!slug) return [];
      var epUrl = BASE + '/ver-el-episodio/' + slug + '-' + s + 'x' + e + '/';
      return paginaAStreams(epUrl);
    });
  }).catch(function () { return []; });
}
