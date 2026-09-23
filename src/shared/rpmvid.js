import { fetchText } from './http.js';
import CryptoJS from 'crypto-js';

var EMBED_ORIGIN = 'https://cubeembed.rpmvid.com';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36';
var cryptoFactoryCache = null;

function bytesToHex(bytes) {
  var hex = '';
  for (var i = 0; i < bytes.length; i++) {
    var h = bytes[i].toString(16);
    if (h.length === 1) h = '0' + h;
    hex += h;
  }
  return hex;
}

// Minimal UTF-8 codec for the player-JS sandbox
// (Hermes/QuickJS may not provide TextEncoder/TextDecoder globals).
function utf8Encode(s) {
  var out = [];
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
      var lo = s.charCodeAt(i + 1);
      if (lo >= 0xDC00 && lo <= 0xDFFF) {
        c = 0x10000 + ((c - 0xD800) << 10) + (lo - 0xDC00);
        i++;
      }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F));
    else if (c < 0x10000) out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
    else out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 0x3F), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
  }
  return new Uint8Array(out);
}

function TEPoly() {}
TEPoly.prototype.encode = function(s) { return utf8Encode(s); };

function buildWindowMock(hash) {
  return {
    location: {
      protocol: 'https:',
      hash: '#' + hash,
      href: EMBED_ORIGIN + '/#' + hash
    },
    screen: { width: 1280, height: 720 },
    innerWidth: 1280,
    innerHeight: 720,
    TextEncoder: TEPoly,
    TextDecoder: TEPoly
  };
}

async function loadCryptoFactory() {
  if (cryptoFactoryCache) return cryptoFactoryCache;
  var html = await fetchText(EMBED_ORIGIN + '/', { headers: { 'User-Agent': UA } });
  var scriptMatch = html.match(/src="(\/assets\/index-[a-zA-Z0-9_-]+\.js)"/);
  if (!scriptMatch) throw new Error('cubeembed player script not found');
  var js = await fetchText(EMBED_ORIGIN + scriptMatch[1], {
    headers: { 'User-Agent': UA, Referer: EMBED_ORIGIN + '/' }
  });

  // 1. String table + decoder (handles the obfuscator array shuffle).
  var vaStart = js.indexOf('function Va(){');
  if (vaStart === -1) throw new Error('Va table not found');
  var feSrc = 'function fe(s,e){return s=s-120,Va()[s]}';
  var feIdx = js.indexOf(feSrc, vaStart);
  if (feIdx === -1) throw new Error('fe decoder not found');
  var vaBlock = js.slice(vaStart, feIdx) + feSrc;

  // 2. Shuffle IIFE: (function(s,e){const t=fe...})(Va,NNNNNN);
  var shuffleMatch = js.match(/\(function\(s,e\)\{const t=fe[\s\S]*?\}\)\(Va,\d+\);/);
  if (!shuffleMatch) throw new Error('table shuffle not found');

  // 3. Key/IV helpers P..se (AES key = Q(), iv = se()).
  var hStart = js.indexOf('P=x=>{const p=fe;return new Uint8Array');
  if (hStart === -1) throw new Error('crypto helpers not found');
  var kIdx = js.indexOf(',K=async', hStart);
  if (kIdx === -1) throw new Error('crypto helpers end not found');
  var helpersBlock = 'var ' + js.slice(hStart, kIdx) + ';';

  var src = vaBlock + '\n' + shuffleMatch[0] + '\n' + helpersBlock + '\nreturn {Q:Q,se:se};';
  cryptoFactoryCache = new Function('window', src);
  return cryptoFactoryCache;
}

function deriveKeyIv(hash) {
  var factory = cryptoFactoryCache;
  var fns = factory(buildWindowMock(hash));
  var key = fns.Q();
  var iv = fns.se();
  key = key instanceof Uint8Array ? key : new Uint8Array(key);
  iv = iv instanceof Uint8Array ? iv : new Uint8Array(iv);
  return { key: key.slice(0, 16), iv: iv.slice(0, 16) };
}

function decryptHex(hex, hash) {
  var d = deriveKeyIv(hash);
  var keyWA = CryptoJS.enc.Hex.parse(bytesToHex(d.key));
  var ivWA = CryptoJS.enc.Hex.parse(bytesToHex(d.iv));
  var cipherParams = CryptoJS.lib.CipherParams.create({ ciphertext: CryptoJS.enc.Hex.parse(hex.trim()) });
  var decrypted = CryptoJS.AES.decrypt(cipherParams, keyWA, { iv: ivWA, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 });
  var plain = decrypted.toString(CryptoJS.enc.Utf8);
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

function collectHlsUrls(data) {
  var urls = [];
  var origin = EMBED_ORIGIN;
  if (data.source && data.source.indexOf('.m3u8') !== -1) urls.push(data.source);
  if (data.cfNative && data.cfNative.indexOf('.m3u8') !== -1) urls.push(data.cfNative);
  if (data.hlsVideoTiktok) {
    var rel = data.hlsVideoTiktok.indexOf('http') === 0 ? data.hlsVideoTiktok : origin + data.hlsVideoTiktok;
    urls.push(rel);
  }
  if (data.videoUrl && data.videoUrl.indexOf('.m3u8') !== -1) urls.push(data.videoUrl);
  var seen = {};
  var out = [];
  for (var i = 0; i < urls.length; i++) { if (!seen[urls[i]]) { seen[urls[i]] = 1; out.push(urls[i]); } }
  return out;
}

async function fetchVideoData(hash) {
  await loadCryptoFactory();
  var url = EMBED_ORIGIN + '/api/v1/video?id=' + encodeURIComponent(hash) + '&w=1280&h=720&r=lacartoons.com';
  var hex = await fetchText(url, {
    headers: { Referer: EMBED_ORIGIN + '/', Origin: EMBED_ORIGIN, 'User-Agent': UA }
  });
  if (!/^[0-9a-f]+$/i.test(String(hex).trim())) throw new Error('rpmvid not hex');
  return decryptHex(hex, hash);
}

async function resolveRpmvidStream(iframeSrc) {
  try {
    var hash = videoIdFromIframe(iframeSrc);
    if (!hash) return null;
    var data = await fetchVideoData(hash);
    var urls = collectHlsUrls(data);
    if (!urls.length) return null;
    var best = urls[0];
    return { url: best, quality: '720p', headers: { Referer: EMBED_ORIGIN + '/', Origin: EMBED_ORIGIN } };
  } catch (e) {
    return null;
  }
}

async function loadCryptoCode() {
  await loadCryptoFactory();
  return true;
}

export { isRpmvidIframe, videoIdFromIframe, fetchVideoData, collectHlsUrls, resolveRpmvidStream, loadCryptoCode };
