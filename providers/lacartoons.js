/**
 * lacartoons - Built from src/lacartoons/
 * Generated: 2026-09-23T17:03:40.340Z
 */
var __create = Object.create;
var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
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
var FETCH_TIMEOUT = 2e4;
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
function resolveFilemoonStream(embedUrl) {
  return __async(this, null, function* () {
    try {
      const defaultHeaders = {
        "Referer": embedUrl,
        "Sec-Fetch-Dest": "iframe",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "cross-site",
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:137.0) Gecko/20100101 Firefox/137.0"
      };
      const initialResponse = yield fetchWithRetry(embedUrl, {
        headers: __spreadProps(__spreadValues({}, defaultHeaders), { Referer: "https://embed69.org/" })
      });
      const iframeSrc = initialResponse.match(/<iframe[^>]*src=["']([^"']+)["']/i);
      if (iframeSrc) {
        let iframeUrl = iframeSrc[1];
        if (!iframeUrl.startsWith("http")) {
          iframeUrl = getUrlOrigin(embedUrl) + iframeUrl;
        }
        const iframeHtml = yield fetchWithRetry(iframeUrl, {
          headers: __spreadProps(__spreadValues({}, defaultHeaders), { "Accept-Language": "en-US,en;q=0.5", Referer: embedUrl })
        });
        const unpacked2 = unpackPacked(iframeHtml);
        if (unpacked2) {
          const videoMatch = unpacked2.match(/sources:\s*\[\s*\{\s*file\s*:\s*"([^"]+)"/i);
          if (videoMatch) {
            let url = videoMatch[1];
            if (!url.startsWith("http"))
              url = getUrlOrigin(iframeUrl) + url;
            const quality = yield detectQualityFromM3U8(url);
            return { url, quality, headers: { Referer: getUrlOrigin(iframeUrl) + "/" } };
          }
        }
        return null;
      }
      const unpacked = unpackPacked(initialResponse);
      if (unpacked) {
        const videoMatch = unpacked.match(/sources:\s*\[\s*\{\s*file\s*:\s*"([^"]+)"/i);
        if (videoMatch) {
          let url = videoMatch[1];
          if (!url.startsWith("http"))
            url = getUrlOrigin(embedUrl) + url;
          const quality = yield detectQualityFromM3U8(url);
          return { url, quality, headers: { Referer: getUrlOrigin(embedUrl) + "/" } };
        }
      }
      return null;
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
    try {
      const html = yield fetchWithRetry(embedUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "es-MX,es;q=0.9,en;q=0.8",
          Referer: "https://ok.ru/"
        }
      });
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
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
        }
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
  return null;
}

// src/shared/rpmvid.js
var import_crypto_js = __toESM(require("crypto-js"));
var EMBED_ORIGIN = "https://cubeembed.rpmvid.com";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36";
var cryptoFactoryCache = null;
function bytesToHex(bytes) {
  var hex = "";
  for (var i = 0; i < bytes.length; i++) {
    var h = bytes[i].toString(16);
    if (h.length === 1)
      h = "0" + h;
    hex += h;
  }
  return hex;
}
function utf8Encode(s) {
  var out = [];
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c >= 55296 && c <= 56319 && i + 1 < s.length) {
      var lo = s.charCodeAt(i + 1);
      if (lo >= 56320 && lo <= 57343) {
        c = 65536 + (c - 55296 << 10) + (lo - 56320);
        i++;
      }
    }
    if (c < 128)
      out.push(c);
    else if (c < 2048)
      out.push(192 | c >> 6, 128 | c & 63);
    else if (c < 65536)
      out.push(224 | c >> 12, 128 | c >> 6 & 63, 128 | c & 63);
    else
      out.push(240 | c >> 18, 128 | c >> 12 & 63, 128 | c >> 6 & 63, 128 | c & 63);
  }
  return new Uint8Array(out);
}
function TEPoly() {
}
TEPoly.prototype.encode = function(s) {
  return utf8Encode(s);
};
function buildWindowMock(hash) {
  return {
    location: {
      protocol: "https:",
      hash: "#" + hash,
      href: EMBED_ORIGIN + "/#" + hash
    },
    screen: { width: 1280, height: 720 },
    innerWidth: 1280,
    innerHeight: 720,
    TextEncoder: TEPoly,
    TextDecoder: TEPoly
  };
}
function loadCryptoFactory() {
  return __async(this, null, function* () {
    if (cryptoFactoryCache)
      return cryptoFactoryCache;
    var html = yield fetchText(EMBED_ORIGIN + "/", { headers: { "User-Agent": UA } });
    var scriptMatch = html.match(/src="(\/assets\/index-[a-zA-Z0-9_-]+\.js)"/);
    if (!scriptMatch)
      throw new Error("cubeembed player script not found");
    var js = yield fetchText(EMBED_ORIGIN + scriptMatch[1], {
      headers: { "User-Agent": UA, Referer: EMBED_ORIGIN + "/" }
    });
    var vaStart = js.indexOf("function Va(){");
    if (vaStart === -1)
      throw new Error("Va table not found");
    var feSrc = "function fe(s,e){return s=s-120,Va()[s]}";
    var feIdx = js.indexOf(feSrc, vaStart);
    if (feIdx === -1)
      throw new Error("fe decoder not found");
    var vaBlock = js.slice(vaStart, feIdx) + feSrc;
    var shuffleMatch = js.match(/\(function\(s,e\)\{const t=fe[\s\S]*?\}\)\(Va,\d+\);/);
    if (!shuffleMatch)
      throw new Error("table shuffle not found");
    var hStart = js.indexOf("P=x=>{const p=fe;return new Uint8Array");
    if (hStart === -1)
      throw new Error("crypto helpers not found");
    var kIdx = js.indexOf(",K=async", hStart);
    if (kIdx === -1)
      throw new Error("crypto helpers end not found");
    var helpersBlock = "var " + js.slice(hStart, kIdx) + ";";
    var src = vaBlock + "\n" + shuffleMatch[0] + "\n" + helpersBlock + "\nreturn {Q:Q,se:se};";
    cryptoFactoryCache = new Function("window", src);
    return cryptoFactoryCache;
  });
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
  var keyWA = import_crypto_js.default.enc.Hex.parse(bytesToHex(d.key));
  var ivWA = import_crypto_js.default.enc.Hex.parse(bytesToHex(d.iv));
  var cipherParams = import_crypto_js.default.lib.CipherParams.create({ ciphertext: import_crypto_js.default.enc.Hex.parse(hex.trim()) });
  var decrypted = import_crypto_js.default.AES.decrypt(cipherParams, keyWA, { iv: ivWA, mode: import_crypto_js.default.mode.CBC, padding: import_crypto_js.default.pad.Pkcs7 });
  var plain = decrypted.toString(import_crypto_js.default.enc.Utf8);
  if (!plain)
    throw new Error("empty decrypt");
  return JSON.parse(plain);
}
function videoIdFromIframe(iframeSrc) {
  try {
    if (!iframeSrc)
      return null;
    if (iframeSrc.indexOf("#") !== -1) {
      var parts = iframeSrc.split("#")[1];
      if (parts && parts.indexOf("&") !== -1)
        parts = parts.split("&")[0];
      if (parts && parts.length > 1)
        return parts;
    }
    var u = new URL(iframeSrc);
    if (u.hostname.indexOf("rpmvid") === -1 && u.hostname.indexOf("cubeembed") === -1)
      return null;
    var id = u.searchParams.get("id");
    if (!id)
      id = (u.hash || "").replace(/^#/, "");
    if (id && id.indexOf("&") !== -1)
      id = id.split("&")[0];
    return id && id.length > 1 ? id : null;
  } catch (e) {
    if (typeof iframeSrc === "string" && iframeSrc.indexOf("#") !== -1) {
      var p = iframeSrc.split("#")[1];
      if (p && p.indexOf("&") !== -1)
        p = p.split("&")[0];
      return p && p.length > 1 ? p : null;
    }
    return null;
  }
}
function isRpmvidIframe(iframeSrc) {
  if (!iframeSrc)
    return false;
  return iframeSrc.indexOf("rpmvid") !== -1 || iframeSrc.indexOf("cubeembed") !== -1;
}
function collectHlsUrls(data) {
  var urls = [];
  var origin = EMBED_ORIGIN;
  if (data.source && data.source.indexOf(".m3u8") !== -1)
    urls.push(data.source);
  if (data.cfNative && data.cfNative.indexOf(".m3u8") !== -1)
    urls.push(data.cfNative);
  if (data.hlsVideoTiktok) {
    var rel = data.hlsVideoTiktok.indexOf("http") === 0 ? data.hlsVideoTiktok : origin + data.hlsVideoTiktok;
    urls.push(rel);
  }
  if (data.videoUrl && data.videoUrl.indexOf(".m3u8") !== -1)
    urls.push(data.videoUrl);
  var seen = {};
  var out = [];
  for (var i = 0; i < urls.length; i++) {
    if (!seen[urls[i]]) {
      seen[urls[i]] = 1;
      out.push(urls[i]);
    }
  }
  return out;
}
function fetchVideoData(hash) {
  return __async(this, null, function* () {
    yield loadCryptoFactory();
    var url = EMBED_ORIGIN + "/api/v1/video?id=" + encodeURIComponent(hash) + "&w=1280&h=720&r=lacartoons.com";
    var hex = yield fetchText(url, {
      headers: { Referer: EMBED_ORIGIN + "/", Origin: EMBED_ORIGIN, "User-Agent": UA }
    });
    if (!/^[0-9a-f]+$/i.test(String(hex).trim()))
      throw new Error("rpmvid not hex");
    return decryptHex(hex, hash);
  });
}
function resolveRpmvidStream(iframeSrc) {
  return __async(this, null, function* () {
    try {
      var hash = videoIdFromIframe(iframeSrc);
      if (!hash)
        return null;
      var data = yield fetchVideoData(hash);
      var urls = collectHlsUrls(data);
      if (!urls.length)
        return null;
      var best = urls[0];
      return { url: best, quality: "720p", headers: { Referer: EMBED_ORIGIN + "/", Origin: EMBED_ORIGIN } };
    } catch (e) {
      return null;
    }
  });
}

// src/lacartoons/extractor.js
var TMDB_API_KEY = "1f54bd990f1cdfb230adb312546d765d";
var BASE_URL = "https://www.lacartoons.com";
var ACCENT_MAP = { "\xE1": "a", "\xE9": "e", "\xED": "i", "\xF3": "o", "\xFA": "u", "\xFC": "u", "\xF1": "n", "\xC1": "a", "\xC9": "a", "\xCD": "i", "\xD3": "o", "\xDA": "u", "\xDC": "u", "\xD1": "n", "\xE0": "a", "\xE8": "e", "\xEC": "i", "\xF2": "o", "\xF9": "u", "\xE2": "a", "\xEA": "e", "\xEE": "i", "\xF4": "o", "\xFB": "u", "\xE4": "a", "\xEB": "e", "\xEF": "i", "\xF6": "o", "\xE7": "c", "\xE3": "a", "\xF5": "o" };
function stripAccents(s) {
  return (s || "").replace(/[^\x00-\x7F]/g, function(c) {
    return ACCENT_MAP[c] || "";
  });
}
function normalizeText(text) {
  if (!text)
    return "";
  return stripAccents(text.toLowerCase()).replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
}
function getMediaTitle(tmdbId, tmdbType) {
  var url = "https://api.themoviedb.org/3/" + tmdbType + "/" + tmdbId + "?api_key=" + TMDB_API_KEY + "&language=es-MX";
  return fetchJson(url).then(function(data) {
    var isMovie = tmdbType === "movie";
    var date = isMovie ? data.release_date : data.first_air_date;
    return {
      title: isMovie ? data.title : data.name,
      originalTitle: isMovie ? data.original_title : data.original_name,
      year: date && date.length >= 4 ? date.slice(0, 4) : null
    };
  });
}
function searchSite(query) {
  var url = BASE_URL + "/?Titulo=" + encodeURIComponent(query);
  return fetchText(url, { headers: { Referer: BASE_URL + "/" } }).then(function(html) {
    var out = [];
    var re = /<a[^>]*href="\/serie\/(\d+)"[^>]*>[\s\S]*?<p[^>]*class="[^"]*nombre-serie[^"]*"[^>]*>([^<]+)<\/p>/gi;
    var m;
    while ((m = re.exec(html)) !== null) {
      var id = m[1];
      var title = m[2].replace(/<[^>]*>/g, "").trim();
      if (!id || !title)
        continue;
      out.push({ id, title, href: BASE_URL + "/serie/" + id });
    }
    if (out.length === 0) {
      var re2 = /<a[^>]*href="\/serie\/(\d+)"[^>]*>[\s\S]*?<\/a>/gi;
      var seen = {};
      while ((m = re2.exec(html)) !== null) {
        var id2 = m[1];
        if (seen[id2])
          continue;
        seen[id2] = 1;
        var snippet = html.slice(m.index, m.index + 800);
        var tm = snippet.match(/nombre-serie[^>]*>([^<]+)</i);
        var t = tm ? tm[1].trim() : "Serie " + id2;
        out.push({ id: id2, title: t, href: BASE_URL + "/serie/" + id2 });
      }
    }
    return out;
  }).catch(function() {
    return [];
  });
}
function pickBest(cands, media) {
  var no = normalizeText(media.originalTitle || "");
  var nt = normalizeText(media.title || "");
  var best = null, bestScore = -1;
  for (var i = 0; i < cands.length; i++) {
    var c = cands[i];
    var nc = normalizeText(c.title);
    var score = 0;
    if (nc === no || nc === nt)
      score = 100;
    else if (no && (nc.indexOf(no) !== -1 || no.indexOf(nc) !== -1) || nt && (nc.indexOf(nt) !== -1 || nt.indexOf(nc) !== -1))
      score = 80;
    if (score === 0) {
      var words = (no + " " + nt).split(" ").filter(function(w2) {
        return w2.length >= 3;
      });
      var qm = 0;
      for (var w = 0; w < words.length; w++)
        if (nc.indexOf(words[w]) !== -1)
          qm++;
      if (qm === 0)
        continue;
      score = qm * 15;
    }
    if (media.year && c.title.indexOf(media.year) !== -1)
      score += 5;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  if (!best || bestScore < 10)
    return null;
  return best;
}
function extractEpisodeUrl(serieHtml, season, episode) {
  season = parseInt(season, 10) || 1;
  episode = parseInt(episode, 10) || 1;
  var temporadaRe = /<h4[^>]*data-temporada-id="(\d+)"[^>]*>[\s\S]*?<\/h4>([\s\S]*?)(?=<h4[^>]*data-temporada-id=|<\/section>)/gi;
  var m;
  var found = null;
  while ((m = temporadaRe.exec(serieHtml)) !== null) {
    var tid = parseInt(m[1], 10);
    var block = m[2];
    var epRe = /<a[^>]*href="(\/serie\/capitulo\/[^"]+)"[^>]*>/gi;
    var links = [];
    var em;
    while ((em = epRe.exec(block)) !== null) {
      var href = em[1];
      href = href.replace(/&amp;/g, "&");
      if (href.indexOf("/serie/capitulo/") === 0)
        links.push(href);
    }
    if (tid === season) {
      if (episode >= 1 && episode <= links.length)
        return links[episode - 1];
      return null;
    }
    if (!found)
      found = links;
  }
  if (!found) {
    var flatRe = /<a[^>]*href="(\/serie\/capitulo\/[^"]+)"[^>]*>/gi;
    var flat = [];
    while ((m = flatRe.exec(serieHtml)) !== null) {
      var h = m[1].replace(/&amp;/g, "&");
      flat.push(h);
    }
    var idx = episode - 1;
    if (season === 1 && flat[idx])
      return flat[idx];
    if (flat[idx])
      return flat[idx];
  }
  return null;
}
function extractIframeSrc(capituloHtml) {
  var m = capituloHtml.match(/<iframe[^>]*src="([^"]+)"[^>]*>/i);
  if (m)
    return m[1].replace(/&amp;/g, "&");
  var m2 = capituloHtml.match(/https?:\/\/[^"']*rpmvid[^"']*/i);
  if (m2)
    return m2[0];
  var m3 = capituloHtml.match(/https?:\/\/[^"']*cubeembed[^"']*/i);
  if (m3)
    return m3[0];
  return null;
}
function extractStreams(tmdbId, mediaType, season, episode) {
  var tmdbType = mediaType === "tv" || mediaType === "series" || mediaType === "anime" ? "tv" : "movie";
  if (tmdbType === "movie")
    return Promise.resolve([]);
  season = parseInt(season, 10) || 1;
  episode = parseInt(episode, 10) || 1;
  return getMediaTitle(tmdbId, tmdbType).then(function(media) {
    var queries = [];
    if (media.originalTitle)
      queries.push(media.originalTitle);
    if (media.title && media.title !== media.originalTitle)
      queries.push(media.title);
    if (!queries.length)
      return [];
    var all = [];
    var chain = Promise.resolve();
    queries.forEach(function(q) {
      chain = chain.then(function() {
        return searchSite(q).then(function(c) {
          all = all.concat(c);
        });
      });
    });
    return chain.then(function() {
      if (all.length > 0)
        return all;
      var STOPWORDS = { y: 1, de: 1, la: 1, el: 1, los: 1, las: 1, un: 1, una: 1, del: 1, al: 1, e: 1, u: 1, o: 1, en: 1, con: 1, por: 1, para: 1, the: 1, a: 1, an: 1, of: 1, and: 1, to: 1, in: 1, on: 1, vs: 1 };
      var allText = normalizeText((media.originalTitle || "") + " " + (media.title || ""));
      var words = allText.split(" ").filter(function(w) {
        return w.length >= 3 && !STOPWORDS[w];
      });
      var unique = {};
      var keywords = [];
      for (var i = 0; i < words.length; i++) {
        if (!unique[words[i]]) {
          unique[words[i]] = 1;
          keywords.push(words[i]);
        }
      }
      keywords.sort(function(a, b) {
        return b.length - a.length;
      });
      keywords = keywords.slice(0, 3);
      if (!keywords.length)
        return all;
      var kChain = Promise.resolve();
      keywords.forEach(function(kw) {
        kChain = kChain.then(function() {
          return searchSite(kw).then(function(c) {
            all = all.concat(c);
          });
        });
      });
      return kChain.then(function() {
        return all;
      });
    }).then(function(cands) {
      var best = pickBest(cands, media);
      if (!best)
        return [];
      return fetchText(best.href, { headers: { Referer: BASE_URL + "/" } }).then(function(serieHtml) {
        var epPath = extractEpisodeUrl(serieHtml, season, episode);
        if (!epPath)
          return [];
        var epUrl = epPath.indexOf("http") === 0 ? epPath : BASE_URL + epPath;
        return fetchText(epUrl, { headers: { Referer: best.href } }).then(function(capHtml) {
          var iframeSrc = extractIframeSrc(capHtml);
          if (!iframeSrc)
            return [];
          if (iframeSrc.indexOf("//") === 0)
            iframeSrc = "https:" + iframeSrc;
          if (iframeSrc.indexOf("http") !== 0) {
            if (iframeSrc.indexOf("/") === 0)
              iframeSrc = "https://cubeembed.rpmvid.com" + iframeSrc;
            else
              iframeSrc = "https://" + iframeSrc;
          }
          if (isRpmvidIframe(iframeSrc)) {
            return resolveRpmvidStream(iframeSrc).then(function(r) {
              if (r && r.url) {
                return [{ name: "LaCartoons (Rpmvid)", title: (r.quality || "720p") + " \xB7 LAT \xB7 Rpmvid S" + season + "E" + episode, url: r.url, quality: r.quality || "720p", headers: r.headers }];
              }
              return [];
            }).catch(function() {
              return [];
            });
          }
          var fixed = iframeSrc;
          try {
            fixed = decodeURIComponent(fixed);
          } catch (e) {
          }
          var resolver = getEmbedResolver(fixed);
          if (!resolver)
            return [];
          return resolver(fixed).then(function(r) {
            if (r && r.url) {
              var host = "";
              try {
                host = fixed.split("/")[2];
              } catch (e) {
              }
              return [{ name: "LaCartoons (" + host + ")", title: (r.quality || "HD") + " \xB7 LAT \xB7 " + host + " S" + season + "E" + episode, url: r.url, quality: r.quality || "HD", headers: r.headers }];
            }
            return [];
          }).catch(function() {
            return [];
          });
        });
      });
    });
  }).catch(function(err) {
    console.error("[LaCartoons] Error: " + (err && err.message ? err.message : err));
    return [];
  });
}

// src/lacartoons/index.js
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
  return withTimeout(
    extractStreams(tmdbId, mediaType, season, episode).catch(function() {
      return [];
    }),
    4e4
  );
}
module.exports = { getStreams };
