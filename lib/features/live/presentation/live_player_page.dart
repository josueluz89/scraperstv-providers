// lib/features/live/presentation/live_player_page.dart
//
// Reproductor de canales en vivo (TV y móvil).
// - Prueba la URL principal y, si falla, los espejos del canal.
// - D-pad: izquierda/derecha = canal anterior/siguiente, select = play/pausa,
//   atrás = salir. Toque = mostrar/ocultar controles.
// - No tiene seek ni subtítulos: un stream en vivo no los necesita.
import 'dart:async';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:video_player/video_player.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

import '../domain/live_channel.dart';
import '../../../core/utils/app_orientation.dart';

const _kAccent = Color(0xFFE50914);
const _kDefaultUa =
    'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 '
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

class LivePlayerPage extends StatefulWidget {
  final List<LiveChannel> playlist;
  final int index;

  const LivePlayerPage({
    super.key,
    required this.playlist,
    required this.index,
  });

  static Future<void> open(
    BuildContext context, {
    required List<LiveChannel> playlist,
    required int index,
  }) {
    return Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => LivePlayerPage(playlist: playlist, index: index),
      ),
    );
  }

  @override
  State<LivePlayerPage> createState() => _LivePlayerPageState();
}

class _LivePlayerPageState extends State<LivePlayerPage> {
  late int _index;
  VideoPlayerController? _controller;
  FocusNode? _focus;

  bool _loading = true;
  bool _playing = false;
  bool _showControls = true;
  int _mirror = 0;
  String? _error;
  Timer? _hideTimer;

  LiveChannel get _channel => widget.playlist[_index];

  @override
  void initState() {
    super.initState();
    _index = widget.playlist.isEmpty
        ? 0
        : widget.index.clamp(0, widget.playlist.length - 1);
    AppOrientation.lockLandscape();
    WakelockPlus.enable();
    _focus = FocusNode(debugLabel: 'live_player')
      ..addListener(() {
        if (mounted) setState(() {});
      });
    _start();
  }

  @override
  void dispose() {
    _hideTimer?.cancel();
    _focus?.dispose();
    _controller?.removeListener(_listener);
    _controller?.dispose();
    WakelockPlus.disable();
    AppOrientation.release();
    super.dispose();
  }

  // ── Reproducción (con espejos) ───────────────────────────────────────────

  Future<void> _start() async {
    final old = _controller;
    _controller = null;
    if (old != null) {
      old.removeListener(_listener);
      try {
        await old.dispose();
      } catch (_) {}
    }
    if (!mounted) return;
    setState(() {
      _loading = true;
      _error = null;
      _mirror = 0;
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _focus?.requestFocus();
    });
    await _tryMirror();
  }

  Future<void> _tryMirror() async {
    if (widget.playlist.isEmpty) {
      setState(() {
        _loading = false;
        _error = 'Lista de canales vacía';
      });
      return;
    }
    final channel = _channel;
    if (_mirror >= channel.urls.length) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'Canal no disponible ahora mismo';
      });
      return;
    }

    final headers = channel.headers.isEmpty
        ? const {'User-Agent': _kDefaultUa}
        : channel.headers;

    try {
      final controller = VideoPlayerController.networkUrl(
      // Bug Android TV (flutter#99273): con la textura por defecto el video
      // se dibuja a su resolución nativa en la esquina y el resto queda
      // verde cuando el video es menor que la pantalla. El platform view
      // (SurfaceView) escala bien en Fire TV / Google TV / Android TV.
      viewType: VideoViewType.platformView,
        Uri.parse(channel.urls[_mirror]),
        httpHeaders: headers,
      );
      await controller.initialize();
      if (!mounted) {
        await controller.dispose();
        return;
      }
      controller.addListener(_listener);
      _controller = controller;
      setState(() {
        _loading = false;
        _error = null;
        _playing = true;
      });
      await controller.play();
      _scheduleHide();
    } catch (_) {
      _mirror++;
      await _tryMirror();
    }
  }

  void _listener() {
    final c = _controller;
    if (c == null || !mounted) return;
    if (c.value.isPlaying != _playing) {
      setState(() => _playing = c.value.isPlaying);
    }
    if (c.value.hasError &&
        _error == null &&
        _mirror + 1 < _channel.urls.length) {
      _mirror++;
      _tryMirror();
    }
  }

  void _togglePlay() {
    final c = _controller;
    if (c == null) return;
    if (c.value.isPlaying) {
      c.pause();
    } else {
      c.play();
    }
    _scheduleHide();
  }

  void _goChannel(int delta) {
    if (widget.playlist.length < 2) return;
    _index = (_index + delta + widget.playlist.length) % widget.playlist.length;
    _start();
  }

  void _scheduleHide() {
    _hideTimer?.cancel();
    if (!mounted) return;
    setState(() => _showControls = true);
    _hideTimer = Timer(const Duration(seconds: 4), () {
      if (mounted && _playing) setState(() => _showControls = false);
    });
  }

  KeyEventResult _onKey(KeyEvent event) {
    if (event is! KeyDownEvent) return KeyEventResult.ignored;
    final key = event.logicalKey;
    if (key == LogicalKeyboardKey.select || key == LogicalKeyboardKey.enter) {
      _togglePlay();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.arrowRight) {
      _goChannel(1);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.arrowLeft) {
      _goChannel(-1);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.arrowUp ||
        key == LogicalKeyboardKey.arrowDown) {
      _scheduleHide();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.escape ||
        key == LogicalKeyboardKey.goBack ||
        key == LogicalKeyboardKey.backspace) {
      Navigator.of(context).maybePop();
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  @override
  Widget build(BuildContext context) {
    final controller = _controller;
    final ready = controller != null && controller.value.isInitialized;

    return Scaffold(
      backgroundColor: Colors.black,
      body: Focus(
        focusNode: _focus,
        onKeyEvent: (_, event) => _onKey(event),
        child: GestureDetector(
          onTap: () {
            if (_showControls) {
              setState(() => _showControls = false);
            } else {
              _scheduleHide();
            }
          },
          behavior: HitTestBehavior.opaque,
          child: Stack(
            fit: StackFit.expand,
            children: [
              if (ready)
                Center(
                  child: AspectRatio(
                    aspectRatio: controller.value.aspectRatio == 0
                        ? 16 / 9
                        : controller.value.aspectRatio,
                    child: VideoPlayer(controller),
                  ),
                ),
              if (_loading)
                const Center(child: CircularProgressIndicator(color: _kAccent)),
              if (_error != null) _buildError(),
              if (_showControls) _buildControls(),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildError() {
    return Container(
      color: Colors.black.withValues(alpha: 0.78),
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.wifi_off_rounded, color: Colors.white54, size: 42),
            const SizedBox(height: 12),
            Text(
              _error!,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.white, fontSize: 16),
            ),
            const SizedBox(height: 6),
            Text(
              _channel.name,
              style: TextStyle(
                color: Colors.white.withValues(alpha: 0.55),
                fontSize: 13,
              ),
            ),
            const SizedBox(height: 18),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                _liveButton(
                  label: 'Reintentar',
                  icon: Icons.refresh_rounded,
                  onTap: _start,
                ),
                const SizedBox(width: 12),
                _liveButton(
                  label: 'Siguiente canal',
                  icon: Icons.skip_next_rounded,
                  onTap: () => _goChannel(1),
                ),
                const SizedBox(width: 12),
                _liveButton(
                  label: 'Volver',
                  icon: Icons.close_rounded,
                  onTap: () => Navigator.of(context).maybePop(),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildControls() {
    final channel = _channel;
    return Stack(
      children: [
        Positioned(
          left: 0,
          right: 0,
          top: 0,
          child: Container(
            padding: const EdgeInsets.fromLTRB(20, 18, 20, 24),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [
                  Colors.black.withValues(alpha: 0.75),
                  Colors.black.withValues(alpha: 0),
                ],
              ),
            ),
            child: Row(
              children: [
                if (channel.logo.isNotEmpty)
                  CachedNetworkImage(
                    imageUrl: channel.logo,
                    width: 44,
                    height: 44,
                    fit: BoxFit.contain,
                    errorWidget: (_, _, _) => const Icon(
                      Icons.live_tv_rounded,
                      color: Colors.white24,
                      size: 32,
                    ),
                  )
                else
                  const Icon(
                    Icons.live_tv_rounded,
                    color: Colors.white70,
                    size: 32,
                  ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        channel.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 19,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      if (channel.group.isNotEmpty)
                        Text(
                          channel.group,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: Colors.white.withValues(alpha: 0.6),
                            fontSize: 13,
                          ),
                        ),
                    ],
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 5,
                  ),
                  decoration: BoxDecoration(
                    color: _kAccent,
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: const Text(
                    'EN VIVO',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 12,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 0.6,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
        Positioned(
          left: 0,
          right: 0,
          bottom: 0,
          child: Container(
            padding: const EdgeInsets.fromLTRB(20, 24, 20, 22),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.bottomCenter,
                end: Alignment.topCenter,
                colors: [
                  Colors.black.withValues(alpha: 0.8),
                  Colors.black.withValues(alpha: 0),
                ],
              ),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                _liveButton(
                  label: 'Anterior',
                  icon: Icons.skip_previous_rounded,
                  onTap: () => _goChannel(-1),
                ),
                const SizedBox(width: 18),
                _liveButton(
                  label: _playing ? 'Pausa' : 'Reproducir',
                  icon: _playing
                      ? Icons.pause_rounded
                      : Icons.play_arrow_rounded,
                  big: true,
                  onTap: _togglePlay,
                ),
                const SizedBox(width: 18),
                _liveButton(
                  label: 'Siguiente',
                  icon: Icons.skip_next_rounded,
                  onTap: () => _goChannel(1),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _liveButton({
    required String label,
    required IconData icon,
    required VoidCallback onTap,
    bool big = false,
  }) {
    return ElevatedButton.icon(
      onPressed: onTap,
      icon: Icon(icon, size: big ? 26 : 20),
      label: Text(label),
      style: ElevatedButton.styleFrom(
        backgroundColor: big
            ? _kAccent
            : Colors.white.withValues(alpha: 0.14),
        foregroundColor: Colors.white,
        elevation: 0,
        padding: EdgeInsets.symmetric(
          horizontal: big ? 22 : 16,
          vertical: big ? 14 : 10,
        ),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(24),
        ),
      ),
    );
  }
}
