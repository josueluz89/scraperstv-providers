const FETCH_TIMEOUT = 20000;

function fetchWithTimeout(url, options, timeout) {
  if (!options) options = {};
  var ms = timeout || FETCH_TIMEOUT;
  var controller = null;
  var signal = null;
  try {
    if (typeof AbortController !== 'undefined') {
      controller = new AbortController();
      signal = controller.signal;
      if (typeof setTimeout !== 'undefined') {
        (function(c) {
          setTimeout(function() { try { c.abort(); } catch (e) {} }, ms);
        })(controller);
      }
    }
  } catch (e) { controller = null; }
  var headers = Object.assign({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8'
  }, options.headers || {});
  var req = { headers: headers, redirect: 'follow' };
  if (signal) req.signal = signal;
  if (options.method) req.method = options.method;
  if (options.body) req.body = options.body;
  return fetch(url, Object.assign({}, options, req));
}

function fetchText(url, options, timeout) {
  return fetchWithTimeout(url, options, timeout)
    .then(function(res) {
      if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
      return res.text();
    });
}

function fetchJson(url, options, timeout) {
  return fetchText(url, options, timeout)
    .then(function(raw) { return JSON.parse(raw); });
}

function fetchWithRetry(url, options, retries, timeout) {
  if (retries === undefined || retries === null) retries = 2;
  return fetchText(url, options, timeout)
    .catch(function(e) {
      if (retries <= 0) throw e;
      if (typeof setTimeout === 'undefined') {
        return fetchWithRetry(url, options, retries - 1, timeout);
      }
      return new Promise(function(r) { setTimeout(r, 1000); })
        .then(function() { return fetchWithRetry(url, options, retries - 1, timeout); });
    });
}

export { fetchWithTimeout, fetchText, fetchJson, fetchWithRetry };
