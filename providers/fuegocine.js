// FuegoCine — scrape de la web real (https://www.fuegocine.com), no de la API.
//
// HISTORIA: el Dart original (FuegoCineService) llamaba a
// https://www.modlyo.com/api/servidores.php con tmdbId/type/season/episode.
// Esa API está rota en el servidor (comprobado 2026-09-23):
//   · sin id_contenido -> HTTP 400 {"error":"Se requiere el parámetro id_contenido"}
//   · con id_contenido -> HTTP 400 SQLSTATE[42S22] Unknown column 'id_contenido' in 'WHERE'
// Es decir: el PHP pide un parámetro que su propia consulta SQL no tiene, así que
// ninguna combinación de parámetros devuelve datos. Por eso fuegocine devolvía [].
//
// El sitio sí es scrapeable: es un blog de Blogger (plantilla "bloggerbase /
// Plantillas-SEO") y publica los servidores EN el HTML del post, dentro de
//   const _SV_LINKS = [ {lang, name, quality, url, tagVideo}, ... ];
// además, los episodios de una serie son posts de Blogger agrupados con la
// etiqueta `id-<idSerie>`, se piden por el feed JSON del blog:
//   búsqueda : /feeds/posts/default?alt=json&q=<titulo>&max-results=N   (trae el content)
//   episodios: /feeds/posts/default/-/id-<idSerie>?alt=json             (S/E en data-*)
//
// Contrato del motor: CommonJS `module.exports = { getStreams }`, solo fetch +
// RegExp, `var`/`function`, sin String.normalize (no hay ICU en QuickJS).
const BASE = 'https://www.fuegocine.com';
const FEED = BASE + '/feeds/posts/default';
const TMDB_KEY = '439c478a771f35c05022f9feabcca01c'; // misma que pelisplus.js / cinecalidad.js
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const FETCH_TIMEOUT = 12000;
const MAX_RESULTS = 10;

// ─────────────────────────────────────────────────────────
// HTTP
// ─────────────────────────────────────────────────────────

function fetchText(url) {
  var opts = {
    headers: {
      'User-Agent': UA,
      Accept: 'application/json,text/html;q=0.9,*/*;q=0.8',
      'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8',
      Referer: BASE + '/',
    },
  };
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

function fetchJson(url) {
  return fetchText(url).then(function (raw) {
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  });
}

// ─────────────────────────────────────────────────────────
// Texto
// ─────────────────────────────────────────────────────────

var ACCENTS = {
  á: 'a', à: 'a', ä: 'a', â: 'a', ã: 'a',
  é: 'e', è: 'e', ë: 'e', ê: 'e',
  í: 'i', ì: 'i', ï: 'i', î: 'i',
  ó: 'o', ò: 'o', ö: 'o', ô: 'o', õ: 'o',
  ú: 'u', ù: 'u', ü: 'u', û: 'u',
  ñ: 'n', ç: 'c',
};

function fold(s) {
  var lower = String(s == null ? '' : s).toLowerCase();
  var out = '';
  for (var i = 0; i < lower.length; i++) {
    var c = lower.charAt(i);
    out += ACCENTS[c] != null ? ACCENTS[c] : c;
  }
  return out;
}

/** Normaliza títulos: sin acentos, sin puntuación, sin años, espacios simples. */
function norm(s) {
  return fold(s)
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function anioDe(s) {
  var m = String(s || '').match(/(19|20)\d{2}/);
  return m ? parseInt(m[0], 10) : 0;
}

function stripTags(s) {
  return String(s || '').replace(/<[^>]*>/g, ' ');
}

/** "VST✅" -> "VST", "Drive✅" -> "Drive", "LV✅AD" -> "LV AD". */
function nombreLimpio(s) {
  var t = stripTags(s).replace(/[\u2700-\u27BF\u2190-\u21FF\u2B00-\u2BFF\uFE0F\u200D]/g, ' ');
  t = t.replace(/[✅✔☑❌⚠🔴🟡]/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  return t || 'Servidor';
}

function idiomaLabel(lang) {
  var l = fold(lang).trim();
  if (l.indexOf('lat') >= 0 || l.indexOf('mx') >= 0 || l.indexOf('co') >= 0 || l.indexOf('pe') >= 0) {
    return 'Latino';
  }
  if (l.indexOf('esp') >= 0 || l === 'es' || l.indexOf('cas') >= 0) return 'Español';
  if (l.indexOf('sub') >= 0 || l === 'en' || l.indexOf('english') >= 0) return 'Subtitulado';
  if (l.indexOf('br') >= 0 || l.indexOf('pt') >= 0 || l.indexOf('port') >= 0) return 'Portugués';
  if (l.indexOf('fr') >= 0) return 'Francés';
  return 'Latino';
}

function calidadLabel(q) {
  var s = String(q || '').trim();
  if (!s) return 'HD';
  var m = s.match(/(\d{3,4})p/i);
  if (m) return m[1] + 'p';
  var up = s.toUpperCase();
  if (up.indexOf('4K') >= 0 || up.indexOf('2160') >= 0) return '4K';
  if (up.indexOf('MULTI') >= 0) return 'Multicalidad';
  return s;
}

// ─────────────────────────────────────────────────────────
// TMDB (títulos + año)
// ─────────────────────────────────────────────────────────

function tmdbTitulo(tmdbId, isMovie, lang) {
  var tipo = isMovie ? 'movie' : 'tv';
  var url =
    'https://api.themoviedb.org/3/' +
    tipo +
    '/' +
    tmdbId +
    '?api_key=' +
    TMDB_KEY +
    '&language=' +
    lang;
  return fetchJson(url).then(function (d) {
    if (!d) return null;
    var t = d.title != null ? d.title : d.name;
    var o = d.original_title != null ? d.original_title : d.original_name;
    var fecha = d.release_date != null ? d.release_date : d.first_air_date;
    return {
      titulo: t == null ? '' : String(t).trim(),
      original: o == null ? '' : String(o).trim(),
      anio: anioDe(fecha),
    };
  });
}

/** [{titulo, anio}] en es-MX, es-ES y en-US (sin repetir). */
function tmdbTitulos(tmdbId, isMovie) {
  var langs = ['es-MX', 'en-US', 'es-ES'];
  var acc = [];
  var i = 0;

  function paso() {
    if (i >= langs.length) return Promise.resolve(acc);
    var lang = langs[i++];
    return tmdbTitulo(tmdbId, isMovie, lang).then(function (d) {
      if (d && d.titulo) {
        var dup = false;
        for (var k = 0; k < acc.length; k++) {
          if (norm(acc[k].titulo) === norm(d.titulo)) dup = true;
        }
        if (!dup) acc.push({ titulo: d.titulo, anio: d.anio });
      }
      return paso();
    });
  }

  return paso();
}

/** Consultas de búsqueda: título completo y respaldo por palabra larga. */
function consultas(titulo) {
  var base = String(titulo || '').trim();
  var out = [];
  if (base) out.push(base);
  var s = base.replace(/:\s*.*$/, '').trim(); // "Duna: Parte 2" -> "Duna"
  if (s && s !== base) out.push(s);
  var quitar = { the: 1, los: 1, las: 1, una: 1, uno: 1, del: 1, de: 1, la: 1, el: 1, y: 1, and: 1, a: 1 };
  var palabras = fold(base).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(function (w) {
    return w.length > 3 && !quitar[w];
  });
  palabras.sort(function (a, b) {
    return b.length - a.length;
  });
  if (palabras.length) out.push(palabras[0]);
  var uniq = [];
  for (var i = 0; i < out.length; i++) {
    var v = out[i].trim();
    if (v && uniq.indexOf(v) < 0) uniq.push(v);
  }
  return uniq.slice(0, 3);
}

// ─────────────────────────────────────────────────────────
// Feed de Blogger
// ─────────────────────────────────────────────────────────

function entryVal(e, campo) {
  var link = '';
  var links = (e && e.link) || [];
  for (var i = 0; i < links.length; i++) {
    if (links[i].rel === 'alternate') link = links[i].href;
  }
  var cats = [];
  var cat = (e && e.category) || [];
  for (var j = 0; j < cat.length; j++) cats.push(cat[j].term);
  var contenido = (e && e.content && e.content.$t) || '';
  var tipo = (contenido.match(/data-post-type=["']([^"']+)["']/) || [])[1] || '';
  var etiqueta = '';
  for (var k = 0; k < cats.length; k++) {
    if (/^id-\d+$/.test(cats[k])) etiqueta = cats[k];
  }
  return {
    titulo: (e && e.title && e.title.$t) || '',
    link: link,
    tipo: tipo,
    etiqueta: etiqueta,
    content: contenido,
    campo: campo,
  };
}

function buscar(query) {
  var url =
    FEED +
    '?alt=json&q=' +
    encodeURIComponent(query) +
    '&max-results=' +
    MAX_RESULTS +
    '&orderby=relevance';
  return fetchJson(url).then(function (d) {
    var es = (d && d.feed && d.feed.entry) || [];
    var out = [];
    for (var i = 0; i < es.length; i++) out.push(entryVal(es[i], 'feed'));
    return out;
  });
}

function feedEtiqueta(etiqueta) {
  var url = FEED + '/-/' + encodeURIComponent(etiqueta) + '?alt=json&max-results=150';
  return fetchJson(url).then(function (d) {
    var es = (d && d.feed && d.feed.entry) || [];
    var out = [];
    for (var i = 0; i < es.length; i++) out.push(entryVal(es[i], 'label'));
    return out;
  });
}

// ─────────────────────────────────────────────────────────
// _SV_LINKS (la lista de servidores del propio post)
// ─────────────────────────────────────────────────────────

function parseSvLinks(html) {
  var m = String(html || '').match(/_SV_LINKS\s*=\s*\[([\s\S]*?)\]\s*<\/script/);
  var bloque = m ? m[1] : null;
  if (!bloque) {
    var m2 = String(html || '').match(/_SV_LINKS\s*=\s*\[([\s\S]*)\n\s*\]/);
    bloque = m2 ? m2[1] : null;
  }
  if (!bloque) return [];
  var partes = bloque.split('}');
  var out = [];
  for (var i = 0; i < partes.length; i++) {
    var p = partes[i];
    var u = p.match(/url\s*:\s*["']([^"']+)["']/);
    if (!u) continue;
    var lang = p.match(/lang\s*:\s*["']([^"']*)["']/);
    var name = p.match(/name\s*:\s*["']([^"']*)["']/);
    var q = p.match(/quality\s*:\s*["']([^"']*)["']/);
    out.push({
      url: u[1].trim(),
      lang: lang ? lang[1] : '',
      name: name ? name[1] : 'Servidor',
      quality: q ? q[1] : 'HD',
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────
// URLs: desenvolver el wrapper de blogspot y limpiar
// ─────────────────────────────────────────────────────────

var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** base64 -> texto (sin atob: no está garantizado en QuickJS). */
function b64decode(s) {
  var limpio = String(s || '').replace(/[^A-Za-z0-9+/]/g, '');
  var out = '';
  var bits = 0;
  var valor = 0;
  for (var i = 0; i < limpio.length; i++) {
    var idx = B64.indexOf(limpio.charAt(i));
    if (idx < 0) continue;
    valor = (valor << 6) | idx;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((valor >> bits) & 0xff);
    }
  }
  return out;
}

/**
 * El sitio publica muchos servidores envueltos en un blogspot propio:
 *   viejo: https://repfuegocinefree.blogspot.com/?player=fluidplayer&format=video%2Fmp4&link=<url real>
 *   nuevo: https://blogfc13.blogspot.com/?m=1.html?r=<url real en base64>
 * Se devuelve el enlace real (mp4 directo o embed); si no se puede leer, se deja el wrapper.
 */
function desenvolver(url) {
  var u = String(url || '').trim();
  if (!/blogspot\.com/i.test(u)) return u;
  var m = u.match(/[?&]link=([^&]+)/i);
  if (m) {
    var destino = '';
    try {
      destino = decodeURIComponent(m[1]);
    } catch (e) {
      destino = m[1];
    }
    destino = destino.trim();
    if (/^https?:\/\//i.test(destino)) return destino;
  }
  var r = u.match(/[?&]r=([A-Za-z0-9_\-=+/]+)/);
  if (r) {
    var dec = b64decode(r[1]).trim();
    if (/^https?:\/\//i.test(dec)) return dec;
  }
  return u;
}

function esDirecto(u) {
  var s = String(u || '');
  if (/\.(mp4|m3u8|mkv|webm)(\?|$)/i.test(s)) return true;
  return /pixeldrain\.com\/api\/file\//i.test(s);
}

function clave(url) {
  return String(url || '').split('#')[0].trim();
}

/** Convierte una entrada de _SV_LINKS en stream del motor. */
function aStream(sv, pageUrl, vistos) {
  var url = desenvolver(sv.url);
  if (!url) return null;
  var k = clave(url);
  if (vistos[k]) return null;
  vistos[k] = true;
  return {
    title: 'FuegoCine · ' + nombreLimpio(sv.name),
    quality: calidadLabel(sv.quality),
    language: idiomaLabel(sv.lang),
    url: url,
    headers: { Referer: pageUrl || BASE + '/', 'User-Agent': UA },
  };
}

function mapear(lista, pageUrl) {
  var vistos = {};
  var out = [];
  for (var i = 0; i < lista.length; i++) {
    var s = aStream(lista[i], pageUrl, vistos);
    if (s) out.push(s);
  }
  // Directos primero (mp4/m3u8 del wrapper y pixeldrain), luego los embeds.
  out.sort(function (a, b) {
    var da = esDirecto(a.url) ? 0 : 1;
    var db = esDirecto(b.url) ? 0 : 1;
    return da - db;
  });
  return out;
}

// ─────────────────────────────────────────────────────────
// Elección del post correcto
// ─────────────────────────────────────────────────────────

function levenshtein(a, b) {
  var m = a.length;
  var n = b.length;
  if (!m) return n;
  if (!n) return m;
  var prev = [];
  var act = [];
  var i;
  var j;
  for (j = 0; j <= n; j++) prev[j] = j;
  for (i = 1; i <= m; i++) {
    act[0] = i;
    for (j = 1; j <= n; j++) {
      var coste = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      var min = prev[j] + 1;
      if (act[j - 1] + 1 < min) min = act[j - 1] + 1;
      if (prev[j - 1] + coste < min) min = prev[j - 1] + coste;
      act[j] = min;
    }
    for (j = 0; j <= n; j++) prev[j] = act[j];
  }
  return prev[n];
}

/** Tokens equivalentes: iguales, prefijo común o 1 letra de diferencia ("duna"/"dune"). */
function tokenIgual(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length > 3 && b.length > 3 && (a.indexOf(b) === 0 || b.indexOf(a) === 0)) return true;
  return Math.max(a.length, b.length) >= 4 && levenshtein(a, b) <= 1;
}

function similitud(a, b) {
  var na = norm(a);
  var nb = norm(b);
  if (!na || !nb) return 0;
  if (na === nb) return 100;
  if (na.indexOf(nb) >= 0 || nb.indexOf(na) >= 0) return 70;
  var wa = na.split(' ');
  var wb = nb.split(' ');
  var comunes = 0;
  for (var i = 0; i < wa.length; i++) {
    for (var j = 0; j < wb.length; j++) {
      if (tokenIgual(wa[i], wb[j])) {
        comunes++;
        break;
      }
    }
  }
  if (!comunes) return 0;
  return (comunes * 100) / Math.max(wa.length, wb.length);
}

/** Película: el mejor post de tipo movie comparando contra todos los títulos TMDB. */
function elegirPeliculaMulti(entradas, tits) {
  var mejor = null;
  var mejorPunt = 0;
  var mejorAnioOk = false;
  for (var i = 0; i < entradas.length; i++) {
    var e = entradas[i];
    if (e.tipo && e.tipo !== 'movie') continue;
    if (e.content.indexOf('_SV_LINKS') < 0) continue;
    var anioPost = anioDe(e.titulo);
    for (var j = 0; j < tits.length; j++) {
      var punt = similitud(e.titulo, tits[j].titulo);
      var anioOk = !!(tits[j].anio && anioPost === tits[j].anio);
      if (anioOk) punt += 20;
      if (punt > mejorPunt) {
        mejorPunt = punt;
        mejor = e;
        mejorAnioOk = anioOk;
      }
    }
  }
  if (!mejor) return null;
  // Con año confirmado basta un parecido flojo ("Duna" vs "Dune: Parte 2").
  if (mejorAnioOk) return mejorPunt >= 30 ? mejor : null;
  return mejorPunt >= 55 ? mejor : null;
}

/** "Reacher 4x8" -> {nombre:'Reacher', s:4, e:8}; null si no tiene el patrón. */
function datosEpisodio(titulo) {
  var m = String(titulo || '').match(/^(.*?)\s+(\d{1,2})x(\d{1,3})\s*$/);
  if (!m) return null;
  return { nombre: m[1].trim(), s: parseInt(m[2], 10), e: parseInt(m[3], 10) };
}

function coincideSerie(nombreEp, tits) {
  var mejor = 0;
  for (var i = 0; i < tits.length; i++) {
    var p = similitud(nombreEp, tits[i].titulo);
    if (p > mejor) mejor = p;
  }
  return mejor;
}

function episodioDe(contenido, season, episode) {
  var m = /data-season-number=["'](\d+)["'][\s\S]*?data-episode-count=["'](\d+)["']/.exec(contenido);
  var m2 = /data-episode-count=["'](\d+)["'][\s\S]*?data-season-number=["'](\d+)["']/.exec(contenido);
  if (m) return { s: parseInt(m[1], 10), e: parseInt(m[2], 10) };
  if (m2) return { s: parseInt(m2[2], 10), e: parseInt(m2[1], 10) };
  return null;
}

/**
 * Serie: el sitio guarda cada episodio como post propio con el título
 * "<Serie> SxE" y la etiqueta `id-<idSerie>`. Ruta:
 *   1) episodio exacto entre los resultados de búsqueda,
 *   2) feed de la etiqueta (trae la serie completa),
 *   3) búsqueda directa "<Serie> <S>x<E>".
 */
function servidoresDeSerie(entradas, tits, season, episode) {
  function hitDeEntrada(e) {
    if (!e || e.tipo !== 'episode' || e.content.indexOf('_SV_LINKS') < 0) return null;
    var d = datosEpisodio(e.titulo);
    if (!d || d.s !== season || d.e !== episode) return null;
    if (coincideSerie(d.nombre, tits) < 30) return null;
    return { svs: parseSvLinks(e.content), page: e.link };
  }

  // 1) directo desde la búsqueda
  var i;
  for (i = 0; i < entradas.length; i++) {
    var hit = hitDeEntrada(entradas[i]);
    if (hit && hit.svs.length) return Promise.resolve(hit);
  }

  // 2) etiqueta id-<serie> vista en los episodios encontrados
  var etiquetas = {};
  for (i = 0; i < entradas.length; i++) {
    var e = entradas[i];
    if (e.tipo !== 'episode' || !e.etiqueta) continue;
    var d = datosEpisodio(e.titulo);
    if (!d) continue;
    var punt = coincideSerie(d.nombre, tits);
    if (punt < 30) continue;
    if (!etiquetas[e.etiqueta] || punt > etiquetas[e.etiqueta]) etiquetas[e.etiqueta] = punt;
  }
  var labels = Object.keys(etiquetas).sort(function (a, b) {
    return etiquetas[b] - etiquetas[a];
  });

  function probarLabel(k) {
    if (k >= labels.length) return Promise.resolve(null);
    return feedEtiqueta(labels[k]).then(function (eps) {
      for (var j = 0; j < eps.length; j++) {
        var se = episodioDe(eps[j].content, season, episode);
        if (se && se.s === season && se.e === episode && eps[j].content.indexOf('_SV_LINKS') >= 0) {
          var svs = parseSvLinks(eps[j].content);
          if (svs.length) return { svs: svs, page: eps[j].link };
        }
      }
      return probarLabel(k + 1);
    });
  }

  return probarLabel(0).then(function (res) {
    if (res) return res;
    return porConsultaDirecta(tits, season, episode, hitDeEntrada);
  });
}

/** 3) respaldo: buscar "<Serie> <S>x<E>" en el feed. */
function porConsultaDirecta(tits, season, episode, hitDeEntrada) {
  var i = 0;
  function paso() {
    if (i >= tits.length) return Promise.resolve(null);
    var consulta = tits[i++].titulo + ' ' + season + 'x' + episode;
    return buscar(consulta).then(function (es) {
      for (var k = 0; k < es.length; k++) {
        var hit = hitDeEntrada(es[k]);
        if (hit && hit.svs.length) return hit;
      }
      return paso();
    });
  }
  return paso();
}

// ─────────────────────────────────────────────────────────
// Pipeline
// ─────────────────────────────────────────────────────────

/** ¿Ya hay material usable? (película elegible, o episodios de la serie con su etiqueta). */
function hayCandidato(acumulado, tits, isMovie, season, episode) {
  if (isMovie) return !!elegirPeliculaMulti(acumulado, tits);
  for (var i = 0; i < acumulado.length; i++) {
    var e = acumulado[i];
    if (e.tipo !== 'episode') continue;
    var d = datosEpisodio(e.titulo);
    if (!d) continue;
    if (coincideSerie(d.nombre, tits) < 30) continue;
    if (d.s === season && d.e === episode) return true;
    if (e.etiqueta) return true; // con la etiqueta ya se puede pedir la serie completa
  }
  return false;
}

function buscarEntradas(tits, isMovie, season, episode) {
  var i = 0;
  var acumulado = [];
  var vistosLink = {};

  function paso() {
    if (i >= tits.length) return Promise.resolve(acumulado);
    var t = tits[i++];
    var qs = consultas(t.titulo);
    var j = 0;
    function inner() {
      if (j >= qs.length) return paso();
      var q = qs[j++];
      return buscar(q).then(function (es) {
        for (var k = 0; k < es.length; k++) {
          var l = es[k].link || es[k].titulo;
          if (vistosLink[l]) continue;
          vistosLink[l] = true;
          es[k].tituloTmdb = t.titulo;
          es[k].anioTmdb = t.anio;
          acumulado.push(es[k]);
        }
        if (hayCandidato(acumulado, tits, isMovie, season, episode)) return acumulado;
        return inner();
      });
    }
    return inner();
  }

  return paso();
}

function getStreams(tmdbId, mediaType, season, episode) {
  var id = parseInt(tmdbId, 10);
  if (isNaN(id) || id <= 0) return Promise.resolve([]);
  var tipo = String(mediaType || 'movie').toLowerCase();
  var isMovie = tipo !== 'tv' && tipo !== 'series' && tipo !== 'anime';
  var s = parseInt(season, 10);
  var e = parseInt(episode, 10);
  if (isNaN(s) || s < 1) s = 1;
  if (isNaN(e) || e < 1) e = 1;

  return tmdbTitulos(id, isMovie)
    .then(function (tits) {
      if (!tits.length) return [];
      return buscarEntradas(tits, isMovie, s, e).then(function (entradas) {
        if (!entradas.length) return [];
        if (isMovie) {
          var mejor = elegirPeliculaMulti(entradas, tits);
          if (!mejor) return [];
          return mapear(parseSvLinks(mejor.content), mejor.link);
        }
        return servidoresDeSerie(entradas, tits, s, e).then(function (hit) {
          if (!hit || !hit.svs.length) return [];
          return mapear(hit.svs, hit.page);
        });
      });
    })
    .catch(function () {
      return [];
    });
}

module.exports = { getStreams };
