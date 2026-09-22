// lib/features/live/domain/live_channel.dart
//
// Modelo de canal en vivo usado por la sección "En vivo" (MAGIS / Sports Events).
// Sin dependencias de Flutter ni de red: testeable con flutter_test puro.

class LiveChannel {
  final String name; // "America TV" (ya limpio, sin "✔️" ni emojis sueltos)
  final String group; // group-title de la lista ("🏙️ Buenos Aires")
  final String logo; // url del logo, '' si no hay
  final List<String> urls; // [principal, ...espejos] en orden de preferencia
  final Map<String, String> headers; // User-Agent / Referer / Origin

  const LiveChannel({
    required this.name,
    required this.group,
    this.logo = '',
    required this.urls,
    this.headers = const {},
  });

  /// URL a reproducir primero ('' si el canal quedó sin enlaces).
  String get url => urls.isEmpty ? '' : urls.first;

  Map<String, dynamic> toJson() => {
    'n': name,
    'g': group,
    'l': logo,
    'u': urls,
    'h': headers,
  };

  factory LiveChannel.fromJson(Map<String, dynamic> j) => LiveChannel(
    name: (j['n'] ?? '').toString(),
    group: (j['g'] ?? '').toString(),
    logo: (j['l'] ?? '').toString(),
    urls: ((j['u'] as List?) ?? const [])
        .map((e) => e.toString())
        .where((e) => e.isNotEmpty)
        .toList(),
    headers: ((j['h'] as Map?) ?? const {}).map(
      (k, v) => MapEntry(k.toString(), v.toString()),
    ),
  );
}

class LiveGroup {
  final String name;
  final List<LiveChannel> channels;

  const LiveGroup({required this.name, required this.channels});
}

/// Agrupa por `group` (los vacíos van a "Otros") y ordena por cantidad desc.
List<LiveGroup> groupChannels(List<LiveChannel> channels) {
  final map = <String, List<LiveChannel>>{};
  for (final c in channels) {
    final key = c.group.trim().isEmpty ? 'Otros' : c.group;
    map.putIfAbsent(key, () => <LiveChannel>[]).add(c);
  }
  final groups =
      map.entries
          .map((e) => LiveGroup(name: e.key, channels: e.value))
          .toList()
        ..sort((a, b) {
          final byCount = b.channels.length.compareTo(a.channels.length);
          return byCount != 0 ? byCount : a.name.compareTo(b.name);
        });
  return groups;
}
