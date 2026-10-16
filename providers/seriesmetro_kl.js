/**
 * seriesmetro_kl - Built from src/seriesmetro_kl/
 * Generated: 2026-10-07T22:54:23.807Z
 */

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

// src/seriesmetro_kl/extractor.js
var BASE = "https://www3.seriesmetro.net";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
var TMDB_KEY = "439c478a771f35c05022f9feabcca01c";
var T = 1e4;
var HEADERS = {
  "User-Agent": UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-MX,es;q=0.9"
};
function getText(url, referer, ms) {
  var h = {};
  for (var k in HEADERS)
    h[k] = HEADERS[k];
  if (referer)
    h.Referer = referer;
  return fetchWithTimeout(url, { headers: h }, ms || T).then(function(res) {
    if (!res.ok)
      throw new Error("HTTP " + res.status);
    return res.text();
  }).catch(function() {
    return null;
  });
}
function getJson(url) {
  return getText(url, null, T).then(function(t) {
    if (!t)
      return null;
    try {
      var d = JSON.parse(t);
      return d && typeof d === "object" ? d : null;
    } catch (e) {
      return null;
    }
  });
}
var ACENTOS = {
  "\xE1": "a",
  "\xE0": "a",
  "\xE4": "a",
  "\xE2": "a",
  "\xE3": "a",
  "\xE9": "e",
  "\xE8": "e",
  "\xEB": "e",
  "\xEA": "e",
  "\xED": "i",
  "\xEC": "i",
  "\xEF": "i",
  "\xEE": "i",
  "\xF3": "o",
  "\xF2": "o",
  "\xF6": "o",
  "\xF4": "o",
  "\xF5": "o",
  "\xFA": "u",
  "\xF9": "u",
  "\xFC": "u",
  "\xFB": "u",
  "\xF1": "n",
  "\xE7": "c",
  "\xC1": "a",
  "\xC0": "a",
  "\xC4": "a",
  "\xC2": "a",
  "\xC3": "a",
  "\xC9": "e",
  "\xC8": "e",
  "\xCB": "e",
  "\xCA": "e",
  "\xCD": "i",
  "\xCC": "i",
  "\xCF": "i",
  "\xCE": "i",
  "\xD3": "o",
  "\xD2": "o",
  "\xD6": "o",
  "\xD4": "o",
  "\xD5": "o",
  "\xDA": "u",
  "\xD9": "u",
  "\xDC": "u",
  "\xDB": "u",
  "\xD1": "n",
  "\xC7": "c"
};
function slugify(s) {
  s = String(s || "").toLowerCase().replace(/&/g, "y");
  var out = "";
  for (var i = 0; i < s.length; i++) {
    var c = s.charAt(i);
    out += ACENTOS[c] || c;
  }
  return out.replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}
function tmdbTitles(tmdbId, type) {
  var langs = ["es-ES", "es-MX", "en-US"];
  var out = [];
  var chain = Promise.resolve();
  langs.forEach(function(lg) {
    chain = chain.then(function() {
      var url = "https://api.themoviedb.org/3/" + type + "/" + tmdbId + "?api_key=" + TMDB_KEY + "&language=" + lg;
      return getJson(url).then(function(d) {
        if (!d)
          return;
        var t = type === "movie" ? d.title : d.name;
        var o = type === "movie" ? d.original_title : d.original_name;
        [t, o].forEach(function(x) {
          if (x && !/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(x) && out.indexOf(x) === -1)
            out.push(x);
        });
      });
    });
  });
  return chain.then(function() {
    return out;
  });
}
function findFicha(titles, type) {
  var kind = type === "movie" ? "pelicula" : "serie";
  var slugs = [];
  var seen = {};
  titles.forEach(function(t) {
    var s = slugify(t);
    if (s && !seen[s]) {
      seen[s] = true;
      slugs.push(s);
    }
  });
  var chain = Promise.resolve(null);
  slugs.forEach(function(slug) {
    chain = chain.then(function(found) {
      if (found)
        return found;
      var url = BASE + "/" + kind + "/" + slug + "/";
      return getText(url, BASE + "/", T).then(function(html) {
        if (html && (html.indexOf("trembed=") !== -1 || html.indexOf("data-post=") !== -1)) {
          return { url, html };
        }
        return null;
      });
    });
  });
  return chain;
}
function episodeUrl(fichaUrl, fichaHtml, season, episode) {
  var m = fichaHtml.match(/data-post="(\d+)"/);
  if (!m)
    return Promise.resolve(null);
  var body = "action=action_select_season&post=" + encodeURIComponent(m[1]) + "&season=" + encodeURIComponent(String(season));
  return fetchWithTimeout(BASE + "/wp-admin/admin-ajax.php", {
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: fichaUrl
    },
    method: "POST",
    body
  }, T).then(function(res) {
    return res.ok ? res.text() : null;
  }).then(function(html) {
    if (!html)
      return null;
    var re = /href="([^"]+\/capitulo\/[^"]+)"/g;
    var mm;
    while ((mm = re.exec(html)) !== null) {
      var f = mm[1].match(/temporada-(\d+)-capitulo-(\d+)/i);
      if (f && parseInt(f[1], 10) === parseInt(season, 10) && parseInt(f[2], 10) === parseInt(episode, 10)) {
        var u = mm[1];
        return u.indexOf("http") === 0 ? u : BASE + u;
      }
    }
    return null;
  }).catch(function() {
    return null;
  });
}
function unpack(html) {
  var t = html.match(/eval\(function\(p,a,c,k,e,d\)\{.*?\}\('([\s\S]*?)',(\d+),(\d+),'([\s\S]*?)'\.split\('\|'\)\)\)/);
  if (!t)
    return null;
  var e = t[1], radix = parseInt(t[2], 10), count = parseInt(t[3], 10), words = t[4].split("|");
  function tok(n) {
    if (n === 0)
      return "0";
    var s = "";
    while (n > 0) {
      s = "0123456789abcdefghijklmnopqrstuvwxyz"[n % radix] + s;
      n = Math.floor(n / radix);
    }
    return s;
  }
  for (var o = count - 1; o >= 0; o--) {
    if (words[o])
      e = e.split(new RegExp("\\b" + tok(o) + "\\b", "g")).join(words[o]);
  }
  return e;
}
var LANG_ORDER = ["latino", "lat", "castellano", "espa\xF1ol", "esp", "vose", "sub", "subtitulado"];
var LANG_LABEL = {
  latino: "Latino",
  lat: "Latino",
  castellano: "Espa\xF1ol",
  "espa\xF1ol": "Espa\xF1ol",
  esp: "Espa\xF1ol",
  vose: "Subtitulado",
  sub: "Subtitulado",
  subtitulado: "Subtitulado"
};
function langRank(label) {
  var l = String(label || "").toLowerCase();
  for (var i = 0; i < LANG_ORDER.length; i++) {
    if (l.indexOf(LANG_ORDER[i]) !== -1)
      return i;
  }
  return 99;
}
function langLabel(label) {
  var l = String(label || "").toLowerCase();
  for (var k in LANG_LABEL) {
    if (l.indexOf(k) !== -1)
      return LANG_LABEL[k];
  }
  return "Latino";
}
function fileFromEmbed(embedUrl, referer, reintento) {
  var h = { "User-Agent": UA };
  if (referer)
    h.Referer = referer;
  var p;
  try {
    if (typeof AbortController !== "undefined" && typeof setTimeout !== "undefined") {
      var c = new AbortController();
      setTimeout(function() {
        try {
          c.abort();
        } catch (e) {
        }
      }, T);
      p = fetch(embedUrl, { headers: h, redirect: "follow", signal: c.signal });
    } else {
      p = fetch(embedUrl, { headers: h, redirect: "follow" });
    }
  } catch (e) {
    return Promise.resolve(null);
  }
  return p.then(function(res) {
    if (!res.ok)
      throw new Error("HTTP " + res.status);
    return res.text();
  }).catch(function() {
    return null;
  }).then(function(html) {
    var up = unpack(html);
    if (!up)
      return null;
    var m = up.match(/file:"(https?:\/\/[^"]+\.m3u8[^"]*)"/);
    if (!m)
      return null;
    var url = m[1];
    if (/[?&]t=-/.test(url) && !reintento) {
      return fileFromEmbed(embedUrl, referer, true);
    }
    return url;
  });
}
function extractFromPage(pageUrl) {
  return getText(pageUrl, pageUrl, T).then(function(html) {
    if (!html)
      return [];
    var optRe = /href="#options-(\d+)"[^>]*>[\s\S]*?<span class="server">([\s\S]*?)<\/span>/g;
    var trRe = /\?trembed=(\d+)(?:&#038;|&)trid=(\d+)(?:&#038;|&)trtype=(\d+)/g;
    var opts = [], tm, om;
    while ((om = optRe.exec(html)) !== null) {
      opts.push({ n: om[1], label: om[2].replace(/<[^>]+>/g, "").trim() });
    }
    var tr = null;
    while ((tm = trRe.exec(html)) !== null) {
      tr = tm;
      break;
    }
    if (!opts.length || !tr)
      return [];
    var trid = tr[2], trtype = tr[3];
    opts.sort(function(a, b) {
      return langRank(a.label) - langRank(b.label);
    });
    var streams = [];
    var chain = Promise.resolve();
    var terminado = false;
    opts.forEach(function(op) {
      chain = chain.then(function() {
        if (terminado || streams.length >= 3)
          return null;
        var tUrl = BASE + "/?trembed=" + op.n + "&trid=" + trid + "&trtype=" + trtype;
        return getText(tUrl, pageUrl, T).then(function(th) {
          if (!th)
            return null;
          var im = th.match(/<iframe[^>]*src="(https?:\/\/fastream\.to\/[^"]+)"/i);
          if (!im)
            return null;
          return fileFromEmbed(im[1], pageUrl, false).then(function(file) {
            if (!file)
              return null;
            var label = langLabel(op.label);
            streams.push({
              title: "SeriesMetro \xB7 " + label + " \xB7 Fastream",
              quality: "HD",
              language: label,
              url: file,
              // OJO: fastream.to invalida el token si la peticion del m3u8 trae
              // Accept: text/html (solo User-Agent + Referer pasan). Por eso
              // estos headers son minimos: la validacion los reutiliza tal cual.
              headers: {
                "User-Agent": UA,
                Referer: "https://fastream.to/"
              }
            });
            if (label === "Latino")
              terminado = true;
            return null;
          });
        });
      });
    });
    return chain.then(function() {
      return streams;
    });
  });
}
function extractStreams(tmdbId, mediaType, season, episode) {
  var id = parseInt(tmdbId, 10);
  if (!id || id <= 0)
    return Promise.resolve([]);
  var tipo = String(mediaType || "").toLowerCase();
  if (tipo === "series" || tipo === "anime")
    tipo = "tv";
  if (tipo !== "movie" && tipo !== "tv")
    tipo = "movie";
  var s = parseInt(season, 10) || 1;
  var e = parseInt(episode, 10) || 1;
  return tmdbTitles(id, tipo).then(function(titles) {
    if (!titles.length)
      return [];
    return findFicha(titles, tipo);
  }).then(function(ficha) {
    if (!ficha)
      return [];
    if (tipo !== "tv")
      return extractFromPage(ficha.url);
    return episodeUrl(ficha.url, ficha.html, s, e).then(function(epUrl) {
      if (!epUrl)
        return [];
      return extractFromPage(epUrl);
    });
  }).catch(function() {
    return [];
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

// src/seriesmetro_kl/index.js
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
  return withWorkingStreams(withTimeout(
    extractStreams(tmdbId, mediaType, season, episode).catch(function() {
      return [];
    }),
    4e4
  ));
}
module.exports = { getStreams };
