import { getFound, getPet, myNotifications, markRead } from '../data.js';
import { showPoint, TRAVEL_MODES, directionsUrl } from '../map.js';
import { esc, timeAgo, changed } from '../ui.js';

// Pantalla 2: mascota encontrada (solo para el dueño).
export default async function match(el, { id }, { user }) {
  const report = await getFound(id);
  const pet = report?.petId ? await getPet(report.petId) : null;

  if (!report || !pet || pet.ownerId !== user.id) {
    el.innerHTML = `<div class="card center"><div class="empty-emoji">🔒</div><h2>Aviso no disponible</h2><p>Solo el dueño de la mascota puede ver este aviso.</p><a class="btn secondary" href="#/">Volver</a></div>`;
    return;
  }

  for (const n of await myNotifications(user)) {
    if (!n.read && n.url === `#/encontrada/${id}`) await markRead(n);
  }
  changed();

  const phone = waNumber(report.finderPhone);
  const waText = encodeURIComponent(`Hola ${report.finderName}, soy el dueño de ${pet.name}. ¡Gracias por encontrarla! ¿Cómo coordinamos?`);

  el.innerHTML = `
    <div class="card center success-banner">
      <div class="empty-emoji">🥳</div>
      <h1>¡Encontraron a ${esc(pet.name)}!</h1>
      <p>${esc(report.finderName)} la escaneó ${timeAgo(report.createdAt)}.</p>
      <div class="compare">
        <figure><img src="${esc(pet.photo)}" alt=""><figcaption>Tu registro</figcaption></figure>
        <figure><img src="${esc(report.photo)}" alt=""><figcaption>Foto de hoy</figcaption></figure>
      </div>
    </div>

    <div class="contact-row">
      <a class="btn call big" href="tel:${esc(report.finderPhone)}">📞 Llamar</a>
      <a class="btn whatsapp big" href="https://wa.me/${phone}?text=${waText}" target="_blank" rel="noopener">💬 WhatsApp</a>
    </div>

    <div class="card">
      <h2>¿Dónde está?</h2>
      <div class="map tall" id="map"></div>
      <h3>Cómo llegar</h3>
      <div class="travel">
        ${TRAVEL_MODES.map((m) => `
          <a class="travel-btn" href="${directionsUrl(report, m.mode)}" target="_blank" rel="noopener">
            <span>${m.icon}</span>${m.label}
          </a>`).join('')}
      </div>
    </div>

    <a class="btn home big" href="#/recuperada">🏡 Ya la recuperé</a>`;

  showPoint(el.querySelector('#map'), report);
}

// wa.me necesita el número en formato internacional, solo dígitos.
// Si viene un celular chileno sin código de país (9XXXXXXXX) se agrega el 56.
function waNumber(raw = '') {
  const digits = raw.replace(/\D/g, '').replace(/^00/, '');
  return /^9\d{8}$/.test(digits) ? '56' + digits : digits;
}
