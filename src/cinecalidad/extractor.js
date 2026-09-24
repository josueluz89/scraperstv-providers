/**
 * CineCalidad (cinecalidad.ec -> cinecalidad.am) — películas y series en latino.
 *
 * Verificado 2026-09-24: cinecalidad.ec responde 301 a https://cinecalidad.am, que
 * ya no es el portal scrapeable de antes (búsqueda /?s=, /ver-pelicula/, data-option)
 * sino la misma SPA "tmdb-api-ui" que lamovie.org: un shell de 1.1 KB + API JSON
 * indexada por TMDB.
 *   API      https://tmdb.cinecalidad.am
 *   player   window.siteConfig.playerProvider = https://vimeos.net/embed-%fileCode%.html
 *
 * Cadena: TMDB id -> /v1/items/{movie|tvshow}/… -> code -> vimeos.net/embed-<code>.html
 * (vimeos se resuelve con el resolver compartido; si no, se emite el embed).
 */
import { extraerPortal } from '../shared/tmdbPortal.js';

const API = 'https://tmdb.cinecalidad.am';
const PLAYER = 'https://vimeos.net/embed-%fileCode%.html';

export function extractStreams(tmdbId, mediaType, season, episode) {
  return extraerPortal(API, PLAYER, tmdbId, mediaType, season, episode);
}
