import { fetchText, fetchWithRetry, fetchWithTimeout } from './http.js';
import { detectQualityFromM3U8 } from './quality.js';
import { resolveVoeStream } from './voe.js';

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

export async function resolveFilemoonStream(embedUrl) {
  try {
    const defaultHeaders = {
      'Referer': embedUrl,
      'Sec-Fetch-Dest': 'iframe',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'cross-site',
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:137.0) Gecko/20100101 Firefox/137.0',
    };

    const initialResponse = await fetchWithRetry(embedUrl, {
      headers: { ...defaultHeaders, Referer: 'https://embed69.org/' },
    });

    const iframeSrc = initialResponse.match(/<iframe[^>]*src=["']([^"']+)["']/i);
    if (iframeSrc) {
      let iframeUrl = iframeSrc[1];
      if (!iframeUrl.startsWith('http')) {
        iframeUrl = getUrlOrigin(embedUrl) + iframeUrl;
      }
      const iframeHtml = await fetchWithRetry(iframeUrl, {
        headers: { ...defaultHeaders, 'Accept-Language': 'en-US,en;q=0.5', Referer: embedUrl },
      });
      const unpacked = unpackPacked(iframeHtml);
      if (unpacked) {
        const videoMatch = unpacked.match(/sources:\s*\[\s*\{\s*file\s*:\s*"([^"]+)"/i);
        if (videoMatch) {
          let url = videoMatch[1];
          if (!url.startsWith('http')) url = getUrlOrigin(iframeUrl) + url;
          const quality = await detectQualityFromM3U8(url);
          return { url, quality, headers: { Referer: getUrlOrigin(iframeUrl) + '/' } };
        }
      }
      return null;
    }

    const unpacked = unpackPacked(initialResponse);
    if (unpacked) {
      const videoMatch = unpacked.match(/sources:\s*\[\s*\{\s*file\s*:\s*"([^"]+)"/i);
      if (videoMatch) {
        let url = videoMatch[1];
        if (!url.startsWith('http')) url = getUrlOrigin(embedUrl) + url;
        const quality = await detectQualityFromM3U8(url);
        return { url, quality, headers: { Referer: getUrlOrigin(embedUrl) + '/' } };
      }
    }

    return null;
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
  try {
    const html = await fetchWithRetry(embedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8',
        Referer: 'https://ok.ru/',
      },
    });

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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
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
  return null;
}

export function getServerLabel(url) {
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
  return 'Online';
}
