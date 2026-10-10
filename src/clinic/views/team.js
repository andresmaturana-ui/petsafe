// Equipo de la clínica: quién entra, con qué rol, y códigos para invitar.

import { esc, toast, getLocation } from '../../ui.js';
import { createInvite, removeMember, setClinicAdmin, saveClinic, saveSchedule, saveSpecialties, busyElsewhere, saveMuni, isMuni } from '../data.js';
import { specPick, readSpecs, specTags } from '../specialties.js';
import { roleName } from '../ui.js';
import { muniDataForm, bindMuniForm } from '../muni.js';
import { kindPick, bindKind } from './start.js';
import { logoField, bindLogo } from '../logo.js';
import { webCard, bindWebCard } from '../web.js';

export default function team(el, _params, ctx) {
  const { clinic, team: people, me } = ctx;
  const admin = clinic.isAdmin;
  const muni = isMuni(clinic);
  const where = muni ? 'la municipalidad' : 'la clínica';
  const link = `${location.origin}${location.pathname}#/${muni ? 'municipio' : 'clinica'}`;
  const admins = people.filter((m) => m.isAdmin).length;

  el.innerHTML = `
    <header class="ck-head"><div><h1>Equipo</h1><p class="ck-sub">${esc(clinic.name)}</p></div></header>
    <div class="ck-cols-2">
      <div class="card ck-list">
        <h2>Personas</h2>
        ${people.map((m) => `
          <div class="ck-member">
            <span><strong>${esc(m.name || 'Sin nombre')}</strong><small>${roleName(m.role, clinic)}${m.isAdmin ? ' · administra' : ''}${m.userId === me.userId ? ' · tú' : ''}</small>
              ${m.role === 'vet' && !muni ? `<span class="spec-tags">${specTags(m.specialties) || '<small class="muted">Sin especialidades</small>'}
                ${admin || m.userId === me.userId ? `<button class="link small" data-spec-edit="${m.userId}">${m.specialties?.length ? 'Cambiar' : 'Agregar especialidades'}</button>` : ''}</span>` : ''}</span>
            ${admin && m.userId !== me.userId ? `<span class="ck-actions">
              ${m.isAdmin ? `<button class="link small" data-adm="${m.userId}">Quitar administrador</button>`
                : `<button class="link small" data-adm="${m.userId}" data-on="1">Hacer administrador</button>`}
              <button class="link danger small" data-rm="${m.userId}">Quitar</button></span>` : ''}
          </div>
          ${m.role === 'vet' && !muni && (admin || m.userId === me.userId) ? `<form class="form ck-spec-form" data-spec-form="${m.userId}" hidden>
            ${specPick(m.specialties || [], `Especialidades de ${esc(m.name || 'este veterinario')}`)}
            <button class="btn primary small">Guardar especialidades</button></form>` : ''}`).join('')}
        ${admin && admins < 2 && people.length > 1 ? `<p class="ck-tip small">💡 Nombra a otra persona como administradora. Así, si pierdes el acceso, ${where} sigue teniendo quien la maneje.</p>` : ''}
      </div>
      <div class="ck-stack">
        ${muni ? '' : webCard(clinic)}
        ${admin ? `
          <div class="card form">
            <h2>Invitar a alguien</h2>
            <p class="muted small">Genera un código y envíaselo. La persona entra a <span class="ck-mono">${esc(link)}</span>, crea su cuenta y toca "Me invitaron". Cada código sirve una vez y dura 7 días.</p>
            <label>Rol<select id="ck-inv-role"><option value="vet">Veterinario/a</option><option value="recepcion">${roleName('recepcion', clinic)}</option><option value="punto">${roleName('punto', clinic)}</option></select></label>
            <button class="btn secondary" id="ck-inv">Generar código</button>
            <p class="ck-code" id="ck-inv-code" hidden></p>
          </div>
          ${muni ? muniDataForm(clinic) : `<form class="card form" id="ck-clinic">
            <h2>Datos de la clínica</h2>
            ${kindPick(clinic.onlyHome)}
            <label>Nombre<input name="name" required maxlength="120" value="${esc(clinic.name)}"></label>
            <label><span data-k="clinica">Dirección</span><span data-k="domicilio" hidden>Comuna o zona donde atiendes</span><input name="address" value="${esc(clinic.address)}"></label>
            <label>Teléfono<input name="phone" type="tel" value="${esc(clinic.phone)}"></label>
            ${logoField(clinic.logo)}
            <label>Horario<input name="hours" maxlength="120" value="${esc(clinic.hours || '')}" placeholder="Ej.: Lun a Vie 9 a 19, Sáb 10 a 14"></label>
            <label class="ck-check" data-k="clinica"><input type="checkbox" name="homeVisits" ${clinic.homeVisits ? 'checked' : ''}> Hacemos visitas a domicilio (los tutores podrán pedirlas)</label>
            <label>Tiempo de traslado entre visitas a domicilio<select name="travelMinutes">
              ${[15, 30, 45, 60, 90].map((n) => `<option value="${n}" ${(clinic.travelMinutes ?? 30) === n ? 'selected' : ''}>${n} minutos</option>`).join('')}
            </select></label>
            <label class="ck-check" data-k="clinica"><input type="checkbox" name="emergencies" ${clinic.emergencies ? 'checked' : ''}> Atendemos urgencias</label>
            <label class="ck-check"><input type="checkbox" name="onMap" ${clinic.onMap ? 'checked' : ''}> Aparecer en el mapa de clínicas de Kiltrazo (los tutores ven nombre, dirección o zona, teléfono y horario)</label>
            <div class="ck-map-pick">
              <p class="small muted"><span data-k="clinica">Marca la clínica en el mapa (toca o arrastra la huella). Si no hay calles claras, usa la vista Satélite.</span><span data-k="domicilio" hidden>Marca el centro de la zona donde atiendes. En la app se verá un punto aproximado, nunca tu dirección.</span></p>
              <div class="ck-map" id="ck-map"></div>
              <button type="button" class="link small" id="ck-here">📍 <span data-k="clinica">Estoy en la clínica: usar</span><span data-k="domicilio" hidden>Usar</span> mi ubicación</button>
              <label class="ck-coords small">¿Tienes la ubicación en Google Maps? Pega aquí el enlace o las coordenadas<input id="ck-coords" placeholder="-36.6061, -72.1034"></label>
            </div>
            <button class="btn primary small">Guardar</button>
          </form>`}` : `<div class="card"><p>Solo quien administra ${where} puede invitar o quitar personas.</p></div>`}
        <div class="card">
          <h2>Qué puede hacer cada rol</h2>
          <p class="small"><strong>Veterinario/a:</strong> todo, incluidas las consultas.</p>
          <p class="small"><strong>${roleName('recepcion', clinic)}:</strong> ${muni ? 'agenda, operativos, sala de espera, fichas, vacunas y el tablero de perdidos y encontrados.' : 'agenda, sala de espera, pacientes, vacunas y exámenes.'} Ve el historial, pero no escribe consultas.</p>
          <p class="small"><strong>${roleName('punto', clinic)}:</strong> solo filma la cara de mascotas nuevas y se las entrega a su ${muni ? 'responsable' : 'dueño'} con un QR. No ve ${muni ? 'las fichas' : 'los pacientes'} ni la agenda. Sirve para ferias, operativos o un tablet en el mesón.</p>
        </div>
      </div>
    </div>
    <div id="ck-sched"></div>`;

  if (!muni) {
    mountSchedule(el.querySelector('#ck-sched'), ctx);
    bindWebCard(el, clinic, ctx.user?.email);
  }

  el.querySelector('#ck-inv')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const role = el.querySelector('#ck-inv-role').value;
      const code = await createInvite(clinic.id, role);
      const box = el.querySelector('#ck-inv-code');
      box.hidden = false;
      box.innerHTML = `<b>${esc(code)}</b><small>para ${roleName(role, clinic).toLowerCase()}</small>`;
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      e.target.disabled = false;
    }
  });

  el.querySelectorAll('[data-adm]').forEach((b) => b.addEventListener('click', async () => {
    const m = people.find((x) => x.userId === b.dataset.adm);
    const on = Boolean(b.dataset.on);
    if (!confirm(on ? `¿${m.name} también administrará ${where}? Podrá invitar y quitar personas.` : `¿Quitarle a ${m.name} la administración?`)) return;
    try {
      await setClinicAdmin(clinic.id, m.userId, on);
      ctx.refresh();
    } catch (err) {
      toast(err.message, 'bad');
    }
  }));

  el.querySelectorAll('[data-spec-edit]').forEach((b) => b.addEventListener('click', () => {
    el.querySelector(`[data-spec-form="${b.dataset.specEdit}"]`).hidden = false;
    b.hidden = true;
  }));
  el.querySelectorAll('[data-spec-form]').forEach((f) => f.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await saveSpecialties(clinic.id, f.dataset.specForm, readSpecs(f));
      toast('Especialidades guardadas', 'ok');
      ctx.refresh();
    } catch (err) {
      toast(err.message, 'bad');
    }
  }));

  el.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', async () => {
    const m = people.find((x) => x.userId === b.dataset.rm);
    if (!confirm(`¿Quitar a ${m.name} del equipo? Ya no podrá entrar a ${where}.`)) return;
    await removeMember(clinic.id, m.userId);
    ctx.refresh();
  }));

  const muniForm = el.querySelector('#ck-muni');
  if (muniForm) {
    const read = bindMuniForm(muniForm, clinic);
    muniForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await saveMuni({ id: clinic.id, ...read() });
        toast('Datos guardados', 'ok');
        ctx.refresh();
      } catch (err) {
        toast(err.message, 'bad');
      }
    });
    return;
  }

  // Ubicación de la clínica para el mapa de urgencias.
  let point = clinic.lat != null && clinic.lng != null ? { lat: clinic.lat, lng: clinic.lng } : null;
  const mapEl = el.querySelector('#ck-map');
  if (mapEl) {
    import('../../map.js').then(({ pickPoint, bindPlaceSearch }) => {
      const picker = pickPoint(mapEl, point, (p) => { point = p; });
      bindPlaceSearch(picker, { input: el.querySelector('#ck-clinic [name="address"]'), hereBtn: el.querySelector('#ck-here'), coordsInput: el.querySelector('#ck-coords'), getLocation, say: toast });
    });
  }

  const clinicForm = el.querySelector('#ck-clinic');
  if (clinicForm) bindKind(clinicForm);
  const logo = clinicForm ? bindLogo(clinicForm) : () => undefined;
  clinicForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const onlyHome = f.kind === 'domicilio';
    if (f.onMap && !point) return toast('Marca la clínica en el mapa para aparecer en él', 'bad');
    try {
      await saveClinic({
        id: clinic.id, name: f.name.trim(), address: f.address.trim(), phone: f.phone.trim(), hours: f.hours.trim(),
        logo: logo(), onlyHome, homeVisits: onlyHome || Boolean(f.homeVisits), emergencies: !onlyHome && Boolean(f.emergencies), onMap: Boolean(f.onMap), travelMinutes: Number(f.travelMinutes) || 30,
        lat: point?.lat ?? null, lng: point?.lng ?? null,
      });
      toast('Datos guardados', 'ok');
      ctx.refresh();
    } catch (err) {
      toast(err.message, 'bad');
    }
  });
}

// ---------- Días de trabajo de cada veterinario ----------

const DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const PLACES = [['', 'No viene'], ['clinica', '🏥 Clínica'], ['domicilio', '🏠 Domicilio']];

async function mountSchedule(box, ctx) {
  const { clinic, team: people, me } = ctx;
  const vets = people.filter((m) => m.role === 'vet');
  const editable = vets.filter((m) => m.userId === me.userId || clinic.isAdmin);
  if (!editable.length) return;
  const elsewhere = await busyElsewhere(clinic.id).catch(() => []);
  let who = editable.find((m) => m.userId === me.userId) || editable[0];

  const draw = () => {
    const sched = who.schedule || {};
    const places = clinic.onlyHome ? [['', 'No trabaja'], PLACES[2]] : clinic.homeVisits ? PLACES : PLACES.slice(0, 2);
    box.innerHTML = `
      <form class="card form ck-sched">
        <div class="ck-sched-head">
          <h2>Días de trabajo</h2>
          ${editable.length > 1 ? `<select name="who" class="ck-select" aria-label="Veterinario">${editable.map((m) => `<option value="${m.userId}" ${m.userId === who.userId ? 'selected' : ''}>${esc(m.name || 'Sin nombre')}${m.userId === me.userId ? ' (tú)' : ''}</option>`).join('')}</select>` : ''}
        </div>
        <p class="small muted">${clinic.onlyHome ? 'Elige qué días atiende y en qué horario.' : 'Elige dónde atiende cada día.'} Los tutores solo podrán pedir horas libres en esos días${clinic.homeVisits ? `, y entre visitas a domicilio dejamos ${clinic.travelMinutes ?? 30} minutos de traslado` : ''}.</p>
        ${DAYS.map((name, i) => {
          const k = String(i + 1);
          const d = { ...sched[k] };
          if (clinic.onlyHome && d.place === 'clinica') d.place = 'domicilio';
          const other = elsewhere.filter((o) => o.userId === who.userId && o.dow === k);
          return `
          <div class="ck-sched-row" data-day="${k}">
            <strong>${name}</strong>
            <span class="ck-seg ${places.length === 2 ? 'two' : ''}">${places.map(([v, t]) => `<label><input type="radio" name="p${k}" value="${v}" ${(d.place || '') === v ? 'checked' : ''}><span>${t}</span></label>`).join('')}</span>
            <span class="ck-sched-hours" ${d.place ? '' : 'hidden'}>
              <input type="time" name="f${k}" step="1800" value="${d.from || '09:00'}" aria-label="Desde"> a
              <input type="time" name="t${k}" step="1800" value="${d.to || '18:00'}" aria-label="Hasta">
            </span>
            ${other.map((o) => `<small class="ck-sched-other">${o.clinic ? `En ${esc(o.clinic)}` : 'En otra clínica'} de ${o.fromHm} a ${o.toHm}</small>`).join('')}
          </div>`;
        }).join('')}
        <div class="ck-row-end"><button class="btn primary small">Guardar días</button></div>
      </form>`;
    const form = box.querySelector('form');
    form.who?.addEventListener('change', () => { who = editable.find((m) => m.userId === form.who.value); draw(); });
    form.addEventListener('change', (e) => {
      const row = e.target.closest('.ck-sched-row');
      if (row && e.target.type === 'radio') row.querySelector('.ck-sched-hours').hidden = !e.target.value;
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const schedule = {};
      for (let i = 1; i <= 7; i++) {
        const place = f.get(`p${i}`);
        if (place) schedule[i] = { place, from: f.get(`f${i}`), to: f.get(`t${i}`) };
      }
      try {
        await saveSchedule(clinic.id, who.userId, schedule);
        who.schedule = schedule;
        toast('Días guardados', 'ok');
      } catch (err) {
        toast(err.message, 'bad');
      }
    });
  };
  draw();
}
