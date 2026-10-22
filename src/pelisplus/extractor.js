// pelisplus — extractor (reescritura limpia, 2026-10-22).
//
// Flujo, una sola pasada y sin capas:
//
//   1. TMDB       El provider resuelve el título SOLO desde el id
//                 (título en español latino + título original + año).
//   2. Búsqueda   pelisplushd.bz/search con ambos títulos; los candidatos
//                 se filtran por el tipo pedido (película vs serie/anime)
//                 y se elige el mejor por puntaje determinista.
//   3. Ficha      La página de la película — o la del episodio, siguiendo
//                 el enlace /temporada/<s>/capitulo/<e> de la serie —
//                 expone los servidores como video[N] = 'URL' con su
//                 etiqueta en <li data-id="N">; sin eso, iframes.
//   4. Resolución Cada servidor se convierte en VIDEO DIRECTO:
//                   - embed69.org/f/...    dataLink cifrado (PoW + AES,
//                     módulo embed69.js, compartido y probado): cada host
//                     descifrado se resuelve con resolveHostStream.
//                   - embed69.org/video/.. URLs directas en
//                     playServerVast('...'), sin cifrado.
//                   - cualquier otro host  resolvers compartidos
//                     (src/shared/embedResolvers.js).
//                 Lo que no resuelve a video directo NO se emite. La
//                 validación compartida de index.js es la red final,
//                 no el mecanismo para publicar embeds crudos.
//
// Idiomas: solo Latino, Subtitulado, Inglés y Japonés. El castellano
// (español de España) se descarta aquí mismo — en la etiqueta de la
// ficha y en el idioma que trae cada entrada descifrada — antes de
// gastar un segundo resolviendo hosts que la app no quiere.
//
// Presupuesto (contrato Nuvio: < 60 s por provider; extracción ≤ 40 s
// por la fecha límite de index.js). Cada paso tiene su timeout pensado
// para lo medido el 2026-10-22: TMDB respondió entre 1,5 s y 9,8 s
// según la hora (con 8 s de tope, una llamada lenta abortaba y el
// provider entero devolvía []), así que TMDB/búsqueda/fichas reciben
// 12 s. Las páginas de morencius/vibuxer tardan 4–7 s de forma
// habitual y cada host recibe 10 s: resolveHostStream reutiliza ese
// mismo tope para la página del host y para verificar su playlist, y
// la suma de la cadena tiene que caber en la fecha límite de 40 s aun
// en una ventana lenta de red — un tope por host más generoso no salva
// más enlaces, empuja la cadena entera contra la fecha límite y la
// fecha límite devuelve [] (todo o nada).

import { fetchText, fetchJson } from '../shared/http.js';
import { getEmbedResolver, getServerLabel, mapDomain } from '../shared/embedResolvers.js';
import { decodeEmbed69Page, resolveHostStream, familyOf } from './embed69.js';

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

var TMDB_API_KEY = '1f54bd990f1cdfb230adb312546d765d';

// Espejo .bz: mismo catálogo que el dominio principal y responde a
// peticiones server-side; el .to queda tras challenge de Cloudflare.
var SITE = 'https://pelisplushd.bz';
var EMBED69_ORIGIN = 'https://embed69.org';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

var TMDB_TIMEOUT_MS = 12000;
var SEARCH_TIMEOUT_MS = 12000;
var PAGE_TIMEOUT_MS = 12000;
var HOST_TIMEOUT_MS = 10000;
var MAX_HOST_ENTRIES = 8;  // hosts a resolver por página embed69
var MAX_STREAMS = 8;       // tope emitido: acota la validación posterior

// ---------------------------------------------------------------------------
// Texto: normalización sin ICU (QuickJS no trae String.normalize)
// ---------------------------------------------------------------------------

var ACCENT_MAP = {
  'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u', 'ü': 'u', 'ñ': 'n',
  'Á': 'a', 'É': 'e', 'Í': 'i', 'Ó': 'o', 'Ú': 'u', 'Ü': 'u', 'Ñ': 'n',
  'à': 'a', 'è': 'e', 'ì': 'i', 'ò': 'o', 'ù': 'u',
  'â': 'a', 'ê': 'e', 'î': 'i', 'ô': 'o', 'û': 'u',
  'ä': 'a', 'ë': 'e', 'ï': 'i', 'ö': 'o', 'ç': 'c', 'ã': 'a', 'õ': 'o'
};

function stripAccents(s) {
  return (s || '').replace(/[^\x00-\x7F]/g, function (c) { return ACCENT_MAP[c] || ''; });
}

// Minúsculas, sin acentos, solo [a-z0-9 ]: la forma comparable de un título.
function normalizeText(text) {
  return stripAccents(String(text || '').toLowerCase())
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Limpia el título tal como lo presenta el sitio ("Ver X (2024) Online…").
function cleanTitle(raw) {
  if (!raw) return '';
  return String(raw)
    .replace(/^ver\s+/i, '')
    .replace(/\s*\(\d{4}\)\s*/g, ' ')
    .split(' Online')[0]
    .split(' online')[0]
    .split(' (')[0]
    .replace(/\s+/g, ' ')
    .trim();
}

function originOf(url) {
  var m = String(url || '').match(/^(https?:\/\/[^\/]+)/i);
  return m ? m[1] : '';
}

function capitalize(s) {
  s = String(s || '');
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// ---------------------------------------------------------------------------
// 1. TMDB: id -> título
// ---------------------------------------------------------------------------

function fetchTitle(tmdbId, tmdbType) {
  var url = 'https://api.themoviedb.org/3/' + tmdbType + '/' + tmdbId +
    '?api_key=' + TMDB_API_KEY + '&language=es-MX';
  return fetchJson(url, null, TMDB_TIMEOUT_MS)
    .then(function (data) {
      if (!data) return null;
      var isMovie = tmdbType === 'movie';
      var date = isMovie ? data.release_date : data.first_air_date;
      return {
        title: (isMovie ? data.title : data.name) || '',
        originalTitle: (isMovie ? data.original_title : data.original_name) || '',
        year: (date && date.length >= 4) ? date.slice(0, 4) : '',
      };
    })
    .catch(function () { return null; });
}

// ---------------------------------------------------------------------------
// 2. Búsqueda en el sitio y elección del candidato
// ---------------------------------------------------------------------------

// Anclas del resultado: /pelicula/<slug>, /serie/<slug>, /anime/<slug>.
function parseCandidates(html) {
  var out = [];
  var seen = {};
  var re = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    var href = m[1];
    var section = null;
    if (href.indexOf('/pelicula/') !== -1) section = 'pelicula';
    else if (href.indexOf('/serie/') !== -1) section = 'serie';
    else if (href.indexOf('/anime/') !== -1) section = 'anime';
    if (!section) continue;
    if (href.indexOf('/temporada/') !== -1) continue;

    var slug = (href.split('/' + section + '/')[1] || '').split('/')[0].split('?')[0];
    if (!slug) continue;

    var title = '';
    var dataTitle = m[0].match(/data-title="([^"]*)"/i);
    if (dataTitle) title = dataTitle[1];
    if (!title) {
      var alt = m[2].match(/<img\b[^>]*alt="([^"]*)"/i);
      if (alt) title = alt[1];
    }
    if (!title) {
      var head = m[2].match(/<(h2|p|span)\b[^>]*>([^<]*)<\/\1>/i);
      if (head) title = head[2];
    }
    title = cleanTitle(title.replace(/<[^>]*>/g, ' '));
    if (!title) continue;

    var key = section + '|' + slug;
    if (seen[key]) continue;
    seen[key] = true;
    out.push({ title: title, slug: slug, section: section });
  }
  return out;
}

function searchSite(query) {
  var url = SITE + '/search?s=' + encodeURIComponent(query);
  return fetchText(url, null, SEARCH_TIMEOUT_MS)
    .then(parseCandidates)
    .catch(function () { return []; });
}

// Puntaje de un candidato contra un título buscado, ya normalizados:
// exacto 100 · contención 85 · palabras compartidas (8 por palabra del
// título presente en el candidato + 5 por palabra del candidato presente
// en el título).
function titleScore(candidateNorm, titleNorm) {
  if (!candidateNorm || !titleNorm) return 0;
  if (candidateNorm === titleNorm) return 100;
  if (candidateNorm.indexOf(titleNorm) !== -1 || titleNorm.indexOf(candidateNorm) !== -1) return 85;
  var titleWords = titleNorm.split(' ');
  var candidateWords = candidateNorm.split(' ');
  var inCandidate = 0;
  var inTitle = 0;
  var i, j;
  for (i = 0; i < titleWords.length; i++) {
    if (candidateNorm.indexOf(titleWords[i]) !== -1) inCandidate++;
  }
  for (i = 0; i < candidateWords.length; i++) {
    for (j = 0; j < titleWords.length; j++) {
      if (titleWords[j] === candidateWords[i]) { inTitle++; break; }
    }
  }
  return inCandidate * 8 + inTitle * 5;
}

// ¿Comparten candidato y títulos alguna palabra con peso (4+ letras)?
// Es la señal de aceptación alterna al puntaje: los nombres traducidos
// rompen la coincidencia palabra a palabra ("Deadpool & Wolverine" en
// el sitio es "Deadpool y Lobezno": solo 'deadpool' coincide, puntaje
// 13, y aun así es la ficha correcta).
function sharesSignificantWord(candidateNorm, titlesNorm) {
  var candidateWords = candidateNorm.split(' ');
  for (var i = 0; i < candidateWords.length; i++) {
    var w = candidateWords[i];
    if (w.length < 4) continue;
    for (var t = 0; t < titlesNorm.length; t++) {
      var titleWords = titlesNorm[t].split(' ');
      for (var j = 0; j < titleWords.length; j++) {
        if (titleWords[j] === w) return true;
      }
    }
  }
  return false;
}

// Elige la ficha: solo candidatos del tipo pedido. Se acepta el mejor
// si su puntaje llega a 15, o si llega a 10 y comparte una palabra con
// peso con el título (caso de nombres traducidos, ver arriba). El año
// en el título del candidato suma 5. Sin candidato convincente -> null.
function pickCandidate(candidates, media, tmdbType) {
  var wantMovie = tmdbType === 'movie';
  var titles = [];
  if (media.originalTitle) titles.push(normalizeText(media.originalTitle));
  if (media.title && media.title !== media.originalTitle) titles.push(normalizeText(media.title));
  if (!titles.length) return null;

  var best = null;
  var bestNorm = '';
  var bestScore = -1;
  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i];
    var isMovieSection = c.section === 'pelicula';
    if (isMovieSection !== wantMovie) continue;
    var norm = normalizeText(c.title);
    var score = 0;
    for (var t = 0; t < titles.length; t++) {
      var s = titleScore(norm, titles[t]);
      if (s > score) score = s;
    }
    if (media.year && c.title.indexOf(media.year) !== -1) score += 5;
    if (score > bestScore) { bestScore = score; best = c; bestNorm = norm; }
  }
  if (!best) return null;
  if (bestScore >= 15) return best;
  if (bestScore >= 10 && sharesSignificantWord(bestNorm, titles)) return best;
  return null;
}

// ---------------------------------------------------------------------------
// 3. Ficha: servidores declarados en la página
// ---------------------------------------------------------------------------

// Idioma según la etiqueta del servidor en la ficha. 'Español' aquí es
// castellano de España: la casa solo acepta Latino/SUB/EN/JP.
function languageFromLabel(label) {
  var s = normalizeText(label || '');
  if (s.indexOf('castellano') !== -1 || s.indexOf('espanol') !== -1) return 'Español';
  if (s.indexOf('sub') !== -1) return 'Subtitulado';
  if (s.indexOf('ingles') !== -1 || s.indexOf('english') !== -1) return 'Inglés';
  if (s.indexOf('japones') !== -1 || s.indexOf('japanese') !== -1) return 'Japonés';
  return 'Latino';
}

// Servidores de la ficha: pares video[N] + <li data-id="N">; si no hay,
// iframes sueltos. Sin duplicados y sin castellano.
function parseServers(html) {
  var urls = {};
  var vm;
  var vRe = /video\[(\d+)\]\s*=\s*['"]([^'"]+)['"]/g;
  while ((vm = vRe.exec(html)) !== null) urls[vm[1]] = vm[2];

  var labels = {};
  var lm;
  var lRe = /<li[^>]*data-id="(\d+)"[^>]*>([\s\S]*?)<\/li>/gi;
  while ((lm = lRe.exec(html)) !== null) {
    labels[lm[1]] = lm[2].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  var servers = [];
  var idx;
  for (idx in urls) {
    if (!Object.prototype.hasOwnProperty.call(urls, idx)) continue;
    var src = urls[idx];
    if (!src || src.indexOf('http') !== 0) continue;
    var label = labels[idx] || '';
    servers.push({ src: src, label: label, language: languageFromLabel(label) });
  }

  if (!servers.length) {
    var im;
    var iRe = /<iframe\b[^>]*src="([^"]+)"[^>]*>/gi;
    while ((im = iRe.exec(html)) !== null) {
      var isrc = im[1];
      if (isrc.indexOf('//') === 0) isrc = 'https:' + isrc;
      if (isrc.indexOf('http') !== 0) continue;
      servers.push({ src: isrc, label: '', language: 'Latino' });
    }
  }

  var seen = {};
  return servers.filter(function (s) {
    if (s.language === 'Español') return false;
    if (seen[s.src]) return false;
    seen[s.src] = true;
    return true;
  });
}

// ---------------------------------------------------------------------------
// 4. Resolución a video directo
// ---------------------------------------------------------------------------

// Forma final del stream (contrato): headers completos, porque hay CDN
// que dan 403 sin Referer y hosts que exigen el UA del navegador.
function buildStream(label, language, resolved) {
  if (!resolved || !resolved.url) return null;
  var headers = {};
  var srcHeaders = resolved.headers || {};
  var k;
  for (k in srcHeaders) {
    if (Object.prototype.hasOwnProperty.call(srcHeaders, k)) headers[k] = srcHeaders[k];
  }
  if (!headers.Referer) headers.Referer = originOf(resolved.url) + '/';
  if (!headers['User-Agent']) headers['User-Agent'] = UA;
  var quality = resolved.quality || 'HD';
  return {
    title: 'PelisPlusHD · ' + quality + ' · ' + language + ' · ' + label,
    quality: quality,
    language: language,
    url: resolved.url,
    headers: headers,
  };
}

// Host con resolver compartido conocido. Sin resolver -> null (no se emite).
function resolveShared(embedUrl, language, label) {
  var fixed = mapDomain(embedUrl);
  var resolver = getEmbedResolver(fixed);
  if (!resolver) return Promise.resolve(null);
  return Promise.resolve()
    .then(function () { return resolver(fixed); })
    .then(function (resolved) {
      return buildStream(label || getServerLabel(fixed) || 'Server', language, resolved);
    })
    .catch(function () { return null; });
}

// Una entrada descifrada de embed69 -> un stream o null.
function resolveEntry(entry) {
  var label = entry.servidor ? capitalize(entry.servidor) : 'Embed';
  var family = familyOf(entry.servidor, entry.url);
  if (family) {
    // Familia streamwish/vidhide: el resolver afinado de embed69.js
    // entrega la playlist ya verificada (#EXTM3U).
    return resolveHostStream(entry.url, family, HOST_TIMEOUT_MS)
      .then(function (resolved) { return buildStream(label, entry.language, resolved); })
      .catch(function () { return null; });
  }
  return resolveShared(entry.url, entry.language, label);
}

// Página /video/: URLs directas en playServerVast('...'), sin cifrado.
function resolveVideoPage(html) {
  var urls = [];
  var seen = {};
  var m;
  var re = /playServerVast\('([^']+)'\)/g;
  while ((m = re.exec(html)) !== null) {
    var u = m[1];
    if (u.indexOf('http') !== 0) continue;
    if (u.indexOf('1fichier.com') !== -1) continue; // exige abrir pestaña: no reproduce
    if (seen[u]) continue;
    seen[u] = true;
    urls.push(u);
  }
  return Promise.all(urls.slice(0, MAX_HOST_ENTRIES).map(function (u) {
    return resolveShared(u, 'Latino', null);
  }));
}

// Página embed69: /f/ trae el dataLink cifrado; /video/ no.
function resolveEmbed69(src) {
  return fetchText(src, {
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': SITE + '/',
      'Origin': EMBED69_ORIGIN,
      'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8',
      'User-Agent': UA,
    },
  }, PAGE_TIMEOUT_MS)
    .then(function (html) {
      if (src.indexOf('/video/') !== -1) return resolveVideoPage(html);
      // OJO: decodeEmbed69Page es SINCRÓNICO — devuelve el array de
      // entradas ya descifradas, no una promesa.
      var entries = decodeEmbed69Page(html);
      var usable = [];
      for (var i = 0; i < entries.length && usable.length < MAX_HOST_ENTRIES; i++) {
        if (entries[i].language === 'Español') continue; // castellano: fuera
        usable.push(entries[i]);
      }
      return Promise.all(usable.map(function (e) { return resolveEntry(e); }));
    })
    .then(compactStreams)
    .catch(function () { return []; });
}

// Lista de (stream|null) -> streams únicos, con el tope de emisión.
function compactStreams(list) {
  var out = [];
  var seen = {};
  var items = list || [];
  for (var i = 0; i < items.length && out.length < MAX_STREAMS; i++) {
    var st = items[i];
    if (!st || !st.url || seen[st.url]) continue;
    seen[st.url] = true;
    out.push(st);
  }
  return out;
}

// Resuelve en paralelo todos los servidores de una ficha.
function resolveServers(servers) {
  var jobs = servers.map(function (s) {
    if (s.src.indexOf('embed69.org/') !== -1) return resolveEmbed69(s.src);
    return resolveShared(s.src, s.language, s.label || null)
      .then(function (st) { return st ? [st] : []; });
  });
  return Promise.all(jobs).then(function (lists) {
    var flat = [];
    for (var i = 0; i < lists.length; i++) {
      var list = lists[i] || [];
      for (var j = 0; j < list.length; j++) flat.push(list[j]);
    }
    return compactStreams(flat);
  });
}

// ---------------------------------------------------------------------------
// Flujos por tipo
// ---------------------------------------------------------------------------

function movieStreams(slug) {
  return fetchText(SITE + '/pelicula/' + slug, null, PAGE_TIMEOUT_MS)
    .then(function (html) { return resolveServers(parseServers(html)); })
    .catch(function () { return []; });
}

// Enlace del episodio dentro de la página de la serie (con frontera tras
// el número de capítulo, para no casar 1 con 10).
function findEpisodeHref(html, season, episode) {
  var needle = '/temporada/' + season + '/capitulo/' + episode;
  var re = /href="([^"]+)"/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    var href = m[1];
    var i = href.indexOf(needle);
    if (i === -1) continue;
    var next = href.charAt(i + needle.length);
    if (next !== '' && next !== '/' && next !== '?' && next !== '#') continue;
    if (href.indexOf('/serie/') === -1 && href.indexOf('/anime/') === -1) continue;
    return href;
  }
  return null;
}

function episodeStreams(candidate, season, episode) {
  var base = SITE + '/' + candidate.section + '/' + candidate.slug;
  return fetchText(base, null, PAGE_TIMEOUT_MS)
    .then(function (html) {
      var href = findEpisodeHref(html, season, episode) ||
        '/' + candidate.section + '/' + candidate.slug +
          '/temporada/' + season + '/capitulo/' + episode;
      var url = href.indexOf('http') === 0
        ? href
        : SITE + (href.charAt(0) === '/' ? href : '/' + href);
      return fetchText(url, null, PAGE_TIMEOUT_MS);
    })
    .then(function (html) { return resolveServers(parseServers(html)); })
    .catch(function () { return []; });
}

// ---------------------------------------------------------------------------
// Entrada del extractor
// ---------------------------------------------------------------------------

export function extractStreams(tmdbId, mediaType, season, episode) {
  // Contrato: Nuvio manda 'movie' / 'series' / 'anime'; TMDB usa 'tv'.
  var tmdbType = (mediaType === 'tv' || mediaType === 'series' || mediaType === 'anime')
    ? 'tv'
    : 'movie';

  return fetchTitle(tmdbId, tmdbType)
    .then(function (media) {
      if (!media || (!media.title && !media.originalTitle)) return [];

      var queries = [];
      if (media.originalTitle) queries.push(media.originalTitle);
      if (media.title && media.title !== media.originalTitle) queries.push(media.title);

      return Promise.all(queries.map(function (q) { return searchSite(q); }))
        .then(function (results) {
          var all = [];
          var seen = {};
          results.forEach(function (candidates) {
            candidates.forEach(function (c) {
              var key = c.section + '|' + c.slug;
              if (seen[key]) return;
              seen[key] = true;
              all.push(c);
            });
          });

          var best = pickCandidate(all, media, tmdbType);
          if (!best) return [];
          if (tmdbType === 'movie') return movieStreams(best.slug);
          return episodeStreams(best, season || 1, episode || 1);
        });
    })
    .catch(function () { return []; });
}
