import { reportFound, confirmFound, logTagVisit, CLOUD } from '../data.js';
import { mountScanner } from '../scanner.js';
import { pickPoint } from '../map.js';
import { esc, getLocation, timeAgo, toast } from '../ui.js';
import { describe } from '../breeds.js';

// Pantalla 3: encontré una mascota.
// A quien la encontró solo se le muestran los cuidados (vacunas y
// enfermedades). Ningún dato del dueño, para evitar pedidos de recompensa u
// otros usos malintencionados: solo el dueño puede iniciar el contacto.
//
// Con { placa: true } es la página del QR de la placa del collar (#/placa):
// funciona sin cuenta ni perfil y solo pide un teléfono de contacto. Con
// { facebook: true } es lo mismo, para quien llega desde una publicación de
// mascota perdida en la página de Facebook de Kiltrazo (#/vi).
export default async function found(el, { placa = false, facebook = false } = {}, { user }) {
  if (facebook) placa = true;
  else if (placa) countVisit();
  el.innerHTML = `
    ${placa ? `
    <header class="fd-top tag-top"><a href="#/kiltrazo" class="fd-brand"><img src="brand/kiltrazo.svg" alt="Kiltrazo"></a></header>
    <div class="card">
      <span class="ld-pill">🐾 Gracias por ayudar</span>
      <h1>Escanea su cara para que vuelva a casa</h1>
      <p>Filma la carita de la mascota moviendo el celular despacio; la app toma sola las capturas. Si está registrada en Kiltrazo, le avisamos a su dueño al instante. <strong>No necesitas crear cuenta.</strong></p>
      <div id="scanner"></div>
    </div>
    ${facebook ? '' : `<a class="card tag-only" href="#/kiltrazo">
      <span>🏷️</span><span><strong>¿Solo encontraste la placa?</strong><small>Conoce Kiltrazo: registra gratis a tu mascota con su cara.</small></span>
    </a>`}` : `
    <div class="card">
      <h1>Encontré una mascota</h1>
      <p>Escanéala igual que al registrar una mascota: filma su cara moviendo el celular despacio (la app toma sola 5 capturas) y, si se deja, acerca el celular a su nariz. Más capturas = más fácil reconocerla. Si está registrada, le avisamos a su dueño de inmediato.</p>
      <div id="scanner"></div>
    </div>`}
    <div class="card" id="details" hidden>
      <p class="scan-ok">✅ ¡Escaneo listo! Ahora marca dónde está y envía el aviso.</p>
      <h2>¿Dónde está?</h2>
      <p class="muted">Usamos tu ubicación; toca el mapa para ajustarla.</p>
      <div class="map" id="map"></div>
      <form class="form" id="foundform">
        <label>¿Qué es?<select name="species">
          <option value="">No estoy seguro</option>
          <option value="perro">Un perro</option>
          <option value="gato">Un gato</option>
        </select></label>
        ${placa ? '' : `<label>Tu nombre<input name="finderName" required value="${esc(user?.name)}"></label>`}
        <label>Tu ${placa ? 'WhatsApp o teléfono' : 'teléfono (WhatsApp)'}<input name="finderPhone" type="tel" required placeholder="9 1234 5678" value="${esc(user?.phone)}"></label>
        <p class="muted small">Solo el dueño verá ${placa ? 'tu número' : 'tu nombre y teléfono'} para contactarte.</p>
        <button class="btn primary big">Enviar aviso</button>
      </form>
    </div>
    <div id="result"></div>`;

  let scan = null;
  let point = null;

  mountScanner(el.querySelector('#scanner'), {
    // Mismo escaneo que al registrar: 5 ángulos y nariz. Con más capturas la
    // comparación encuentra el ángulo más parecido del registro.
    mode: 'enroll',
    label: 'Escanear mascota',
    doneText: '¡Escaneo listo!',
    async onDone(result) {
      scan = result;
      const details = el.querySelector('#details');
      details.hidden = false;
      toast('✅ Escaneo listo', 'ok');
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
    btn.textContent = 'Enviando aviso…';
    let res;
    try {
      res = await reportFound(user, {
      photo: scan.photo,
      biometric: scan.biometric,
      lat: point.lat,
      lng: point.lng,
      species: f.get('species'),
      finderName: (f.get('finderName') || '').trim(),
      finderPhone: f.get('finderPhone').trim(),
      source: facebook ? 'facebook' : placa ? 'placa' : '',
      });
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Enviar aviso';
      alert(`No se pudo enviar el aviso: ${err.message}. Revisa tu conexión e inténtalo de nuevo.`);
      return;
    }
    const { care, compared, ownMatch, report, suggestions = [] } = res;
    el.querySelector('#details').hidden = true;
    el.querySelector('#scanner').closest('.card').hidden = true;
    el.querySelector('.tag-only')?.remove();
    // Desde la placa no hay "inicio" al que volver: se invita a conocer Kiltrazo.
    const end = placa
      ? `<div class="card center tag-next">
          <div class="empty-emoji">🐶</div>
          <h2>Ahora escanea a tus mascotas</h2>
          <p>Así de fácil funciona Kiltrazo. Registra gratis a tu perro o gato con su cara: si algún día se pierde, su cara lo trae de vuelta.</p>
          <a class="btn primary big" href="#/perfil">Crear mi cuenta gratis</a>
          <p class="small"><a href="#/kiltrazo">Conocer más de Kiltrazo</a></p>
        </div>`
      : '<a class="btn secondary" href="#/">Volver al inicio</a>';
    const result = el.querySelector('#result');
    const matched = (c) => `
        <div class="card center success-banner">
          <div class="empty-emoji">🎉</div>
          <h2>✅ Aviso enviado. ¡Ya avisamos a su dueño!</h2>
          <p>Te contactará pronto. Mientras tanto, estos son sus cuidados:</p>
        </div>
        <div class="card care">
          <h3>💉 Vacunas</h3>
          <p>${esc(c.vaccines) || 'Sin información'}</p>
          <h3>🩺 Enfermedades y cuidados</h3>
          <p>${esc(c.diseases) || 'Sin información'}</p>
        </div>
        ${end}`;
    result.innerHTML = care
      ? matched(care)
      : `
        <div class="card center">
          <div class="empty-emoji">📋</div>
          <h2>✅ Aviso enviado</h2>
          <p>${suggestions.length
            ? 'No hay una coincidencia segura, pero estas mascotas perdidas se parecen. Si es una de ellas, tócala y le avisamos a su dueño.'
            : 'Por ahora no la encontramos registrada. Tu aviso queda activo: si su dueño la reporta como perdida, aunque sea después, le llegará tu contacto automáticamente.'}</p>
          ${suggestions.length || placa ? '' : diagnostic(compared, ownMatch, report.bestScore)}
        </div>
        ${suggestions.length ? `
          <div class="card">
            <h2>¿Es alguna de estas?</h2>
            <ul class="pet-list suggestions">
              ${suggestions.map((p) => `
                <li><img src="${esc(p.photo)}" alt=""><span><strong>${esc(p.name)}</strong><small>${[describe(p), p.lostAt && `perdida ${timeAgo(p.lostAt)}`, `parecido ${Math.round(p.score * 100)}%`].filter(Boolean).map(esc).join(' · ')}</small></span>
                <button class="btn small primary" data-pet="${esc(p.id)}">¡Es esta!</button></li>`).join('')}
            </ul>
            <p class="muted small">Si ninguna es, no hagas nada: tu aviso queda guardado.</p>
          </div>` : ''}
        ${end}`;
    result.querySelectorAll('[data-pet]').forEach((b) =>
      b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          result.innerHTML = matched(await confirmFound(user, report.id, b.dataset.pet));
          result.scrollIntoView({ behavior: 'smooth' });
        } catch (err) {
          toast(err.message);
          b.disabled = false;
        }
      }),
    );
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

// Cuenta una visita a la página de la placa, una sola vez por dispositivo.
function countVisit() {
  const key = 'kiltrazo-placa-visita';
  try {
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, new Date().toISOString());
  } catch { return; }
  logTagVisit().catch((err) => console.warn('Visita de la placa sin contar', err));
}
