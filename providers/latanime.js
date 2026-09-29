/**
 * latanime - Built from src/latanime/
 * Generated: 2026-09-29T16:38:01.593Z
 */
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    };
    var rejected = (value) => {
      try {
        step(generator.throw(value));
      } catch (e) {
        reject(e);
      }
    };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};

// src/shared/http.js
var FETCH_TIMEOUT = 12e3;
function fetchWithTimeout(url, options, timeout) {
  if (!options)
    options = {};
  var ms = timeout || FETCH_TIMEOUT;
  var controller = null;
  var signal = null;
  try {
    if (typeof AbortController !== "undefined") {
      controller = new AbortController();
      signal = controller.signal;
      if (typeof setTimeout !== "undefined") {
        (function(c) {
          setTimeout(function() {
            try {
              c.abort();
            } catch (e) {
            }
          }, ms);
        })(controller);
      }
    }
  } catch (e) {
    controller = null;
  }
  var headers = Object.assign({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-MX,es;q=0.9,en;q=0.8"
  }, options.headers || {});
  var req = { headers, redirect: "follow" };
  if (signal)
    req.signal = signal;
  if (options.method)
    req.method = options.method;
  if (options.body)
    req.body = options.body;
  return fetch(url, Object.assign({}, options, req));
}
function fetchText(url, options, timeout) {
  return fetchWithTimeout(url, options, timeout).then(function(res) {
    if (!res.ok)
      throw new Error("HTTP " + res.status + " for " + url);
    return res.text();
  });
}
function fetchJson(url, options, timeout) {
  return fetchText(url, options, timeout).then(function(raw) {
    return JSON.parse(raw);
  });
}
function fetchWithRetry(url, options, retries, timeout) {
  if (retries === void 0 || retries === null)
    retries = 2;
  return fetchText(url, options, timeout).catch(function(e) {
    if (retries <= 0)
      throw e;
    if (typeof setTimeout === "undefined") {
      return fetchWithRetry(url, options, retries - 1, timeout);
    }
    return new Promise(function(r) {
      setTimeout(r, 1e3);
    }).then(function() {
      return fetchWithRetry(url, options, retries - 1, timeout);
    });
  });
}

// src/shared/quality.js
var KNOWN_QUALITY = {
  vimeos: { h: "720p", n: "480p" },
  goodstream: { x: "1080p", h: "720p", n: "480p", l: "360p" },
  vidhide: { n: "720p", l: "480p" },
  streamwish: { x: "1080p", h: "1080p", n: "720p", l: "480p" },
  voe: { n: "720p", l: "360p" }
};
function getQualityMap(url) {
  if (url.includes("vimeos"))
    return KNOWN_QUALITY.vimeos;
  if (url.includes("goodstream"))
    return KNOWN_QUALITY.goodstream;
  if (url.includes("cloudwindow-route"))
    return KNOWN_QUALITY.voe;
  if (url.includes("minochinos") || url.includes("vidhide") || url.includes("dintezuvio") || url.includes("dramiyos"))
    return KNOWN_QUALITY.vidhide;
  if (url.includes("premilkyway") || url.includes("hlswish") || url.includes("vibuxer") || url.includes("streamwish") || url.includes("harborviewlearninghub") || url.includes("aurorionagency") || url.includes("centaurus") || url.includes("bysedikamoum") || url.includes("filelions") || url.includes("rapidvideo"))
    return KNOWN_QUALITY.streamwish;
  return null;
}
function guessQualityFromUrl(url) {
  if (!url)
    return "Unknown";
  const qmap = getQualityMap(url);
  if (qmap) {
    const m = url.match(/_,([a-z,]+),\.urlset/);
    if (m) {
      const labels = m[1].split(",").filter(Boolean);
      const order = ["x", "o", "h", "n", "l"];
      for (const key of order) {
        if (labels.includes(key) && qmap[key])
          return qmap[key];
      }
    }
  }
  const numMatch = url.match(/[_-](\d{3,4})p/);
  return numMatch ? numMatch[1] + "p" : "Unknown";
}
function detectQualityFromM3U8(url) {
  return __async(this, null, function* () {
    if (typeof setTimeout === "undefined") {
      return guessQualityFromUrl(url);
    }
    var guessed = guessQualityFromUrl(url);
    if (guessed !== "Unknown")
      return guessed;
    try {
      const res = yield fetchWithTimeout(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
      }, 5e3);
      if (!res.ok)
        return guessQualityFromUrl(url);
      const text = yield res.text();
      if (!text.includes("#EXT-X-STREAM-INF")) {
        return guessQualityFromUrl(url);
      }
      let maxH = 0, maxW = 0;
      for (const line of text.split("\n")) {
        const m = line.match(/RESOLUTION=(\d+)x(\d+)/);
        if (m) {
          const h = parseInt(m[2]);
          if (h > maxH) {
            maxH = h;
            maxW = parseInt(m[1]);
          }
        }
      }
      if (maxH >= 2160)
        return "4K";
      if (maxH >= 1080)
        return "1080p";
      if (maxH >= 720)
        return "720p";
      if (maxH >= 480)
        return "480p";
      return maxH > 0 ? `${maxH}p` : guessQualityFromUrl(url);
    } catch (e) {
      return guessQualityFromUrl(url);
    }
  });
}

// src/shared/voe.js
function base64Decode(input) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  let str = input.replace(/=+$/, "");
  let output = "";
  if (str.length % 4 === 1)
    return "";
  for (let i = 0, bc = 0, bs = 0; i < str.length; i++) {
    const char = str.charAt(i);
    const idx = chars.indexOf(char);
    if (idx === -1)
      continue;
    bs = bc % 4 ? bs * 64 + idx : idx;
    if (bc++ % 4) {
      output += String.fromCharCode(255 & bs >> (-2 * bc & 6));
    }
  }
  return output;
}
function rot13(str) {
  return str.replace(
    /[A-Za-z]/g,
    (c) => String.fromCharCode(c.charCodeAt(0) + (c.toUpperCase() <= "M" ? 13 : -13))
  );
}
function charShift(str, shift) {
  return str.split("").map((c) => String.fromCharCode(c.charCodeAt(0) - shift)).join("");
}
function replacePatterns(str) {
  const patterns = ["@$", "^^", "~@", "%?", "*~", "!!", "#&"];
  let res = str;
  for (const p of patterns) {
    res = res.split(p).join("_");
  }
  return res;
}
function decryptVoe(encoded) {
  try {
    let s = rot13(encoded);
    s = replacePatterns(s);
    s = s.split("_").join("");
    let decoded = base64Decode(s);
    if (!decoded)
      return null;
    decoded = charShift(decoded, 3);
    decoded = decoded.split("").reverse().join("");
    decoded = base64Decode(decoded);
    if (!decoded)
      return null;
    return JSON.parse(decoded);
  } catch (e) {
    return null;
  }
}
function extractQuality(url) {
  if (!url)
    return "Unknown";
  const m = url.match(/[_-](\d{3,4})p/);
  return m ? m[1] + "p" : "Unknown";
}
function resolveVoeStream(embedUrl) {
  return __async(this, null, function* () {
    try {
      const html = yield fetchText(embedUrl, {
        headers: {
          Referer: embedUrl,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        }
      });
      let pageText = html;
      if (/permanentToken/i.test(pageText)) {
        const redirectMatch = pageText.match(/window\.location\.href\s*=\s*'([^']+)'/i);
        if (redirectMatch) {
          const redirectRes = yield fetchWithTimeout(redirectMatch[1], {
            headers: { Referer: embedUrl, "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
          });
          if (redirectRes.ok) {
            pageText = yield redirectRes.text();
          }
        }
      }
      const jsonMatch = pageText.match(/<script[^>]*type=['"]application\/json['"][^>]*>\s*\[\s*"([^"]+)"\s*\]\s*<\/script>/i);
      if (!jsonMatch) {
        var re1 = /(?:mp4|hls)'\s*:\s*'([^']+)'/gi;
        var re2 = /(?:mp4|hls)"\s*:\s*"([^"]+)"/gi;
        var m;
        while ((m = re1.exec(pageText)) !== null) {
          var u1 = m[1];
          if (u1.indexOf("aHR0") === 0) {
            try {
              u1 = base64Decode(u1) || u1;
            } catch (e) {
            }
          }
          return { url: u1, quality: extractQuality(u1), headers: { Referer: embedUrl } };
        }
        while ((m = re2.exec(pageText)) !== null) {
          var u2 = m[1];
          if (u2.indexOf("aHR0") === 0) {
            try {
              u2 = base64Decode(u2) || u2;
            } catch (e) {
            }
          }
          return { url: u2, quality: extractQuality(u2), headers: { Referer: embedUrl } };
        }
        return null;
      }
      const encodedStr = jsonMatch[1];
      const decrypted = decryptVoe(encodedStr);
      if (!decrypted)
        return null;
      const directUrl = decrypted.source || decrypted.direct_access_url;
      if (!directUrl)
        return null;
      return { url: directUrl, quality: extractQuality(directUrl), headers: { Referer: embedUrl } };
    } catch (e) {
      return null;
    }
  });
}

// src/shared/embedResolvers.js
var import_crypto_js = __toESM(require("crypto-js"));
function getUrlOrigin(url) {
  if (!url)
    return "";
  const match = url.match(/^(https?:\/\/[^\/]+)/);
  return match ? match[1] : "";
}
function unpackPacked(html) {
  try {
    const pMatch = html.match(/eval\(function\(p,a,c,k,e,[premd]\)\{.*?\}\s*\('([\s\S]*?)',\s*(\d+),\s*(\d+),\s*'([\s\S]*?)'\.split\('\|'\)/);
    if (!pMatch)
      return null;
    let [, p, a, c, k] = pMatch;
    a = parseInt(a, 10);
    c = parseInt(c, 10);
    k = k.split("|");
    const decodeBase36 = (num, rad) => {
      const symbols = "0123456789abcdefghijklmnopqrstuvwxyz";
      let res = "";
      while (num > 0) {
        res = symbols[num % rad] + res;
        num = Math.floor(num / rad);
      }
      return res || "0";
    };
    return p.replace(/\b\w+\b/g, (w) => {
      const idx = parseInt(w, 36);
      return idx < k.length && k[idx] ? k[idx] : decodeBase36(idx, a);
    });
  } catch (e) {
    return null;
  }
}
function normalizeVidHideUrl(url) {
  try {
    if (!url)
      return "";
    let res = url;
    if (!res.includes("/embed/")) {
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
var DOMAIN_MAP = {
  "hglink.to": "vibuxer.com",
  "ghbrisk.com": "vibuxer.com",
  "premilkyway.com": "streamwish.to"
};
function mapDomain(url) {
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
function resolveHLSWishStream(embedUrl) {
  return __async(this, null, function* () {
    try {
      const base = mapDomain(embedUrl);
      const origin0 = getUrlOrigin(base);
      const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Referer: "https://embed69.org/",
        Origin: "https://embed69.org",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-MX,es;q=0.9"
      };
      const candidates = [base];
      const vVariant = base.replace("/e/", "/v/");
      if (vVariant !== base)
        candidates.push(vVariant);
      let html = null;
      let origin = origin0;
      for (const u of candidates) {
        try {
          html = yield fetchWithRetry(u, { headers }, 1);
          origin = getUrlOrigin(u);
          break;
        } catch (e) {
          html = null;
        }
      }
      if (!html)
        return null;
      const fileMatch = html.match(/file\s*:\s*["']([^"']+)["']/i);
      if (fileMatch) {
        let fileUrl = fileMatch[1];
        if (fileUrl.startsWith("/"))
          fileUrl = origin + fileUrl;
        const quality = yield detectQualityFromM3U8(fileUrl);
        return { url: fileUrl, quality, headers: { Referer: origin + "/" } };
      }
      const unpacked = unpackPacked(html);
      if (unpacked) {
        const srcMatch = unpacked.match(/["']([^"']{30,}\.m3u8[^"']*)['"]/i);
        if (srcMatch) {
          let fileUrl = srcMatch[1];
          if (fileUrl.startsWith("/"))
            fileUrl = origin + fileUrl;
          const quality = yield detectQualityFromM3U8(fileUrl);
          return { url: fileUrl, quality, headers: { Referer: origin + "/" } };
        }
      }
      return null;
    } catch (e) {
      return null;
    }
  });
}
function resolveVidHideProStream(embedUrl) {
  return __async(this, null, function* () {
    try {
      const normalizedUrl = normalizeVidHideUrl(embedUrl);
      const origin = getUrlOrigin(normalizedUrl);
      const html = yield fetchWithRetry(normalizedUrl, {
        headers: {
          Referer: "https://embed69.org/",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Sec-Fetch-Dest": "empty",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Site": "cross-site"
        }
      });
      let script = null;
      const packed = unpackPacked(html);
      if (packed) {
        let data = packed;
        if (data.includes("var links")) {
          data = data.substring(data.indexOf("var links"));
        }
        script = data;
      }
      if (!script) {
        const srcMatch = html.match(/<script[^>]*>([\s\S]*?sources:[\s\S]*?)<\/script>/i);
        if (srcMatch)
          script = srcMatch[1];
      }
      if (!script)
        return null;
      const m3u8Regex = /:\s*"([^"]*\.m3u8[^"]*)"/i;
      const m3u8Match = script.match(m3u8Regex);
      if (!m3u8Match)
        return null;
      let url = m3u8Match[1];
      if (url.startsWith("/"))
        url = origin + url;
      if (!url.startsWith("http"))
        url = origin + "/" + url;
      const quality = yield detectQualityFromM3U8(url);
      return { url, quality, headers: { Referer: origin + "/", Origin: origin } };
    } catch (e) {
      return null;
    }
  });
}
function byseB64ToWordArray(s) {
  try {
    var norm2 = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
    while (norm2.length % 4 !== 0)
      norm2 += "=";
    return import_crypto_js.default.enc.Base64.parse(norm2);
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
    if (v >= 1 && v <= 20)
      pair = [v, 31 - v];
    var picked = [];
    for (var i = 0; i < pair.length; i++) {
      var idx = pair[i];
      if (idx >= 1 && idx <= total && parts[idx - 1])
        picked.push(parts[idx - 1]);
    }
    if (picked.length !== pair.length || picked.length === 0)
      return parts;
    return picked;
  } catch (e) {
    return [];
  }
}
function byseDecryptPlayback(playback) {
  try {
    if (!playback || !playback.payload || !playback.iv)
      return null;
    var parts = byseKeyParts(playback);
    if (!parts.length)
      return null;
    var keyHex = "";
    for (var i = 0; i < parts.length; i++) {
      var wa = byseB64ToWordArray(parts[i]);
      if (!wa)
        return null;
      keyHex += wa.toString(import_crypto_js.default.enc.Hex);
    }
    var keyWA = import_crypto_js.default.enc.Hex.parse(keyHex);
    var ivWA = byseB64ToWordArray(playback.iv);
    var fullWA = byseB64ToWordArray(playback.payload);
    if (!keyWA || !ivWA || !fullWA)
      return null;
    var ivHex = ivWA.toString(import_crypto_js.default.enc.Hex);
    if (ivHex.length === 24)
      ivHex = ivHex + "00000002";
    var ctrIv = import_crypto_js.default.enc.Hex.parse(ivHex);
    var fullHex = fullWA.toString(import_crypto_js.default.enc.Hex);
    if (fullHex.length < 32)
      return null;
    var ctHex = fullHex.substring(0, fullHex.length - 32);
    var cipherParams = import_crypto_js.default.lib.CipherParams.create({
      ciphertext: import_crypto_js.default.enc.Hex.parse(ctHex)
    });
    var decrypted = import_crypto_js.default.AES.decrypt(cipherParams, keyWA, {
      iv: ctrIv,
      mode: import_crypto_js.default.mode.CTR,
      padding: import_crypto_js.default.pad.NoPadding
    });
    var plain = decrypted.toString(import_crypto_js.default.enc.Utf8);
    if (!plain || plain.indexOf("{") !== 0)
      return null;
    return JSON.parse(plain);
  } catch (e) {
    return null;
  }
}
function pickBestByseSource(sources) {
  if (!sources || !sources.length)
    return null;
  var best = null;
  var bestScore = -1;
  for (var i = 0; i < sources.length; i++) {
    var s = sources[i] || {};
    var url = s.url || s.file;
    if (typeof url !== "string" || url.indexOf("http") !== 0)
      continue;
    var score = 0;
    var label = String(s.label || "");
    var m = label.match(/(\d{3,4})/);
    if (m)
      score = parseInt(m[1], 10);
    if (url.indexOf(".m3u8") !== -1)
      score += 0.5;
    if (score > bestScore) {
      bestScore = score;
      best = { url, label };
    }
  }
  return best;
}
function resolveFilemoonStream(embedUrl) {
  return __async(this, null, function* () {
    try {
      const m = String(embedUrl || "").match(/\/(?:e|d|v)\/([A-Za-z0-9_-]+)/);
      if (!m)
        return null;
      const code = m[1];
      const origin = getUrlOrigin(embedUrl);
      if (!origin)
        return null;
      try {
        const data = yield fetchJson(origin + "/api/videos/" + code + "/", {
          headers: {
            "Referer": embedUrl,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json,*/*;q=0.8"
          }
        });
        if (data && data.playback && data.playback.payload) {
          const plain = byseDecryptPlayback(data.playback);
          const best = pickBestByseSource(plain && plain.sources);
          if (best) {
            const quality = yield detectQualityFromM3U8(best.url);
            return { url: best.url, quality, headers: { Referer: origin + "/" } };
          }
          return null;
        }
        return null;
      } catch (e) {
        return null;
      }
    } catch (e) {
      return null;
    }
  });
}
function resolveLulusStream(embedUrl) {
  return __async(this, null, function* () {
    try {
      const origin = getUrlOrigin(embedUrl);
      const filecode = embedUrl.replace(/\/+$/, "").split("/").pop();
      if (!filecode)
        return null;
      var bodyStr = "op=embed&file_code=" + encodeURIComponent(filecode) + "&auto=1&referer=" + encodeURIComponent(embedUrl);
      const res = yield fetch(origin + "/dl", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Mozilla/5.0",
          Referer: origin
        },
        body: bodyStr
      });
      if (!res.ok)
        return null;
      const html = yield res.text();
      const scriptMatch = html.match(/<script[^>]*>([\s\S]*?vplayer[\s\S]*?)<\/script>/i);
      if (!scriptMatch)
        return null;
      const fileMatch = scriptMatch[1].match(/file\s*:\s*"([^"]+)"/);
      if (!fileMatch)
        return null;
      let url = fileMatch[1];
      if (url.startsWith("/"))
        url = origin + url;
      return { url, quality: "1080p", headers: { Referer: origin + "/" } };
    } catch (e) {
      return null;
    }
  });
}
function resolveUqloadStream(embedUrl) {
  return __async(this, null, function* () {
    try {
      const origin = getUrlOrigin(embedUrl);
      const html = yield fetchWithRetry(embedUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:151.0) Gecko/20100101 Firefox/151.0",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
          "Upgrade-Insecure-Requests": "1"
        }
      });
      const unpacked = unpackPacked(html);
      if (!unpacked)
        return null;
      const m3u8Match = unpacked.match(/https?:\/\/[^\s"'<>\\]+\.m3u8[^\s"'<>\\]*/i);
      if (m3u8Match) {
        const quality = yield detectQualityFromM3U8(m3u8Match[0]);
        return { url: m3u8Match[0], quality, headers: { Referer: origin + "/", Origin: origin } };
      }
      const mp4Match = unpacked.match(/https?:\/\/[^\s"'<>\\]+\.mp4[^\s"'<>\\]*/i);
      if (mp4Match) {
        return { url: mp4Match[0], quality: "1080p", headers: { Referer: origin + "/", Origin: origin } };
      }
      return null;
    } catch (e) {
      return null;
    }
  });
}
function resolveYourUploadStream(embedUrl) {
  return __async(this, null, function* () {
    try {
      const html = yield fetchWithRetry(embedUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          Referer: "https://www.yourupload.com/"
        }
      });
      const m = html.match(/<meta[^>]*property="og:video"[^>]*content="([^"]+)"/i) || html.match(/(https?:[^"'<>\s]+\.mp4[^"'<>\s]*)/i);
      if (!m)
        return null;
      const url = m[1] || m[0];
      if (url.indexOf("http") !== 0)
        return null;
      return {
        url,
        quality: "720p",
        headers: { Referer: "https://www.yourupload.com/" }
      };
    } catch (e) {
      return null;
    }
  });
}
function extractUrlsetM3U8(html) {
  try {
    if (!html)
      return null;
    html = html.replace(/\\"/g, '"').replace(/\\\//g, "/");
    var m = html.match(/sources\s*:\s*\[\s*\{\s*file\s*:\s*"([^"]+?\.m3u8[^"]*?)"/i);
    var u = m && m[1];
    if (u && u.indexOf("//") === 0)
      u = "https:" + u;
    if (u && u.indexOf("http") === 0)
      return u;
    var unpacked = unpackPacked(html);
    if (unpacked) {
      unpacked = unpacked.replace(/\\"/g, '"').replace(/\\\//g, "/");
      var m2 = unpacked.match(/file\s*:\s*"([^"]+?\.m3u8[^"]*?)"/i) || unpacked.match(/((?:https?:)?\/\/[^"'\s]+\.m3u8[^"'\s]*)/i);
      if (m2) {
        var u2 = m2[1] || m2[0];
        if (u2 && u2.indexOf("//") === 0)
          u2 = "https:" + u2;
        if (u2 && u2.indexOf("http") === 0)
          return u2;
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}
function resolveGoodstreamStream(embedUrl) {
  return __async(this, null, function* () {
    try {
      const origin = getUrlOrigin(embedUrl);
      const html = yield fetchWithRetry(embedUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          Referer: origin + "/"
        }
      }, 1, 12e3);
      const url = extractUrlsetM3U8(html);
      if (!url)
        return null;
      const quality = yield detectQualityFromM3U8(url);
      return { url, quality, headers: { Referer: origin + "/" } };
    } catch (e) {
      return null;
    }
  });
}
function resolveVimeosStream(embedUrl) {
  return __async(this, null, function* () {
    try {
      const origin = getUrlOrigin(embedUrl);
      const html = yield fetchWithRetry(embedUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          Referer: origin + "/"
        }
      }, 1, 12e3);
      const url = extractUrlsetM3U8(html);
      if (!url)
        return null;
      const quality = yield detectQualityFromM3U8(url);
      return { url, quality, headers: { Referer: origin + "/" } };
    } catch (e) {
      return null;
    }
  });
}
function resolveDoodStream(embedUrl) {
  return __async(this, null, function* () {
    try {
      const html = yield fetchWithRetry(embedUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          Referer: embedUrl
        }
      }, 1, 1e4);
      const host = getUrlOrigin(embedUrl);
      const m = html.match(/\/pass_md5\/([\w\-\/.]+)/);
      if (!m)
        return null;
      const res = yield fetchWithTimeout(host + "/pass_md5/" + m[1], {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          Referer: embedUrl
        }
      }, 1e4);
      if (!res.ok)
        return null;
      const url = (yield res.text()).trim();
      if (!url || url.indexOf("http") !== 0)
        return null;
      return { url, quality: "720p", headers: { Referer: host + "/" } };
    } catch (e) {
      return null;
    }
  });
}
function resolveVidaraStream(embedUrl) {
  return __async(this, null, function* () {
    try {
      const origin = getUrlOrigin(embedUrl);
      const code = embedUrl.replace(/\/+$/, "").split("/").pop().split("?")[0];
      if (!code)
        return null;
      const res = yield fetchWithTimeout(origin + "/api/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Referer: embedUrl,
          Origin: origin,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
        },
        body: JSON.stringify({ filecode: code })
      });
      if (!res.ok)
        return null;
      let data;
      try {
        data = JSON.parse(yield res.text());
      } catch (e) {
        return null;
      }
      if (!data || !data.streaming_url)
        return null;
      return {
        url: data.streaming_url,
        quality: "1080p",
        headers: { Referer: origin + "/", Origin: origin }
      };
    } catch (e) {
      return null;
    }
  });
}
function resolveOkRuStream(embedUrl) {
  return __async(this, null, function* () {
    const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
    const HEADERS = {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "es-MX,es;q=0.9,en;q=0.8",
      Referer: "https://ok.ru/"
    };
    function pickBestVideo(videos) {
      if (!videos || !videos.length)
        return null;
      let best = null;
      let bestScore = -1;
      for (let i = 0; i < videos.length; i++) {
        const v = videos[i] || {};
        const url = v.url;
        if (typeof url !== "string" || url.indexOf("http") !== 0)
          continue;
        let score = 0;
        const km = String(v.key || v.name || "").match(/(\d{3,4})/);
        if (km)
          score = parseInt(km[1], 10);
        else if (/hd/i.test(String(v.key)))
          score = 720;
        else if (/sd/i.test(String(v.key)))
          score = 480;
        if (url.indexOf(".m3u8") !== -1)
          score += 0.5;
        if (score > bestScore) {
          bestScore = score;
          best = url;
        }
      }
      return best;
    }
    try {
      const idm = String(embedUrl || "").match(/video(?:embed)?\/(\d+)/) || String(embedUrl || "").match(/(\d{8,})/);
      if (idm) {
        try {
          const meta = yield fetchJson("https://my.mail.ru/+/video/meta/" + idm[1], {
            headers: { "User-Agent": UA, "Referer": "https://my.mail.ru/", "Accept": "application/json,*/*;q=0.8" }
          });
          const best = pickBestVideo(meta && meta.videos);
          if (best) {
            return { url: best, quality: "720p", headers: { Referer: "https://ok.ru/", "User-Agent": UA } };
          }
        } catch (e) {
        }
      }
      const html = yield fetchWithRetry(embedUrl, { headers: HEADERS });
      let m = html.match(/hlsManifestUrl(?:&quot;|"):(?:&quot;|")([^"&]+?)(?:&quot;|")/);
      if (!m)
        return null;
      const url = m[1].replace(/\\u0026/gi, "&").replace(/\\/g, "");
      if (url.indexOf("http") !== 0)
        return null;
      return {
        url,
        quality: "720p",
        headers: {
          Referer: "https://ok.ru/",
          "User-Agent": UA
        }
      };
    } catch (e) {
      return null;
    }
  });
}
function resolveMixdropStream(embedUrl) {
  return __async(this, null, function* () {
    try {
      const html = yield fetchWithRetry(embedUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Referer": embedUrl
        }
      });
      if (!html || html.indexOf("/lander") !== -1)
        return null;
      const unpacked = unpackPacked(html);
      const src = unpacked || html;
      let m = src.match(/MDCore\s*\.\s*wurl\s*=\s*"([^"]+)"/) || src.match(/["']wurl["']\s*:\s*["']([^"']+)["']/) || src.match(/\bwurl\s*=\s*"([^"]+)"/) || src.match(/\bvfile\s*=\s*"([^"]+)"/) || src.match(/["']vfile["']\s*:\s*["']([^"']+)["']/);
      if (!m)
        return null;
      let url = m[1].replace(/\\/g, "");
      if (url.indexOf("//") === 0)
        url = "https:" + url;
      if (url.indexOf("http") !== 0)
        return null;
      return {
        url,
        quality: "HD",
        headers: { Referer: getUrlOrigin(embedUrl) + "/" }
      };
    } catch (e) {
      return null;
    }
  });
}
function resolveMp4uploadStream(embedUrl) {
  return __async(this, null, function* () {
    try {
      const html = yield fetchWithRetry(embedUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Referer": "https://www.mp4upload.com/"
        }
      });
      if (!html)
        return null;
      let m = html.match(/player\.src\(\{\s*type:\s*"video\/mp4",\s*src:\s*"([^"]+)"/) || html.match(/type:\s*"video\/mp4",\s*src:\s*"([^"]+)"/) || html.match(/"src"\s*:\s*"(https?:[^"]+\.mp4[^"]*)"/);
      if (!m)
        return null;
      return {
        url: m[1],
        quality: "HD",
        headers: { Referer: "https://www.mp4upload.com/" }
      };
    } catch (e) {
      return null;
    }
  });
}
function getEmbedResolver(url) {
  if (url.includes("ok.ru")) {
    return resolveOkRuStream;
  }
  if (url.includes("voe.sx") || url.includes("cloudwindow-route.com")) {
    return resolveVoeStream;
  }
  if (url.includes("hlswish") || url.includes("streamwish") || url.includes("vibuxer") || url.includes("strwish") || url.includes("hglink") || url.includes("ghbrisk") || url.includes("premilkyway") || url.includes("hgplaycdn")) {
    return resolveHLSWishStream;
  }
  if (url.includes("vidhide") || url.includes("dintezuvio") || url.includes("minochinos") || url.includes("dramiyos") || url.includes("dhcplay") || url.includes("smoothpre") || url.includes("dhtpre") || url.includes("vidspeeder") || url.includes("moorearn") || url.includes("travid") || url.includes("vidhidehub") || url.includes("vidhidevip") || url.includes("vidhidepre") || url.includes("kinoger") || url.includes("movearnpre") || url.includes("peytonepre") || url.includes("filelions")) {
    return resolveVidHideProStream;
  }
  if (url.includes("byse") || url.includes("filemoon") || url.includes("rapidvideo")) {
    return resolveFilemoonStream;
  }
  if (url.includes("luluvid") || url.includes("lulus") || url.includes("lulu")) {
    return resolveLulusStream;
  }
  if (url.includes("yourupload")) {
    return resolveYourUploadStream;
  }
  if (url.includes("vidara") || url.includes("vidwara")) {
    return resolveVidaraStream;
  }
  if (url.includes("uqload")) {
    return resolveUqloadStream;
  }
  if (url.includes("goodstream")) {
    return resolveGoodstreamStream;
  }
  if (url.includes("vimeos")) {
    return resolveVimeosStream;
  }
  if (url.includes("doodstream") || url.includes("dsvplay") || url.includes("dood.to") || url.includes("dood.watch") || url.includes("dood.so")) {
    return resolveDoodStream;
  }
  if (url.includes("mixdrop")) {
    return resolveMixdropStream;
  }
  if (url.includes("mp4upload")) {
    return resolveMp4uploadStream;
  }
  return null;
}
function getServerLabel(url) {
  if (url.includes("ok.ru"))
    return "OkRu";
  if (url.includes("voe.sx") || url.includes("cloudwindow"))
    return "VOE";
  if (url.includes("streamwish") || url.includes("hlswish") || url.includes("vibuxer") || url.includes("strwish") || url.includes("premilkyway"))
    return "StreamWish";
  if (url.includes("vidhide") || url.includes("dintezuvio") || url.includes("minochinos") || url.includes("dramiyos") || url.includes("dhcplay") || url.includes("smoothpre") || url.includes("dhtpre") || url.includes("vidspeeder") || url.includes("moorearn") || url.includes("travid") || url.includes("vidhidehub") || url.includes("vidhidevip") || url.includes("vidhidepre") || url.includes("kinoger") || url.includes("movearnpre") || url.includes("peytonepre") || url.includes("filelions"))
    return "VidHide";
  if (url.includes("byse") || url.includes("filemoon") || url.includes("rapidvideo"))
    return "FileMoon";
  if (url.includes("luluvid") || url.includes("lulus"))
    return "Lulu";
  if (url.includes("uqload"))
    return "Uqload";
  if (url.includes("goodstream"))
    return "GoodStream";
  if (url.includes("vimeos"))
    return "Vimeos";
  if (url.includes("doodstream") || url.includes("dsvplay") || url.includes("dood."))
    return "Dood";
  if (url.includes("mixdrop"))
    return "Mixdrop";
  if (url.includes("mp4upload"))
    return "Mp4Upload";
  return "Online";
}

// src/latanime/extractor.js
var BASE = "https://latanime.org";
var TMDB_KEY = "439c478a771f35c05022f9feabcca01c";
var MAX_CANDIDATOS = 12;
var MAX_RESOLVER = 8;
var ACCENTS = {
  \u00E1: "a",
  \u00E0: "a",
  \u00E4: "a",
  \u00E2: "a",
  \u00E3: "a",
  \u00E5: "a",
  \u00E9: "e",
  \u00E8: "e",
  \u00EB: "e",
  \u00EA: "e",
  \u00ED: "i",
  \u00EC: "i",
  \u00EF: "i",
  \u00EE: "i",
  \u00F3: "o",
  \u00F2: "o",
  \u00F6: "o",
  \u00F4: "o",
  \u00F5: "o",
  \u00FA: "u",
  \u00F9: "u",
  \u00FC: "u",
  \u00FB: "u",
  \u00F1: "n",
  \u00E7: "c",
  \u00DF: "ss"
};
function sinAcentos(s) {
  var out = "";
  var str = String(s == null ? "" : s).toLowerCase();
  for (var i = 0; i < str.length; i++) {
    var c = str.charAt(i);
    out += ACCENTS[c] != null ? ACCENTS[c] : c;
  }
  return out;
}
function norm(s) {
  return sinAcentos(s).replace(/[^a-z0-9]+/g, " ").replace(/^\s+|\s+$/g, "");
}
function levenshtein(a, b) {
  if (a === b)
    return 0;
  if (!a.length)
    return b.length;
  if (!b.length)
    return a.length;
  var prev = [];
  var cur = [];
  for (var j = 0; j <= b.length; j++)
    prev[j] = j;
  for (var i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (var k = 1; k <= b.length; k++) {
      var coste = a.charAt(i - 1) === b.charAt(k - 1) ? 0 : 1;
      var min = prev[k] + 1;
      if (cur[k - 1] + 1 < min)
        min = cur[k - 1] + 1;
      if (prev[k - 1] + coste < min)
        min = prev[k - 1] + coste;
      cur[k] = min;
    }
    for (var m = 0; m <= b.length; m++)
      prev[m] = cur[m];
  }
  return prev[b.length];
}
function b64decode(input) {
  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  var str = String(input || "").replace(/=+$/, "");
  var output = "";
  if (str.length % 4 === 1)
    return "";
  for (var i = 0, bc = 0, bs = 0; i < str.length; i++) {
    var idx = chars.indexOf(str.charAt(i));
    if (idx === -1)
      continue;
    bs = bc % 4 ? bs * 64 + idx : idx;
    if (bc++ % 4)
      output += String.fromCharCode(255 & bs >> (-2 * bc & 6));
  }
  return output;
}
function tituloDeHtml(html) {
  var m = html.match(/<title>([^<]*)<\/title>/i);
  return m ? m[1] : "";
}
function tmdbTitulos(tmdbId, mediaType) {
  var tipo = mediaType === "movie" ? "movie" : "tv";
  var url = "https://api.themoviedb.org/3/" + tipo + "/" + tmdbId + "?api_key=" + TMDB_KEY + "&language=es-MX";
  return fetchText(url).then(function(raw) {
    var d = null;
    try {
      d = JSON.parse(raw);
    } catch (e) {
      return [];
    }
    var t = [];
    var principal = d.title != null ? d.title : d.name;
    var original = d.original_title != null ? d.original_title : d.original_name;
    if (principal)
      t.push(principal);
    if (original)
      t.push(original);
    return t;
  }).catch(function() {
    return [];
  });
}
function slugDeHref(href) {
  var m = String(href).match(/latanime\.org\/anime\/([a-z0-9-]+)/i);
  return m ? m[1].toLowerCase() : null;
}
function buscar(query) {
  var url = BASE + "/buscar?q=" + encodeURIComponent(query);
  return fetchText(url).then(function(html) {
    var out = [];
    var vistos = {};
    var re = /href="([^"]*\/anime\/[^"]+)"/gi;
    var m;
    while ((m = re.exec(html)) !== null) {
      var slug = slugDeHref(m[1]);
      if (slug && !vistos[slug]) {
        vistos[slug] = true;
        out.push(slug);
      }
    }
    return out;
  }).catch(function() {
    return [];
  });
}
function puntuar(slug, titulos) {
  var s = norm(slug);
  var mejor = 0;
  for (var i = 0; i < titulos.length; i++) {
    var t = norm(titulos[i]);
    if (!t)
      continue;
    if (s === t)
      return 1;
    var base = s.replace(/\s+(latino|castellano|subtitulado)$/, "");
    var baseJunto = base.replace(/\s+/g, "");
    if (base === t || baseJunto === t.replace(/\s+/g, ""))
      return 0.98;
    var tokens = t.split(" ").filter(function(w) {
      return w.length > 2 || /^\d+$/.test(w);
    });
    if (tokens.length) {
      var dentro = 0;
      for (var k = 0; k < tokens.length; k++) {
        if (s.indexOf(tokens[k]) >= 0)
          dentro++;
        else {
          var partes = s.split(" ");
          for (var p = 0; p < partes.length; p++) {
            if (partes[p].length > 1 && levenshtein(partes[p], tokens[k]) <= 1) {
              dentro++;
              break;
            }
          }
        }
      }
      var cobertura = dentro / tokens.length;
      var exacto = base.charAt(0) === t.charAt(0) && base.indexOf(t) === 0;
      var sc = cobertura * (exacto ? 1 : 0.9);
      var palabras = base.split(" ").filter(function(w) {
        return w.length > 2 || /^\d+$/.test(w);
      });
      var extras = 0;
      for (var q = 0; q < palabras.length; q++) {
        var w2 = palabras[q];
        var conocida = false;
        for (var j = 0; j < tokens.length; j++) {
          if (tokens[j] === w2 || tokens[j].indexOf(w2) >= 0 || w2.indexOf(tokens[j]) >= 0 || levenshtein(w2, tokens[j]) <= 1) {
            conocida = true;
            break;
          }
        }
        if (!conocida)
          extras++;
      }
      if (extras)
        sc *= 0.4;
      if (sc > mejor)
        mejor = sc;
    }
  }
  return mejor;
}
function temporadaDeSlug(slug) {
  var m = slug.match(/(?:-s|-temporada-|-season-)(\d{1,2})(?:-|$)/);
  return m ? parseInt(m[1], 10) : 1;
}
function esCastellano(slug) {
  return /castellano|espanol|español/.test(slug);
}
function esLatino(slug) {
  return /latino/.test(slug);
}
function extraerEmbeds(html) {
  var out = [];
  var vistos = {};
  var re = /data-player="([^"]+)"/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    var url = b64decode(m[1]).replace(/\s+$/g, "");
    if (url.indexOf("http") !== 0) {
      var raw = m[1];
      if (raw.indexOf("http") === 0)
        url = raw;
      else
        continue;
    }
    if (!vistos[url]) {
      vistos[url] = true;
      out.push(url);
    }
  }
  return out;
}
function hostsAEmitir(embeds) {
  return embeds.filter(function(u) {
    return u.indexOf("mega.nz") < 0;
  });
}
function resolverEmbed(embed) {
  var resolver = null;
  try {
    resolver = getEmbedResolver(embed);
  } catch (e) {
    resolver = null;
  }
  if (typeof resolver !== "function")
    return Promise.resolve(null);
  return Promise.resolve().then(function() {
    return resolver(embed);
  }).then(function(r) {
    if (r && r.url)
      return r;
    return null;
  }).catch(function() {
    return null;
  });
}
function elegirCandidato(slugs, titulos, temporada) {
  var orden = [];
  for (var i = 0; i < slugs.length; i++) {
    if (esCastellano(slugs[i]))
      continue;
    var sc = puntuar(slugs[i], titulos);
    if (sc < 0.45)
      continue;
    var temporadaSlug = temporadaDeSlug(slugs[i]);
    var bonusTemporada = temporadaSlug === temporada ? 0.2 : temporadaSlug === 1 && temporada === 1 ? 0.1 : 0;
    var bonusLatino = esLatino(slugs[i]) ? 0.15 : 0;
    orden.push({
      slug: slugs[i],
      score: sc + bonusTemporada + bonusLatino,
      titulo: sc,
      temporada: temporadaSlug,
      latino: esLatino(slugs[i])
    });
  }
  orden.sort(function(a, b) {
    return b.score - a.score;
  });
  return orden.slice(0, MAX_CANDIDATOS);
}
function confirmarLatino(candidatos) {
  var aRevisar = candidatos.filter(function(c) {
    return !c.latino;
  });
  if (!aRevisar.length)
    return Promise.resolve(candidatos);
  return Promise.all(
    aRevisar.map(function(c) {
      return fetchText(BASE + "/anime/" + c.slug).then(function(html) {
        var t = tituloDeHtml(html);
        c.confirmado = /latino/i.test(t) && !/castellano/i.test(t);
      }).catch(function() {
        c.confirmado = false;
      });
    })
  ).then(function() {
    var ok = candidatos.filter(function(c) {
      return c.latino || c.confirmado;
    });
    return ok;
  });
}
function extraerEpisodio(slug, episodio) {
  var url = BASE + "/ver/" + slug + "-episodio-" + episodio;
  return fetchText(url).then(function(html) {
    return { url, embeds: extraerEmbeds(html) };
  }).catch(function() {
    return null;
  });
}
function extraer(tmdbId, mediaType, season, episode) {
  return __async(this, null, function* () {
    var tipo = String(mediaType || "").toLowerCase();
    if (tipo === "movie")
      return [];
    var temporada = parseInt(season, 10);
    if (isNaN(temporada) || temporada < 1)
      temporada = 1;
    var ep = parseInt(episode, 10);
    if (isNaN(ep) || ep < 1)
      ep = 1;
    var titulos = yield tmdbTitulos(tmdbId, tipo);
    if (!titulos.length)
      return [];
    var queries = [titulos[0]];
    var palabras = norm(titulos[0]).split(" ").filter(function(w) {
      return w.length > 3 && ["temporada", "season", "parte", "the", "los", "las"].indexOf(w) < 0;
    });
    if (palabras.length) {
      palabras.sort(function(a, b) {
        return b.length - a.length;
      });
      queries.push(palabras[0]);
      if (palabras.length === 1 && palabras[0].length >= 6) {
        for (var L = 6; L >= 4; L--)
          queries.push(palabras[0].slice(0, L));
      }
    }
    var slugs = [];
    var vistos = {};
    for (var q = 0; q < queries.length; q++) {
      var encontrados = yield buscar(queries[q]);
      for (var i = 0; i < encontrados.length; i++) {
        if (!vistos[encontrados[i]]) {
          vistos[encontrados[i]] = true;
          slugs.push(encontrados[i]);
        }
      }
      if (slugs.length >= 6)
        break;
    }
    if (!slugs.length)
      return [];
    var candidatos = elegirCandidato(slugs, titulos, temporada);
    if (!candidatos.length)
      return [];
    candidatos = yield confirmarLatino(candidatos);
    var episodio = null;
    for (var c = 0; c < candidatos.length; c++) {
      var encontrado = yield extraerEpisodio(candidatos[c].slug, ep);
      if (encontrado && encontrado.embeds.length) {
        episodio = encontrado;
        episodio.slug = candidatos[c].slug;
        break;
      }
    }
    if (!episodio)
      return [];
    var embeds = hostsAEmitir(episodio.embeds).slice(0, MAX_RESOLVER);
    var resueltos = yield Promise.all(embeds.map(resolverEmbed));
    var streams = [];
    var yaEsta = {};
    for (var r = 0; r < embeds.length; r++) {
      if (resueltos[r] && resueltos[r].url) {
        if (yaEsta[resueltos[r].url])
          continue;
        yaEsta[resueltos[r].url] = true;
        streams.push({
          title: getServerLabel(embeds[r]) + " \xB7 Latino",
          quality: resueltos[r].quality || "HD",
          language: "Latino",
          url: resueltos[r].url,
          headers: resueltos[r].headers || { Referer: BASE + "/" }
        });
      }
    }
    for (var e2 = 0; e2 < embeds.length; e2++) {
      if (resueltos[e2] && resueltos[e2].url)
        continue;
      streams.push({
        title: getServerLabel(embeds[e2]) + " \xB7 Latino (embed)",
        quality: "HD",
        language: "Latino",
        url: embeds[e2],
        headers: { Referer: BASE + "/" }
      });
    }
    return streams;
  });
}

// src/shared/validate.js
var VALIDATE_TIMEOUT_MS = 7e3;
var VALIDATE_CONCURRENCY = 4;
function qualityRank(q) {
  if (!q)
    return 0;
  var s = String(q).toLowerCase();
  if (s.indexOf("4k") !== -1 || s.indexOf("2160") !== -1)
    return 2160;
  var m = s.match(/(\d{3,4})\s*p/);
  if (m)
    return parseInt(m[1], 10);
  return 0;
}
function isM3u8(url) {
  return /\.m3u8(\?|#|$)/i.test(url || "");
}
function hasVideoExtension(url) {
  return /\.(mp4|m3u8|mkv|webm|ts|m4v|mov)(\?|#|$)/i.test(url || "");
}
function isVideoResponse(contentType, url) {
  var ct = "";
  try {
    ct = String(contentType || "").toLowerCase().split(";")[0].trim();
  } catch (e) {
    ct = "";
  }
  if (ct.indexOf("video/") === 0)
    return true;
  if (ct === "application/vnd.apple.mpegurl" || ct === "application/x-mpegurl")
    return true;
  if (ct === "application/octet-stream" || ct === "binary/octet-stream") {
    return hasVideoExtension(url);
  }
  if (!ct) {
    return hasVideoExtension(url);
  }
  return false;
}
function getContentType(res) {
  try {
    if (res && res.headers && typeof res.headers.get === "function") {
      return res.headers.get("content-type");
    }
  } catch (e) {
  }
  return "";
}
function checkUrl(url, headers, timeoutMs) {
  return new Promise(function(resolve) {
    var done = false;
    var timer = null;
    var controller = null;
    function finish(ok) {
      if (done)
        return;
      done = true;
      if (timer) {
        try {
          clearTimeout(timer);
        } catch (e) {
        }
        timer = null;
      }
      if (controller) {
        try {
          controller.abort();
        } catch (e) {
        }
      }
      resolve(!!ok);
    }
    if (!url || typeof url !== "string" || url.indexOf("http") !== 0) {
      resolve(false);
      return;
    }
    if (typeof setTimeout !== "undefined") {
      timer = setTimeout(function() {
        timer = null;
        finish(false);
      }, timeoutMs || VALIDATE_TIMEOUT_MS);
    }
    var reqHeaders = {
      "Range": "bytes=0-2047",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    };
    if (headers) {
      for (var k in headers) {
        if (Object.prototype.hasOwnProperty.call(headers, k) && headers[k]) {
          reqHeaders[k] = headers[k];
        }
      }
    }
    var reqInit = { headers: reqHeaders, redirect: "follow" };
    try {
      if (typeof AbortController !== "undefined") {
        controller = new AbortController();
        reqInit.signal = controller.signal;
      }
    } catch (e) {
      controller = null;
    }
    fetch(url, reqInit).then(function(res) {
      var status = res.status;
      if (status === 200 || status === 206 || status === 416) {
        if (isM3u8(url)) {
          res.text().then(function(t) {
            finish(t && t.indexOf("#EXTM3U") !== -1);
          }).catch(function() {
            finish(true);
          });
        } else if (status === 416) {
          finish(true);
        } else if (!isVideoResponse(getContentType(res), url)) {
          try {
            if (controller)
              controller.abort();
          } catch (e) {
          }
          finish(false);
        } else {
          finish(true);
        }
      } else {
        finish(false);
      }
    }).catch(function() {
      finish(false);
    });
  });
}
function filterWorkingStreams(streams, opts) {
  opts = opts || {};
  var timeout = opts.timeoutMs || VALIDATE_TIMEOUT_MS;
  var concurrency = opts.concurrency || VALIDATE_CONCURRENCY;
  var seen = {};
  var uniq = [];
  (streams || []).forEach(function(s) {
    if (!s || !s.url || seen[s.url])
      return;
    seen[s.url] = 1;
    uniq.push(s);
  });
  if (uniq.length === 0)
    return Promise.resolve([]);
  var results = new Array(uniq.length);
  var cursor = 0;
  function worker() {
    if (cursor >= uniq.length)
      return Promise.resolve();
    var i = cursor++;
    var st = uniq[i];
    return checkUrl(st.url, st.headers, timeout).then(function(ok) {
      results[i] = ok ? st : null;
    }).catch(function() {
      results[i] = null;
    }).then(worker);
  }
  var workers = [];
  var n = Math.min(concurrency, uniq.length);
  for (var w = 0; w < n; w++)
    workers.push(worker());
  return Promise.all(workers).then(function() {
    var alive = [];
    for (var i = 0; i < results.length; i++) {
      if (results[i])
        alive.push(results[i]);
    }
    alive.sort(function(a, b) {
      return qualityRank(b.quality) - qualityRank(a.quality);
    });
    return alive;
  }).catch(function() {
    return [];
  });
}
function withWorkingStreams(extractPromise) {
  return Promise.resolve(extractPromise).then(function(streams) {
    return filterWorkingStreams(streams);
  }).catch(function() {
    return [];
  });
}

// src/latanime/index.js
function withTimeout(promise, ms) {
  if (typeof setTimeout === "undefined")
    return promise;
  return Promise.race([
    promise,
    new Promise(function(res) {
      setTimeout(function() {
        res([]);
      }, ms);
    })
  ]);
}
function getStreams(tmdbId, mediaType, season, episode) {
  var tipo = String(mediaType || "").toLowerCase();
  if (tipo === "movie")
    return Promise.resolve([]);
  return withWorkingStreams(withTimeout(
    extraer(tmdbId, tipo, season, episode).catch(function() {
      return [];
    }),
    45e3
  ));
}
module.exports = { getStreams };
