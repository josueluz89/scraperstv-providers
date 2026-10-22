import { extractStreams } from './extractor.js';
import { withWorkingStreams } from '../shared/validate.js';

// Tope total de la búsqueda: 55 s, bajo el límite de 60 s que impone la app
// (presupuesto Nuvio <60 s por provider). En QuickJS no hay setTimeout y la
// promesa corre sin tope local, cortada por la app; donde sí hay setTimeout,
// este tope es la red de seguridad final — el trabajo fino de tiempos lo hace
// el extractor, con un plazo propio por embed (35 s).
function withTimeout(promise, ms) {
  if (typeof setTimeout === 'undefined') return promise;
  return Promise.race([
    promise,
    new Promise(function(res) { setTimeout(function() { res([]); }, ms); }),
  ]);
}

function getStreams(tmdbId, mediaType, season, episode) {
  return withWorkingStreams(withTimeout(
    extractStreams(tmdbId, mediaType, season, episode)
      .catch(function() { return []; }),
    55000
  ));
}

module.exports = { getStreams };
