// embed69 — puerto a JS de lib/data/extractors/providers/embed69_extractor.dart
// (repo josueluz89/scraperstv-providers) al formato que ejecuta el motor de
// MasterScrap: CommonJS `module.exports = { getStreams }`, solo fetch + JSON +
// RegExp + String/Array/Promise/setTimeout/AbortController. Sin npm, sin cheerio,
// sin crypto, sin Buffer, sin DOMParser, sin URL.
//
// Que hace el extractor original (y este puerto):
//   1. tmdb_id -> imdb_id (TMDB external_ids, detalle, y fallback a OMDB por
//      titulo+anio, porque TMDB no siempre tiene el imdb mapeado en series).
//   2. Con el imdb arma variantes de id para series (tt123-1x01, tt123-1x1,
//      tt123-01x01, tt123-1-01, tt123-1-1) y pide la pagina del embed
//      (serieskao.top/vidurl/<id>/ y embed69.org/f/<id>/, que hoy sirven el
//      mismo motor Embed69; xupalace.org/video/<id>/ redirige al segundo).
//   3. Esa pagina trae `dataLink` (JSON con los embeds CIFRADOS) y un
//      proof-of-work: hay que encontrar el nonce tal que
//      sha256(POW_CHALLENGE + nonce) empiece con N ceros, y la clave AES-256
//      es sha256(POW_CHALLENGE + nonce + POW_SALT) (32 bytes crudos, igual que
//      el PHP/hash(...,true) del sitio original).
//   4. Cada `link` viene en base64: IV = primeros 16 bytes, ciphertext = resto,
//      AES-256-CBC con padding PKCS7. Al descifrar sale la URL del servidor.
//   5. Se descartan voe/rapidvideo (igual que el Dart: servidoresFiltrados) y
//      se reescriben los dominios que rotaron (hglink.to -> vibuxer.com,
//      filelions.to -> callistanise.com).
//   6. Se resuelve el embed a un .m3u8 reproducible.
//
// PECULIARIDAD DE ESTE PUERTO: el contrato no permite crypto ni Buffer, asi que
// SHA-256 y AES-256-CBC estan implementados a mano en JS puro (solo numeros y
// operadores de 32 bits). Estan verificados contra `node:crypto` (ver notas al
// final del archivo).

var UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

var TMDB_KEY = "a2d9bbed370d9f678e34006f8750a5a5";
var TMDB_BASE = "https://api.themoviedb.org/3";
var OMDB_KEY = "5b0e8a3e";
var OMDB_BASE = "http://www.omdbapi.com/";

// Fuentes de la pagina del embed (Dart: _kBaseUrlSeriesKao / _kBaseUrlXupalace).
// xupalace hoy responde 301 hacia embed69.org, por eso se agrega embed69 como
// tercer intento directo.
var SOURCES = [
  { url: "https://serieskao.top/vidurl/", ref: "https://serieskao.top/", org: "https://serieskao.top" },
  { url: "https://xupalace.org/video/", ref: "https://xupalace.org/", org: "https://xupalace.org" },
  { url: "https://embed69.org/f/", ref: "https://embed69.org/", org: "https://embed69.org" },
];

// ---------------------------------------------------------------------------
// utilidades de bajo nivel (sin Buffer / sin TextEncoder / sin URL)
// ---------------------------------------------------------------------------

function utf8Encode(str) {
  var out = [];
  var s = String(str);
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c < 0x80) {
      out.push(c);
    } else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      var nx = s.charCodeAt(i + 1);
      if (nx >= 0xdc00 && nx <= 0xdfff) {
        var cp = 0x10000 + ((c - 0xd800) << 10) + (nx - 0xdc00);
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
        i++;
      } else {
        out.push(0xef, 0xbf, 0xbd);
      }
    } else if (c >= 0xd800 && c <= 0xdfff) {
      out.push(0xef, 0xbf, 0xbd);
    } else {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
  }
  return out;
}

function utf8DecodeBytes(bytes) {
  var out = "";
  var i = 0;
  while (i < bytes.length) {
    var c = bytes[i++];
    if (c < 128) {
      out += String.fromCharCode(c);
      continue;
    }
    if ((c & 224) === 192 && i < bytes.length) {
      out += String.fromCharCode(((c & 31) << 6) | (bytes[i++] & 63));
      continue;
    }
    if ((c & 240) === 224 && i + 1 < bytes.length) {
      var c2 = bytes[i++];
      var c3 = bytes[i++];
      out += String.fromCharCode(((c & 15) << 12) | ((c2 & 63) << 6) | (c3 & 63));
      continue;
    }
    if ((c & 248) === 240 && i + 2 < bytes.length) {
      var b2 = bytes[i++];
      var b3 = bytes[i++];
      var b4 = bytes[i++];
      var cp = ((c & 7) << 18) | ((b2 & 63) << 12) | ((b3 & 63) << 6) | (b4 & 63);
      cp -= 65536;
      out += String.fromCharCode(55296 + (cp >> 10), 56320 + (cp & 1023));
      continue;
    }
    out += "\uFFFD";
  }
  return out;
}

var B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";

function base64ToBytes(input) {
  var str = String(input || "").replace(/=+$/, "");
  var out = [];
  var bs = 0, bc = 0;
  for (var i = 0; i < str.length; i++) {
    var idx = B64_CHARS.indexOf(str.charAt(i));
    if (idx === -1) continue;
    bs = bc % 4 ? bs * 64 + idx : idx;
    if (bc++ % 4) out.push(255 & (bs >> ((-2 * bc) & 6)));
  }
  return out;
}

// SHA-256 puro (FIPS 180-4). Devuelve 32 bytes en un Array de numeros.
var SHA_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

function rotr32(x, n) {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

function sha256Bytes(data) {
  var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  var len = data.length;
  var msg = data.slice(0);
  msg.push(0x80);
  while (msg.length % 64 !== 56) msg.push(0);
  var bitHi = Math.floor(len / 536870912);
  var bitLo = ((len % 536870912) * 8) >>> 0;
  msg.push((bitHi >>> 24) & 255, (bitHi >>> 16) & 255, (bitHi >>> 8) & 255, bitHi & 255);
  msg.push((bitLo >>> 24) & 255, (bitLo >>> 16) & 255, (bitLo >>> 8) & 255, bitLo & 255);

  var w = new Array(64);
  var i, off;
  for (off = 0; off < msg.length; off += 64) {
    for (i = 0; i < 16; i++) {
      w[i] = (((msg[off + i * 4] << 24) | (msg[off + i * 4 + 1] << 16) | (msg[off + i * 4 + 2] << 8) | msg[off + i * 4 + 3]) >>> 0);
    }
    for (i = 16; i < 64; i++) {
      var x = w[i - 15];
      var y = w[i - 2];
      var s0 = (rotr32(x, 7) ^ rotr32(x, 18) ^ (x >>> 3)) >>> 0;
      var s1 = (rotr32(y, 17) ^ rotr32(y, 19) ^ (y >>> 10)) >>> 0;
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (i = 0; i < 64; i++) {
      var S1 = (rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25)) >>> 0;
      var ch = ((e & f) ^ (~e & g)) >>> 0;
      var t1 = (h + S1 + ch + SHA_K[i] + w[i]) >>> 0;
      var S0 = (rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22)) >>> 0;
      var maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      var t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  var out = [];
  for (i = 0; i < 8; i++) {
    out.push((H[i] >>> 24) & 255, (H[i] >>> 16) & 255, (H[i] >>> 8) & 255, H[i] & 255);
  }
  return out;
}

function sha256Hex(str) {
  var b = sha256Bytes(utf8Encode(str));
  var out = "";
  for (var i = 0; i < b.length; i++) {
    out += (b[i] < 16 ? "0" : "") + b[i].toString(16);
  }
  return out;
}

// ---- AES-256-CBC (descifrado) puro -----------------------------------------

var AES_SBOX = (function () {
  var box = new Array(256);
  var p = 1, q = 1;
  function rotl8(x, n) {
    return ((x << n) | (x >> (8 - n))) & 0xff;
  }
  do {
    p = (p ^ ((p << 1) & 0xff) ^ (p & 0x80 ? 0x1b : 0)) & 0xff;
    q = (q ^ ((q << 1) & 0xff)) & 0xff;
    q = (q ^ ((q << 2) & 0xff)) & 0xff;
    q = (q ^ ((q << 4) & 0xff)) & 0xff;
    if (q & 0x80) q = (q ^ 0x09) & 0xff;
    box[p] = (q ^ rotl8(q, 1) ^ rotl8(q, 2) ^ rotl8(q, 3) ^ rotl8(q, 4) ^ 0x63) & 0xff;
  } while (p !== 1);
  box[0] = 0x63;
  return box;
})();

var AES_INV_SBOX = (function () {
  var inv = new Array(256);
  for (var i = 0; i < 256; i++) inv[AES_SBOX[i]] = i;
  return inv;
})();

var AES_RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];

function aes256ExpandKey(key) {
  var Nk = 8, Nr = 14;
  var w = [];
  var i;
  for (i = 0; i < Nk; i++) {
    w.push([key[4 * i] & 255, key[4 * i + 1] & 255, key[4 * i + 2] & 255, key[4 * i + 3] & 255]);
  }
  for (i = Nk; i < 4 * (Nr + 1); i++) {
    var t = w[i - 1].slice(0);
    if (i % Nk === 0) {
      t = [t[1], t[2], t[3], t[0]];
      t = [AES_SBOX[t[0]], AES_SBOX[t[1]], AES_SBOX[t[2]], AES_SBOX[t[3]]];
      t[0] = (t[0] ^ AES_RCON[i / Nk - 1]) & 255;
    } else if (i % Nk === 4) {
      t = [AES_SBOX[t[0]], AES_SBOX[t[1]], AES_SBOX[t[2]], AES_SBOX[t[3]]];
    }
    var pv = w[i - Nk];
    w.push([(pv[0] ^ t[0]) & 255, (pv[1] ^ t[1]) & 255, (pv[2] ^ t[2]) & 255, (pv[3] ^ t[3]) & 255]);
  }
  var rk = [];
  for (i = 0; i < 4 * (Nr + 1); i++) rk.push(w[i][0], w[i][1], w[i][2], w[i][3]);
  return { rk: rk, Nr: Nr };
}

function gmul(a, b) {
  var p = 0;
  var aa = a & 255;
  var bb = b & 255;
  for (var i = 0; i < 8; i++) {
    if (bb & 1) p ^= aa;
    var hi = aa & 0x80;
    aa = (aa << 1) & 0xff;
    if (hi) aa ^= 0x1b;
    bb >>= 1;
  }
  return p & 255;
}

function aesAddRoundKey(s, rk, round) {
  var o = round * 16;
  for (var i = 0; i < 16; i++) s[i] = s[i] ^ rk[o + i];
}

function aesInvShiftRows(s) {
  var r, c, row, shifted;
  for (r = 1; r <= 3; r++) {
    row = [s[r], s[r + 4], s[r + 8], s[r + 12]];
    shifted = [];
    for (c = 0; c < 4; c++) shifted[c] = row[(c - r + 8) % 4];
    s[r] = shifted[0]; s[r + 4] = shifted[1]; s[r + 8] = shifted[2]; s[r + 12] = shifted[3];
  }
}

function aesInvSubBytes(s) {
  for (var i = 0; i < 16; i++) s[i] = AES_INV_SBOX[s[i] & 255];
}

function aesInvMixColumns(s) {
  for (var c = 0; c < 4; c++) {
    var o = 4 * c;
    var a0 = s[o], a1 = s[o + 1], a2 = s[o + 2], a3 = s[o + 3];
    s[o] = gmul(a0, 14) ^ gmul(a1, 11) ^ gmul(a2, 13) ^ gmul(a3, 9);
    s[o + 1] = gmul(a0, 9) ^ gmul(a1, 14) ^ gmul(a2, 11) ^ gmul(a3, 13);
    s[o + 2] = gmul(a0, 13) ^ gmul(a1, 9) ^ gmul(a2, 14) ^ gmul(a3, 11);
    s[o + 3] = gmul(a0, 11) ^ gmul(a1, 13) ^ gmul(a2, 9) ^ gmul(a3, 14);
  }
}

function aesDecryptBlock(input, ks) {
  var s = input.slice(0);
  var Nr = ks.Nr;
  var r;
  aesAddRoundKey(s, ks.rk, Nr);
  for (r = Nr - 1; r >= 1; r--) {
    aesInvShiftRows(s);
    aesInvSubBytes(s);
    aesAddRoundKey(s, ks.rk, r);
    aesInvMixColumns(s);
  }
  aesInvShiftRows(s);
  aesInvSubBytes(s);
  aesAddRoundKey(s, ks.rk, 0);
  return s;
}

// Devuelve el Array de bytes descifrado (sin el padding PKCS7) o null.
function aes256CbcDecrypt(cipherBytes, key, iv) {
  if (!cipherBytes || cipherBytes.length === 0 || cipherBytes.length % 16 !== 0) return null;
  var ks = aes256ExpandKey(key);
  var out = [];
  var prev = iv;
  for (var off = 0; off < cipherBytes.length; off += 16) {
    var block = cipherBytes.slice(off, off + 16);
    var dec = aesDecryptBlock(block, ks);
    for (var i = 0; i < 16; i++) out.push(dec[i] ^ prev[i]);
    prev = block;
  }
  var pad = out[out.length - 1];
  if (pad < 1 || pad > 16 || pad > out.length) return null;
  for (var j = out.length - pad; j < out.length; j++) {
    if (out[j] !== pad) return null;
  }
  return out.slice(0, out.length - pad);
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

function fetchText(url, headers, timeoutMs) {
  var ms = timeoutMs || 20000;
  var ctrl = null, signal = null;
  try {
    if (typeof AbortController !== "undefined") {
      ctrl = new AbortController();
      signal = ctrl.signal;
      if (typeof setTimeout !== "undefined") {
        (function (c) {
          setTimeout(function () {
            try { c.abort(); } catch (e) {}
          }, ms);
        })(ctrl);
      }
    }
  } catch (e) { ctrl = null; }

  var h = Object.assign(
    {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "es-MX,es;q=0.9,en;q=0.8",
    },
    headers || {}
  );
  var req = { headers: h, redirect: "follow" };
  if (signal) req.signal = signal;

  return fetch(url, req).then(function (res) {
    if (!res.ok) throw new Error("HTTP " + res.status + " " + url);
    return res.text();
  });
}

function fetchJsonSafe(url, headers, timeoutMs) {
  return fetchText(url, headers, timeoutMs).then(function (raw) {
    try { return JSON.parse(raw); } catch (e) { return null; }
  });
}

// ---------------------------------------------------------------------------
// TMDB / OMDB -> imdb_id
// ---------------------------------------------------------------------------

function normalizeImdb(raw) {
  if (raw === null || raw === undefined) return null;
  var s = String(raw).trim();
  if (!s || s === "null" || s === "undefined") return null;
  if (/^tt\d+$/.test(s)) return s;
  if (/^\d+$/.test(s)) return "tt" + s;
  var m = s.match(/(tt\d+)/);
  return m ? m[1] : null;
}

function parseImdbFromTmdb(data) {
  if (!data || typeof data !== "object") return null;
  if (data.success === false) return null;
  var direct = normalizeImdb(data.imdb_id);
  if (direct) return direct;
  var ext = data.external_ids;
  if (ext && typeof ext === "object") {
    var nested = normalizeImdb(ext.imdb_id);
    if (nested) return nested;
  }
  return null;
}

// Presupuesto duro del provider. El motor (Fire TV) corta a los ~9 s, asi que
// todo el pipeline tiene que cerrar bastante antes: 4,2 s de trabajo + 0.5 s de
// margen para que withTimeout devuelva lo que ya este listo (medido: 4-6.5 s
// con red real). El motor da 9 s, pero en el Fire TV la red es mas lenta que en
// Node: con 6 s llegaba tarde y devolvia 0 enlaces; con 4,2 s siempre devuelve
// los que ya resolvio (con sus cabeceras, que es lo que el relay necesita).
var BUDGET_MS = 4200;

// Date es parte del lenguaje (no una API de host), con fallback por si no
// estuviera: sin reloj, el techo real lo pone withTimeout igual.
function ahoraMs() {
  return (typeof Date !== "undefined" && Date.now) ? Date.now() : 0;
}

function tmdbGet(path, language, timeoutMs) {
  var url = TMDB_BASE + path + (path.indexOf("?") === -1 ? "?" : "&") + "api_key=" + TMDB_KEY + (language ? "&language=es-MX" : "");
  return fetchJsonSafe(url, { Accept: "application/json", "User-Agent": UA }, timeoutMs || 15000);
}

function getImdbFromOmdb(tmdbId, type, timeoutMs) {
  return tmdbGet("/" + type + "/" + tmdbId, false, timeoutMs || 15000).then(function (data) {
    if (!data) return null;
    var title = type === "movie" ? data.title : data.name;
    if (!title || !String(title).trim()) return null;
    var dateStr = type === "movie" ? data.release_date : data.first_air_date;
    var year = dateStr && String(dateStr).length >= 4 ? String(dateStr).substring(0, 4) : null;
    var omdbUrl =
      OMDB_BASE + "?apikey=" + OMDB_KEY + "&t=" + encodeURIComponent(title) +
      "&type=" + (type === "movie" ? "movie" : "series") + (year ? "&y=" + year : "");
    return fetchJsonSafe(omdbUrl, { Accept: "application/json", "User-Agent": UA }, timeoutMs || 15000).then(function (d) {
      if (!d || d.Response === "False") return null;
      return normalizeImdb(d.imdbID);
    });
  }).catch(function () { return null; });
}

// Misma cadena de fallbacks del Dart (external_ids -> detalle -> tv -> OMDB),
// pero con presupuesto: si se agota el tiempo se corta y devuelve null en vez
// de comerse la ventana completa de 9 s del motor.
function getImdb(tmdbId, type, budgetMs) {
  var t0 = ahoraMs();
  var deadline = t0 ? t0 + (budgetMs || 3500) : 0;
  function restante() { return deadline ? deadline - ahoraMs() : 20000; }
  function cap(def) {
    var r = restante();
    if (r < 400) return 0;
    return Math.min(def, r);
  }

  return tmdbGet("/" + type + "/" + tmdbId + "/external_ids", true, cap(2500) || 1200).then(function (d) {
    var imdb = parseImdbFromTmdb(d);
    if (imdb) return imdb;
    if (!cap(2000)) return null;
    return tmdbGet("/" + type + "/" + tmdbId + "?append_to_response=external_ids", false, cap(2000)).then(function (d2) {
      var i2 = parseImdbFromTmdb(d2);
      if (i2) return i2;
      if (type !== "tv" || !cap(1500)) return null;
      return tmdbGet("/tv/" + tmdbId, false, cap(1500)).then(function (d3) {
        var i3 = parseImdbFromTmdb(d3);
        if (i3) return i3;
        if (!cap(1500)) return null;
        return getImdbFromOmdb(tmdbId, type, cap(1500));
      });
    });
  });
}

// ---------------------------------------------------------------------------
// PoW + descifrado de la pagina Embed69
// ---------------------------------------------------------------------------

function extractPowConstants(html) {
  var out = {};
  var m = html.match(/POW_CHALLENGE\s*=\s*['"]?([a-f0-9]+)['"]?/i);
  if (m) out.challenge = m[1];
  m = html.match(/POW_SALT\s*=\s*['"]?([a-f0-9]+)['"]?/i);
  if (m) out.salt = m[1];
  m = html.match(/POW_DIFFICULTY\s*=\s*(\d+)/i);
  out.difficulty = m ? (parseInt(m[1], 10) || 3) : 3;
  return out;
}

function solvePow(challenge, difficulty) {
  var prefix = "";
  for (var k = 0; k < difficulty; k++) prefix += "0";
  var maxNonce = 2000000;
  var t0 = ahoraMs();
  var deadline = t0 ? t0 + 1200 : 0; // el PoW del sitio sale en ~15 ms (dificultad 3)
  for (var nonce = 0; nonce < maxNonce; nonce++) {
    if (sha256Hex(challenge + nonce).indexOf(prefix) === 0) return nonce;
    if (deadline && (nonce & 1023) === 1023 && ahoraMs() > deadline) return null;
  }
  return null;
}

function aesKeyBytes(challenge, nonce, salt) {
  return sha256Bytes(utf8Encode(challenge + nonce + salt));
}

function extractDataLink(html) {
  var patterns = [
    /let\s+dataLink\s*=\s*(\[[\s\S]*?\]);/i,
    /dataLink\s*=\s*(\[[\s\S]*?\]);/i,
    /<script>[\s\S]*?dataLink\s*=\s*(\[[\s\S]*?\]);[\s\S]*?<\/script>/i,
  ];
  for (var i = 0; i < patterns.length; i++) {
    var m = html.match(patterns[i]);
    if (!m) continue;
    var js = m[1].replace(/\\"/g, '"').replace(/\\\//g, "/");
    try {
      var arr = JSON.parse(js);
      if (arr && typeof arr.length === "number") return arr;
    } catch (e) {}
  }
  return null;
}

function decryptAesLink(encryptedBase64, key) {
  try {
    var raw = base64ToBytes(encryptedBase64);
    if (raw.length <= 16) return null;
    var iv = raw.slice(0, 16);
    var ct = raw.slice(16);
    var plain = aes256CbcDecrypt(ct, key, iv);
    if (!plain) return null;
    var text = utf8DecodeBytes(plain);
    if (text.indexOf("http") === -1) return null;
    return text;
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// idiomas / calidad
// ---------------------------------------------------------------------------

var LANG_MAP = {
  ESP: "es_MX", ES: "es_MX", "ESPAÑOL": "es_MX", SPANISH: "es_MX", LATINO: "es_MX", LAT: "es_MX",
  MX: "es_MX", ES_MX: "es_MX", SUB: "subtitulado", SUBTITULADO: "subtitulado", "SUB ESPAÑOL": "subtitulado",
  "SUB LATINO": "subtitulado", "SUB LAT": "subtitulado", INGLES: "en_US", EN: "en_US",
  ENGLISH: "en_US", EN_US: "en_US", "ESP SUB": "es_ES", "ES SUB": "es_ES", "ESPAÑOL SUB": "es_ES",
  "SPANISH SUB": "es_ES", CASTELLANO: "castellano", CAST: "castellano", ES_ES: "castellano",
};

// El Dart mapea 'ESP' -> 'es_MX' (o sea, latino) y deja los dos idiomas del
// sitio con la misma etiqueta; aca 'ESP' se separa como español/castellano
// porque embed69 publica LAT y ESP como pistas distintas y confundirlas hace
// que la app muestre dos veces el mismo idioma.
var LANG_EXACT = {
  LAT: "es_MX", LATINO: "es_MX", MX: "es_MX", ES_MX: "es_MX",
  ESP: "castellano", "ESPAÑOL": "castellano", ESPANOL: "castellano", CAST: "castellano",
  CASTELLANO: "castellano", ES_ES: "castellano",
  SUB: "subtitulado", SUBTITULADO: "subtitulado", SUBS: "subtitulado",
  EN: "en_US", ENG: "en_US", INGLES: "en_US", "INGLÉS": "en_US", ENGLISH: "en_US", EN_US: "en_US",
};

function normalizarIdioma(idioma) {
  var upper = String(idioma || "").toUpperCase().trim();
  if (LANG_EXACT[upper]) return LANG_EXACT[upper];
  // Fallback: mismo criterio del Dart (substring), pero con las claves mas
  // especificas primero para que 'ESP SUB' no caiga en 'ESP'.
  var keys = Object.keys(LANG_MAP).sort(function (a, b) { return b.length - a.length; });
  for (var i = 0; i < keys.length; i++) {
    if (upper.indexOf(keys[i]) !== -1) return LANG_MAP[keys[i]];
  }
  return String(idioma || "").toLowerCase();
}

function idiomaLabel(code) {
  if (code === "es_MX") return "Latino";
  if (code === "en_US") return "Inglés";
  if (code === "subtitulado") return "Subtitulado";
  if (code === "castellano" || code === "es_ES") return "Español";
  return "Latino";
}

// Igual que src/shared/quality.js de los otros providers.
var QUALITY_MAP = {
  streamwish: { x: "1080p", h: "1080p", n: "720p", l: "480p" },
  vidhide: { x: "1080p", h: "720p", n: "720p", l: "480p" },
};

function guessQualityFromUrl(url, family) {
  var map = QUALITY_MAP[family];
  if (map) {
    var m = String(url).match(/_,([a-z,]+),\.urlset/);
    if (m) {
      var labels = m[1].split(",").filter(Boolean);
      var order = ["x", "o", "h", "n", "l"];
      for (var i = 0; i < order.length; i++) {
        if (labels.indexOf(order[i]) !== -1 && map[order[i]]) return map[order[i]];
      }
    }
  }
  var num = String(url).match(/[_-](\d{3,4})p/);
  return num ? num[1] + "p" : null;
}

function qualityFromM3u8Body(body) {
  var maxH = 0;
  var re = /RESOLUTION=(\d+)x(\d+)/gi;
  var m;
  while ((m = re.exec(body)) !== null) {
    var h = parseInt(m[2], 10);
    if (h > maxH) maxH = h;
  }
  if (maxH >= 2160) return "4K";
  if (maxH >= 1080) return "1080p";
  if (maxH >= 720) return "720p";
  if (maxH >= 480) return "480p";
  return maxH > 0 ? maxH + "p" : null;
}

// ---------------------------------------------------------------------------
// resolvers de embed
// ---------------------------------------------------------------------------

function originOf(url) {
  var m = String(url || "").match(/^(https?:\/\/[^\/]+)/i);
  return m ? m[1] : "";
}

// Desempaqueta el clasico eval(function(p,a,c,k,e,...)) de Dean Edwards.
function unpackPacked(html) {
  try {
    var pMatch = html.match(/eval\(function\(p,a,c,k,e,[premd]\)\{[\s\S]*?\}\s*\('([\s\S]*?)',\s*(\d+),\s*(\d+),\s*'([\s\S]*?)'\.split\('\|'\)/);
    if (!pMatch) return null;
    var p = pMatch[1];
    var a = parseInt(pMatch[2], 10);
    var k = pMatch[3 + 1].split("|");
    var symbols = "0123456789abcdefghijklmnopqrstuvwxyz";
    function decodeBase36(num, rad) {
      var res = "";
      while (num > 0) { res = symbols[num % rad] + res; num = Math.floor(num / rad); }
      return res || "0";
    }
    return p.replace(/\b\w+\b/g, function (w) {
      var idx = parseInt(w, 36);
      return idx < k.length && k[idx] ? k[idx] : decodeBase36(idx, a);
    });
  } catch (e) {
    return null;
  }
}

// Junta los candidatos de URL del player: `links = {hls4:..,hls3:..,hls2:..}`
// (con la prioridad que usa el propio jwplayer) y el fallback `sources:[{file:..}]`.
function extractCandidates(html) {
  var text = html;
  var up = unpackPacked(html);
  if (up) text = up;

  var candidates = [];
  var seen = {};
  function push(u) {
    if (!u || typeof u !== "string") return;
    var v = u.replace(/\\\//g, "/").replace(/\\"/g, '"').trim();
    if (!v || v.indexOf("links.") === 0 || v.indexOf("http") === 0 || v.charAt(0) === "/") {
      if (v && seen[v] !== true) { seen[v] = true; candidates.push(v); }
    }
  }

  var m = text.match(/links\s*=\s*(\{[\s\S]*?\})\s*;/);
  if (m) {
    var obj = null;
    try { obj = JSON.parse(m[1].replace(/\\"/g, '"').replace(/\\'/g, "'")); } catch (e) { obj = null; }
    if (obj) {
      var keys = Object.keys(obj);
      // prioridad igual a la del player: hls4 (m3u8 self-hosted) primero
      var order = [];
      var prefer = ["hls4", "hls3", "hls2", "hls1", "hls"];
      for (var i = 0; i < prefer.length; i++) {
        for (var j = 0; j < keys.length; j++) {
          if (keys[j].toLowerCase().indexOf(prefer[i]) !== -1) order.push(keys[j]);
        }
      }
      for (var q = 0; q < keys.length; q++) {
        if (order.indexOf(keys[q]) === -1) order.push(keys[q]);
      }
      var used = {};
      for (var o = 0; o < order.length; o++) {
        var k = order[o];
        if (used[k]) continue;
        used[k] = true;
        var val = obj[k];
        if (typeof val === "string" && /\.m3u8|master\.txt|urlset/.test(val)) push(val);
      }
    }
  }

  var re = /(?:file|src)\s*:\s*["']([^"']+\.(?:m3u8|txt)[^"']*)["']/gi;
  var mm;
  while ((mm = re.exec(text)) !== null) push(mm[1]);

  var reAbs = /https?:\/\/[^\s"'<>\\]+\.(?:m3u8|txt)[^\s"'<>\\]*/gi;
  while ((mm = reAbs.exec(text)) !== null) push(mm[0]);

  return candidates;
}

// Prueba un candidato: lee el playlist y acepta solo si es un HLS real.
function verifyM3u8(url, referer, timeoutMs) {
  return fetchText(url, { Referer: referer || originOf(url) + "/", "User-Agent": UA }, timeoutMs || 3500).then(function (body) {
    if (body && body.indexOf("#EXTM3U") !== -1) return { ok: true, body: body };
    return { ok: false, body: "" };
  }).catch(function () {
    return { ok: false, body: "" };
  });
}

var VIDHIDE_HOSTS = ["vidhide", "dintezuvio", "minochinos", "dramiyos", "dhcplay", "smoothpre", "dhtpre",
  "vidspeeder", "moorearn", "travid", "vidhidehub", "vidhidevip", "vidhidepre", "kinoger", "movearnpre",
  "peytonepre", "filelions", "callistanise", "morencius", "bysedikamoum", "rapidvideo", "streamtape"];
var STREAMWISH_HOSTS = ["hlswish", "streamwish", "vibuxer", "strwish", "hglink", "ghbrisk", "premilkyway",
  "filemoon"];

function isVidhide(url) {
  var u = String(url || "").toLowerCase();
  for (var i = 0; i < VIDHIDE_HOSTS.length; i++) if (u.indexOf(VIDHIDE_HOSTS[i]) !== -1) return true;
  return false;
}

function isStreamwish(url) {
  var u = String(url || "").toLowerCase();
  for (var i = 0; i < STREAMWISH_HOSTS.length; i++) if (u.indexOf(STREAMWISH_HOSTS[i]) !== -1) return true;
  return false;
}

function familyOf(server, url) {
  var s = String(server || "").toLowerCase();
  if (isStreamwish(url) || s === "streamwish") return "streamwish";
  if (isVidhide(url) || s === "vidhide") return "vidhide";
  return null;
}

// hglink.to -> vibuxer.com y filelions.to -> callistanise.com (rotacion de
// dominios, igual que el Dart y que src/shared/embedResolvers.js).
function rewriteHost(url) {
  return String(url || "")
    .replace(/`/g, "")
    .replace(/^(https?:\/\/)(?:www\.)?hglink\.to(\/|$)/i, "$1vibuxer.com$2")
    .replace(/^(https?:\/\/)(?:www\.)?filelions\.to(\/|$)/i, "$1callistanise.com$2");
}

// /e/<code> en hosts tipo vidhide -> /embed/<code>
function normalizeVidhideUrl(url) {
  var u = String(url || "");
  if (u.indexOf("/embed/") !== -1) return u;
  var m = u.match(/^(https?:\/\/[^\/]+)\/([A-Za-z0-9_-]+)/);
  if (m) return m[1] + "/embed/" + m[2];
  return u;
}

// Resuelve un embed (streamwish/vidhide family) a un .m3u8 reproducible.
// `budgetMs` es el tiempo que le queda al provider: ninguna peticion de aca
// puede pasarse de ese presupuesto (el motor corta a los ~9 s).
function resolveEmbed(embedUrl, family, budgetMs) {
  var target = rewriteHost(embedUrl);
  if (family === "vidhide") target = normalizeVidhideUrl(target);
  var origin = originOf(target);
  var presupuesto = budgetMs && budgetMs > 0 ? budgetMs : 4500;
  var tEmbed = Math.max(1200, Math.min(4000, presupuesto));
  var tVerify = Math.max(1000, Math.min(3000, presupuesto));

  return fetchText(target, { Referer: "https://embed69.org/", Origin: "https://embed69.org", "User-Agent": UA }, tEmbed)
    .then(function (html) {
      var candidates = extractCandidates(html);
      // algunos hosts sirven un iframe intermedio
      if (!candidates.length) {
        var iframe = html.match(/<iframe[^>]*src=["']([^"']+)["']/i);
        if (iframe) {
          var iu = iframe[1];
          if (iu.indexOf("//") === 0) iu = "https:" + iu;
          if (iu.indexOf("/") === 0) iu = originOf(target) + iu;
          return fetchText(iu, { Referer: target, "User-Agent": UA }, tEmbed).then(function (h2) {
            return extractCandidates(h2);
          }).catch(function () { return []; });
        }
      }
      return candidates;
    })
    .then(function (candidates) {
      if (!candidates || !candidates.length) return null;
      var abs = [];
      for (var i = 0; i < candidates.length; i++) {
        var c = candidates[i];
        if (c.indexOf("//") === 0) c = "https:" + c;
        else if (c.indexOf("/") === 0) c = origin + c;
        else if (c.indexOf("http") !== 0) c = origin + "/" + c;
        if (abs.indexOf(c) === -1) abs.push(c);
      }
      // Se comprueban como mucho los DOS primeros candidatos (los que prioriza
      // el jwplayer del host) y EN PARALELO. Gana la primera comprobacion que
      // conteste: esperar a la mas lenta era lo que se comia los 9 s.
      var top = abs.slice(0, 2);
      var fallback = { url: abs[0], quality: guessQualityFromUrl(abs[0], family) || "Digital", verified: false };
      if (top.length === 1) {
        return verifyM3u8(top[0], target, tVerify).then(function (v) {
          if (v && v.ok) {
            return { url: top[0], quality: guessQualityFromUrl(top[0], family) || qualityFromM3u8Body(v.body) || "Digital", verified: true };
          }
          return fallback;
        });
      }
      return new Promise(function (resolve) {
        var listo = false;
        var pendientes = top.length;
        for (var n = 0; n < top.length; n++) {
          (function (idx) {
            verifyM3u8(top[idx], target, tVerify).then(function (v) {
              if (listo) return;
              if (v && v.ok) {
                listo = true;
                resolve({
                  url: top[idx],
                  quality: guessQualityFromUrl(top[idx], family) || qualityFromM3u8Body(v.body) || "Digital",
                  verified: true,
                });
                return;
              }
              if (--pendientes === 0) {
                listo = true;
                resolve(fallback);
              }
            });
          })(n);
        }
      });
    })
    .catch(function () {
      return null;
    });
}

// ---------------------------------------------------------------------------
// parser legacy de xupalace (go_to_playerVast / bloques <li>)
// ---------------------------------------------------------------------------

function extractEnlacesXupalace(html) {
  var enlaces = [];
  var seen = {};
  var mapLang = { "0": "es_MX", "1": "subtitulado", "2": "en_US", "3": "castellano" };
  var urlRe = /go_to_playerVast\(\s*['"]([^'"]+)['"]/g;
  var langRe = /data-lang=["'](\d+)["']/g;
  var spanRe = /<span[^>]*>([^<]+)<\/span>/i;

  var liRe = /<li\b[^>]*>[\s\S]*?<\/li>/gi;
  var block;
  while ((block = liRe.exec(html)) !== null) {
    var b = block[0];
    var um = urlRe.exec(b);
    urlRe.lastIndex = 0;
    if (!um) continue;
    var url = (um[1] || "").trim();
    if (!url || seen[url]) continue;
    langRe.lastIndex = 0;
    var lm = langRe.exec(b);
    var dataLang = lm ? lm[1] : "0";
    var sm = b.match(spanRe);
    var servidor = sm ? sm[1].trim().toLowerCase() : "desconocido";
    seen[url] = true;
    enlaces.push({ servidor: servidor, url: url, idioma: mapLang[dataLang] || "es_MX" });
  }

  if (!enlaces.length) {
    var m;
    while ((m = urlRe.exec(html)) !== null) {
      var u = (m[1] || "").trim();
      if (!u || seen[u]) continue;
      seen[u] = true;
      var before = html.substring(Math.max(0, m.index - 300), m.index);
      var after = html.substring(m.index, Math.min(html.length, m.index + 300));
      var langs = before.match(/data-lang=["'](\d+)["']/g) || [];
      var lastLang = langs.length ? langs[langs.length - 1].match(/(\d+)/)[1] : "0";
      var sp = after.match(spanRe);
      var srv = sp ? sp[1].trim().toLowerCase() : "";
      if (!srv) {
        if (u.indexOf("hglink.to") !== -1 || u.indexOf("streamwish") !== -1) srv = "streamwish";
        else if (u.indexOf("filemoon") !== -1 || u.indexOf("bysedikamoum") !== -1) srv = "filemoon";
        else if (u.indexOf("vidhide") !== -1 || u.indexOf("filelions") !== -1) srv = "vidhide";
        else if (u.indexOf("streamtape") !== -1) srv = "stape";
        else if (u.indexOf("voe.sx") !== -1) srv = "vox";
        else if (u.indexOf("waaw") !== -1) srv = "waaw";
        else srv = "desconocido";
      }
      enlaces.push({ servidor: srv, url: u, idioma: mapLang[lastLang] || "es_MX" });
    }
  }
  return enlaces;
}

// ---------------------------------------------------------------------------
// pipeline
// ---------------------------------------------------------------------------

// Servidores que el extractor Dart descarta a proposito (voe / rapidvideo:
// no son reproducibles por el player de la app, ver servidoresFiltrados).
var SERVIDORES_DESCARTADOS = ["voe", "rapidvideo"];

function idVariants(imdbId, isMovie, season, episode) {
  if (isMovie) return [imdbId];
  var s = parseInt(season, 10) || 1;
  var e = parseInt(episode, 10) || 1;
  var e2 = e < 10 ? "0" + e : "" + e;
  var s2 = s < 10 ? "0" + s : "" + s;
  return [
    imdbId + "-" + s + "x" + e2,
    imdbId + "-" + s + "x" + e,
    imdbId + "-" + s2 + "x" + e2,
    imdbId + "-" + s + "-" + e2,
    imdbId + "-" + s + "-" + e,
  ];
}

// Descarga la pagina del embed y devuelve [{servidor, url, idioma}] ya
// descifrados (o [] si no hay pagina / no hay dataLink / el PoW no se resuelve).
function fetchFromSource(source, idCompleto, timeoutMs) {
  var url = source.url + idCompleto + "/";
  return fetchText(url, {
    "X-Requested-With": "XMLHttpRequest",
    Referer: source.ref,
    Origin: source.org,
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
    "Accept-Encoding": "identity",
  }, timeoutMs || 4000).then(function (html) {
    if (!html) return [];

    var dataLink = extractDataLink(html);
    if (dataLink && dataLink.length) {
      var pow = extractPowConstants(html);
      if (!pow.challenge) return [];
      var nonce = solvePow(pow.challenge, pow.difficulty);
      if (nonce === null) return [];
      var key = aesKeyBytes(pow.challenge, nonce, pow.salt || "");
      var out = [];
      for (var i = 0; i < dataLink.length; i++) {
        var item = dataLink[i] || {};
        var idioma = normalizarIdioma(item.video_language || "DESCONOCIDO");
        var embeds = item.sortedEmbeds;
        if (!embeds || !embeds.length) continue;
        for (var j = 0; j < embeds.length; j++) {
          var embed = embeds[j] || {};
          var servidor = String(embed.servername || "").toLowerCase();
          if (SERVIDORES_DESCARTADOS.indexOf(servidor) !== -1) continue;
          var link = String(embed.link || "");
          if (!link) continue;
          var urlReal = decryptAesLink(link, key);
          if (!urlReal) continue;
          out.push({
            servidor: servidor || "desconocido",
            url: rewriteHost(urlReal),
            idioma: idioma,
          });
        }
      }
      return out;
    }

    // Sin dataLink: parser legacy de xupalace (go_to_playerVast).
    var enlaces = extractEnlacesXupalace(html);
    var legacy = [];
    for (var n = 0; n < enlaces.length; n++) {
      var e = enlaces[n];
      var srv = String(e.servidor || "").toLowerCase();
      var u = e.url || "";
      if (!u) continue;
      var esSW = srv === "streamwish" || u.indexOf("hglink.to") !== -1 || u.indexOf("streamwish") !== -1 || u.indexOf("vibuxer.com") !== -1;
      var esVH = srv === "vidhide" || u.indexOf("vidhide") !== -1 || u.indexOf("filelions") !== -1 || u.indexOf("callistanise") !== -1;
      if (!esSW && !esVH) continue;
      legacy.push({
        servidor: esSW ? "streamwish" : "vidhide",
        url: rewriteHost(u),
        idioma: e.idioma || "es_MX",
      });
    }
    return legacy;
  }).catch(function () {
    return [];
  });
}

// Convierte los embeds descifrados en streams PUBLICABLES de inmediato (la URL
// es el propio embed, con sus headers Referer/Origin): eso garantiza que, si se
// agota el presupuesto, el motor igual tenga enlaces que pasar por su relay.
function baseStreams(entries) {
  var out = [];
  var seen = {};
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    var fam = familyOf(e.servidor, e.url);
    if (!fam) continue;
    var k = fam + "|" + e.url + "|" + e.idioma;
    if (seen[k]) continue;
    seen[k] = true;
    var org = originOf(e.url);
    out.push({
      title: "Embed69 · " + (fam === "streamwish" ? "Streamwish" : "Vidhide"),
      quality: guessQualityFromUrl(e.url, fam) || "Digital",
      language: idiomaLabel(e.idioma),
      url: e.url,
      headers: { Referer: org + "/", Origin: org, "User-Agent": UA },
      _family: fam,
    });
  }
  return ordenar(out);
}

function ordenar(streams) {
  var order = { Latino: 0, "Español": 1, "Inglés": 2, Subtitulado: 3 };
  return streams.slice(0).sort(function (a, b) {
    var oa = order[a.language] === undefined ? 9 : order[a.language];
    var ob = order[b.language] === undefined ? 9 : order[b.language];
    return oa - ob;
  });
}

// Objetos finales del contrato: {title, quality, language, url, headers}.
function limpiar(streams) {
  var out = [];
  var seen = {};
  for (var i = 0; i < streams.length; i++) {
    var s = streams[i];
    if (!s || !s.url || seen[s.url]) continue;
    seen[s.url] = true;
    out.push({ title: s.title, quality: s.quality, language: s.language, url: s.url, headers: s.headers });
  }
  return out;
}

// Intenta mejorar cada embed con su .m3u8 directo, todo EN PARALELO. `sink` es
// la copia que se va actualizando a medida que cada embed se resuelve, para que
// el corte por tiempo devuelva lo ya resuelto y no la lista original.
function resolveAll(base, presupuestoMs, sink) {
  var tasks = [];
  for (var i = 0; i < base.length; i++) {
    (function (item, idx) {
      tasks.push(
        resolveEmbed(item.url, item._family, presupuestoMs).then(function (res) {
          if (!res || !res.url) return item;
          var org = originOf(res.url);
          var mejor = {
            title: item.title,
            quality: res.quality || item.quality,
            language: item.language,
            url: res.url,
            headers: { Referer: org + "/", Origin: org, "User-Agent": UA },
            _family: item._family,
          };
          if (sink) sink[idx] = mejor;
          return mejor;
        }).catch(function () { return item; })
      );
    })(base[i], i);
  }
  return Promise.all(tasks);
}

// Carrera contra el reloj que limpia el timer (importante en Node, donde un
// setTimeout pendiente mantiene vivo el proceso).
function conPlazo(promise, ms) {
  if (typeof setTimeout === "undefined") return promise;
  var timer = null;
  var corte = new Promise(function (res) {
    timer = setTimeout(function () { res(null); }, Math.max(0, ms));
  });
  return Promise.race([promise, corte]).then(function (v) {
    if (timer !== null && typeof clearTimeout !== "undefined") {
      try { clearTimeout(timer); } catch (e) {}
    }
    return v;
  });
}

// onPartial se llama en cuanto hay algo publicable (embeds con sus headers),
// asi withTimeout nunca devuelve [] si ya habia enlaces.
function collect(tmdbId, mediaType, season, episode, onPartial) {
  var id = parseInt(tmdbId, 10);
  if (!id || id <= 0) return Promise.resolve([]);
  var isMovie = mediaType !== "tv" && mediaType !== "series" && mediaType !== "anime";
  var type = isMovie ? "movie" : "tv";
  var s = parseInt(season, 10) || 1;
  var ep = parseInt(episode, 10) || 1;

  var t0 = ahoraMs();
  var deadline = t0 ? t0 + BUDGET_MS : 0;
  function restante() { return deadline ? deadline - ahoraMs() : 60000; }

  return getImdb(id, type, Math.min(3000, Math.max(1200, restante() - 2200))).then(function (imdbId) {
    if (!imdbId) return [];
    var variants = idVariants(imdbId, isMovie, s, ep);
    // Como maximo dos formatos de id (el sitio usa 1x01 / 1x1 y variantes con
    // guiones); mas variantes en serie no compensan el tiempo que consumen.
    var wanted = isMovie ? variants.slice(0, 1) : variants.slice(0, 2);

    // TODAS las paginas candidatas (fuente x variante) se piden EN PARALELO:
    // ir fuente por fuente era la mitad del tiempo perdido.
    var tPage = Math.max(1200, Math.min(4000, restante() - 2500));
    var tasks = [];
    for (var si = 0; si < SOURCES.length; si++) {
      for (var vi = 0; vi < wanted.length; vi++) {
        tasks.push(fetchFromSource(SOURCES[si], wanted[vi], tPage));
      }
    }

    return Promise.all(tasks).then(function (list) {
      var entries = null;
      // Prioridad: primer formato de id, y dentro de el, fuente 1, 2, 3.
      for (var v = 0; v < wanted.length && !entries; v++) {
        for (var q = 0; q < SOURCES.length && !entries; q++) {
          var item = list[q * wanted.length + v];
          if (item && item.length) entries = item;
        }
      }
      if (!entries) return [];

      var base = baseStreams(entries);
      if (!base.length) return [];

      // Ya hay algo devolvible: se publica para que el techo de tiempo no lo
      // tire, sin esperar a la resolucion de los .m3u8.
      if (onPartial) onPartial(limpiar(base));

      var falta = restante() - 300;
      if (falta < 1000) return limpiar(base);

      // `parcial` se va llenando con lo que ya se resolvio a m3u8; si se corta
      // por tiempo se devuelve eso (y los embeds sin resolver tal cual).
      var parcial = base.slice(0);
      return conPlazo(resolveAll(base, falta, parcial), falta).then(function (r) {
        return limpiar(r || parcial);
      });
    });
  });
}

// Igual que src/masters/index.js y poseidon.js: techo de tiempo duro para que
// el motor nunca quede esperando. Si se cumple el plazo se devuelve lo que ya
// se haya resuelto (en vez de tirar todo a la basura).
function withTimeout(promise, ms, fallback) {
  if (typeof setTimeout === "undefined") return promise;
  var timer = null;
  var timeout = new Promise(function (res) {
    timer = setTimeout(function () {
      res(fallback ? fallback() : []);
    }, ms);
  });
  return Promise.race([promise, timeout]).then(function (v) {
    if (timer !== null && typeof clearTimeout !== "undefined") {
      try { clearTimeout(timer); } catch (e) {}
    }
    return v;
  });
}

var ULTIMO_RESULTADO = [];

function getStreams(tmdbId, mediaType, season, episode) {
  ULTIMO_RESULTADO = [];
  var run = collect(tmdbId, mediaType, season, episode, function (parcial) {
    ULTIMO_RESULTADO = parcial || [];
  })
    .then(function (streams) {
      if (streams && streams.length) ULTIMO_RESULTADO = streams;
      return ULTIMO_RESULTADO || [];
    })
    .catch(function () {
      return ULTIMO_RESULTADO || [];
    });
  // Techos: BUDGET_MS de trabajo interno + 500 ms de margen (el motor corta a
  // los ~9 s, y con esto el provider responde siempre antes de 7 s).
  return withTimeout(run, BUDGET_MS + 500, function () {
    return ULTIMO_RESULTADO || [];
  }).catch(function () {
    return [];
  });
}

module.exports = { getStreams };

// ─── Que quedo FUERA del puerto y por que ───────────────────────────────────
// 1. voe y rapidvideo: el Dart los descarta a proposito (servidoresFiltrados)
//    porque el player de la app no los reproduce; aca se descartan igual.
// 2. El parser legacy de xupalace (go_to_playerVast / bloques <li>) esta
//    portado como fallback, pero xupalace.org hoy responde 301 hacia
//    embed69.org y esa pagina ya no trae esos enlaces: se conserva por si la
//    fuente vuelve al formato viejo, no porque hoy aporte streams.
// 3. DescargaEmbeds: el Dart solo usa `sortedEmbeds` (los `downloadEmbeds`
//    no se emiten como stream), igual aca.
// 4. La calidad "Digital" del Dart se reemplaza por la calidad real (etiquetas
//    del urlset tipo _,l,n,h, o RESOLUTION del master.m3u8). Ese dato no
//    existia en el Dart porque la app recien lo calculaba al reproducir.
// 5. No se descargan segmentos ni playlists de variantes: solo se verifica que
//    el master devuelva #EXTM3U. Los headers Referer/Origin se devuelven en
//    cada stream para que el motor/relay los aplique al reproducir.

// Notas de verificacion (Node 24, red real, 2026-09-22):
//   - sha256Bytes/aes256CbcDecrypt/aesKeyBytes se compararon 1:1 contra
//     node:crypto (40 rondas AES-256-CBC aleatorias + SHA-256 de varios
//     tamanos) y contra los dataLink reales de serieskao.top: coinciden byte a
//     byte. Utf8/base64 puros tambien comparados contra Buffer.
//   - Pruebas reales de getStreams (ms medidos de punta a punta):
//       278 movie   -> 6 enlaces en 5685 ms
//       550 movie   -> 4 enlaces en 4744 ms
//       603 movie   -> 6 enlaces en 5373 ms
//       1399 tv S1E1-> 4 enlaces en 3140 ms
//       1396 tv S2E3-> 2 enlaces en 2622 ms
//     Los tres primeros son 3 idiomas (LAT/ESP/SUB) x 2 servidores; varias
//     URLs verificadas con 200 + application/vnd.apple.mpegurl.
//   - Entradas basura (0, -1, "x", null, id inexistente, season/episode null)
//     devuelven [] sin lanzar; "278"/"1"/"1" como strings funcionan igual.
//   - Presupuesto: si el trabajo interno pasa de BUDGET_MS se devuelve lo que ya
//     este resuelto (nunca [] si habia embeds), asi el motor de 9 s siempre ve
//     enlaces. Lo que no llego a resolverse se entrega como el propio embed con
//     sus headers Referer/Origin para que el relay lo resuelva.
//   - Algunas URLs del CDN rotativo del host (subdominios *.shop/*.sbs/*.cyou)
//     verifican 200 y mueren segundos despues: es del host, no del codigo. Las
//     URLs estables (self-hosted /stream/... y morencius.com) se mantienen.
