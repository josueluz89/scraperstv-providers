# Histórico: mediciones, notas de verificación y reglas

Lo que antes estaba en el README y no hace falta tener delante, pero conviene no perder.

> Ojo: la tabla de abajo es la foto del **2026-09-24**. Desde entonces el manifest manda:
> por ejemplo aquí `seriesflix` figura como *off*, pero en `manifest.json` está `enabled: true`.
> Si un día lo confirmas apagado, ponlo `enabled: false` en el manifest (y la app lo ignora).

## Providers y su última verificación

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

### Descargar el repo no es el cuello de botella

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

## Reglas de trabajo

- Alcance: solo los providers que se piden; nada de arreglos de paso en otros.
- Probar en la PC (node) antes de subir; subir solo lo que ya devuelve streams.
- Reportar en español y corto: qué se verificó con salida real y qué queda.

## Descripciones completas del manifest (antes de acortarlas)

### CineCalidad

Reescrito 2026-09-24: cinecalidad.ec redirige (301) a cinecalidad.am, que ya no es el portal scrapeable (/ver-pelicula/, data...

### CineSRC

Embed oficial del sitio (cinesrc.st/embed/{movie|tv}/{tmdbId}); emite 1 stream = el embed, que elige servidor adentro

### Cuevana

Películas y series en latino vía wv3.cuevana3.eu (verificado 2026-09-23: Dune2 3 streams)

### FuegoCine

Scrape del sitio (Blogger, lista _SV_LINKS del post) tras morir la API modlyo.com

### LaMovie

Reescrito 2026-09-24: lamovie.org ya no es un portal scrapeable sino una SPA con API propia indexada por TMDB (tmdb.lamovie.o...

### Latanime (solo Latino)

Anime SOLO en latino de latanime.org (estricto desde 2026-09-24): descarta cualquier entrada 'castellano' y exige que el slug...

### Pelisplusto

Películas y series en latino desde PelisPlusHD (vía uqlink + hosts directos)

### SeriesFlixHD

Series en latino. Reactivado 2026-09-24: seriesflixhd.best redirige a seriesflixhd.team, que sí devuelve episodios (The Boys...

### Unlimplay

Actualizado 2026-09-24 al flujo nuevo del sitio: el embed vive en /embed/{movie|tv}/… y publica var LANGS (link cifrado por s...

### CineCalidad KL

DESHABILITADO 2026-09-23: cinecalidad.vg devuelve 503 y el provider termina con 0 embeds (0 streams, Dune2)

### DeTodoPeliculas

DESHABILITADO 2026-09-23: detodopeliculas.nu no responde (timeout) y el bundle usa crypto-js + Buffer (necesita los externos...

### Fanpelis

DESHABILITADO 2026-09-23: fanpelis.to no responde (timeout). Películas y series en latino vía API de Fanpelis

### LaCartoons

DESHABILITADO 2026-09-23: lacartoons.com con timeout (0 bytes). Series animadas en latino (Cartoon Network, Nickelodeon, Disn...

### Masters (GnulaHD)

DESHABILITADO 2026-09-23: gnulahd.nu y ww3 devuelven 502. Scraper de GnulaHD en Latino/Castellano/Subtitulado
