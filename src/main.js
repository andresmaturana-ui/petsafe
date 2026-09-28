import './styles.css';
import { registerSW } from 'virtual:pwa-register';
import { currentUser, myNotifications, deliverPending } from './data.js';
import { PAW, esc, isComplete } from './ui.js';

import home from './views/home.js';
import profile from './views/profile.js';
import register from './views/register.js';
import lost from './views/lost.js';
import found from './views/found.js';
import match from './views/match.js';
import recovered from './views/recovered.js';
import success from './views/success.js';
import inbox from './views/inbox.js';
import admin from './views/admin.js';

registerSW({ immediate: true });

const routes = [
  ['', home],
  ['perfil', profile],
  ['registrar', register],
  ['perdi', lost],
  ['encontre', found],
  ['encontrada/:id', match],
  ['recuperada', recovered],
  ['caso/:id', success],
  ['avisos', inbox],
  ['admin', admin],
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
    <a href="#/" class="brand"><span class="brand-paw">${PAW}</span> Pet Safe</a>
    <a href="#/avisos" class="bell" aria-label="Avisos">🔔<span class="badge" hidden></span></a>
  </header>
  <main id="view"></main>
  <nav class="tabbar">
    <a href="#/" data-tab="">🏠<span>Inicio</span></a>
    <a href="#/registrar" data-tab="registrar">🐶<span>Registrar</span></a>
    <a href="#/avisos" data-tab="avisos">🔔<span>Avisos</span></a>
    <a href="#/perfil" data-tab="perfil">🙂<span>Perfil</span></a>
  </nav>`;

const viewEl = document.getElementById('view');

async function render() {
  const user = await currentUser();
  const hash = location.hash || '#/';
  let { view, params } = resolve(hash);
  // Primer uso, o perfil creado antes de pedir todos los datos: completar perfil.
  if (!isComplete(user) && view !== profile && view !== admin) view = profile;

  const tab = hash.replace(/^#\/?/, '').split('/')[0];
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));

  viewEl.innerHTML = '';
  viewEl.className = 'view';
  window.scrollTo(0, 0);
  try {
    await view(viewEl, params, { user, refresh: render });
  } catch (err) {
    console.error(err);
    viewEl.innerHTML = `<div class="card"><h2>Ups…</h2><p>${esc(err.message)}</p></div>`;
  }
  await updateBadge(user);
}

async function updateBadge(user) {
  user ??= await currentUser();
  const badge = document.querySelector('.bell .badge');
  if (!user) return (badge.hidden = true);
  await deliverPending(user);
  const unread = (await myNotifications(user)).filter((n) => !n.read).length;
  badge.hidden = !unread;
  badge.textContent = unread;
}

window.addEventListener('hashchange', render);
// Las pantallas avisan cuando cambian datos que afectan el contador de avisos.
window.addEventListener('petsafe:changed', () => updateBadge());
// Al tocar una notificación con la app abierta, el Service Worker pide navegar.
navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data?.type === 'navigate') location.hash = e.data.url.replace(/^.*#/, '#');
});
render();
