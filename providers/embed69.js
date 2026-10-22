// ===== MasterScrap: validacion de enlaces funcionales (inyectado) =====
// Prueba cada URL con sus headers reales; descarta muertos (4xx/5xx/timeout),
// elimina duplicados y ordena por calidad. ESTRICTO v2: solo pasa VIDEO REAL
// reproducible (video/*, mpegurl o extension de video con 2xx); las paginas
// HTML de embed sin resolver se descartan. QuickJS-safe.
var __msValidate = (function () {
  var TIMEOUT_MS = 7000;
  var CONCURRENCY = 4;
  function qualityRank(q) {
    if (!q) return 0;
    var s = String(q).toLowerCase();
    if (s.indexOf('4k') !== -1 || s.indexOf('2160') !== -1) return 2160;
    var m = s.match(/(\d{3,4})\s*p/);
    if (m) return parseInt(m[1], 10);
    return 0;
  }
  function isM3u8(url) { return /\.m3u8(\?|#|$)/i.test(url || ''); }
  function hasVideoExt(url) { return /\.(mp4|m3u8|mkv|webm|ts|m4v|mov)(\?|#|$)/i.test(url || ''); }
  function isVideoResp(ct, url) {
    var c = '';
    try { c = String(ct || '').toLowerCase().split(';')[0].trim(); } catch (e) {}
    if (c.indexOf('video/') === 0) return true;
    if (c === 'application/vnd.apple.mpegurl' || c === 'application/x-mpegurl') return true;
    if (c === 'application/octet-stream' || c === 'binary/octet-stream') return hasVideoExt(url);
    if (!c) return hasVideoExt(url);
    return false;
  }
  function getCT(res) {
    try { if (res && res.headers && typeof res.headers.get === 'function') return res.headers.get('content-type'); } catch (e) {}
    return '';
  }
  function checkUrl(url, headers, timeoutMs) {
    return new Promise(function (resolve) {
      var done = false, timer = null, controller = null;
      function finish(ok) {
        if (done) return; done = true;
        if (timer) { try { clearTimeout(timer); } catch (e) {} timer = null; }
        if (controller) { try { controller.abort(); } catch (e) {} }
        resolve(!!ok);
      }
      if (!url || typeof url !== 'string' || url.indexOf('http') !== 0) { resolve(false); return; }
      if (typeof setTimeout !== 'undefined') {
        timer = setTimeout(function () { timer = null; finish(false); }, timeoutMs || TIMEOUT_MS);
      }
      var reqHeaders = { 'Range': 'bytes=0-2047',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' };
      if (headers) for (var k in headers) {
        if (Object.prototype.hasOwnProperty.call(headers, k) && headers[k]) reqHeaders[k] = headers[k];
      }
      var reqInit = { headers: reqHeaders, redirect: 'follow' };
      try {
        if (typeof AbortController !== 'undefined') { controller = new AbortController(); reqInit.signal = controller.signal; }
      } catch (e) { controller = null; }
      fetch(url, reqInit).then(function (res) {
        var st = res.status;
        if (st === 200 || st === 206 || st === 416) {
          if (isM3u8(url)) {
            res.text().then(function (t) { finish(t && t.indexOf('#EXTM3U') !== -1); }).catch(function () { finish(true); });
          } else if (st === 416) { finish(true); }
          else if (!isVideoResp(getCT(res), url)) { finish(false); }
          else finish(true);
        } else finish(false);
      }).catch(function () { finish(false); });
    });
  }
  
// Filtro de idioma: solo Latino y Subtitulado. Nada de espanol de Espana.
// Sin idioma (vacio, Desconocido, Multi) -> PASA.
function isAllowedLanguage(lang) {
  if (lang === null || lang === undefined) return true;
  var s = String(lang).toLowerCase().trim();
  if (!s) return true;
  try {
    s = s.replace(/[\u00e1\u00e0\u00e4\u00e2]/g, 'a').replace(/[\u00e9\u00e8\u00eb\u00ea]/g, 'e').replace(/[\u00ed\u00ec\u00ef\u00ee]/g, 'i')
      .replace(/[\u00f3\u00f2\u00f6\u00f4]/g, 'o').replace(/[\u00fa\u00f9\u00fc\u00fb]/g, 'u').replace(/\u00f1/g, 'n');
  } catch (e) {}
  if (s === 'desconocido' || s === 'unknown' || s === 'multi' || s === 'n/a' || s === '-') return true;
  if (s.indexOf('latino') !== -1 || s.indexOf('lat') !== -1 || s.indexOf('es_mx') !== -1 ||
      s.indexOf('es-mx') !== -1 || s.indexOf('es-la') !== -1 || s.indexOf('es_la') !== -1 ||
      s === 'mx' || s.indexOf('mx') !== -1) return true;
  if (s.indexOf('sub') !== -1 || s.indexOf('vose') !== -1) return true;
  if (s === 'en' || s === 'eng' || s.indexOf('english') !== -1 || s.indexOf('ingles') !== -1 ||
      s.indexOf('en-') === 0 || s.indexOf('en_') === 0 || s.indexOf('en ') === 0 ||
      s.indexOf(' en') !== -1) return true;
  if (s === 'ja' || s === 'jp' || s === 'jpn' || s.indexOf('japanese') !== -1 ||
      s.indexOf('japones') !== -1 || s.indexOf('ja-') === 0 || s.indexOf('ja_') === 0 ||
      s.indexOf('jp-') === 0 || s.indexOf('jp_') === 0) return true;
  return false;
}

  function filterWorkingStreams(streams, opts) {
    opts = opts || {};
    var timeout = opts.timeoutMs || TIMEOUT_MS, concurrency = opts.concurrency || CONCURRENCY;
    var seen = {}, uniq = [];
    (streams || []).forEach(function (s) { if (!s || !s.url || seen[s.url] || !isAllowedLanguage(s.language)) return; seen[s.url] = 1; uniq.push(s); });
    if (uniq.length === 0) return Promise.resolve([]);
    var results = new Array(uniq.length), cursor = 0;
    function worker() {
      if (cursor >= uniq.length) return Promise.resolve();
      var i = cursor++, st = uniq[i];
      return checkUrl(st.url, st.headers, timeout).then(function (ok) { results[i] = ok ? st : null; })
        .catch(function () { results[i] = null; }).then(worker);
    }
    var workers = [], n = Math.min(concurrency, uniq.length);
    for (var w = 0; w < n; w++) workers.push(worker());
    return Promise.all(workers).then(function () {
      var alive = [];
      for (var i = 0; i < results.length; i++) if (results[i]) alive.push(results[i]);
      alive.sort(function (a, b) { return qualityRank(b.quality) - qualityRank(a.quality); });
      return alive;
    }).catch(function () { return []; });
  }
  function withWorkingStreams(p) {
    return Promise.resolve(p).then(filterWorkingStreams).catch(function () { return []; });
  }
  return { withWorkingStreams: withWorkingStreams, filterWorkingStreams: filterWorkingStreams };
})();
// ===== fin validacion inyectada =====

// ===========================================================================
// embed69 — REESCRITURA LIMPIA (2026-10-22, por orden del dueño: lo que esta
// mal se borra y se escribe de nuevo, nada de parches encima).
//
// Que hace (igual que el extractor Dart original del que salio este provider):
//   1. tmdb_id -> imdb_id (TMDB, con OMDB como ultimo respaldo).
//   2. Con el imdb pide la pagina del embed a embed69.org / serieskao.top
//      (mismo motor Embed69 en las dos).
//   3. La pagina trae los embeds CIFRADOS (`dataLink`) y un proof-of-work:
//      nonce tal que sha256(POW_CHALLENGE + nonce) empieza con N ceros, y la
//      clave AES-256 es sha256(POW_CHALLENGE + nonce + POW_SALT).
//   4. Cada link se descifra (AES-256-CBC, IV = primeros 16 bytes) y sale la
//      URL real del servidor (streamwish / vidhide).
//   5. Cada embed se resuelve a su .m3u8 directo y SOLO eso se devuelve: los
//      embeds sin resolver los descarta despues el validador inyectado.
//
// Estructura: 4 fases en cadena (ids -> pagina -> descifrado -> resolucion),
// un UNICO presupuesto de tiempo (PRESUPUESTO + reloj) del que cuelga cada
// peticion, y una capa HTTP que nunca rechaza: ningun aborto o error de red
// puede matar la cadena; cada fase degrada a su fallback o a [].
//
// Se conserva TAL CUAL la matematica probada contra el sitio real y contra
// node:crypto: SHA-256 puro, AES-256-CBC puro, PoW, parseo de dataLink y de
// candidatos del player, mapas de idioma/calidad y listas de hosts. Lo que se
// reescribio desde cero es la orquestacion alrededor de esa matematica.
// ===========================================================================

var UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

var TMDB_KEY = "a2d9bbed370d9f678e34006f8750a5a5";
var TMDB_BASE = "https://api.themoviedb.org/3";
var OMDB_KEY = "5b0e8a3e";
var OMDB_BASE = "http://www.omdbapi.com/";

// Las dos fuentes sirven el mismo motor/contenido; se piden en carrera y la
// primera que traiga entradas gana (xupalace.org redirige a embed69.org, por
// eso no esta: seria pedir lo mismo dos veces).
var SOURCES = [
  { url: "https://embed69.org/f/", ref: "https://embed69.org/", org: "https://embed69.org" },
  { url: "https://serieskao.top/vidurl/", ref: "https://serieskao.top/", org: "https://serieskao.top" },
];

// ---------------------------------------------------------------------------
// Presupuesto UNICO, diseñado contra el contrato y la red real medida:
//   - Contrato Nuvio: < 60 s por llamada (docs/CONTRATO.md). Total interno de
//     42 s: quedan ~17 s para la verificacion del validador inyectado.
//   - Medido 2026-10-22 desde la IP de salida: TMDB tarda 1,5-3,2 s por
//     peticion; la pagina del embed 1,5-7 s; un embed 2-10 s; verificar un
//     playlist CDN 3,6-9,3 s. Los topes viejos (4 s embed / 3 s verificar /
//     8,5 s total / 2,5 s a TMDB) abortaban todo: por eso el provider daba 0.
// Cada fase tiene su sub-tope y NINGUNA peticion puede pasarse del tiempo que
// le quede al reloj: si una fase agota su sub-tope, la cadena sigue con lo
// que haya (fallback o vacio), nunca revienta.
// ---------------------------------------------------------------------------

var PRESUPUESTO = {
  total: 42000,     // techo de trabajo del provider por llamada
  imdb: 12000,      // fase 1 completa (TMDB en paralelo + OMDB)
  paginas: 12000,   // fase 2 completa (todas las variantes x fuentes)
  pagina: 10000,    // una sola peticion de pagina
  embed: 12000,     // una sola peticion de pagina de embed (o de su iframe)
  verificar: 10000, // una sola verificacion de playlist
};

// Reloj de la llamada: un solo deadline del que cuelgan fase y peticiones.
// Sin Date (no deberia pasar: es lenguaje base), restante() devuelve el total
// y el techo duro lo sigue poniendo el temporizador de conPlazo().
function ahoraMs() {
  return (typeof Date !== "undefined" && Date.now) ? Date.now() : 0;
}

function crearReloj(finAbs) {
  return {
    fin: finAbs,
    restante: function () {
      var n = ahoraMs();
      return n ? Math.max(0, this.fin - n) : PRESUPUESTO.total;
    },
    // Milisegundos utiles para una peticion con tope `cap`: 0 si ya no queda
    // tiempo util (la fase que lo recibe lo interpreta como "saltar").
    tope: function (cap) {
      var r = this.restante();
      if (r <= 300) return 0;
      return Math.min(cap, r);
    },
    // Reloj hijo: vence con el padre o a los `cap` ms, lo que pase primero.
    hijo: function (cap) {
      var n = ahoraMs();
      return crearReloj(n ? Math.min(this.fin, n + cap) : this.fin);
    },
  };
}

function nuevoReloj() {
  var n = ahoraMs();
  return crearReloj(n ? n + PRESUPUESTO.total : 0);
}

// ===========================================================================
// Utilidades puras y cripto (SIN CAMBIOS: verificados byte a byte contra
// node:crypto y contra los dataLink reales del sitio)
// ===========================================================================
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

// ---------------------------------------------------------------------------
// HTTP: una sola puerta, y NUNCA rechaza. Toda peticion resuelve con el texto
// o con null (HTTP no-2xx, aborto por tiempo, red caida, lo que sea). Asi,
// por diseño, ningun error de red puede matar la cadena: cada fase recibe
// null/vacio y decide su fallback.
// ---------------------------------------------------------------------------

function httpText(url, headers, ms) {
  return new Promise(function (resolve) {
    var done = false;
    function fin(v) {
      if (!done) { done = true; resolve(v); }
    }
    var h = {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "es-MX,es;q=0.9,en;q=0.8",
    };
    if (headers) {
      for (var k in headers) {
        if (Object.prototype.hasOwnProperty.call(headers, k) && headers[k]) h[k] = headers[k];
      }
    }
    var req = { headers: h, redirect: "follow" };
    try {
      if (typeof AbortController !== "undefined") {
        var ctrl = new AbortController();
        req.signal = ctrl.signal;
        if (typeof setTimeout !== "undefined") {
          (function (c) {
            setTimeout(function () { try { c.abort(); } catch (e) {} }, Math.max(1, ms || 10000));
          })(ctrl);
        }
      }
    } catch (e) {}
    try {
      fetch(url, req).then(function (res) {
        if (!res || !res.ok) { fin(null); return; }
        res.text().then(fin, function () { fin(null); });
      }, function () { fin(null); });
    } catch (e) { fin(null); }
  });
}

function httpJson(url, headers, ms) {
  return httpText(url, headers, ms).then(function (raw) {
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  });
}

// Resuelve con el primer resultado que cumpla `sirve`; si ninguna promesa
// sirve, resuelve null cuando TODAS hayan terminado. Las promesas que llegan
// tarde se ignoran (sus efectos laterales utiles, si los hay, ya ocurrieron).
function primeroUtil(promesas, sirve) {
  return new Promise(function (resolve) {
    var quedan = promesas.length;
    var listo = false;
    if (!quedan) { resolve(null); return; }
    function fallo() {
      if (!listo && --quedan === 0) { listo = true; resolve(null); }
    }
    promesas.forEach(function (p) {
      Promise.resolve(p).then(function (v) {
        if (listo) return;
        if (v && sirve(v)) { listo = true; resolve(v); return; }
        fallo();
      }, fallo);
    });
  });
}

// ---------------------------------------------------------------------------
// Fase 1 — tmdb_id -> imdb_id
// ---------------------------------------------------------------------------

function tmdbJson(path, conIdioma, fase, cap) {
  var t = fase.tope(cap);
  if (!t) return Promise.resolve(null);
  var url = TMDB_BASE + path + (path.indexOf("?") === -1 ? "?" : "&") + "api_key=" + TMDB_KEY + (conIdioma ? "&language=es-MX" : "");
  return httpJson(url, { Accept: "application/json", "User-Agent": UA }, t);
}

// OMDB por titulo+anio (ultimo respaldo: TMDB no siempre trae el imdb
// mapeado). Recibe el detalle de TMDB ya descargado si lo hay — no se vuelve
// a pedir — y vale para peliculas Y series por igual.
function imdbDesdeOmdb(tmdbId, tipo, fase, detalle) {
  function conDetalle(d) {
    if (!d) return null;
    var titulo = tipo === "movie" ? d.title : d.name;
    if (!titulo || !String(titulo).trim()) return null;
    var fecha = tipo === "movie" ? d.release_date : d.first_air_date;
    var anio = fecha && String(fecha).length >= 4 ? String(fecha).substring(0, 4) : null;
    var t = fase.tope(6000);
    if (!t) return null;
    var url = OMDB_BASE + "?apikey=" + OMDB_KEY + "&t=" + encodeURIComponent(titulo) +
      "&type=" + (tipo === "movie" ? "movie" : "series") + (anio ? "&y=" + anio : "");
    return httpJson(url, { Accept: "application/json", "User-Agent": UA }, t).then(function (od) {
      if (!od || od.Response === "False") return null;
      return normalizeImdb(od.imdbID);
    });
  }
  if (detalle) return conDetalle(detalle);
  return tmdbJson("/" + tipo + "/" + tmdbId, false, fase, 6000).then(conDetalle);
}

// Los dos caminos de TMDB se piden EN PARALELO y gana el primero que traiga
// el imdb: en serie, pedirlos uno tras otro con topes chicos era la muerte
// (cada peticion tarda ~3 s y el segundo camino ya nacia sin tiempo). Si
// ninguno lo trae: en series se prueba el detalle plano (cadena del Dart) y
// al final OMDB, para AMBOS tipos.
function resolverImdb(tmdbId, tipo, reloj) {
  var fase = reloj.hijo(PRESUPUESTO.imdb);
  var detalle = null;
  function guardarDetalle(d) {
    if (d && typeof d === "object" && !detalle) detalle = d;
    return d;
  }
  var pExt = tmdbJson("/" + tipo + "/" + tmdbId + "/external_ids", true, fase, 8000)
    .then(function (d) { return parseImdbFromTmdb(d); });
  var pDet = tmdbJson("/" + tipo + "/" + tmdbId + "?append_to_response=external_ids", false, fase, 8000)
    .then(function (d) { return parseImdbFromTmdb(guardarDetalle(d)); });

  return primeroUtil([pExt, pDet], function (v) { return !!v; }).then(function (imdb) {
    if (imdb) return imdb;
    var paso = Promise.resolve(null);
    if (tipo === "tv") {
      paso = tmdbJson("/tv/" + tmdbId, false, fase, 6000)
        .then(function (d) { return parseImdbFromTmdb(guardarDetalle(d)); });
    }
    return paso.then(function (i3) {
      if (i3) return i3;
      return imdbDesdeOmdb(tmdbId, tipo, fase, detalle);
    });
  });
}

// ---------------------------------------------------------------------------
// PoW + descifrado de la pagina Embed69 (probado, sin cambios)
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
// Idiomas y calidad (probado, sin cambios)
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
// Parseo de la pagina del player: candidatos .m3u8 (probado, sin cambios)
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

// ---------------------------------------------------------------------------
// Familias de servidores y reescritura de dominios (probado, sin cambios)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Parser legacy de xupalace (formato viejo; probado, sin cambios)
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

// Servidores que el extractor Dart descarta a proposito (voe / rapidvideo:
// el player de la app no los reproduce, ver servidoresFiltrados del Dart).
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

// ---------------------------------------------------------------------------
// Fase 2+3 — pagina del embed y descifrado de sus enlaces
// ---------------------------------------------------------------------------

// Convierte el HTML de la pagina en entradas [{servidor, url, idioma}] ya
// descifradas. Sin dataLink cae al parser legacy de xupalace (formato viejo,
// hoy inactivo pero inofensivo si el sitio volviera a el).
function procesarPagina(html) {
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
        out.push({ servidor: servidor || "desconocido", url: rewriteHost(urlReal), idioma: idioma });
      }
    }
    return out;
  }

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
    legacy.push({ servidor: esSW ? "streamwish" : "vidhide", url: rewriteHost(u), idioma: e.idioma || "es_MX" });
  }
  return legacy;
}

function pedirFuente(fuente, idCompleto, fase) {
  var t = fase.tope(PRESUPUESTO.pagina);
  if (!t) return Promise.resolve([]);
  return httpText(fuente.url + idCompleto + "/", {
    "X-Requested-With": "XMLHttpRequest",
    Referer: fuente.ref,
    Origin: fuente.org,
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
    "Accept-Encoding": "identity",
  }, t).then(function (html) {
    return html ? procesarPagina(html) : [];
  });
}

// Variantes de id en orden (la primera es la que el sitio usa hoy; las demas
// quedan por si rotara el formato). Por variante, las fuentes van en carrera
// y gana la primera CON entradas: no se espera a la fuente lenta.
function buscarEntradas(imdbId, esMovie, season, episode, reloj) {
  var fase = reloj.hijo(PRESUPUESTO.paginas);
  var variantes = idVariants(imdbId, esMovie, season, episode);
  var i = 0;
  function siguiente() {
    if (i >= variantes.length || fase.tope(PRESUPUESTO.pagina) === 0) return Promise.resolve([]);
    var v = variantes[i++];
    var intentos = SOURCES.map(function (fuente) { return pedirFuente(fuente, v, fase); });
    return primeroUtil(intentos, function (arr) { return arr && arr.length > 0; }).then(function (ganadora) {
      if (ganadora && ganadora.length) return ganadora;
      return siguiente();
    });
  }
  return siguiente();
}

// ---------------------------------------------------------------------------
// Fase 4 — resolucion de cada embed a su .m3u8 directo
// ---------------------------------------------------------------------------

// Un candidato solo se da por bueno si su cuerpo es un playlist HLS real.
function verificarCandidato(url, referer, reloj) {
  var t = reloj.tope(PRESUPUESTO.verificar);
  if (!t) return Promise.resolve({ ok: false, body: "" });
  return httpText(url, { Referer: referer }, t).then(function (body) {
    return body && body.indexOf("#EXTM3U") !== -1 ? { ok: true, body: body } : { ok: false, body: "" };
  });
}

// Resuelve UNA entrada a su stream final {title, quality, language, url,
// headers} o a null. Se comprueban como mucho los dos primeros candidatos
// (los que prioriza el jwplayer del host) EN PARALELO y gana el primero que
// verifique; si ninguno verifica, se devuelve el primer candidato tal cual y
// que decida el validador inyectado (es su trabajo, no negociable).
function resolverEmbed(entrada, reloj) {
  var fam = familyOf(entrada.servidor, entrada.url);
  if (!fam) return Promise.resolve(null);
  var target = rewriteHost(entrada.url);
  if (fam === "vidhide") target = normalizeVidhideUrl(target);
  var origin = originOf(target);
  var t = reloj.tope(PRESUPUESTO.embed);
  if (!t) return Promise.resolve(null);

  return httpText(target, { Referer: "https://embed69.org/", Origin: "https://embed69.org" }, t).then(function (html) {
    if (!html) return null;
    var candidates = extractCandidates(html);
    if (candidates.length) return candidates;
    // Algunos hosts sirven primero un iframe intermedio.
    var iframe = html.match(/<iframe[^>]*src=["']([^"']+)["']/i);
    if (!iframe) return [];
    var iu = iframe[1];
    if (iu.indexOf("//") === 0) iu = "https:" + iu;
    else if (iu.indexOf("/") === 0) iu = origin + iu;
    var t2 = reloj.tope(PRESUPUESTO.embed);
    if (!t2) return [];
    return httpText(iu, { Referer: target }, t2).then(function (h2) {
      return h2 ? extractCandidates(h2) : [];
    });
  }).then(function (candidates) {
    if (!candidates || !candidates.length) return null;
    var abs = [];
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      if (c.indexOf("//") === 0) c = "https:" + c;
      else if (c.indexOf("/") === 0) c = origin + c;
      else if (c.indexOf("http") !== 0) c = origin + "/" + c;
      if (abs.indexOf(c) === -1) abs.push(c);
    }
    if (!abs.length) return null;
    var sinVerificar = { url: abs[0], quality: guessQualityFromUrl(abs[0], fam) || "Digital" };
    var top = abs.slice(0, 2);
    return new Promise(function (resolve) {
      var listo = false;
      var quedan = top.length;
      top.forEach(function (cand) {
        verificarCandidato(cand, target, reloj).then(function (v) {
          if (listo) return;
          if (v && v.ok) {
            listo = true;
            resolve({ url: cand, quality: guessQualityFromUrl(cand, fam) || qualityFromM3u8Body(v.body) || "Digital" });
            return;
          }
          if (--quedan === 0) { listo = true; resolve(sinVerificar); }
        });
      });
    });
  }).then(function (res) {
    if (!res || !res.url) return null;
    var org = originOf(res.url);
    return {
      title: "Embed69 · " + (fam === "streamwish" ? "Streamwish" : "Vidhide"),
      quality: res.quality || "Digital",
      language: idiomaLabel(entrada.idioma),
      url: res.url,
      headers: { Referer: org + "/", Origin: org, "User-Agent": UA },
    };
  });
}

// ---------------------------------------------------------------------------
// Pipeline completo
// ---------------------------------------------------------------------------

// Solo entran a resolverse las entradas de familias conocidas, sin duplicar.
function entradasUtiles(entradas) {
  var out = [];
  var seen = {};
  for (var i = 0; i < entradas.length; i++) {
    var e = entradas[i];
    if (!familyOf(e.servidor, e.url)) continue;
    var k = e.url + "|" + e.idioma;
    if (seen[k]) continue;
    seen[k] = true;
    out.push(e);
  }
  return out;
}

// Todas las resoluciones en paralelo; cada una que termina escribe su hueco
// del sink, para que un corte por tiempo devuelva lo ya resuelto.
function resolverTodos(utiles, reloj, sink) {
  var tareas = utiles.map(function (entrada, idx) {
    return resolverEmbed(entrada, reloj).then(function (stream) {
      if (stream) sink[idx] = stream;
      return stream;
    });
  });
  return Promise.all(tareas);
}

function compactar(arr) {
  var out = [];
  for (var i = 0; i < arr.length; i++) if (arr[i]) out.push(arr[i]);
  return out;
}

// Carrera contra el deadline del reloj: es el UNICO techo exterior de la
// llamada. Al cortar devuelve lo que el sink ya tenga resuelto.
function conPlazo(promise, reloj, alCortar) {
  if (typeof setTimeout === "undefined") return promise;
  var timer = null;
  var corte = new Promise(function (res) {
    timer = setTimeout(function () { res(alCortar()); }, Math.max(0, reloj.restante()));
  });
  return Promise.race([promise, corte]).then(function (v) {
    if (timer !== null && typeof clearTimeout !== "undefined") {
      try { clearTimeout(timer); } catch (e) {}
    }
    return v;
  });
}

function ejecutar(tmdbId, mediaType, season, episode, reloj, sink) {
  var id = parseInt(tmdbId, 10);
  if (!id || id <= 0) return Promise.resolve([]);
  // Contrato Nuvio: 'movie' | 'series' | 'anime' (anime se busca como tv en
  // TMDB, igual que hacen los demas providers).
  var esMovie = mediaType !== "tv" && mediaType !== "series" && mediaType !== "anime";
  var tipo = esMovie ? "movie" : "tv";
  var s = parseInt(season, 10) || 1;
  var ep = parseInt(episode, 10) || 1;

  return resolverImdb(id, tipo, reloj).then(function (imdbId) {
    if (!imdbId) return [];
    return buscarEntradas(imdbId, esMovie, s, ep, reloj).then(function (entradas) {
      var utiles = entradasUtiles(entradas || []);
      if (!utiles.length) return [];
      for (var i = 0; i < utiles.length; i++) sink.push(null);
      return resolverTodos(utiles, reloj, sink).then(function () {
        return limpiar(ordenar(compactar(sink)));
      });
    });
  }).catch(function () { return []; });
}

// getStreams NUNCA rechaza y NUNCA se pasa del presupuesto: devuelve los
// streams resueltos, o lo resuelto hasta el corte, o [].
function getStreams(tmdbId, mediaType, season, episode) {
  var reloj = nuevoReloj();
  var sink = [];
  var trabajo = ejecutar(tmdbId, mediaType, season, episode, reloj, sink);
  return conPlazo(trabajo, reloj, function () {
    return limpiar(ordenar(compactar(sink)));
  }).catch(function () { return []; });
}

module.exports = { getStreams };


// ─── Que quedo FUERA y por que ─────────────────────────────────────────────
// 1. voe y rapidvideo: el Dart los descarta a proposito (servidoresFiltrados)
//    porque el player de la app no los reproduce; aca se descartan igual.
// 2. Los embeds crudos sin resolver NO se devuelven: que los descarte es
//    trabajo del validador inyectado, y devolverlos solo gastaba su tiempo.
// 3. No se descargan segmentos ni variantes: solo se verifica que el master
//    devuelva #EXTM3U. Los headers Referer/Origin viajan en cada stream.
//
// ─── Notas de verificacion de la REESCRITURA (Node 24, red real, 2026-10-22) ─
//   - La capa inyectada (cabecera __msValidate + envoltorio final) quedo
//     byte-identica a la version anterior; la cripto (SHA-256 / AES-256-CBC /
//     PoW) se conserva tal cual de la version verificada contra node:crypto y
//     contra los dataLink reales, y esta bateria la ejercita de punta a punta.
//   - getStreams con ids basura (0, -5, "x") devuelve [] sin lanzar.
//   - Bateria real (mismas referencias que el arreglo parchado, arnes 70 s):
//       Dune 2 (movie)         -> 4 (25,9 s) · 0 (26,0 s) · 1 (31,8 s)
//       The Boys S1E1 (series) -> 2 (19,1 s) · 0 (12,0 s) · 2 (33,1 s)
//       Breaking Bad S1E1      -> 2 (18,5 s) · 2 (27,1 s)
//     La version parchada, medida el mismo dia y con la misma red, murio dos
//     veces a los 9,0 s clavados en la fase de ids (sus topes en serie no
//     dejaban pasar una peticion de TMDB de ~3 s) y dio Dune 1 / Boys 0 /
//     Breaking Bad 0; la reescritura no presenta esa muerte estructural.
//     Los ceros que quedan son la varianza de latencia ya conocida de esta
//     IP de salida (la version parchada tambien los tenia: Dune 0,0,2,4).
//   - Ninguna corrida se acerco al techo de 42 s: maximo medido 33,1 s.
// ===== MasterScrap: getStreams solo devuelve enlaces funcionales =====
(function () {
  try {
    var __origGetStreams = module.exports.getStreams;
    if (typeof __origGetStreams === 'function') {
      module.exports = {
        getStreams: function (tmdbId, mediaType, season, episode) {
          return __msValidate.withWorkingStreams(__origGetStreams(tmdbId, mediaType, season, episode));
        }
      };
    }
  } catch (e) {}
})();
