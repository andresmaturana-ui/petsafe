import './styles.css';
import { registerSW } from 'virtual:pwa-register';
import { currentUser, myNotifications, deliverPending, enablePush, finishEmailLink } from './data.js';
import { esc, isComplete } from './ui.js';
import { unlockAudio, startAlarm, checkAlarms } from './alarm.js';
import { refreshArea } from './nearby.js';
import { installPopup } from './install.js';
import { LIVE_APP, LIVE_CLINIC, markHidden, busy } from './live.js';
import { setPage } from './seo.js';
import { initAnalytics, pageView } from './analytics.js';

import home from './views/home.js';
import profile from './views/profile.js';
import register from './views/register.js';
import lost from './views/lost.js';
import lostAlert from './views/lost-alert.js';
import found from './views/found.js';
import tag, { seen } from './views/tag.js';
import match from './views/match.js';
import recovered from './views/recovered.js';
import saveAccount from './views/save-account.js';
import success from './views/success.js';
import inbox from './views/inbox.js';
import admin from './views/admin.js';
import password from './views/password.js';
import privacy from './views/privacy.js';
import terms from './views/terms.js';
import receive, { pendingTransfer, TRANSFER_KEY } from './views/receive.js';
import clinicsMap from './views/clinics-map.js';
import appointment from './views/appointment.js';
import clinicPage from './views/clinic-page.js';
import drivePage from './views/drive.js';
import finder from './views/finder.js';
import landing from './views/landing.js';
import gift, { pendingGift, GIFT_KEY } from './views/gift.js';
import moved from './views/moved.js';
import kiltrazoPoint from './views/kiltrazo-point.js';
import studyPoint from './views/study.js';
import { leaveIfMoved, arriveAfterMove } from './move.js';

registerSW({ immediate: true });

// Si publicamos una versión nueva mientras alguien tenía Kiltrazo abierto, sus
// archivos viejos ya no existen ("Failed to fetch dynamically imported
// module"). Se recarga sola una vez para traer la versión nueva.
const STALE = /dynamically imported module|Importing a module script failed|Unable to preload/i;
function reloadIfStale(err) {
  if (!STALE.test(String(err?.message || err))) return false;
  try {
    if (Date.now() - Number(sessionStorage.getItem('kiltrazo-recarga') || 0) < 30000) return false;
    sessionStorage.setItem('kiltrazo-recarga', String(Date.now()));
  } catch {
    return false;
  }
  location.reload();
  return true;
}
const oops = (err) => (STALE.test(String(err?.message))
  ? '<div class="card"><h2>Hay una versión nueva de Kiltrazo</h2><p>Recarga la página para seguir.</p><button class="btn primary" onclick="location.reload()">Recargar</button></div>'
  : `<div class="card"><h2>Ups…</h2><p>${esc(err.message)}</p></div>`);
window.addEventListener('vite:preloadError', (e) => { if (reloadIfStale(e.payload)) e.preventDefault(); });
window.addEventListener('unhandledrejection', (e) => reloadIfStale(e.reason));

// …/clinica/, /municipio/, /veterinarios/ y /kiltrazo/ (páginas propias que crea
// seo.config.js): direcciones sin "#", porque Instagram y otras apps cortan lo
// que va después del "#" y todo terminaba en la presentación. Se cambia a la
// dirección de siempre (…/#/clinica) para que el resto de la app funcione igual.
const page = location.pathname.match(/\/(clinica|municipio|veterinarios|kiltrazo|vi)\/?$/);
if (page) {
  history.replaceState(history.state, '', `${document.baseURI.split(/[?#]/)[0]}${location.search}${location.hash || `#/${page[1]}`}`);
}

// Enlace corto de la página de una clínica (…/?c=nombre, el que apunta su dominio .cl).
const shortSlug = new URLSearchParams(location.search).get('c');
if (shortSlug && (!location.hash || location.hash === '#/')) {
  history.replaceState(null, '', `${location.pathname}#/c/${encodeURIComponent(shortSlug)}`);
}

const START = '#/';

const routes = [
  ['', home],
  ['perfil', profile],
  ['registrar', register],
  ['perdi', lost],
  ['encontre', found],
  ['placa', tag],
  ['vi', seen],
  ['perdida/:id', lostAlert],
  ['encontrada/:id', match],
  ['recuperada', recovered],
  ['caso/:id', success],
  ['avisos', inbox],
  ['admin', admin],
  ['clave', password],
  ['guardar', saveAccount],
  ['privacidad', privacy],
  ['terminos', terms],
  ['recibir/:code', receive],
  ['regalo/:code', gift],
  ['clinicas', clinicsMap],
  ['hora/:id', appointment],
  ['veterinarios', finder],
  ['kiltrazo', landing],
  ['mudanza', moved],
  ['c/:slug', clinicPage],
  ['c/:slug/:step', clinicPage],
  ['operativo/:id', drivePage],
  ['punto', kiltrazoPoint],
  ['estudio', studyPoint],
];

function resolve(hash) {
  const path = hash.replace(/^#\/?/, '');
  for (const [pattern, view] of routes) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
    const m = path.match(re);
    if (m) return { view, params: Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
  }
  return { view: home, params: {} };
}

const app = document.getElementById('app');

app.innerHTML = `
  <header class="topbar">
    <a href="#/" class="brand"><img src="brand/kiltrazo.svg" alt="Kiltrazo" class="brand-logo"></a>
    <a href="#/avisos" class="bell" aria-label="Avisos">🔔<span class="badge" hidden></span></a>
  </header>
  <main id="view"></main>
  <nav class="tabbar">
    <a href="#/" data-tab="">🏠<span>Inicio</span></a>
    <a href="#/registrar" data-tab="registrar">🐶<span>Registrar</span></a>
    <a href="#/avisos" data-tab="avisos">🔔<span>Avisos</span></a>
    <a href="#/perfil" data-tab="perfil">🙂<span>Perfil</span></a>
  </nav>`;

let viewEl = document.getElementById('view');

let pushTried = false;

let renders = 0;

async function render() {
  renders++;
  const user = await currentUser();
  // Una vez por visita: renueva la suscripción push de este celular.
  if (user && !pushTried) {
    pushTried = true;
    enablePush().catch((err) => console.warn('Push no disponible', err));
    refreshArea(user).catch((err) => console.warn('Zona no actualizada', err));
  }
  const hash = location.hash || START;
  // Kiltrazo Clínica (para veterinarias): se carga aparte, con su propio menú.
  // #/municipio es la entrada de Kiltrazo Municipal, que usa las mismas pantallas.
  const clinic = /^#\/(clinica|municipio|municipal)(\/|$)/.test(hash);
  document.body.classList.toggle('clinic-mode', clinic);
  if (!clinic) document.body.classList.remove('muni-mode');
  if (clinic) return renderClinic(hash);
  let { view, params } = resolve(hash);
  // En el computador el administrador usa todo el ancho de la pantalla.
  document.body.classList.toggle('admin-mode', view === admin);
  // Ficha enviada por la veterinaria a alguien sin perfil: se retoma al terminarlo.
  if (view === receive && !isComplete(user)) {
    try { localStorage.setItem(TRANSFER_KEY, JSON.stringify({ code: params.code, waiting: true })); } catch { /* sin almacenamiento */ }
  }
  // Mascota que otra persona le pasa: se retoma al completar el perfil.
  if (view === gift && !isComplete(user)) {
    try { localStorage.setItem(GIFT_KEY, params.code); } catch { /* sin almacenamiento */ }
  }
  const giftLater = pendingGift();
  if (giftLater && isComplete(user) && view === home) {
    location.hash = `#/regalo/${giftLater}`;
    return;
  }
  const later = pendingTransfer();
  if (later?.waiting && isComplete(user) && view === home) {
    location.hash = `#/recibir/${later.code}`;
    return;
  }
  // Quien llega por primera vez, sin perfil, ve la presentación de Kiltrazo.
  if (!isComplete(user) && view === home) view = landing;
  // Estas páginas se ven sin la app: sin menú y sin pedir el perfil.
  document.body.classList.toggle('web-mode', [clinicPage, finder, landing, tag, seen, drivePage, studyPoint].includes(view));
  document.body.classList.toggle('finder-mode', view === finder || view === landing);
  // Primer uso, o perfil creado antes de pedir todos los datos: completar perfil.
  if (!isComplete(user) && ![profile, admin, password, privacy, terms, clinicPage, finder, landing, moved, tag, seen, drivePage, kiltrazoPoint, studyPoint].includes(view)) view = profile;

  const tab = hash.replace(/^#\/?/, '').split('/')[0];
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));

  viewEl.innerHTML = '';
  viewEl.className = 'view';
  window.scrollTo(0, 0);
  // Título y datos para Google por defecto; las páginas públicas ponen los suyos.
  setPage();
  try {
    await view(viewEl, params, { user, refresh: render });
    markHidden(viewEl);
  } catch (err) {
    console.error(err);
    if (reloadIfStale(err)) return;
    viewEl.innerHTML = oops(err);
  }
  pageView(hash);
  // Usuario nuevo en el navegador del celular: una vez, cómo instalar la app.
  if (view === landing || view === home) {
    setTimeout(() => { if ((location.hash || START) === hash) installPopup(user); }, 800);
  }
  await updateBadge(user);
}

async function renderClinic(hash) {
  viewEl.className = '';
  window.scrollTo(0, 0);
  try {
    const { default: clinicApp } = await import('./clinic/index.js');
    await clinicApp(viewEl, hash.replace(/^#\/?/, ''), { refresh: render });
    markHidden(viewEl);
  } catch (err) {
    console.error(err);
    if (reloadIfStale(err)) return;
    viewEl.innerHTML = oops(err);
  }
}

// Actualización automática (ver live.js): la pantalla se dibuja aparte y, si
// algo cambió, se reemplaza de una vez, sin parpadeo y sin mover el scroll.
let quietAt = 0;
let quietRunning = false;
async function quietRender() {
  const hash = location.hash || START;
  const path = hash.replace(/^#\/?/, '');
  const clinic = /^(clinica|municipio|municipal)(\/|$)/.test(path);
  if (document.hidden || quietRunning || Date.now() - quietAt < 3000) return;
  if (!(clinic ? LIVE_CLINIC : LIVE_APP).test(path) || busy(viewEl)) return;
  quietRunning = true;
  quietAt = Date.now();
  const started = renders;
  try {
    const fresh = document.createElement('main');
    fresh.id = 'view';
    fresh.className = viewEl.className;
    if (clinic) {
      const { default: clinicApp } = await import('./clinic/index.js');
      await clinicApp(fresh, path, { refresh: render });
    } else {
      const user = await currentUser();
      if (!isComplete(user)) return;
      const { view, params } = resolve(hash);
      await view(fresh, params, { user, refresh: render });
    }
    markHidden(fresh);
    // Mientras tanto se cambió de pantalla o la persona empezó a usarla.
    if (started !== renders || (location.hash || START) !== hash || busy(viewEl)) return;
    if (fresh.innerHTML === viewEl.innerHTML) return;
    const y = window.scrollY;
    // El menú de Clínica también tiene su propio scroll.
    const keep = ['.ck-side', '.ck-navs'].map((sel) => [sel, viewEl.querySelector(sel)]);
    viewEl.replaceWith(fresh);
    viewEl = fresh;
    keep.forEach(([sel, old]) => {
      const now = fresh.querySelector(sel);
      if (old && now) [now.scrollTop, now.scrollLeft] = [old.scrollTop, old.scrollLeft];
    });
    window.scrollTo(0, y);
  } catch (err) {
    console.warn('Pantalla sin actualizar', err);
  } finally {
    quietRunning = false;
  }
}

async function updateBadge(user) {
  user ??= await currentUser();
  const badge = document.querySelector('.bell .badge');
  if (!user) return (badge.hidden = true);
  await deliverPending(user);
  const list = await myNotifications(user);
  checkAlarms(list);
  const unread = list.filter((n) => !n.read).length;
  badge.hidden = !unread;
  badge.textContent = unread;
}

initAnalytics();
window.addEventListener('hashchange', render);
// Las pantallas avisan cuando cambian datos que afectan el contador de avisos.
window.addEventListener('petsafe:changed', () => updateBadge());
// Al volver a la app, y cada 30 s mientras está abierta, se buscan avisos
// nuevos: en iPhone la conexión en vivo se corta en segundo plano.
document.addEventListener('visibilitychange', () => document.hidden || updateBadge());
setInterval(() => document.hidden || updateBadge(), 30000);
// Las pantallas con datos que cambian se ponen al día al volver a la app, al
// llegar un aviso nuevo y, en Kiltrazo Clínica, cada 20 s.
document.addEventListener('visibilitychange', () => document.hidden || quietRender());
window.addEventListener('focus', () => quietRender());
window.addEventListener('petsafe:changed', () => /^#\/avisos/.test(location.hash) && quietRender());
setInterval(() => /^#\/(clinica|municipio|municipal)(\/|$)/.test(location.hash) && quietRender(), 20000);
// Al tocar una notificación con la app abierta, el Service Worker pide navegar.
navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data?.type === 'navigate') location.hash = e.data.url.replace(/^.*#/, '#');
  // Aviso push de "¡Encontraron a tu mascota!" con la app abierta.
  if (e.data?.type === 'alarm' && !document.hidden) startAlarm(e.data.notification);
});
// El navegador deja sonar la alarma solo después de un toque en la pantalla.
document.addEventListener('pointerdown', unlockAudio, { once: true });
// Vuelta desde un enlace del correo: confirmar el correo, o "Olvidé mi
// contraseña" (type=recovery), que lleva a crear una clave nueva.
// Dominio nuevo: la app de la dirección antigua lleva la cuenta a la nueva (ver move.js).
// Se revisa al abrir y al volver a la app (a lo más cada 10 minutos).
let moveChecked = 0;
const checkMove = () => {
  if (document.hidden || Date.now() - moveChecked < 600000) return;
  moveChecked = Date.now();
  leaveIfMoved().catch((err) => console.warn('Sin revisar la mudanza', err));
};
checkMove();
document.addEventListener('visibilitychange', checkMove);
(async () => {
  await arriveAfterMove();
  const recovery = /(^|[#&])type=recovery(&|$)/.test(location.hash);
  const error = await finishEmailLink().catch((err) => err.message);
  if (error !== null) {
    let to = '#/perfil';
    try { to = localStorage.getItem('petsafe-after-login') || to; localStorage.removeItem('petsafe-after-login'); } catch { /* sin almacenamiento */ }
    if (recovery && !error) {
      try { localStorage.setItem('petsafe-after-reset', to); } catch { /* sin almacenamiento */ }
      to = '#/clave';
    }
    history.replaceState(null, '', location.pathname + to);
    if (error) alert(`El enlace no sirvió (${error}). Pide uno nuevo desde la app.`);
  }
  render();
})();
