// pelisplusto — punto de entrada del provider (contrato MasterScrap/Nuvio).
//
// Garantías de esta capa, por diseño:
//   - Nunca lanza: cualquier fallo interno termina en [].
//   - Solo salen streams con video validado (withWorkingStreams compartido).
//   - La búsqueda se corta a los 40 s; el límite duro de la app es 60 s.
//     En QuickJS no hay garantía de timers: si setTimeout no existe, la
//     promesa corre sin corte local y manda el límite de la app.
import { extractStreams } from './extractor.js';
import { withWorkingStreams } from '../shared/validate.js';

var TOTAL_MS = 40000;

function withDeadline(promise, ms) {
  if (typeof setTimeout === 'undefined') return promise;
  return Promise.race([
    promise,
    new Promise(function(resolve) {
      setTimeout(function() { resolve([]); }, ms);
    })
  ]);
}

function getStreams(tmdbId, mediaType, season, episode) {
  var work = Promise.resolve()
    .then(function() { return extractStreams(tmdbId, mediaType, season, episode); })
    .catch(function() { return []; });
  return withWorkingStreams(withDeadline(work, TOTAL_MS))
    .catch(function() { return []; });
}

module.exports = { getStreams };
