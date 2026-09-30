/**
 * FanPelis (fanpelis.to) — películas y series en latino.
 *
 * 2026-09-30: fanpelis.to migró a la SPA "tmdb-api-ui" (igual que
 * cinecalidad.am y lamovie.org): /api/rest/ ahora devuelve HTML en vez de
 * JSON. La API real vive en https://tmdb.fanpelis.to con el endpoint
 * /v1/playback, que entrega los embeds directos con host/idioma/calidad.
 *
 * Cadena: TMDB id -> /v1/playback/{movie|tvshow}/… -> embeds
 * (vimeos, goodstream…) -> resolvers compartidos -> solo video directo.
 */
import { extraerPortal } from '../shared/tmdbPortal.js';

const API = 'https://tmdb.fanpelis.to';
const PLAYER = 'https://vimeos.net/embed-%fileCode%.html';

export function extractStreams(tmdbId, mediaType, season, episode) {
  return extraerPortal(API, PLAYER, tmdbId, mediaType, season, episode);
}
