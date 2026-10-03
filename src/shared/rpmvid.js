import { fetchText } from './http.js';
import CryptoJS from 'crypto-js';

var EMBED_ORIGIN = 'https://cubeembed.rpmvid.com';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36';

// AES key/IV for the /api/v1/video payload, reverse-engineered from the
// cubeembed player JS. Q() (key) and se() (iv) are CONSTANT — they do not
// depend on the video hash — so there is no need to download and execute the
// obfuscated player script with new Function(), which QuickJS sandboxes
// (like Nuvio's) block. Pure static derivation, no dynamic code execution.
var RPMVID_KEY_HEX = '6b69656d7469656e6d75613931316361'; // "kiemtienmua911ca"
var RPMVID_IV_HEX = '313233343536373839306f6975797472';  // "1234567890oiyutr"

function decryptHex(hex) {
  var keyWA = CryptoJS.enc.Hex.parse(RPMVID_KEY_HEX);
  var ivWA = CryptoJS.enc.Hex.parse(RPMVID_IV_HEX);
  var cipherParams = CryptoJS.lib.CipherParams.create({ ciphertext: CryptoJS.enc.Hex.parse(String(hex).trim()) });
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
  var url = EMBED_ORIGIN + '/api/v1/video?id=' + encodeURIComponent(hash) + '&w=1280&h=720&r=lacartoons.com';
  var hex = await fetchText(url, {
    headers: { Referer: EMBED_ORIGIN + '/', Origin: EMBED_ORIGIN, 'User-Agent': UA }
  });
  if (!/^[0-9a-f]+$/i.test(String(hex).trim())) throw new Error('rpmvid not hex');
  return decryptHex(hex);
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

export { isRpmvidIframe, videoIdFromIframe, fetchVideoData, collectHlsUrls, resolveRpmvidStream };
