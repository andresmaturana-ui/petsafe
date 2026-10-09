import {
  allPets, savePet, allFound, saveFound, deleteFound, listUsers, listAccounts, moveUserPets, adminDeleteUser, adminDeletePet, notify, notifyAll,
  latestSuccesses, deleteSuccess, commentsFor, deleteComment, addSuccess, markRecovered,
  trainingPhotos, tagStats, studyList, studyFile, studyGuests, studyHorses, studyNewGuest, studyDeleteGuest, CLOUD, isAdmin, claimAdmin, adminExists, listContacts, markContactRead, deleteContact, pushConfigured, savePushKey, enablePush,
} from '../data.js';
import { generateVapidKeys } from '../notify.js';
import { mountEmailLogin } from './login-email.js';
import { esc, timeAgo, toast, changed, go } from '../ui.js';
import { SPECIES, describe } from '../breeds.js';
import { zip, fromDataUrl } from '../zip.js';
import { THRESHOLDS, SUGGEST_MARGIN } from '../biometrics.js';
import { SITE_URL } from '../config.js';

// PIN de prototipo. En producción el acceso de administrador debe
// validarse en el servidor con un rol de usuario.
const ADMIN_PIN = import.meta.env.VITE_ADMIN_PIN || '1234';

export default async function admin(el, _params, ctx) {
  if (CLOUD ? !(await isAdmin()) : sessionStorage.getItem('petsafe-admin') !== 'ok') {
    return CLOUD ? claim(el, ctx) : login(el, ctx);
  }

  const tab = sessionStorage.getItem('petsafe-admin-tab') || 'alertas';
  el.innerHTML = `
    <div class="admin-page">
    <div class="admin-head">
      <h1>Administrador</h1>
      <div class="tabs">
        ${[['alertas', '🚨 Alertas'], ['recon', '🎯 Reconocimiento'], ['mensajes', '📢 Mensajes'], ['usuarios', '👥 Usuarios'], ['clinicas', '🏥 Clínicas'], ['municipios', '🏛️ Municipalidades'], ['punto', '📷 Punto'], ['estudio', '🐄 Estudio'], ['publicidad', '📣 Publicidad'], ['casos', '💛 Reencuentros'], ['datos', '📋 Datos']]
          .map(([k, l]) => `<button class="tab ${k === tab ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}
      </div>
    </div>
    <div id="panel"></div>
    </div>`;

  el.querySelectorAll('.tab').forEach((b) =>
    b.addEventListener('click', () => {
      sessionStorage.setItem('petsafe-admin-tab', b.dataset.tab);
      ctx.refresh();
    }),
  );

  const panel = el.querySelector('#panel');
  await ({ alertas, recon, mensajes, usuarios, clinicas, municipios, punto, estudio, publicidad, casos, datos })[tab](panel, ctx);
}

// Con Supabase el permiso vive en el servidor: se entra con un correo de
// administrador. Solo mientras no haya ninguno, el primer usuario que lo pide
// queda como administrador (tabla admins).
async function claim(el, { refresh }) {
  el.innerHTML = `
    <div class="card">
      <h1>Administrador 🔐</h1>
      <p>Entra con tu correo y clave de administrador; así lo eres en cualquier dispositivo. Si aún no tienes clave, créala en Perfil → Tu cuenta, o toca "Olvidé mi contraseña".</p>
      <div id="email-login"></div>
    </div>
    <div class="card" id="first-time" hidden>
      <h2>¿Primera vez?</h2>
      <p>Si aún no hay administrador, el primer usuario que toque este botón lo será.</p>
      <button class="btn secondary" id="claim">Soy el administrador</button>
    </div>`;
  mountEmailLogin(el.querySelector('#email-login'), {
    after: '#/admin',
    async onDone() {
      if (!(await isAdmin())) toast('Entraste, pero ese correo no es administrador.', 'bad');
      window.dispatchEvent(new Event('petsafe:changed'));
      refresh();
    },
  });
  el.querySelector('#claim').addEventListener('click', async () => {
    if (await claimAdmin()) refresh();
    else toast('Ya hay un administrador. Pídele acceso.', 'bad');
  });
  if ((await adminExists()) === false) el.querySelector('#first-time').hidden = false;
}

function login(el, { refresh }) {
  el.innerHTML = `
    <div class="card">
      <h1>Administrador 🔐</h1>
      <form class="form" id="pin">
        <label>PIN<input name="pin" type="password" inputmode="numeric" required autocomplete="off"></label>
        <button class="btn primary big">Entrar</button>
      </form>
    </div>`;
  el.querySelector('#pin').addEventListener('submit', (e) => {
    e.preventDefault();
    if (new FormData(e.target).get('pin') === ADMIN_PIN) {
      sessionStorage.setItem('petsafe-admin', 'ok');
      refresh();
    } else toast('PIN incorrecto', 'bad');
  });
}

// Qué tan bien reconoce la app: cómo terminó cada aviso de "encontré" y con
// qué parecido, para ajustar el umbral con datos reales.
async function recon(panel) {
  const [pets, found, tag] = await Promise.all([allPets(), allFound(), tagStats().catch(() => null)]);
  const petName = (id) => pets.find((p) => p.id === id)?.name || '?';
  const trainPets = pets.filter((p) => p.trainOk);
  const match = THRESHOLDS.dino, suggest = THRESHOLDS.dino - SUGGEST_MARGIN;
  const pct = (v) => `${Math.round(v * 100)}%`;
  const all = [...found].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  // Escaneos de una mascota propia sin ligar a otra: pruebas del dueño, aparte.
  const isTest = (f) => f.ownScore != null && !f.petId;
  const tests = all.filter(isTest);
  const list = all.filter((f) => !isTest(f));
  const count = (fn) => list.filter(fn).length;
  const auto = count((f) => f.petId && f.matchKind === 'auto');
  const people = count((f) => f.petId && (f.matchKind === 'finder' || f.matchKind === 'owner'));
  const old = count((f) => f.petId && !f.matchKind);
  const none = count((f) => !f.petId);
  const share = (n) => (list.length ? ` (${Math.round((n / list.length) * 100)}%)` : '');

  const how = (f) => (isTest(f) ? ['test', 'Prueba con tu propia mascota']
    : !f.petId ? ['none', 'Sin mascota ligada']
    : f.matchKind === 'auto' ? ['auto', `Match automático con ${esc(petName(f.petId))}`]
      : f.matchKind === 'finder' ? ['people', `Quien la encontró eligió a ${esc(petName(f.petId))}`]
        : f.matchKind === 'owner' ? ['people', `El dueño reconoció a ${esc(petName(f.petId))}`]
          : ['old', `Ligada a ${esc(petName(f.petId))} (antes de medir)`]);
  // Barra de 50% a 100% con marcas en los umbrales de sugerencia y de match.
  const pos = (v) => `${Math.min(100, Math.max(0, ((v - 0.5) / 0.5) * 100))}%`;
  const bar = (label, v) => (v == null ? '' : `
    <div class="score-row"><span>${label}</span><strong>${pct(v)}</strong></div>
    <div class="score-bar"><i class="mark suggest" style="left:${pos(suggest)}"></i><i class="mark match" style="left:${pos(match)}"></i><b class="${v >= match ? 'hi' : v >= suggest ? 'mid' : 'lo'}" style="width:${pos(v)}"></b></div>`);

  const fromTag = all.filter((f) => f.source === 'placa');
  panel.innerHTML = `
    ${tag ? `
    <div class="card">
      <h2>🏷️ Placa del collar</h2>
      <p class="muted small">Personas que escanearon el QR de una placa (se cuenta una vez por celular) y avisos que enviaron sin crear cuenta.</p>
      <div class="stat-grid">
        <div class="stat"><strong>${tag.visits}</strong><small>Abrieron el QR</small></div>
        <div class="stat mid"><strong>${tag.reports}</strong><small>Escanearon una mascota</small></div>
        <div class="stat hi"><strong>${tag.matched}</strong><small>Encontraron a su dueño</small></div>
      </div>
      ${tag.months?.length ? `<p class="small">Visitas por mes: ${tag.months.map((m) => `${esc(m.month)}: <strong>${m.visits}</strong>`).join(' · ')}</p>` : ''}
      ${fromTag.length ? '<button class="btn secondary" id="tag-csv">Descargar avisos de la placa (CSV)</button>' : ''}
    </div>` : ''}

    <div class="card">
      <h2>Resumen (${list.length} avisos de "encontré")</h2>
      <p class="muted small">Sin contar tus pruebas con mascotas propias.</p>
      <div class="stat-grid">
        <div class="stat hi"><strong>${auto}${share(auto)}</strong><small>Match automático</small></div>
        <div class="stat mid"><strong>${people}${share(people)}</strong><small>Confirmados por una persona</small></div>
        <div class="stat lo"><strong>${none}${share(none)}</strong><small>Sin mascota ligada</small></div>
        <div class="stat"><strong>${tests.length}</strong><small>Pruebas con mascotas propias</small></div>
      </div>
      ${old ? `<p class="muted small">${old} avisos se ligaron antes de empezar a medir y no se cuentan arriba.</p>` : ''}
      <p class="muted small">Match automático desde ${pct(match)} de parecido en la cara. Entre ${pct(suggest)} y ${pct(match)} se muestra como sugerencia "¿es esta?".</p>
    </div>

    <div class="card">
      <h2>Fotos para entrenar</h2>
      <p><strong>${trainPets.length}</strong> mascotas con permiso · <strong>${trainPets.reduce((n, p) => n + (p.trainPhotos || 0), 0)}</strong> fotos guardadas.</p>
      <p class="muted small">Se guardan solo cuando el dueño marca la casilla al registrar. Para entrenar bien hacen falta unas 100 mascotas.</p>
      ${trainPets.length ? '<button class="btn secondary" id="train-zip">Descargar fotos (ZIP)</button>' : ''}
    </div>

    <div class="card">
      <h2>Cómo calibrar</h2>
      <ol class="small">
        <li>Registra a tu mascota. Después, en "Encontré una mascota", escanéala desde tu misma cuenta: queda como prueba con tu mascota.</li>
        <li>Haz lo mismo con otra luz y otro ángulo, y también con un perro distinto.</li>
        <li>Si tus pruebas con la misma mascota quedan entre ${pct(suggest)} y ${pct(match)}, el umbral está alto. Si un perro distinto supera ${pct(match)}, está bajo.</li>
      </ol>
    </div>

    <div class="card">
      <h2>Cada escaneo</h2>
      ${all.length ? `<ul class="recon-list">${all.map((f) => {
        const [tone, text] = how(f);
        return `
        <li>
          <img src="${esc(f.photo)}" alt="">
          <div>
            <strong class="tone-${tone}">${text}</strong>
            <small>${timeAgo(f.createdAt)} · ${f.source === 'placa' ? '🏷️ desde la placa' : esc(f.finderName)}</small>
            ${bar('Parecido con la mascota ligada', f.matchScore)}
            ${f.petId ? '' : bar('Más parecida de otros dueños', f.bestScore)}
            ${bar('Parecido con tu propia mascota', f.ownScore)}
          </div>
        </li>`;
      }).join('')}</ul>` : '<p class="muted">Todavía no hay escaneos de mascotas encontradas.</p>'}
    </div>`;

  // Datos de la placa para analizar aparte (sin teléfonos): fecha, zona aproximada y resultado.
  panel.querySelector('#tag-csv')?.addEventListener('click', () => {
    const rows = [['fecha', 'lat_aprox', 'lng_aprox', 'tipo', 'resultado', 'parecido_max']]
      .concat(fromTag.map((f) => [
        f.createdAt, f.lat?.toFixed(2), f.lng?.toFixed(2), f.species || '',
        !f.petId ? 'sin dueño' : f.matchKind === 'auto' ? 'dueño avisado' : f.matchKind === 'owner' ? 'reconocida por el dueño' : 'elegida por quien la encontró',
        f.bestScore != null ? Math.round(f.bestScore * 100) + '%' : '',
      ]));
    const csv = rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv' }));
    a.download = 'kiltrazo-placa.csv';
    a.click();
  });

  panel.querySelector('#train-zip')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    e.target.textContent = 'Preparando…';
    try {
      const files = await trainingPhotos();
      download(`kiltrazo-entrenamiento-${day(new Date().toISOString())}.zip`, zip(files));
    } catch (err) {
      toast(`No se pudo descargar: ${err.message}`, 'bad');
    } finally {
      e.target.disabled = false;
      e.target.textContent = 'Descargar fotos (ZIP)';
    }
  });
}

async function alertas(panel, { refresh }) {
  const [pets, found, users] = await Promise.all([allPets(), allFound(), listUsers()]);
  const userName = (id) => users.find((u) => u.id === id)?.name || '—';
  const lost = pets.filter((p) => p.status === 'lost');
  const petName = (id) => pets.find((p) => p.id === id)?.name;

  panel.innerHTML = `
    <div class="card">
      <h2>Mascotas perdidas (${lost.length})</h2>
      ${lost.length ? `<ul class="admin-list">${lost.map((p) => `
        <li>
          <img src="${esc(p.photo)}" alt="">
          <span><strong>${esc(p.name)}</strong><small>${describe(p) ? `${esc(describe(p))} · ` : ''}Dueño: ${esc(userName(p.ownerId))} · ${timeAgo(p.lostAt)}</small></span>
          <span class="row-actions">
            <button class="btn small" data-edit="${p.id}">Editar</button>
            <button class="btn small ghost" data-home="${p.id}">Quitar aviso</button>
          </span>
        </li>`).join('')}</ul>` : '<p class="muted">No hay mascotas perdidas.</p>'}
    </div>
    <div class="card">
      <h2>Avisos de mascotas encontradas (${found.length})</h2>
      ${found.length ? `<ul class="admin-list">${found.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((f) => `
        <li>
          <img src="${esc(f.photo)}" alt="">
          <span>
            <strong>${f.petId ? `Coincide con ${esc(petName(f.petId) || '?')}` : 'Sin coincidencia'}</strong>
            <small>${esc(f.finderName)} · ${timeAgo(f.createdAt)} · ${f.status === 'open' ? '🟠 Abierto' : '⚪ Cerrado'}${f.bestScore != null ? ` · parecido máx. ${Math.round(f.bestScore * 100)}%` : ''}</small>
          </span>
          <span class="row-actions">
            <button class="btn small" data-toggle="${f.id}">${f.status === 'open' ? 'Cerrar' : 'Reabrir'}</button>
            <button class="btn small danger" data-del="${f.id}">Eliminar</button>
          </span>
        </li>`).join('')}</ul>` : '<p class="muted">No hay avisos.</p>'}
    </div>`;

  panel.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', async () => {
      const pet = pets.find((p) => p.id === b.dataset.edit);
      const name = prompt('Nombre de la mascota', pet.name);
      if (name === null) return;
      const diseases = prompt('Enfermedades', pet.diseases ?? '');
      if (diseases === null) return;
      const vaccines = prompt('Vacunas', pet.vaccines ?? '');
      if (vaccines === null) return;
      await savePet({ ...pet, name, diseases, vaccines });
      toast('Alerta actualizada', 'ok');
      refresh();
    }),
  );
  panel.querySelectorAll('[data-home]').forEach((b) =>
    b.addEventListener('click', async () => {
      await markRecovered(pets.find((p) => p.id === b.dataset.home));
      refresh();
    }),
  );
  panel.querySelectorAll('[data-toggle]').forEach((b) =>
    b.addEventListener('click', async () => {
      const f = found.find((x) => x.id === b.dataset.toggle);
      await saveFound({ ...f, status: f.status === 'open' ? 'closed' : 'open' });
      refresh();
    }),
  );
  panel.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('¿Eliminar este aviso?')) return;
      await deleteFound(b.dataset.del);
      refresh();
    }),
  );
}

async function mensajes(panel, { refresh }) {
  const [{ people: users }, contacts] = await Promise.all([loadPeople(), listContacts()]);
  const appUsers = users.filter((u) => u.hasProfile).length;
  // "Responder" o "Enviar mensaje" desde otra pestaña dejan elegido al destinatario.
  let to = sessionStorage.getItem('petsafe-admin-to') || '*';
  sessionStorage.removeItem('petsafe-admin-to');
  const unread = contacts.filter((c) => !c.read).length;

  panel.innerHTML = `
    <div class="card">
      <h2>Mensajes recibidos${unread ? ` (${unread} sin leer)` : ''}</h2>
      ${contacts.length ? contacts.map((c) => `
        <div class="contact-msg ${c.read ? '' : 'unread'}">
          <strong>${esc(c.name || 'Usuario')}</strong>
          <small class="muted">${esc(c.phone)} · ${timeAgo(c.createdAt)}</small>
          <p>${esc(c.body)}</p>
          <span class="row-actions">
            <button class="btn small" data-reply="${esc(c.userId)}" data-cid="${c.id}">Responder</button>
            ${c.read ? '' : `<button class="btn small ghost" data-readc="${c.id}">Marcar leído</button>`}
            <button class="btn small danger" data-delm="${c.id}">Eliminar</button>
          </span>
        </div>`).join('') : '<p class="muted">Todavía no hay mensajes de usuarios.</p>'}
    </div>
    <div class="card" id="send">
      <h2>Enviar mensaje</h2>
      <form class="form" id="msg">
        <div class="recipient"><strong>Para:</strong> <span id="to-label"></span>
          <button type="button" class="link" id="to-all">Enviar a todos</button></div>
        <input class="search" type="search" id="q" placeholder="Buscar usuario por nombre, teléfono o correo" autocomplete="off">
        <ul class="user-results" id="results"></ul>
        <label>Título<input name="title" required maxlength="80"></label>
        <label>Mensaje<textarea name="body" rows="4" required maxlength="500"></textarea></label>
        <button class="btn primary big">Enviar notificación</button>
      </form>
    </div>`;

  const setTo = (id) => {
    to = users.some((u) => u.id === id) ? id : '*';
    const u = users.find((x) => x.id === to);
    panel.querySelector('#to-label').textContent = u ? [fullName(u), u.phone || u.email].filter(Boolean).join(' · ') : `Todos los usuarios de la app (${appUsers})`;
    panel.querySelector('#to-all').hidden = to === '*';
  };
  setTo(to);
  panel.querySelector('#to-all').addEventListener('click', () => setTo('*'));
  userSearch(panel.querySelector('#q'), panel.querySelector('#results'), users, (u) => `
    <li><span><strong>${esc(fullName(u))}</strong><small>${esc([u.phone, u.email].filter(Boolean).join(' · '))}</small>${u.teams.length ? `<small>${u.teams.map((t) => esc(teamText(t))).join('<br>')}</small>` : ''}</span>
    <button type="button" class="btn small" data-pick="${esc(u.id)}">Elegir</button></li>`, (el) => {
    el.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
      setTo(b.dataset.pick);
      panel.querySelector('#q').value = '';
      el.innerHTML = '';
    }));
  });

  panel.querySelectorAll('[data-reply]').forEach((b) =>
    b.addEventListener('click', async () => {
      setTo(b.dataset.reply);
      await markContactRead(b.dataset.cid);
      b.closest('.contact-msg').classList.remove('unread');
      panel.querySelector('#send').scrollIntoView({ behavior: 'smooth' });
      panel.querySelector('input[name=title]').focus({ preventScroll: true });
    }),
  );
  panel.querySelectorAll('[data-readc]').forEach((b) =>
    b.addEventListener('click', async () => {
      await markContactRead(b.dataset.readc);
      refresh();
    }),
  );
  panel.querySelectorAll('[data-delm]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('¿Eliminar este mensaje?')) return;
      await deleteContact(b.dataset.delm);
      refresh();
    }),
  );

  panel.querySelector('#msg').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const msg = { type: 'admin', title: f.get('title').trim(), body: f.get('body').trim() };
    if (to === '*') await notifyAll(msg);
    else await notify(to, msg);
    changed();
    e.target.reset();
    setTo('*');
    toast('Mensaje enviado ✉️', 'ok');
  });
}

// Buscador de usuarios por nombre, apellido, teléfono, correo o dirección
// (sin distinguir mayúsculas ni tildes). Muestra hasta 10 resultados.
function userSearch(input, list, users, row, bind) {
  const norm = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const digits = (t) => String(t ?? '').replace(/\D/g, '');
  input.addEventListener('input', () => {
    const q = norm(input.value.trim());
    if (!q) return (list.innerHTML = '');
    const qd = digits(q);
    const found = users.filter((u) =>
      [u.name, u.firstName, u.lastName, u.email, u.address, ...(u.teams || []).map((t) => t.place)].some((v) => norm(v).includes(q)) ||
      (qd.length >= 3 && digits(u.phone).includes(qd)));
    list.innerHTML = found.slice(0, 10).map(row).join('') ||
      '<li><span class="muted">Ningún usuario coincide.</span></li>';
    if (found.length > 10) list.insertAdjacentHTML('beforeend', `<li><span class="muted">y ${found.length - 10} más: escribe algo más específico.</span></li>`);
    bind(list);
  });
}

// Todas las personas que usan Kiltrazo: las de la app (tienen perfil) y las
// que entran a Kiltrazo Clínica o Municipal, aunque no tengan perfil. Cada una
// trae dónde trabaja (teams) y el correo de su cuenta si falta en el perfil.
async function loadPeople() {
  const { allClinics } = await import('../clinic/data.js');
  const { roleName } = await import('../clinic/ui.js');
  const [users, pets, clinics, accounts] = await Promise.all([listUsers(), allPets(), allClinics().catch(() => []), listAccounts()]);
  const mail = new Map(accounts.map((a) => [a.id, a]));
  const people = users.map((u) => ({ ...u, email: u.email || mail.get(u.id)?.email || '', hasProfile: true, teams: [] }));
  for (const c of clinics) {
    for (const m of c.members || []) {
      let p = people.find((x) => x.id === m.userId);
      if (!p) {
        const a = mail.get(m.userId);
        p = { id: m.userId, name: m.name, firstName: '', lastName: '', phone: '', email: a?.email || '', address: '', createdAt: a?.createdAt || m.createdAt, hasProfile: false, teams: [] };
        people.push(p);
      }
      p.teams.push({ muni: c.kind === 'municipio', point: c.kind === 'kiltrazo', place: c.name, placePhone: c.phone || '', role: roleName(m.role, c), isAdmin: !!m.isAdmin });
    }
  }
  for (const p of people) {
    const own = pets.filter((x) => x.ownerId === p.id).length;
    p.app = p.hasProfile && (own > 0 || !p.teams.length);
    p.clinic = p.teams.some((t) => !t.muni && !t.point);
    p.muni = p.teams.some((t) => t.muni);
    p.phone = p.phone || '';
  }
  return { people, users, pets };
}

const fullName = (u) => (u.firstName ? `${u.firstName} ${u.lastName || ''}`.trim() : u.name) || 'Sin nombre';
const teamText = (t) => `${t.point ? '📷' : t.muni ? '🏛️' : '🏥'} ${t.place} · ${t.role}${t.isAdmin ? ' (administra)' : ''}`;
// Cómo usa Kiltrazo: "App", "Clínica", "Municipal" (puede ser más de uno).
const usesText = (p) => [p.app && 'App', p.clinic && 'Clínica', p.muni && 'Municipal'].filter(Boolean).join(', ');

// Lista de usuarios; al tocar uno se ven sus datos y sus mascotas.
async function usuarios(panel, { refresh }) {
  const { people: users, pets } = await loadPeople();
  const petsOf = (id) => pets.filter((p) => p.ownerId === id);
  const sorted = [...users].sort((a, b) => fullName(a).localeCompare(fullName(b), 'es'));
  const orphans = pets.filter((p) => !users.some((u) => u.id === p.ownerId));
  const KINDS = [['all', 'Todos', () => true], ['app', '🐾 App', (u) => u.app], ['clinic', '🏥 Clínica', (u) => u.clinic], ['muni', '🏛️ Municipal', (u) => u.muni]];
  let kind = sessionStorage.getItem('petsafe-admin-kind') || 'all';
  if (!KINDS.some(([k]) => k === kind)) kind = 'all';
  // Si no dejó teléfono, el de su clínica o municipalidad sirve para ubicarlo.
  const phoneLine = (u) => {
    if (u.phone) return `<a href="tel:${esc(u.phone.replace(/[^\d+]/g, ''))}">${esc(u.phone)}</a>`;
    const t = u.teams.find((x) => x.placePhone);
    return t ? `<a href="tel:${esc(t.placePhone.replace(/[^\d+]/g, ''))}">${esc(t.placePhone)}</a> <span class="muted">(de ${esc(t.place)})</span>` : 'No informó';
  };

  const petItem = (p) => `
    <li>
      ${p.photo ? `<img src="${esc(p.photo)}" alt="">` : ''}
      <span><strong>${esc(p.name || 'Sin nombre')}</strong>
        <small>${[describe(p), p.status === 'lost' ? '🔴 Perdida' : '🟢 En casa'].filter(Boolean).map(esc).join(' · ')}</small>
        <small>Enfermedades: ${esc(p.diseases || 'No informó')}</small>
        <small>Vacunas: ${esc(p.vaccines || 'No informó')}</small>
        <small>Registrada ${timeAgo(p.createdAt)}</small></span>
      <button type="button" class="link danger small" data-delpet="${esc(p.id)}">Eliminar</button>
    </li>`;

  panel.innerHTML = `
    <div class="card wide">
      <h2>Usuarios (${users.length}) · Mascotas (${pets.length})</h2>
      <div class="chips user-kinds">${KINDS.map(([k, l, f]) => `<button type="button" class="chip ${k === kind ? 'on' : ''}" data-kind="${k}">${l} (${users.filter(f).length})</button>`).join('')}</div>
      <input class="search" type="search" id="uq" placeholder="🔍 Buscar: nombre, teléfono, correo, clínica o municipalidad" autocomplete="off">
      <ul class="user-list">${sorted.map((u) => {
        const own = petsOf(u.id);
        return `
        <li data-u="${esc(u.id)}" data-kinds="${['all', u.app && 'app', u.clinic && 'clinic', u.muni && 'muni'].filter(Boolean).join(' ')}" data-text="${esc([fullName(u), u.phone, u.email, u.address, ...u.teams.map((t) => t.place)].join(' '))}">
          <button type="button" class="user-row" aria-expanded="false">
            <span><strong>${esc(fullName(u))}</strong><small>${esc([u.email, u.phone].filter(Boolean).join(' · ') || 'Sin datos de contacto')}</small>
              ${u.teams.length ? `<small class="user-teams">${u.teams.map((t) => esc(teamText(t))).join('<br>')}</small>` : ''}</span>
            ${u.app || own.length ? `<span class="count">🐾 ${own.length}</span>` : ''}
          </button>
          <div class="user-detail" hidden>
            <p class="small">📞 ${phoneLine(u)}<br>✉️ ${u.email ? `<a href="mailto:${esc(u.email)}">${esc(u.email)}</a>` : 'No informó'}<br>🏠 ${esc(u.address || 'No informó')}<br>Usuario desde ${esc(day(u.createdAt) || '—')}${u.hasProfile ? `<br>${u.promos ? `✅ Acepta ofertas${u.promosAt ? ` desde ${esc(day(u.promosAt))}` : ''}` : '🚫 No acepta ofertas'}` : '<br>Entra solo a Kiltrazo ' + (u.muni && !u.clinic ? 'Municipal' : 'Clínica') + ', sin perfil en la app.'}</p>
            ${own.length ? `<ul class="pet-list">${own.map(petItem).join('')}</ul>` : u.app ? '<p class="muted">Sin mascotas registradas.</p>' : ''}
            <span class="row-actions">
              <button type="button" class="btn small" data-msg="${esc(u.id)}">Enviar mensaje</button>
              ${own.length ? `<button type="button" class="btn small ghost" data-move="${esc(u.id)}">Pasar mascotas a otra cuenta</button>` : ''}
            </span>
            <button type="button" class="link danger small" data-deluser="${esc(u.id)}">Eliminar usuario</button>
            <div class="move-box" hidden>
              <p class="small">¿Perdió su celular y no tenía clave? Pídele que abra Kiltrazo en el celular nuevo y escriba su nombre en Perfil. Llámalo a este teléfono para confirmar que es la persona y busca aquí su cuenta nueva.</p>
              <input class="search" type="search" placeholder="🔍 Buscar la cuenta nueva" autocomplete="off">
              <ul class="user-results"></ul>
            </div>
          </div>
        </li>`;
      }).join('') || '<li class="muted">Todavía no hay usuarios.</li>'}</ul>
    </div>
    ${orphans.length ? `
      <div class="card">
        <h2>Mascotas sin perfil de dueño (${orphans.length})</h2>
        <ul class="pet-list">${orphans.map(petItem).join('')}</ul>
      </div>` : ''}`;

  panel.querySelectorAll('.user-row').forEach((b) => b.addEventListener('click', () => {
    const open = b.getAttribute('aria-expanded') !== 'true';
    b.setAttribute('aria-expanded', String(open));
    b.nextElementSibling.hidden = !open;
  }));
  const norm = (t) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const filter = () => {
    const q = norm(panel.querySelector('#uq').value.trim());
    const qd = q.replace(/\D/g, '');
    panel.querySelectorAll('[data-u]').forEach((li) => {
      const t = norm(li.dataset.text);
      li.hidden = !li.dataset.kinds.split(' ').includes(kind) ||
        (!!q && !t.includes(q) && !(qd.length >= 3 && t.replace(/\D/g, '').includes(qd)));
    });
  };
  panel.querySelector('#uq').addEventListener('input', filter);
  panel.querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', () => {
    kind = b.dataset.kind;
    sessionStorage.setItem('petsafe-admin-kind', kind);
    panel.querySelectorAll('[data-kind]').forEach((x) => x.classList.toggle('on', x === b));
    filter();
  }));
  filter();
  // Borrar no se puede deshacer: se confirma escribiendo el nombre.
  const confirmName = (name, what) => {
    const typed = prompt(`${what} No se puede deshacer.\n\nPara confirmar, escribe: ${name}`);
    if (typed == null) return false;
    if (typed.trim().toLowerCase() !== name.trim().toLowerCase()) {
      toast('El nombre no coincide. No se borró nada.', 'bad');
      return false;
    }
    return true;
  };
  panel.querySelectorAll('[data-deluser]').forEach((b) => b.addEventListener('click', async () => {
    const u = users.find((x) => x.id === b.dataset.deluser);
    const n = petsOf(u.id).length;
    const team = u.teams.length ? ` También sale del equipo de ${u.teams.map((t) => t.place).join(', ')}.` : '';
    if (!confirmName(fullName(u), `Se borrará la cuenta de ${fullName(u)}${n ? ` y sus ${n === 1 ? 'mascota' : `${n} mascotas`}` : ''}.${team}`)) return;
    try {
      await adminDeleteUser(u.id);
      toast(`${fullName(u)} fue eliminado`, 'ok');
      refresh();
    } catch (err) {
      toast(err.message, 'bad');
    }
  }));
  panel.querySelectorAll('[data-delpet]').forEach((b) => b.addEventListener('click', async () => {
    const p = pets.find((x) => x.id === b.dataset.delpet);
    if (!confirmName(p.name || 'Sin nombre', `Se borrará a ${p.name || 'esta mascota'} con su biometría y fotos.`)) return;
    try {
      await adminDeletePet(p.id);
      toast(`${p.name} fue eliminada`, 'ok');
      refresh();
    } catch (err) {
      toast(err.message, 'bad');
    }
  }));
  panel.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', () => {
    const from = users.find((u) => u.id === b.dataset.move);
    const box = b.closest('.user-detail').querySelector('.move-box');
    box.hidden = !box.hidden;
    if (box.dataset.ready) return;
    box.dataset.ready = '1';
    const others = users.filter((u) => u.id !== from.id && u.hasProfile);
    userSearch(box.querySelector('input'), box.querySelector('ul'), others, (u) => `
      <li><span><strong>${esc(fullName(u))}</strong><small>${esc([u.phone, u.email].filter(Boolean).join(' · ') || 'Sin datos')} · desde ${esc(day(u.createdAt))}</small></span>
      <button type="button" class="btn small primary" data-to="${esc(u.id)}">Pasar aquí</button></li>`, (list) => {
      list.querySelectorAll('[data-to]').forEach((t) => t.addEventListener('click', async () => {
        const to = users.find((u) => u.id === t.dataset.to);
        const n = petsOf(from.id).length;
        if (!confirm(`¿Pasar ${n === 1 ? 'la mascota' : `las ${n} mascotas`} de ${fullName(from)} (${from.phone || 'sin teléfono'}) a ${fullName(to)} (${to.phone || 'sin teléfono'})?`)) return;
        try {
          await moveUserPets(from.id, to.id);
          await notify(to.id, { type: 'admin', title: 'Recuperamos tus mascotas 🐾', body: 'Tus mascotas ya están en esta cuenta. Crea una clave en Perfil → Tu cuenta para no perderlas si cambias de celular.' });
          toast('Mascotas traspasadas', 'ok');
          refresh();
        } catch (err) {
          toast(err.message, 'bad');
        }
      }));
    });
  }));
  panel.querySelectorAll('[data-msg]').forEach((b) => b.addEventListener('click', () => {
    sessionStorage.setItem('petsafe-admin-to', b.dataset.msg);
    sessionStorage.setItem('petsafe-admin-tab', 'mensajes');
    refresh();
  }));
}

// Punto Kiltrazo: el punto de reconocimiento facial propio de Kiltrazo, sin
// clínica. El administrador lo abre aquí y da o quita el permiso a usuarios de
// la app; ellos lo abren desde Perfil.
async function punto(panel, { refresh }) {
  const { allClinics, setPointUser } = await import('../clinic/data.js');
  const [{ people }, clinics] = await Promise.all([loadPeople(), allClinics().catch(() => [])]);
  const point = clinics.find((c) => c.kind === 'kiltrazo');
  const allowed = (point?.members || []).filter((m) => m.role === 'punto')
    .map((m) => people.find((u) => u.id === m.userId) || { id: m.userId, name: m.name || 'Sin nombre', phone: '', email: '' });
  const contact = (u) => esc([u.phone, u.email].filter(Boolean).join(' · ') || 'Sin datos de contacto');
  panel.innerHTML = `
    <div class="card">
      <h2>📷 Punto Kiltrazo</h2>
      <p>Punto de reconocimiento facial propio de Kiltrazo, sin clínica. Filmas la cara de la mascota, pones su nombre y el de su dueño, y se la entregas con un QR. Sirve para ferias, eventos u operativos.</p>
      <a class="btn primary big" href="#/punto">Abrir punto</a>
    </div>
    <div class="card">
      <h2>Quién puede usar el punto (${allowed.length})</h2>
      <p class="small muted">Lo abren en su app, en Perfil → "Punto de reconocimiento facial". Solo ven esa pantalla: no ven las mascotas registradas ni los datos de los dueños.</p>
      <ul class="user-list point-list">${allowed.map((u) => `
        <li><span><strong>${esc(fullName(u))}</strong><small>${contact(u)}</small></span>
          <button type="button" class="link danger small" data-off="${esc(u.id)}">Quitar permiso</button></li>`).join('') || '<li><span class="muted">Nadie todavía.</span></li>'}
      </ul>
      <h3>Dar permiso</h3>
      <input class="search" type="search" id="pq" placeholder="🔍 Buscar usuario: nombre, teléfono o correo" autocomplete="off">
      <ul class="user-list point-list" id="pq-list"></ul>
    </div>`;
  const set = async (id, on, b) => {
    b.disabled = true;
    try {
      await setPointUser(id, on);
      toast(on ? 'Permiso dado 📷' : 'Permiso quitado', 'ok');
      refresh();
    } catch (err) {
      toast(err.message, 'bad');
      b.disabled = false;
    }
  };
  panel.querySelectorAll('[data-off]').forEach((b) => b.addEventListener('click', () => set(b.dataset.off, false, b)));
  const candidates = people.filter((u) => u.hasProfile && !allowed.some((a) => a.id === u.id));
  userSearch(panel.querySelector('#pq'), panel.querySelector('#pq-list'), candidates, (u) => `
    <li><span><strong>${esc(fullName(u))}</strong><small>${contact(u)}</small></span>
    <button type="button" class="btn small primary" data-on="${esc(u.id)}">Dar permiso</button></li>`, (list) => {
    list.querySelectorAll('[data-on]').forEach((b) => b.addEventListener('click', () => set(b.dataset.on, true, b)));
  });
}

// Estudio de ganado: los invitados que filman (cada uno con su código, sin
// cuenta), lo filmado y la descarga de todos los videos (una carpeta por
// autocrotal) para medir el reconocimiento.
async function estudio(panel, { refresh }) {
  const [videos, guests, horses] = await Promise.all([studyList().catch(() => null), studyGuests().catch(() => []), studyHorses().catch(() => [])]);
  const horseName = (tag) => horses.find((h) => h.tag === tag)?.name || '';
  if (!videos) {
    panel.innerHTML = '<div class="card"><h2>🐄 Estudio de ganado</h2><p>Falta correr el SQL del estudio en Supabase (documentos/estudio-ganado-sql.txt).</p></div>';
    return;
  }
  const link = `${SITE_URL}/#/estudio`;
  const who = (v) => (v.guest ? `Invitado ${v.guest}` : 'Administrador');
  // Un animal por autocrotal: cuántos videos de cara y morro, y en qué días.
  const animals = new Map();
  for (const v of videos) {
    const a = animals.get(v.tag) || { tag: v.tag, species: v.species, sex: v.sex, cara: 0, morro: 0, days: new Set() };
    a[v.part] += 1;
    a.days.add(day(v.createdAt));
    animals.set(v.tag, a);
  }
  const list = [...animals.values()];
  const twice = list.filter((a) => a.days.size >= 2).length;
  const mb = (videos.reduce((n, v) => n + (v.size || 0), 0) / 1048576).toFixed(0);
  const wa = (g) => `https://wa.me/?text=${encodeURIComponent(`¡Hola! Muchas gracias por ayudarnos con el estudio de reconocimiento facial de Kiltrazo para vacas y caballos 🐄🐴

Para entrar al Punto de estudio abre este enlace en tu celular:
${link}

Y escribe tu código: *${g.code}*

No necesitas crear cuenta ni instalar nada. En "¿Cómo se usa?" está el manual con todos los pasos.

¡Gracias de nuevo por tu ayuda! 🙌`)}`;
  panel.innerHTML = `
    <div class="card">
      <h2>🐄 Estudio de ganado</h2>
      <p>Para probar si el reconocimiento facial sirve con vacas y caballos. Cada invitado filma la cara y el morro de cada animal, con su autocrotal y sexo. Hay que filmar los mismos animales dos días distintos.</p>
      <a class="btn primary big" href="#/estudio">Abrir punto de estudio</a>
    </div>
    <div class="card">
      <h2>Invitados (${guests.length})</h2>
      <p class="small muted">Crea un invitado y mándale su código por WhatsApp. Entra en <strong>${esc(link)}</strong> con el código, sin crear cuenta. Solo puede subir videos: no ve lo filmado ni las mascotas.</p>
      <ul class="user-list point-list">${guests.map((g) => `
        <li><span><strong>Invitado ${g.n}</strong><small>Código <strong class="study-code">${esc(g.code)}</strong> · ${g.devices ? `${g.devices} ${g.devices === 1 ? 'celular' : 'celulares'}` : 'aún no entra'}</small></span>
          <span class="study-guest-btns"><a class="btn small secondary" href="${esc(wa(g))}" target="_blank" rel="noopener">WhatsApp</a>
          <button type="button" class="link danger small" data-del="${esc(g.id)}" data-n="${g.n}">Quitar</button></span></li>`).join('') || '<li><span class="muted">Nadie todavía.</span></li>'}
      </ul>
      <button class="btn primary" id="study-new">+ Crear invitado</button>
    </div>
    <div class="card">
      <h2>Lo filmado</h2>
      <p><strong>${list.length}</strong> ${list.length === 1 ? 'animal' : 'animales'} · <strong>${twice}</strong> filmados en dos días o más · ${videos.length} videos (${mb} MB)</p>
      ${list.length ? `<div class="study-wrap"><table class="study-table">
        <tr><th>Autocrotal o registro</th><th>Especie</th><th>Sexo</th><th>Cara</th><th>Morro</th><th>Días</th></tr>
        ${list.map((a) => `<tr><td>${esc(a.tag)}${horseName(a.tag) ? ` · ${esc(horseName(a.tag))}` : ''}</td><td>${a.species === 'caballo' ? '🐴 Caballo' : '🐄 Bovino'}</td><td>${a.sex === 'macho' ? 'Macho' : 'Hembra'}</td><td>${a.cara}</td><td>${a.morro}</td><td>${a.days.size}</td></tr>`).join('')}
      </table></div>
      <button class="btn secondary" id="study-zip">⬇️ Descargar estudio (ZIP)</button>
      <p class="small muted" id="study-zip-msg">Baja todos los videos, una carpeta por autocrotal, más una planilla con los datos. Ese ZIP es el que se le sube a Claude.</p>` : '<p class="muted">Aún no hay videos.</p>'}
    </div>`;
  panel.querySelector('#study-new').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    try {
      const g = await studyNewGuest();
      toast(`Invitado ${g.n} creado: código ${g.code}`, 'ok');
      refresh();
    } catch (err) {
      toast(err.message, 'bad');
      b.disabled = false;
    }
  });
  panel.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(`¿Quitar al Invitado ${b.dataset.n}? Su código deja de servir. Lo que ya filmó se mantiene.`)) return;
    b.disabled = true;
    try {
      await studyDeleteGuest(b.dataset.del);
      refresh();
    } catch (err) {
      toast(err.message, 'bad');
      b.disabled = false;
    }
  }));
  panel.querySelector('#study-zip')?.addEventListener('click', async (e) => {
    const b = e.currentTarget;
    const msg = panel.querySelector('#study-zip-msg');
    b.disabled = true;
    try {
      const files = [];
      for (const [i, v] of videos.entries()) {
        msg.textContent = `Bajando video ${i + 1} de ${videos.length}…`;
        files.push({ name: `estudio-ganado/${v.path}`, data: await studyFile(v.path) });
      }
      const rows = [['autocrotal o registro', 'nombre', 'especie', 'sexo', 'parte', 'fecha', 'archivo', 'filmó'],
        ...[...videos].reverse().map((v) => [v.tag, horseName(v.tag), v.species, v.sex, v.part, v.createdAt, v.path, who(v)])];
      files.unshift({ name: 'estudio-ganado/datos.csv', data: new TextEncoder().encode(toCsv(rows)) });
      download(`kiltrazo-estudio-ganado-${day(new Date().toISOString())}.zip`, zip(files));
      msg.textContent = 'Listo. Revisa tus descargas.';
    } catch (err) {
      toast(`No se pudo descargar: ${err.message}`, 'bad');
      msg.textContent = '';
    }
    b.disabled = false;
  });
}

// Todas las clínicas de Kiltrazo y su equipo. El administrador de Kiltrazo
// maneja cuentas (quién administra cada clínica), no ve fichas clínicas.
// Banners del buscador de veterinarios (…/#/veterinarios).
async function publicidad(panel, { refresh }) {
  const { listBanners, saveBanner, deleteBanner } = await import('../clinic/data.js');
  const banners = await listBanners(true);
  const today = new Date().toISOString().slice(0, 10);
  const state = (b) => (!b.active ? 'Pausado' : b.startsOn && b.startsOn > today ? `Desde el ${b.startsOn.split('-').reverse().join('-')}`
    : b.endsOn && b.endsOn < today ? 'Terminado' : 'Se está mostrando');
  const form = (b = {}) => `
    <form class="form banner-form" data-id="${esc(b.id || '')}">
      <label>Imagen ${b.id ? '(deja vacío para mantenerla)' : ''}<input type="file" name="file" accept="image/*" ${b.id ? '' : 'required'}></label>
      <p class="small muted">Tamaño ideal: 1200 × 300 píxeles (4 a 1). Se achica sola si es más grande.</p>
      <label>Texto (para quien no ve la imagen)<input name="title" maxlength="120" value="${esc(b.title || '')}" placeholder="Ej.: 20% en alimento para gatos"></label>
      <label>Enlace al tocarla (opcional)<input name="link" type="url" value="${esc(b.link || '')}" placeholder="https://"></label>
      <div class="banner-dates">
        <label>Desde<input type="date" name="startsOn" value="${esc(b.startsOn || '')}"></label>
        <label>Hasta<input type="date" name="endsOn" value="${esc(b.endsOn || '')}"></label>
        <label>Orden<input type="number" name="sort" value="${b.sort ?? 0}" min="0" max="99"></label>
      </div>
      <label class="check"><input type="checkbox" name="active" ${b.active === false ? '' : 'checked'}> Activo</label>
      <button class="btn primary small">${b.id ? 'Guardar cambios' : 'Agregar banner'}</button>
    </form>`;

  panel.innerHTML = `
    <div class="card wide">
      <h2>Publicidad en el buscador de veterinarios</h2>
      <p class="small">Los banners se ven arriba de los resultados en <a href="#/veterinarios" target="_blank">el buscador</a>, marcados como “Publicidad”, uno a la vez. Si hay varios, van rotando.</p>
      <div class="banner-admin">${banners.map((b) => `
        <div class="banner-row" data-b="${esc(b.id)}">
          <img src="${esc(b.image)}" alt="${esc(b.title)}">
          <div>
            <strong>${esc(b.title || 'Sin texto')}</strong>
            <small>${esc(state(b))} · ${b.clicks || 0} ${b.clicks === 1 ? 'clic' : 'clics'}${b.endsOn ? ` · hasta el ${b.endsOn.split('-').reverse().join('-')}` : ''}</small>
            ${b.link ? `<small class="muted">${esc(b.link)}</small>` : ''}
            <span class="row-actions"><button class="link small" data-edit>Editar</button><button class="link small" data-toggle>${b.active ? 'Pausar' : 'Activar'}</button><button class="link danger small" data-del>Borrar</button></span>
          </div>
        </div>`).join('') || '<p class="muted">Aún no hay banners.</p>'}</div>
    </div>
    <div class="card"><h2>Nuevo banner</h2>${form()}</div>`;

  const shrink = (file) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = Math.min(1200, img.width);
      const c = document.createElement('canvas');
      c.width = w; c.height = Math.round((img.height * w) / img.width);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => reject(new Error('No pudimos leer esa imagen'));
    img.src = URL.createObjectURL(file);
  });
  const bind = (f) => f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = f.querySelector('button');
    btn.disabled = true;
    try {
      const d = Object.fromEntries(new FormData(f));
      const file = f.file.files[0];
      await saveBanner({ id: f.dataset.id || undefined, title: d.title.trim(), link: d.link.trim(), startsOn: d.startsOn, endsOn: d.endsOn,
        sort: d.sort, active: f.active.checked, image: file ? await shrink(file) : undefined });
      toast('Banner guardado', 'ok');
      refresh();
    } catch (err) {
      toast(err.message, 'bad');
      btn.disabled = false;
    }
  });
  panel.querySelectorAll('.banner-form').forEach(bind);
  panel.querySelectorAll('.banner-row').forEach((row) => {
    const b = banners.find((x) => x.id === row.dataset.b);
    row.querySelector('[data-edit]').addEventListener('click', () => {
      row.insertAdjacentHTML('afterend', form(b));
      bind(row.nextElementSibling);
      row.querySelector('[data-edit]').hidden = true;
    });
    row.querySelector('[data-toggle]').addEventListener('click', async () => { await saveBanner({ ...b, image: undefined, active: !b.active }); refresh(); });
    row.querySelector('[data-del]').addEventListener('click', async () => {
      if (!confirm('¿Borrar este banner?')) return;
      await deleteBanner(b.id);
      refresh();
    });
  });
}

// Kiltrazo Municipal: mismas acciones que las clínicas (aprobar, equipo, eliminar).
const municipios = (panel, ctx) => clinicas(panel, ctx, true);

async function clinicas(panel, { refresh }, muni = false) {
  const { allClinics, setClinicAdmin, createInvite, deleteClinic, approveClinic, fileUrls, muniStats } = await import('../clinic/data.js');
  const { rutOk } = await import('../clinic/review.js');
  const { TERMS_VERSION } = await import('../config.js');
  const { roleName } = await import('../clinic/ui.js');
  const [every, users] = await Promise.all([allClinics(), listUsers()]);
  const all = every.filter((c) => (muni ? c.kind === 'municipio' : !['municipio', 'kiltrazo'].includes(c.kind)));
  const stats = muni ? await muniStats().catch(() => ({})) : {};
  const ROLES = { vet: roleName('vet', { kind: muni ? 'municipio' : 'clinica' }), recepcion: roleName('recepcion', { kind: muni ? 'municipio' : 'clinica' }) };
  const word = muni ? 'municipalidad' : 'clínica';
  // Las que esperan aprobación van primero.
  const clinics = [...all.filter((c) => c.approved === false), ...all.filter((c) => c.approved !== false)];
  const waiting = clinics.filter((c) => c.approved === false).length;
  const emailOf = (id) => users.find((u) => u.id === id)?.email || '';
  // Enlaces temporales a los documentos que subió cada clínica para la revisión.
  const docs = clinics.flatMap((c) => (c.docs || []).map((d) => ({ id: d.path, path: d.path })));
  const urls = await fileUrls(docs).catch(() => ({}));
  const DOC_NAMES = { titulo: '🎓 Título', patente: '🏪 Patente' };
  const reviewInfo = (c) => {
    if (muni) {
      const st = stats[c.id] || {};
      return `<p class="admin-review small">Comuna <strong>${esc(c.comuna || '—')}</strong> · ${st.patients || 0} animales en fichas · ${st.filmed || 0} con cara filmada · ${st.drives || 0} operativos · ${st.bookings || 0} reservas${c.approved === false ? '<br><span class="warn">Antes de aprobar, confirma por teléfono o con un correo institucional que quien la creó trabaja en la municipalidad.</span>' : ''}</p>`;
    }
    const ds = c.docs || [];
    if (!c.rut && !ds.length) return c.approved === false ? '<p class="small warn">Todavía no sube RUT ni título.</p>' : '';
    return `
      <p class="admin-review small">
        ${c.rut ? `RUT <strong>${esc(c.rut)}</strong>${rutOk(c.rut) ? '' : ' <span class="warn">no válido</span>'}` : '<span class="warn">Sin RUT</span>'}
        ${['titulo', 'patente'].map((k) => {
          const d = ds.filter((x) => x.kind === k).at(-1);
          return d ? ` · <a href="${esc(urls[d.path] || '#')}" target="_blank" rel="noopener">${DOC_NAMES[k]}</a>` : k === 'titulo' ? ' · <span class="warn">Sin título</span>' : '';
        }).join('')}
        · ${c.termsAt ? `Aceptó los términos el ${new Date(c.termsAt).toLocaleDateString('es-CL')}${c.termsVersion === TERMS_VERSION ? '' : ' (versión anterior)'}` : '<span class="warn">No ha aceptado los términos</span>'}
      </p>`;
  };
  function clinicBox(c) {
        const admins = c.members.filter((m) => m.isAdmin).length;
        return `
        <div class="admin-clinic ${c.approved === false ? 'pending' : ''}" data-c="${esc(c.id)}">
          <div class="admin-clinic-head">
            <strong>${esc(c.name)}</strong>
            <small>${esc([muni ? c.comuna : c.address, c.phone].filter(Boolean).join(' · ') || 'Sin dirección')}</small>
            ${admins ? '' : '<span class="warn">⚠️ Sin administrador</span>'}
            ${c.approved === false ? `<span class="warn">🕒 Por aprobar</span>
              <span class="row-actions"><button class="btn small home" data-approve>✓ Aprobar ${word}</button></span>` : ''}
          </div>
          ${reviewInfo(c)}
          <ul class="admin-team">${c.members.map((m) => `
            <li><span><strong>${esc(m.name || 'Sin nombre')}</strong>
              <small>${esc([ROLES[m.role], emailOf(m.userId)].filter(Boolean).join(' · '))}${m.isAdmin ? ' · <b>administra</b>' : ''}</small></span>
              ${m.isAdmin
                ? (admins > 1 ? `<button class="link small" data-adm="${esc(m.userId)}" data-on="">Quitar administrador</button>` : '')
                : `<button class="btn small" data-adm="${esc(m.userId)}" data-on="1">Hacer administrador</button>`}
            </li>`).join('') || '<li class="muted">Sin equipo.</li>'}</ul>
          <details class="admin-invite"><summary class="link small">Código para un nuevo administrador</summary>
            <div class="row-actions">
              <select data-role><option value="vet">${ROLES.vet}</option><option value="recepcion">${ROLES.recepcion}</option></select>
              <button class="btn small secondary" data-inv>Crear código</button>
            </div>
            <p class="invite-code" data-code hidden></p>
            <p class="muted small">La persona entra a ${esc(link)}, crea su cuenta, toca "Me invitaron" y escribe el código. Queda como administradora. Sirve una vez y dura 7 días.</p>
          </details>
          <div class="row-actions">
            <button type="button" class="btn small" data-enter>👀 Entrar a esta ${word}</button>
            <button type="button" class="link danger small admin-del" data-delclinic>Eliminar ${word}</button>
          </div>
        </div>`;
  }
  const link = `${location.origin}${location.pathname}#/${muni ? 'municipio' : 'clinica'}`;

  panel.innerHTML = muni ? `
    <div class="card wide">
      <h2>Municipalidades (${clinics.length})${waiting ? ` <span class="warn">${waiting} por aprobar</span>` : ''}</h2>
      <p class="small muted">Entran en <a href="#/municipio" class="ck-mono">${esc(link)}</a>. Mientras no estén aprobadas pueden crear fichas y preparar operativos, pero los vecinos no pueden reservar y no ven el tablero de perdidos y encontrados.</p>
      <div class="admin-clinics">${clinics.map(clinicBox).join('') || '<p class="muted">Todavía no hay municipalidades.</p>'}</div>
    </div>` : `
    <div class="card">
      <h2>Si alguien pierde su clave</h2>
      <p class="small"><strong>Recuerda su correo:</strong> que toque "Olvidé mi contraseña" al entrar y siga el enlace que le llega.</p>
      <p class="small"><strong>Perdió también el correo:</strong> quien administra su clínica lo quita del equipo y lo invita de nuevo. Las fichas son de la clínica, no se pierde nada.</p>
      <p class="small"><strong>La clínica se quedó sin administrador:</strong> nombra a otra persona del equipo con "Hacer administrador", o crea un código para alguien nuevo.</p>
    </div>
    <div class="card wide">
      <h2>Clínicas (${clinics.length})${waiting ? ` <span class="warn">${waiting} por aprobar</span>` : ''}</h2>
      ${waiting ? '<p class="small muted">Antes de aprobar, abre el título y revisa que el nombre y el RUT calcen con quien está a cargo. Si tiene local, mira la patente. Puedes buscar al veterinario en el Colegio Médico Veterinario (colmevet.cl), aunque no todos son socios. Mientras tanto puede usar su agenda y fichas, pero no aparece en el mapa ni recibe horas desde la app.</p>' : ''}
      <div class="admin-clinics">${clinics.map(clinicBox).join('') || '<p class="muted">Todavía no hay clínicas.</p>'}</div>
    </div>`;

  panel.querySelectorAll('[data-adm]').forEach((b) => b.addEventListener('click', async () => {
    const clinic = clinics.find((c) => c.id === b.closest('[data-c]').dataset.c);
    const m = clinic.members.find((x) => x.userId === b.dataset.adm);
    const on = Boolean(b.dataset.on);
    if (!confirm(on ? `¿Dejar a ${m.name} como administrador/a de ${clinic.name}?` : `¿Quitarle a ${m.name} la administración de ${clinic.name}?`)) return;
    try {
      await setClinicAdmin(clinic.id, m.userId, on);
      toast(on ? `${m.name} ahora administra ${clinic.name}` : 'Listo', 'ok');
      refresh();
    } catch (err) {
      toast(err.message, 'bad');
    }
  }));
  panel.querySelectorAll('[data-approve]').forEach((b) => b.addEventListener('click', async () => {
    const clinic = clinics.find((c) => c.id === b.closest('[data-c]').dataset.c);
    b.disabled = true;
    try {
      await approveClinic(clinic.id);
      toast(`${clinic.name} quedó aprobada. Le avisamos a su equipo.`, 'ok');
      refresh();
    } catch (err) {
      toast(err.message, 'bad');
      b.disabled = false;
    }
  }));
  // Abre Kiltrazo Clínica (o Municipal) dentro de esa clínica, como si la administrara.
  panel.querySelectorAll('[data-enter]').forEach((b) => b.addEventListener('click', async () => {
    const { setVisiting, setActiveClinic } = await import('../clinic/data.js');
    const id = b.closest('[data-c]').dataset.c;
    setVisiting(id);
    setActiveClinic(id);
    go(muni ? '#/municipio' : '#/clinica');
  }));
  panel.querySelectorAll('[data-delclinic]').forEach((b) => b.addEventListener('click', async () => {
    const clinic = clinics.find((c) => c.id === b.closest('[data-c]').dataset.c);
    const typed = prompt(`Se borrará "${clinic.name}" con todo su equipo, pacientes, horas y fichas. No se puede deshacer.\n\nPara confirmar, escribe el nombre de la ${word}:`);
    if (typed == null) return;
    if (typed.trim().toLowerCase() !== clinic.name.trim().toLowerCase()) return toast('El nombre no coincide. No se borró nada.', 'bad');
    try {
      await deleteClinic(clinic.id);
      toast(`${clinic.name} fue eliminada`, 'ok');
      refresh();
    } catch (err) {
      toast(err.message, 'bad');
    }
  }));
  panel.querySelectorAll('[data-inv]').forEach((b) => b.addEventListener('click', async () => {
    const box = b.closest('[data-c]');
    const role = box.querySelector('[data-role]').value;
    b.disabled = true;
    try {
      const code = await createInvite(box.dataset.c, role, true);
      const out = box.querySelector('[data-code]');
      out.hidden = false;
      out.innerHTML = `<b>${esc(code)}</b><small>administrador/a · ${esc(ROLES[role].toLowerCase())}</small>`;
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      b.disabled = false;
    }
  }));
}

async function casos(panel, { refresh }) {
  const list = await latestSuccesses(50);
  const withComments = await Promise.all(list.map(async (s) => ({ ...s, comments: await commentsFor(s.id) })));

  panel.innerHTML = `
    <div class="card">
      <h2>Reencuentros (${list.length})</h2>
      ${withComments.map((s) => `
        <div class="admin-case">
          <div class="admin-list-row">
            <img src="${esc(s.photo)}" alt="">
            <span><strong>${esc(s.petName)}</strong><small>${timeAgo(s.createdAt)}</small></span>
            <button class="btn small danger" data-dels="${s.id}">Eliminar</button>
          </div>
          ${s.comments.map((c) => `
            <div class="admin-comment"><span><strong>${esc(c.author)}:</strong> ${esc(c.text)}</span>
            <button class="link danger" data-delc="${c.id}">borrar</button></div>`).join('')}
        </div>`).join('') || '<p class="muted">Aún no hay reencuentros.</p>'}
    </div>
    <div class="card">
      <h2>Datos de ejemplo</h2>
      <p class="muted">Agrega reencuentros de muestra para ver cómo se ve la pantalla de inicio.</p>
      <button class="btn secondary" id="demo">Cargar ejemplos</button>
    </div>`;

  panel.querySelectorAll('[data-dels]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('¿Eliminar este reencuentro?')) return;
      await deleteSuccess(b.dataset.dels);
      refresh();
    }),
  );
  panel.querySelectorAll('[data-delc]').forEach((b) =>
    b.addEventListener('click', async () => {
      await deleteComment(b.dataset.delc);
      refresh();
    }),
  );
  panel.querySelector('#demo').addEventListener('click', async () => {
    const demo = [
      ['Canela', '#E9A66B', 'La encontraron a dos cuadras del parque. ¡Gracias vecinos!'],
      ['Toby', '#8B5E3C', 'Estaba asustado en una plaza, lo escanearon y en 20 minutos estábamos juntos.'],
      ['Luna', '#F4D6A0', 'Una señora muy amable la cuidó toda la tarde.'],
      ['Rocky', '#5C4033', ''],
      ['Mía', '#D98C5F', 'Se había escapado por la reja. Ya arreglamos la reja 😅'],
      ['Bruno', '#C9B79C', ''],
    ];
    for (const [petName, color, story] of demo) await addSuccess({ petName, photo: dogAvatar(color), story });
    toast('Ejemplos cargados', 'ok');
    refresh();
  });
}

function dogAvatar(fur) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
    <rect width="200" height="200" fill="#FFE8CC"/>
    <ellipse cx="52" cy="80" rx="26" ry="46" fill="${fur}" transform="rotate(18 52 80)" opacity=".85"/>
    <ellipse cx="148" cy="80" rx="26" ry="46" fill="${fur}" transform="rotate(-18 148 80)" opacity=".85"/>
    <circle cx="100" cy="108" r="62" fill="${fur}"/>
    <ellipse cx="100" cy="135" rx="34" ry="26" fill="#FFF4E6"/>
    <circle cx="78" cy="98" r="8" fill="#3B2A20"/><circle cx="122" cy="98" r="8" fill="#3B2A20"/>
    <circle cx="80" cy="95" r="2.5" fill="#fff"/><circle cx="124" cy="95" r="2.5" fill="#fff"/>
    <ellipse cx="100" cy="124" rx="11" ry="8" fill="#3B2A20"/>
    <path d="M88 140 q12 12 24 0" stroke="#3B2A20" stroke-width="4" fill="none" stroke-linecap="round"/>
    <ellipse cx="100" cy="152" rx="7" ry="9" fill="#F28C8C"/>
  </svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

// Descarga de usuarios y mascotas para el administrador. Estos datos no se
// muestran en ninguna otra parte de la app.
async function datos(panel, { refresh }) {
  const [{ people: users, pets }, push] = await Promise.all([loadPeople(), pushConfigured()]);
  const staff = users.filter((u) => u.teams.length).length;
  panel.innerHTML = `
    ${CLOUD ? `
      <div class="card" id="push">
        <h2>Notificaciones push</h2>
        <p>${push
          ? '✅ Claves listas. Si ya publicaste la función send-push con sus secretos, los avisos llegan aunque la app esté cerrada.'
          : 'Para que los avisos lleguen con la app cerrada, genera las claves y cópialas en Supabase (Edge Functions → Secrets).'}</p>
        <button class="btn ${push ? 'ghost' : 'primary'}" id="vapid">${push ? 'Generar claves nuevas' : 'Generar claves'}</button>
        <div id="keys"></div>
      </div>` : ''}
    <div class="card">
      <h2>Usuarios y mascotas</h2>
      <p>${users.length} usuario${users.length === 1 ? '' : 's'}${staff ? ` (${staff} de Clínica o Municipal)` : ''} · ${pets.length} mascota${pets.length === 1 ? '' : 's'} registrada${pets.length === 1 ? '' : 's'}</p>
      <p class="muted small">Una fila por mascota con los datos de su dueño; los usuarios sin mascotas, como los equipos de clínicas y municipalidades, aparecen en una fila sin mascota. Las columnas “Usa Kiltrazo” y “Clínica o municipalidad” dicen dónde trabaja cada uno. Se abre en Excel o Google Sheets. El ZIP trae además la foto de cada mascota, con el nombre de archivo en la columna Foto.</p>
      <button class="btn primary big" id="zip">Descargar CSV con fotos (ZIP)</button>
      <button class="btn secondary" id="csv">Solo CSV</button>
    </div>
    <div class="card">
      <h2>Buscar usuario</h2>
      <input class="search" type="search" id="q" placeholder="Nombre, teléfono, correo o dirección" autocomplete="off">
      <ul class="user-results" id="results"></ul>
    </div>`;
  panel.querySelector('#vapid')?.addEventListener('click', async (e) => {
    if (push && !confirm('Con claves nuevas, cada celular debe abrir la app otra vez para volver a recibir notificaciones, y debes actualizar los secretos en Supabase. ¿Seguir?')) return;
    e.target.disabled = true;
    const { publicKey, privateKey } = await generateVapidKeys();
    await savePushKey(publicKey);
    enablePush().catch(() => {});
    const box = (name, value) => `
      <label>${name}<textarea readonly rows="3" data-copy>${esc(value)}</textarea></label>`;
    panel.querySelector('#keys').innerHTML = `
      <div class="form">
        <p class="note">Copia estos 3 secretos en Supabase → Edge Functions → Secrets. La clave privada se muestra solo ahora y no se la des a nadie.</p>
        ${box('VAPID_PUBLIC_KEY', publicKey)}
        ${box('VAPID_PRIVATE_KEY', privateKey)}
        ${box('VAPID_SUBJECT', 'mailto:tu-correo@ejemplo.com')}
      </div>`;
    panel.querySelectorAll('[data-copy]').forEach((t) => t.addEventListener('focus', () => t.select()));
    toast('Claves generadas', 'ok');
  });

  userSearch(panel.querySelector('#q'), panel.querySelector('#results'), users, (u) => {
    const own = pets.filter((p) => p.ownerId === u.id);
    return `<li><span><strong>${esc(fullName(u))}</strong>
      <small>${esc([u.phone && `📞 ${u.phone}`, u.email && `✉️ ${u.email}`].filter(Boolean).join(' · ') || 'Sin datos de contacto')}</small>
      ${u.teams.length ? `<small>${u.teams.map((t) => esc(teamText(t))).join('<br>')}</small>` : ''}
      ${u.address ? `<small>🏠 ${esc(u.address)}</small>` : ''}
      <small>🐾 ${own.length ? own.map((p) => `${esc(p.name)}${describe(p) ? ` (${esc(describe(p))})` : ''}${p.status === 'lost' ? ' (perdida)' : ''}`).join(', ') : 'Sin mascotas'}</small></span>
      <button type="button" class="btn small" data-msg="${esc(u.id)}">Mensaje</button></li>`;
  }, (el) => {
    el.querySelectorAll('[data-msg]').forEach((b) => b.addEventListener('click', () => {
      sessionStorage.setItem('petsafe-admin-to', b.dataset.msg);
      sessionStorage.setItem('petsafe-admin-tab', 'mensajes');
      refresh();
    }));
  });
  // Foto de cada mascota como archivo: fotos/<nombre>-<id>.jpg
  const photos = new Map();
  for (const p of pets) {
    const img = fromDataUrl(p.photo);
    if (!img) continue;
    const slug = (p.name || 'mascota').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'mascota';
    photos.set(p.id, { name: `fotos/${slug}-${String(p.id).replace(/[^a-zA-Z0-9]/g, '').slice(-6)}.${img.ext}`, data: img.data });
  }
  const table = () => {
    const header = [
      'Nombres', 'Apellidos', 'Teléfono', 'Correo', 'Dirección', 'Usuario desde', 'Acepta ofertas', 'Aceptó ofertas el', 'Usa Kiltrazo', 'Clínica o municipalidad',
      'Mascota', 'Tipo', 'Raza', 'Nombre del dueño (registro)', 'Estado', 'Enfermedades', 'Vacunas', 'Mascota registrada', 'Foto',
    ];
    // Celdas vacías con texto, para distinguir "no lo llenó" de un error.
    const or = (v, empty = 'No informó') => (v && String(v).trim()) || empty;
    const person = (u) => (u
      ? [u.firstName || u.name, u.lastName, u.phone || u.teams.find((t) => t.placePhone)?.placePhone || '', u.email, u.address, day(u.createdAt),
        u.promos ? 'Sí' : 'No', u.promos ? day(u.promosAt) || '' : '', usesText(u), u.teams.map((t) => `${t.place} (${t.role}${t.isAdmin ? ', administra' : ''})`).join(' / ')]
      : ['Sin perfil', '', '', '', '', '', '', '', '', '']);
    const rows = pets.map((p) => [
      ...person(users.find((u) => u.id === p.ownerId)),
      or(p.name, 'Sin nombre'), SPECIES[p.species] || 'No informó', or(p.breed), or(p.ownerName), p.status === 'lost' ? 'Perdida' : 'En casa',
      or(p.diseases), or(p.vaccines), day(p.createdAt), photos.get(p.id)?.name || 'Sin foto',
    ]);
    // Personas que crearon perfil pero aún no registran mascotas: al final.
    for (const u of users) if (!pets.some((p) => p.ownerId === u.id)) rows.push([...person(u), 'Sin mascota', '', '', '', '', '', '', '', '']);
    return toCsv([header, ...rows]);
  };
  const name = `kiltrazo-datos-${day(new Date().toISOString())}`;
  panel.querySelector('#csv').addEventListener('click', () => {
    download(`${name}.csv`, new Blob([table()], { type: 'text/csv;charset=utf-8' }));
  });
  panel.querySelector('#zip').addEventListener('click', () => {
    const csv = { name: `${name}.csv`, data: new TextEncoder().encode(table()) };
    download(`${name}.zip`, zip([csv, ...photos.values()]));
  });
}

const day = (iso) => (iso ? String(iso).slice(0, 10) : '');

// Separado por punto y coma y con BOM, para que Excel en español lo abra bien.
// Los valores que empiezan con = + - @ se anteponen con ' para que Excel no
// los ejecute como fórmula.
function toCsv(rows) {
  const cell = (v) => {
    let t = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
    return `"${t.replace(/"/g, '""')}"`;
  };
  return '\ufeff' + rows.map((r) => r.map(cell).join(';')).join('\r\n');
}

function download(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
