/**
 * PelisJuanita (pelisjuanita.org) — películas, series y novelas en latino. v1.0.0.
 *
 * El sitio es una SPA (videoapi.la) que se alimenta de su API REST:
 *   buscar    GET https://pelisjuanita.org/api/rest/v1/search?q=<titulo>
 *             -> { items[] { kind: "movie"|"serie"|"novel", slug, tmdb_id,
 *                catalog_item_id, url: "/pelicula|/serie|/novela/<slug>", year } }
 *   contenido GET https://pelisjuanita.org/api/rest/v1/content + <item.url>
 *             -> { item { player_url (películas), catalog_item_id, ... } }
 *   episodios GET https://pelisjuanita.org/api/rest/v1/episodes?item_id=<catalogId>
 *             &season=<s>&limit=30&page=<p>
 *             -> { episodes[] { season, episode, player_url } }
 *   player    Cada player_url es https://videoapp.mov/e/{movie|novel|serie}/...
 *             -> la página tiene un iframe a vimeos.net/embed-....html?cf=<JWT>
 *             -> el embed de vimeos expone window.VIDAPI_CF_STREAM_RESPONSE
 *                con data.stream_urls[] (m3u8 directo).
 *
 * OJO: el embed de vimeos solo sirve el stream si el Referer es videoapp.mov
 * o pelisjuanita.org (con Referer vimeos.net devuelve página sin stream).
 * Por eso la resolución del embed es propia (con Referer correcto) y no usa
 * el resolver genérico de vimeos de embedResolvers.js.
 *
 * MATCH POR TMDB ID (no solo por título): TMDB puede devolver el título con
 * otra ortografía que el sitio ("Bepannaah" vs "Bepannah") y el match por
 * título fallaría. La búsqueda del sitio devuelve tmdb_id nativo por item,
 * así que primero se matchea por tmdb_id exacto y solo si no hay coincidencia
 * se usa el puntaje por título.
 * Fallback: si la búsqueda no da nada, se construye la URL de videoapp.mov
 * directo desde el TMDB ID (el sitio usa TMDB IDs nativos):
 *   película: https://videoapp.mov/e/movie/{tmdb}
 *   TV novela: https://videoapp.mov/e/novel/{tmdb}/{s}/{e}
 *   TV serie:  https://videoapp.mov/e/tv/{tmdb}/{s}/{e}
 *
 * Cadena: TMDB id -> título (API TMDB) -> search -> contenido -> episodios
 * (TV) -> player -> iframe vimeos -> m3u8 directo. Solo video directo
 * validado por withWorkingStreams (que además aplica el filtro de idioma
 * global: Latino / SUB / Inglés / Japonés, nada de España).
 *
 * QuickJS-safe: var/function, sin new Function/eval.
 */
import { fetchJson, fetchText } from '../shared/http.js';
import { getEmbedResolver, getServerLabel } from '../shared/embedResolvers.js';

var TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c'; // misma que otros providers
var API = 'https://pelisjuanita.org/api/rest/v1';
var BASE = 'https://pelisjuanita.org';
var UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function hdrs() {
  return { 'User-Agent': UA, Accept: 'application/json' };
}

/** Título + año desde la API de TMDB (lo que otros extractores del repo usan). */
function tituloTmdb(tmdbId, mediaType) {
  var tipo = String(mediaType || 'movie').toLowerCase() === 'movie' ? 'movie' : 'tv';
  var url =
    'https://api.themoviedb.org/3/' +
    tipo +
    '/' +
    tmdbId +
    '?api_key=' +
    TMDB_API_KEY +
    '&language=es-MX';
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

/** Busca en el catálogo y devuelve el mejor candidato.
 * Primero matchea por TMDB ID exacto (robusto a diferencias de ortografía
 * entre TMDB y el sitio); si no hay coincidencia, usa puntaje por título. */
function buscar(titulo, esPeli, anio, tmdbId) {
  var url = API + '/search?q=' + encodeURIComponent(titulo);
  return fetchJson(url, { headers: hdrs() }, 12000).then(function (d) {
    if (!d || !d.items || !d.items.length) return null;
    var wanted = parseInt(tmdbId, 10);
    // Pase 1: TMDB ID exacto.
    for (var i = 0; i < d.items.length; i++) {
      var it0 = d.items[i] || {};
      var kind0 = String(it0.kind || '').toLowerCase();
      if (esPeli) {
        if (kind0 !== 'movie') continue;
      } else {
        if (kind0 !== 'novel' && kind0 !== 'serie' && kind0 !== 'tv') continue;
      }
      if (!isNaN(wanted) && parseInt(it0.tmdb_id, 10) === wanted) return it0;
    }
    // Pase 2: puntaje por título.
    var mejor = null;
    var mejorPts = -1;
    for (var j = 0; j < d.items.length; j++) {
      var it = d.items[j] || {};
      var kind = String(it.kind || '').toLowerCase();
      if (esPeli) {
        if (kind !== 'movie') continue;
      } else {
        if (kind !== 'novel' && kind !== 'serie' && kind !== 'tv') continue;
      }
      var pts = 0;
      var nt = norm(it.title);
      var nq = norm(titulo);
      if (nt === nq) pts += 4;
      else if (nt.indexOf(nq) >= 0 || nq.indexOf(nt) >= 0) pts += 2;
      else continue;
      if (anio && parseInt(it.year, 10) === anio) pts += 3;
      if (pts > mejorPts) { mejorPts = pts; mejor = it; }
    }
    return mejor;
  }).catch(function () { return null; });
}

/** Contenido completo de un item (da player_url en películas, catalog_item_id en TV). */
function contenido(item) {
  if (!item || !item.url) return Promise.resolve(null);
  var url = API + '/content' + item.url;
  return fetchJson(url, { headers: hdrs() }, 12000).then(function (d) {
    if (!d || !d.item) return null;
    return d.item;
  }).catch(function () { return null; });
}

/** Player URL del episodio pedido (pagina el API de episodios). */
function episodioPlayerUrl(catalogId, season, episode) {
  var page = 1;
  function siguiente() {
    if (page > 20) return Promise.resolve(null);
    var url = API + '/episodes?item_id=' + catalogId + '&season=' + season +
      '&limit=30&page=' + page;
    return fetchJson(url, { headers: hdrs() }, 12000).then(function (d) {
      var eps = (d && d.episodes) || [];
      for (var i = 0; i < eps.length; i++) {
        var ep = eps[i] || {};
        if (parseInt(ep.season, 10) === season && parseInt(ep.episode, 10) === episode) {
          return ep.player_url || null;
        }
      }
      if (!eps.length) return null;
      page++;
      return siguiente();
    }).catch(function () { return null; });
  }
  return siguiente();
}

/** Extrae el m3u8 de VIDAPI_CF_STREAM_RESPONSE de la página del embed de vimeos. */
function streamDeVimeos(html) {
  try {
    if (!html) return null;
    var m = html.match(/stream_urls"\s*:\s*\[\s*"([^"]+?\.m3u8[^"]*?)"/i) ||
            html.match(/stream_urls'\s*:\s*\[\s*'([^']+?\.m3u8[^']*?)'/i);
    if (m && m[1]) {
      var u = m[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
      if (u.indexOf('//') === 0) u = 'https:' + u;
      if (u.indexOf('http') === 0) return u;
    }
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Resuelve una player_url de videoapp.mov a video directo.
 * La página del player tiene un iframe (normalmente vimeos). El embed de
 * vimeos exige Referer videoapp.mov / pelisjuanita.org para servir el stream.
 */
function resolverPlayer(playerUrl) {
  if (!playerUrl) return Promise.resolve(null);
  return fetchText(playerUrl, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      Referer: BASE + '/'
    }
  }, 12000).then(function (html) {
    var iframes = [];
    var re = /<iframe[^>]+src="([^"]+)"/gi;
    var m;
    while ((m = re.exec(html)) !== null) {
      if (iframes.indexOf(m[1]) === -1) iframes.push(m[1]);
    }
    if (!iframes.length) return null;
    // Intentar cada iframe en orden; el primero que dé m3u8 gana.
    function probar(idx) {
      if (idx >= iframes.length) return Promise.resolve(null);
      var src = iframes[idx];
      if (src.indexOf('//') === 0) src = 'https:' + src;
      if (src.indexOf('vimeos') !== -1) {
        return fetchText(src, {
          headers: {
            'User-Agent': UA,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            Referer: 'https://videoapp.mov/'
          }
        }, 20000).then(function (vh) {
          var u = streamDeVimeos(vh);
          if (u) {
            return {
              title: 'Vimeos · Latino',
              quality: 'HD',
              language: 'Latino',
              url: u,
              headers: { 'User-Agent': UA, Referer: BASE + '/' }
            };
          }
          return probar(idx + 1);
        }).catch(function () { return probar(idx + 1); });
      }
      // Otro host: resolver genérico compartido.
      var resolver = null;
      try { resolver = getEmbedResolver(src); } catch (e) { resolver = null; }
      if (typeof resolver !== 'function') return probar(idx + 1);
      return resolver(src).then(function (r) {
        if (r && r.url) {
          var cab = { 'User-Agent': UA, Referer: BASE + '/' };
          if (r.headers) { for (var k in r.headers) cab[k] = r.headers[k]; }
          return {
            title: getServerLabel(src) + ' · Latino',
            quality: r.quality || 'HD',
            language: 'Latino',
            url: r.url,
            headers: cab
          };
        }
        return probar(idx + 1);
      }).catch(function () { return probar(idx + 1); });
    }
    return probar(0);
  }).catch(function () { return null; });
}

export function extraer(tmdbId, mediaType, season, episode) {
  var esPeli = String(mediaType || '').toLowerCase() === 'movie';
  var s = parseInt(season, 10); if (isNaN(s) || s < 1) s = 1;
  var e = parseInt(episode, 10); if (isNaN(e) || e < 1) e = 1;

  /** Fallback: videoapp.mov directo desde el TMDB ID (el sitio usa TMDB IDs nativos). */
  function directo() {
    if (esPeli) {
      return resolverPlayer('https://videoapp.mov/e/movie/' + tmdbId).then(function (st) {
        return st ? [st] : [];
      });
    }
    // TV: probar novela primero y serie después (no se sabe el kind sin la API del sitio).
    return resolverPlayer('https://videoapp.mov/e/novel/' + tmdbId + '/' + s + '/' + e)
      .then(function (st) {
        if (st) return [st];
        return resolverPlayer('https://videoapp.mov/e/tv/' + tmdbId + '/' + s + '/' + e)
          .then(function (st2) { return st2 ? [st2] : []; });
      });
  }

  return tituloTmdb(tmdbId, mediaType).then(function (info) {
    if (!info || !info.titulo) return directo();
    function conTitulo(t) {
      return buscar(t, esPeli, info.anio, tmdbId);
    }
    return conTitulo(info.titulo).then(function (item) {
      if (!item && info.original && info.original !== info.titulo) {
        return conTitulo(info.original);
      }
      return item;
    }).then(function (item) {
      if (!item || !item.url) return directo();
      return contenido(item).then(function (det) {
        if (!det) return directo();
        if (esPeli) {
          var pUrl = det.player_url || '';
          if (!pUrl) return directo();
          return resolverPlayer(pUrl).then(function (st) {
            if (st) return [st];
            return directo();
          });
        }
        var catalogId = det.catalog_item_id || item.catalog_item_id;
        if (!catalogId) return directo();
        return episodioPlayerUrl(catalogId, s, e).then(function (epUrl) {
          if (!epUrl) return directo();
          return resolverPlayer(epUrl).then(function (st2) {
            if (st2) return [st2];
            return directo();
          });
        });
      });
    });
  }).catch(function () { return []; });
}
