// "Mi veterinaria" en el perfil del tutor: el código (y QR) para que su
// clínica vincule a la mascota en Kiltrazo Clínica, y lo que la clínica
// registró: vacunas, próximas horas y documentos (consentimientos para
// firmar, recetas y certificados). Las notas clínicas no se muestran.
// Desde aquí también se pide hora en la clínica o a domicilio.

import { esc, toast, getLocation } from '../ui.js';
import { currentUser } from '../data.js';
import { track } from '../analytics.js';
import { createPetCode, petHealth, unlinkPet, requestAppointment, cancelMyAppointment, availableSlots } from '../clinic/data.js';

const SERVICES = { consulta: 'Consulta', control: 'Control', vacuna: 'Vacuna', cirugia: 'Cirugía', peluqueria: 'Peluquería', otro: 'Hora' };
const STATUS = {
  solicitada: ['Esperando confirmación', 'wait'],
  agendada: ['Confirmada', 'ok'],
  en_camino: ['La veterinaria va en camino 🚗', 'go'],
};
const DOC_STATUS = { por_firmar: ['✍️ Falta tu firma', 'go'], firmado: ['Firmado ✓', 'ok'], vencido: ['Enlace vencido', 'wait'] };
const fmt = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('-') : '');

export async function mountPetVet(box, pet) {
  box.innerHTML = '<p class="muted small">Cargando…</p>';
  let health = { clinics: [], vaccines: [], appointments: [] };
  try {
    health = await petHealth(pet.id);
  } catch (err) {
    console.warn('Mi veterinaria', err);
  }
  const t = new Date().toISOString().slice(0, 10);
  // La dosis más reciente de cada vacuna es la que manda.
  const seen = new Set();
  const current = health.vaccines.filter((v) => !seen.has(v.name.toLowerCase()) && seen.add(v.name.toLowerCase()));

  box.innerHTML = `
    ${health.appointments.length ? `<h3>Próximas horas</h3><ul class="vet-list">${health.appointments.map((a) => `
      <li><strong>${new Date(a.startsAt).toLocaleString('es-CL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</strong>
      <small>${SERVICES[a.service] || 'Hora'}${a.place === 'domicilio' ? ' a domicilio 🏠' : ''} · ${esc(a.clinic)}</small>
      <span class="vet-appt-foot"><span class="vet-status ${STATUS[a.status]?.[1] || ''}">${STATUS[a.status]?.[0] || ''}${a.confirmedAt ? ' · confirmaste ✓' : ''}</span>
      ${['solicitada', 'agendada'].includes(a.status) ? `<button class="link small" data-cancel="${a.id}">cancelar</button>` : ''}</span></li>`).join('')}</ul>` : ''}
    ${health.clinics.length ? `<button class="btn small primary" data-book>📅 Pedir hora</button>
      <form class="form vet-book" hidden>${bookForm(health.clinics)}</form>` : ''}
    ${current.length ? `<h3>Carnet de vacunas</h3><ul class="vet-list">${current.map((v) => `
      <li><strong>${esc(v.name)}</strong><small>Puesta ${fmt(v.appliedOn)} en ${esc(v.clinic)}${v.nextDue ? ` · próxima <b class="${v.nextDue < t ? 'late' : ''}">${fmt(v.nextDue)}</b>` : ''}</small></li>`).join('')}</ul>` : ''}
    ${health.documents?.length ? `<h3>Documentos</h3><ul class="vet-list vet-docs">${health.documents.map((d) => `
      <li><a href="#/doc/${d.token}"><strong>${esc(d.title)}</strong>
      <small>${fmt(d.createdAt)} · ${esc(d.clinic)}</small>
      ${DOC_STATUS[d.status] ? `<span class="vet-status ${DOC_STATUS[d.status][1]}">${DOC_STATUS[d.status][0]}</span>` : ''}</a></li>`).join('')}</ul>` : ''}
    ${health.clinics.length ? `<p class="small">Compartida con ${health.clinics.map((c) => `<strong>${esc(c.name)}</strong> <button class="link small" data-unlink="${c.id}">dejar de compartir</button>`).join(', ')}.</p>` : ''}
    <div class="vet-code">
      <p class="small">Muestra este código en tu veterinaria para que registre las vacunas y horas de ${esc(pet.name)} y te avise antes de cada dosis. Verán su nombre, tipo, raza y foto, y tu nombre, teléfono y correo. Sirve una vez y dura 24 horas.</p>
      <button class="btn small secondary" data-code>Mostrar código para mi veterinaria</button>
      <div class="vet-code-out" hidden></div>
    </div>`;

  const reload = () => { box.dataset.ready = ''; mountPetVet(box, pet); };

  box.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('¿Cancelar esta hora? Le avisaremos a la clínica.')) return;
    try {
      await cancelMyAppointment(b.dataset.cancel);
      toast('Hora cancelada', 'ok');
      reload();
    } catch (err) {
      toast(err.message, 'bad');
    }
  }));

  const form = box.querySelector('.vet-book');
  if (form) bindBook(form, box.querySelector('[data-book]'), health.clinics, pet, reload);

  box.querySelector('[data-code]').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const code = await createPetCode(pet.id);
      const url = `${location.origin}${location.pathname}#/clinica/vincular/${code}`;
      const out = box.querySelector('.vet-code-out');
      out.hidden = false;
      out.innerHTML = `<b class="vet-code-big">${esc(code)}</b>`;
      e.target.hidden = true;
      const QR = (await import('qrcode')).default;
      out.insertAdjacentHTML('beforeend', `<img alt="QR para la veterinaria" class="vet-qr" src="${await QR.toDataURL(url, { margin: 1, width: 220, color: { dark: '#4a3428' } })}">`);
    } catch (err) {
      toast(err.message, 'bad');
      e.target.disabled = false;
    }
  });

  box.querySelectorAll('[data-unlink]').forEach((b) => b.addEventListener('click', async () => {
    const c = health.clinics.find((x) => x.id === b.dataset.unlink);
    if (!confirm(`¿Dejar de compartir a ${pet.name} con ${c.name}? La clínica conserva su ficha, pero ya no te avisará por Kiltrazo.`)) return;
    await unlinkPet(pet.id, c.id);
    toast('Listo', 'ok');
    reload();
  }));
}

/** Mañana a las 10:00, en el formato de <input type="datetime-local">. */
function tomorrowAt10() {
  const d = new Date(Date.now() + 86400000);
  d.setHours(10, 0, 0, 0);
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T10:00`;
}

export function bookForm(clinics, pets = null, guest = false) {
  return `
    ${pets ? petPick(pets) : ''}
    ${clinics.length > 1 ? `<label>Clínica<select name="clinic">${clinics.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>`
      : `<input type="hidden" name="clinic" value="${clinics[0].id}">`}
    <fieldset class="vet-place">
      <label class="pick" data-clinic><input type="radio" name="place" value="clinica" checked> 🏥 En la clínica</label>
      <label class="pick" data-home><input type="radio" name="place" value="domicilio"> 🏠 A domicilio</label>
    </fieldset>
    <label>Motivo<select name="service">
      ${Object.entries(SERVICES).filter(([k]) => k !== 'cirugia').map(([k, v]) => `<option value="${k}">${v === 'Hora' ? 'Otro' : v}</option>`).join('')}
    </select></label>
    <label class="vet-free">Día y hora que te acomoda<input type="datetime-local" name="when" required value="${tomorrowAt10()}"></label>
    <div class="vet-slots" hidden></div>
    <div class="vet-address" hidden>
      <label>Dirección para la visita<input name="address" autocomplete="street-address" placeholder="Calle, número, depto, comuna"></label>
      <button type="button" class="link small" data-here>📍 Usar mi ubicación actual (para que lleguen más fácil)</button>
      <small class="muted" data-here-ok hidden>Ubicación agregada ✓</small>
    </div>
    <label>Comentario (opcional)<textarea name="notes" rows="2" maxlength="300" placeholder="Ej: tose desde ayer"></textarea></label>
    <p class="small muted">${guest ? 'La clínica te confirmará la hora por teléfono o WhatsApp. Solo ella verá tus datos.'
      : `La clínica confirmará la hora y te avisaremos aquí.${pets ? ' Verá el nombre, tipo, raza y foto de tu mascota, y tu nombre, teléfono y correo.' : ''}`}</p>
    <button class="btn primary">Enviar solicitud</button>`;
}

/** Elegir la mascota cuando se pide hora desde el mapa de clínicas. */
export function petPick(pets) {
  return pets.length > 1
    ? `<label>Mascota<select name="pet">${pets.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>`
    : `<input type="hidden" name="pet" value="${pets[0].id}">`;
}

/**
 * pet = null: la mascota sale del formulario (pedir hora desde el mapa).
 * opts.submit: otra forma de enviar la solicitud (quien pide hora sin la app).
 */
export async function bindBook(form, openBtn, clinics, pet, reload, opts = {}) {
  let point = null;
  const user = await currentUser().catch(() => null);
  form.address.value = user?.address || '';
  // Horas libres según los días de trabajo de los veterinarios; si la clínica
  // no los cargó, se elige cualquier día y hora y la clínica confirma.
  let slot = null;
  let asked = '';
  let showTimes = () => {};
  const slotsBox = form.querySelector('.vet-slots');
  const dayName = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('es-CL', { weekday: 'short', day: 'numeric', month: 'short' });
  const loadSlots = async (c, place) => {
    const key = `${c.id}|${place}`;
    if (key === asked) return;
    asked = key;
    slot = null;
    let r = { configured: false, days: [] };
    try { r = await availableSlots(c.id, place); } catch (err) { console.warn('Horas libres', err); }
    if (asked !== key) return;
    form.querySelector('.vet-free').hidden = r.configured;
    form.when.required = !r.configured;
    slotsBox.hidden = !r.configured;
    if (!r.configured) return;
    if (!r.days.length) {
      slotsBox.innerHTML = `<p class="small">No quedan horas libres ${place === 'domicilio' ? 'a domicilio ' : ''}en los próximos días.${c.phone ? ` Llama a la clínica: <a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>` : ''}</p>`;
      return;
    }
    slotsBox.innerHTML = `
      <b>Elige el día</b>
      <div class="vet-chips" data-days>${r.days.map((d, i) => `<button type="button" class="vet-chip ${i ? '' : 'on'}" data-day="${d.day}">${dayName(d.day)}</button>`).join('')}</div>
      <b>y la hora</b>
      <div class="vet-chips" data-times></div>`;
    showTimes = (day) => {
      slot = null;
      slotsBox.querySelector('[data-times]').innerHTML = r.days.find((d) => d.day === day).times
        .map((t) => `<button type="button" class="vet-chip" data-time="${day}T${t}">${t}</button>`).join('');
    };
    showTimes(r.days[0].day);
  };
  slotsBox.addEventListener('click', (e) => {
    const b = e.target.closest('.vet-chip');
    if (!b) return;
    b.parentElement.querySelectorAll('.vet-chip').forEach((x) => x.classList.toggle('on', x === b));
    if (b.dataset.day) showTimes(b.dataset.day);
    else slot = b.dataset.time;
  });
  const sync = () => {
    const c = clinics.find((x) => x.id === form.clinic.value) || clinics[0];
    const home = form.querySelector('[data-home]');
    home.hidden = !c.homeVisits;
    if (!c.homeVisits) form.place.value = 'clinica';
    // Veterinario independiente: solo a domicilio, sin elegir lugar.
    form.querySelector('[data-clinic]').hidden = Boolean(c.onlyHome);
    form.querySelector('.vet-place').hidden = Boolean(c.onlyHome);
    if (c.onlyHome) form.place.value = 'domicilio';
    const isHome = form.place.value === 'domicilio';
    form.querySelector('.vet-address').hidden = !isHome;
    form.address.required = isHome;
    loadSlots(c, form.place.value);
  };
  sync();
  form.addEventListener('change', sync);
  openBtn?.addEventListener('click', () => { form.hidden = !form.hidden; openBtn.hidden = !form.hidden; });
  form.querySelector('[data-here]').addEventListener('click', async () => {
    point = await getLocation();
    form.querySelector('[data-here-ok]').hidden = !point;
    if (!point) toast('No pudimos obtener tu ubicación. Basta con la dirección.', 'bad');
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!slotsBox.hidden && !slot) return toast('Elige una hora', 'bad');
    const btn = form.querySelector('button:not([type])');
    btn.disabled = true;
    const place = form.place.value;
    try {
      const req = {
        clinicId: form.clinic.value, place, service: form.service.value,
        startsAt: new Date(slotsBox.hidden ? form.when.value : slot).toISOString(),
        address: place === 'domicilio' ? form.address.value : '',
        lat: place === 'domicilio' ? point?.lat ?? null : null, lng: place === 'domicilio' ? point?.lng ?? null : null,
        notes: form.notes.value,
      };
      if (opts.submit) await opts.submit(req);
      else {
        await requestAppointment({ petId: pet ? pet.id : form.pet.value, ...req });
        toast('¡Solicitud enviada! Te avisaremos cuando la confirmen.', 'ok');
      }
      track('pedir_hora', { lugar: place });
      reload();
    } catch (err) {
      toast(err.message, 'bad');
      btn.disabled = false;
    }
  });
}
