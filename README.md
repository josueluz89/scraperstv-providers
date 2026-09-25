# MasterScrap Providers

Repositorio con los **providers JS que corre MasterScrap** (la app de TV). La app baja
`manifest.json`, lee la lista de providers y ejecuta cada `providers/<archivo>.js` en QuickJS.

> El motor es tipo Stremio: al provider se le pasa un id de TMDB y devuelve enlaces.
> Protocolo y límites del runtime: **[docs/CONTRATO.md](docs/CONTRATO.md)**.

## Qué hay aquí

| Ruta | Qué es | ¿Lo usa la app? |
|---|---|---|
| `manifest.json` | El registro: qué providers existen, de qué tipo y si están activos | **Sí**, es lo primero que baja |
| `providers/<id>.js` | El scraper ya listo, uno por provider | **Sí**, baja sólo los activos |
| `src/` + `build.js` | Fuentes y empaquetador (esbuild) de los que se compilan | No, es el taller |
| `validar.js` | Comprueba que el manifest y los archivos cuadran | No |
| `docs/` | Contrato, taller, histórico y créditos | No |

## Cómo lo usa la app

- Baja `manifest.json` de `raw.githubusercontent.com/.../main/` **en cada apertura** y refresca
  los `.js` de los providers con `enabled: true`.
- De cada entrada lee **`id`, `name`, `filename`, `supportedTypes`, `enabled`**. El resto
  (`description`, `version`, `author`, `formats`, `logo`, `contentLanguage`) es informativo y se
  mantiene por si otro cliente lo usa.
- `supportedTypes` sólo admite **`movie`** y **`tv`**.
- **Arreglas un provider aquí, cierras y abres la app, y ya está**: no hay que reinstalar ni
  recompilar nada.

## Providers activos (18)

| Nombre | id | Películas | Series |
|---|---|---|---|
| CineCalidad | `cinecalidad` | sí | sí |
| CineSRC | `cinesrc` | sí | sí |
| Cuevana | `cuevana` | sí | sí |
| Embed69 | `embed69` | sí | sí |
| FuegoCine | `fuegocine` | sí | sí |
| LaMovie | `lamovie` | sí | sí |
| Latanime (solo Latino) | `latanime` | — | sí |
| Pelispedia | `pelispedia` | sí | sí |
| PelisPlusHD | `pelisplus` | sí | sí |
| Pelisplusto | `pelisplusto` | sí | sí |
| PoseidonHD2 | `poseidon` | sí | sí |
| SeriesFlixHD | `seriesflix` | — | sí |
| SeriesMetro | `seriesmetro` | sí | sí |
| SeriesMetro KL | `seriesmetro_kl` | sí | sí |
| SmartPelis | `smartpelis` | sí | sí |
| TioPlus | `tioplus` | sí | sí |
| Unlimplay | `unlimplay` | sí | sí |
| VidSrc | `vidsrc` | sí | sí |

## Providers apagados (5)

Se quedan en el repo (con su causa) para no perder el trabajo: la app los ignora porque están
`enabled: false`. Los cinco se apagaron el **2026-09-23**.

| Nombre | id | Por qué está apagado |
|---|---|---|
| CineCalidad KL | `cinecalidad_kl` | cinecalidad.vg devuelve 503 y el provider termina con 0 embeds |
| DeTodoPeliculas | `detodopeliculas` | detodopeliculas.nu no responde (timeout) y el bundle necesita los externos de Nuvio (crypto-js, Buffer) |
| Fanpelis | `fanpelis` | fanpelis.to no responde (timeout) |
| LaCartoons | `lacartoons` | lacartoons.com con timeout (0 bytes) |
| Masters (GnulaHD) | `masters` | gnulahd.nu y ww3 devuelven 502 |

## Añadir o arreglar un provider

1. **Comprobar con datos reales** que el sitio sigue vivo y de dónde salen los enlaces
   (`curl`, la página de detalle, el embed). No adivinar el markup.
2. Escribir `providers/<id>.js` a mano, o `src/<id>/` + `node build.js <id>` si reutilizas
   `src/shared/`.
3. Registrarlo en `manifest.json` (obligatorios: `id`, `name`, `filename`, `supportedTypes`,
   `enabled`). **Un provider que no está en el manifest no existe para la app.**
4. `node validar.js` → tiene que salir sin problemas.
5. `git push` a `main`. La app lo coge al reabrirla.

Detalle del protocolo, del runtime QuickJS y de cómo probarlo:
[docs/CONTRATO.md](docs/CONTRATO.md) y [docs/TALLER.md](docs/TALLER.md).

## Compilar (sólo si tocas `src/`)

```bash
npm i
node build.js            # todos los que tienen fuentes en src/
node build.js cuevana    # sólo uno
node validar.js          # comprobar manifest y archivos
```

8 providers tienen fuentes en `src/` (los compila `build.js`); los otros 15 son directamente el
`.js` ya empaquetado. Lista completa y cómo probarlos en Node: [docs/TALLER.md](docs/TALLER.md).

## Documentación

| Fichero | Contenido |
|---|---|
| [docs/CONTRATO.md](docs/CONTRATO.md) | El contrato del provider y los límites de QuickJS |
| [docs/TALLER.md](docs/TALLER.md) | Compilar, probar en Node y qué providers tienen fuentes |
| [docs/HISTORICO.md](docs/HISTORICO.md) | Mediciones de velocidad, notas de verificación y reglas de trabajo |
| [docs/CREDITOS.md](docs/CREDITOS.md) | De dónde salen los providers vendorizados y licencia |
