// Poseidon — puerto a JS de lib/data/extractors/providers/poseidon_extractor.dart
// (PoseidonService) al formato que ejecuta el motor de MasterScrap:
// CommonJS `module.exports = { getStreams }`, solo fetch + RegExp.
//
// Flujo (identico al Dart): TMDB (3 idiomas) -> slug -> pagina /pelicula/ o
// /serie/ -> __NEXT_DATA__.props.pageProps -> videos -> player.php -> URL real
// del cyberlocker -> reescritura de dominios que ya rotaron -> dedupe.
//
// Nota: en la pagina de serie la clave de pageProps es "episode"; en pelicula
// es "thisMovie". El JSON de videos tiene la forma { latino: [...], spanish:
// [...], english: [...] } con { cyberlocker, result, quality } en cada item.
const TMDB_KEY = "a2d9bbed370d9f678e34006f8750a5a5";
const TMDB_BASE = "https://api.themoviedb.org/3";
const BASE = "https://www.poseidonhd2.co";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Igual que _kDomainMap: los hosts originales ya no resuelven y hay que
// apuntar a los espejos vivos del mismo servicio.
const DOMAIN_MAP = [
  ["streamwish.to", "hgplaycdn.com"],
  ["vidhidepro.com", "callistanise.com"],
  ["filelions.to", "callistanise.com"],
  ["voe.sx", "eugenemakedraw.com"],
  ["doodstream.com", "playmogo.com"],
];

// Claves de idioma del JSON -> etiqueta del contrato JS.
const LANG_MAP = [
  ["latino", "Latino"],
  ["spanish", "Espanol"],
  ["english", "Subtitulado"],
  ["japanese", "Subtitulado"],
];

// ─── utilidades ───────────────────────────────────────────────────────────

/** fetch con AbortController; devuelve el texto o null. Nunca lanza. */
function fetchText(url, extraHeaders, ms) {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  let timer = null;
  if (ctrl && typeof setTimeout !== "undefined") {
    timer = setTimeout(function () {
      try { ctrl.abort(); } catch (e) {}
    }, ms || 15000);
  }
  const headers = {
    "User-Agent": UA,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
  };
  if (extraHeaders) {
    for (const k of Object.keys(extraHeaders)) headers[k] = extraHeaders[k];
  }
  const opts = { headers: headers, redirect: "follow" };
  if (ctrl) opts.signal = ctrl.signal;
  return fetch(url, opts)
    .then(function (r) {
      return r && r.ok ? r.text() : null;
    })
    .then(function (t) {
      if (timer && typeof clearTimeout !== "undefined") clearTimeout(timer);
      return t && t.length ? t : null;
    })
    .catch(function () {
      if (timer && typeof clearTimeout !== "undefined") clearTimeout(timer);
      return null;
    });
}

/** _slugify: minusculas, sin acentos, todo lo que no sea a-z0-9 a guiones. */
function slugify(title) {
  let s = String(title == null ? "" : title).trim().toLowerCase();
  const acc = {
    "\u00e1": "a", "\u00e0": "a", "\u00e4": "a", "\u00e2": "a", "\u00e3": "a",
    "\u00e9": "e", "\u00e8": "e", "\u00eb": "e", "\u00ea": "e",
    "\u00ed": "i", "\u00ec": "i", "\u00ef": "i", "\u00ee": "i",
    "\u00f3": "o", "\u00f2": "o", "\u00f6": "o", "\u00f4": "o", "\u00f5": "o",
    "\u00fa": "u", "\u00f9": "u", "\u00fc": "u", "\u00fb": "u",
    "\u00f1": "n", "\u00e7": "c",
  };
  for (const k of Object.keys(acc)) {
    s = s.split(k).join(acc[k]);
  }
  s = s.replace(/[^a-z0-9\s-]/g, "");
  s = s.replace(/[\s-]+/g, "-");
  s = s.replace(/^-+|-+$/g, "");
  return s;
}

/** _replaceDomain: reescritura de host sobre la URL ya resuelta, con RegExp.
 *  Cambia solo el host y conserva el esquema (equivalente al replaceAll del
 *  Dart, que sustituye la subcadena del dominio). */
function replaceDomain(url) {
  let out = String(url == null ? "" : url);
  for (let i = 0; i < DOMAIN_MAP.length; i++) {
    const from = DOMAIN_MAP[i][0].replace(/\./g, "\\.");
    const to = DOMAIN_MAP[i][1];
    out = out.replace(
      new RegExp("(https?:\\/\\/)((?:[^\\/]+\\.)?" + from + ")(?=[/:]|$)", "gi"),
      function (m, esquema) {
        return esquema + to;
      }
    );
  }
  return out;
}

/** Titulo de la lista ("streamwish" -> "Streamwish"), como toModalMap. */
function bonito(name) {
  const s = String(name == null ? "" : name).trim();
  if (!s) return "Servidor";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── TMDB (para los slugs candidatos) ─────────────────────────────────────

function tmdbLang(tmdbId, mediaType, lang) {
  const endpoint = mediaType === "movie" ? "movie" : "tv";
  const url = TMDB_BASE + "/" + endpoint + "/" + tmdbId + "?api_key=" + TMDB_KEY + "&language=" + lang;
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  let timer = null;
  if (ctrl && typeof setTimeout !== "undefined") {
    timer = setTimeout(function () {
      try { ctrl.abort(); } catch (e) {}
    }, 12000);
  }
  const opts = {
    headers: { Accept: "application/json", "User-Agent": UA },
  };
  if (ctrl) opts.signal = ctrl.signal;
  return fetch(url, opts)
    .then(function (r) {
      return r && r.ok ? r.json() : null;
    })
    .then(function (d) {
      if (timer && typeof clearTimeout !== "undefined") clearTimeout(timer);
      if (!d || typeof d !== "object" || d.success === false) return null;
      return d;
    })
    .catch(function () {
      if (timer && typeof clearTimeout !== "undefined") clearTimeout(timer);
      return null;
    });
}

function getTmdbInfo(tmdbId, mediaType) {
  return Promise.all([
    tmdbLang(tmdbId, mediaType, "es-MX"),
    tmdbLang(tmdbId, mediaType, "es-ES"),
    tmdbLang(tmdbId, mediaType, "en-US"),
  ]).then(function (arr) {
    const es = arr[0], eses = arr[1], en = arr[2];
    const esMovie = mediaType === "movie";
    const pick = function (d, k) {
      if (!d) return null;
      const a = esMovie ? d.title : d.name;
      return a == null ? null : String(a);
    };
    const dateEs = es ? (esMovie ? es.release_date : es.first_air_date) : null;
    const dateEn = en ? (esMovie ? en.release_date : en.first_air_date) : null;
    const dateStr = dateEs != null ? String(dateEs) : dateEn != null ? String(dateEn) : null;
    let year = null;
    if (dateStr && dateStr.length >= 4) {
      const y = parseInt(dateStr.slice(0, 4), 10);
      if (!isNaN(y)) year = y;
    }
    return {
      id: tmdbId,
      latino: pick(es, "title") || "",
      castellano: pick(eses, "title") || "",
      ingles: pick(en, "title") || "",
      year: year,
    };
  });
}

// ─── candidatos de URL ────────────────────────────────────────────────────

/** Pelicula: /pelicula/{tmdbId}/{slug} (+ variante con el anio). */
function buildMovieCandidates(t) {
  const titles = [t.latino, t.castellano, t.ingles];
  const out = [];
  const seen = {};
  for (let i = 0; i < titles.length; i++) {
    if (!titles[i] || !String(titles[i]).trim()) continue;
    const slug = slugify(titles[i]);
    if (!slug) continue;
    const urls = [BASE + "/pelicula/" + t.id + "/" + slug];
    if (t.year != null) urls.push(BASE + "/pelicula/" + t.id + "/" + slug + "-" + t.year);
    for (let j = 0; j < urls.length; j++) {
      if (!seen[urls[j]]) {
        seen[urls[j]] = 1;
        out.push(urls[j]);
      }
    }
  }
  return out;
}

/** Serie: /serie/{tmdbId}/{slug}/temporada/{s}/episodio/{e}. */
function buildEpisodeCandidates(t, season, episode) {
  const titles = [t.latino, t.castellano, t.ingles];
  const out = [];
  const seen = {};
  for (let i = 0; i < titles.length; i++) {
    if (!titles[i] || !String(titles[i]).trim()) continue;
    const slug = slugify(titles[i]);
    if (!slug) continue;
    const u =
      BASE + "/serie/" + t.id + "/" + slug + "/temporada/" + season + "/episodio/" + episode;
    if (!seen[u]) {
      seen[u] = 1;
      out.push(u);
    }
  }
  return out;
}

/** _findWorkingUrl: primer candidato que sirve __NEXT_DATA__ con la clave util. */
function findWorkingUrl(candidates, isMovie) {
  const needle = isMovie ? '"thisMovie"' : '"episode"';
  const headers = { Referer: BASE + "/" };
  let i = 0;
  function next() {
    if (i >= candidates.length) return Promise.resolve(null);
    const url = candidates[i++];
    return fetchText(url, headers, 18000).then(function (html) {
      if (html && html.indexOf("__NEXT_DATA__") >= 0 && html.indexOf(needle) >= 0) {
        return { url: url, html: html };
      }
      return next();
    });
  }
  return next();
}

// ─── parseo de __NEXT_DATA__ ──────────────────────────────────────────────

function extractNextData(html) {
  const re = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i;
  const m = html.match(re);
  if (!m) return null;
  try {
    const data = JSON.parse(m[1]);
    if (!data || typeof data !== "object") return null;
    const props = data.props;
    if (!props || typeof props !== "object") return null;
    const pageProps = props.pageProps;
    if (!pageProps || typeof pageProps !== "object") return null;
    return pageProps;
  } catch (e) {
    return null;
  }
}

/** Genera [{language, videos:[{cyberlocker,url,quality}]}] como _getVideoGroupsFromData. */
function videoGroupsFromData(videos) {
  const groups = [];
  for (let i = 0; i < LANG_MAP.length; i++) {
    const key = LANG_MAP[i][0];
    const label = LANG_MAP[i][1];
    const listRaw = videos[key];
    if (!Array.isArray(listRaw) || !listRaw.length) continue;
    const videosList = [];
    for (let j = 0; j < listRaw.length; j++) {
      const v = listRaw[j];
      if (!v || typeof v !== "object") continue;
      const url = v.result == null ? "" : String(v.result);
      if (!url) continue;
      videosList.push({
        cyberlocker: v.cyberlocker == null ? "" : String(v.cyberlocker),
        url: url,
        quality: v.quality == null ? "HD" : String(v.quality),
      });
    }
    if (videosList.length) groups.push({ language: label, videos: videosList });
  }
  return groups;
}

// ─── resolver player.php ──────────────────────────────────────────────────

/** _resolvePlayer: saca la URL real del cyberlocker desde el HTML del player. */
function resolvePlayer(sourceUrl) {
  if (!sourceUrl) return Promise.resolve(null);
  return fetchText(sourceUrl, { Referer: BASE + "/" }, 18000).then(function (html) {
    if (!html) return null;
    let videoUrl = null;

    let m = html.match(/var\s+url\s*=\s*'([^']+)'/);
    if (m) videoUrl = m[1];

    if (!videoUrl) {
      m = html.match(/var\s+url\s*=\s*"([^"]+)"/);
      if (m) videoUrl = m[1];
    }

    if (!videoUrl) {
      m = html.match(/window\.location\.href\s*=\s*'([^']+)'/);
      if (m) videoUrl = m[1];
    }

    if (!videoUrl) {
      m = html.match(/(?:file|src|source)\s*[:=]\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i);
      if (m) videoUrl = m[1];
    }

    if (!videoUrl) return null;
    return videoUrl;
  });
}

/** Resuelve en paralelo con un tope de concurrencia para no saturar el host. */
function resolveAll(urls, limit) {
  const out = [];
  let idx = 0;
  let activos = 0;
  return new Promise(function (resolve) {
    function pump() {
      if (idx >= urls.length && activos === 0) return resolve(out);
      while (activos < limit && idx < urls.length) {
        const pos = idx++;
        activos++;
        resolvePlayer(urls[pos]).then(function (r) {
          out[pos] = r;
          activos--;
          pump();
        });
      }
    }
    if (!urls.length) return resolve(out);
    pump();
  });
}

// ─── flujo principal ──────────────────────────────────────────────────────

function extractStreams(tmdbId, mediaType, season, episode) {
  const id = parseInt(tmdbId, 10);
  if (!id || id <= 0) return Promise.resolve([]);
  const _mt = (mediaType === "series" || mediaType === "anime") ? "tv" : mediaType;
  const esPelicula = _mt !== "tv";
  const s = parseInt(season, 10) || 1;
  const e = parseInt(episode, 10) || 1;

  return getTmdbInfo(id, esPelicula ? "movie" : "tv").then(function (tmdb) {
    if (!tmdb || (!tmdb.latino && !tmdb.castellano && !tmdb.ingles)) return [];

    const candidatos = esPelicula
      ? buildMovieCandidates(tmdb)
      : buildEpisodeCandidates(tmdb, s, e);
    if (!candidatos.length) return [];

    return findWorkingUrl(candidatos, esPelicula).then(function (found) {
      if (!found) return [];

      const pageProps = extractNextData(found.html);
      if (!pageProps) return [];

      const ep = pageProps[esPelicula ? "thisMovie" : "episode"] || pageProps.thisEpisode;
      if (!ep || typeof ep !== "object") return [];

      const videosData = ep.videos;
      if (!videosData || typeof videosData !== "object") return [];

      const groups = videoGroupsFromData(videosData);
      if (!groups.length) return [];

      // Lista plana conservando el idioma de cada grupo.
      const pendientes = [];
      for (let i = 0; i < groups.length; i++) {
        const g = groups[i];
        for (let j = 0; j < g.videos.length; j++) {
          pendientes.push({
            language: g.language,
            cyberlocker: g.videos[j].cyberlocker,
            quality: g.videos[j].quality,
            url: g.videos[j].url,
          });
        }
      }

      const urls = pendientes.map(function (p) {
        return p.url;
      });

      return resolveAll(urls, 6).then(function (resueltas) {
        const streams = [];
        const seen = {};
        for (let i = 0; i < pendientes.length; i++) {
          const raw = resueltas[i];
          if (!raw) continue;
          const finalUrl = replaceDomain(raw);
          if (!finalUrl || seen[finalUrl]) continue;
          seen[finalUrl] = 1;
          const p = pendientes[i];
          streams.push({
            title: "Poseidon \u00b7 " + bonito(p.cyberlocker),
            quality: p.quality || "HD",
            language: p.language,
            url: finalUrl,
            headers: { Referer: BASE + "/", "User-Agent": UA },
          });
        }
        return streams;
      });
    });
  });
}

// src/poseidon/index.js
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
    45000
  );
}

module.exports = { getStreams };
