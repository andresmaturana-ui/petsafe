// Kiltrazo Clínica: software para veterinarias dentro de Kiltrazo (#/clinica).
// Se carga aparte (import dinámico), así la app de los tutores no cambia.
// En el computador muestra un menú lateral; en el celular, uno arriba.

import './clinic.css';
import { esc, go } from '../ui.js';
import { session, myClinics, members, activeClinicId, setActiveClinic, listAppointments, dueVaccines, runReminders, pendingRequests, today, isMuni, isPoint } from './data.js';
import { roleName } from './ui.js';
import { brandWithLogo } from './logo.js';
import start from './views/start.js';
import agenda, { waiting } from './views/agenda.js';
import patients, { patientForm, linkForm } from './views/patients.js';
import patient from './views/patient.js';
import vaccines from './views/vaccines.js';
import team from './views/team.js';
import requests, { homeVisits } from './views/requests.js';
import review from './review.js';
import drives, { driveForm, drive } from './views/drives.js';
import board from './views/board.js';
import point, { pointScreen } from './views/point.js';

const ROUTES = [
  ['', agenda, 'agenda'],
  ['agenda/:day', agenda, 'agenda'],
  ['sala', waiting, 'sala'],
  ['solicitudes', requests, 'solicitudes'],
  ['domicilio', homeVisits, 'domicilio'],
  ['pacientes', patients, 'pacientes'],
  ['pacientes/nuevo', patientForm, 'pacientes'],
  ['vincular', linkForm, 'pacientes'],
  ['vincular/:code', linkForm, 'pacientes'],
  ['paciente/:id', patient, 'pacientes'],
  ['paciente/:id/editar', patientForm, 'pacientes'],
  ['paciente/:id/:tab', patient, 'pacientes'],
  ['vacunas', vaccines, 'vacunas'],
  ['equipo', team, 'equipo'],
  ['revision', review, 'equipo'],
  ['operativos', drives, 'operativos'],
  ['operativos/nuevo', driveForm, 'operativos'],
  ['operativo/:id', drive, 'operativos'],
  ['operativo/:id/editar', driveForm, 'operativos'],
  ['perdidos', board, 'perdidos'],
  ['punto', point, 'punto'],
];

function resolve(path) {
  for (const [pattern, view, section] of ROUTES) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
    const m = path.match(re);
    if (m) return { view, section, params: Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
  }
  return { view: agenda, section: 'agenda', params: {} };
}

let remindersRun = false;

// #/clinica abre la clínica y #/municipio la municipalidad, aunque la cuenta
// tenga las dos. Las pantallas municipales enlazan a #/clinica/... por dentro:
// mientras se ve la municipalidad, esos enlaces se cambian a #/municipio/...
// (los marcados con data-keep van a la clínica de verdad).
document.addEventListener('click', (e) => {
  const a = e.target.closest?.('a[href^="#/clinica"]');
  if (!a || a.dataset.keep !== undefined || !document.body.classList.contains('muni-mode')) return;
  e.preventDefault();
  go(a.getAttribute('href'));
}, true);

export default async function clinicApp(el, path, { refresh }) {
  const muniEntry = /^(municipio|municipal)(\/|$)/.test(path);
  const sub = path.replace(/^(clinica|municipio|municipal)\/?/, '');
  document.body.classList.remove('muni-mode');
  const s = await session();
  if (!s.user) return start(el, { session: s, refresh, pendingCode: muniEntry ? null : pendingLink(sub), muni: muniEntry });

  // El Punto Kiltrazo (sin clínica) se abre aparte, en #/punto.
  const clinics = (await myClinics(s.user.id)).filter((c) => !isPoint(c));
  const munis = clinics.filter(isMuni);
  const active = clinics.find((c) => c.id === activeClinicId());
  if (muniEntry) {
    if (!munis.length) return start(el, { session: s, refresh, muni: true });
    if (!isMuni(active)) setActiveClinic(munis[0].id);
  } else {
    const own = clinics.filter((c) => !isMuni(c));
    if (!own.length) return start(el, { session: s, refresh, pendingCode: pendingLink(sub) });
    if (!active || isMuni(active)) setActiveClinic(own[0].id);
  }
  const clinic = clinics.find((c) => c.id === activeClinicId()) || clinics[0];
  const muni = isMuni(clinic);
  setActiveClinic(clinic.id);
  document.body.classList.toggle('muni-mode', muni);
  // Solo cambia lo que se ve en la barra de direcciones (no recarga la pantalla).
  const shown = `#/${muni ? 'municipio' : 'clinica'}${sub ? `/${sub}` : ''}`;
  if (location.hash !== shown) history.replaceState(history.state, '', shown);

  // Una vez por visita: avisos de próximas vacunas a los tutores (también los
  // manda la base cada mañana, si tiene pg_cron).
  if (!remindersRun) {
    remindersRun = true;
    runReminders().catch((err) => console.warn('Recordatorios', err));
  }

  const [team, todayList, due, asked] = await Promise.all([
    members(clinic.id),
    listAppointments(clinic.id, today()),
    dueVaccines(clinic.id, 14),
    pendingRequests(clinic.id),
  ]);
  const me = team.find((m) => m.userId === s.user.id) || { userId: s.user.id, name: '', role: clinic.role };
  const { view, section, params } = resolve(sub);
  const pending = todayList.filter((a) => ['agendada', 'en_camino', 'en_sala', 'en_atencion'].includes(a.status)).length;
  const homeToday = todayList.filter((a) => a.place === 'domicilio' && ['agendada', 'en_camino', 'en_atencion'].includes(a.status)).length;
  const inRoom = todayList.filter((a) => a.status === 'en_sala').length;

  // Punto de reconocimiento facial: pantalla sola, sin menú. Las cuentas con
  // ese rol solo ven esto; el resto del equipo lo abre desde el menú.
  if (me.role === 'punto' || section === 'punto') {
    const exit = me.role === 'punto' ? '<a href="#/" class="small">Salir</a>' : '<a href="#/clinica" class="btn small ghost">Salir del punto</a>';
    return pointScreen(el, { clinic, me, exit });
  }

  const link = (key, href, label, badge = 0, hot = false) =>
    `<a href="${href}" class="ck-nav ${section === key ? 'on' : ''}">${label}${badge ? `<span class="ck-count ${hot ? 'hot' : ''}">${badge}</span>` : ''}</a>`;
  const navs = muni ? `
          ${link('agenda', '#/clinica', 'Agenda de hoy', pending, true)}
          ${link('operativos', '#/clinica/operativos', 'Operativos')}
          ${link('pacientes', '#/clinica/pacientes', 'Animales')}
          ${link('punto', '#/clinica/punto', '📷 Punto de registro')}
          ${link('perdidos', '#/clinica/perdidos', 'Perdidos y encontrados')}
          ${link('sala', '#/clinica/sala', 'Sala de espera', inRoom)}
          ${link('vacunas', '#/clinica/vacunas', 'Vacunas por vencer', due.length)}
          ${link('equipo', '#/clinica/equipo', 'Equipo')}` : `
          ${link('agenda', '#/clinica', 'Agenda de hoy', pending, true)}
          ${link('solicitudes', '#/clinica/solicitudes', 'Solicitudes de hora', asked.length, true)}
          ${clinic.homeVisits ? link('domicilio', '#/clinica/domicilio', 'A domicilio', homeToday) : ''}
          ${link('pacientes', '#/clinica/pacientes', 'Pacientes')}
          ${link('punto', '#/clinica/punto', '📷 Punto de registro')}
          ${clinic.onlyHome ? '' : link('sala', '#/clinica/sala', 'Sala de espera', inRoom)}
          ${link('vacunas', '#/clinica/vacunas', 'Vacunas por vencer', due.length)}
          ${link('equipo', '#/clinica/equipo', 'Equipo')}
          <a href="manuales/Manual-Kiltrazo-Clinica.pdf" class="ck-nav" target="_blank" rel="noopener" download>📘 Manual (PDF)</a>`;
  // Cada menú muestra solo lo suyo: en la clínica no aparecen municipalidades
  // ni en la municipalidad clínicas. Si la misma cuenta tiene las dos, abajo
  // queda un enlace chico para pasar a la otra.
  const mine = clinics.filter((c) => isMuni(c) === muni);
  const other = muni ? clinics.some((c) => !isMuni(c)) : munis.length > 0;
  const reviewNote = muni
    ? '🕒 Tu municipalidad está en revisión por Kiltrazo. Ya puedes crear fichas y preparar operativos. Cuando la aprobemos, los vecinos podrán reservar cupos y verás los perdidos y encontrados de la comuna.'
    : `🕒 Tu clínica está en revisión por Kiltrazo. Ya puedes usar la agenda y las fichas. Cuando la aprobemos, podrás aparecer en el mapa y recibir horas desde la app.${
          clinic.docs?.some((d) => d.kind === 'titulo') ? '' : clinic.isAdmin ? ' <a href="#/clinica/revision"><b>Sube el RUT y el título del veterinario/a</b></a> para que podamos revisarla.' : ' Falta que quien la administra suba el título del veterinario/a.'}`;

  el.innerHTML = `
    <div class="ck">
      <aside class="ck-side">
        <div class="ck-brand">${clinic.logo ? brandWithLogo(clinic.logo, clinic.name, muni ? 'Municipal' : 'Clínica') : `<img src="brand/kiltrazo.svg" alt="Kiltrazo" class="ck-logo"><b>${muni ? 'Municipal' : 'Clínica'}</b>`}</div>
        ${mine.length > 1
          ? `<select class="ck-clinic-pick" aria-label="${muni ? 'Municipalidad' : 'Clínica'}">${mine.map((c) => `<option value="${c.id}" ${c.id === clinic.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>`
          : `<div class="ck-clinic">${esc(clinic.name)}</div>`}
        ${clinic.approved === false ? `<p class="ck-review">${reviewNote}</p>` : ''}
        <nav class="ck-navs">${navs}
        </nav>
        <div class="ck-me">
          <strong>${esc(me.name || s.user.email || '')}</strong>
          <span>${esc(roleName(me.role, clinic))}</span>
          ${other ? (muni ? '<a href="#/clinica" data-keep>Ir a mi clínica</a>' : '<a href="#/municipio">Ir a mi municipalidad</a>') : ''}
          <a href="#/">Volver a Kiltrazo</a>
        </div>
      </aside>
      <section class="ck-main" id="ck-main"></section>
    </div>`;

  el.querySelector('.ck-clinic-pick')?.addEventListener('change', (e) => {
    setActiveClinic(e.target.value);
    const next = isMuni(clinics.find((c) => c.id === e.target.value)) ? '#/municipio' : '#/clinica';
    if (location.hash === next) refresh();
    else location.hash = next;
  });

  const main = el.querySelector('#ck-main');
  await view(main, params, { clinic, me, team, user: s.user, refresh });
}

// "#/clinica/vincular/ABC123" abierto por alguien que aún no entra: se guarda
// el código para después.
function pendingLink(sub) {
  const m = sub.match(/^vincular\/(\w+)/);
  return m ? m[1] : '';
}
