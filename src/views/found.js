import { reportFound, CLOUD } from '../data.js';
import { mountScanner } from '../scanner.js';
import { pickPoint } from '../map.js';
import { esc, getLocation } from '../ui.js';

// Pantalla 3: encontré una mascota.
// A quien la encontró solo se le muestran los cuidados (vacunas y
// enfermedades). Ningún dato del dueño, para evitar pedidos de recompensa u
// otros usos malintencionados: solo el dueño puede iniciar el contacto.
export default async function found(el, _params, { user }) {
  el.innerHTML = `
    <div class="card">
      <h1>Encontré una mascota</h1>
      <p>Toma dos fotos de su cara desde ángulos un poco distintos y, si se deja, una de su nariz de cerca. Si está registrada, le avisamos a su dueño de inmediato.</p>
      <div id="scanner"></div>
    </div>
    <div class="card" id="details" hidden>
      <h2>¿Dónde está?</h2>
      <p class="muted">Usamos tu ubicación; toca el mapa para ajustarla.</p>
      <div class="map" id="map"></div>
      <form class="form" id="foundform">
        <label>Tu nombre<input name="finderName" required value="${esc(user.name)}"></label>
        <label>Tu teléfono (WhatsApp)<input name="finderPhone" type="tel" required value="${esc(user.phone)}"></label>
        <p class="muted small">Solo el dueño verá tu nombre y teléfono para contactarte.</p>
        <button class="btn primary big">Enviar aviso</button>
      </form>
    </div>
    <div id="result"></div>`;

  let scan = null;
  let point = null;

  mountScanner(el.querySelector('#scanner'), {
    mode: 'identify',
    label: 'Escanear mascota',
    async onDone(result) {
      scan = result;
      const details = el.querySelector('#details');
      details.hidden = false;
      details.scrollIntoView({ behavior: 'smooth' });
      const picker = pickPoint(el.querySelector('#map'), null, (p) => (point = p));
      const loc = await getLocation();
      if (loc) picker.set(loc);
    },
  });

  el.querySelector('#foundform').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!scan) return;
    if (!point) return alert('Marca en el mapa dónde está la mascota');
    const f = new FormData(e.target);
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    const { care, compared, ownMatch, report } = await reportFound(user, {
      photo: scan.photo,
      biometric: scan.biometric,
      lat: point.lat,
      lng: point.lng,
      finderName: f.get('finderName').trim(),
      finderPhone: f.get('finderPhone').trim(),
    });
    el.querySelector('#details').hidden = true;
    el.querySelector('#scanner').closest('.card').hidden = true;
    const result = el.querySelector('#result');
    result.innerHTML = care
      ? `
        <div class="card center success-banner">
          <div class="empty-emoji">🎉</div>
          <h2>¡Está registrada! Ya avisamos a su dueño</h2>
          <p>Te contactará pronto. Mientras tanto, estos son sus cuidados:</p>
        </div>
        <div class="card care">
          <h3>💉 Vacunas</h3>
          <p>${esc(care.vaccines) || 'Sin información'}</p>
          <h3>🩺 Enfermedades y cuidados</h3>
          <p>${esc(care.diseases) || 'Sin información'}</p>
        </div>
        <a class="btn secondary" href="#/">Volver al inicio</a>`
      : `
        <div class="card center">
          <div class="empty-emoji">📋</div>
          <h2>No la encontramos registrada</h2>
          <p>Guardamos tu aviso. Si su dueño la reporta como perdida, le llegará tu contacto automáticamente.</p>
          ${diagnostic(compared, ownMatch, report.bestScore)}
          <a class="btn secondary" href="#/">Volver al inicio</a>
        </div>`;
    result.scrollIntoView({ behavior: 'smooth' });
  });
}

// Pistas para entender por qué no hubo coincidencia (prototipo).
function diagnostic(compared, ownMatch, bestScore) {
  if (ownMatch) {
    return `<p class="note">Se parece a <strong>${esc(ownMatch)}</strong>, que es tu propia mascota. Para probar, cambia a otro usuario en Perfil.</p>`;
  }
  if (!compared) {
    return CLOUD
      ? '<p class="note">Todavía no hay mascotas registradas por otros usuarios.</p>'
      : '<p class="note">En este navegador no hay mascotas de otros usuarios. Por ahora los registros se guardan solo en el dispositivo donde se hicieron.</p>';
  }
  return `<p class="note">Comparamos con ${compared} mascota${compared === 1 ? '' : 's'}. Parecido más alto: ${Math.round((bestScore || 0) * 100)}%.</p>`;
}
