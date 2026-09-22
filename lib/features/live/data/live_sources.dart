// lib/features/live/data/live_sources.dart
//
// Listas de canales en vivo usadas por la sección "En vivo".
// Si una lista muere, se cambia aquí la URL (igual que los proveedores de
// BetterStreamflix, que llevan la URL hardcodeada).

class LiveSource {
  final String id;
  final String tabLabel; // etiqueta corta de la pestaña: 'TV' | 'Deportes'
  final String title; // título completo: 'TV en vivo'
  final String url;
  final Duration ttl; // vigencia de la caché en disco

  const LiveSource({
    required this.id,
    required this.tabLabel,
    required this.title,
    required this.url,
    required this.ttl,
  });

  String get cacheKey => 'live_cache_$id';
  String get cacheTsKey => 'live_cache_${id}_ts';
}

const List<LiveSource> liveSources = [
  LiveSource(
    id: 'magistv',
    tabLabel: 'TV',
    title: 'TV en vivo',
    url:
        'https://raw.githubusercontent.com/CINECITY2023/cinecity/'
        'cinecity.net/principal.m3u',
    ttl: Duration(hours: 6),
  ),
  LiveSource(
    id: 'sportsevents',
    tabLabel: 'Deportes',
    title: 'Deportes en vivo',
    url:
        'https://raw.githubusercontent.com/BuddyChewChew/sports/refs/heads/'
        'main/liveeventsfilter.m3u8',
    ttl: Duration(minutes: 5),
  ),
];

LiveSource liveSourceById(String id) =>
    liveSources.firstWhere((s) => s.id == id, orElse: () => liveSources.first);
