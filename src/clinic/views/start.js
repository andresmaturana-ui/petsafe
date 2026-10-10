// Entrada a Kiltrazo Clínica: entrar con correo, y crear la clínica o unirse
// a una con el código que da quien la administra.

import { createAccount } from '../../data.js';
import { mountEmailLogin } from '../../views/login-email.js';
import { esc, toast, getLocation } from '../../ui.js';
import { createClinic, joinClinic, saveClinic, saveSpecialties, setActiveClinic, createMunicipality, saveMuni, myClinics, isMuni } from '../data.js';
import { muniIntro, muniCreateCard, bindMuniForm } from '../muni.js';
import { specPick, readSpecs } from '../specialties.js';
import { logoField, bindLogo } from '../logo.js';
import { reviewFields, bindReview } from '../review.js';
import { track } from '../../analytics.js';

export default function start(el, { session, refresh, pendingCode, muni = false }) {
  const intro = muni ? muniIntro(pendingCode) : `
    <div class="ck-start-head">
      <img src="brand/kiltrazo.svg" alt="Kiltrazo" class="ck-logo big">
      <h1><b>Clínica</b></h1>
      <p>Ficha clínica, vacunas, exámenes y agenda de tu veterinaria. Funciona en el computador y en el celular, y es gratis.</p>
      ${pendingCode ? `<p class="note">Después de entrar se vinculará la mascota con el código <strong>${esc(pendingCode)}</strong>.</p>` : ''}
      <p class="small"><a href="#/municipio">¿Trabajas en una municipalidad? Entra a Kiltrazo Municipal</a></p>
    </div>`;

  if (session.needsProfile) {
    el.innerHTML = `<div class="ck-start">${intro}<div class="card"><p>Primero crea tu perfil en Kiltrazo.</p><a class="btn primary" href="#/perfil">Crear mi perfil</a></div></div>`;
    return;
  }

  if (session.needsLogin) {
    el.innerHTML = `
      <div class="ck-start">${intro}
        <div class="ck-start-cols">
          <div class="card"><h2>Ya tengo cuenta</h2><div id="ck-login"></div></div>
          <div class="card">
            <h2>Soy nuevo</h2>
            <p class="muted small">Con este correo y clave entras desde cualquier computador o celular de la ${muni ? 'municipalidad' : 'clínica'}.</p>
            <form class="form" id="ck-signup">
              <label>Correo<input name="email" type="email" required autocomplete="email"></label>
              <label>Crea una clave<input name="password" type="password" required minlength="6" autocomplete="new-password"></label>
              <button class="btn primary">Crear cuenta</button>
            </form>
          </div>
        </div>
      </div>`;
    mountEmailLogin(el.querySelector('#ck-login'), { after: location.hash, onDone: refresh });
    el.querySelector('#ck-signup').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const btn = e.target.querySelector('button');
      btn.disabled = true;
      try {
        if (await createAccount(String(f.get('email')).trim().toLowerCase(), f.get('password'))) refresh();
        else alert('Te enviamos un correo para confirmarlo. Ábrelo y después entra con tu clave.');
      } catch (err) {
        toast(err.message, 'bad');
      } finally {
        btn.disabled = false;
      }
    });
    return;
  }

  const joinCard = `
        <div class="card">
          <h2>Me invitaron</h2>
          <p class="muted small">Pide el código a quien administra la ${muni ? 'municipalidad' : 'clínica'} (en Equipo).</p>
          <form class="form" id="ck-join">
            <label>Código<input name="code" required maxlength="6" autocapitalize="characters" class="ck-code-input" placeholder="ABC234"></label>
            <label>Tu nombre<input name="memberName" required></label>
            <button class="btn secondary">Unirme</button>
          </form>
        </div>`;

  const submit = (sel, fn) => el.querySelector(sel).addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    const btn = e.target.querySelector('button:not([type="button"])');
    btn.disabled = true;
    try {
      const id = await fn(data);
      setActiveClinic(id);
      toast('¡Listo!', 'ok');
      // Se abre lo que se creó o a lo que se unió: clínica o municipalidad.
      const joined = (await myClinics(session.user.id)).find((c) => c.id === id);
      const next = isMuni(joined) ? '#/municipio' : '#/clinica';
      if (location.hash === next) refresh();
      else location.hash = next;
    } catch (err) {
      toast(err.message, 'bad');
      btn.disabled = false;
    }
  });

  if (muni) {
    el.innerHTML = `<div class="ck-start">${intro}<div class="ck-start-cols">${muniCreateCard()}${joinCard}</div></div>`;
    const read = bindMuniForm(el.querySelector('#ck-create-muni'));
    submit('#ck-create-muni', async () => {
      const m = read();
      const id = await createMunicipality(m);
      track('crear_municipalidad');
      if (m.logo || m.areaKm !== 5) await saveMuni({ id, ...m });
      return id;
    });
    submit('#ck-join', (d) => joinClinic(d.code.trim().toUpperCase(), d.memberName.trim()));
    return;
  }

  el.innerHTML = `
    <div class="ck-start">${intro}
      <div class="ck-start-cols">
        <div class="card">
          <h2>Crear mi clínica</h2>
          <form class="form" id="ck-create">
            ${kindPick()}
            <label><span data-k="clinica">Nombre de la clínica</span><span data-k="domicilio" hidden>Nombre que verán los tutores</span>
              <input name="name" required maxlength="120" placeholder="Clínica Veterinaria Los Aromos"></label>
            <label><span data-k="clinica">Dirección</span><span data-k="domicilio" hidden>Comuna o zona donde atiendes</span>
              <input name="address" placeholder="Calle, número, comuna"></label>
            <label>Teléfono<input name="phone" type="tel" placeholder="+56 2 2345 6789"></label>
            ${logoField()}
            <label>Tu nombre<input name="memberName" required placeholder="Dra. Camila Rojas"></label>
            <label data-k="clinica">Tu rol<select name="role"><option value="vet">Veterinario/a</option><option value="recepcion">Recepción</option></select></label>
            <div data-spec-wrap>${specPick([], 'Tus especialidades')}<p class="small muted">Los tutores podrán buscarte por ellas. Las de tu equipo se agregan después en Equipo.</p></div>
            <label class="ck-check"><input type="checkbox" name="onMap" checked> Aparecer en “Clínicas cercanas” de la app, para que los tutores te encuentren</label>
            <div class="ck-map-pick" id="ck-map-pick">
              <p class="small muted"><span data-k="clinica">Marca la clínica en el mapa (toca o arrastra la huella). Si no hay calles claras, usa la vista Satélite.</span><span data-k="domicilio" hidden>Marca el centro de la zona donde atiendes. En la app se verá un punto aproximado, nunca tu dirección.</span> Aparecerá cuando Kiltrazo lo apruebe.</p>
              <div class="ck-map" id="ck-map"></div>
              <button type="button" class="link small" id="ck-here">📍 <span data-k="clinica">Estoy en la clínica: usar</span><span data-k="domicilio" hidden>Usar</span> mi ubicación</button>
              <label class="ck-coords small">¿Tienes la ubicación en Google Maps? Pega aquí el enlace o las coordenadas<input id="ck-coords" placeholder="-36.6061, -72.1034"></label>
            </div>
            <label class="ck-check" data-k="clinica"><input type="checkbox" name="emergencies"> Atendemos urgencias</label>
            ${reviewFields()}
            <button class="btn primary">Crear clínica</button>
          </form>
        </div>
        ${joinCard}
      </div>
    </div>`;

  bindKind(el.querySelector('#ck-create'));
  const create = el.querySelector('#ck-create');
  const specWrap = create.querySelector('[data-spec-wrap]');
  const showSpecs = () => { specWrap.hidden = create.kind?.value !== 'domicilio' && create.role.value !== 'vet'; };
  create.addEventListener('change', showSpecs);
  showSpecs();
  const logo = bindLogo(el.querySelector('#ck-create'));
  const review = bindReview(create);
  // Ubicación para aparecer en "Clínicas cercanas": se pregunta al crearla.
  let point = null;
  const pick = el.querySelector('#ck-map-pick');
  const onMap = el.querySelector('[name="onMap"]');
  import('../../map.js').then(({ pickPoint, bindPlaceSearch }) => {
    const picker = pickPoint(el.querySelector('#ck-map'), null, (p) => { point = p; });
    onMap.addEventListener('change', () => {
      pick.hidden = !onMap.checked;
      if (onMap.checked) picker.map.invalidateSize();
    });
    bindPlaceSearch(picker, { input: create.address, hereBtn: el.querySelector('#ck-here'), coordsInput: el.querySelector('#ck-coords'), getLocation, say: toast });
  });

  submit('#ck-create', async (d) => {
    if (d.onMap && !point) throw new Error('Marca la clínica en el mapa, o quita la opción de aparecer en Clínicas cercanas.');
    review.check();
    const onlyHome = d.kind === 'domicilio';
    const c = { name: d.name.trim(), address: d.address, phone: d.phone };
    const id = await createClinic({ ...c, memberName: d.memberName.trim(), role: onlyHome ? 'vet' : d.role });
    track('crear_clinica', { tipo: onlyHome ? 'domicilio' : 'clinica' });
    if (d.onMap || d.emergencies || onlyHome || logo()) {
      await saveClinic({
        id, ...c, onlyHome, logo: logo() || undefined, homeVisits: onlyHome, onMap: Boolean(d.onMap), emergencies: !onlyHome && Boolean(d.emergencies),
        lat: point?.lat ?? null, lng: point?.lng ?? null,
      });
    }
    const specs = specWrap.hidden ? [] : readSpecs(create);
    if (specs.length) await saveSpecialties(id, null, specs);
    // La clínica ya existe: si falla la subida, se completa después desde el aviso de revisión.
    await review.save(id).catch((err) => {
      console.warn('Revisión', err);
      toast('La clínica quedó creada, pero no pudimos subir el título. Súbelo desde el aviso “en revisión”.', 'bad');
    });
    return id;
  });
  submit('#ck-join', (d) => joinClinic(d.code.trim().toUpperCase(), d.memberName.trim()));
}

// ¿Clínica con local o veterinario independiente que solo va a domicilio?
// Lo que no aplica se esconde con data-k.
export function kindPick(onlyHome = false) {
  return `
    <fieldset class="ck-kind">
      <legend>¿Cómo atiendes?</legend>
      <label><input type="radio" name="kind" value="clinica" ${onlyHome ? '' : 'checked'}><span>🏥 Tengo clínica o consulta</span></label>
      <label><input type="radio" name="kind" value="domicilio" ${onlyHome ? 'checked' : ''}><span>🏠 Soy independiente, solo a domicilio</span></label>
    </fieldset>`;
}

export function bindKind(form) {
  const sync = () => {
    const k = form.kind.value;
    form.querySelectorAll('[data-k]').forEach((x) => { x.hidden = x.dataset.k !== k; });
    const addr = form.address;
    addr.placeholder = k === 'domicilio' ? 'Ej.: Ñuñoa, Providencia y La Reina' : 'Calle, número, comuna';
    if (form.name.placeholder) form.name.placeholder = k === 'domicilio' ? 'Dra. Camila Rojas, veterinaria a domicilio' : 'Clínica Veterinaria Los Aromos';
  };
  form.querySelectorAll('[name="kind"]').forEach((r) => r.addEventListener('change', sync));
  sync();
}
