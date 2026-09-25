# Taller: compilar y probar

La app **no** usa nada de esto: sólo `manifest.json` y `providers/*.js`. Esto es para cuando
quieres tocar un provider.

## Compilar

```bash
npm i                    # esbuild, cheerio, nodemon (quickjs-emscripten para el arnés)
node build.js            # compila todos los que tienen fuentes en src/
node build.js cuevana    # compila sólo uno
node build.js --minify   # con minificación
```

`build.js` empaqueta `src/<id>/` en un único `providers/<id>.js` (CommonJS, sin `require()`
salvo los módulos externos declarados arriba en el propio `build.js`).

## Qué providers tienen fuentes

- **Con fuentes en `src/` (8)**: `cinecalidad`, `cuevana`, `fanpelis`, `lacartoons`, `lamovie`, `latanime`, `masters`, `pelisplusto`
- **Vendorizados (15)** (el `.js` es la única fuente, no se compilan): `cinecalidad_kl`, `cinesrc`, `detodopeliculas`, `embed69`, `fuegocine`, `pelispedia`, `pelisplus`, `poseidon`, `seriesflix`, `seriesmetro`, `seriesmetro_kl`, `smartpelis`, `tioplus`, `unlimplay`, `vidsrc`
- `src/shared/` son módulos comunes (http, quality, extracción de embeds, TMDB).
- `providers/_template.js` y `src/_template/` son plantillas de arranque para un provider nuevo:
  **no están en el manifest** y la app no las toca. Los 23 del manifest son los otros.

## Probar antes de subir

```bash
# Ejecución real en Node (Dune 2 y The Boys S3E1 como referencia)
node -e "require('./providers/<id>.js').getStreams(693134,'movie',1,1).then(r=>console.log(r.length,r))"
node -e "require('./providers/<id>.js').getStreams(76479,'series',3,1).then(r=>console.log(r.length))"

# El manifest tiene que ser JSON válido
python -c "import json;json.load(open('manifest.json',encoding='utf-8'))"

# Y lo de siempre: manifest <-> archivos
node validar.js
```

## El arnés de QuickJS (ya no está en el repo)

El repo tenía `scripts/qjs-check.cjs`, un arnés que corría el provider en QuickJS con **sólo**
lo que da la app (sin `Buffer`, `URL`, `TextEncoder`, `String.normalize` ni `matchAll`), que es
lo que distingue *"no carga"* de *"carga y el sitio no da nada"*. Se borró el 2026-09-25.
Si lo quieres de vuelta, búscalo **por ruta**, no por hash (los hashes cambian cada vez que se
reescribe el historial):

```bash
# el commit que lo borró
git log --diff-filter=D --oneline -- scripts/qjs-check.cjs

# recuperarlo de su padre
git show <ese-commit>^:scripts/qjs-check.cjs > scripts/qjs-check.cjs
```

## Avisos que salieron al ordenar el repo (2026-09-25)

1. **Tres bundles llevan el timeout viejo.** `fanpelis`, `lacartoons` y `masters` tienen dentro
   `FETCH_TIMEOUT = 20 s`, mientras que `src/shared/http.js` (y los 6 bundles activos con
   fuentes) usan **12 s**. Son justo los 3 que están apagados, así que hoy no afecta a nadie:
   si reactivas alguno, **recompílalo antes** (`node build.js <id>`) o volverá con los 20 s.
2. **Recompilar cambiaba la ruta de las fuentes** en los comentarios: esbuild anotaba la carpeta
   desde la que se lanzaba (`// ../../<carpeta>/src/shared/http.js`), así que salía distinto en
   cada máquina. Arreglado con `absWorkingDir: __dirname` en `build.js`: ahora siempre
   `// src/shared/http.js`.
3. **Fuera de los comentarios no cambia nada más**: comparado con lo commiteado, un
   `node build.js` limpio sólo toca el `Generated: <fecha>` del banner (y el timeout de los 3
   apagados del punto 1). La lógica de los 18 activos es idéntica a la publicada.
