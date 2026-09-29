import { fetchText, fetchJson, fetchWithRetry, fetchWithTimeout } from './http.js';
import { detectQualityFromM3U8 } from './quality.js';
import { resolveVoeStream } from './voe.js';
import CryptoJS from 'crypto-js';

function getUrlOrigin(url) {
  if (!url) return '';
  const match = url.match(/^(https?:\/\/[^\/]+)/);
  return match ? match[1] : '';
}

function base64Decode(input) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let str = input.replace(/=+$/, '');
  let output = '';
  if (str.length % 4 === 1) return '';
  for (let i = 0, bc = 0, bs = 0; i < str.length; i++) {
    const char = str.charAt(i);
    const idx = chars.indexOf(char);
    if (idx === -1) continue;
    bs = bc % 4 ? bs * 64 + idx : idx;
    if (bc++ % 4) {
      output += String.fromCharCode(255 & (bs >> ((-2 * bc) & 6)));
    }
  }
  return output;
}

export function unpackPacked(html) {
  try {
    const pMatch = html.match(/eval\(function\(p,a,c,k,e,[premd]\)\{.*?\}\s*\('([\s\S]*?)',\s*(\d+),\s*(\d+),\s*'([\s\S]*?)'\.split\('\|'\)/);
    if (!pMatch) return null;
    let [, p, a, c, k] = pMatch;
    a = parseInt(a, 10);
    c = parseInt(c, 10);
    k = k.split('|');
    const decodeBase36 = (num, rad) => {
      const symbols = '0123456789abcdefghijklmnopqrstuvwxyz';
      let res = '';
      while (num > 0) {
        res = symbols[num % rad] + res;
        num = Math.floor(num / rad);
      }
      return res || '0';
    };
    return p.replace(/\b\w+\b/g, (w) => {
      const idx = parseInt(w, 36);
      return idx < k.length && k[idx] ? k[idx] : decodeBase36(idx, a);
    });
  } catch (e) {
    return null;
  }
}

export function normalizeVidHideUrl(url) {
  try {
    if (!url) return '';
    let res = url;
    if (!res.includes('/embed/')) {
      const match = res.match(/^(https?:\/\/[^\/]+)\/([A-Za-z0-9_-]+)/);
      if (match) {
        res = `${match[1]}/embed/${match[2]}`;
      }
    }
    return res;
  } catch (e) {
    return url;
  }
}

export function normalizeEmbedUrl(rawUrl) {
  try {
    if (!rawUrl) return '';
    let res = rawUrl;
    res = res
      .replace(/\/download(?:\/.*)?$/, '')
      .replace(/\/d\/(.+)/, '/v/$1')
      .replace(/\/embed\/(.+)/, '/v/$1')
      .replace(/\/file\/(.+)/, '/v/$1')
      .replace(/\/f\/(.+)/, '/v/$1');
    return res;
  } catch {
    return rawUrl;
  }
}

const DOMAIN_MAP = {
  'hglink.to': 'vibuxer.com',
  'ghbrisk.com': 'vibuxer.com',
  'premilkyway.com': 'streamwish.to',
};

export function mapDomain(url) {
  let result = url;
  var keys = Object.keys(DOMAIN_MAP);
  for (var i = 0; i < keys.length; i++) {
    var from = keys[i];
    var to = DOMAIN_MAP[from];
    if (result.indexOf(from) !== -1) {
      result = result.replace(from, to);
      break;
    }
  }
  return result;
}

export async function resolveHLSWishStream(embedUrl) {
  try {
    const base = mapDomain(embedUrl);
    const origin0 = getUrlOrigin(base);
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Referer: 'https://embed69.org/',
      Origin: 'https://embed69.org',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'es-MX,es;q=0.9',
    };
    // hgplaycdn y espejos solo sirven /e/ (/v/ da 404): probar original primero.
    const candidates = [base];
    const vVariant = base.replace('/e/', '/v/');
    if (vVariant !== base) candidates.push(vVariant);
    let html = null;
    let origin = origin0;
    for (const u of candidates) {
      try {
        html = await fetchWithRetry(u, { headers }, 1);
        origin = getUrlOrigin(u);
        break;
      } catch (e) { html = null; }
    }
    if (!html) return null;

    const fileMatch = html.match(/file\s*:\s*["']([^"']+)["']/i);
    if (fileMatch) {
      let fileUrl = fileMatch[1];
      if (fileUrl.startsWith('/')) fileUrl = origin + fileUrl;
      const quality = await detectQualityFromM3U8(fileUrl);
      return { url: fileUrl, quality, headers: { Referer: origin + '/' } };
    }

    const unpacked = unpackPacked(html);
    if (unpacked) {
      const srcMatch = unpacked.match(/["']([^"']{30,}\.m3u8[^"']*)['"]/i);
      if (srcMatch) {
        let fileUrl = srcMatch[1];
        if (fileUrl.startsWith('/')) fileUrl = origin + fileUrl;
        const quality = await detectQualityFromM3U8(fileUrl);
        return { url: fileUrl, quality, headers: { Referer: origin + '/' } };
      }
    }

    return null;
  } catch (e) {
    return null;
  }
}

export async function resolveVidHideProStream(embedUrl) {
  try {
    const normalizedUrl = normalizeVidHideUrl(embedUrl);
    const origin = getUrlOrigin(normalizedUrl);

    const html = await fetchWithRetry(normalizedUrl, {
      headers: {
        Referer: 'https://embed69.org/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'cross-site',
      },
    });

    let script = null;
    const packed = unpackPacked(html);
    if (packed) {
      let data = packed;
      if (data.includes('var links')) {
        data = data.substring(data.indexOf('var links'));
      }
      script = data;
    }

    if (!script) {
      const srcMatch = html.match(/<script[^>]*>([\s\S]*?sources:[\s\S]*?)<\/script>/i);
      if (srcMatch) script = srcMatch[1];
    }

    if (!script) return null;

    const m3u8Regex = /:\s*"([^"]*\.m3u8[^"]*)"/i;
    const m3u8Match = script.match(m3u8Regex);
    if (!m3u8Match) return null;

    let url = m3u8Match[1];
    if (url.startsWith('/')) url = origin + url;
    if (!url.startsWith('http')) url = origin + '/' + url;

    const quality = await detectQualityFromM3U8(url);
    return { url, quality, headers: { Referer: origin + '/', Origin: origin } };
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Byse Frontend (antes Filemoon: filemoon.sx, bysebuho.com, gn1r5n.org, ...).
// La página es una cáscara SPA de ~1.6 KB; el video viene de:
//   GET <origin>/api/videos/<code>/  ->  { playback: { iv, payload, key_parts[30], version } }
// playback está cifrado con AES-256-GCM. La clave NO viene completa: version
// (1-20) elige 2 fragmentos reales en los índices [v, 31-v] (base 1); el resto
// son señuelos. Se descifra con AES-256-CTR (CryptoJS, ya empaquetado) y se
// valida con JSON.parse en vez del tag GCM. Video borrado ->
// {"error":"video record missing: video not found"} (404) -> null.
function byseB64ToWordArray(s) {
  try {
    var norm = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
    while (norm.length % 4 !== 0) norm += '=';
    return CryptoJS.enc.Base64.parse(norm);
  } catch (e) {
    return null;
  }
}

function byseKeyParts(playback) {
  try {
    var parts = playback.key_parts || [];
    var total = parts.length;
    var v = parseInt(playback.version, 10);
    var pair = [];
    if (v >= 1 && v <= 20) pair = [v, 31 - v];
    var picked = [];
    for (var i = 0; i < pair.length; i++) {
      var idx = pair[i];
      if (idx >= 1 && idx <= total && parts[idx - 1]) picked.push(parts[idx - 1]);
    }
    // version fuera de rango o fragmentos inválidos: usar todos (como el bundle original).
    if (picked.length !== pair.length || picked.length === 0) return parts;
    return picked;
  } catch (e) {
    return [];
  }
}

function byseDecryptPlayback(playback) {
  try {
    if (!playback || !playback.payload || !playback.iv) return null;
    var parts = byseKeyParts(playback);
    if (!parts.length) return null;
    var keyHex = '';
    for (var i = 0; i < parts.length; i++) {
      var wa = byseB64ToWordArray(parts[i]);
      if (!wa) return null;
      keyHex += wa.toString(CryptoJS.enc.Hex);
    }
    var keyWA = CryptoJS.enc.Hex.parse(keyHex);
    var ivWA = byseB64ToWordArray(playback.iv);
    var fullWA = byseB64ToWordArray(playback.payload);
    if (!keyWA || !ivWA || !fullWA) return null;
    var ivHex = ivWA.toString(CryptoJS.enc.Hex);
    // GCM: J0 = nonce(12) || 0x00000001 y el primer bloque CTR usa J0+1.
    // CryptoJS CTR cifra el contador tal cual y luego incrementa, así que se
    // le pasa directamente nonce || 0x00000002.
    if (ivHex.length === 24) ivHex = ivHex + '00000002';
    var ctrIv = CryptoJS.enc.Hex.parse(ivHex);
    var fullHex = fullWA.toString(CryptoJS.enc.Hex);
    // El tag GCM son los últimos 16 bytes: se descartan (se valida con JSON.parse).
    if (fullHex.length < 32) return null;
    var ctHex = fullHex.substring(0, fullHex.length - 32);
    var cipherParams = CryptoJS.lib.CipherParams.create({
      ciphertext: CryptoJS.enc.Hex.parse(ctHex)
    });
    var decrypted = CryptoJS.AES.decrypt(cipherParams, keyWA, {
      iv: ctrIv,
      mode: CryptoJS.mode.CTR,
      padding: CryptoJS.pad.NoPadding
    });
    var plain = decrypted.toString(CryptoJS.enc.Utf8);
    if (!plain || plain.indexOf('{') !== 0) return null;
    return JSON.parse(plain);
  } catch (e) {
    return null;
  }
}

function pickBestByseSource(sources) {
  if (!sources || !sources.length) return null;
  var best = null;
  var bestScore = -1;
  for (var i = 0; i < sources.length; i++) {
    var s = sources[i] || {};
    var url = s.url || s.file;
    if (typeof url !== 'string' || url.indexOf('http') !== 0) continue;
    var score = 0;
    var label = String(s.label || '');
    var m = label.match(/(\d{3,4})/);
    if (m) score = parseInt(m[1], 10);
    if (url.indexOf('.m3u8') !== -1) score += 0.5;
    if (score > bestScore) { bestScore = score; best = { url: url, label: label }; }
  }
  return best;
}

export async function resolveFilemoonStream(embedUrl) {
  try {
    const m = String(embedUrl || '').match(/\/(?:e|d|v)\/([A-Za-z0-9_-]+)/);
    if (!m) return null;
    const code = m[1];
    const origin = getUrlOrigin(embedUrl);
    if (!origin) return null;

    // 1) API Byse (sitio actual).
    try {
      const data = await fetchJson(origin + '/api/videos/' + code + '/', {
        headers: {
          'Referer': embedUrl,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json,*/*;q=0.8'
        }
      });
      if (data && data.playback && data.playback.payload) {
        const plain = byseDecryptPlayback(data.playback);
        const best = pickBestByseSource(plain && plain.sources);
        if (best) {
          const quality = await detectQualityFromM3U8(best.url);
          return { url: best.url, quality, headers: { Referer: origin + '/' } };
        }
        return null;
      }
      // {"error": ...} o sin playback = video borrado / respuesta inesperada.
      return null;
    } catch (e) {
      // 404 (video borrado) u otro error de la API: no hay fallback útil.
      return null;
    }
  } catch (e) {
    return null;
  }
}

export async function resolveLulusStream(embedUrl) {
  try {
    const origin = getUrlOrigin(embedUrl);
    const filecode = embedUrl.replace(/\/+$/, '').split('/').pop();
    if (!filecode) return null;

    var bodyStr = 'op=embed&file_code=' + encodeURIComponent(filecode) + '&auto=1&referer=' + encodeURIComponent(embedUrl);
    const res = await fetch(origin + '/dl', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0',
        Referer: origin,
      },
      body: bodyStr,
    });

    if (!res.ok) return null;
    const html = await res.text();
    const scriptMatch = html.match(/<script[^>]*>([\s\S]*?vplayer[\s\S]*?)<\/script>/i);
    if (!scriptMatch) return null;
    const fileMatch = scriptMatch[1].match(/file\s*:\s*"([^"]+)"/);
    if (!fileMatch) return null;

    let url = fileMatch[1];
    if (url.startsWith('/')) url = origin + url;
    return { url, quality: '1080p', headers: { Referer: origin + '/' } };
  } catch (e) {
    return null;
  }
}

export async function resolveUqloadStream(embedUrl) {
  try {
    const origin = getUrlOrigin(embedUrl);
    // Uqload rejects requests carrying a foreign Referer ("Video embed restricted
    // for this domain"), so fetch without Referer like a no-referrer iframe.
    const html = await fetchWithRetry(embedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:151.0) Gecko/20100101 Firefox/151.0',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
        'Upgrade-Insecure-Requests': '1',
      },
    });

    const unpacked = unpackPacked(html);
    if (!unpacked) return null;

    const m3u8Match = unpacked.match(/https?:\/\/[^\s"'<>\\]+\.m3u8[^\s"'<>\\]*/i);
    if (m3u8Match) {
      const quality = await detectQualityFromM3U8(m3u8Match[0]);
      return { url: m3u8Match[0], quality, headers: { Referer: origin + '/', Origin: origin } };
    }

    const mp4Match = unpacked.match(/https?:\/\/[^\s"'<>\\]+\.mp4[^\s"'<>\\]*/i);
    if (mp4Match) {
      return { url: mp4Match[0], quality: '1080p', headers: { Referer: origin + '/', Origin: origin } };
    }

    return null;
  } catch (e) {
    return null;
  }
}

export async function resolveYourUploadStream(embedUrl) {
  try {
    const html = await fetchWithRetry(embedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        Referer: 'https://www.yourupload.com/',
      },
    });
    // og:video holds the direct mp4 (vidcache.net, follows 302 to play host).
    const m = html.match(/<meta[^>]*property="og:video"[^>]*content="([^"]+)"/i) ||
              html.match(/(https?:[^"'<>\s]+\.mp4[^"'<>\s]*)/i);
    if (!m) return null;
    const url = (m[1] || m[0]);
    if (url.indexOf('http') !== 0) return null;
    return {
      url,
      quality: '720p',
      headers: { Referer: 'https://www.yourupload.com/' },
    };
  } catch (e) {
    return null;
  }
}

// Shared helper: StreamWish-style players (goodstream, vimeos) expose
// sources:[{file:"...master.m3u8..."}] either in plain HTML or inside a
// Dean Edwards packed eval block.
function extractUrlsetM3U8(html) {
  try {
    if (!html) return null;
    // Edges vary serialization per request: JSON-escaped quotes/slashes,
    // protocol-relative URLs. Normalize before matching.
    html = html.replace(/\\"/g, '"').replace(/\\\//g, '/');
    var m = html.match(/sources\s*:\s*\[\s*\{\s*file\s*:\s*"([^"]+?\.m3u8[^"]*?)"/i);
    var u = m && m[1];
    if (u && u.indexOf('//') === 0) u = 'https:' + u;
    if (u && u.indexOf('http') === 0) return u;
    var unpacked = unpackPacked(html);
    if (unpacked) {
      unpacked = unpacked.replace(/\\"/g, '"').replace(/\\\//g, '/');
      var m2 = unpacked.match(/file\s*:\s*"([^"]+?\.m3u8[^"]*?)"/i) ||
               unpacked.match(/((?:https?:)?\/\/[^"'\s]+\.m3u8[^"'\s]*)/i);
      if (m2) {
        var u2 = m2[1] || m2[0];
        if (u2 && u2.indexOf('//') === 0) u2 = 'https:' + u2;
        if (u2 && u2.indexOf('http') === 0) return u2;
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}

export async function resolveGoodstreamStream(embedUrl) {
  try {
    const origin = getUrlOrigin(embedUrl);
    // Short budget: a hanging host must not eat the 40s provider cap.
    const html = await fetchWithRetry(embedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        Referer: origin + '/',
      },
    }, 1, 12000);
    const url = extractUrlsetM3U8(html);
    if (!url) return null;
    const quality = await detectQualityFromM3U8(url);
    return { url, quality, headers: { Referer: origin + '/' } };
  } catch (e) {
    return null;
  }
}

export async function resolveVimeosStream(embedUrl) {
  try {
    const origin = getUrlOrigin(embedUrl);
    // Short budget: a hanging host must not eat the 40s provider cap.
    const html = await fetchWithRetry(embedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        Referer: origin + '/',
      },
    }, 1, 12000);
    const url = extractUrlsetM3U8(html);
    if (!url) return null;
    const quality = await detectQualityFromM3U8(url);
    return { url, quality, headers: { Referer: origin + '/' } };
  } catch (e) {
    return null;
  }
}

export async function resolveDoodStream(embedUrl) {
  try {
    // Dood tar-pits blocked IPs (hangs instead of failing): shortest budget.
    const html = await fetchWithRetry(embedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        Referer: embedUrl,
      },
    }, 1, 10000);
    const host = getUrlOrigin(embedUrl);
    const m = html.match(/\/pass_md5\/([\w\-\/.]+)/);
    if (!m) return null;
    const res = await fetchWithTimeout(host + '/pass_md5/' + m[1], {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Referer: embedUrl,
      },
    }, 10000);
    if (!res.ok) return null;
    const url = (await res.text()).trim();
    if (!url || url.indexOf('http') !== 0) return null;
    return { url, quality: '720p', headers: { Referer: host + '/' } };
  } catch (e) {
    return null;
  }
}

export async function resolveVidaraStream(embedUrl) {
  try {
    const origin = getUrlOrigin(embedUrl);
    const code = embedUrl.replace(/\/+$/, '').split('/').pop().split('?')[0];
    if (!code) return null;
    const res = await fetchWithTimeout(origin + '/api/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Referer: embedUrl,
        Origin: origin,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
      body: JSON.stringify({ filecode: code }),
    });
    if (!res.ok) return null;
    let data;
    try { data = JSON.parse(await res.text()); } catch (e) { return null; }
    if (!data || !data.streaming_url) return null;
    return {
      url: data.streaming_url,
      quality: '1080p',
      headers: { Referer: origin + '/', Origin: origin },
    };
  } catch (e) {
    return null;
  }
}

export async function resolveOkRuStream(embedUrl) {
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  const HEADERS = {
    'User-Agent': UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8',
    Referer: 'https://ok.ru/'
  };

  function pickBestVideo(videos) {
    if (!videos || !videos.length) return null;
    let best = null;
    let bestScore = -1;
    for (let i = 0; i < videos.length; i++) {
      const v = videos[i] || {};
      const url = v.url;
      if (typeof url !== 'string' || url.indexOf('http') !== 0) continue;
      let score = 0;
      const km = String(v.key || v.name || '').match(/(\d{3,4})/);
      if (km) score = parseInt(km[1], 10);
      else if (/hd/i.test(String(v.key))) score = 720;
      else if (/sd/i.test(String(v.key))) score = 480;
      if (url.indexOf('.m3u8') !== -1) score += 0.5;
      if (score > bestScore) { bestScore = score; best = url; }
    }
    return best;
  }

  try {
    // 1) Endpoint meta de mail.ru/ok.ru: devuelve {videos:[{key,url}]}.
    // Video borrado -> {"error":"video_not_found"} -> null.
    const idm = String(embedUrl || '').match(/video(?:embed)?\/(\d+)/) ||
                String(embedUrl || '').match(/(\d{8,})/);
    if (idm) {
      try {
        const meta = await fetchJson('https://my.mail.ru/+/video/meta/' + idm[1], {
          headers: { 'User-Agent': UA, 'Referer': 'https://my.mail.ru/', 'Accept': 'application/json,*/*;q=0.8' }
        });
        const best = pickBestVideo(meta && meta.videos);
        if (best) {
          return { url: best, quality: '720p', headers: { Referer: 'https://ok.ru/', 'User-Agent': UA } };
        }
      } catch (e) {
        // cae al scraper legacy de la página
      }
    }

    // 2) Legacy: hlsManifestUrl en el HTML del embed.
    const html = await fetchWithRetry(embedUrl, { headers: HEADERS });

    // flashvars metadata is HTML-escaped JSON: &quot;hlsManifestUrl&quot;:&quot;URL&quot;
    // with \u0026 for & inside the URL.
    let m = html.match(/hlsManifestUrl(?:&quot;|"):(?:&quot;|")([^"&]+?)(?:&quot;|")/);
    if (!m) return null;
    const url = m[1].replace(/\\u0026/gi, '&').replace(/\\/g, '');
    if (url.indexOf('http') !== 0) return null;
    return {
      url,
      quality: '720p',
      headers: {
        Referer: 'https://ok.ru/',
        'User-Agent': UA,
      },
    };
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Mixdrop (mixdrop.co/e/<code>): la página trae JS empaquetado (p.a.c.k.e.r)
// con MDCore.wurl / vfile = URL directa del mp4. Video borrado = lander
// (window.location.href="/lander") -> null.
export async function resolveMixdropStream(embedUrl) {
  try {
    const html = await fetchWithRetry(embedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': embedUrl
      }
    });
    if (!html || html.indexOf('/lander') !== -1) return null;
    const unpacked = unpackPacked(html);
    const src = unpacked || html;
    let m = src.match(/MDCore\s*\.\s*wurl\s*=\s*"([^"]+)"/) ||
            src.match(/["']wurl["']\s*:\s*["']([^"']+)["']/) ||
            src.match(/\bwurl\s*=\s*"([^"]+)"/) ||
            src.match(/\bvfile\s*=\s*"([^"]+)"/) ||
            src.match(/["']vfile["']\s*:\s*["']([^"']+)["']/);
    if (!m) return null;
    let url = m[1].replace(/\\/g, '');
    if (url.indexOf('//') === 0) url = 'https:' + url;
    if (url.indexOf('http') !== 0) return null;
    return {
      url,
      quality: 'HD',
      headers: { Referer: getUrlOrigin(embedUrl) + '/' }
    };
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Mp4Upload (mp4upload.com/embed-<code>.html): videojs con player.src({type:
// "video/mp4", src: "https://.../video.mp4"}). El mp4 se sirve como
// application/octet-stream: el validador lo acepta por extensión.
export async function resolveMp4uploadStream(embedUrl) {
  try {
    const html = await fetchWithRetry(embedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.mp4upload.com/'
      }
    });
    if (!html) return null;
    let m = html.match(/player\.src\(\{\s*type:\s*"video\/mp4",\s*src:\s*"([^"]+)"/) ||
            html.match(/type:\s*"video\/mp4",\s*src:\s*"([^"]+)"/) ||
            html.match(/"src"\s*:\s*"(https?:[^"]+\.mp4[^"]*)"/);
    if (!m) return null;
    return {
      url: m[1],
      quality: 'HD',
      headers: { Referer: 'https://www.mp4upload.com/' }
    };
  } catch (e) {
    return null;
  }
}

export function getEmbedResolver(url) {
  if (url.includes('ok.ru')) {
    return resolveOkRuStream;
  }
  if (url.includes('voe.sx') || url.includes('cloudwindow-route.com')) {
    return resolveVoeStream;
  }
  if (url.includes('hlswish') || url.includes('streamwish') || url.includes('vibuxer') ||
      url.includes('strwish') || url.includes('hglink') || url.includes('ghbrisk') ||
      url.includes('premilkyway') || url.includes('hgplaycdn')) {
    return resolveHLSWishStream;
  }
  if (url.includes('vidhide') || url.includes('dintezuvio') || url.includes('minochinos') ||
      url.includes('dramiyos') || url.includes('dhcplay') || url.includes('smoothpre') ||
      url.includes('dhtpre') || url.includes('vidspeeder') || url.includes('moorearn') ||
      url.includes('travid') || url.includes('vidhidehub') || url.includes('vidhidevip') ||
      url.includes('vidhidepre') || url.includes('kinoger') || url.includes('movearnpre') ||
      url.includes('peytonepre') || url.includes('filelions')) {
    return resolveVidHideProStream;
  }
  if (url.includes('byse') || url.includes('filemoon') ||
      url.includes('rapidvideo')) {
    return resolveFilemoonStream;
  }
  if (url.includes('luluvid') || url.includes('lulus') || url.includes('lulu')) {
    return resolveLulusStream;
  }
  if (url.includes('yourupload')) {
    return resolveYourUploadStream;
  }
  if (url.includes('vidara') || url.includes('vidwara')) {
    return resolveVidaraStream;
  }
  if (url.includes('uqload')) {
    return resolveUqloadStream;
  }
  if (url.includes('goodstream')) {
    return resolveGoodstreamStream;
  }
  if (url.includes('vimeos')) {
    return resolveVimeosStream;
  }
  if (url.includes('doodstream') || url.includes('dsvplay') ||
      url.includes('dood.to') || url.includes('dood.watch') || url.includes('dood.so')) {
    return resolveDoodStream;
  }
  if (url.includes('mixdrop')) {
    return resolveMixdropStream;
  }
  if (url.includes('mp4upload')) {
    return resolveMp4uploadStream;
  }
  return null;
}

export function getServerLabel(url) {
  if (url.includes('ok.ru')) return 'OkRu';
  if (url.includes('voe.sx') || url.includes('cloudwindow')) return 'VOE';
  if (url.includes('streamwish') || url.includes('hlswish') || url.includes('vibuxer') ||
      url.includes('strwish') || url.includes('premilkyway')) return 'StreamWish';
  if (url.includes('vidhide') || url.includes('dintezuvio') || url.includes('minochinos') ||
      url.includes('dramiyos') || url.includes('dhcplay') || url.includes('smoothpre') ||
      url.includes('dhtpre') || url.includes('vidspeeder') || url.includes('moorearn') ||
      url.includes('travid') || url.includes('vidhidehub') || url.includes('vidhidevip') ||
      url.includes('vidhidepre') || url.includes('kinoger') || url.includes('movearnpre') ||
      url.includes('peytonepre') || url.includes('filelions')) return 'VidHide';
  if (url.includes('byse') || url.includes('filemoon') ||
      url.includes('rapidvideo')) return 'FileMoon';
  if (url.includes('luluvid') || url.includes('lulus')) return 'Lulu';
  if (url.includes('uqload')) return 'Uqload';
  if (url.includes('goodstream')) return 'GoodStream';
  if (url.includes('vimeos')) return 'Vimeos';
  if (url.includes('doodstream') || url.includes('dsvplay') || url.includes('dood.')) return 'Dood';
  if (url.includes('mixdrop')) return 'Mixdrop';
  if (url.includes('mp4upload')) return 'Mp4Upload';
  return 'Online';
}
