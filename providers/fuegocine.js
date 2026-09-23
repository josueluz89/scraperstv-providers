// FuegoCine — puerto a JS de lib/data/extractors/providers/fuegocine_extractor.dart
// (el FuegoCineService Dart del repo del proyecto) al formato que ejecuta el motor
// de MasterScrap: CommonJS `module.exports = { getStreams }`, solo fetch + JSON.
//
// El original solo hace UNA llamada: GET https://www.modlyo.com/api/servidores.php
// con tmdbId + type (+ season/episode en TV), valida `success === true` y emite
// cada entrada de `streams` con servidor_url / servidor_nombre / calidad / idioma.
//
// ESTADO DEL SITIO (comprobado al portar): ese endpoint está ROTO en el servidor.
//   · sin id_contenido → HTTP 400 {"error":"Se requiere el parámetro id_contenido"}
//   · con id_contenido → HTTP 500 SQLSTATE[42X22] Unknown column 'id_contenido'
// O sea: el parámetro que pide el propio PHP no existe en su consulta SQL, así que
// ninguna combinación (tmdbId, type, season, episode, POST) devuelve datos. El
// provider queda fiel al Dart y devuelve [] limpiamente; si el endpoint se
// arregla, vuelve a funcionar sin tocar nada.
const API_URL = 'https://www.modlyo.com/api/servidores.php';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const FETCH_TIMEOUT = 15000; // igual que el .timeout(Duration(seconds: 15)) del Dart

function fetchText(url) {
  var opts = { headers: { 'User-Agent': UA, Accept: 'application/json' } };
  var timer = null;
  try {
    if (typeof AbortController !== 'undefined') {
      var controller = new AbortController();
      opts.signal = controller.signal;
      timer = setTimeout(function () {
        try {
          controller.abort();
        } catch (e) {}
      }, FETCH_TIMEOUT);
    }
  } catch (e) {
    timer = null;
  }
  function limpiar() {
    if (timer) {
      try {
        clearTimeout(timer);
      } catch (e) {}
      timer = null;
    }
  }
  return fetch(url, opts)
    .then(function (res) {
      limpiar();
      if (!res || res.status !== 200) return null;
      return res.text();
    })
    .catch(function () {
      limpiar();
      return null;
    });
}

function normalizeIdioma(lang) {
  if (lang == null || lang === '') return 'es_MX';
  var l = String(lang).toLowerCase().trim();
  if (l.indexOf('es_es') >= 0 || l.indexOf('es-es') >= 0 || l.indexOf('esp') >= 0 || l.indexOf('castellano') >= 0) {
    return 'es_ES';
  }
  if (l.indexOf('sub') >= 0 || l.indexOf('en') === 0) return 'en';
  return 'es_MX';
}

/** es_MX / es_ES / en → etiqueta legible (igual que unlimplay.js). */
function idiomaLabel(code) {
  if (code === 'es_ES') return 'Español';
  if (code === 'en') return 'Subtitulado';
  return 'Latino';
}

function run(tmdbId, mediaType, season, episode) {
  var tipo = String(mediaType || 'movie').toLowerCase();
  var isMovie = tipo !== 'tv' && tipo !== 'series' && tipo !== 'anime';
  var s = parseInt(season, 10);
  var e = parseInt(episode, 10);
  if (isNaN(s) || s < 1) s = 1;
  if (isNaN(e) || e < 1) e = 1;

  // El Dart arma la query con Uri.replace(queryParameters:) → mismas claves.
  var url =
    API_URL + '?tmdbId=' + encodeURIComponent(tmdbId) + '&type=' + (isMovie ? 'movie' : 'tv');
  if (!isMovie) {
    url += '&season=' + encodeURIComponent(s) + '&episode=' + encodeURIComponent(e);
  }

  return fetchText(url).then(function (raw) {
    if (!raw) return [];
    var data = null;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      return [];
    }
    if (!data || data.success !== true) return [];
    var streams = data.streams;
    if (!streams || typeof streams.length !== 'number' || streams.length === 0) return [];

    var out = [];
    for (var i = 0; i < streams.length; i++) {
      var item = streams[i];
      if (!item || typeof item !== 'object') continue;
      var u = item.servidor_url == null ? '' : String(item.servidor_url);
      if (!u) continue;
      out.push({
        title: 'FuegoCine · ' + (item.servidor_nombre == null ? 'Modlyo' : String(item.servidor_nombre)),
        quality: item.calidad == null ? 'HD' : String(item.calidad),
        language: idiomaLabel(normalizeIdioma(item.idioma == null ? '' : String(item.idioma))),
        url: u,
        headers: { Referer: 'https://www.fuegocine.com/', 'User-Agent': UA },
      });
    }
    return out;
  });
}

function getStreams(tmdbId, mediaType, season, episode) {
  var id = parseInt(tmdbId, 10);
  if (isNaN(id) || id <= 0) return Promise.resolve([]);
  return run(id, mediaType, season, episode).catch(function () {
    return [];
  });
}

module.exports = { getStreams };
