/**
 * LaMovie (lamovie.org) — películas y series en latino.
 *
 * El sitio dejó de ser un portal scrapeable (2026-09-24 devuelve una SPA de
 * 829 bytes) y ahora publica todo por su API JSON indexada por TMDB:
 *   API      https://tmdb.lamovie.org   (/v1/items/movie/<tmdbId>,
 *                                        /v1/items/tvshow/<tmdbId>/seasons/<s>/episodes/<e>)
 *   player   window.siteConfig.playerProvider = https://vimeos.net/embed-%fileCode%.html
 *
 * Por eso ya no hay búsqueda ni matching de títulos: TMDB manda el id y la API
 * devuelve el `code` del reproductor de ese id exacto (sin falsos positivos).
 */
import { extraerPortal } from '../shared/tmdbPortal.js';

const API = 'https://tmdb.lamovie.org';
const PLAYER = 'https://vimeos.net/embed-%fileCode%.html';

export function extraer(tmdbId, mediaType, season, episode) {
  return extraerPortal(API, PLAYER, tmdbId, mediaType, season, episode);
}
