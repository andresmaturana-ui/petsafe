import {
  allPets, savePet, allFound, saveFound, deleteFound, listUsers, notify, notifyAll,
  latestSuccesses, deleteSuccess, commentsFor, deleteComment, addSuccess, markRecovered,
  CLOUD, isAdmin, claimAdmin, listContacts, markContactRead, deleteContact,
} from '../data.js';
import { esc, timeAgo, toast, changed } from '../ui.js';
import { SPECIES, describe } from '../breeds.js';

// PIN de prototipo. En producción el acceso de administrador debe
// validarse en el servidor con un rol de usuario.
const ADMIN_PIN = import.meta.env.VITE_ADMIN_PIN || '1234';

export default async function admin(el, _params, ctx) {
  if (CLOUD ? !(await isAdmin()) : sessionStorage.getItem('petsafe-admin') !== 'ok') {
    return CLOUD ? claim(el, ctx) : login(el, ctx);
  }

  const tab = sessionStorage.getItem('petsafe-admin-tab') || 'alertas';
  el.innerHTML = `
    <div class="admin-head">
      <h1>Administrador</h1>
      <div class="tabs">
        ${[['alertas', '🚨 Alertas'], ['mensajes', '📢 Mensajes'], ['casos', '💛 Reencuentros'], ['datos', '📋 Datos']]
          .map(([k, l]) => `<button class="tab ${k === tab ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}
      </div>
    </div>
    <div id="panel"></div>`;

  el.querySelectorAll('.tab').forEach((b) =>
    b.addEventListener('click', () => {
      sessionStorage.setItem('petsafe-admin-tab', b.dataset.tab);
      ctx.refresh();
    }),
  );

  const panel = el.querySelector('#panel');
  await ({ alertas, mensajes, casos, datos })[tab](panel, ctx);
}

// Con Supabase el permiso vive en el servidor: el primer usuario que lo pide
// queda como administrador (tabla admins).
function claim(el, { refresh }) {
  el.innerHTML = `
    <div class="card">
      <h1>Administrador 🔐</h1>
      <p>El primer usuario que toque este botón queda como administrador de Pet Safe. Después, nadie más puede tomarlo desde la app.</p>
      <button class="btn primary big" id="claim">Soy el administrador</button>
    </div>`;
  el.querySelector('#claim').addEventListener('click', async () => {
    if (await claimAdmin()) refresh();
    else toast('Ya hay un administrador. Pídele acceso.', 'bad');
  });
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
  const [users, contacts] = await Promise.all([listUsers(), listContacts()]);
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
    panel.querySelector('#to-label').textContent = u ? `${u.name} · ${u.phone}` : `Todos los usuarios (${users.length})`;
    panel.querySelector('#to-all').hidden = to === '*';
  };
  setTo(to);
  panel.querySelector('#to-all').addEventListener('click', () => setTo('*'));
  userSearch(panel.querySelector('#q'), panel.querySelector('#results'), users, (u) => `
    <li><span><strong>${esc(u.name)}</strong><small>${esc(u.phone)}${u.email ? ` · ${esc(u.email)}` : ''}</small></span>
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
      [u.name, u.firstName, u.lastName, u.email, u.address].some((v) => norm(v).includes(q)) ||
      (qd.length >= 3 && digits(u.phone).includes(qd)));
    list.innerHTML = found.slice(0, 10).map(row).join('') ||
      '<li><span class="muted">Ningún usuario coincide.</span></li>';
    if (found.length > 10) list.insertAdjacentHTML('beforeend', `<li><span class="muted">y ${found.length - 10} más: escribe algo más específico.</span></li>`);
    bind(list);
  });
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
  const [users, pets] = await Promise.all([listUsers(), allPets()]);
  panel.innerHTML = `
    <div class="card">
      <h2>Usuarios y mascotas</h2>
      <p>${users.length} usuario${users.length === 1 ? '' : 's'} · ${pets.length} mascota${pets.length === 1 ? '' : 's'} registrada${pets.length === 1 ? '' : 's'}</p>
      <p class="muted small">Una fila por mascota con los datos de su dueño; los usuarios sin mascotas aparecen en una fila sin mascota. Se abre en Excel o Google Sheets.</p>
      <button class="btn primary big" id="csv">Descargar CSV</button>
    </div>
    <div class="card">
      <h2>Buscar usuario</h2>
      <input class="search" type="search" id="q" placeholder="Nombre, teléfono, correo o dirección" autocomplete="off">
      <ul class="user-results" id="results"></ul>
    </div>`;
  userSearch(panel.querySelector('#q'), panel.querySelector('#results'), users, (u) => {
    const own = pets.filter((p) => p.ownerId === u.id);
    return `<li><span><strong>${esc(u.firstName ? `${u.firstName} ${u.lastName}` : u.name)}</strong>
      <small>📞 ${esc(u.phone)}${u.email ? ` · ✉️ ${esc(u.email)}` : ''}</small>
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
  panel.querySelector('#csv').addEventListener('click', () => {
    const header = [
      'Nombres', 'Apellidos', 'Teléfono', 'Correo', 'Dirección', 'Usuario desde',
      'Mascota', 'Tipo', 'Raza', 'Nombre del dueño (registro)', 'Estado', 'Enfermedades', 'Vacunas', 'Mascota registrada',
    ];
    const person = (u) => [u?.firstName || u?.name, u?.lastName, u?.phone, u?.email, u?.address, day(u?.createdAt)];
    const rows = pets.map((p) => [
      ...person(users.find((u) => u.id === p.ownerId)),
      p.name, SPECIES[p.species] || '', p.breed || '', p.ownerName, p.status === 'lost' ? 'Perdida' : 'En casa', p.diseases, p.vaccines, day(p.createdAt),
    ]);
    for (const u of users) if (!pets.some((p) => p.ownerId === u.id)) rows.push([...person(u), '', '', '', '', '', '', '', '']);
    download(`petsafe-datos-${day(new Date().toISOString())}.csv`, toCsv([header, ...rows]));
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

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
