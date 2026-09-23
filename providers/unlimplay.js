// Unlimplay — puerto a JS de lib/data/extractors/providers/unlimplay_extractor.dart
// (el codigo Dart del repo del proyecto) al formato que ejecuta el motor de
// MasterScrap: CommonJS `module.exports = { getStreams }`, solo fetch + RegExp.
//
// El embed publica los servidores en dos bloques JSON del HTML:
//   const EMBEDS = {...};              y   finalizePlayer({...});
// Se fusionan ambos, se agrupan por idioma y se dejan los hosts reproducibles
// (streamwish / vidhide / filelions), reescribiendo los dominios que ya rotaron.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Igual que _allowed en el Dart: el resto son hosts muertos o sin player util.
const PERMITIDOS = ["streamwish", "vidhide", "filelions"];

/** hglink.to y streamwish.to → vibuxer.com; filelions.to y minochinos.com → callistanise.com. */
function rewriteHost(url) {
  return String(url || "")
    .replace(/^(https?:\/\/)(hglink\.to|streamwish\.to)(\/|$)/i, "$1vibuxer.com$3")
    .replace(/^(https?:\/\/)(filelions\.to|minochinos\.com)(\/|$)/i, "$1callistanise.com$3");
}

function tryJson(raw) {
  try {
    const d = JSON.parse(raw);
    return d && typeof d === "object" ? d : null;
  } catch (e) {
    return null;
  }
}

/** es_MX | es_ES | en_US, como _langToCode. */
function langToCode(lang) {
  const l = String(lang || "").toLowerCase().trim();
  if (l === "latino" || l === "lat" || l === "mx") return "es_MX";
  if (l === "español" || l === "espanol" || l === "castellano" || l === "es") return "es_ES";
  if (l.indexOf("sub") >= 0 || l === "english" || l === "en") return "en_US";
  return "es_MX";
}

function idiomaDe(lang) {
  const c = langToCode(lang);
  if (c === "es_ES") return "Español";
  if (c === "en_US") return "Subtitulado";
  return "Latino";
}

/** Titulo del embed ("streamwish hd 2" → "Streamwish Hd 2"), como toModalMap. */
function bonito(name) {
  return String(name || "")
    .split(" ")
    .map(function (w) {
      return w ? w.charAt(0).toUpperCase() + w.slice(1) : w;
    })
    .join(" ");
}

async function getStreams(tmdbId, mediaType, season, episode) {
  const esPelicula = mediaType === "movie";
  const embedUrl = esPelicula
    ? "https://unlimplay.com/f/embed/movie/" + tmdbId
    : "https://unlimplay.com/f/embed/tv/" + tmdbId + "/" + (season || 1) + "/" + (episode || 1);

  const res = await fetch(embedUrl, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "es-ES,es;q=0.9",
    },
  });
  if (!res.ok) return [];
  const html = await res.text();
  if (!html) return [];

  const bloques = [];
  const mEmbeds = html.match(/const\s+EMBEDS\s*=\s*(\{[\s\S]*?\});/);
  if (mEmbeds) {
    const d = tryJson(mEmbeds[1]);
    if (d) bloques.push(d);
  }
  const mFinal = html.match(/finalizePlayer\s*\(\s*(\{[\s\S]*?\})\s*\)\s*;/);
  if (mFinal) {
    const d = tryJson(mFinal[1]);
    if (d) bloques.push(d);
  }
  if (!bloques.length) return [];

  // Fusion: idioma → { nombre: url }, sin repetir la misma url dos veces.
  const merge = {};
  for (let i = 0; i < bloques.length; i++) {
    const bloque = bloques[i];
    for (const lang of Object.keys(bloque || {})) {
      const servers = bloque[lang];
      if (!servers || typeof servers !== "object") continue;
      if (!merge[lang]) merge[lang] = {};
      const bucket = merge[lang];
      for (const name of Object.keys(servers)) {
        const u = String(servers[name] == null ? "" : servers[name]).trim();
        if (!u) continue;
        if (bucket[name] === u) continue;
        if (Object.keys(bucket).some(function (k) { return bucket[k] === u; })) continue;
        if (!(name in bucket)) {
          bucket[name] = u;
          continue;
        }
        let n = 2;
        while (name + " " + n in bucket) n++;
        bucket[name + " " + n] = u;
      }
    }
  }

  const orden = ["latino", "español", "espanol", "subtitulado"];
  const idiomas = orden
    .filter(function (k) { return k in merge; })
    .concat(Object.keys(merge).filter(function (k) { return orden.indexOf(k.toLowerCase()) < 0; }));

  const streams = [];
  for (const lang of idiomas) {
    const idioma = idiomaDe(lang);
    const servidores = merge[lang] || {};
    for (const name of Object.keys(servidores)) {
      const base = name.toLowerCase().trim();
      if (!PERMITIDOS.some(function (p) { return base.indexOf(p) === 0; })) continue;
      streams.push({
        title: bonito(name),
        quality: "HD",
        language: idioma,
        url: rewriteHost(servidores[name]),
        headers: { Referer: embedUrl + "/", "User-Agent": UA },
      });
    }
  }
  return streams;
}

module.exports = { getStreams };
