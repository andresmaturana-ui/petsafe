// Utilidades pequeñas para armar la interfaz.

/** El perfil tiene todos los datos que se piden al crear la cuenta. */
export const isComplete = (user) =>
  Boolean(user?.firstName && user?.lastName && user?.phone && user?.email && user?.address);

export const esc = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function $(sel, root = document) {
  return root.querySelector(sel);
}

export function toast(message, tone = '') {
  const el = document.createElement('div');
  el.className = `toast ${tone}`;
  el.textContent = message;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 3200);
}

export function timeAgo(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'hace un momento';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  const d = Math.round(s / 86400);
  return d === 1 ? 'ayer' : `hace ${d} días`;
}

export function go(hash) {
  // En Kiltrazo Municipal los enlaces internos #/clinica/... siguen en la municipalidad.
  if (document.body.classList.contains('muni-mode')) hash = hash.replace(/^#\/clinica(?=\/|$)/, '#/municipio');
  if (location.hash === hash || (!location.hash && hash === '#/')) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = hash;
}

// Volver a donde estaba (por ejemplo, la página de una clínica) después de
// crear el perfil o registrar la mascota.
const RETURN_KEY = 'kiltrazo-return';
export function returnHereLater(hash) {
  try { localStorage.setItem(RETURN_KEY, hash); } catch { /* sin almacenamiento */ }
}
export function afterSetup(fallback = '#/') {
  try {
    const to = localStorage.getItem(RETURN_KEY);
    if (to) { localStorage.removeItem(RETURN_KEY); return to; }
  } catch { /* sin almacenamiento */ }
  return fallback;
}

/** Pide la ubicación actual; devuelve null si el usuario no la da. */
export function getLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });
}

export const PAW = `<svg viewBox="0 0 64 64" aria-hidden="true"><g fill="currentColor"><ellipse cx="32" cy="42" rx="14" ry="12"/><ellipse cx="14" cy="28" rx="6" ry="8"/><ellipse cx="50" cy="28" rx="6" ry="8"/><ellipse cx="24" cy="15" rx="6" ry="8"/><ellipse cx="40" cy="15" rx="6" ry="8"/></g></svg>`;

/** Avisa a la app que cambiaron datos (actualiza el contador de avisos). */
export const changed = () => window.dispatchEvent(new Event('petsafe:changed'));
