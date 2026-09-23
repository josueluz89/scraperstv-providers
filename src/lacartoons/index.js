import { extractStreams } from './extractor.js';
function withTimeout(promise, ms) {
  if (typeof setTimeout === 'undefined') return promise;
  return Promise.race([
    promise,
    new Promise(function(res) { setTimeout(function() { res([]); }, ms); }),
  ]);
}
function getStreams(tmdbId, mediaType, season, episode) {
  return withTimeout(
    extractStreams(tmdbId, mediaType, season, episode).catch(function(){ return []; }),
    40000
  );
}
module.exports = { getStreams };
