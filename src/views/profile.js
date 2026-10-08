import { saveUser, currentUser, listUsers, switchUser, myPets, removeMyPet, createPetGift, savePet, contactAdmin, enablePush, loginEmail, createAccount, setPassword, signOut, CLOUD } from '../data.js';
import { mountEmailLogin } from './login-email.js';
import { askPermission, notificationsSupported } from '../notify.js';
import { esc, toast, go, isComplete, afterSetup } from '../ui.js';
import { comunaField, findComuna } from '../comunas.js';
import { SPECIES, breedOptions, describe } from '../breeds.js';
import { PROMOS_VERSION, SUPPORT_URL } from '../config.js';
import { promosBox, supportCard } from './privacy.js';
import { profileNearby } from '../nearby.js';

export default async function profile(el, _params, { user, refresh }) {
  // Con Supabase cada celular es un usuario; cambiar de usuario es solo para pruebas locales.
  const [users, pets, email] = await Promise.all([CLOUD ? [] : listUsers(), user ? myPets(user) : [], CLOUD ? loginEmail() : '']);
  const others = users.filter((u) => u.id !== user?.id);
  const perm = notificationsSupported() ? Notification.permission : 'unsupported';
  // Perfil ya guardado: se muestran los datos y solo se editan al tocar "Editar".
  const saved = isComplete(user);

  el.innerHTML = `
    ${saved ? '' : '<a class="card finder-link" href="#/veterinarios">🔎 <span><b>¿Buscas veterinario?</b> Ve las clínicas Kiltrazo y pide hora sin crear cuenta.</span></a>'}
    ${CLOUD && !user && email ? `
      <div class="card"><p>Entraste como <b>${esc(email)}</b>. Esta cuenta todavía no tiene tus datos en la app: complétalos aquí abajo.</p></div>` : ''}
    ${CLOUD && !user && !email ? `
      <div class="card">
        <h2>¿Ya tienes cuenta?</h2>
        <details><summary class="btn ghost">Entrar con mi correo y clave</summary><div id="email-login"></div></details>
      </div>` : ''}
    <div class="card">
      ${user ? '<h1>Tu perfil</h1>' : '<img src="brand/kiltrazo-completo.svg" alt="Kiltrazo" class="welcome-logo"><h1>¡Bienvenido! 🐾</h1>'}
      ${!user ? '<p>Cuéntanos quién eres.</p>' : saved ? '' : '<p class="note">Completa tus datos para seguir usando Kiltrazo.</p>'}
      ${saved ? `
        <dl class="info" id="profile-view">
          <dt>Nombre</dt><dd>${esc(`${user.firstName || user.name} ${user.lastName || ''}`.trim())}</dd>
          <dt>Teléfono (WhatsApp)</dt><dd>${esc(user.phone)}</dd>
          <dt>Correo</dt><dd>${esc(user.email)}</dd>
          <dt>Dirección</dt><dd>${esc(user.address)}</dd>
          <dt>Comuna</dt><dd>${user.comuna ? esc(user.comuna) : 'Sin elegir. Elígela para recibir los operativos de tu municipalidad.'}</dd>
        </dl>
        <button class="btn secondary" id="edit-profile">✏️ Editar mis datos</button>` : ''}
      <form class="form" id="profile" ${saved ? 'hidden' : ''}>
        <label>Nombres<input name="firstName" required value="${esc(user?.firstName || user?.name)}" autocomplete="given-name"></label>
        <label>Apellidos<input name="lastName" required value="${esc(user?.lastName)}" autocomplete="family-name"></label>
        <label>Teléfono (WhatsApp)<input name="phone" type="tel" required placeholder="+56 9 1234 5678" value="${esc(user?.phone)}" autocomplete="tel"></label>
        <label>Correo<input name="email" type="email" required value="${esc(user?.email || email)}" autocomplete="email"></label>
        <label>Dirección<input name="address" required placeholder="Calle, número, comuna" value="${esc(user?.address)}" autocomplete="street-address"></label>
        <label>Comuna${comunaField(user?.comuna)}</label>
        <p class="muted small">Con tu comuna te avisamos de los operativos de tu municipalidad: vacunación, esterilización, microchip.</p>
        ${CLOUD && !user ? `
          <label>Crea una clave<input name="password" type="password" required minlength="6" autocomplete="new-password"></label>
          <p class="muted small">Con tu correo y esta clave entras desde cualquier celular o computador.</p>` : ''}
        <p class="muted small">Tu nombre y teléfono solo se comparten con el dueño de una mascota que encuentres. El correo y la dirección solo los ve el administrador de Kiltrazo. <a href="#/privacidad">Política de privacidad</a></p>
        ${saved ? '' : promosBox(user?.promos)}
        <button class="btn primary big">${user ? 'Guardar' : 'Comenzar'}</button>
        ${saved ? '<button type="button" class="btn ghost" id="cancel-profile">Cancelar</button>' : ''}
      </form>
    </div>

    ${saved ? `
      <div class="card">
        <h2>Ofertas y novedades</h2>
        <p>${user.promos
          ? `✅ Recibes ofertas útiles para tu mascota${user.promosAt ? ` (aceptaste el ${new Date(user.promosAt).toLocaleDateString('es-CL')})` : ''}. Kiltrazo nunca entrega tus datos a las empresas.`
          : 'No recibes ofertas. Si quieres, Kiltrazo te puede avisar de descuentos de veterinarias y tiendas de tu comuna, sin entregarles tus datos.'}</p>
        <button class="btn ${user.promos ? 'ghost' : 'secondary'}" id="promos-toggle">${user.promos ? 'Darme de baja' : 'Quiero recibir ofertas'}</button>
        <p class="muted small"><a href="#/privacidad">Política de privacidad</a></p>
      </div>` : ''}

    ${user && SUPPORT_URL ? supportCard() : ''}

    ${user ? `
      <div class="card">
        <h2>Notificaciones</h2>
        <p>${perm === 'granted' ? '✅ Activadas en este celular.' : perm === 'denied' ? deniedHelp() : perm === 'unsupported' ? unsupportedHelp() : 'Actívalas para saber al instante si encuentran a tu mascota.'}</p>
        ${perm === 'default' ? '<button class="btn secondary" id="perm">Activar notificaciones</button>' : ''}
      </div>

      <div id="nearby"></div>

      <div class="card">
        <h2>Mis mascotas</h2>
        ${pets.length ? `<ul class="pet-list my-pets">${pets.map((p) => `
          <li data-pet="${esc(p.id)}">
            <div class="pet-row">
              <img src="${esc(p.photo)}" alt="">
              <span><strong>${esc(p.name)}</strong><small>${[describe(p), p.status === 'lost' ? '🔴 Perdida' : '🟢 En casa'].filter(Boolean).map(esc).join(' · ')}</small></span>
              <button class="btn small secondary" data-editpet aria-label="Editar ${esc(p.name)}">Editar</button>
            </div>
            <button class="link small pet-vet-btn" data-vet>🩺 Mi veterinaria: vacunas y horas</button>
            <div class="pet-vet" hidden></div>
            <form class="form pet-edit" hidden>
              <label>Nombre<input name="name" required value="${esc(p.name)}"></label>
              <label>Tipo<select name="species">
                <option value="">No sé</option>
                ${Object.entries(SPECIES).map(([v, t]) => `<option value="${v}" ${p.species === v ? 'selected' : ''}>${t}</option>`).join('')}
              </select></label>
              <label>Raza<input name="breed" list="breeds-${esc(p.id)}" value="${esc(p.breed)}" autocomplete="off"></label>
              <datalist id="breeds-${esc(p.id)}">${breedOptions(p.species)}</datalist>
              <label>Enfermedades<textarea name="diseases" rows="2">${esc(p.diseases)}</textarea></label>
              <label>Vacunas<textarea name="vaccines" rows="2">${esc(p.vaccines)}</textarea></label>
              <button class="btn primary">Guardar cambios</button>
              <button type="button" class="btn ghost" data-cancel>Cancelar</button>
            </form>
            <div class="pet-bye" hidden>
              <p class="small muted">¿${esc(p.name)} ya no está contigo?</p>
              <span class="row-actions">
                <button type="button" class="btn small ghost" data-gift>🎁 Se la di a otra persona</button>
                <button type="button" class="link small danger" data-delpet>Eliminar a ${esc(p.name)}</button>
              </span>
              <div class="gift-out" hidden></div>
              <form class="form del-box" hidden>
                <p><b>¿Eliminar a ${esc(p.name)} para siempre?</b> Se borran sus datos, fotos y su cara registrada, y no se puede deshacer.</p>
                <p class="small">Si se la diste a alguien, mejor usa "Se la di a otra persona": así quedará a su nombre y la podremos encontrar si se pierde.</p>
                <label>Para confirmar, escribe su nombre<input name="confirm" autocomplete="off" placeholder="${esc(p.name)}"></label>
                <span class="row-actions">
                  <button type="button" class="btn small ghost" data-delno>Cancelar</button>
                  <button class="btn small danger" disabled>Eliminar para siempre</button>
                </span>
              </form>
            </div>
          </li>`).join('')}</ul>`
        : '<p>Aún no registras mascotas.</p>'}
        <a class="btn secondary" href="#/registrar">Registrar mascota</a>
      </div>

      <div id="point-card" hidden></div>

      ${others.length ? `
        <div class="card">
          <h2>Cambiar de usuario</h2>
          <p class="muted">Útil para probar la app con dos personas en el mismo celular.</p>
          <div class="chips">${others.map((u) => `<button class="chip" data-user="${u.id}">${esc(u.name)}</button>`).join('')}</div>
        </div>` : ''}

      <div class="card">
        <h2>Ayuda</h2>
        <p>En el manual está todo paso a paso: registrar a tu mascota, qué hacer si se pierde, pedir hora y más.</p>
        <a class="btn secondary" href="manuales/Manual-app-Kiltrazo.pdf" target="_blank" rel="noopener" download>📘 Descargar el manual</a>
        <h3>¿Tienes otra duda?</h3>
        <p>Escríbele al administrador de Kiltrazo. Te responderá en Avisos 🔔.</p>
        <form class="form" id="contact">
          <label>Tu mensaje<textarea name="body" rows="3" required maxlength="1000"></textarea></label>
          <button class="btn secondary">Enviar al administrador</button>
        </form>
      </div>

      ${CLOUD ? `
        <div class="card">
          <h2>Tu cuenta</h2>
          ${email
            ? `<p>✅ Entraste con <strong>${esc(email)}</strong>. En otro celular o computador, entra con tu correo y clave y verás tus datos y mascotas.</p>
               <details><summary class="btn ghost">Cambiar mi clave</summary>
                 <form class="form" id="new-pass">
                   <label>Clave nueva<input name="password" type="password" required minlength="6" autocomplete="new-password"></label>
                   <button class="btn primary">Guardar clave</button>
                 </form>
               </details>
               <button class="btn ghost" id="logout">Cerrar sesión</button>`
            : `<p>Crea una clave para entrar a tu cuenta desde otro celular o computador. Tus datos y mascotas se mantienen.</p>
               <form class="form" id="make-account">
                 <label>Correo<input name="email" type="email" required value="${esc(user.email)}" autocomplete="email"></label>
                 <label>Clave<input name="password" type="password" required minlength="6" autocomplete="new-password"></label>
                 <button class="btn primary">Crear mi clave</button>
               </form>
               <details><summary class="btn ghost">Ya tengo cuenta: entrar</summary><div id="email-login"></div></details>`}
        </div>` : ''}

      <div class="card">
        ${CLOUD ? '' : '<button class="btn ghost" id="newuser">Agregar otro usuario</button>'}
        <a class="btn ghost" href="#/admin">Administrador</a>
      </div>` : ''}`;

  // Punto Kiltrazo: a quien el administrador le dio permiso, un acceso directo.
  const pointBox = el.querySelector('#point-card');
  if (pointBox) {
    import('../clinic/data.js').then(({ myClinics }) => myClinics(user.id)).then((cs) => {
      if (!cs.some((c) => c.kind === 'kiltrazo' && c.role === 'punto')) return;
      pointBox.outerHTML = `<div class="card">
        <h2>📷 Punto de reconocimiento facial</h2>
        <p>Kiltrazo te dio permiso para registrar mascotas y entregárselas a sus dueños con un QR.</p>
        <a class="btn primary" href="#/punto">Abrir punto</a>
      </div>`;
    }).catch((err) => console.warn('Punto', err));
  }

  const nearbyBox = el.querySelector('#nearby');
  if (nearbyBox) profileNearby(nearbyBox, user, refresh).catch((err) => console.warn('Avisos cerca', err));

  const loginBox = el.querySelector('#email-login');
  if (loginBox) mountEmailLogin(loginBox, {
    // Una cuenta creada en Clínica o Municipal puede no tener perfil en la app:
    // entonces se completa aquí, en vez de volver a la portada.
    onDone: async () => (isComplete(await currentUser()) ? go(afterSetup()) : refresh()),
  });

  el.querySelector('#profile').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const data = Object.fromEntries(['firstName', 'lastName', 'phone', 'email', 'address'].map((k) => [k, f.get(k).trim()]));
    data.email = data.email.toLowerCase();
    data.comuna = findComuna(f.get('comuna'));
    if (!data.comuna) return toast('Elige tu comuna de la lista', 'bad');
    // La casilla de ofertas solo aparece al crear el perfil; nunca viene marcada.
    if (e.target.promos) Object.assign(data, { promos: e.target.promos.checked, promosVersion: PROMOS_VERSION });
    if (f.get('password') && !(await makeAccount(data.email, f.get('password'), e.target))) return;
    try {
      await saveUser({ id: user?.id, ...data, name: `${data.firstName} ${data.lastName}` });
    } catch (err) {
      return toast(`No se pudo guardar: ${err.message}`, 'bad');
    }
    if (!user && (await askPermission()) === 'granted') await enablePush().catch(() => {});
    toast('¡Listo!', 'ok');
    isComplete(user) ? refresh() : go(afterSetup());
  });

  el.querySelector('#make-account')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    if (await makeAccount(f.get('email').trim().toLowerCase(), f.get('password'), e.target)) refresh();
  });

  el.querySelector('#new-pass')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await setPassword(new FormData(e.target).get('password'));
      toast('Clave guardada', 'ok');
      refresh();
    } catch (err) {
      toast(err.message, 'bad');
    }
  });

  el.querySelector('#logout')?.addEventListener('click', async () => {
    if (!confirm('¿Cerrar sesión en este dispositivo? Para volver, entra con tu correo y clave.')) return;
    await signOut();
    go('#/perfil');
    refresh();
  });

  const profileForm = el.querySelector('#profile');
  el.querySelector('#edit-profile')?.addEventListener('click', (e) => {
    profileForm.hidden = false;
    el.querySelector('#profile-view').hidden = true;
    e.target.hidden = true;
    profileForm.querySelector('input').focus();
  });
  el.querySelector('#cancel-profile')?.addEventListener('click', () => refresh());

  el.querySelector('#promos-toggle')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await saveUser({ ...user, promos: !user.promos, promosVersion: PROMOS_VERSION });
      toast(user.promos ? 'Listo, ya no recibirás ofertas.' : '¡Listo! Te avisaremos de ofertas útiles.', 'ok');
      refresh();
    } catch (err) {
      toast(`No se pudo guardar: ${err.message}`, 'bad');
      e.target.disabled = false;
    }
  });

  el.querySelectorAll('.my-pets li').forEach((li) => {
    const pet = pets.find((p) => p.id === li.dataset.pet);
    const form = li.querySelector('.pet-edit');
    const bye = li.querySelector('.pet-bye');
    const toggle = (open) => {
      form.hidden = !open;
      bye.hidden = !open;
      li.querySelector('[data-editpet]').hidden = open;
    };
    // Pasársela a otra persona: enlace de un uso por WhatsApp o QR.
    li.querySelector('[data-gift]').addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        const code = await createPetGift(pet.id);
        const url = `${location.origin}${location.pathname}#/regalo/${code}`;
        const msg = `Hola, te paso a ${pet.name} en Kiltrazo para que quede a tu nombre (con su cara ya registrada, por si algún día se pierde): ${url}`;
        const QR = (await import('qrcode')).default;
        const out = li.querySelector('.gift-out');
        out.hidden = false;
        out.innerHTML = `
          <p class="small">Envíale este enlace a la persona que tiene a ${esc(pet.name)}, o que escanee el QR con su celular. Al recibirla, ${esc(pet.name)} sale de tu cuenta y pasa a la suya. Sirve una vez y dura 7 días.</p>
          <img class="gift-qr" alt="QR para recibir a ${esc(pet.name)}" src="${await QR.toDataURL(url, { margin: 1, width: 400, color: { dark: '#4a3428' } })}">
          <span class="row-actions">
            <a class="btn small whatsapp" href="https://wa.me/?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">Enviar por WhatsApp</a>
            <button type="button" class="btn small ghost" data-copy>Copiar enlace</button>
          </span>`;
        out.querySelector('[data-copy]').addEventListener('click', () => navigator.clipboard?.writeText(url).then(() => toast('Enlace copiado', 'ok')));
        e.target.hidden = true;
      } catch (err) {
        toast(err.message, 'bad');
        e.target.disabled = false;
      }
    });
    // Eliminar: se confirma escribiendo su nombre.
    const del = li.querySelector('.del-box');
    li.querySelector('[data-delpet]').addEventListener('click', () => { del.hidden = false; del.confirm.focus(); });
    del.querySelector('[data-delno]').addEventListener('click', () => { del.reset(); del.hidden = true; });
    const same = () => del.confirm.value.trim().toLowerCase() === pet.name.trim().toLowerCase();
    del.confirm.addEventListener('input', () => { del.querySelector('.btn.danger').disabled = !same(); });
    del.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!same()) return;
      await removeMyPet(user, pet.id);
      toast(`${pet.name} fue eliminada`);
      refresh();
    });
    li.querySelector('[data-editpet]').addEventListener('click', () => toggle(true));
    // Kiltrazo Clínica: código para la veterinaria y carnet de vacunas (se carga al abrir).
    li.querySelector('[data-vet]').addEventListener('click', async () => {
      const box = li.querySelector('.pet-vet');
      box.hidden = !box.hidden;
      if (!box.hidden && !box.dataset.ready) {
        box.dataset.ready = '1';
        const { mountPetVet } = await import('./pet-vet.js');
        mountPetVet(box, pet);
      }
    });
    form.querySelector('[data-cancel]').addEventListener('click', () => { form.reset(); toggle(false); });
    form.species.addEventListener('change', () => {
      li.querySelector('datalist').innerHTML = breedOptions(form.species.value);
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const btn = form.querySelector('button');
      btn.disabled = true;
      try {
        await savePet({
          ...pet,
          name: f.get('name').trim(),
          species: f.get('species'),
          breed: f.get('breed').trim(),
          diseases: f.get('diseases').trim(),
          vaccines: f.get('vaccines').trim(),
        });
        toast('Cambios guardados', 'ok');
        refresh();
      } catch (err) {
        toast(`No se pudo guardar: ${err.message}`);
        btn.disabled = false;
      }
    });
  });

  el.querySelector('#contact')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = new FormData(e.target).get('body').trim();
    if (!body) return;
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      await contactAdmin(user, body);
      e.target.reset();
      toast('Mensaje enviado. Te responderán en Avisos.', 'ok');
    } finally {
      btn.disabled = false;
    }
  });

  el.querySelector('#perm')?.addEventListener('click', async () => {
    if ((await askPermission()) === 'granted') await enablePush().catch(() => {});
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

// Crea la cuenta con correo y clave. Devuelve true si quedó lista para usarse.
async function makeAccount(email, password, form) {
  const btn = form.querySelector('button');
  btn.disabled = true;
  try {
    if (!(await createAccount(email, password))) {
      alert(`Te enviamos un correo a ${email}. Ábrelo y toca el enlace para confirmarlo; después podrás entrar con tu clave en cualquier dispositivo.`);
    }
    return true;
  } catch (err) {
    toast(err.message, 'bad');
    return false;
  } finally {
    btn.disabled = false;
  }
}

// Por qué no hay notificaciones y cómo conseguirlas.
// En iPhone, Safari responde "bloqueadas" aunque el problema es que la app no
// está instalada: ahí solo funcionan desde el ícono de la pantalla de inicio.
function deniedHelp() {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (ios && !installed) return unsupportedHelp();
  if (ios) return 'Bloqueadas. Actívalas en Ajustes del iPhone → Notificaciones → Kiltrazo → Permitir notificaciones.';
  return 'Bloqueadas. Actívalas desde la configuración del navegador (el candado junto a la dirección → Notificaciones → Permitir).';
}

function unsupportedHelp() {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (ios && !installed) {
    return 'En iPhone las notificaciones solo funcionan con la app instalada: abre esta página en Safari, toca Compartir → "Agregar a pantalla de inicio" y entra desde el ícono de Kiltrazo.';
  }
  return 'Aquí no se pueden activar. Abre la app directamente en Chrome o Safari (no dentro de otra app, como WhatsApp o Instagram) e instálala con "Agregar a pantalla de inicio".';
}
