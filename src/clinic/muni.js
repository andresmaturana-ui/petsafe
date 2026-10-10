// Kiltrazo Municipal: lo propio de una municipalidad dentro de Kiltrazo Clínica.
// Crear la municipalidad y editar sus datos (comuna, centro y radio del
// tablero de perdidos y encontrados).

import { esc, toast, getLocation } from '../ui.js';
import { logoField, bindLogo } from './logo.js';
import { comunaField, findComuna } from '../comunas.js';

export const muniIntro = (pendingCode = '') => `
  <div class="ck-start-head">
    <img src="brand/kiltrazo.svg" alt="Kiltrazo" class="ck-logo big">
    <h1><b>Municipal</b></h1>
    <p>Fichas de los animales de tu comuna, operativos con cupos que los vecinos reservan desde el celular, y los perdidos y encontrados de la comuna en un solo lugar. Es gratis.</p>
    <p class="small muted">Complementa al Registro Nacional de Mascotas: la inscripción nacional se sigue haciendo en registratumascota.cl.</p>
    ${pendingCode ? `<p class="note">Después de entrar se vinculará la mascota con el código <strong>${esc(pendingCode)}</strong>.</p>` : ''}
  </div>`;

const AREAS = [2, 3, 5, 8, 10, 15, 20];

// Campos comunes: crear y editar.
const fields = (c = {}) => `
  <label>Nombre<input name="name" required maxlength="120" value="${esc(c.name || '')}" placeholder="Municipalidad de Ñuñoa"></label>
  <label>Comuna${comunaField(c.comuna, { id: 'ck-comunas' })}</label>
  <p class="small muted">Tus operativos se avisan a los tutores de Kiltrazo que tienen esta comuna en su perfil.</p>
  <label>Dirección de la oficina<input name="address" value="${esc(c.address || '')}" placeholder="Calle, número"></label>
  <label>Teléfono<input name="phone" type="tel" value="${esc(c.phone || '')}" placeholder="+56 2 2345 6789"></label>
  ${logoField(c.logo, 'Municipal')}`;

const mapField = (c = {}) => `
  <div class="ck-map-pick">
    <p class="small muted">Marca el centro de la comuna (toca o arrastra la huella). Lo usamos para mostrarte los animales perdidos y encontrados cerca.</p>
    <div class="ck-map" id="ck-map"></div>
    <button type="button" class="link small" id="ck-here">📍 Usar mi ubicación</button>
  </div>
  <label>Mostrar perdidos y encontrados a menos de<select name="areaKm">
    ${AREAS.map((n) => `<option value="${n}" ${Number(c.areaKm ?? 5) === n ? 'selected' : ''}>${n} km del centro</option>`).join('')}
  </select></label>`;

export const muniCreateCard = () => `
  <div class="card">
    <h2>Crear mi municipalidad</h2>
    <form class="form" id="ck-create-muni">
      ${fields()}
      <label>Tu nombre<input name="memberName" required placeholder="Paula Soto"></label>
      <label>Tu rol<select name="role"><option value="vet">Veterinario/a</option><option value="recepcion">Funcionario/a</option></select></label>
      ${mapField()}
      <p class="small muted">Kiltrazo revisa cada municipalidad antes de activarla. Mientras tanto ya puedes crear fichas y preparar operativos.</p>
      <button class="btn primary">Crear municipalidad</button>
    </form>
  </div>`;

export const muniDataForm = (c) => `
  <form class="card form" id="ck-muni">
    <h2>Datos de la municipalidad</h2>
    ${fields(c)}
    ${mapField(c)}
    <button class="btn primary small">Guardar</button>
  </form>`;

/** Mapa, logo y lectura del formulario. Devuelve read() → datos o error. */
export function bindMuniForm(form, c = {}) {
  let point = c.lat != null && c.lng != null ? { lat: c.lat, lng: c.lng } : null;
  const logo = bindLogo(form);
  import('../map.js').then(({ pickPoint, bindPlaceSearch }) => {
    const picker = pickPoint(form.querySelector('#ck-map'), point, (p) => { point = p; });
    const query = () => [form.address.value, form.comuna.value].filter((x) => x.trim()).join(', ');
    bindPlaceSearch(picker, { input: form.address, query, hereBtn: form.querySelector('#ck-here'), getLocation, say: toast });
    form.comuna.addEventListener('change', () => form.address.dispatchEvent(new Event('change')));
  });
  return () => {
    const f = Object.fromEntries(new FormData(form));
    const comuna = findComuna(f.comuna);
    if (!comuna) throw new Error('Elige la comuna de la lista');
    if (!point) throw new Error('Marca el centro de la comuna en el mapa');
    return {
      name: f.name.trim(), comuna, address: f.address.trim(), phone: f.phone.trim(), logo: logo() || undefined,
      lat: point.lat, lng: point.lng, areaKm: Number(f.areaKm) || 5, memberName: f.memberName?.trim(), role: f.role,
    };
  };
}
