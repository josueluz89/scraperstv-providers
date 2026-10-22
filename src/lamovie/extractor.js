/**
 * LaMovie (lamovie.org) — películas y series en latino.
 * REESCRITURA LIMPIA 2026-10-22 (orden del dueño: lo que está mal no se
 * parchea, se escribe de nuevo). Reemplaza por completo al extractor
 * anterior, que devolvía 0 en todo — también en los títulos que el sitio
 * sí tiene (El Club de la Pelea, Breaking Bad, Dune: Parte dos, The Boys).
 *
 * Contrato (docs/CONTRATO.md): getStreams(tmdbId, tipo, temporada,
 * episodio) con tipo como lo manda Nuvio ('movie' | 'series' | 'anime');
 * aquí 'anime' se trata como 'tv' para TMDB y para el sitio. Solo se
 * emiten enlaces de video directo validados; el idioma y la última
 * validación los aplica src/shared/validate.js desde index.js.
 *
 * La cadena, de una sola pieza:
 *   1) TMDB id -> título localizado (es-MX) + título original + año.
 *   2) Búsqueda en la API del sitio (wp-api/v1/search). La API solo
 *      responde si la consulta es subcadena del título guardado, así que
 *      se consulta por el título completo y por su cabeza antes de ':',
 *      de AMBAS variantes; los candidatos se juntan y se elige por
 *      tokens + año (el sitio mezcla títulos: "Dune: Parte dos").
 *   3) Series: episodios (wp-api/v1/single/episodes/list) -> id del
 *      episodio pedido. Películas: directo al post.
 *   4) Player (wp-api/v1/player) -> embeds -> resolvers compartidos,
 *      con tope de 15 s por embed: un host colgado no puede agotar el
 *      presupuesto ni bloquear a los embeds que sí resuelven.
 *   5) Cada URL resuelta se comprueba (debe responder video/HLS real)
 *      antes de emitirse.
 *
 * Se reutiliza lo probado del repo: shared/http.js (fetch con timeout),
 * shared/embedResolvers.js (resolución de embeds) y shared/validate.js
 * (validación final + regla de idioma). QuickJS-safe: var/function,
 * sin new Function, sin String.normalize ni matchAll.
 */
import { fetchJson, fetchWithTimeout } from '../shared/http.js';
import { getEmbedResolver, getServerLabel } from '../shared/embedResolvers.js';

var TMDB_API_KEY = '1f54bd990f1cdfb230adb312546d765d';
var API = 'https://lamovie.org/wp-api/v1';
var UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
var EMBED_TIMEOUT_MS = 15000;

function hdrs() {
  return { 'User-Agent': UA, Accept: 'application/json' };
}

// ─────────────────────────────────────────────────────────
// 1) TMDB: id -> títulos + año
// ─────────────────────────────────────────────────────────

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
    if (!titulo && !original) return null;
    return { titulo: titulo || '', original: original || '', anio: anio || 0 };
  }).catch(function () { return null; });
}

// ─────────────────────────────────────────────────────────
// 2) Búsqueda en el sitio: consultas subcadena + elección por tokens
// ─────────────────────────────────────────────────────────

/** Tokens comparables de un título: palabras en minúsculas, sin el año. */
function tokensDe(s) {
  var partes = String(s || '').toLowerCase().replace(/[^a-z0-9áéíóúñü]+/g, ' ').split(' ');
  var out = [];
  for (var i = 0; i < partes.length; i++) {
    var t = partes[i];
    if (!t) continue;
    if (/^(19|20)\d{2}$/.test(t)) continue; // el año puntúa aparte
    out.push(t);
  }
  return out;
}

/**
 * Parecido entre un post del sitio y las variantes del título buscado:
 * 2 por token exacto, 1 si uno es prefijo del otro (mín. 4 letras);
 * se toma el mejor puntaje entre variantes (localizada y original).
 */
function puntajePost(variantes, tituloPost) {
  var ptoks = tokensDe(tituloPost);
  var mejor = 0;
  for (var v = 0; v < variantes.length; v++) {
    var qtoks = tokensDe(variantes[v]);
    var pts = 0;
    for (var i = 0; i < qtoks.length; i++) {
      var q = qtoks[i];
      var m = 0;
      for (var j = 0; j < ptoks.length; j++) {
        var p = ptoks[j];
        if (q === p) { m = 2; break; }
        if (q.length >= 4 && p.length >= 4 && (p.indexOf(q) === 0 || q.indexOf(p) === 0)) m = 1;
      }
      pts += m;
    }
    if (pts > mejor) mejor = pts;
  }
  return mejor;
}

/** Consultas por título: el completo y su cabeza antes de ':'. */
function consultasDe(titulo) {
  var out = [];
  var t = String(titulo || '').trim();
  if (!t) return out;
  out.push(t);
  var cabeza = t.split(':')[0].trim();
  if (cabeza && cabeza !== t && out.indexOf(cabeza) < 0) out.push(cabeza);
  return out;
}

function buscarPosts(consulta, tipoApi, vistos, candidatos) {
  var url = API + '/search?postType=any&q=' + encodeURIComponent(consulta) + '&postsPerPage=10';
  return fetchJson(url, { headers: hdrs() }, 12000).then(function (d) {
    var posts = (d && !d.error && d.data && d.data.posts) || [];
    for (var i = 0; i < posts.length; i++) {
      var p = posts[i] || {};
      if (p.type !== tipoApi || !p._id || vistos[p._id]) continue;
      vistos[p._id] = true;
      candidatos.push(p);
    }
  }).catch(function () { /* una consulta sin respuesta no frena a las demás */ });
}

/**
 * Junta candidatos con todas las consultas de todas las variantes y
 * devuelve el post de mejor puntaje (≥3, o ≥2 si además calza el año,
 * que suma 3). Sin candidato claro devuelve null: mejor nada que el
 * post equivocado.
 */
function buscar(variantes, tipoApi, anio) {
  var consultas = [];
  for (var v = 0; v < variantes.length; v++) {
    var cs = consultasDe(variantes[v]);
    for (var c = 0; c < cs.length; c++) {
      if (consultas.indexOf(cs[c]) < 0) consultas.push(cs[c]);
    }
  }
  var vistos = {};
  var candidatos = [];
  var cadena = Promise.resolve();
  consultas.forEach(function (q) {
    cadena = cadena.then(function () {
      return buscarPosts(q, tipoApi, vistos, candidatos);
    });
  });
  return cadena.then(function () {
    var mejor = null;
    var mejorPts = -1;
    var mejorAnioOk = false;
    for (var i = 0; i < candidatos.length; i++) {
      var p = candidatos[i];
      var anioOk = !!(anio && String(p.title || '').indexOf('(' + anio + ')') >= 0);
      var pts = puntajePost(variantes, p.title) + (anioOk ? 3 : 0);
      if (pts > mejorPts) { mejorPts = pts; mejor = p; mejorAnioOk = anioOk; }
    }
    if (!mejor) return null;
    if (mejorPts >= 3 || (mejorAnioOk && mejorPts >= 2)) return mejor;
    return null;
  }).catch(function () { return null; });
}

// ─────────────────────────────────────────────────────────
// 3) Episodios y player
// ─────────────────────────────────────────────────────────

function episodioId(serieId, season, episode) {
  var url = API + '/single/episodes/list?_id=' + serieId + '&season=' + season +
    '&page=1&postsPerPage=40';
  return fetchJson(url, { headers: hdrs() }, 12000).then(function (d) {
    var posts = (d && !d.error && d.data && d.data.posts) || [];
    for (var i = 0; i < posts.length; i++) {
      var p = posts[i] || {};
      if (parseInt(p.season_number, 10) === season && parseInt(p.episode_number, 10) === episode) {
        return p._id || 0;
      }
    }
    return 0;
  }).catch(function () { return 0; });
}

function embedsDe(postId) {
  var url = API + '/player?postId=' + postId + '&demo=0';
  return fetchJson(url, { headers: hdrs() }, 12000).then(function (d) {
    if (!d || d.error || !d.data || !d.data.embeds) return [];
    return d.data.embeds;
  }).catch(function () { return []; });
}

// ─────────────────────────────────────────────────────────
// 4) Resolución de embeds: tope por embed + comprobación de video real
// ─────────────────────────────────────────────────────────

function conTope(promesa, ms) {
  if (typeof setTimeout === 'undefined') return promesa;
  return Promise.race([
    promesa,
    new Promise(function (res) {
      setTimeout(function () { res(null); }, ms);
    }),
  ]);
}

/** true si la URL responde y es HLS/video de verdad. */
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

function resolverUno(em) {
  var url = em.url;
  var resolver = null;
  try { resolver = getEmbedResolver(url); } catch (e) { resolver = null; }
  if (typeof resolver !== 'function') return Promise.resolve(null); // sin resolver: no se emite
  var promRes;
  try { promRes = resolver(url); } catch (e) { return Promise.resolve(null); }
  return conTope(Promise.resolve(promRes), EMBED_TIMEOUT_MS).then(function (r) {
    if (!r || !r.url) return null;
    var cabeceras = { 'User-Agent': UA };
    if (r.headers) {
      for (var k in r.headers) cabeceras[k] = r.headers[k];
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

function resolverEmbeds(embeds) {
  var vistos = {};
  var lista = [];
  (embeds || []).forEach(function (em) {
    em = em || {};
    if (!em.url || vistos[em.url]) return;
    vistos[em.url] = true;
    lista.push(em);
  });
  return Promise.all(lista.map(resolverUno)).then(function (res) {
    var streams = [];
    for (var i = 0; i < res.length; i++) {
      if (res[i]) streams.push(res[i]);
    }
    return streams;
  });
}

// ─────────────────────────────────────────────────────────
// Cadena completa
// ─────────────────────────────────────────────────────────

export function extraer(tmdbId, mediaType, season, episode) {
  var esPeli = String(mediaType || '').toLowerCase() === 'movie';
  var tipoApi = esPeli ? 'movies' : 'tvshows';
  return tituloTmdb(tmdbId, mediaType).then(function (info) {
    if (!info) return [];
    var variantes = [];
    if (info.titulo) variantes.push(info.titulo);
    if (info.original && info.original !== info.titulo) variantes.push(info.original);
    if (!variantes.length) return [];
    return buscar(variantes, tipoApi, info.anio).then(function (post) {
      if (!post || !post._id) return [];
      if (esPeli) {
        return embedsDe(post._id).then(resolverEmbeds);
      }
      var s = parseInt(season, 10); if (isNaN(s) || s < 1) s = 1;
      var e = parseInt(episode, 10); if (isNaN(e) || e < 1) e = 1;
      return episodioId(post._id, s, e).then(function (epId) {
        if (!epId) return [];
        return embedsDe(epId).then(resolverEmbeds);
      });
    });
  }).catch(function () { return []; });
}
