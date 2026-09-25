# Contrato del provider y límites de QuickJS

Lo que tiene que cumplir un `providers/<id>.js` para que el motor de MasterScrap lo cargue.
Esta es la información que antes estaba en el README.

## Contrato

```js
module.exports = { getStreams };
// getStreams(tmdbId, mediaType, season, episode) -> Promise<stream[]>
// stream = { title, quality, language, url, headers: { Referer, 'User-Agent' } }
```

- `mediaType`: Nuvio manda `movie` / `series` (también `anime`) → normalizar a `tv` para TMDB.
- **Nunca lanza**: cada ruta de error devuelve `[]`. Un `catch` que devuelve `[]` en silencio es
  también la razón por la que un provider "busca pero no da links": instrumentar, no adivinar.
- Presupuesto: < 60 s por provider (límite duro de Nuvio); lo normal aquí es < 2 s.

## Límites del runtime (QuickJS)

- `var` + `function`; sin features modernas raras ni top-level `await`.
- **No** `String.normalize` (no hay ICU) → tabla propia para quitar acentos.
- **No** `String.matchAll` → bucles con `RegExp.exec` / `String.match`.
- **No** `require()`; solo lo declarado en `EXTERNAL_MODULES` de `build.js` (p. ej. `crypto-js`).
- Timers opcionales: guardar con `AbortController` / `typeof setTimeout === 'undefined'`; nunca
  depender de un timer para la correctitud.
- No asumir `TextEncoder` / `TextDecoder` / `atob` (si hacen falta, polyfill chico propio).
- Los headers viajan con el stream (`headers`), no solo la URL: hay CDNs que dan 403 sin `Referer`.

## Cómo se consume

- El motor baja `manifest.json` y, de cada entrada con `enabled: true`, su `filename`.
- Ejecuta el archivo en QuickJS con `fetch`, `setTimeout`/`clearTimeout`, `console`,
  `AbortController` y `Base64` (atob/btoa) inyectados; `require()` sólo para lo declarado en
  `EXTERNAL_MODULES` de `build.js` (por ejemplo `crypto-js`).
- Llama a `getStreams(tmdbId, mediaType, season, episode)` y espera un array de streams.
  Si el provider falla o tarda, se descarta y la app sigue con los demás.
