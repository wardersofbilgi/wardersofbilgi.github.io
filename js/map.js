// Rota haritası: Leaflet + OpenStreetMap. Leaflet ilk kullanımda yüklenir.
import { h } from './core.js';

const LEAFLET = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet';
let loading = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    document.head.append(h('link', { rel: 'stylesheet', href: LEAFLET + '.css' }));
    const s = h('script', { src: LEAFLET + '.js' });
    s.onload = () => resolve(window.L);
    s.onerror = () => {
      loading = null;
      reject(new Error('Harita yüklenemedi'));
    };
    document.head.append(s);
  });
  return loading;
}

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const stopColor = (i, n) => css(i === 0 ? '--ok' : i === n - 1 ? '--bad' : '--gold');

// { el, setStops(stops) } döndürür. onPick verilirse haritaya dokunmak durak ekler.
export function routeMap(stops, { onPick, tall = false } = {}) {
  const el = h('div', { class: 'map' + (tall ? ' tall' : '') }, h('div', { class: 'msg' }, 'Harita yükleniyor…'));
  let map = null;
  let group = null;
  let fitted = false;
  let current = stops;

  function draw() {
    if (!map) return;
    group.clearLayers();
    const pts = current.map((s) => [s.lat, s.lng]);
    if (pts.length > 1) L.polyline(pts, { color: css('--gold'), weight: 5 }).addTo(group);
    current.forEach((s, i) => {
      L.circleMarker([s.lat, s.lng], { radius: 10, color: '#fff', weight: 2, fillColor: stopColor(i, current.length), fillOpacity: 1 })
        .bindTooltip(`${i + 1}. ${s.name}`)
        .addTo(group);
    });
    // Düzenlerken her dokunuşta harita yerinden oynamasın
    if (pts.length && (!onPick || !fitted)) {
      fitted = true;
      if (pts.length === 1) map.setView(pts[0], 12);
      else map.fitBounds(pts, { padding: [40, 40] });
    }
  }

  loadLeaflet()
    .then((L) => {
      const start = () => {
        if (!el.isConnected) return requestAnimationFrame(start);
        el.replaceChildren();
        map = L.map(el).setView([39, 35], 5); // Türkiye
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
        group = L.layerGroup().addTo(map);
        if (onPick) map.on('click', (e) => onPick(e.latlng.lat, e.latlng.lng));
        draw();
      };
      start();
    })
    .catch(() => el.replaceChildren(h('div', { class: 'msg' }, 'Harita yüklenemedi. İnternet bağlantını kontrol edip sayfayı yenile.')));

  return {
    el,
    setStops(next) {
      current = next;
      draw();
    },
  };
}

// Rotayı Google Maps'te yol tarifi olarak açan adres
export function mapsUrl(stops) {
  const p = (s) => `${s.lat},${s.lng}`;
  const mid = stops.slice(1, -1).map(p).join('|');
  let url = `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${encodeURIComponent(p(stops[stops.length - 1]))}`;
  if (stops.length > 1) url += `&origin=${encodeURIComponent(p(stops[0]))}`;
  if (mid) url += `&waypoints=${encodeURIComponent(mid)}`;
  return url;
}
