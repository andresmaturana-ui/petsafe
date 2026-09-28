// Mapas con Leaflet + OpenStreetMap y enlaces "cómo llegar" de Google Maps.

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const DEFAULT_CENTER = [-33.4489, -70.6693]; // Santiago de Chile

const pawIcon = L.divIcon({
  className: 'paw-marker',
  html: '<span>🐾</span>',
  iconSize: [44, 44],
  iconAnchor: [22, 40],
});

function base(el, center, zoom) {
  const map = L.map(el, { zoomControl: true, attributionControl: true }).setView(center, zoom);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap',
  }).addTo(map);
  setTimeout(() => map.invalidateSize(), 50);
  return map;
}

/** Mapa de solo lectura con la ubicación de la mascota. */
export function showPoint(el, { lat, lng }) {
  const map = base(el, [lat, lng], 16);
  L.marker([lat, lng], { icon: pawIcon }).addTo(map);
  return map;
}

/** Mapa para elegir un punto (toque para mover el marcador). */
export function pickPoint(el, initial, onChange) {
  const start = initial ? [initial.lat, initial.lng] : DEFAULT_CENTER;
  const map = base(el, start, initial ? 16 : 12);
  const marker = L.marker(start, { icon: pawIcon, draggable: true }).addTo(map);
  const emit = () => {
    const p = marker.getLatLng();
    onChange({ lat: p.lat, lng: p.lng });
  };
  map.on('click', (e) => {
    marker.setLatLng(e.latlng);
    emit();
  });
  marker.on('dragend', emit);
  if (initial) emit();
  return { map, set: (p) => { marker.setLatLng([p.lat, p.lng]); map.setView([p.lat, p.lng], 16); emit(); } };
}

export const TRAVEL_MODES = [
  { mode: 'driving', label: 'Auto', icon: '🚗' },
  { mode: 'bicycling', label: 'Bicicleta', icon: '🚲' },
  { mode: 'walking', label: 'A pie', icon: '🚶' },
  { mode: 'transit', label: 'Transporte', icon: '🚌' },
];

export function directionsUrl({ lat, lng }, mode) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=${mode}`;
}
