# ScraperTV Providers — repositorio de providers para Nuvio

Repo privado (`josueluz89/scraperstv-providers`) con los **providers JS que corre Nuvio**.
Nuvio descarga este repo, lee `manifest.json` y ejecuta cada `providers/<id>.js` en QuickJS
(motor tipo Stremio). Todo el repo es para Nuvio: el espejo Dart de `lolapp` que había en `lib/`
se eliminó.

```
manifest.json      -> registro: qué providers existen, tipos, formato, idioma, enabled
providers/<id>.js  -> el scraper (CommonJS, module.exports = { getStreams })
src/               -> fuentes esbuild opcionales (node build.js <id> regenera providers/<id>.js)
```

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

## Providers

22 entradas en `manifest.json` (22 archivos en `providers/`, ninguno huérfano), 14 activas.

| id | archivo | estado | última verificación (2026-09-23) |
|----|---------|--------|----------------------------------|
| pelisplusto | `providers/pelisplusto.js` | activo | latino desde PelisPlusHD vía uqlink + hosts directos |
| cuevana | `providers/cuevana.js` | activo | Dune2 3 |
| embed69 | `providers/embed69.js` | activo | Dune2 6 m3u8 directos, Breaking Bad S1E1 4 |
| poseidon | `providers/poseidon.js` | activo | Dune2 8 embeds, GoT S1E1 3 |
| tioplus | `providers/tioplus.js` | activo | Dune2 4, Breaking Bad S1E1 9 |
| vidsrc | `providers/vidsrc.js` | activo | Dune2 2, Breaking Bad S1E1 2 (EN) |
| cinesrc | `providers/cinesrc.js` | activo | Dune2 1, Breaking Bad S1E1 1 |
| pelisplus | `providers/pelisplus.js` | activo | Dune2 1, GoT S1E1 1 |
| pelispedia | `providers/pelispedia.js` | activo | Dune2 3 (fastream m3u8), Breaking Bad S1E1 2 |
| seriesmetro | `providers/seriesmetro.js` | activo | Dune2 3, Breaking Bad S1E1 2 |
| seriesmetro_kl | `providers/seriesmetro_kl.js` | activo | Dune2 1, GoT S1E1 1 |
| smartpelis | `providers/smartpelis.js` | activo | Dune2 3, Breaking Bad S1E1 2 |
| fuegocine | `providers/fuegocine.js` | activo | scrape del sitio (Blogger, `_SV_LINKS` del post): Dune2 4, Deadpool y Wolverine 5, IntensaMente 2 2, Reacher S2E3 3, The Boys S3E1 3 |
| unlimplay | `providers/unlimplay.js` | activo | QuickJS OK: Dune2 9, The Boys S3E1 2 (streamwish/vidhide/filelions) |
| seriesflix | `providers/seriesflix.js` | **off** | corregido para cargar (series→tv + polyfills) pero seriesflixhd.best no devuelve episodios |
| lamovie | `providers/lamovie.js` | **off** | lamovie.org devuelve 503 |
| cinecalidad_kl | `providers/cinecalidad_kl.js` | **off** | cinecalidad.vg devuelve 503 |
| detodopeliculas | `providers/detodopeliculas.js` | **off** | detodopeliculas.nu sin respuesta; usa crypto-js + Buffer |
| masters | `providers/masters.js` | **off** | gnulahd.nu / ww3 devuelven 502 |
| fanpelis | `providers/fanpelis.js` | **off** | fanpelis.to no responde (timeout) |
| cinecalidad | `providers/cinecalidad.js` | **off** | cinecalidad.ec/.to sin respuesta |
| lacartoons | `providers/lacartoons.js` | **off** | lacartoons.com con timeout (0 bytes) |

Los `enabled: false` quedan en el manifiesto **con la causa**: así Nuvio los lista y se ve por qué
están apagados, en vez de desaparecer del repo sin explicación.

## Arreglar o agregar un provider

1. **Mapear la cadena con datos reales** (curl/node, nunca adivinar el markup):
   búsqueda → página de detalle → lista de servidores → host del embed → ¿resoluble?
   Si el sitio entrega todo por JS, buscar su endpoint estático (JSON/feed) antes de descartarlo;
   y si el extractor viejo llamaba a una API de terceros, probar esa API primero: puede estar muerta
   en el servidor (eso no es bug del provider, es backend caído → se vuelve a scrapear el sitio).
2. **Escribir `providers/<id>.js`** a mano, o `src/<id>/` + `node build.js <id>` si reusas `src/shared/`.
3. **Registrar en `manifest.json`**: `id`, `name`, `description` (con fecha y resultado de la
   verificación), `version`, `author`, `supportedTypes`, `filename`, `enabled`, `formats`, `logo`,
   `contentLanguage`. Un provider que no está aquí no existe para Nuvio.
4. **Verificar con ejecución real**:

```bash
node -e "require('./providers/<id>.js').getStreams(693134,'movie',1,1).then(r=>console.log(r.length,r))"
node -e "require('./providers/<id>.js').getStreams(76479,'series',3,1).then(r=>console.log(r.length))"
python -c "import json;json.load(open('manifest.json',encoding='utf-8'))"

# Y el paso que de verdad decide si Nuvio lo carga: correrlo en QuickJS pelado
npm i                 # instala quickjs-emscripten (arnés de prueba)
node scripts/qjs-check.cjs <id> 693134 movie
node scripts/qjs-check.cjs <id> 76479 series 3 1
```

   `scripts/qjs-check.cjs` levanta QuickJS con **solo** lo que da Nuvio (console, fetch, Promise,
   `require('crypto-js')`, timers que no se esperan) y sin `Buffer`/`URL`/`atob`/`TextEncoder`/
   `String.normalize`/`matchAll`. Salidas: `OK <id> … -> N streams`, `LOAD-ERR` (no carga en el
   sandbox: falta un polyfill), `REJECT`/`TIMEOUT`. Ese arnés es el que distingue «no carga en Nuvio»
   de «carga y el sitio no da nada».

   Y los enlaces directos con `curl -sI` (esperado `200` + `video/mp4` o
   `application/vnd.apple.mpegurl`). Un `404` del host es archivo borrado, no bug del provider;
   comparar IDs de embed entre providers ayuda a ver si todos apuntan a la misma subida muerta.
5. **Commit + push a `main`**, con el diff de `manifest.json` limitado a la entrada nueva.
6. Avisar que hay que **refrescar/re-añadir el repo en Nuvio**: cachea el JS de los providers.

## Reglas de trabajo

- Alcance: solo los providers que se piden; nada de arreglos de paso en otros.
- Probar en la PC (node) antes de subir; subir solo lo que ya devuelve streams.
- Reportar en español y corto: qué se verificó con salida real y qué queda.
