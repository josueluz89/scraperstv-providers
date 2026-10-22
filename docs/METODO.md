# Método de trabajo — cómo se prueba y se arregla un provider

Este documento es la forma oficial de trabajar en este repo. Lo estableció el dueño
(2026-10-22) tras la ola de arreglos de esa noche, con las pruebas y los errores de
esa jornada como evidencia. **Todo trabajo futuro — humano o de un agente — sigue
este método.** El protocolo técnico del runtime está en [CONTRATO.md](CONTRATO.md);
esto es el procedimiento y las reglas.

## 1. Reglas permanentes del dueño

1. **Antes de correr código de un provider, se revisa**: qué URLs toca, qué descarga
   y qué ejecuta. *(Orden del dueño, 2026-10-17.)*
2. **Se trabaja en una copia local**, en una carpeta con el nombre del repo, directo
   en la máquina de trabajo — sin contenedor («sin caja», orden del dueño,
   2026-10-22) y **nunca en su VPS**. Entorno limpio: **sin secretos ni tokens del
   usuario** en la máquina de pruebas. Dependencias fijas, solo del lockfile
   (`npm ci`). Esos sitios **jamás** se abren en un navegador normal; si hiciera
   falta navegador, solo headless con sandbox (en la práctica, ningún provider lo
   necesita).
3. **Nada se inventa.** Cada afirmación lleva evidencia: conteos de streams,
   tiempos por llamada, códigos HTTP. Una corrida sin red real es **inválida** y no
   prueba nada — señal típica: todos los ceros en milisegundos. Antes de probar,
   se verifica que la red responde de verdad (p. ej. TMDB contesta).
4. **No se cambian** `id`, `name` ni `filename` de un provider, nunca.

## 2. Cómo se llama a un provider (como lo hace Nuvio)

- La app pasa **solo el id de TMDB**: `getStreams(tmdbId, mediaType, season, episode)`.
- `mediaType` llega como **`movie`**, **`series`** o **`anime`**. Para TMDB el
  provider normaliza `series`/`anime` → `tv`, como manda el CONTRATO.
- **El provider resuelve el título por su cuenta vía TMDB** desde el id. En las
  pruebas jamás se le pasan títulos a mano ni se le ayuda por fuera: se prueba lo
  que la app va a ejecutar.
- **Presupuesto duro: menos de 60 s por llamada.** Los tiempos internos se diseñan
  para la latencia **real medida** de los sitios y hosts, no para la ideal.

## 3. Referencias fijas de prueba

| Tipo | Título | TMDB |
|---|---|---|
| Película | Dune: Parte dos | 693134 |
| Serie | The Boys, S1E1 | 76479 |
| Anime | Attack on Titan, S1E1 | 1429 |
| Anime | Dragon Ball Super, S1E1 | 62715 |

**Y siempre, además, un título del terreno del sitio**: uno que su catálogo sí
tenga, confirmado en el sitio antes de concluir nada.

## 4. La regla del catálogo (la lección de LaCartoons)

- Un **0 con un título que el sitio no cataloga es comportamiento correcto**, no
  una falla. LaCartoons daba 0 con The Boys y Attack on Titan porque no los tiene;
  con Heidi (su terreno) da 3 streams latinos. **No se toca el código.**
- Antes de declarar roto a un provider, se verifica en el sitio si el título está,
  buscando por **todos** sus nombres: localizado, original, romaji y los
  `alternative_titles` de TMDB.
- Ojo con los nombres: hay sitios que indexan solo por romaji u nombre original
  (Latanime solo conoce Attack on Titan como «Shingeki no Kyojin»); los títulos
  alternativos de TMDB son el puente, y el scoring debe poder llegar a ellos.

## 5. La regla de idioma (no negociable)

- Solo se entregan streams **Latino, Subtitulado, Inglés o Japonés**. El
  **Castellano de España se descarta siempre**.
- **Nunca se afloja el filtro de idioma para "arreglar" un cero.** Si la página
  tiene opciones permitidas que nunca se llegan a probar, la falla es de
  **selección/priorización** (caso SeriesFlix: resolvía primero la sección
  Castellano y cortaba ahí), y eso es lo que se reescribe — el filtro no se toca.

## 6. Diagnóstico por etapas, con evidencia

La cadena es: TMDB → búsqueda en el sitio → ficha → embeds → resolución →
validación de video. Se mide **en qué etapa muere**, con tiempos y códigos, antes
de tocar una línea.

- Un *matcher* que acepta cualquier cosa es **peor que un 0**: puede devolver los
  enlaces de **otra película** (caso CineCalidad: pedías Dune 2 y daba Enola Holmes
  2, porque aceptaba enlaces sin texto como coincidencia universal). El match se
  hace por slug/tokens + año, y el texto del enlace solo cuenta si trae texto.
- Las causas externas **se prueban, no se suponen**: sitio caído o borrado por la
  plataforma (HTTP y mensaje), copias borradas en los hosts (404 de la API del
  host), tokens amarrados a la IP (un 403 saliendo por una IP rotada no prueba un
  403 en la app, que tiene IP estable), hosts lentos (TTFB medido, no adivinado).
- Si la causa es externa y está probada, **no se fabrica un arreglo**: se reporta
  con la evidencia y el dueño decide (apagar, eliminar o dejar).

## 7. La regla de arreglo: se reescribe, no se parcha

> «No caigas con código encima: lo que está mal lo escribes de nuevo.»
> — el dueño, 2026-10-22

- La pieza que está mal **se borra y se escribe de nuevo**, como una sola
  implementación coherente que cumple el CONTRATO. Nada de parches, capas, flags
  ni *fallbacks* apilados sobre el código malo.
- Se reutiliza **solo lo probado bueno**: los resolvers y decodificadores
  compartidos (`src/shared/*`, la cripto de embed69, rpmvid) se conservan tal cual.
- Los tiempos de espera forman parte del **diseño** de la pieza nueva (un
  presupuesto pensado por etapas, documentado en el código), no valores parchados
  uno a uno.
- El `manifest.json` solo se toca por **datos**: cada entrada con `filename` y
  `supportedTypes` **reales** (un sitio solo de películas se declara `["movie"]`,
  no `["movie","tv"]`). Tras tocarlo, `node validar.js` debe cerrar en
  **«OK sin problemas»**.

## 8. Re-prueba y subida

1. Todo arreglo se **re-prueba con las mismas referencias de §3 más el título de
   terreno**, llamando como en §2.
2. **Corridas repetidas**: los hosts bailan mucho. Un 0 aislado no condena y un 1
   aislado no absuelve; se reporta la serie de resultados con sus tiempos.
3. **Solo se sube lo que demuestre devolver streams reales** — la salida final de
   `getStreams`, ya validada como video directo — con su tabla antes/después.
   Lo que no llega a eso queda en la copia con su informe, y decide el dueño.
4. Tras subir, se **verifica en vivo** que lo que está en GitHub coincide con lo
   probado (sha/blob por archivo), y se sincronizan las copias locales (el clon y
   la copia de trabajo, incluido `manifest.json`).
5. Si un provider tiene `src/`, se recompila con `node build.js <id>` y se suben
   **fuente y bundle juntos**.

## 9. Checklist rápido

1. Revisión estática del provider (qué hace, qué toca).
2. Prueba real con las referencias (y red verificada antes).
3. Título de terreno confirmado en el catálogo del sitio.
4. Diagnóstico por etapas: ¿dónde muere y por qué?
5. Reescritura limpia de la pieza rota (sin parches).
6. `node build.js <id>` si tiene `src/`.
7. Re-prueba repetida: referencias + terreno.
8. `node validar.js` en OK.
9. Subida de solo lo probado + verificación en vivo por sha.
10. Informe antes/después con conteos, tiempos y causa probada.

---

*Establecido el 2026-10-22. Casos que lo respaldan: pelisplus, pelisplusto,
embed69, lamovie, cinecalidad, pelispedia, fanpelis, latanime, seriesflix
(rearreglados y probados), lacartoons (sano: sus ceros eran catálogo),
fuegocine (fuente eliminada por la plataforma) y detodopeliculas (sitio en 503).*
