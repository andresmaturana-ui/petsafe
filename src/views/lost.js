import { myPets, reportLost } from '../data.js';
import { esc, go, changed } from '../ui.js';
import { describe } from '../breeds.js';

// "Perdí mi mascota": activa el aviso y busca en los avisos de "encontré".
export default async function lost(el, _params, { user }) {
  const pets = await myPets(user);

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
      <p>¿Cuál de tus mascotas se perdió? Buscaremos entre las mascotas que otras personas encontraron.</p>
      <div class="pick-list">
        ${pets.map((p) => `
          <button class="pick" data-id="${p.id}">
            <img src="${esc(p.photo)}" alt="">
            <span><strong>${esc(p.name)}</strong><small>${[describe(p), p.status === 'lost' ? 'Aviso activo · buscar otra vez' : 'En casa'].filter(Boolean).map(esc).join(' · ')}</small></span>
          </button>`).join('')}
      </div>
    </div>
    <div id="result"></div>`;

  el.querySelectorAll('.pick').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const pet = pets.find((p) => p.id === btn.dataset.id);
      const result = el.querySelector('#result');
      result.innerHTML = `<div class="card center"><div class="spinner"></div><p>Buscando a ${esc(pet.name)}…</p></div>`;
      result.scrollIntoView({ behavior: 'smooth' });
      const match = await reportLost(pet);
      changed();
      if (match) return go(`#/encontrada/${match.id}`);
      result.innerHTML = `
        <div class="card center">
          <div class="empty-emoji">📣</div>
          <h2>Aviso activo para ${esc(pet.name)}</h2>
          <p>Todavía nadie la ha escaneado. Te enviaremos una notificación al celular apenas alguien la encuentre.</p>
          <a class="btn secondary" href="#/">Volver al inicio</a>
        </div>`;
    }),
  );
}
