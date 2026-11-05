import { fetchText, fetchWithTimeout } from './http.js';
import CryptoJS from 'crypto-js';

var EMBED_ORIGIN = 'https://cubeembed.rpmvid.com';
var TURBO_ORIGIN = 'https://turboembed.com';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36';

// Cambio 2026-11-04: la API vieja de rpmvid (/api/v1/video, payload AES
// con llave/IV estáticas) YA NO EXISTE (404) y el reproductor nuevo usa
// otro flujo, verificado 2026-11-04 con Caballeros cap1/cap2:
//   1. cubeembed /api/public/resolve?file1=<hash> -> JSON {ok, url, host1, file1, host2, file2}
//      (el url apunta a turboembed.com/<file2>; los archivos de Heidi
//      ya no existen ahí: resolve devuelve 404 "not found", y eso es
//      correcto, no un fallo del resolver).
//   2. turboembed cifra el slug (file2) con AES-CBC (clave/IV derivados
//      como el reproductor: prefijos fijos + fecha/hostname, ver abajo)
//      y pide /api/stream/tracking?c=<slug_cifrado_hex>.
//   3. La respuesta es 204 con el JSON cifrado en el header x-tracking;
//      al descifrarlo sale {stream:{tiktok, hls, direct}, player_ui, ads}.
//      tiktok y hls son playlists m3u8 reales (master.txt con #EXTM3U).
// La clave y el IV efectivos son constantes para turboembed.com (los
// prefijos ya superan los 32 hex de la llave/IV), pero se calculan con
// la misma fórmula del reproductor para no depender de eso si cambia
// el host. Sin codePointAt ni padStart/padEnd: QuickJS-safe, solo
// concatenación, slice y charCodeAt.
var TURBO_KEY_PREFIX_HEX = '1d54a1d53c1d56e1d6811d53c1d6831d4da1d4d41d4e81d7d91d7da1d7db';
var TURBO_SALT_PREFIX_HEX = '1f5101f5dd1f5111f6aa1f6e126a1';

function padRight32(s) {
  var out = String(s);
  while (out.length < 32) out += '0';
  return out;
}

function hexEncodeAscii(s) {
  var out = '';
  for (var i = 0; i < s.length; i++) {
    var h = s.charCodeAt(i).toString(16);
    out += h.length === 1 ? '0' + h : h;
  }
  return out;
}

function turboKeyHex() {
  var daysHex = Math.floor(Date.now() / 864e5).toString(16);
  return padRight32((TURBO_KEY_PREFIX_HEX + daysHex).slice(0, 32));
}

function turboIvHex(hostname) {
  var iv = TURBO_SALT_PREFIX_HEX + hexEncodeAscii(hostname || '');
  return padRight32(iv.slice(0, 32));
}

function turboEncrypt(plain, hostname) {
  var key = CryptoJS.enc.Hex.parse(turboKeyHex());
  var iv = CryptoJS.enc.Hex.parse(turboIvHex(hostname));
  var enc = CryptoJS.AES.encrypt(plain, key, { iv: iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 });
  return enc.ciphertext.toString(CryptoJS.enc.Hex);
}

function turboDecrypt(hex, hostname) {
  var key = CryptoJS.enc.Hex.parse(turboKeyHex());
  var iv = CryptoJS.enc.Hex.parse(turboIvHex(hostname));
  var params = CryptoJS.lib.CipherParams.create({ ciphertext: CryptoJS.enc.Hex.parse(String(hex).trim()) });
  var plain = CryptoJS.AES.decrypt(params, key, { iv: iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }).toString(CryptoJS.enc.Utf8);
  if (!plain) throw new Error('empty decrypt');
  return JSON.parse(plain);
}

function videoIdFromIframe(iframeSrc) {
  try {
    if (!iframeSrc) return null;
    if (iframeSrc.indexOf('#') !== -1) {
      var parts = iframeSrc.split('#')[1];
      if (parts && parts.indexOf('&') !== -1) parts = parts.split('&')[0];
      if (parts && parts.length > 1) return parts;
    }
    var u = new URL(iframeSrc);
    if (u.hostname.indexOf('rpmvid') === -1 && u.hostname.indexOf('cubeembed') === -1) return null;
    var id = u.searchParams.get('id');
    if (!id) id = (u.hash || '').replace(/^#/, '');
    if (id && id.indexOf('&') !== -1) id = id.split('&')[0];
    return id && id.length > 1 ? id : null;
  } catch (e) {
    if (typeof iframeSrc === 'string' && iframeSrc.indexOf('#') !== -1) {
      var p = iframeSrc.split('#')[1];
      if (p && p.indexOf('&') !== -1) p = p.split('&')[0];
      return p && p.length > 1 ? p : null;
    }
    return null;
  }
}

function isRpmvidIframe(iframeSrc) {
  if (!iframeSrc) return false;
  return iframeSrc.indexOf('rpmvid') !== -1 || iframeSrc.indexOf('cubeembed') !== -1;
}

// Compatibilidad: la vieja collectHlsUrls ya no se usa (la API vieja
// murió), pero se conserva exportada por si otro código la importa.
function collectHlsUrls(data) {
  var urls = [];
  function isIpUrl(u) { return /^https?:\/\/\d+\.\d+\.\d+\.\d+/.test(u); }
  var candidates = [];
  if (data && data.cfNative && data.cfNative.indexOf('.m3u8') !== -1) candidates.push(data.cfNative);
  if (data && data.source && data.source.indexOf('.m3u8') !== -1) candidates.push(data.source);
  if (data && data.hlsVideoTiktok) {
    var rel = data.hlsVideoTiktok.indexOf('http') === 0 ? data.hlsVideoTiktok : EMBED_ORIGIN + data.hlsVideoTiktok;
    candidates.push(rel);
  }
  if (data && data.videoUrl && data.videoUrl.indexOf('.m3u8') !== -1) candidates.push(data.videoUrl);
  candidates.sort(function (a, b) {
    return (isIpUrl(a) ? 1 : 0) - (isIpUrl(b) ? 1 : 0);
  });
  var seen = {};
  for (var i = 0; i < candidates.length; i++) {
    if (!seen[candidates[i]]) { seen[candidates[i]] = 1; urls.push(candidates[i]); }
  }
  return urls;
}

// Paso 1: rpmvid resolve -> URL de turboembed (o null si el archivo
// ya no existe en el sistema nuevo, como Heidi).
async function resolveTurboUrl(hash) {
  var url = EMBED_ORIGIN + '/api/public/resolve?file1=' + encodeURIComponent(hash);
  var text = await fetchText(url, {
    headers: { Referer: EMBED_ORIGIN + '/', Origin: EMBED_ORIGIN, 'User-Agent': UA }
  });
  var data = null;
  try { data = JSON.parse(text); } catch (e) { return null; }
  if (!data || !data.ok || !data.url) return null;
  return data.url;
}

// Paso 2+3: turboembed tracking cifrado -> objeto stream.
async function fetchTurboStream(turboUrl) {
  var u = new URL(turboUrl);
  var hostname = u.hostname;
  var slug = u.pathname.split('/').pop();
  if (!slug) return null;
  var enc = turboEncrypt(slug, hostname);
  var trackUrl = 'https://' + hostname + '/api/stream/tracking?c=' + enc;
  var res = await fetchWithTimeout(trackUrl, {
    headers: { Referer: turboUrl, Origin: 'https://' + hostname, 'User-Agent': UA }
  });
  var xt = null;
  try { xt = res.headers.get('x-tracking'); } catch (e) { xt = null; }
  if (!xt) return null;
  var data = turboDecrypt(xt, hostname);
  if (!data || !data.stream) return null;
  return data.stream;
}

async function fetchVideoData(hash) {
  var turboUrl = await resolveTurboUrl(hash);
  if (!turboUrl) return null;
  var stream = await fetchTurboStream(turboUrl);
  if (!stream) return null;
  return { stream: stream };
}

async function resolveRpmvidStream(iframeSrc) {
  try {
    var hash = videoIdFromIframe(iframeSrc);
    if (!hash) return null;
    var data = await fetchVideoData(hash);
    if (!data || !data.stream) return null;
    var s = data.stream;
    // Orden del reproductor: tiktok, hls, direct. master.txt es
    // playlist m3u8 real aunque termine en .txt.
    var urls = [];
    var seen = {};
    var order = ['tiktok', 'hls', 'direct'];
    for (var i = 0; i < order.length; i++) {
      var v = s[order[i]];
      if (v && v.indexOf('http') === 0 && !seen[v]) { seen[v] = 1; urls.push(v); }
    }
    if (!urls.length) return null;
    return urls.map(function (u) {
      return { url: u, quality: '720p', headers: { Referer: TURBO_ORIGIN + '/', Origin: TURBO_ORIGIN } };
    });
  } catch (e) {
    return null;
  }
}

export { isRpmvidIframe, videoIdFromIframe, fetchVideoData, collectHlsUrls, resolveRpmvidStream };
