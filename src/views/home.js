import { latestSuccesses, countComments, myPets } from '../data.js';
import { esc, timeAgo } from '../ui.js';

export default async function home(el, _params, { user }) {
  const [successes, counts, pets] = await Promise.all([latestSuccesses(6), countComments(), myPets(user)]);
  const lostPets = pets.filter((p) => p.status === 'lost');

  el.innerHTML = `
    <section class="hero">
      <h1>Hola, ${esc(user.name.split(' ')[0])} 👋</h1>
      <p>Juntos llevamos a cada mascota de vuelta a casa.</p>
    </section>

    ${lostPets.length ? `
      <div class="alert-strip">
        <strong>Aviso activo:</strong> buscando a ${lostPets.map((p) => esc(p.name)).join(', ')}.
      </div>` : ''}

    <section class="big-actions">
      <a class="big-btn lost" href="#/perdi">
        <span class="big-emoji">😢</span>
        <span><strong>Perdí mi mascota</strong><small>Activa el aviso y buscamos coincidencias</small></span>
      </a>
      <a class="big-btn found" href="#/encontre">
        <span class="big-emoji">🔍</span>
        <span><strong>Encontré una mascota</strong><small>Escanea su cara y avisamos al dueño</small></span>
      </a>
      <a class="big-btn home" href="#/recuperada">
        <span class="big-emoji">🏡</span>
        <span><strong>Ya encontré mi mascota</strong><small>Quita el aviso de mascota perdida</small></span>
      </a>
    </section>

    <a class="register-cta" href="#/registrar">
      <span>🐾</span>
      <span><strong>Registrar mascota</strong><small>Gratis · escaneo facial en segundos</small></span>
      <span class="chev">›</span>
    </a>

    <section>
      <h2 class="section-title">Reencuentros felices 💛</h2>
      ${successes.length ? `
        <div class="success-grid">
          ${successes.map((s) => `
            <a class="success-card" href="#/caso/${s.id}">
              <img src="${esc(s.photo)}" alt="${esc(s.petName)}" loading="lazy">
              <div class="success-body">
                <strong>${esc(s.petName)}</strong>
                <small>${timeAgo(s.createdAt)} · 💬 ${counts[s.id] || 0}</small>
              </div>
            </a>`).join('')}
        </div>` : `
        <div class="empty">
          <div class="empty-emoji">🐕‍🦺</div>
          <p>Aquí aparecerán los últimos 6 reencuentros.</p>
        </div>`}
    </section>`;
}
