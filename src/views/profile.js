import { saveUser, listUsers, switchUser, myPets } from '../data.js';
import { askPermission, notificationsSupported } from '../notify.js';
import { esc, toast, go } from '../ui.js';

export default async function profile(el, _params, { user, refresh }) {
  const [users, pets] = await Promise.all([listUsers(), user ? myPets(user) : []]);
  const others = users.filter((u) => u.id !== user?.id);
  const perm = notificationsSupported() ? Notification.permission : 'unsupported';

  el.innerHTML = `
    <div class="card">
      <h1>${user ? 'Tu perfil' : 'Bienvenido a Pet Safe 🐾'}</h1>
      ${user ? '' : '<p>Cuéntanos quién eres. Tu teléfono solo se comparte con el dueño de una mascota que encuentres.</p>'}
      <form class="form" id="profile">
        <label>Tu nombre<input name="name" required value="${esc(user?.name)}" autocomplete="name"></label>
        <label>Teléfono (WhatsApp)<input name="phone" type="tel" required placeholder="+56 9 1234 5678" value="${esc(user?.phone)}" autocomplete="tel"></label>
        <button class="btn primary big">${user ? 'Guardar' : 'Comenzar'}</button>
      </form>
    </div>

    ${user ? `
      <div class="card">
        <h2>Notificaciones</h2>
        <p>${perm === 'granted' ? '✅ Activadas en este celular.' : perm === 'denied' ? 'Bloqueadas. Actívalas desde la configuración del navegador.' : perm === 'unsupported' ? unsupportedHelp() : 'Actívalas para saber al instante si encuentran a tu mascota.'}</p>
        ${perm === 'default' ? '<button class="btn secondary" id="perm">Activar notificaciones</button>' : ''}
      </div>

      <div class="card">
        <h2>Mis mascotas</h2>
        ${pets.length ? `<ul class="pet-list">${pets.map((p) => `
          <li><img src="${esc(p.photo)}" alt=""><span><strong>${esc(p.name)}</strong><small>${p.status === 'lost' ? '🔴 Perdida' : '🟢 En casa'}</small></span></li>`).join('')}</ul>`
        : '<p>Aún no registras mascotas.</p>'}
        <a class="btn secondary" href="#/registrar">Registrar mascota</a>
      </div>

      ${others.length ? `
        <div class="card">
          <h2>Cambiar de usuario</h2>
          <p class="muted">Útil para probar la app con dos personas en el mismo celular.</p>
          <div class="chips">${others.map((u) => `<button class="chip" data-user="${u.id}">${esc(u.name)}</button>`).join('')}</div>
        </div>` : ''}

      <div class="card">
        <button class="btn ghost" id="newuser">Agregar otro usuario</button>
        <a class="btn ghost" href="#/admin">Administrador</a>
      </div>` : ''}`;

  el.querySelector('#profile').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    await saveUser({ id: user?.id, name: f.get('name').trim(), phone: f.get('phone').trim() });
    if (!user) await askPermission();
    toast('¡Listo!', 'ok');
    user ? refresh() : go('#/');
  });

  el.querySelector('#perm')?.addEventListener('click', async () => {
    await askPermission();
    refresh();
  });

  el.querySelectorAll('[data-user]').forEach((b) =>
    b.addEventListener('click', async () => {
      await switchUser(b.dataset.user);
      toast(`Ahora eres ${b.textContent}`);
      go('#/');
    }),
  );

  el.querySelector('#newuser')?.addEventListener('click', async () => {
    const name = prompt('Nombre del nuevo usuario');
    if (!name) return;
    const phone = prompt('Teléfono (WhatsApp)') || '';
    await saveUser({ name, phone });
    go('#/');
  });
}

// Por qué no hay notificaciones y cómo conseguirlas.
function unsupportedHelp() {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (ios && !installed) {
    return 'En iPhone las notificaciones solo funcionan con la app instalada: abre esta página en Safari, toca Compartir → "Agregar a pantalla de inicio" y entra desde el ícono de Pet Safe.';
  }
  return 'Aquí no se pueden activar. Abre la app directamente en Chrome o Safari (no dentro de otra app, como WhatsApp o Instagram) e instálala con "Agregar a pantalla de inicio".';
}
