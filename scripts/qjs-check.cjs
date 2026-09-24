#!/usr/bin/env node
/**
 * Corre un provider providers/<id>.js dentro de QuickJS (el motor de Nuvio) con un
 * puente de `fetch` a Node, para comprobar que CARGA en el sandbox y devuelve streams.
 *
 *   node scripts/qjs-check.cjs fuegocine 693134 movie 1 1
 *   node scripts/qjs-check.cjs unlimplay 76479 series 3 1
 *
 * El sandbox imita lo que MEJOS tiene Nuvio: console, fetch, Promise, setTimeout
 * (que no se espera) y `require('crypto-js')` si está instalado. NO hay Buffer,
 * URL, URLSearchParams, atob/btoa, TextEncoder/TextDecoder, String.normalize ni
 * String.matchAll — todo eso lo tiene que traer el propio provider (polyfill).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { getQuickJS } = require('quickjs-emscripten');

const [, , id, tmdbId, mediaType, season, episode] = process.argv;
if (!id) {
  console.error('uso: node scripts/qjs-check.cjs <id> [tmdbId] [movie|series] [season] [episode]');
  process.exit(2);
}
const VERBOSE = !!process.env.QJS_VERBOSE;

const file = id === '--eval' ? null : path.join(__dirname, '..', 'providers', id + '.js');
const source = file ? fs.readFileSync(file, 'utf-8') : '';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Convierte un valor de Node a un valor de QuickJS (para res.json()). */
function toQuickJS(ctx, v) {
  if (v === null || v === undefined) return ctx.null;
  const t = typeof v;
  if (t === 'number') return ctx.newNumber(v);
  if (t === 'string') return ctx.newString(v);
  if (t === 'boolean') return v ? ctx.true : ctx.false;
  if (Array.isArray(v)) {
    const arr = ctx.newArray();
    v.forEach((item, i) => ctx.setProp(arr, i, toQuickJS(ctx, item)));
    return arr;
  }
  const obj = ctx.newObject();
  Object.keys(v).forEach((k) => ctx.setProp(obj, k, toQuickJS(ctx, v[k])));
  return obj;
}

(async () => {
  const QuickJS = await getQuickJS();
  const ctx = QuickJS.newContext();
  let abiertos = 0;
  const fetchLog = [];
  const timers = [];

  // ── console ─────────────────────────────────────────────────────────────
  const mkLog = (level) => ctx.newFunction(level, (...args) => {
    if (!VERBOSE && level === 'log') return;
    const txt = args.map((h) => {
      try { return JSON.stringify(ctx.dump(h)); } catch (e) { return '<arg>'; }
    }).join(' ');
    console.log(`[qjs:${level}]`, txt);
  });
  const consola = ctx.newObject();
  ['log', 'error', 'warn', 'debug', 'info'].forEach((k) => ctx.setProp(consola, k, mkLog(k)));
  ctx.setProp(ctx.global, 'console', consola);

  // ── fetch: promesa resuelta desde el host ───────────────────────────────
  const deferreds = [];
  const fetchFn = ctx.newFunction('fetch', (urlHandle, optsHandle) => {
    const url = ctx.dump(urlHandle);
    const opts = optsHandle && optsHandle.value ? ctx.dump(optsHandle) : {};
    const deferred = ctx.newPromise();
    deferreds.push(deferred);
    abiertos++;
    fetchLog.push(url);
    (async () => {
      try {
        const res = await fetch(url, {
          method: (opts && opts.method) || 'GET',
          headers: (opts && opts.headers) || {},
          body: opts && opts.body,
        });
        const texto = await res.text();
        if (VERBOSE) console.log(`[qjs:fetch] ${res.status} ${url}`);
        const o = ctx.newObject();
        ctx.setProp(o, 'status', ctx.newNumber(res.status));
        ctx.setProp(o, 'ok', res.ok ? ctx.true : ctx.false);
        ctx.setProp(o, 'url', ctx.newString(res.url || url));
        const hh = ctx.newObject();
        res.headers.forEach((v, k) => ctx.setProp(hh, k, v));
        ctx.setProp(o, 'headers', hh);
        // `text()`/`json()` devuelven PROMESAS, como el fetch real de Nuvio: si aquí
        // se devuelve el valor pelado, un provider que hace `res.text().then(...)`
        // muere con TypeError y el fallo se disfraza de "0 streams".
        ctx.setProp(o, 'text', ctx.newFunction('text', () => {
          const d = ctx.newPromise();
          d.resolve(ctx.newString(texto));
          return d.handle;
        }));
        ctx.setProp(o, 'json', ctx.newFunction('json', () => {
          const d = ctx.newPromise();
          let parsed;
          let fallo = null;
          try {
            parsed = JSON.parse(texto);
          } catch (e) {
            fallo = e.message || 'JSON invalido';
          }
          if (fallo) d.reject(ctx.newError(fallo));
          else d.resolve(toQuickJS(ctx, parsed));
          return d.handle;
        }));
        deferred.resolve(o);
      } catch (e) {
        if (VERBOSE) console.log(`[qjs:fetch-ERR] ${url} ${e.message}`);
        deferred.reject(ctx.newError(e.message || String(e)));
      } finally {
        abiertos--;
      }
    })();
    return deferred.handle;
  });
  ctx.setProp(ctx.global, 'fetch', fetchFn);

  // ── timers de verdad (no se esperan desde el host, como en Nuvio) ────────
  // Un setTimeout inmediato rompe a los providers que usan Promise.race para
  // acotar su tiempo: la carrera se resolvería con [] al instante. Aquí el
  // callback se agenda en el event loop del host y se ejecuta cuando toca.
  const hostSetTimeout = ctx.newFunction('__hostSetTimeout', (fnHandle, msHandle) => {
    const ms = msHandle && msHandle.value ? ctx.dump(msHandle) : 0;
    const fn = fnHandle.dup();
    timers.push(fn);
    setTimeout(function () {
      try {
        ctx.callFunction(fn, ctx.undefined);
      } catch (e) {
        /* callback roto: se ignora */
      }
    }, ms > 0 ? ms : 0);
    return ctx.newNumber(timers.length);
  });
  ctx.setProp(ctx.global, '__hostSetTimeout', hostSetTimeout);

  // ── sandbox "pelado": nada de lo que Nuvio no tiene ─────────────────────
  ctx.unwrapResult(ctx.evalCode(`
    delete String.prototype.normalize;
    delete String.prototype.matchAll;
    globalThis.setTimeout = function (fn, ms) { return globalThis.__hostSetTimeout(fn, ms || 0); };
    globalThis.clearTimeout = function () {};
    globalThis.setInterval = function () { return 0; };
    globalThis.clearInterval = function () {};
    globalThis.AbortController = function () { this.signal = null; this.abort = function () {}; };
  `, 'sandbox.js')).dispose();

  // ── require: solo lo que Nuvio declara externo ──────────────────────────
  // crypto-js se evalúa DENTRO del sandbox (en Nuvio viene provisto por la app).
  let cyExports = null;
  const rutaCrypto = path.join(__dirname, '..', 'node_modules', 'crypto-js', 'crypto-js.js');
  if (fs.existsSync(rutaCrypto)) {
    const cyModulo = ctx.newObject();
    cyExports = ctx.newObject();
    ctx.setProp(cyModulo, 'exports', cyExports);
    ctx.setProp(ctx.global, 'module', cyModulo);
    ctx.setProp(ctx.global, 'exports', cyExports);
    const cy = ctx.evalCode(fs.readFileSync(rutaCrypto, 'utf-8'), 'crypto-js.js');
    if (cy.error) {
      console.log('CRYPTO-JS-ERR:', JSON.stringify(ctx.dump(cy.error)).slice(0, 200));
      cyExports = null;
    } else {
      cy.dispose();
      // el UMD reemplaza module.exports: hay que releerlo
      cyExports = ctx.getProp(cyModulo, 'exports');
    }
  }
  const externos = { 'crypto-js': !!cyExports };
  const requireFn = ctx.newFunction('require', (nameHandle) => {
    const nombre = ctx.dump(nameHandle);
    if (nombre === 'crypto-js' && cyExports) return cyExports;
    throw new Error("Cannot find module '" + nombre + "'");
  });
  ctx.setProp(ctx.global, 'require', requireFn);

  // ── cargar el provider (o código suelto con --eval) ─────────────────────
  const args = [String(tmdbId || 693134), mediaType || 'movie', String(season || 1), String(episode || 1)];
  let llamada;
  if (id === '--eval') {
    llamada = ctx.evalCode(
      `globalThis.__out = undefined; globalThis.__err = undefined;
       Promise.resolve().then(function () { return (async function () { ${process.env.QJS_CODE || ''} })(); })
         .then(function (r) { globalThis.__out = (r === undefined ? 'void' : r); },
               function (e) { globalThis.__err = String(e); });`,
      'eval.js'
    );
  } else {
    const modulo = ctx.newObject();
    const exports = ctx.newObject();
    ctx.setProp(modulo, 'exports', exports);
    ctx.setProp(ctx.global, 'module', modulo);
    ctx.setProp(ctx.global, 'exports', exports);

    const carga = ctx.evalCode(source, id + '.js');
    if (carga.error) {
      console.log('LOAD-ERR:', JSON.stringify(ctx.dump(carga.error)).slice(0, 500));
      process.exit(1);
    }
    carga.dispose();
    const getStreams = ctx.getProp(exports, 'getStreams');
    if (!getStreams.alive) {
      console.log('NO-EXPORTS: module.exports.getStreams no existe');
      process.exit(1);
    }

    // ── llamada y bombeo de jobs hasta que la promesa se asiente ──────────
    llamada = ctx.evalCode(
      `globalThis.__out = undefined; globalThis.__err = undefined;
       module.exports.getStreams(${args.map((a) => JSON.stringify(a)).join(',')})
         .then(function (r) { globalThis.__out = r; }, function (e) { globalThis.__err = String(e); });`,
      'run.js'
    );
  }
  if (llamada.error) {
    console.log('CALL-ERR:', JSON.stringify(ctx.dump(llamada.error)).slice(0, 400));
    process.exit(1);
  }
  llamada.dispose();

  const limite = Date.now() + 45000;
  for (;;) {
    try { ctx.runtime.executePendingJobs(1000); } catch (e) { /* jobs rotos: se ignoran */ }
    const err = ctx.getProp(ctx.global, '__err');
    const out = ctx.getProp(ctx.global, '__out');
    const listo = ctx.typeof(out) !== 'undefined';
    const fallo = ctx.typeof(err) !== 'undefined';
    if (fallo) { console.log('REJECT:', String(ctx.dump(err)).slice(0, 400)); process.exit(1); }
    if (listo) {
      const streams = ctx.dump(out);
      if (!Array.isArray(streams)) {
        console.log('RESULTADO no-array:', JSON.stringify(streams).slice(0, 200));
      } else {
        console.log(`OK ${id} ${args[1]} -> ${streams.length} streams  (fetch: ${fetchLog.length})`);
        streams.slice(0, 8).forEach((s) => console.log('   ', s.language, '|', s.quality, '|', s.title, '|', String(s.url).slice(0, 90)));
      }
      process.exit(0);
    }
    if (Date.now() > limite) {
      console.log('TIMEOUT esperando la promesa (fetch abiertos:', abiertos, ')');
      process.exit(1);
    }
    await sleep(25);
  }
})().catch((e) => {
  console.log('HARNESS-ERR:', e.message);
  process.exit(1);
});
