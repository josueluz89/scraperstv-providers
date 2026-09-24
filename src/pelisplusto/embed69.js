// Porte reducido del extractor embed69 (proveedores/embed69.js) con lo justo que
// necesita pelisplushd: la pagina `embed69.org/f/<imdb_id>/` que hoy sirve el
// detalle de cada pelicula/serie.
//
//  1. La pagina trae `dataLink` (JSON con los embeds CIFRADOS) y un proof-of-work.
//  2. Hay que hallar el nonce tal que sha256(POW_CHALLENGE + nonce) empiece con
//     POW_DIFFICULTY ceros; la clave AES-256 es sha256(POW_CHALLENGE + nonce + POW_SALT)
//     (32 bytes crudos).
//  3. Cada `link` viene en base64: IV = primeros 16 bytes, resto = ciphertext,
//     AES-256-CBC con PKCS7. Al descifrar sale la URL del host directo.
//  4. voe/rapidvideo se descartan (el player de la app no los reproduce).
//
// SHA-256 y AES-256-CBC estan implementados a mano (sin Buffer/atob/crypto), asi
// que corren igual en Node y en el QuickJS de Nuvio. Copiados 1:1 del provider
// embed69, que los tiene verificados byte a byte contra node:crypto.
import { fetchText } from '../shared/http.js';

var REFERER = 'https://embed69.org/';
var ORIGEN = 'https://embed69.org';

// ---------------------------------------------------------------------------
// utilidades de bajo nivel (sin Buffer / sin TextEncoder / sin atob)
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
  var out = '';
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
    out += '\uFFFD';
  }
  return out;
}

var B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

function base64ToBytes(input) {
  var str = String(input || '').replace(/=+$/, '');
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
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
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
      w[i] = ((msg[off + i * 4] << 24) | (msg[off + i * 4 + 1] << 16) | (msg[off + i * 4 + 2] << 8) | msg[off + i * 4 + 3]) >>> 0;
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
  var out = '';
  for (var i = 0; i < b.length; i++) {
    out += (b[i] < 16 ? '0' : '') + b[i].toString(16);
  }
  return out;
}

// ---- AES-256-CBC (solo descifrado) -----------------------------------------

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
// PoW + descifrado del dataLink
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

function solvePow(challenge, difficulty, maxIteraciones) {
  var prefix = '';
  for (var k = 0; k < difficulty; k++) prefix += '0';
  var max = maxIteraciones || 2000000;
  for (var nonce = 0; nonce < max; nonce++) {
    if (sha256Hex(challenge + nonce).indexOf(prefix) === 0) return nonce;
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
  ];
  for (var i = 0; i < patterns.length; i++) {
    var m = html.match(patterns[i]);
    if (!m) continue;
    var js = m[1].replace(/\\"/g, '"').replace(/\\\//g, '/');
    try {
      var arr = JSON.parse(js);
      if (arr && typeof arr.length === 'number') return arr;
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
    if (text.indexOf('http') === -1) return null;
    return text;
  } catch (e) {
    return null;
  }
}

// Servidores que el extractor Dart descarta a proposito: el player de la app
// no los reproduce.
var SERVIDORES_DESCARTADOS = ['voe', 'rapidvideo'];

// hglink.to -> vibuxer.com y filelions.to -> callistanise.com (rotacion de
// dominios, igual que src/shared/embedResolvers.js).
function rewriteHost(url) {
  return String(url || '')
    .replace(/`/g, '')
    .replace(/^(https?:\/\/)(?:www\.)?hglink\.to(\/|$)/i, '$1vibuxer.com$2')
    .replace(/^(https?:\/\/)(?:www\.)?filelions\.to(\/|$)/i, '$1callistanise.com$2');
}

var LANG_EXACT = {
  LAT: 'Latino', LATINO: 'Latino', MX: 'Latino', ES_MX: 'Latino',
  ESP: 'Español', 'ESPAÑOL': 'Español', ESPANOL: 'Español', CAST: 'Español',
  CASTELLANO: 'Español', ES_ES: 'Español',
  SUB: 'Subtitulado', SUBTITULADO: 'Subtitulado', SUBS: 'Subtitulado',
  EN: 'Inglés', ENG: 'Inglés', INGLES: 'Inglés', 'INGLÉS': 'Inglés', ENGLISH: 'Inglés',
};

function idiomaLabel(idioma) {
  var up = String(idioma || '').toUpperCase().trim();
  if (LANG_EXACT[up]) return LANG_EXACT[up];
  if (up.indexOf('SUB') !== -1) return 'Subtitulado';
  if (up.indexOf('LAT') !== -1) return 'Latino';
  if (up.indexOf('ESP') !== -1) return 'Español';
  return 'Latino';
}

// Descifra una pagina embed69 (/f/<id>/, /video/<id>/ y tambien /uqlink.php) y
// devuelve [{servidor, url, idioma, label}] con los hosts directos, o [].
export function decodeEmbed69Page(html) {
  var dataLink = extractDataLink(html);
  if (!dataLink || !dataLink.length) return [];
  var pow = extractPowConstants(html);
  if (!pow.challenge) return [];
  var nonce = solvePow(pow.challenge, pow.difficulty);
  if (nonce === null) return [];
  var key = aesKeyBytes(pow.challenge, nonce, pow.salt || '');
  var out = [];
  var seen = {};
  for (var i = 0; i < dataLink.length; i++) {
    var item = dataLink[i] || {};
    var language = idiomaLabel(item.video_language);
    var embeds = item.sortedEmbeds;
    if (!embeds || !embeds.length) continue;
    for (var j = 0; j < embeds.length; j++) {
      var embed = embeds[j] || {};
      var servidor = String(embed.servername || '').toLowerCase();
      if (SERVIDORES_DESCARTADOS.indexOf(servidor) !== -1) continue;
      var link = String(embed.link || '');
      if (!link) continue;
      var urlReal = decryptAesLink(link, key);
      if (!urlReal) continue;
      var url = rewriteHost(urlReal);
      var k = url + '|' + language;
      if (seen[k]) continue;
      seen[k] = true;
      out.push({ servidor: servidor || 'desconocido', url: url, language: language });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// resolucion del host directo a un .m3u8 reproducible
// ---------------------------------------------------------------------------

function originOf(url) {
  var m = String(url || '').match(/^(https?:\/\/[^\/]+)/i);
  return m ? m[1] : '';
}

// Desempaqueta el clasico eval(function(p,a,c,k,e,...)) de Dean Edwards.
function unpackPacked(html) {
  try {
    var pMatch = html.match(/eval\(function\(p,a,c,k,e,[premd]\)\{[\s\S]*?\}\s*\('([\s\S]*?)',\s*(\d+),\s*(\d+),\s*'([\s\S]*?)'\.split\('\|'\)/);
    if (!pMatch) return null;
    var p = pMatch[1];
    var a = parseInt(pMatch[2], 10);
    var k = pMatch[4].split('|');
    var symbols = '0123456789abcdefghijklmnopqrstuvwxyz';
    function decodeBase36(num, rad) {
      var res = '';
      while (num > 0) { res = symbols[num % rad] + res; num = Math.floor(num / rad); }
      return res || '0';
    }
    return p.replace(/\b\w+\b/g, function (w) {
      var idx = parseInt(w, 36);
      return idx < k.length && k[idx] ? k[idx] : decodeBase36(idx, a);
    });
  } catch (e) {
    return null;
  }
}

// Junta los candidatos de URL del player: `links = {hls4:..,hls3:..}` (con la
// prioridad que usa el propio jwplayer) y el fallback `sources:[{file:..}]`.
function extractCandidates(html) {
  var text = html;
  var up = unpackPacked(html);
  if (up) text = up;

  var candidates = [];
  var seen = {};
  function push(u) {
    if (!u || typeof u !== 'string') return;
    var v = u.replace(/\\\//g, '/').replace(/\\"/g, '"').trim();
    if (v && seen[v] !== true) {
      seen[v] = true;
      candidates.push(v);
    }
  }

  var m = text.match(/links\s*=\s*(\{[\s\S]*?\})\s*;/);
  if (m) {
    var obj = null;
    try {
      obj = JSON.parse(m[1].replace(/\\"/g, '"').replace(/\\'/g, "'"));
    } catch (e) { obj = null; }
    if (obj) {
      var keys = Object.keys(obj);
      var order = [];
      var prefer = ['hls4', 'hls3', 'hls2', 'hls1', 'hls'];
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
        var k2 = order[o];
        if (used[k2]) continue;
        used[k2] = true;
        var val = obj[k2];
        if (typeof val === 'string' && /\.m3u8|master\.txt|urlset/.test(val)) push(val);
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

function qualityFromM3u8Body(body) {
  var maxH = 0;
  var re = /RESOLUTION=(\d+)x(\d+)/gi;
  var m;
  while ((m = re.exec(body)) !== null) {
    var h = parseInt(m[2], 10);
    if (h > maxH) maxH = h;
  }
  if (maxH >= 2160) return '4K';
  if (maxH >= 1080) return '1080p';
  if (maxH >= 720) return '720p';
  if (maxH >= 480) return '480p';
  return maxH > 0 ? maxH + 'p' : null;
}

function guessQualityFromUrl(url, family) {
  var map = QUALITY_MAP[family];
  if (map) {
    var m = String(url).match(/_,([a-z,]+),\.urlset/);
    if (m) {
      var labels = m[1].split(',').filter(Boolean);
      var order = ['x', 'o', 'h', 'n', 'l'];
      for (var i = 0; i < order.length; i++) {
        if (labels.indexOf(order[i]) !== -1 && map[order[i]]) return map[order[i]];
      }
    }
  }
  var num = String(url).match(/[_-](\d{3,4})p/);
  return num ? num[1] + 'p' : null;
}

// Igual que src/shared/quality.js de los otros providers.
var QUALITY_MAP = {
  streamwish: { x: '1080p', h: '1080p', n: '720p', l: '480p' },
  vidhide: { x: '1080p', h: '720p', n: '720p', l: '480p' },
};

var VIDHIDE_HOSTS = ['vidhide', 'dintezuvio', 'minochinos', 'dramiyos', 'dhcplay', 'smoothpre', 'dhtpre',
  'vidspeeder', 'moorearn', 'travid', 'vidhidehub', 'vidhidevip', 'vidhidepre', 'kinoger', 'movearnpre',
  'peytonepre', 'filelions', 'callistanise', 'morencius', 'bysedikamoum', 'streamtape'];
var STREAMWISH_HOSTS = ['hlswish', 'streamwish', 'vibuxer', 'strwish', 'hglink', 'ghbrisk', 'premilkyway',
  'filemoon', 'hgplaycdn'];

function isVidhide(url) {
  var u = String(url || '').toLowerCase();
  for (var i = 0; i < VIDHIDE_HOSTS.length; i++) if (u.indexOf(VIDHIDE_HOSTS[i]) !== -1) return true;
  return false;
}

function isStreamwish(url) {
  var u = String(url || '').toLowerCase();
  for (var i = 0; i < STREAMWISH_HOSTS.length; i++) if (u.indexOf(STREAMWISH_HOSTS[i]) !== -1) return true;
  return false;
}

export function familyOf(servidor, url) {
  var s = String(servidor || '').toLowerCase();
  if (isStreamwish(url) || s === 'streamwish') return 'streamwish';
  if (isVidhide(url) || s === 'vidhide') return 'vidhide';
  return null;
}

// /e/<code> en hosts tipo vidhide -> /embed/<code>
function normalizeVidhideUrl(url) {
  var u = String(url || '');
  if (u.indexOf('/embed/') !== -1) return u;
  var m = u.match(/^(https?:\/\/[^\/]+)\/([A-Za-z0-9_-]+)/);
  if (m) return m[1] + '/embed/' + m[2];
  return u;
}

// Lee un candidato y solo lo acepta si es un HLS real (#EXTM3U).
function verifyM3u8(url, referer, timeoutMs) {
  return fetchText(url, { headers: { Referer: referer || originOf(url) + '/', 'User-Agent': UA } }, timeoutMs || 6000)
    .then(function (body) {
      if (body && body.indexOf('#EXTM3U') !== -1) return { ok: true, body: body };
      return { ok: false, body: '' };
    })
    .catch(function () {
      return { ok: false, body: '' };
    });
}

var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Resuelve un host directo (familia streamwish/vidhide) a un .m3u8 reproducible.
export function resolveHostStream(embedUrl, family, timeoutMs) {
  var t = timeoutMs || 12000;
  var target = rewriteHost(embedUrl);
  if (family === 'vidhide') target = normalizeVidhideUrl(target);
  var origin = originOf(target);

  return fetchText(target, { headers: { Referer: REFERER, Origin: ORIGEN, 'User-Agent': UA } }, t)
    .then(function (html) {
      var candidates = extractCandidates(html);
      if (!candidates.length) {
        // algunos hosts sirven un iframe intermedio
        var iframe = html.match(/<iframe[^>]*src=["']([^"']+)["']/i);
        if (!iframe) return [];
        var iu = iframe[1];
        if (iu.indexOf('//') === 0) iu = 'https:' + iu;
        if (iu.indexOf('/') === 0) iu = origin + iu;
        return fetchText(iu, { headers: { Referer: target, 'User-Agent': UA } }, t)
          .then(function (h2) { return extractCandidates(h2); })
          .catch(function () { return []; });
      }
      return candidates;
    })
    .then(function (candidates) {
      if (!candidates || !candidates.length) return null;
      var abs = [];
      for (var i = 0; i < candidates.length; i++) {
        var c = candidates[i];
        if (c.indexOf('//') === 0) c = 'https:' + c;
        else if (c.indexOf('/') === 0) c = origin + c;
        else if (c.indexOf('http') !== 0) c = origin + '/' + c;
        if (abs.indexOf(c) === -1) abs.push(c);
      }
      var top = abs.slice(0, 2);
      var fallback = { url: abs[0], quality: guessQualityFromUrl(abs[0], family) || 'HD', headers: { Referer: origin + '/', Origin: origin } };
      // Los dos primeros candidatos (los que prioriza el jwplayer del host) se
      // comprueban en paralelo; gana el primero que conteste con #EXTM3U.
      return new Promise(function (resolve) {
        var listo = false;
        var pendientes = top.length;
        for (var n = 0; n < top.length; n++) {
          (function (idx) {
            verifyM3u8(top[idx], target, t).then(function (v) {
              if (listo) return;
              if (v && v.ok) {
                listo = true;
                resolve({
                  url: top[idx],
                  quality: guessQualityFromUrl(top[idx], family) || qualityFromM3u8Body(v.body) || 'HD',
                  headers: { Referer: origin + '/', Origin: origin },
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
