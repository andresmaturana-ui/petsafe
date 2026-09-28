import { myPets, markRecovered } from '../data.js';
import { esc, toast, go, changed } from '../ui.js';

// "Ya encontré mi mascota": quita el aviso y comparte el reencuentro.
export default async function recovered(el, _params, { user }) {
  const lostPets = (await myPets(user)).filter((p) => p.status === 'lost');

  if (!lostPets.length) {
    el.innerHTML = `
      <div class="card center">
        <div class="empty-emoji">😊</div>
        <h1>No tienes avisos activos</h1>
        <p>Ninguna de tus mascotas está marcada como perdida.</p>
        <a class="btn secondary" href="#/">Volver al inicio</a>
      </div>`;
    return;
  }

  el.innerHTML = `
    <div class="card">
      <h1>¡Qué alegría! 🏡</h1>
      <p>¿Cuál de tus mascotas volvió a casa? Quitaremos el aviso de mascota perdida.</p>
      <form class="form" id="form">
        <div class="pick-list">
          ${lostPets.map((p, i) => `
            <label class="pick">
              <input type="radio" name="pet" value="${p.id}" ${i === 0 ? 'checked' : ''}>
              <img src="${esc(p.photo)}" alt="">
              <span><strong>${esc(p.name)}</strong><small>Perdida ${new Date(p.lostAt).toLocaleDateString('es')}</small></span>
            </label>`).join('')}
        </div>
        <label>Cuéntanos cómo fue (opcional)<textarea name="story" rows="3" placeholder="Se aparecerá en Reencuentros felices"></textarea></label>
        <button class="btn home big">Quitar aviso</button>
      </form>
    </div>`;

  el.querySelector('#form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const pet = lostPets.find((p) => p.id === f.get('pet'));
    await markRecovered(pet, f.get('story').trim());
    changed();
    toast(`¡Bienvenida a casa, ${pet.name}! 💛`, 'ok');
    go('#/');
  });
}
