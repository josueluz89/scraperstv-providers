// pelisplus — punto de entrada.
//
// Contrato (docs/CONTRATO.md): exportar
//   getStreams(tmdbId, mediaType, season, episode) -> Promise<stream[]>
// y no lanzar nunca: todo error termina en [].
//
// Presupuesto total < 60 s (límite duro de Nuvio):
//   - la extracción se acota a 40 s con la fecha límite de aquí abajo;
//   - la validación compartida (withWorkingStreams) corre después sobre
//     los enlaces ya resueltos — el extractor emite como máximo 8, y la
//     validación cobra 7 s por enlace en 4 carriles (≤ 2 rondas).
// Sin setTimeout (hay motores QuickJS que no lo exponen) no existe fecha
// límite local y manda el límite de la app; nunca se depende de un timer
// para que el provider funcione.

import { extractStreams } from './extractor.js';
import { withWorkingStreams } from '../shared/validate.js';

var EXTRACTION_LIMIT_MS = 40000;

function withDeadline(promise, ms) {
  if (typeof setTimeout === 'undefined') return promise;
  return Promise.race([
    promise,
    new Promise(function (resolve) {
      setTimeout(function () { resolve([]); }, ms);
    }),
  ]);
}

function getStreams(tmdbId, mediaType, season, episode) {
  var extraction = Promise.resolve()
    .then(function () { return extractStreams(tmdbId, mediaType, season, episode); })
    .catch(function () { return []; });
  return withWorkingStreams(withDeadline(extraction, EXTRACTION_LIMIT_MS));
}

module.exports = { getStreams };
