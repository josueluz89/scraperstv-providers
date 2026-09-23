import { fetchText, fetchWithTimeout } from './http.js';

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

function rot13(str) {
  return str.replace(/[A-Za-z]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) + (c.toUpperCase() <= 'M' ? 13 : -13))
  );
}

function charShift(str, shift) {
  return str.split('').map(c => String.fromCharCode(c.charCodeAt(0) - shift)).join('');
}

function replacePatterns(str) {
  const patterns = ['@$', '^^', '~@', '%?', '*~', '!!', '#&'];
  let res = str;
  for (const p of patterns) {
    res = res.split(p).join('_');
  }
  return res;
}

function decryptVoe(encoded) {
  try {
    let s = rot13(encoded);
    s = replacePatterns(s);
    s = s.split('_').join('');
    let decoded = base64Decode(s);
    if (!decoded) return null;
    decoded = charShift(decoded, 3);
    decoded = decoded.split('').reverse().join('');
    decoded = base64Decode(decoded);
    if (!decoded) return null;
    return JSON.parse(decoded);
  } catch (e) {
    return null;
  }
}

function extractQuality(url) {
  if (!url) return 'Unknown';
  const m = url.match(/[_-](\d{3,4})p/);
  return m ? m[1] + 'p' : 'Unknown';
}

export async function resolveVoeStream(embedUrl) {
  try {
    const html = await fetchText(embedUrl, {
      headers: {
        Referer: embedUrl,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    let pageText = html;

    // Handle permanentToken redirect
    if (/permanentToken/i.test(pageText)) {
      const redirectMatch = pageText.match(/window\.location\.href\s*=\s*'([^']+)'/i);
      if (redirectMatch) {
        const redirectRes = await fetchWithTimeout(redirectMatch[1], {
          headers: { Referer: embedUrl, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        });
        if (redirectRes.ok) {
          pageText = await redirectRes.text();
        }
      }
    }

    // Extract JSON from <script type="application/json">["ENCODED_STRING"]
    const jsonMatch = pageText.match(/<script[^>]*type=['"]application\/json['"][^>]*>\s*\[\s*"([^"]+)"\s*\]\s*<\/script>/i);
    if (!jsonMatch) {
      // Fallback: find mp4/hls URLs in the page (Hermes-safe: no matchAll)
      var re1 = /(?:mp4|hls)'\s*:\s*'([^']+)'/gi;
      var re2 = /(?:mp4|hls)"\s*:\s*"([^"]+)"/gi;
      var m;
      while ((m = re1.exec(pageText)) !== null) {
        var u1 = m[1];
        if (u1.indexOf('aHR0') === 0) {
          try { u1 = base64Decode(u1) || u1; } catch (e) {}
        }
        return { url: u1, quality: extractQuality(u1), headers: { Referer: embedUrl } };
      }
      while ((m = re2.exec(pageText)) !== null) {
        var u2 = m[1];
        if (u2.indexOf('aHR0') === 0) {
          try { u2 = base64Decode(u2) || u2; } catch (e) {}
        }
        return { url: u2, quality: extractQuality(u2), headers: { Referer: embedUrl } };
      }
      return null;
    }

    const encodedStr = jsonMatch[1];
    const decrypted = decryptVoe(encodedStr);
    if (!decrypted) return null;

    const directUrl = decrypted.source || decrypted.direct_access_url;
    if (!directUrl) return null;

    return { url: directUrl, quality: extractQuality(directUrl), headers: { Referer: embedUrl } };
  } catch (e) {
    return null;
  }
}
