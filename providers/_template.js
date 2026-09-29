// ===== MasterScrap: validacion de enlaces funcionales (inyectado) =====
// Prueba cada URL con sus headers reales; descarta muertos (4xx/5xx/timeout),
// elimina duplicados y ordena por calidad. QuickJS-safe.
var __msValidate = (function () {
  var TIMEOUT_MS = 7000;
  var CONCURRENCY = 4;
  function qualityRank(q) {
    if (!q) return 0;
    var s = String(q).toLowerCase();
    if (s.indexOf('4k') !== -1 || s.indexOf('2160') !== -1) return 2160;
    var m = s.match(/(\d{3,4})\s*p/);
    if (m) return parseInt(m[1], 10);
    return 0;
  }
  function isM3u8(url) { return /\.m3u8(\?|#|$)/i.test(url || ''); }
  function checkUrl(url, headers, timeoutMs) {
    return new Promise(function (resolve) {
      var done = false, timer = null, controller = null;
      function finish(ok) {
        if (done) return; done = true;
        if (timer) { try { clearTimeout(timer); } catch (e) {} timer = null; }
        if (controller) { try { controller.abort(); } catch (e) {} }
        resolve(!!ok);
      }
      if (!url || typeof url !== 'string' || url.indexOf('http') !== 0) { resolve(false); return; }
      if (typeof setTimeout !== 'undefined') {
        timer = setTimeout(function () { timer = null; finish(false); }, timeoutMs || TIMEOUT_MS);
      }
      var reqHeaders = { 'Range': 'bytes=0-2047',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' };
      if (headers) for (var k in headers) {
        if (Object.prototype.hasOwnProperty.call(headers, k) && headers[k]) reqHeaders[k] = headers[k];
      }
      var reqInit = { headers: reqHeaders, redirect: 'follow' };
      try {
        if (typeof AbortController !== 'undefined') { controller = new AbortController(); reqInit.signal = controller.signal; }
      } catch (e) { controller = null; }
      fetch(url, reqInit).then(function (res) {
        var st = res.status;
        if (st === 200 || st === 206 || st === 416) {
          if (isM3u8(url)) {
            res.text().then(function (t) { finish(t && t.indexOf('#EXTM3U') !== -1); }).catch(function () { finish(true); });
          } else finish(true);
        } else finish(false);
      }).catch(function () { finish(false); });
    });
  }
  function filterWorkingStreams(streams, opts) {
    opts = opts || {};
    var timeout = opts.timeoutMs || TIMEOUT_MS, concurrency = opts.concurrency || CONCURRENCY;
    var seen = {}, uniq = [];
    (streams || []).forEach(function (s) { if (!s || !s.url || seen[s.url]) return; seen[s.url] = 1; uniq.push(s); });
    if (uniq.length === 0) return Promise.resolve([]);
    var results = new Array(uniq.length), cursor = 0;
    function worker() {
      if (cursor >= uniq.length) return Promise.resolve();
      var i = cursor++, st = uniq[i];
      return checkUrl(st.url, st.headers, timeout).then(function (ok) { results[i] = ok ? st : null; })
        .catch(function () { results[i] = null; }).then(worker);
    }
    var workers = [], n = Math.min(concurrency, uniq.length);
    for (var w = 0; w < n; w++) workers.push(worker());
    return Promise.all(workers).then(function () {
      var alive = [];
      for (var i = 0; i < results.length; i++) if (results[i]) alive.push(results[i]);
      alive.sort(function (a, b) { return qualityRank(b.quality) - qualityRank(a.quality); });
      return alive;
    }).catch(function () { return []; });
  }
  function withWorkingStreams(p) {
    return Promise.resolve(p).then(filterWorkingStreams).catch(function () { return []; });
  }
  return { withWorkingStreams: withWorkingStreams, filterWorkingStreams: filterWorkingStreams };
})();
// ===== fin validacion inyectada =====

/**
 * _template - Built from src/_template/
 * Generated: 2026-09-29T15:00:13.492Z
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

// src/_template/extractor.js
var import_cheerio_without_node_native = __toESM(require("cheerio-without-node-native"));
function extractStreams(tmdbId, mediaType, season, episode) {
  return __async(this, null, function* () {
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

// src/_template/index.js
function getStreams(tmdbId, mediaType, season, episode) {
  return __async(this, null, function* () {
    try {
      console.log(`[Template] Request: ${mediaType} ${tmdbId}`);
      const streams = yield extractStreams(tmdbId, mediaType, season, episode);
      return withWorkingStreams(Promise.resolve(streams));
    } catch (error) {
      console.error(`[Template] Error: ${error.message}`);
      return [];
    }
  });
}
module.exports = { getStreams };

// ===== MasterScrap: getStreams solo devuelve enlaces funcionales =====
(function () {
  try {
    var __origGetStreams = module.exports.getStreams;
    if (typeof __origGetStreams === 'function') {
      module.exports = {
        getStreams: function (tmdbId, mediaType, season, episode) {
          return __msValidate.withWorkingStreams(__origGetStreams(tmdbId, mediaType, season, episode));
        }
      };
    }
  } catch (e) {}
})();
