import { extraer } from './extractor.js';

function withTimeout(promise, ms) {
  if (typeof setTimeout === 'undefined') return promise;
  return Promise.race([
    promise,
    new Promise(function (res) {
      setTimeout(function () {
        res([]);
      }, ms);
    }),
  ]);
}

/**
 * Anime en latino desde latanime.org (nunca castellano).
 * @param {string} tmdbId
 * @param {string} mediaType 'movie' | 'series' | 'tv' | 'anime'
 * @param {number} season
 * @param {number} episode
 */
function getStreams(tmdbId, mediaType, season, episode) {
  var tipo = String(mediaType || '').toLowerCase();
  if (tipo === 'movie') return Promise.resolve([]); // el sitio no tiene películas
  return withTimeout(
    extraer(tmdbId, tipo, season, episode).catch(function () {
      return [];
    }),
    45000
  );
}

module.exports = { getStreams };
