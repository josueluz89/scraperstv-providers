/**
 * Pelispedia — puerto a JS de lib/data/extractors/providers/pelispedia_extractor.dart
 * al contrato del motor de MasterScrap: CommonJS `module.exports = { getStreams }`,
 * solo fetch + RegExp + AbortController, sin dependencias.
 *
 * Flujo (igual que el Dart):
 *   TMDB (títulos es-MX / es-ES / en-US + año) → candidatos slug
 *   → página con #aa-options → iframes ?trembed=N → servidor final del embed.
 *
 * Extra añadido al puerto: el embed final (fastream y similares) publica el
 * m3u8 directo dentro de un JS empaquetado (eval(function(p,a,c,k,e,d)...)).
 * Si se logra desempacar se devuelve el .m3u8/.mp4 directo con su calidad real;
 * si no, se devuelve la URL del embed tal cual hacía el Dart.
 */
const BASE = "https://pelispedia.is";
const TMDB_KEY = "a2d9bbed370d9f678e34006f8750a5a5";
const TMDB_BASE = "https://api.themoviedb.org/3";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36";

const PAGE_TIMEOUT = 12000;
const EMBED_TIMEOUT = 10000;
const TOTAL_TIMEOUT = 35000;

const BROWSER_ACCEPT =
  "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
const BROWSER_LANG = "es-ES,es;q=0.9,en;q=0.8";

/**
 * Cabeceras que se entregan al reproductor.
 * Importante: el CDN de fastream responde 403 al .m3u8 si falta el Accept de
 * navegador (comprobado: sin Accept → 403, con Accept → 200 y master real).
 */
function mediaHeaders(referer) {
  return {
    "User-Agent": UA,
    Accept: BROWSER_ACCEPT,
    "Accept-Language": BROWSER_LANG,
    Referer: referer || BASE + "/",
  };
}

// ─── HTTP ───────────────────────────────────────────────────────────────────

function fetchText(url, extraHeaders, timeoutMs) {
  return new Promise(function (resolve) {
    var controller = null;
    var timer = null;
    try {
      if (typeof AbortController !== "undefined") controller = new AbortController();
    } catch (e) {
      controller = null;
    }
    function done(value) {
      if (timer && typeof clearTimeout !== "undefined") {
        try { clearTimeout(timer); } catch (e) {}
      }
      resolve(value);
    }
    if (controller && typeof setTimeout !== "undefined") {
      timer = setTimeout(function () {
        try { controller.abort(); } catch (e) {}
      }, timeoutMs || PAGE_TIMEOUT);
    }
    var headers = {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
      Referer: BASE + "/",
    };
    for (var k in extraHeaders || {}) {
      if (!Object.prototype.hasOwnProperty.call(extraHeaders, k)) continue;
      if (extraHeaders[k] == null) continue;
      headers[k] = extraHeaders[k];
    }
    var opts = { headers: headers, redirect: "follow" };
    if (controller) opts.signal = controller.signal;
    fetch(url, opts)
      .then(function (res) {
        if (!res.ok) return done(null);
        return res.text().then(function (t) { return done(t && t.length ? t : null); });
      })
      .catch(function () { return done(null); });
  });
}

function originOf(url) {
  var m = String(url || "").match(/^(https?:\/\/[^\/]+)/i);
  return m ? m[1] : "";
}

function hostOf(url) {
  return originOf(url).replace(/^https?:\/\//i, "").toLowerCase();
}

// ─── TMDB ───────────────────────────────────────────────────────────────────

async function tmdbInfo(tmdbId, mediaType) {
  const endpoint = mediaType === "movie" ? "movie" : "tv";
  const titles = [];
  const seenTitle = {};
  let year = null;

  async function fetchLang(lang) {
    try {
      const raw = await fetchText(
        TMDB_BASE + "/" + endpoint + "/" + tmdbId + "?api_key=" + TMDB_KEY + "&language=" + lang,
        { Accept: "application/json", Referer: undefined },
        12000
      );
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || typeof data !== "object" || data.success === false) return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  const es = await fetchLang("es-MX");
  const eses = await fetchLang("es-ES");
  const en = await fetchLang("en-US");

  function addTitle(data) {
    if (!data) return;
    const pairs =
      mediaType === "movie"
        ? [data.title, data.original_title]
        : [data.name, data.original_name];
    for (var i = 0; i < pairs.length; i++) {
      const t = String(pairs[i] == null ? "" : pairs[i]).trim();
      if (t && !seenTitle[t]) {
        seenTitle[t] = true;
        titles.push(t);
      }
    }
  }

  addTitle(es);
  addTitle(eses);
  addTitle(en);

  const dateStr =
    mediaType === "movie"
      ? (es && es.release_date) || (en && en.release_date)
      : (es && es.first_air_date) || (en && en.first_air_date);
  if (dateStr && String(dateStr).length >= 4) {
    const y = parseInt(String(dateStr).substring(0, 4), 10);
    if (y > 1800) year = y;
  }

  return { titles: titles, year: year };
}

// ─── Slugs ──────────────────────────────────────────────────────────────────

const ACCENTS = {
  "á": "a", "à": "a", "ä": "a", "â": "a", "ã": "a",
  "é": "e", "è": "e", "ë": "e", "ê": "e",
  "í": "i", "ì": "i", "ï": "i", "î": "i",
  "ó": "o", "ò": "o", "ö": "o", "ô": "o", "õ": "o",
  "ú": "u", "ù": "u", "ü": "u", "û": "u",
  "ñ": "n", "ç": "c",
};

function slugify(title) {
  let s = String(title || "").trim().toLowerCase();
  s = s.replace(/[áàäâãéèëêíìïîóòöôõúùüûñç]/g, function (c) {
    return ACCENTS[c] || "";
  });
  s = s.replace(/[^a-z0-9\s-]/g, "");
  s = s.replace(/[\s-]+/g, "-");
  return s.replace(/^-+|-+$/g, "");
}

function buildCandidates(titles, year, tmdbId, isMovie, season, episode) {
  const out = [];
  const seen = {};
  function push(slug, kind) {
    if (!slug) return;
    const url = BASE + "/" + kind + "/" + slug + "/";
    if (!seen[url]) {
      seen[url] = true;
      out.push(url);
    }
  }
  for (var i = 0; i < titles.length; i++) {
    const slug = slugify(titles[i]);
    if (!slug) continue;
    if (isMovie) {
      push(slug, "pelicula");
      push(slug + "-" + tmdbId, "pelicula");
      if (year) push(slug + "-" + year, "pelicula");
    } else {
      const baseSlug = slug + "-temporada-" + season + "-capitulo-" + episode;
      push(baseSlug, "capitulo");
      push(baseSlug + "-" + tmdbId, "capitulo");
      if (year) push(baseSlug + "-" + year, "capitulo");
    }
  }
  return out;
}

// ─── HTML helpers ───────────────────────────────────────────────────────────

function decodeEntities(s) {
  return String(s == null ? "" : s)
    .replace(/&amp;/g, "&")
    .replace(/&#0?38;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'");
}

function extractIframeSrc(html) {
  const dataSrc = String(html || "").match(/<iframe[^>]*\bdata-src=["']([^"']+)["']/i);
  if (dataSrc) {
    const u = decodeEntities(dataSrc[1]).trim();
    if (u) return u;
  }
  const src = String(html || "").match(/<iframe[^>]*\bsrc=["']([^"']+)["']/i);
  if (src) {
    const u = decodeEntities(src[1]).trim();
    if (u) return u;
  }
  return null;
}

/** Botones href="#options-N" → { option, language }. */
function parseButtons(html) {
  const info = {};
  const re = /<a[^>]*href=["']#([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const id = m[1];
    const inner = m[2] || "";
    if (!id || id === "#" || info[id]) continue;

    let option = null;
    const numM = inner.match(/<span(?![^>]*class=["'][^"']*server)[^>]*>\s*(\d+)\s*<\/span>/i);
    if (numM) {
      const n = parseInt(numM[1], 10);
      if (!isNaN(n)) option = n;
    }

    let language = "Desconocido";
    const langM = inner.match(
      /<span[^>]*class=["'][^"']*server[^"']*["'][^>]*>\s*-?\s*([^<]+?)\s*<\/span>/i
    );
    if (langM) {
      const raw = String(langM[1]).trim().replace(/^-\s*/, "");
      if (raw) language = raw.toUpperCase() === "VOSE" ? "Subtitulado" : raw;
    }
    info[id] = { option: option, language: language };
  }
  return info;
}

function optionFromId(id) {
  const m = String(id || "").match(/(\d+)$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (isNaN(n)) return null;
  if (/^options?-/.test(id)) return n + 1;
  return n;
}

/** "Latino" | "Español" | "Subtitulado" | "Inglés" | label crudo. */
function normalizarIdioma(label) {
  const l = String(label || "").toLowerCase();
  if (l.indexOf("latino") !== -1 || l === "lat" || l === "mx") return "Latino";
  if (l.indexOf("castellano") !== -1 || l.indexOf("espa") !== -1 || l.indexOf("spain") !== -1)
    return "Español";
  if (l.indexOf("subtit") !== -1 || l.indexOf("vose") !== -1 || l.indexOf("sub") !== -1)
    return "Subtitulado";
  if (l.indexOf("ingl") !== -1 || l.indexOf("english") !== -1) return "Inglés";
  if (l.indexOf("japon") !== -1) return "Japonés";
  return label || "Desconocido";
}

// ─── Desempaquetado del embed (fastream y similares) ────────────────────────

/** Dean Edwards packer: eval(function(p,a,c,k,e,d){...}('...',a,c,'...'.split('|'))) */
function unpackPacked(html) {
  try {
    const m = String(html || "").match(
      /eval\(function\(p,a,c,k,e,[a-z]\)\{[\s\S]*?\}\('([\s\S]*?)',\s*(\d+),\s*(\d+),\s*'([\s\S]*?)'\.split\('\|'\)/
    );
    if (!m) return null;
    const p = m[1];
    const a = parseInt(m[2], 10);
    let c = parseInt(m[3], 10);
    const k = m[4].split("|");
    const symbols = "0123456789abcdefghijklmnopqrstuvwxyz";
    function base36(num) {
      let r = "";
      let n = num;
      while (n > 0) {
        r = symbols[n % a] + r;
        n = Math.floor(n / a);
      }
      return r || "0";
    }
    return p.replace(/\b\w+\b/g, function (w) {
      const idx = parseInt(w, 36);
      if (isNaN(idx)) return w;
      if (idx < k.length && k[idx]) return k[idx];
      if (w.length > 1) return base36(idx);
      return w;
    });
  } catch (e) {
    return null;
  }
}

function findMediaUrl(text) {
  const hls = String(text || "").match(
    /(?:https?:)?\/\/[^"'\s<>\\]+\.m3u8[^"'\s<>\\]*/
  );
  if (hls) {
    let u = hls[0].replace(/\\/g, "");
    if (u.indexOf("//") === 0) u = "https:" + u;
    return u;
  }
  const mp4 = String(text || "").match(
    /(?:https?:)?\/\/[^"'\s<>\\]+\.mp4[^"'\s<>\\]*/
  );
  if (mp4) {
    let u = mp4[0].replace(/\\/g, "");
    if (u.indexOf("//") === 0) u = "https:" + u;
    return u;
  }
  return null;
}

function qualityFromHint(text) {
  const m = String(text || "").match(/qualityLabels["']?\s*:\s*\{[^}]*"?(2160|1080|720|480|360|240)"?/i);
  if (m) return m[1] + "p";
  const n = String(text || "").match(/[_-](\d{3,4})p/);
  if (n) return n[1] + "p";
  return null;
}

/** Lee el m3u8 maestro (si lo es) para sacar la mejor resolución. */
async function detectQuality(url) {
  try {
    const text = await fetchText(url, { Referer: originOf(url) + "/" }, 6000);
    if (!text || text.indexOf("#EXT-X-STREAM-INF") === -1) return null;
    const re = /RESOLUTION=(\d+)x(\d+)/g;
    let best = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const h = parseInt(m[2], 10);
      if (h > best) best = h;
    }
    if (best >= 2160) return "4K";
    if (best >= 1080) return "1080p";
    if (best >= 720) return "720p";
    if (best >= 480) return "480p";
    if (best > 0) return best + "p";
    return null;
  } catch (e) {
    return null;
  }
}

// ─── Resolución de embeds ───────────────────────────────────────────────────

/**
 * Devuelve { url, quality, headers } o null.
 * Mismo recorrido que _resolveEmbed del Dart, y después intenta sacar el
 * archivo directo (.m3u8/.mp4) del HTML del embed.
 */
async function resolveEmbed(embedUrl, pageUrl) {
  let url = String(embedUrl || "").trim();
  if (!url) return null;
  if (url.indexOf("//") === 0) url = "https:" + url;
  if (url.charAt(0) === "/") url = BASE + url;
  else if (url.charAt(0) === "?") url = BASE + "/" + url;
  if (!/^https?:\/\//i.test(url)) return null;

  const host = hostOf(url);
  if (host && host.indexOf("pelispedia") === -1) {
    return await directOrEmbed(url, pageUrl);
  }

  const embedHtml = await fetchText(url, null, EMBED_TIMEOUT);
  if (!embedHtml) return null;

  const inner = extractIframeSrc(embedHtml);
  if (inner) {
    let innerUrl = inner;
    if (innerUrl.indexOf("//") === 0) innerUrl = "https:" + innerUrl;
    if (innerUrl.charAt(0) === "/") innerUrl = BASE + innerUrl;
    const host2 = hostOf(innerUrl);
    if (host2 && host2.indexOf("pelispedia") !== -1) {
      const deeper = await fetchText(innerUrl, null, EMBED_TIMEOUT);
      if (deeper) {
        const finalSrc = extractIframeSrc(deeper);
        if (finalSrc && finalSrc !== innerUrl) {
          let fu = finalSrc;
          if (fu.indexOf("//") === 0) fu = "https:" + fu;
          if (fu.charAt(0) === "/") fu = BASE + fu;
          return await directOrEmbed(fu, pageUrl);
        }
      }
    }
    return await directOrEmbed(innerUrl, pageUrl);
  }

  const media = findMediaUrl(embedHtml);
  if (media) {
    return {
      url: media,
      quality: qualityFromHint(embedHtml) || (await detectQuality(media)) || "HD",
      headers: mediaHeaders(originOf(url) ? originOf(url) + "/" : pageUrl),
    };
  }
  return null;
}

/** Intenta el archivo directo; si no, entrega la URL del embed (como el Dart). */
async function directOrEmbed(url, pageUrl) {
  if (/\.(m3u8|mp4)([?#]|$)/i.test(url)) {
    return {
      url: url,
      quality: (await detectQuality(url)) || "HD",
      headers: mediaHeaders(originOf(url) ? originOf(url) + "/" : pageUrl),
    };
  }
  const html = await fetchText(url, null, EMBED_TIMEOUT);
  if (html) {
    const unpacked = unpackPacked(html);
    let media = findMediaUrl(unpacked || "");
    if (!media) media = findMediaUrl(html);
    if (media) {
      let q = qualityFromHint(unpacked || "") || qualityFromHint(html);
      if (!q) q = await detectQuality(media);
      return {
        url: media,
        quality: q || "HD",
        headers: mediaHeaders(originOf(url) ? originOf(url) + "/" : pageUrl),
      };
    }
  }
  return {
    url: url,
    quality: "HD",
    headers: mediaHeaders(pageUrl || BASE + "/"),
  };
}

// ─── Scrape de la página ────────────────────────────────────────────────────

async function scrapePage(html, pageUrl, isMovie) {
  const result = [];
  const seenUrls = {};
  const buttons = parseButtons(html);

  const blockRe =
    /<div[^>]*\bid=["'](options?-\d+|video-\d+|opt-\d+)["'][^>]*>([\s\S]*?)<\/div>/gi;
  const seenIds = {};
  let m;
  while ((m = blockRe.exec(html)) !== null) {
    const id = String(m[1] || "").trim();
    const block = m[2] || "";
    if (!id || seenIds[id]) continue;
    const isOptions = /^options?-/.test(id);
    const hasIframe = block.toLowerCase().indexOf("iframe") !== -1;
    if (!isOptions && !hasIframe) continue;
    seenIds[id] = true;

    const iframeSrc = extractIframeSrc(block);
    if (!iframeSrc) continue;

    const info = buttons[id];
    const language = info ? info.language : "Desconocido";
    const option = info && info.option != null ? info.option : optionFromId(id);

    const resolved = await resolveEmbed(iframeSrc, pageUrl);
    if (!resolved || !resolved.url) continue;
    if (seenUrls[resolved.url]) continue;
    seenUrls[resolved.url] = true;

    result.push({
      option: option,
      language: language,
      url: resolved.url,
      quality: resolved.quality || "HD",
      headers: resolved.headers || mediaHeaders(pageUrl),
    });
  }

  // Fallback: todos los iframes dentro de #aa-options
  if (!result.length) {
    const aaMatch = html.match(/id=["']aa-options["'][^>]*>([\s\S]*?)<\/aside>/i);
    const section = aaMatch ? aaMatch[1] : html;
    const iframeRe = /<iframe[^>]*(?:data-src|src)=["']([^"']+)["']/gi;
    let opt = 1;
    const seenSrc = {};
    while ((m = iframeRe.exec(section)) !== null) {
      const src = decodeEntities(m[1]).trim();
      if (!src || seenSrc[src]) continue;
      seenSrc[src] = true;

      const resolved = await resolveEmbed(src, pageUrl);
      if (!resolved || !resolved.url) continue;
      if (seenUrls[resolved.url]) continue;
      seenUrls[resolved.url] = true;

      const info = buttons["options-" + (opt - 1)] || buttons["option-" + opt];
      result.push({
        option: info && info.option != null ? info.option : opt,
        language: info ? info.language : "Desconocido",
        url: resolved.url,
        quality: resolved.quality || "HD",
        headers: resolved.headers || mediaHeaders(pageUrl),
      });
      opt++;
    }
  }

  return result;
}

// ─── Entrada ────────────────────────────────────────────────────────────────

async function extractStreams(tmdbId, mediaType, season, episode) {
  const id = parseInt(tmdbId, 10);
  if (!id || id <= 0) return [];
  const mt = String(mediaType || "").toLowerCase();
  const isMovie = !(mt === "tv" || mt === "series" || mt === "anime");
  const s = parseInt(season, 10) > 0 ? parseInt(season, 10) : 1;
  const e = parseInt(episode, 10) > 0 ? parseInt(episode, 10) : 1;

  const tmdb = await tmdbInfo(id, isMovie ? "movie" : "tv");
  if (!tmdb.titles.length) return [];

  const candidates = buildCandidates(tmdb.titles, tmdb.year, id, isMovie, s, e);
  if (!candidates.length) return [];

  let pageUrl = null;
  let html = null;
  for (var i = 0; i < candidates.length; i++) {
    const got = await fetchText(candidates[i], null, PAGE_TIMEOUT);
    if (got && got.indexOf("aa-options") !== -1) {
      pageUrl = candidates[i];
      html = got;
      break;
    }
  }
  if (!html) return [];

  const raw = await scrapePage(html, pageUrl, isMovie);
  if (!raw.length) return [];

  const streams = [];
  const seen = {};
  for (var j = 0; j < raw.length; j++) {
    const r = raw[j];
    const url = String(r.url || "").trim();
    if (!url || seen[url]) continue;
    seen[url] = true;
    const lang = normalizarIdioma(r.language);
    const name = r.option != null ? "Pelispedia · Opción " + r.option : "Pelispedia";
    streams.push({
      title: name + " · " + lang,
      quality: r.quality || "HD",
      language: lang,
      url: url,
      headers: r.headers || mediaHeaders(pageUrl + "/"),
    });
    if (typeof setTimeout !== "undefined") {
      await new Promise(function (res) { setTimeout(res, 30); });
    }
  }
  return streams;
}

function withTimeout(promise, ms) {
  if (typeof setTimeout === "undefined") return promise;
  return Promise.race([
    promise,
    new Promise(function (resolve) {
      setTimeout(function () { resolve([]); }, ms);
    }),
  ]);
}

async function getStreams(tmdbId, mediaType, season, episode) {
  try {
    return await withTimeout(
      extractStreams(tmdbId, mediaType, season, episode).catch(function () { return []; }),
      TOTAL_TIMEOUT
    );
  } catch (e) {
    return [];
  }
}

module.exports = { getStreams };
