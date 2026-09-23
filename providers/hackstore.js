// HackStore — puerto a JS de lib/data/extractors/providers/hackstore_extractor.dart
// (el codigo Dart del proyecto Flutter original) al formato que ejecuta el motor
// de MasterScrap: CommonJS `module.exports = { getStreams }`, solo fetch + RegExp.
//
// Cadena del sitio (toda estatica, sin JS ni PoW):
//   TMDB id → titulos + año → slugs (`titulo-año`, `titulo`)
//     → /wp-api/v1/single/<movies|tvshows>?slug=...&postType=...  → _id
//     → si es serie: /wp-api/v1/single/episodes/list?_id=...&season=N → _id del episodio
//     → /wp-api/v1/player?postId=<_id>  → data.embeds[] = URLs de embed
//
// Nota: los embeds se devuelven tal cual (el motor los resuelve con sus propios
// resolvers). Igual que en el Dart, voe.sx se reescribe a su espejo vivo.
const BASE_URL = "https://hackstore.mx";
const TMDB_KEY = "439c478a771f35c05022f9feabcca01c";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// El motor corta los scrapers a ~60s: deadline propia mas agresiva para que un
// sitio lento devuelva [] en vez de comerse el presupuesto de fuentes.
const DEADLINE_MS = 35000;
const FETCH_TIMEOUT_MS = 12000;
const MAX_SLUGS = 12; // el Dart usa 15; con deadline propio conviene acotar

// Sin String.normalize (QuickJS no trae ICU): tabla explicita, igual que el Dart.
const ACCENT_FROM = "áàäâéèëêíìïîóòöôúùüûñ";
const ACCENT_TO = "aaaaeeeeiiiioooouuuun";

/** Reloj defensivo: si el runtime no trae Date, 0 desactiva el deadline. */
function now() {
  try {
    return Date.now();
  } catch (e) {
    return 0;
  }
}

/** fetch con UA de navegador, timeout propio y que NUNCA lanza. */
async function fetchText(url, accept) {
  let controller = null;
  let timer = null;
  try {
    const opts = {
      headers: {
        "User-Agent": UA,
        Accept: accept || "application/json, text/plain, */*",
        "Accept-Language": "es-ES,es;q=0.9",
        "Cache-Control": "no-cache",
      },
    };
    if (typeof AbortController !== "undefined") {
      controller = new AbortController();
      opts.signal = controller.signal;
      if (typeof setTimeout !== "undefined") {
        timer = setTimeout(function () {
          try {
            controller.abort();
          } catch (e) {}
        }, FETCH_TIMEOUT_MS);
      }
    }
    const res = await fetch(url, opts);
    if (!res || !res.ok) return "";
    return await res.text();
  } catch (e) {
    return "";
  } finally {
    if (timer && typeof clearTimeout !== "undefined") clearTimeout(timer);
  }
}

async function fetchJson(url) {
  const raw = await fetchText(url);
  if (!raw) return null;
  try {
    const d = JSON.parse(raw);
    return d && typeof d === "object" ? d : null;
  } catch (e) {
    return null;
  }
}

// ── TMDB ──────────────────────────────────────────────────

function tmdbTitle(data) {
  if (!data || typeof data !== "object") return "";
  const t = data.title != null ? data.title : data.name;
  return t == null ? "" : String(t).trim();
}

function tmdbYear(data) {
  if (!data || typeof data !== "object") return "";
  const d = data.release_date != null ? data.release_date : data.first_air_date;
  const s = d == null ? "" : String(d);
  return s.length >= 4 ? s.substring(0, 4) : "";
}

/** Titulos en es-MX / es-ES / en-US + fallback sin idioma (como _getTmdbTitles). */
async function getTmdbTitles(tmdbId, type) {
  const langs = ["es-MX", "es-ES", "en-US"];
  const titles = [];
  let year = "";

  for (let i = 0; i < langs.length; i++) {
    const data = await fetchJson(
      "https://api.themoviedb.org/3/" + type + "/" + tmdbId + "?api_key=" + TMDB_KEY + "&language=" + langs[i]
    );
    if (!data) continue;
    const t = tmdbTitle(data);
    if (t && titles.indexOf(t) < 0) titles.push(t);
    if (!year) year = tmdbYear(data);
  }

  if (!titles.length) {
    const data = await fetchJson(
      "https://api.themoviedb.org/3/" + type + "/" + tmdbId + "?api_key=" + TMDB_KEY
    );
    if (data) {
      const t = tmdbTitle(data);
      if (t && titles.indexOf(t) < 0) titles.push(t);
      if (!year) year = tmdbYear(data);
    }
  }

  // Titulos alternativos + traducciones (fuente de los titulos en español de MX).
  const alt = await getAlternativeTitles(tmdbId, type);
  for (let i = 0; i < alt.length; i++) {
    if (titles.indexOf(alt[i]) < 0) titles.push(alt[i]);
  }

  return { titles: titles, year: year };
}

async function getAlternativeTitles(tmdbId, type) {
  const out = [];

  const altData = await fetchJson(
    "https://api.themoviedb.org/3/" + type + "/" + tmdbId + "/alternative_titles?api_key=" + TMDB_KEY
  );
  if (altData && altData.titles && altData.titles.length) {
    for (let i = 0; i < altData.titles.length; i++) {
      const item = altData.titles[i];
      if (!item) continue;
      const t = item.title == null ? "" : String(item.title).trim();
      if (t && out.indexOf(t) < 0) out.push(t);
    }
  }

  const trData = await fetchJson(
    "https://api.themoviedb.org/3/" + type + "/" + tmdbId + "/translations?api_key=" + TMDB_KEY
  );
  if (trData && trData.translations && trData.translations.length) {
    for (let i = 0; i < trData.translations.length; i++) {
      const item = trData.translations[i];
      if (!item || !item.data) continue;
      const d = item.data;
      const raw = d.title != null ? d.title : d.name;
      const t = raw == null ? "" : String(raw).trim();
      if (t && out.indexOf(t) < 0) out.push(t);
    }
  }

  return out;
}

// ── Slugs ─────────────────────────────────────────────────

function normalizeSlug(title) {
  let s = String(title || "").toLowerCase();
  if (!s) return "";

  for (let i = 0; i < ACCENT_FROM.length; i++) {
    s = s.split(ACCENT_FROM.charAt(i)).join(ACCENT_TO.charAt(i));
  }

  s = s.replace(/[^a-z0-9\s]/g, " ");
  s = s.replace(/\s+/g, " ").replace(/^ +| +$/g, "");
  s = s.split(" ").join("-");
  s = s.replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  return s;
}

/** `slug-año` primero, luego `slug` (igual que _generateSlugs). */
function generateSlugs(titles, year) {
  const slugs = [];
  for (let i = 0; i < titles.length; i++) {
    const slug = normalizeSlug(titles[i]);
    if (!slug) continue;
    if (year) {
      const withYear = slug + "-" + year;
      if (slugs.indexOf(withYear) < 0) slugs.push(withYear);
    }
    if (slugs.indexOf(slug) < 0) slugs.push(slug);
  }
  return slugs.slice(0, MAX_SLUGS);
}

// ── API HackStore ─────────────────────────────────────────

async function findContentId(slugs, postType) {
  for (let i = 0; i < slugs.length; i++) {
    const data = await fetchJson(
      BASE_URL +
      "/wp-api/v1/single/" +
      postType +
      "?slug=" +
      // sin encodeURIComponent (no garantizado en QuickJS): el slug solo lleva [a-z0-9-]
      String(slugs[i]).replace(/[^a-z0-9\-]/g, "") +
      "&postType=" +
      postType
    );
    if (data && data.data && data.data._id != null) return String(data.data._id);
  }
  return "";
}

/** season_number/episode_number; si faltan, se leen del slug del episodio. */
async function findEpisodeId(seriesId, season, episode) {
  const data = await fetchJson(
    BASE_URL +
      "/wp-api/v1/single/episodes/list?_id=" +
      seriesId +
      "&season=" +
      season +
      "&page=1&postsPerPage=200"
  );
  if (!data || !data.data || !data.data.posts || !data.data.posts.length) return "";

  const posts = data.data.posts;
  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    if (!post || post._id == null) continue;

    let sn = post.season_number;
    let en = post.episode_number;
    if (sn == null || en == null) {
      const m = String(post.slug || "").match(/temporada-(\d+)-episodio-(\d+)/i);
      if (m) {
        sn = m[1];
        en = m[2];
      }
    }
    const snNum = parseInt(String(sn == null ? "" : sn), 10);
    const enNum = parseInt(String(en == null ? "" : en), 10);
    if (snNum === season && enNum === episode) return String(post._id);
  }
  return "";
}

async function getPlayers(postId) {
  const data = await fetchJson(BASE_URL + "/wp-api/v1/player?postId=" + postId);
  if (!data || !data.data || !data.data.embeds || !data.data.embeds.length) return [];
  return data.data.embeds.slice(0, 15);
}

// ── Formato ───────────────────────────────────────────────

/** es_MX → Latino, es_ES → Español, en_US → Subtitulado (igual que el modal). */
function idiomaDe(lang) {
  const l = String(lang || "").toLowerCase();
  if (l.indexOf("castellano") >= 0 || l.indexOf("es_es") >= 0 || l.indexOf("espana") >= 0) return "Español";
  if (l.indexOf("en_us") >= 0 || l.indexOf("english") >= 0 || l.indexOf("eng") >= 0) return "Subtitulado";
  return "Latino";
}

/** Etiqueta de host, alineada con getServerLabel del motor (masters.js). */
function serverLabel(url) {
  const u = String(url || "").toLowerCase();
  if (u.indexOf("voe.sx") >= 0 || u.indexOf("tubeless") >= 0 || u.indexOf("cloudwindow") >= 0) return "VOE";
  if (u.indexOf("filemoon") >= 0 || u.indexOf("bysedi") >= 0) return "FileMoon";
  if (u.indexOf("streamwish") >= 0 || u.indexOf("hlswish") >= 0 || u.indexOf("vibuxer") >= 0 || u.indexOf("strwish") >= 0)
    return "StreamWish";
  if (u.indexOf("vidhide") >= 0 || u.indexOf("filelions") >= 0 || u.indexOf("dintezuvio") >= 0) return "VidHide";
  if (u.indexOf("uqload") >= 0) return "Uqload";
  if (u.indexOf("luluvid") >= 0 || u.indexOf("lulus") >= 0) return "Lulu";
  if (u.indexOf("ok.ru") >= 0) return "OK";
  return "";
}

function hostDe(url) {
  const m = String(url || "").match(/^https?:\/\/([^/?#]+)/i);
  return m ? m[1] : "Online";
}

/** Filtro del Dart adaptado al contrato del motor. */
function formatServers(players) {
  const out = [];

  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    if (!player || typeof player !== "object") continue;

    const lang = String(player.lang == null ? "latino" : player.lang).toLowerCase();
    // Mismo filtro que el Dart/PHP: fuera subtitulados, VOSE, ingles y "espana".
    if (
      lang.indexOf("sub") >= 0 ||
      lang.indexOf("vose") >= 0 ||
      lang.indexOf("eng") >= 0 ||
      lang.indexOf("espana") >= 0
    ) {
      continue;
    }

    // OJO: NO se aplica aqui el rewrite voe.sx → eugenemakedraw.com del Dart.
    // En este motor los resolvers matchean por "voe.sx" y son ellos los que
    // mapean el dominio (poseidon.js), asi que reescribir dejaria la URL sin resolver.
    const rawUrl = player.url == null ? "" : String(player.url).trim();
    if (!rawUrl || rawUrl.indexOf("la.movie") >= 0) continue;
    if (out.some(function (s) { return s.url === rawUrl; })) continue;

    const serverName = player.server == null ? "" : String(player.server).trim();
    const quality = player.quality == null ? "HD" : String(player.quality);
    const label =
      serverLabel(rawUrl) ||
      (serverName && serverName.toLowerCase() !== "online" ? serverName : hostDe(rawUrl));

    out.push({
      title: label + " · " + quality,
      quality: quality,
      language: idiomaDe(lang),
      url: rawUrl,
      headers: { Referer: BASE_URL + "/", "User-Agent": UA },
    });
  }

  return out;
}

// ── Entry point ───────────────────────────────────────────

async function extractStreams(tmdbId, mediaType, season, episode) {
  const id = parseInt(String(tmdbId), 10);
  if (!id || id <= 0) return [];

  const esPelicula = mediaType === "movie";
  const type = esPelicula ? "movie" : "tv";
  const postType = esPelicula ? "movies" : "tvshows";
  const deadline = now() + DEADLINE_MS;

  const info = await getTmdbTitles(id, type);
  if (!info.titles.length || now() > deadline) return [];

  const slugs = generateSlugs(info.titles, info.year);
  if (!slugs.length) return [];

  const contentId = await findContentId(slugs, postType);
  if (!contentId || now() > deadline) return [];

  let targetId = contentId;
  if (!esPelicula) {
    const epId = await findEpisodeId(contentId, season || 1, episode || 1);
    if (!epId) return [];
    targetId = epId;
  }

  const players = await getPlayers(targetId);
  if (!players.length) return [];

  return formatServers(players);
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
    DEADLINE_MS + 5000
  ).catch(function () {
    return [];
  });
}

module.exports = { getStreams };
