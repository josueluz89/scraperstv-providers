import { extraer } from './extractor.js';

// Cap total lookup at 40s (QuickJS/Nuvio has no setTimeout: runs uncapped there,
// where the app enforces its own 60s limit).
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
 * Películas y series en latino desde lamovie.org (API tmdb.lamovie.org).
 * @param {string} tmdbId
 * @param {string} mediaType 'movie' | 'series' | 'tv' | 'anime'
 */
function getStreams(tmdbId, mediaType, season, episode) {
  return withTimeout(
    extraer(tmdbId, mediaType, season, episode).catch(function () {
      return [];
    }),
    40000
  );
}

module.exports = { getStreams };
