// smartpelis — puerto a JS de lib/data/extractors/providers/smartpelis_extractor.dart
// (el extractor Dart del proyecto original), adaptado al contrato que ejecuta el
// motor de MasterScrap: CommonJS `module.exports = { getStreams }`, solo
// fetch + JSON + RegExp + setTimeout + AbortController (sin cheerio, sin URL,
// sin dependencias npm).
//
// Pipeline replicado del Dart:
//   TMDB (es-MX / es-ES / en-US) → candidatos de slug (/capitulo/...-temporada-S-capitulo-E/
//   o /pelicula/<slug>/) → primera página válida (contiene "aa-options") →
//   botones href="#options-N" (opción + idioma) → bloques <div id="options-N"> con
//   <iframe src="?trembed=N&trid=..."> → el embed devuelve el iframe final
//   (fastream.to) → se descomprime su player empaquetado y se saca el .m3u8/.mp4.
//
// Si no se puede resolver el player final se devuelve la URL del embed, para no
// perder la fuente.
const BASE = "https://smartpelis.tv";
const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_KEY = "a2d9bbed370d9f678e34006f8750a5a5";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36";

const PAGE_HEADERS = {
  "User-Agent": UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
  Referer: BASE + "/",
};

/** GET de texto con timeout propio; devuelve null ante cualquier fallo (nunca lanza). */
function fetchText(url, extraHeaders, timeout) {
  const ms = timeout || 20000;
  let controller = null;
  let signal = null;
  try {
    if (typeof AbortController !== "undefined") {
      controller = new AbortController();
      signal = controller.signal;
      if (typeof setTimeout !== "undefined") {
        setTimeout(function () {
          try {
            controller.abort();
          } catch (e) {}
        }, ms);
      }
    }
  } catch (e) {
    controller = null;
  }
  const req = { headers: Object.assign({}, extraHeaders || {}), redirect: "follow" };
  if (signal) req.signal = signal;
  return fetch(url, req)
    .then(function (res) {
      if (!res || !res.ok) return null;
      return res.text();
    })
    .then(function (txt) {
      return txt && txt.length ? txt : null;
    })
    .catch(function () {
      return null;
    });
}

function hostOf(url) {
  if (!url) return "";
  const m = String(url).match(/^https?:\/\/([^\/?#]+)/i);
  return m ? m[1].toLowerCase() : "";
}

function decodeEntities(s) {
  return String(s == null ? "" : s)
    .replace(/&amp;/g, "&")
    .replace(/&#038;/g, "&")
    .replace(/&#0?38;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

/** Igual que _slugify del Dart: minúsculas, sin acentos y guiones entre palabras. */
function slugify(title) {
  const map = {
    "á": "a", "à": "a", "ä": "a", "â": "a", "ã": "a",
    "é": "e", "è": "e", "ë": "e", "ê": "e",
    "í": "i", "ì": "i", "ï": "i", "î": "i",
    "ó": "o", "ò": "o", "ö": "o", "ô": "o", "õ": "o",
    "ú": "u", "ù": "u", "ü": "u", "û": "u",
    "ñ": "n", "ç": "c",
  };
  let s = String(title || "").trim().toLowerCase();
  for (const k in map) {
    if (Object.prototype.hasOwnProperty.call(map, k)) s = s.split(k).join(map[k]);
  }
  s = s.replace(/[^a-z0-9\s-]/g, "");
  s = s.replace(/[\s-]+/g, "-");
  return s.replace(/^-+|-+$/g, "");
}

/** options-0 → Opción 1, como _optionFromId. */
function optionFromId(id) {
  const m = String(id || "").match(/(\d+)$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (isNaN(n)) return null;
  if (/^options?-/.test(id)) return n + 1;
  return n;
}

/** Etiqueta visible del idioma (el Dart lo codificaba a es_MX/es_ES/en_US/ja_JA). */
function idiomaLabel(raw) {
  const l = String(raw == null ? "" : raw).toLowerCase().trim();
  if (!l || l === "desconocido") return "Desconocido";
  if (l.indexOf("latino") >= 0 || l === "lat" || l === "mx") return "Latino";
  if (l.indexOf("castellano") >= 0 || l.indexOf("españa") >= 0 || l.indexOf("espana") >= 0 || l.indexOf("spain") >= 0) return "Español";
  if (l.indexOf("inglés") >= 0 || l.indexOf("ingles") >= 0 || l.indexOf("english") >= 0 || l.indexOf("sub") >= 0 || l.indexOf("vose") >= 0) return "Subtitulado";
  if (l.indexOf("japon") >= 0) return "Japonés";
  return String(raw).trim();
}

/** TMDB en tres idiomas, como _getTmdbInfo: los slugs del sitio usan el título español. */
async function getTmdbInfo(tmdbId, mediaType) {
  const endpoint = mediaType === "movie" ? "movie" : "tv";

  async function fetchLang(lang) {
    const url =
      TMDB_BASE + "/" + endpoint + "/" + tmdbId + "?api_key=" + TMDB_KEY + "&language=" + lang;
    const raw = await fetchText(url, { Accept: "application/json", "User-Agent": UA }, 12000);
    if (!raw) return null;
    let data = null;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return null;
    }
    if (!data || typeof data !== "object" || data.success === false) return null;
    return data;
  }

  const es = await fetchLang("es-MX");
  const eses = await fetchLang("es-ES");
  const en = await fetchLang("en-US");

  const titles = [];
  function addTitle(data, pref, orig) {
    if (!data) return;
    const t = String(data[pref] == null ? "" : data[pref]).trim();
    const o = String(data[orig] == null ? "" : data[orig]).trim();
    if (t && titles.indexOf(t) < 0) titles.push(t);
    if (o && titles.indexOf(o) < 0) titles.push(o);
  }
  if (mediaType === "movie") {
    addTitle(es, "title", "original_title");
    addTitle(eses, "title", "original_title");
    addTitle(en, "title", "original_title");
  } else {
    addTitle(es, "name", "original_name");
    addTitle(eses, "name", "original_name");
    addTitle(en, "name", "original_name");
  }

  let year = null;
  const dateStr =
    mediaType === "movie"
      ? (es && es.release_date) || (en && en.release_date)
      : (es && es.first_air_date) || (en && en.first_air_date);
  if (dateStr && String(dateStr).length >= 4) {
    const y = parseInt(String(dateStr).substring(0, 4), 10);
    if (!isNaN(y)) year = y;
  }
  return { titles: titles, year: year };
}

/** _buildCandidates: pelicula/<slug>[-id|-año] o capitulo/<slug>-temporada-S-capitulo-E[-id|-año]. */
function buildCandidates(titles, year, tmdbId, isMovie, season, episode) {
  const out = [];
  function push(u) {
    if (u && out.indexOf(u) < 0) out.push(u);
  }
  for (let i = 0; i < titles.length; i++) {
    const slug = slugify(titles[i]);
    if (!slug) continue;
    if (isMovie) {
      push(BASE + "/pelicula/" + slug + "/");
      push(BASE + "/pelicula/" + slug + "-" + tmdbId + "/");
      if (year) push(BASE + "/pelicula/" + slug + "-" + year + "/");
    } else {
      const baseSlug = slug + "-temporada-" + season + "-capitulo-" + episode;
      push(BASE + "/capitulo/" + baseSlug + "/");
      push(BASE + "/capitulo/" + baseSlug + "-" + tmdbId + "/");
      if (year) push(BASE + "/capitulo/" + baseSlug + "-" + year + "/");
    }
  }
  return out;
}

function isValidPage(html) {
  if (!html) return false;
  return html.indexOf('id="aa-options"') >= 0 || html.indexOf("id='aa-options'") >= 0 || html.indexOf("aa-options") >= 0;
}

/** Primera URL de candidatos que responde con la página del reproductor. */
async function findWorkingUrl(candidates) {
  // Se prueban de a TANDA en paralelo: probar los candidatos uno detrás de otro
  // costaba la suma de todas las latencias (era el grueso de los ~8 s del provider).
  // Dentro de cada tanda se respeta el orden de preferencia de los candidatos.
  const TANDA = 6;
  for (let inicio = 0; inicio < candidates.length; inicio += TANDA) {
    const tanda = candidates.slice(inicio, inicio + TANDA);
    const htmls = await Promise.all(
      tanda.map((u) =>
        fetchText(u, PAGE_HEADERS).catch(() => null)
      )
    );
    for (let i = 0; i < tanda.length; i++) {
      if (htmls[i] && isValidPage(htmls[i])) return { url: tanda[i], html: htmls[i] };
    }
  }
  return null;
}

/** data-src tiene prioridad sobre src, como _extractIframeSrc. */
function extractIframeSrc(html) {
  const src = String(html == null ? "" : html);
  const d = src.match(/<iframe[^>]*\bdata-src=["']([^"']+)["']/i);
  if (d) {
    const u = decodeEntities(d[1]).trim();
    if (u) return u;
  }
  const s = src.match(/<iframe[^>]*\bsrc=["']([^"']+)["']/i);
  if (s) {
    const u = decodeEntities(s[1]).trim();
    if (u) return u;
  }
  return null;
}

/** _resolveEmbed: si el iframe ya es de otro host se usa tal cual; si no, se abre y se anida. */
async function resolveEmbed(embedUrl) {
  let url = String(embedUrl == null ? "" : embedUrl).trim();
  if (!url) return null;
  if (url.charAt(0) === "/") url = BASE + url;
  else if (url.charAt(0) === "?") url = BASE + "/" + url;

  const host = hostOf(url);
  if (host && host.indexOf("smartpelis") < 0) return url;

  const embedHtml = await fetchText(url, PAGE_HEADERS);
  if (!embedHtml) return null;

  const inner = extractIframeSrc(embedHtml);
  if (inner) {
    if (hostOf(inner).indexOf("smartpelis") >= 0) {
      const deeper = await fetchText(inner, PAGE_HEADERS);
      if (deeper) {
        const finalUrl = extractIframeSrc(deeper);
        if (finalUrl) return finalUrl;
      }
    }
    return inner;
  }

  const m3u8 = embedHtml.match(/(?:file|src|source)\s*[:=]\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i);
  if (m3u8) return m3u8[1];
  const mp4 = embedHtml.match(/(?:file|src|source)\s*[:=]\s*["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i);
  if (mp4) return mp4[1];
  return null;
}

/** Dean Edwards packer (el player de fastream viene empaquetado). */
function unpackPacked(html) {
  try {
    const pMatch = String(html == null ? "" : html).match(
      /eval\(function\(p,a,c,k,e,[premd]\)\{.*?\}\s*\('([\s\S]*?)',\s*(\d+),\s*(\d+),\s*'([\s\S]*?)'\.split\('\|'\)/
    );
    if (!pMatch) return null;
    const p = pMatch[1];
    const radix = parseInt(pMatch[2], 10);
    const k = pMatch[4].split("|");
    const symbols = "0123456789abcdefghijklmnopqrstuvwxyz";
    function base36(n) {
      let r = "";
      while (n > 0) {
        r = symbols[n % radix] + r;
        n = Math.floor(n / radix);
      }
      return r || "0";
    }
    return p.replace(/\b\w+\b/g, function (w) {
      const idx = parseInt(w, 36);
      if (!isNaN(idx) && idx < k.length && k[idx]) return k[idx];
      return base36(idx);
    });
  } catch (e) {
    return null;
  }
}

function guessQuality(url) {
  const u = String(url == null ? "" : url);
  const num = u.match(/[_-](\d{3,4})p/);
  if (num) return num[1] + "p";
  const set = u.match(/_([a-z,]+),\.urlset/i);
  if (set) {
    const labels = set[1].split(",");
    if (labels.indexOf("x") >= 0 || labels.indexOf("o") >= 0 || labels.indexOf("h") >= 0) return "1080p";
    if (labels.indexOf("n") >= 0) return "720p";
    if (labels.indexOf("l") >= 0) return "480p";
  }
  return "HD";
}

/** Busca el .m3u8/.mp4 dentro del player (empaquetado o no). */
function findMediaUrl(text) {
  if (!text) return null;
  let m = text.match(/["']?file["']?\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i);
  if (m) return { url: m[1], kind: "m3u8" };
  m = text.match(/(https?:\/\/[^\s"'<>\\]+\.m3u8[^\s"'<>\\]*)/i);
  if (m) return { url: m[1], kind: "m3u8" };
  m = text.match(/["']?file["']?\s*:\s*["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i);
  if (m) return { url: m[1], kind: "mp4" };
  m = text.match(/(https?:\/\/[^\s"'<>\\]+\.mp4[^\s"'<>\\]*)/i);
  if (m) return { url: m[1], kind: "mp4" };
  return null;
}

/** Abre el embed final (fastream, etc.) y devuelve la URL reproducible. */
async function resolvePlayable(embedUrl) {
  const url = String(embedUrl == null ? "" : embedUrl).trim();
  if (!url || !/^https?:\/\//i.test(url)) return null;
  if (/\.(?:m3u8|mp4)(?:$|[?#])/i.test(url)) {
    return { url: url, quality: guessQuality(url), referer: hostOf(url) ? "https://" + hostOf(url) + "/" : BASE + "/" };
  }
  const headers = Object.assign({}, PAGE_HEADERS, { Referer: BASE + "/" });
  const html = await fetchText(url, headers);
  if (!html) return null;
  const unpacked = unpackPacked(html);
  const found = findMediaUrl(unpacked) || findMediaUrl(html);
  if (!found) return null;
  const host = hostOf(url);
  return {
    url: found.url,
    quality: found.kind === "mp4" ? "HD" : guessQuality(found.url),
    referer: host ? "https://" + host + "/" : BASE + "/",
  };
}

/** Botones (#options-N → opción + idioma) + bloques de vídeo + fallback a los iframes de aa-options. */
async function scrapePage(html) {
  const result = [];

  const buttonInfo = {};
  const btnRe = /<a[^>]*href=["']#([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = btnRe.exec(html)) !== null) {
    const id = m[1];
    const inner = m[2] || "";
    let option = null;
    const numM = inner.match(/<span(?![^>]*class=["'][^"']*server)[^>]*>\s*(\d+)\s*<\/span>/i);
    if (numM) {
      const n = parseInt(numM[1], 10);
      if (!isNaN(n)) option = n;
    }
    let language = "Desconocido";
    const langM = inner.match(/<span[^>]*class=["'][^"']*server[^"']*["'][^>]*>\s*-?\s*([^<]+?)\s*<\/span>/i);
    if (langM) {
      language = langM[1].trim().replace(/^-\s*/, "");
      if (language.toUpperCase() === "VOSE") language = "Subtitulado";
    }
    buttonInfo[id] = { option: option, language: language };
  }

  const blockRe = /<div[^>]*\bid=["'](options?-\d+|video-\d+|opt-\d+)["'][^>]*>([\s\S]*?)<\/div>/gi;
  const seenIds = [];
  while ((m = blockRe.exec(html)) !== null) {
    const id = (m[1] || "").trim();
    const block = m[2] || "";
    if (!id || seenIds.indexOf(id) >= 0) continue;
    const isOptions = id.indexOf("options") === 0 || id.indexOf("option") === 0;
    const hasIframe = block.toLowerCase().indexOf("iframe") >= 0;
    if (!isOptions && !hasIframe) continue;
    seenIds.push(id);

    const iframeSrc = extractIframeSrc(block);
    if (!iframeSrc) continue;
    const serverUrl = await resolveEmbed(iframeSrc);
    if (!serverUrl) continue;

    const info = buttonInfo[id];
    result.push({
      option: info && info.option != null ? info.option : optionFromId(id),
      language: (info && info.language) || "Desconocido",
      url: serverUrl,
    });
  }

  if (!result.length) {
    const aaMatch = html.match(/id=["']aa-options["'][^>]*>([\s\S]*?)<\/aside>/i);
    const section = aaMatch ? aaMatch[1] : html;
    const iframeRe = /<iframe[^>]*(?:data-src|src)=["']([^"']+)["']/gi;
    const seenSrc = [];
    let opt = 1;
    while ((m = iframeRe.exec(section)) !== null) {
      const src = decodeEntities(m[1]).trim();
      if (!src || seenSrc.indexOf(src) >= 0) continue;
      seenSrc.push(src);
      const serverUrl = await resolveEmbed(src);
      if (!serverUrl) continue;
      const info = buttonInfo["options-" + (opt - 1)] || buttonInfo["option-" + opt];
      result.push({
        option: info && info.option != null ? info.option : opt,
        language: (info && info.language) || "Desconocido",
        url: serverUrl,
      });
      opt++;
    }
  }

  return result;
}

async function extractStreams(tmdbId, mediaType, season, episode) {
  const id = parseInt(tmdbId, 10);
  if (!id || id <= 0) return [];
  const isMovie = mediaType === "movie";
  const tmdbType = isMovie ? "movie" : "tv";
  const s = parseInt(season, 10) || 1;
  const e = parseInt(episode, 10) || 1;

  const tmdb = await getTmdbInfo(id, tmdbType);
  if (!tmdb.titles.length) return [];

  const candidates = buildCandidates(tmdb.titles, tmdb.year, id, isMovie, s, e);
  const found = await findWorkingUrl(candidates);
  if (!found) return [];

  const rawServers = await scrapePage(found.html);
  if (!rawServers.length) return [];

  const streams = [];
  const seen = [];
  const unicos = [];
  for (let i = 0; i < rawServers.length; i++) {
    const raw = rawServers[i];
    const url = String(raw.url || "").trim();
    if (!url || seen.indexOf(url) >= 0) continue;
    seen.push(url);
    unicos.push({ raw, url });
  }

  // Los servidores se resuelven EN PARALELO (antes uno detrás de otro, así que el
  // tiempo total era la suma de todas las latencias). Máximo LIMITE a la vez para no
  // dispararle 10 peticiones al mismo CDN.
  const LIMITE = 4;
  const resueltos = new Array(unicos.length);
  let siguiente = 0;
  const obreros = [];
  for (let w = 0; w < Math.min(LIMITE, unicos.length); w++) {
    obreros.push(
      (async () => {
        for (;;) {
          const idx = siguiente++;
          if (idx >= unicos.length) return;
          try {
            resueltos[idx] = await resolvePlayable(unicos[idx].url);
          } catch (err) {
            resueltos[idx] = null;
          }
        }
      })()
    );
  }
  await Promise.all(obreros);

  for (let i = 0; i < unicos.length; i++) {
    const raw = unicos[i].raw;
    const url = unicos[i].url;
    const playable = resueltos[i];
    const finalUrl = playable ? playable.url : url;
    const idioma = idiomaLabel(raw.language);
    const option = raw.option;
    streams.push({
      title: (option != null ? "Opción " + option : "Servidor") + " · " + idioma,
      quality: playable ? playable.quality : "HD",
      language: idioma,
      url: finalUrl,
      headers: {
        Referer: playable ? playable.referer : (hostOf(url) ? "https://" + hostOf(url) + "/" : BASE + "/"),
        "User-Agent": UA,
        // El CDN de fastream responde 403 al .m3u8 si falta el Accept de navegador
        // (comprobado en pelispedia.js): sin esto la URL sale bien y el reproductor no.
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
      },
    });
  }
  return streams;
}

function withTimeout(promise, ms) {
  if (typeof setTimeout === "undefined") return promise;
  return Promise.race([
    promise,
    new Promise(function (res) {
      setTimeout(function () {
        res([]);
      }, ms);
    }),
  ]);
}

function getStreams(tmdbId, mediaType, season, episode) {
  return withTimeout(
    extractStreams(tmdbId, mediaType, season, episode).catch(function () {
      return [];
    }),
    40000
  );
}

module.exports = { getStreams };
