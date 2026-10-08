import { myPets, reportLost, claimFound, facebookPage } from '../data.js';
import { esc, go, changed, timeAgo, toast, getLocation } from '../ui.js';
import { describe } from '../breeds.js';
import { pickPoint } from '../map.js';
import { NEARBY_KM } from '../geo.js';

// "Perdí mi mascota": el dueño marca dónde se perdió, avisamos a las personas
// a 5 km y buscamos en los avisos de "encontré".
export default async function lost(el, _params, { user }) {
  const [pets, fbPage] = await Promise.all([myPets(user), facebookPage().catch(() => null)]);

  if (!pets.length) {
    el.innerHTML = `
      <div class="card center">
        <div class="empty-emoji">🐶</div>
        <h1>Primero registra a tu mascota</h1>
        <p>Para buscarla necesitamos su biometría facial.</p>
        <a class="btn primary big" href="#/registrar">Registrar mascota</a>
      </div>`;
    return;
  }

  el.innerHTML = `
    <div class="card">
      <h1>Perdí mi mascota</h1>
      <p>¿Cuál de tus mascotas se perdió? Avisaremos a las personas cerca y buscaremos entre las mascotas que otras personas encontraron.</p>
      <div class="pick-list">
        ${pets.map((p) => `
          <button class="pick" data-id="${p.id}">
            <img src="${esc(p.photo)}" alt="">
            <span><strong>${esc(p.name)}</strong><small>${[describe(p), p.status === 'lost' ? 'Aviso activo · buscar otra vez' : 'En casa'].filter(Boolean).map(esc).join(' · ')}</small></span>
          </button>`).join('')}
      </div>
    </div>
    <div id="where"></div>
    <div id="result"></div>`;

  // Paso 2: dónde se perdió. Si el aviso ya estaba activo con su punto, se busca directo.
  el.querySelectorAll('.pick').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const pet = pets.find((p) => p.id === btn.dataset.id);
      el.querySelectorAll('.pick').forEach((b) => b.classList.toggle('selected', b === btn));
      el.querySelector('#result').innerHTML = '';
      const where = el.querySelector('#where');
      if (pet.status === 'lost' && pet.lostLat != null) {
        where.innerHTML = '';
        return activate(pet, null);
      }
      let point = null;
      where.innerHTML = `
        <div class="card">
          <h2>¿Dónde se perdió ${esc(pet.name)}?</h2>
          <p class="muted">Usamos tu ubicación; toca el mapa para marcar dónde la viste por última vez.</p>
          <div class="map" id="lostmap"></div>
          <p class="note">📣 Avisaremos a las personas de Kiltrazo que estén a ${NEARBY_KM} km o menos de este punto. Verán su foto, su nombre y la zona aproximada, nunca tus datos.</p>
          ${fbPage ? `
          <label class="consent fb-share"><input type="checkbox" data-fb checked>
            <span>Publicar también en ${social(fbPage)} (su foto, su nombre y el sector). La borramos sola cuando vuelva a casa.</span></label>` : ''}
          <button class="btn primary big" data-send>Avisar a los vecinos</button>
          <button class="btn ghost" data-skip>Seguir sin avisar cerca</button>
        </div>`;
      where.scrollIntoView({ behavior: 'smooth' });
      const picker = pickPoint(where.querySelector('#lostmap'), null, (p) => (point = p));
      getLocation().then((loc) => loc && !point && picker.set(loc));
      const fb = () => (fbPage ? where.querySelector('[data-fb]').checked : null);
      where.querySelector('[data-send]').addEventListener('click', () => {
        if (!point) return alert('Marca en el mapa dónde se perdió');
        const share = fb();
        where.innerHTML = '';
        activate(pet, point, share);
      });
      where.querySelector('[data-skip]').addEventListener('click', () => {
        const share = fb();
        where.innerHTML = '';
        activate(pet, null, share);
      });
    }),
  );

  async function activate(pet, point, fb = null) {
    const result = el.querySelector('#result');
    result.innerHTML = `<div class="card center"><div class="spinner"></div><p>${point ? 'Avisando a los vecinos y buscando' : 'Buscando'} a ${esc(pet.name)}…</p></div>`;
    result.scrollIntoView({ behavior: 'smooth' });
    let res;
    try {
      res = await reportLost(pet, point, fb);
    } catch (err) {
      result.innerHTML = `<div class="card center"><h2>No se pudo activar el aviso</h2><p>${esc(err.message)}</p><p class="muted">Revisa tu conexión e inténtalo de nuevo.</p></div>`;
      return;
    }
    changed();
    if (res.match) return go(`#/encontrada/${res.match.id}`);
    result.innerHTML = `
      <div class="card center">
        <div class="empty-emoji">📣</div>
        <h2>Aviso activo para ${esc(pet.name)}</h2>
        ${neighbors(res.notified)}
        ${fb ? `<p class="note">📣 Lo publicaremos en ${social(fbPage)}. Cuando vuelva a casa, la publicación se borra sola.</p>` : ''}
        <p>${res.suggestions.length ? 'No hay una coincidencia segura, pero alguien encontró mascotas parecidas. ¿Es alguna de estas?' : 'Todavía nadie la ha escaneado. Te enviaremos una notificación apenas alguien la encuentre.'}</p>
      </div>
      ${res.suggestions.length ? `
        <div class="card">
          <h2>¿Es ${esc(pet.name)}?</h2>
          <ul class="pet-list suggestions">
            ${res.suggestions.map((f) => `
              <li><img src="${esc(f.photo)}" alt=""><span><strong>Encontrada ${timeAgo(f.createdAt)}</strong><small>Parecido ${Math.round(f.score * 100)}%</small></span>
              <button class="btn small primary" data-claim="${esc(f.id)}">¡Es ${esc(pet.name)}!</button></li>`).join('')}
          </ul>
          <p class="muted small">Si es tu mascota, verás dónde está y el contacto de quien la encontró.</p>
        </div>` : ''}
      <a class="btn secondary" href="#/">Volver al inicio</a>`;
    result.querySelectorAll('[data-claim]').forEach((b) =>
      b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          await claimFound(pet, b.dataset.claim);
          go(`#/encontrada/${b.dataset.claim}`);
        } catch (err) {
          toast(err.message);
          b.disabled = false;
        }
      }),
    );
  }
}

// Cuántas personas cerca recibieron el aviso.
function neighbors(n) {
  if (n == null) return '';
  if (!n) return `<p class="note">Por ahora nadie a ${NEARBY_KM} km activó los avisos cerca. Si alguien la escanea, igual te avisamos.</p>`;
  return `<p class="scan-ok">📣 Avisamos a ${n} persona${n === 1 ? '' : 's'} a ${NEARBY_KM} km o menos.</p>`;
}

// "el Facebook y el Instagram de Kiltrazo", con sus enlaces.
function social({ facebook, instagram }) {
  const link = (url, name) => `<a href="${esc(url)}" target="_blank" rel="noopener">${name}</a>`;
  return instagram
    ? `el ${link(facebook, 'Facebook')} y el ${link(instagram, 'Instagram')} de Kiltrazo`
    : `la ${link(facebook, 'página de Facebook de Kiltrazo')}`;
}
