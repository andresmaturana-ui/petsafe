import { saveUser, listUsers, switchUser, myPets, removeMyPet, CLOUD } from '../data.js';
import { askPermission, notificationsSupported } from '../notify.js';
import { esc, toast, go, isComplete } from '../ui.js';

export default async function profile(el, _params, { user, refresh }) {
  // Con Supabase cada celular es un usuario; cambiar de usuario es solo para pruebas locales.
  const [users, pets] = await Promise.all([CLOUD ? [] : listUsers(), user ? myPets(user) : []]);
  const others = users.filter((u) => u.id !== user?.id);
  const perm = notificationsSupported() ? Notification.permission : 'unsupported';

  el.innerHTML = `
    <div class="card">
      <h1>${user ? 'Tu perfil' : 'Bienvenido a Pet Safe 🐾'}</h1>
      ${!user ? '<p>Cuéntanos quién eres.</p>' : isComplete(user) ? '' : '<p class="note">Completa tus datos para seguir usando Pet Safe.</p>'}
      <form class="form" id="profile">
        <label>Nombres<input name="firstName" required value="${esc(user?.firstName || user?.name)}" autocomplete="given-name"></label>
        <label>Apellidos<input name="lastName" required value="${esc(user?.lastName)}" autocomplete="family-name"></label>
        <label>Teléfono (WhatsApp)<input name="phone" type="tel" required placeholder="+56 9 1234 5678" value="${esc(user?.phone)}" autocomplete="tel"></label>
        <label>Correo<input name="email" type="email" required value="${esc(user?.email)}" autocomplete="email"></label>
        <label>Dirección<input name="address" required placeholder="Calle, número, comuna" value="${esc(user?.address)}" autocomplete="street-address"></label>
        <p class="muted small">Tu nombre y teléfono solo se comparten con el dueño de una mascota que encuentres. El correo y la dirección solo los ve el administrador de Pet Safe.</p>
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
          <li><img src="${esc(p.photo)}" alt=""><span><strong>${esc(p.name)}</strong><small>${p.status === 'lost' ? '🔴 Perdida' : '🟢 En casa'}</small></span>
          <button class="btn small danger" data-delpet="${p.id}" aria-label="Eliminar ${esc(p.name)}">Eliminar</button></li>`).join('')}</ul>`
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
        ${CLOUD ? '' : '<button class="btn ghost" id="newuser">Agregar otro usuario</button>'}
        <a class="btn ghost" href="#/admin">Administrador</a>
      </div>` : ''}`;

  el.querySelector('#profile').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const data = Object.fromEntries(['firstName', 'lastName', 'phone', 'email', 'address'].map((k) => [k, f.get(k).trim()]));
    await saveUser({ id: user?.id, ...data, name: `${data.firstName} ${data.lastName}` });
    if (!user) await askPermission();
    toast('¡Listo!', 'ok');
    isComplete(user) ? refresh() : go('#/');
  });

  el.querySelectorAll('[data-delpet]').forEach((b) =>
    b.addEventListener('click', async () => {
      const pet = pets.find((p) => p.id === b.dataset.delpet);
      if (!confirm(`¿Eliminar a ${pet.name}? Se borrarán sus datos y su biometría, y no se podrá deshacer.`)) return;
      await removeMyPet(user, pet.id);
      toast(`${pet.name} fue eliminada`);
      refresh();
    }),
  );

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
