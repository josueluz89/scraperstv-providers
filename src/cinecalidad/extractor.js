/**
 * CineCalidad (cinecalidad.am) — películas y series en latino.
 * Reescritura limpia 2026-10-22 (sustituye a la v3.0.0; sin parches encima).
 *
 * Contrato: getStreams(tmdbId, mediaType, season, episode) con mediaType de
 * Nuvio ('movie' | 'series' | 'anime'; lo que no es 'movie' se trata como tv
 * para TMDB). El título se resuelve SIEMPRE vía TMDB desde el id. Solo se
 * emite video directo ya validado; el idioma lo filtra la validación
 * compartida (src/shared/validate.js, envuelta en index.js).
 *
 * Cómo es el sitio hoy (verificado en vivo 2026-10-22):
 *   buscar    GET https://www.cinecalidad.am/?s=<consulta>
 *             -> resultados con anchors a /ver-pelicula/<slug>/ y
 *                /ver-serie/<slug>/ cuyo texto es "Título Año Sinopsis…".
 *             -> la misma página trae widgets laterales con anchors de solo
 *                imagen (texto vacío) a otras películas: NO son resultados.
 *   película  GET <url ver-pelicula> -> data-option="<embed>" (vimeos, voe…)
 *   episodio  GET /ver-el-episodio/<slugSerie>-<s>x<e>/ -> data-option=…
 *
 * La búsqueda WP del sitio no encuentra los títulos TMDB tal cual cuando el
 * post usa otra grafía: Dune 2 (TMDB 693134) está posteado como
 * "Dune: Parte dos" y ni "Duna: Parte dos" ni "Dune: Part Two" devuelven
 * resultados. Por eso la búsqueda prueba, en orden: título TMDB en español,
 * título original y la primera palabra de ambos; y el match decide por el
 * SLUG del href (el slug del post de Dune 2 es duna-parte-dos, derivado del
 * título en español), con el texto y el año como apoyo. Un anchor sin texto
 * nunca puntúa: antes el texto "" calzaba con cualquier título
 * (indexOf('') === 0) y el provider devolvía una película equivocada.
 *
 * Cadena: TMDB id -> títulos -> ?s= -> match por slug/texto/año -> ficha ->
 * data-option -> resolvers compartidos -> chequeo de video real -> streams.
 * QuickJS-safe: var/function, sin new Function, sin normalize/matchAll.
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

/** Título español, título original y año desde la API de TMDB. */
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

/** Normaliza para comparar textos: minúsculas, solo alfanumérico. */
function norm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9áéíóúñü]/g, '');
}

/** Forma de slug de un título: sin acentos, no-alfanuméricos a '-'. */
function slugify(s) {
  var t = String(s || '').toLowerCase()
    .replace(/[áàäâ]/g, 'a').replace(/[éèëê]/g, 'e').replace(/[íìïî]/g, 'i')
    .replace(/[óòöô]/g, 'o').replace(/[úùüû]/g, 'u').replace(/ñ/g, 'n');
  return t.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** slug del post desde su URL ver-pelicula/ver-serie. */
function slugDeHref(href) {
  var m = String(href || '').match(/ver-(?:pelicula|serie)\/([^\/\?#]+)/);
  return m ? m[1] : '';
}

/** Links de resultado según el tipo, con su texto y su slug. */
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
    res.push({ href: href, texto: txt, slug: slugDeHref(href) });
  }
  return res;
}

/**
 * Elige el post correcto entre los links de una búsqueda.
 * infos = [{titulo, slug}] con los títulos TMDB (español y original).
 * Puntaje: slug exacto del post = 6, slug con sufijo del sitio
 * ("-online-gratis-…") = 5, texto igual = 4, texto que contiene al título
 * (o título que contiene un texto de al menos 3 caracteres) = 2, y +3 si el
 * año de TMDB aparece en el texto. Sin slug ni texto que calce: se descarta.
 * Los anchors sin texto (widgets de imagen) jamás puntúan por texto.
 */
function mejorMatch(links, infos, anio) {
  var mejor = null;
  var mejorPts = 0;
  for (var i = 0; i < links.length; i++) {
    var l = links[i];
    var pts = 0;
    var j, nq, nt;
    for (j = 0; j < infos.length; j++) {
      if (!infos[j].slug) continue;
      if (l.slug === infos[j].slug) pts = Math.max(pts, 6);
      else if (l.slug.indexOf(infos[j].slug + '-') === 0) pts = Math.max(pts, 5);
    }
    nt = norm(l.texto);
    if (nt) {
      for (j = 0; j < infos.length; j++) {
        nq = norm(infos[j].titulo);
        if (!nq) continue;
        if (nt === nq) pts = Math.max(pts, 4);
        else if (nt.indexOf(nq) >= 0 || (nt.length >= 3 && nq.indexOf(nt) >= 0)) pts = Math.max(pts, 2);
      }
    }
    if (pts <= 0) continue;
    if (anio && l.texto.indexOf(String(anio)) >= 0) pts += 3;
    if (pts > mejorPts) { mejorPts = pts; mejor = l; }
  }
  return mejor;
}

/** Una consulta a la búsqueda del sitio, ya con el match aplicado. */
function buscar(consulta, infos, tipo, anio) {
  var url = BASE + '/?s=' + encodeURIComponent(consulta);
  return fetchText(url, { headers: hdrs() }, 12000).then(function (html) {
    return mejorMatch(linksDeBusqueda(html, tipo), infos, anio);
  }).catch(function () { return null; });
}

/**
 * Consultas a probar, en orden: título en español, título original, primera
 * palabra del original y primera palabra del español. La primera palabra es
 * el respaldo para los posts cuya grafía difiere de TMDB; el match por
 * slug/año evita que ese respaldo amplio elija un post equivocado.
 */
function consultasDe(info) {
  var consultas = [];
  function add(q) {
    if (q && consultas.indexOf(q) < 0) consultas.push(q);
  }
  function primeraPalabra(titulo) {
    var p = String(titulo || '').split(/\s+/)[0].replace(/:+$/, '');
    return p && p.length >= 3 ? p : '';
  }
  add(info.titulo);
  add(info.original);
  add(primeraPalabra(info.original));
  add(primeraPalabra(info.titulo));
  return consultas;
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

export function extractStreams(tmdbId, mediaType, season, episode) {
  var esPeli = String(mediaType || '').toLowerCase() === 'movie';
  var tipo = esPeli ? 'movie' : 'tv';
  return tituloTmdb(tmdbId, mediaType).then(function (info) {
    if (!info || !info.titulo) return [];
    var infos = [{ titulo: info.titulo, slug: slugify(info.titulo) }];
    if (info.original && info.original !== info.titulo) {
      infos.push({ titulo: info.original, slug: slugify(info.original) });
    }
    var consultas = consultasDe(info);
    var cadena = Promise.resolve(null);
    consultas.forEach(function (q) {
      cadena = cadena.then(function (hit) {
        if (hit) return hit;
        return buscar(q, infos, tipo, info.anio);
      });
    });
    return cadena.then(function (hit) {
      if (!hit) return [];
      if (esPeli) return paginaAStreams(hit.href);
      var s = parseInt(season, 10); if (isNaN(s) || s < 1) s = 1;
      var e = parseInt(episode, 10); if (isNaN(e) || e < 1) e = 1;
      if (!hit.slug) return [];
      var epUrl = BASE + '/ver-el-episodio/' + hit.slug + '-' + s + 'x' + e + '/';
      return paginaAStreams(epUrl);
    });
  }).catch(function () { return []; });
}
