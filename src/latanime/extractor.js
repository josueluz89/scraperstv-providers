/**
 * Latanime (latanime.org) — anime SOLO en latino.
 *
 * Cadena verificada 2026-09-23:
 *   búsqueda : GET https://latanime.org/buscar?q=<titulo>      (form #search, method=get)
 *   anime    : https://latanime.org/anime/<slug>               (lista /ver/<slug>-episodio-N)
 *   episodio : https://latanime.org/ver/<slug>-episodio-<N>    (servidores en data-player)
 *   servidor : data-player="<base64 de la URL del embed>"
 *
 * Idioma: el sitio publica cada anime DOS veces, como entradas distintas
 * (`<slug>-latino` y `<slug>-castellano`), y la página lo confirma en su
 * <title> ("<Nombre> Latino — Latanime"). Este provider SOLO devuelve latino:
 * descarta cualquier slug con "castellano" y, cuando el slug no dice nada,
 * exige que la página se anuncie como Latino.
 *
 * Los episodios se numeran DENTRO de cada entrada (kaijuu-8-gou-s2-latino
 * tiene su propio episodio-1), y cada temporada es una entrada aparte
 * (`-s2`, `-temporada-2`), así que la temporada de TMDB elige la entrada.
 *
 * Los embeds se resuelven con los resolvers compartidos
 * (src/shared/embedResolvers.js: voe.sx, filemoon/byse, dood/dsvplay, lulu,
 * yourupload, streamwish…); los que no tienen resolver se emiten tal cual
 * (excepto mega.nz, que necesita descifrado y no se puede reproducir).
 */
import { fetchText } from '../shared/http.js';
import { getEmbedResolver, getServerLabel } from '../shared/embedResolvers.js';

const BASE = 'https://latanime.org';
const TMDB_KEY = '439c478a771f35c05022f9feabcca01c'; // misma que pelisplus.js / fuegocine.js
const MAX_CANDIDATOS = 12;
const MAX_RESOLVER = 8;

// ── helpers ────────────────────────────────────────────────────────────────
const ACCENTS = {
  á: 'a', à: 'a', ä: 'a', â: 'a', ã: 'a', å: 'a',
  é: 'e', è: 'e', ë: 'e', ê: 'e',
  í: 'i', ì: 'i', ï: 'i', î: 'i',
  ó: 'o', ò: 'o', ö: 'o', ô: 'o', õ: 'o',
  ú: 'u', ù: 'u', ü: 'u', û: 'u',
  ñ: 'n', ç: 'c', ß: 'ss',
};

function sinAcentos(s) {
  var out = '';
  var str = String(s == null ? '' : s).toLowerCase();
  for (var i = 0; i < str.length; i++) {
    var c = str.charAt(i);
    out += ACCENTS[c] != null ? ACCENTS[c] : c;
  }
  return out;
}

/** normaliza para comparar: sin acentos, solo [a-z0-9 ] */
function norm(s) {
  return sinAcentos(s).replace(/[^a-z0-9]+/g, ' ').replace(/^\s+|\s+$/g, '');
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  var prev = [];
  var cur = [];
  for (var j = 0; j <= b.length; j++) prev[j] = j;
  for (var i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (var k = 1; k <= b.length; k++) {
      var coste = a.charAt(i - 1) === b.charAt(k - 1) ? 0 : 1;
      var min = prev[k] + 1;
      if (cur[k - 1] + 1 < min) min = cur[k - 1] + 1;
      if (prev[k - 1] + coste < min) min = prev[k - 1] + coste;
      cur[k] = min;
    }
    for (var m = 0; m <= b.length; m++) prev[m] = cur[m];
  }
  return prev[b.length];
}

function b64decode(input) {
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  var str = String(input || '').replace(/=+$/, '');
  var output = '';
  if (str.length % 4 === 1) return '';
  for (var i = 0, bc = 0, bs = 0; i < str.length; i++) {
    var idx = chars.indexOf(str.charAt(i));
    if (idx === -1) continue;
    bs = bc % 4 ? bs * 64 + idx : idx;
    if (bc++ % 4) output += String.fromCharCode(255 & (bs >> ((-2 * bc) & 6)));
  }
  return output;
}

function tituloDeHtml(html) {
  var m = html.match(/<title>([^<]*)<\/title>/i);
  return m ? m[1] : '';
}

// ── TMDB ───────────────────────────────────────────────────────────────────
function tmdbTitulos(tmdbId, mediaType) {
  var tipo = mediaType === 'movie' ? 'movie' : 'tv';
  var url =
    'https://api.themoviedb.org/3/' +
    tipo +
    '/' +
    tmdbId +
    '?api_key=' +
    TMDB_KEY +
    '&language=es-MX';
  return fetchText(url)
    .then(function (raw) {
      var d = null;
      try {
        d = JSON.parse(raw);
      } catch (e) {
        return [];
      }
      var t = [];
      var principal = d.title != null ? d.title : d.name;
      var original = d.original_title != null ? d.original_title : d.original_name;
      if (principal) t.push(principal);
      if (original) t.push(original);
      return t;
    })
    .catch(function () {
      return [];
    });
}

// ── búsqueda ───────────────────────────────────────────────────────────────
function slugDeHref(href) {
  var m = String(href).match(/latanime\.org\/anime\/([a-z0-9-]+)/i);
  return m ? m[1].toLowerCase() : null;
}

function buscar(query) {
  var url = BASE + '/buscar?q=' + encodeURIComponent(query);
  return fetchText(url)
    .then(function (html) {
      var out = [];
      var vistos = {};
      var re = /href="([^"]*\/anime\/[^"]+)"/gi;
      var m;
      while ((m = re.exec(html)) !== null) {
        var slug = slugDeHref(m[1]);
        if (slug && !vistos[slug]) {
          vistos[slug] = true;
          out.push(slug);
        }
      }
      return out;
    })
    .catch(function () {
      return [];
    });
}

/** puntúa un slug contra los títulos de TMDB (0..1) */
function puntuar(slug, titulos) {
  var s = norm(slug);
  var mejor = 0;
  // el sitio pega palabras ("BLUELOCK" vs slug "blue-lock-latino"): comparar sin espacios
  for (var i = 0; i < titulos.length; i++) {
    var t = norm(titulos[i]);
    if (!t) continue;
    if (s === t) return 1;
    var base = s.replace(/\s+(latino|castellano|subtitulado)$/, '');
    var baseJunto = base.replace(/\s+/g, '');
    if (base === t || baseJunto === t.replace(/\s+/g, '')) return 0.98;
    // tokens significativos del título presentes en el slug
    var tokens = t.split(' ').filter(function (w) {
      return w.length > 2 || /^\d+$/.test(w);
    });
    if (tokens.length) {
      var dentro = 0;
      for (var k = 0; k < tokens.length; k++) {
        if (s.indexOf(tokens[k]) >= 0) dentro++;
        else {
          var partes = s.split(' ');
          for (var p = 0; p < partes.length; p++) {
            if (partes[p].length > 1 && levenshtein(partes[p], tokens[k]) <= 1) {
              dentro++;
              break;
            }
          }
        }
      }
      var cobertura = dentro / tokens.length;
      var exacto = base.charAt(0) === t.charAt(0) && base.indexOf(t) === 0;
      var sc = cobertura * (exacto ? 1 : 0.9);
      // Palabras del slug que el título no menciona: casi siempre es OTRA obra, no
      // el mismo anime ("the-boys-diabolico-latino" para TMDB 76479 The Boys, o
      // "futsal-boys"). Castigo fuerte para que no pase el umbral de elegirCandidato.
      var palabras = base.split(' ').filter(function (w) {
        return w.length > 2 || /^\d+$/.test(w);
      });
      var extras = 0;
      for (var q = 0; q < palabras.length; q++) {
        var w2 = palabras[q];
        var conocida = false;
        for (var j = 0; j < tokens.length; j++) {
          if (tokens[j] === w2 || tokens[j].indexOf(w2) >= 0 || w2.indexOf(tokens[j]) >= 0 || levenshtein(w2, tokens[j]) <= 1) {
            conocida = true;
            break;
          }
        }
        if (!conocida) extras++;
      }
      if (extras) sc *= 0.4;
      if (sc > mejor) mejor = sc;
    }
  }
  return mejor;
}

/** temporada declarada en el slug: `-s2`, `-temporada-2`, `-season-2` */
function temporadaDeSlug(slug) {
  var m = slug.match(/(?:-s|-temporada-|-season-)(\d{1,2})(?:-|$)/);
  return m ? parseInt(m[1], 10) : 1;
}

function esCastellano(slug) {
  return /castellano|espanol|español/.test(slug);
}

function esLatino(slug) {
  return /latino/.test(slug);
}

// ── episodio ───────────────────────────────────────────────────────────────
function extraerEmbeds(html) {
  var out = [];
  var vistos = {};
  var re = /data-player="([^"]+)"/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    var url = b64decode(m[1]).replace(/\s+$/g, '');
    if (url.indexOf('http') !== 0) {
      // algunos vienen directos (sin base64)
      var raw = m[1];
      if (raw.indexOf('http') === 0) url = raw;
      else continue;
    }
    if (!vistos[url]) {
      vistos[url] = true;
      out.push(url);
    }
  }
  return out;
}

function hostsAEmitir(embeds) {
  // mega.nz necesita descifrado propio: no se puede reproducir en el reproductor
  return embeds.filter(function (u) {
    return u.indexOf('mega.nz') < 0;
  });
}

function resolverEmbed(embed) {
  var resolver = null;
  try {
    resolver = getEmbedResolver(embed);
  } catch (e) {
    resolver = null;
  }
  if (typeof resolver !== 'function') return Promise.resolve(null);
  return Promise.resolve()
    .then(function () {
      return resolver(embed);
    })
    .then(function (r) {
      if (r && r.url) return r;
      return null;
    })
    .catch(function () {
      return null;
    });
}

// ── selección del anime ────────────────────────────────────────────────────
function elegirCandidato(slugs, titulos, temporada) {
  var orden = [];
  for (var i = 0; i < slugs.length; i++) {
    if (esCastellano(slugs[i])) continue; // SOLO latino
    var sc = puntuar(slugs[i], titulos);
    if (sc < 0.45) continue;
    var temporadaSlug = temporadaDeSlug(slugs[i]);
    var bonusTemporada =
      temporadaSlug === temporada ? 0.2 : temporadaSlug === 1 && temporada === 1 ? 0.1 : 0;
    var bonusLatino = esLatino(slugs[i]) ? 0.15 : 0;
    orden.push({
      slug: slugs[i],
      score: sc + bonusTemporada + bonusLatino,
      titulo: sc,
      temporada: temporadaSlug,
      latino: esLatino(slugs[i]),
    });
  }
  orden.sort(function (a, b) {
    return b.score - a.score;
  });
  return orden.slice(0, MAX_CANDIDATOS);
}

/**
 * Confirma el idioma con la propia página cuando el slug no lo dice.
 * Devuelve la lista en orden, con los latino confirmados primero.
 */
function confirmarLatino(candidatos) {
  var aRevisar = candidatos.filter(function (c) {
    return !c.latino;
  });
  if (!aRevisar.length) return Promise.resolve(candidatos);
  return Promise.all(
    aRevisar.map(function (c) {
      return fetchText(BASE + '/anime/' + c.slug)
        .then(function (html) {
          var t = tituloDeHtml(html);
          c.confirmado = /latino/i.test(t) && !/castellano/i.test(t);
        })
        .catch(function () {
          c.confirmado = false;
        });
    })
  ).then(function () {
    var ok = candidatos.filter(function (c) {
      return c.latino || c.confirmado;
    });
    // ESTRICTO: solo latino. Ni el slug ni el <title> lo confirman -> no se emite nada
    // (antes se caía a las entradas sin idioma marcado, y eso podía colar castellano).
    return ok;
  });
}

function extraerEpisodio(slug, episodio) {
  var url = BASE + '/ver/' + slug + '-episodio-' + episodio;
  return fetchText(url)
    .then(function (html) {
      return { url: url, embeds: extraerEmbeds(html) };
    })
    .catch(function () {
      return null;
    });
}

// ── flujo principal ────────────────────────────────────────────────────────
async function extraer(tmdbId, mediaType, season, episode) {
  var tipo = String(mediaType || '').toLowerCase();
  if (tipo === 'movie') return []; // el sitio es solo series/anime

  var temporada = parseInt(season, 10);
  if (isNaN(temporada) || temporada < 1) temporada = 1;
  var ep = parseInt(episode, 10);
  if (isNaN(ep) || ep < 1) ep = 1;

  var titulos = await tmdbTitulos(tmdbId, tipo);
  if (!titulos.length) return [];

  // búsqueda: título completo y, si no hay nada, la palabra más distintiva
  var queries = [titulos[0]];
  var palabras = norm(titulos[0])
    .split(' ')
    .filter(function (w) {
      return w.length > 3 && ['temporada', 'season', 'parte', 'the', 'los', 'las'].indexOf(w) < 0;
    });
  if (palabras.length) {
    palabras.sort(function (a, b) {
      return b.length - a.length;
    });
    queries.push(palabras[0]);
    // El buscador del sitio es un LIKE sobre el título tal cual: un título pegado
    // ("BLUELOCK") no da nada ni con su prefijo "Bluel", pero sí con el trozo que
    // coincide con la primera palabra del sitio ("blue" en "Blue Lock"). Se prueban
    // prefijos decrecientes y el scoring descarta el ruido; el bucle corta a 6 slugs.
    if (palabras.length === 1 && palabras[0].length >= 6) {
      for (var L = 6; L >= 4; L--) queries.push(palabras[0].slice(0, L));
    }
  }

  var slugs = [];
  var vistos = {};
  for (var q = 0; q < queries.length; q++) {
    var encontrados = await buscar(queries[q]);
    for (var i = 0; i < encontrados.length; i++) {
      if (!vistos[encontrados[i]]) {
        vistos[encontrados[i]] = true;
        slugs.push(encontrados[i]);
      }
    }
    if (slugs.length >= 6) break;
  }
  if (!slugs.length) return [];

  var candidatos = elegirCandidato(slugs, titulos, temporada);
  if (!candidatos.length) return [];
  candidatos = await confirmarLatino(candidatos);

  // prueba las entradas en orden hasta encontrar el episodio
  var episodio = null;
  for (var c = 0; c < candidatos.length; c++) {
    var encontrado = await extraerEpisodio(candidatos[c].slug, ep);
    if (encontrado && encontrado.embeds.length) {
      episodio = encontrado;
      episodio.slug = candidatos[c].slug;
      break;
    }
  }
  if (!episodio) return [];

  var embeds = hostsAEmitir(episodio.embeds).slice(0, MAX_RESOLVER);
  var resueltos = await Promise.all(embeds.map(resolverEmbed));

  var streams = [];
  var yaEsta = {};
  for (var r = 0; r < embeds.length; r++) {
    if (resueltos[r] && resueltos[r].url) {
      if (yaEsta[resueltos[r].url]) continue;
      yaEsta[resueltos[r].url] = true;
      streams.push({
        title: getServerLabel(embeds[r]) + ' · Latino',
        quality: resueltos[r].quality || 'HD',
        language: 'Latino',
        url: resueltos[r].url,
        headers: resueltos[r].headers || { Referer: BASE + '/' },
      });
    }
  }
  for (var e2 = 0; e2 < embeds.length; e2++) {
    if (resueltos[e2] && resueltos[e2].url) continue;
    streams.push({
      title: getServerLabel(embeds[e2]) + ' · Latino (embed)',
      quality: 'HD',
      language: 'Latino',
      url: embeds[e2],
      headers: { Referer: BASE + '/' },
    });
  }
  return streams;
}

export { extraer };
