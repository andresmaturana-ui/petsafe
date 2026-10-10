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

/** Zona aproximada (círculo de ~300 m) sin marcar el punto exacto. */
export function showArea(el, { lat, lng }) {
  const map = base(el, [lat, lng], 15);
  L.circle([lat, lng], { radius: 300, color: '#e85d4a', fillColor: '#f2785c', fillOpacity: 0.25, weight: 2 }).addTo(map);
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

/** Busca una dirección en Chile (OpenStreetMap). Devuelve { lat, lng } o null. */
export async function findAddress(q) {
  if (!q || q.trim().length < 4) return null;
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=cl&accept-language=es&q=${encodeURIComponent(q.trim())}`;
  try {
    const [r] = await (await fetch(url)).json();
    return r ? { lat: Number(r.lat), lng: Number(r.lon) } : null;
  } catch {
    return null;
  }
}

/**
 * El mapa sigue a la dirección escrita, y "usar mi ubicación" avisa si el
 * equipo da una ubicación aproximada (los computadores la calculan por
 * internet y suelen marcar el centro de Santiago).
 * query(): texto a buscar (dirección y comuna). say(msg, tone): avisos.
 */
export function bindPlaceSearch(picker, { input, query = () => input.value, hereBtn, getLocation, say }) {
  input?.addEventListener('change', async () => {
    const p = await findAddress(query());
    if (p) {
      picker.set(p);
      say('Movimos la huella a la dirección. Revisa que quede justo en el lugar; si no, tócalo en el mapa.', 'ok');
    } else if (input.value.trim()) {
      say('No encontramos esa dirección en el mapa. Toca el mapa para marcar el lugar.', 'bad');
    }
  });
  hereBtn?.addEventListener('click', async () => {
    const loc = await getLocation();
    if (!loc) return say('No pudimos obtener tu ubicación. Activa la ubicación para el navegador, o escribe la dirección o toca el mapa.', 'bad');
    picker.set(loc);
    if (loc.accuracy > 1000) say('Este equipo da una ubicación aproximada y puede estar lejos. Escribe la dirección o toca el mapa en el lugar correcto.', 'bad');
  });
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

const clinicIcon = (urgent, home = false) => L.divIcon({
  className: `clinic-marker${urgent ? ' urgent' : ''}`,
  html: `<span>${home ? '🏠' : '🏥'}</span>`,
  iconSize: [40, 40],
  iconAnchor: [20, 36],
});

/** Clínicas en el mapa; al tocar una se llama onPick(clinic). */
export function showClinics(el, clinics, here, onPick) {
  const first = here || clinics[0] || { lat: DEFAULT_CENTER[0], lng: DEFAULT_CENTER[1] };
  const map = base(el, [first.lat, first.lng], here ? 13 : 12);
  if (here) L.circleMarker([here.lat, here.lng], { radius: 8, color: '#fff', weight: 3, fillColor: '#4f7fb8', fillOpacity: 1 }).addTo(map);
  for (const c of clinics) {
    // Veterinario a domicilio: el punto es aproximado, así que se marca su zona.
    if (c.onlyHome) L.circle([c.lat, c.lng], { radius: 1000, color: '#4f7fb8', weight: 2, dashArray: '6 6', fillOpacity: 0.12 }).addTo(map);
    L.marker([c.lat, c.lng], { icon: clinicIcon(c.emergencies, c.onlyHome), title: c.name }).addTo(map).on('click', () => onPick(c));
  }
  if (here && clinics.length) map.fitBounds(L.latLngBounds([[here.lat, here.lng], ...clinics.slice(0, 3).map((c) => [c.lat, c.lng])]).pad(0.2), { maxZoom: 15 });
  return map;
}

const boardIcon = (kind) => L.divIcon({
  className: `board-marker ${kind}`,
  html: `<span>${kind === 'lost' ? '🔴' : kind === 'found' ? '🟢' : '🟡'}</span>`,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

/** Kiltrazo Municipal: la comuna (círculo) con los perdidos y encontrados. */
export function showBoard(el, center, km, points) {
  const map = base(el, [center.lat, center.lng], 13);
  const area = L.circle([center.lat, center.lng], { radius: km * 1000, color: '#4f7fb8', weight: 2, dashArray: '6 6', fillOpacity: 0.05 }).addTo(map);
  for (const p of points) L.marker([p.lat, p.lng], { icon: boardIcon(p.kind), title: p.label }).addTo(map).bindPopup(p.label);
  // Después de que el mapa toma su tamaño (si no, queda muy alejado).
  setTimeout(() => { map.invalidateSize(); map.fitBounds(area.getBounds(), { padding: [10, 10] }); }, 80);
  return map;
}
