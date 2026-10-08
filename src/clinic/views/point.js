// Punto de reconocimiento facial: una pantalla sola, para ferias, operativos o
// el mesón de la clínica. Tres pasos: filmar la cara, poner el nombre y el
// dueño, y entregársela al dueño con un QR o por WhatsApp. Queda como ficha
// en Pacientes (o Animales), igual que si se hubiera creado a mano.

import { esc, toast } from '../../ui.js';
import { pointRegister, isMuni } from '../data.js';
import { waLink } from '../ui.js';
import { brandWithLogo } from '../logo.js';

const KINDS = [['perro', '🐶 Perro'], ['gato', '🐱 Gato'], ['otro', '🐾 Otro']];

export default function point(el, _params, { clinic, me }) {
  const muni = isMuni(clinic);
  const owner = muni ? 'responsable' : 'dueño';
  let shot = null;

  const steps = (n) => `
    <ol class="ck-point-steps">
      ${['Filmar su cara', 'Sus datos', `Entregar al ${owner}`].map((t, i) => `<li class="${i + 1 === n ? 'on' : i + 1 < n ? 'done' : ''}"><b>${i + 1 < n ? '✓' : i + 1}</b>${t}</li>`).join('')}
    </ol>`;

  function film() {
    shot = null;
    el.innerHTML = `
      ${steps(1)}
      <div class="card ck-point-card">
        <h1>Filma la cara de la mascota</h1>
        <p class="muted">Mueve el celular despacio alrededor de su cara, como Face ID. Kiltrazo guarda solo las tomas que sirven.</p>
        <div id="ck-point-scan"></div>
      </div>`;
    import('../../scanner.js').then(({ mountScanner }) => mountScanner(el.querySelector('#ck-point-scan'), {
      mode: 'enroll',
      label: 'Empezar a filmar',
      doneText: '¡Cara guardada!',
      onDone(result) {
        shot = result;
        setTimeout(data, 700);
      },
    }));
  }

  function data() {
    el.innerHTML = `
      ${steps(2)}
      <form class="card form ck-point-card" id="ck-point-form">
        <div class="ck-point-pet">
          <img src="${esc(shot.photo)}" alt="">
          <span class="ck-scan-ok">✓ Cara guardada</span>
        </div>
        <label>Nombre de la mascota<input name="name" required maxlength="80" autocomplete="off" placeholder="Ej.: Luna"></label>
        <div class="ck-point-kinds" role="radiogroup" aria-label="Especie">
          ${KINDS.map(([v, t], i) => `<label class="spec-chip"><input type="radio" name="species" value="${v}" ${i ? '' : 'checked'}><span>${t}</span></label>`).join('')}
        </div>
        <label>Nombre del ${owner}<input name="tutorName" maxlength="80" autocomplete="off" placeholder="Ej.: Camila Rojas"></label>
        <label>Celular del ${owner} (WhatsApp)<input name="tutorPhone" type="tel" autocomplete="off" placeholder="+56 9 1234 5678"></label>
        <button class="btn primary big">Guardar y entregar</button>
        <button type="button" class="link small" id="ck-point-again">Filmar de nuevo</button>
      </form>`;
    const form = el.querySelector('#ck-point-form');
    form.name.focus();
    el.querySelector('#ck-point-again').addEventListener('click', film);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(form));
      const btn = form.querySelector('button.primary');
      btn.disabled = true;
      try {
        const p = { name: f.name.trim(), species: f.species, photo: shot.photo, scan: shot.biometric, tutorName: f.tutorName.trim(), tutorPhone: f.tutorPhone.trim() };
        const { id, code } = await pointRegister(clinic.id, p);
        await give({ ...p, id }, code);
      } catch (err) {
        toast(err.message, 'bad');
        btn.disabled = false;
      }
    });
  }

  async function give(p, code) {
    const url = `${location.origin}${location.pathname}#/recibir/${code}`;
    const hi = `Hola${p.tutorName ? ` ${p.tutorName.split(' ')[0]}` : ''}`;
    const msg = `${hi}, te dejamos a ${p.name} en Kiltrazo, la app gratis con reconocimiento facial para volver a casa si algún día se pierde. Tócalo para agregarlo a tu celular: ${url}`;
    const wa = waLink(p.tutorPhone);
    const QR = (await import('qrcode')).default;
    el.innerHTML = `
      ${steps(3)}
      <div class="card ck-point-card ck-point-give">
        <h1>Entrega a ${esc(p.name)}</h1>
        <p>Que el ${owner} apunte la cámara de su celular a este código. ${esc(p.name)} queda en su Kiltrazo, con la cara ya filmada.</p>
        <img class="ck-point-qr" alt="Código para el ${owner}" src="${await QR.toDataURL(url, { margin: 1, width: 320, color: { dark: '#4a3428' } })}">
        <p class="small muted">Sirve una vez y dura 7 días.</p>
        <div class="ck-point-btns">
          <a class="btn whatsapp" href="${wa ? `${wa}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`}" target="_blank" rel="noopener">Enviar por WhatsApp</a>
          <button type="button" class="btn ghost" data-copy>Copiar enlace</button>
        </div>
        <button type="button" class="btn primary big" id="ck-point-next">Registrar otra mascota</button>
        ${me?.role === 'punto' || clinic.kind === 'kiltrazo' ? '' : `<a class="small" href="#/clinica/paciente/${esc(p.id)}">Ver ficha de ${esc(p.name)}</a>`}
      </div>`;
    el.querySelector('[data-copy]').addEventListener('click', () => navigator.clipboard?.writeText(url).then(() => toast('Enlace copiado', 'ok')));
    el.querySelector('#ck-point-next').addEventListener('click', film);
  }

  film();
}

/** El punto a pantalla completa, sin menú: arriba el logo, dónde y cómo salir. */
export function pointScreen(el, { clinic, me, exit }) {
  const brand = clinic.logo ? brandWithLogo(clinic.logo, clinic.name, isMuni(clinic) ? 'Municipal' : 'Clínica') : '<img src="brand/kiltrazo.svg" alt="Kiltrazo" class="ck-logo">';
  el.innerHTML = `
    <div class="ck-point">
      <header class="ck-point-top">
        ${brand}
        <span class="ck-point-where">${esc(clinic.name)}</span>
        ${exit}
      </header>
      <section class="ck-point-main" id="ck-main"></section>
    </div>`;
  return point(el.querySelector('#ck-main'), {}, { clinic, me });
}
