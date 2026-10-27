import { extraer } from './extractor.js';
import { filterWorkingStreams } from '../shared/validate.js';

// Presupuesto ÚNICO diseñado para todo el provider, bajo el límite de
// 60 s de Nuvio. Reescritura 2026-10-27: el diseño anterior corría
// `extraer` contra una carrera de 45 s que, al ganar, DEVOLVÍA [] Y
// TIRABA el trabajo en curso — el 2026-10-27 las 6 llamadas de
// verificación murieron exactamente a los 45,0 s por eso, aunque el
// flujo natural desde este sandbox tarda 45-55 s. Aquí no hay carrera
// que descarte trabajo: las fases de `extraer` se auto-limitan con el
// deadline, y la validación final achica su timeout para caber en el
// presupuesto (dos rondas de validación como máximo dentro del resto).
// La guarda de 58 s solo existe por si una fase se cuelga de verdad:
// nunca debería dispararse, porque cada fetch ya tiene su propio
// timeout de 12 s en src/shared/http.js.
var PRESUPUESTO_MS = 55000;
var GUARDA_MS = 58000;

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
  var inicio = Date.now();
  var trabajo = extraer(tmdbId, tipo, season, episode, inicio + PRESUPUESTO_MS)
    .catch(function () {
      return [];
    })
    .then(function (streams) {
      if (!streams || !streams.length) return [];
      // Sin aire para validar no se emite nada sin validar: la
      // validación es la que garantiza video real.
      var resto = inicio + PRESUPUESTO_MS - Date.now();
      if (resto <= 0) return [];
      // Dos rondas de validación (concurrencia 4) deben caber en el
      // resto; el timeout por URL se achica a la mitad del resto.
      var t = Math.floor(resto / 2);
      if (t > 7000) t = 7000;
      if (t < 1000) t = 1000;
      return filterWorkingStreams(streams, { timeoutMs: t });
    })
    .catch(function () {
      return [];
    });
  if (typeof setTimeout === 'undefined') return trabajo;
  return Promise.race([
    trabajo,
    new Promise(function (res) {
      setTimeout(function () {
        res([]);
      }, GUARDA_MS);
    }),
  ]);
}

module.exports = { getStreams };
