# ScraperTV Providers

Repo privado con **todos los scrapers + extractors** usados en la app ScraperTV (`lolapp`).
Objetivo: si una web cambia DOM / dominio / API, arreglar aquí rápido y luego portar a la app.

Repo app principal: `jostinsantos/lolapp`
Este repo: `josueluz89/scraperstv-providers` (privado)

## Estructura

```
lib/
  data/
    scrapers/
      base/       -> registry.dart, buscador.dart, scraper_context.dart, base_home/detail, detalle_scraper, fuentes_por_capitulo
      home/       -> listado: serieskao, tioplus, cuevana, pelisplus, lacartoons, cinehax
      detail/     -> detalle por TMDB: serieskao, tioplus, cuevana, pelisplus, lacartoons, cinehax
      servers/    -> (reservado, vacíos por ahora)
    extractors/
      hls/        -> hls_extractor.dart
      providers/  -> cuevana, tioplus, pelisplus, embed69, poseidon, vidsrc, unlimplay, cinesrc, cinecalidad, fuegocine, hackstore, pelispedia, seriesmetro, smartpelis + content/
    aggregators/  -> source_aggregator, server_aggregator, language_aggregator, main_fuentes_servidores
    datasources/remote/sources/ -> custom_api.dart
  core/
    constants/ -> sources.dart (kRegisteredSources), app_urls.dart
    errors/    -> scraper_exception.dart
  features/
    live/       -> live_sources.dart (URLs M3U), m3u_parser.dart, live_repository.dart + UI
```

## Fuentes Home / Listado + Búsqueda (`registry.dart`)

| id | label | base actual | files |
|----|-------|-------------|-------|
| serieskao | SeriesKao | `https://serieskao.top` | `home/serieskao_scraper.dart`, `detail/serieskao_detail_scraper.dart` |
| tioplus | TioPlus | `https://tioplus.app` | `home/tioplus_scraper.dart`, `detail/tioplus_detail_scraper.dart` |
| cuevana | Cuevana | `https://wv3.cuevana3.eu` | `home/cuevana_scraper.dart`, `detail/cuevana_detail_scraper.dart` |
| pelisplus | PelisPlusHD | `https://www.pelisplushd.la` | `home/pelisplus_scraper.dart`, `detail/pelisplus_detail_scraper.dart` |
| lacartoons | LACartoons | `https://www.lacartoons.com` | `home/lacartoons_scraper.dart`, `detail/lacartoons_detail_scraper.dart` |
| cinehax | CineHax | `https://cinehax.com/ver/` | `home/cinehax_scraper.dart`, `detail/cinehax_detail_scraper.dart` |
| buscador | Todos | — | `base/buscador.dart` (searchSeriesKao, searchTioPlus, searchCuevana, searchPelisPlus, searchLACartoons, searchCineHax) |

## Extractors por TMDB (`sources.dart` -> `kRegisteredSources`)

| id | base actual | file |
|----|-------------|------|
| embed69 | `https://serieskao.top/vidurl/`, `https://xupalace.org/video/` | `extractors/providers/embed69_extractor.dart` |
| poseidon | `https://www.poseidonhd2.co` | `poseidon_extractor.dart` |
| cuevana | `https://wv3.cuevana3.eu` | `cuevana_extractor.dart` |
| unlimplay | `https://unlimplay.com/f/embed/` | `unlimplay_extractor.dart` |
| cinesrc | `https://cinesrc.st/embed/` | `cinesrc_extractor.dart` |
| cinecalidad | `https://www.cinecalidad.am` | `cinecalidad_extractor.dart` |
| tioplus | `https://tioplus.app` | `tioplus_extractor.dart` |
| fuegocine | `https://www.modlyo.com/api/servidores.php` | `fuegocine_extractor.dart` |
| hackstore | `https://hackstore.mx` | `hackstore_extractor.dart` |
| pelisplus | `https://www.pelisplushd.la` | `pelisplus_extractor.dart` |
| pelispedia | `https://pelispedia.is` | `pelispedia_extractor.dart` |
| seriesmetro | `https://www3.seriesmetro.net` | `seriesmetro_extractor.dart` |
| smartpelis | `https://smartpelis.tv` | `smartpelis_extractor.dart` |
| vidsrc | `https://vidsrc.me` (+ .to / .xyz fallback) | `vidsrc_extractor.dart` |
| customapi | APIs PHP usuario | `datasources/remote/sources/custom_api.dart` |

## En vivo M3U (`features/live/`)

| id | tab | url actual | ttl |
|----|-----|------------|-----|
| magistv | TV | `https://raw.githubusercontent.com/CINECITY2023/cinecity/cinecity.net/principal.m3u` | 6h |
| sportsevents | Deportes | `https://raw.githubusercontent.com/BuddyChewChew/sports/refs/heads/main/liveeventsfilter.m3u8` | 5min |

Archivos: `data/live_sources.dart` (cambiar URL aquí si muere), `data/m3u_parser.dart`, `data/live_repository.dart`, `domain/live_channel.dart`.

## Cómo arreglar cuando cae una web

1. Identifica qué falló:
   - ¿Listado? -> `scrapers/home/<fuente>_scraper.dart`
   - ¿Búsqueda? -> `scrapers/base/buscador.dart` -> `search<Fuente>`
   - ¿Detalle/episodios? -> `scrapers/detail/<fuente>_detail_scraper.dart`
   - ¿Servidores/video? -> `extractors/providers/<fuente>_extractor.dart`
2. Lo más común:
   - Cambio de dominio: actualiza `static const base` / `_base` / `_baseUrl` (ver tabla).
   - Cambio de HTML: actualiza regex/selectores en `fetch()` o `scrape()`.
   - Cloudflare/WAF: revisa headers en `scraper_context.dart` / `http_client`.
3. Prueba en la app copiando el archivo arreglado a `lolapp/lib/...` misma ruta.
4. Commit aquí con mensaje claro: `fix(cuevana): nuevo dominio wv4...`.

## Sincronizar con la app

Este repo es espejo de estas carpetas en `lolapp`:
- `lib/data/scrapers/`
- `lib/data/extractors/`
- `lib/data/aggregators/`
- `lib/core/constants/sources.dart`
- `lib/data/datasources/remote/sources/custom_api.dart`

Para llevar un fix a la app:
```powershell
# desde lolapp
Copy-Item -Recurse "C:\Users\josue\OneDrive\Documentos\scraperstv-providers\lib\data\scrapers\home\cuevana_scraper.dart" "lib\data\scrapers\home\cuevana_scraper.dart" -Force
```

O al revés, para traer cambios de la app aquí:
```powershell
# desde scraperstv-providers
Copy-Item -Recurse "C:\Users\josue\OneDrive\Documentos\app nueva scraperstv\lib\data\scrapers\*" "lib\data\scrapers\" -Force
```

## Origen exportado
Exportado desde `lolapp` commit:
- ver historial de `lolapp` para fecha exacta.
- Total archivos: ~44 dart (scrapers+extractors) + aggregators + sources.
