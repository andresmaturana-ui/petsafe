import {
  allPets, savePet, allFound, saveFound, deleteFound, listUsers, notify, notifyAll,
  latestSuccesses, deleteSuccess, commentsFor, deleteComment, addSuccess, markRecovered,
} from '../data.js';
import { esc, timeAgo, toast, changed } from '../ui.js';

// PIN de prototipo. En producción el acceso de administrador debe
// validarse en el servidor con un rol de usuario.
const ADMIN_PIN = import.meta.env.VITE_ADMIN_PIN || '1234';

export default async function admin(el, _params, ctx) {
  if (sessionStorage.getItem('petsafe-admin') !== 'ok') return login(el, ctx);

  const tab = sessionStorage.getItem('petsafe-admin-tab') || 'alertas';
  el.innerHTML = `
    <div class="admin-head">
      <h1>Administrador</h1>
      <div class="tabs">
        ${[['alertas', '🚨 Alertas'], ['mensajes', '📢 Mensajes'], ['casos', '💛 Reencuentros']]
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
  await ({ alertas, mensajes, casos })[tab](panel, ctx);
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
          <span><strong>${esc(p.name)}</strong><small>Dueño: ${esc(userName(p.ownerId))} · ${timeAgo(p.lostAt)}</small></span>
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
            <small>${esc(f.finderName)} · ${timeAgo(f.createdAt)} · ${f.status === 'open' ? '🟠 Abierto' : '⚪ Cerrado'}</small>
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

async function mensajes(panel) {
  const users = await listUsers();
  panel.innerHTML = `
    <div class="card">
      <h2>Enviar mensaje</h2>
      <form class="form" id="msg">
        <label>Para
          <select name="to">
            <option value="*">Todos los usuarios (${users.length})</option>
            ${users.map((u) => `<option value="${u.id}">${esc(u.name)} · ${esc(u.phone)}</option>`).join('')}
          </select>
        </label>
        <label>Título<input name="title" required maxlength="80"></label>
        <label>Mensaje<textarea name="body" rows="4" required maxlength="500"></textarea></label>
        <button class="btn primary big">Enviar notificación</button>
      </form>
    </div>`;

  panel.querySelector('#msg').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const msg = { type: 'admin', title: f.get('title').trim(), body: f.get('body').trim() };
    if (f.get('to') === '*') await notifyAll(msg);
    else await notify(f.get('to'), msg);
    changed();
    e.target.reset();
    toast('Mensaje enviado ✉️', 'ok');
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
