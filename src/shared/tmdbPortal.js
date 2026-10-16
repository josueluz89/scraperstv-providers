/**
 * Portal "tmdb-api-ui" (lamovie.org, cinecalidad.am…): la web es una SPA que se
 * alimenta de una API JSON propia indexada por TMDB, y publica el reproductor en
 * `window.siteConfig.playerProvider` con la plantilla `%fileCode%`.
 *
 * Cadena verificada 2026-09-24:
 *   película : GET <apiBase>/v1/items/movie/<tmdbId>                        -> item.code
 *   episodio : GET <apiBase>/v1/items/tvshow/<tmdbId>/seasons/<s>/episodes/<e> -> episode.code
 *   player   : <playerProvider>.replace('%fileCode%', code)  (p.ej. vimeos.net/embed-<code>.html)
 *
 * El player se resuelve con los resolvers compartidos (vimeos = familia streamwish);
 * si no resuelve, se emite el embed tal cual (el reproductor de la app lo abre).
 */
import { fetchJson, fetchWithTimeout } from './http.js';
import { getEmbedResolver, getServerLabel } from './embedResolvers.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export function portalPlayerUrl(player, code) {
  if (!player || !code || String(player).indexOf('%fileCode%') < 0) return '';
  return String(player).replace('%fileCode%', code);
}

export function portalCodeUrl(apiBase, tmdbId, mediaType, season, episode) {
  var esPelicula = String(mediaType || '').toLowerCase() === 'movie';
  if (esPelicula) return apiBase + '/v1/items/movie/' + tmdbId;
  var s = parseInt(season, 10);
  if (isNaN(s) || s < 1) s = 1;
  var e = parseInt(episode, 10);
  if (isNaN(e) || e < 1) e = 1;
  return apiBase + '/v1/items/tvshow/' + tmdbId + '/seasons/' + s + '/episodes/' + e;
}

/** URL del endpoint nuevo (schema v3): devuelve los embeds directos con host/idioma/calidad. */
export function portalPlaybackUrl(apiBase, tmdbId, mediaType, season, episode) {
  var esPelicula = String(mediaType || '').toLowerCase() === 'movie';
  if (esPelicula) return apiBase + '/v1/playback/movie/' + tmdbId;
  var s = parseInt(season, 10);
  if (isNaN(s) || s < 1) s = 1;
  var e = parseInt(episode, 10);
  if (isNaN(e) || e < 1) e = 1;
  return apiBase + '/v1/playback/tvshow/' + tmdbId + '?season=' + s + '&episode=' + e;
}

/** Extrae el `code` del JSON de la API (item para películas, episode para series). */
export function portalCode(data) {
  if (!data || typeof data !== 'object') return '';
  var nodo = data.item || data.episode || null;
  if (!nodo || !nodo.code) return '';
  return String(nodo.code);
}

export function portalTitles(apiBase, tmdbId, mediaType, season, episode) {
  return fetchJson(portalCodeUrl(apiBase, tmdbId, mediaType, season, episode), {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  }, 12000);
}

/**
 * @param {string} apiBase   p.ej. https://tmdb.lamovie.org
 * @param {string} player    plantilla del reproductor (%fileCode%) — solo para el flujo viejo
 * @returns {Promise<Array>} streams
 */
export async function extraerPortal(apiBase, player, tmdbId, mediaType, season, episode) {
  // API nueva (schema v3, 2026-09-30): /v1/playback devuelve los embeds directos
  // con host/idioma/calidad. El /v1/items/... + code del flujo viejo ya no trae `code`.
  var embeds = [];
  try {
    var data = await fetchJson(portalPlaybackUrl(apiBase, tmdbId, mediaType, season, episode), {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    }, 12000);
    if (data && data.embeds && data.embeds.length) embeds = data.embeds;
  } catch (e) {
    /* cae al flujo viejo */
  }

  // Flujo viejo: /v1/items/... -> code -> playerProvider (por si algún portal lo sigue sirviendo)
  if (!embeds.length) {
    try {
      var dataVieja = await portalTitles(apiBase, tmdbId, mediaType, season, episode);
      var codigo = portalCode(dataVieja);
      var embedViejo = portalPlayerUrl(player, codigo);
      if (embedViejo) embeds = [{ url: embedViejo, host: '', lang: 'Latino', quality: 'HD' }];
    } catch (e) {
      /* sin nada */
    }
  }
  if (!embeds.length) return [];

  var streams = [];
  var vistos = {};
  for (var i = 0; i < embeds.length; i++) {
    var em = embeds[i] || {};
    var url = em.url;
    if (!url || vistos[url]) continue;
    vistos[url] = true;
    var lang = em.lang || 'Latino';
    var etiqueta = getServerLabel(url) + ' · ' + lang;
    var calidad = em.quality || 'HD';
    var resolver = null;
    try {
      resolver = getEmbedResolver(url);
    } catch (e) {
      resolver = null;
    }
    var resuelto = null;
    if (typeof resolver === 'function') {
      // vimeos a veces firma un m3u8 que su propio CDN rechaza con 403 (token nacido
      // inválido): se reintenta pidiendo el embed de nuevo y solo se emite una firma
      // que responda de verdad.
      for (var intento = 0; intento < 3 && !resuelto; intento++) {
        try {
          var r = await resolver(url);
          if (r && r.url) {
            var cabeceras = Object.assign({ 'User-Agent': UA }, r.headers || {});
            if (await urlReproducible(r.url, cabeceras)) {
              resuelto = { url: r.url, headers: cabeceras, quality: r.quality || calidad };
            }
          }
        } catch (e) {
          /* siguiente intento */
        }
      }
    }
    if (resuelto) {
      streams.push({
        title: etiqueta,
        quality: resuelto.quality,
        language: lang,
        url: resuelto.url,
        headers: resuelto.headers,
      });
    } else {
      // sin resolver: se emite el embed y la validación estricta del wrapper decide
      streams.push({
        title: etiqueta + ' (embed)',
        quality: calidad,
        language: lang,
        url: url,
        headers: { 'User-Agent': UA, Referer: url },
      });
    }
  }
  return streams;
}

/** true si la URL del player responde y devuelve HLS/video de verdad. */
export async function urlReproducible(url, headers) {
  try {
    var res = await fetchWithTimeout(url, { headers: headers }, 12000);
    if (!res.ok) return false;
    var ct = '';
    try {
      ct = String((res.headers && res.headers.get && res.headers.get('content-type')) || '');
    } catch (e) {
      ct = '';
    }
    if (ct.indexOf('mpegurl') >= 0 || ct.indexOf('video/') >= 0 || ct.indexOf('octet-stream') >= 0) return true;
    var cuerpo = '';
    try {
      cuerpo = await res.text();
    } catch (e) {
      return false;
    }
    return cuerpo.indexOf('#EXTM3U') >= 0;
  } catch (e) {
    return false;
  }
}
