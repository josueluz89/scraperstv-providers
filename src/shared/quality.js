import { fetchWithTimeout } from './http.js';

const KNOWN_QUALITY = {
  vimeos: { h: '720p', n: '480p' },
  goodstream: { x: '1080p', h: '720p', n: '480p', l: '360p' },
  vidhide: { n: '720p', l: '480p' },
  streamwish: { x: '1080p', h: '1080p', n: '720p', l: '480p' },
  voe: { n: '720p', l: '360p' },
};

function getQualityMap(url) {
  if (url.includes('vimeos')) return KNOWN_QUALITY.vimeos;
  if (url.includes('goodstream')) return KNOWN_QUALITY.goodstream;
  if (url.includes('cloudwindow-route')) return KNOWN_QUALITY.voe;
  if (url.includes('minochinos') || url.includes('vidhide') || url.includes('dintezuvio') || url.includes('dramiyos')) return KNOWN_QUALITY.vidhide;
  if (url.includes('premilkyway') || url.includes('hlswish') || url.includes('vibuxer') || url.includes('streamwish') || url.includes('harborviewlearninghub') || url.includes('aurorionagency') || url.includes('centaurus') || url.includes('bysedikamoum') || url.includes('filelions') || url.includes('rapidvideo')) return KNOWN_QUALITY.streamwish;
  return null;
}

export function guessQualityFromUrl(url) {
  if (!url) return 'Unknown';
  const qmap = getQualityMap(url);
  if (qmap) {
    const m = url.match(/_,([a-z,]+),\.urlset/);
    if (m) {
      const labels = m[1].split(',').filter(Boolean);
      const order = ['x', 'o', 'h', 'n', 'l'];
      for (const key of order) {
        if (labels.includes(key) && qmap[key]) return qmap[key];
      }
    }
  }
  const numMatch = url.match(/[_-](\d{3,4})p/);
  return numMatch ? numMatch[1] + 'p' : 'Unknown';
}

export async function detectQualityFromM3U8(url) {
  // In Hermes/QuickJS there is no setTimeout budget - avoid extra fetch and guess instead
  if (typeof setTimeout === 'undefined') {
    return guessQualityFromUrl(url);
  }
  var guessed = guessQualityFromUrl(url);
  if (guessed !== 'Unknown') return guessed;
  try {
    const res = await fetchWithTimeout(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    }, 5000);
    if (!res.ok) return guessQualityFromUrl(url);
    const text = await res.text();
    if (!text.includes('#EXT-X-STREAM-INF')) {
      return guessQualityFromUrl(url);
    }
    let maxH = 0, maxW = 0;
    for (const line of text.split('\n')) {
      const m = line.match(/RESOLUTION=(\d+)x(\d+)/);
      if (m) {
        const h = parseInt(m[2]);
        if (h > maxH) { maxH = h; maxW = parseInt(m[1]); }
      }
    }
    if (maxH >= 2160) return '4K';
    if (maxH >= 1080) return '1080p';
    if (maxH >= 720) return '720p';
    if (maxH >= 480) return '480p';
    return maxH > 0 ? `${maxH}p` : guessQualityFromUrl(url);
  } catch {
    return guessQualityFromUrl(url);
  }
}
