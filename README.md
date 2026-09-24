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

23 entradas en `manifest.json` (23 archivos en `providers/`, ninguno huérfano).

| id | archivo | estado | última verificación (2026-09-24) |
|----|---------|--------|----------------------------------|
| pelisplusto | `providers/pelisplusto.js` | activo | latino desde PelisPlusHD vía uqlink + hosts directos |
| cuevana | `providers/cuevana.js` | activo | Dune2 3, The Boys S3E1 1 |
| embed69 | `providers/embed69.js` | activo | Dune2 6 m3u8 directos, Breaking Bad S1E1 2 |
| poseidon | `providers/poseidon.js` | activo | Dune2 8 embeds, The Boys S3E1 9 (QuickJS: los 8 llegan desde que el arnés devuelve promesas de verdad) |
| tioplus | `providers/tioplus.js` | activo | Dune2 4, The Boys S3E1 8 |
| vidsrc | `providers/vidsrc.js` | activo | Dune2 2, The Boys S3E1 2 (EN). Fix: comparaba el mediaType contra `"tv"`, así que Nuvio (`series`) pedía `/embed/movie/<id>`; ahora series va a `/embed/tv/<id>/<s>-<e>` |
| cinesrc | `providers/cinesrc.js` | activo (solo embed) | Dune2 1, The Boys S3E1 1 — emite el embed oficial con los parámetros de `/docs`; el m3u8 no se puede resolver (barrera proof-of-work con WASM, fuera del alcance de QuickJS) |
| latanime | `providers/latanime.js` | activo (solo latino, estricto) | 2026-09-24: 15 animes seguidos con streams (Demon Slayer, Attack on Titan, One Piece, My Hero Academia, Chainsaw Man, Spy×Family, Dragon Ball Daima, BLUELOCK, One Punch Man, Death Note, Frieren, Dan Da Dan, Sakamoto Days, Hunter x Hunter, Tokyo Revengers); 0 en lo que el sitio solo publica en castellano. Solo emite entradas cuyo slug o `<title>` confirman latino |
| pelisplus | `providers/pelisplus.js` | activo | Dune2 1, The Boys S3E1 1 |
| pelispedia | `providers/pelispedia.js` | activo | Dune2 3 (fastream m3u8), The Boys S3E1 3 |
| seriesmetro | `providers/seriesmetro.js` | activo | Dune2 3, The Boys S3E1 3. Fix 2026-09-24: sus streams iban sin `Accept` y el CDN de fastream responde 403 al m3u8 — se añade `Accept`/`Accept-Language` (igual que pelispedia) |
| seriesmetro_kl | `providers/seriesmetro_kl.js` | activo | Dune2 1, GoT S1E1 1. Fix 2026-09-24: el bundle usaba `String.normalize`, `matchAll` y `URLSearchParams` sin polyfill, así que en QuickJS moría antes de buscar; se le añaden los polyfills y el `language` del stream |
| smartpelis | `providers/smartpelis.js` | activo | Dune2 3, The Boys S3E1 3 (mismo fix de `Accept` que seriesmetro) |
| fuegocine | `providers/fuegocine.js` | activo | scrape del sitio (Blogger, `_SV_LINKS` del post): Dune2 4, Deadpool y Wolverine 5, IntensaMente 2 2, Reacher S2E3 3, The Boys S3E1 3 |
| unlimplay | `providers/unlimplay.js` | activo (sitio inestable) | flujo nuevo del sitio (`/embed/…` + `var LANGS` + `POST /edge-data` con token fresco). El backend responde 504/timeouts de forma intermitente: el 2026-09-24 la web quedó colgada y no se pudo re-verificar |
| lamovie | `providers/lamovie.js` | activo (reescrito) | lamovie.org ya no es un portal scrapeable: SPA + API propia por TMDB (`tmdb.lamovie.org/v1`) y player `vimeos.net/embed-%fileCode%.html`. Dune2 1, The Boys S3E1 1, Breaking Bad S1E1 1 (Node y QuickJS) |
| cinecalidad | `providers/cinecalidad.js` | activo (reescrito) | cinecalidad.ec → **cinecalidad.am** (301) con la misma plataforma que lamovie (`tmdb.cinecalidad.am/v1` + vimeos). Dune2 1, The Boys S3E1 1, Breaking Bad S1E1 1 |
| seriesflix | `providers/seriesflix.js` | **off** | seriesflixhd.best redirige a seriesflixhd.team; pendiente de re-verificar |
| cinecalidad_kl | `providers/cinecalidad_kl.js` | **off** | cinecalidad.vg no responde (timeout, comprobado 2026-09-24) |
| detodopeliculas | `providers/detodopeliculas.js` | **off** | detodopeliculas.nu devuelve 522 (comprobado 2026-09-24); usa crypto-js + Buffer |
| masters | `providers/masters.js` | **off** | gnulahd.nu devuelve 502 (comprobado 2026-09-24) |
| fanpelis | `providers/fanpelis.js` | **off** | fanpelis.to devuelve 522 (comprobado 2026-09-24) |
| lacartoons | `providers/lacartoons.js` | **off** | lacartoons.com devuelve 522 (comprobado 2026-09-24) |

Los `enabled: false` quedan en el manifiesto **con la causa**: así Nuvio los lista y se ve por qué
están apagados, en vez de desaparecer del repo sin explicación.

## Velocidad

El reproductor espera a que cada provider conteste: lo que manda es la latencia del provider más
lento, no la media. Reglas que ya están aplicadas:

- **Fases en tandas paralelas.** Todo lo que pruebe varios candidatos, servidores o embeds va en
  paralelo acotado (6 candidatos a la vez, 4 embeds a la vez) respetando el orden de preferencia.
  Secuencial, el tiempo total era la *suma* de las latencias.
- **Timeout de 12 s por petición** (`src/shared/http.js`): antes 20 s, y un host colgado se comía
  el turno entero.
- **Salida temprana** donde ya existía (primer acierto gana) no se toca.

Medido en QuickJS (Dune 2, esta máquina, incluye el arranque de node):

| provider | antes | ahora |
|----------|-------|-------|
| pelispedia | ~10,5 s | **6,6 s** |
| seriesmetro | ~8,8 s | **5,0 s** |
| smartpelis | ~9,1 s | **5,0 s** |
| unlimplay (sitio caído) | colgado hasta el corte | **0,6 s** con `[]` |
| resto | 0,9 – 5,3 s | igual |

Ideas que quedan sobre la mesa (no aplicadas): cachear en memoria las fichas de TMDB cuando el
runtime reutilice la instancia, y un **presupuesto de tiempo** por provider (devolver lo ya
resuelto al pasar X ms con al menos un stream en la mano) para no esperar al último embed.

### Descargar el repo no es el cuello de botella (medido 2026-09-24)

El repo completo (manifest + 18 providers activos) son 468 KB, **131 KB con gzip**. Medido desde
esta máquina, bajando todo en paralelo como hace un cliente:

| origen | frío | caliente |
|--------|------|----------|
| `raw.githubusercontent.com/.../main/...` | 860 ms | **166 ms** |
| `cdn.jsdelivr.net/gh/...@main/...` | 20 s (3 archivos fallaron) | 11,4 s |
| `cdn.jsdelivr.net/gh/...@<commit o tag>/...` | 0,8 s por archivo | **0,07 s** por archivo (cache 7 días) |

O sea: `raw` (lo que usa la app) ya responde en décimas de segundo y sin fallos; jsDelivr **solo**
conviene si se fija una versión inmutable (`@vX.Y.Z` o `@<sha>`), porque `@main` obliga a
revalidar en el edge y salió 100 veces más lento. Lo que tarda de verdad son los providers
scrapeando (1–7 s), no la descarga.

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
