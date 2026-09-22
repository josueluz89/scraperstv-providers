/// Fuentes cuyos servidores salen de la PÁGINA DEL CAPÍTULO y no del TMDB id
/// (un enlace por episodio). Antes esto era un caso especial dentro del código
/// con el nombre de una sola fuente; ahora es una regla con nombre propio que
/// comparten las pantallas de detalle y el motor de servidores.
const Set<String> kFuentesPorCapitulo = {
  'lacartoons',
  'animejk',
  'jkanime',
  'jk',
};

String _normalizar(String servicio) =>
    servicio.trim().toLowerCase().replaceAll(' ', '');

/// ¿Los servidores de [servicio] se sacan del capítulo concreto?
///
/// Es tolerante a mayúsculas y espacios (' LACartoons ' → true) y a valores
/// vacíos (→ false), para poder llamarla directo con lo que llega de la UI.
bool resuelvePorCapitulo(String servicio) =>
    kFuentesPorCapitulo.contains(_normalizar(servicio));
