// Datos en Supabase: compartidos entre celulares.
// Misma interfaz que data-local.js. La búsqueda por biometría y las reglas de
// privacidad (quien encuentra no ve datos del dueño) corren en la base de
// datos: ver supabase/schema.sql.

import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { pushLocal, subscribePush } from './notify.js';

let client;
export function sb() {
  client ??= createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true } });
  return client;
}

// snake_case de la base → camelCase de la app.
const camel = (row) =>
  row && Object.fromEntries(Object.entries(row).map(([k, v]) => [k.replace(/_(\w)/g, (_, c) => c.toUpperCase()), v]));
const rows = (list) => (list || []).map(camel);

async function run(query) {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

// ---------- Usuarios ----------
// Cada celular entra con una sesión anónima de Supabase; el perfil guarda
// nombre y teléfono.

let sessionPromise;
function session() {
  sessionPromise ??= (async () => {
    const { data } = await sb().auth.getSession();
    if (data.session) return data.session.user;
    const res = await sb().auth.signInAnonymously();
    if (res.error) {
      sessionPromise = null;
      throw new Error('No se pudo conectar con el servidor: ' + res.error.message);
    }
    return res.data.user;
  })();
  return sessionPromise;
}

export async function currentUser() {
  const auth = await session();
  const profile = await run(sb().from('profiles').select('*').eq('id', auth.id).maybeSingle());
  if (profile) watchNotifications(profile.id);
  return camel(profile);
}

export async function saveUser({ name, phone, firstName = '', lastName = '', email = '', address = '', comuna, promos, promosVersion }) {
  const auth = await session();
  const row = { id: auth.id, name, phone, first_name: firstName, last_name: lastName, email, address };
  if (comuna !== undefined) row.comuna = comuna;
  // La fecha del consentimiento la pone la base de datos (trigger log_promos).
  if (promos !== undefined) Object.assign(row, { promos, promos_version: promosVersion || '' });
  return camel(await run(sb().from('profiles').upsert(row).select().single()));
}

export async function switchUser() {}

// ---------- Cuenta: correo y clave ----------
// Con el mismo correo y clave se es el mismo usuario en cualquier dispositivo
// (y el administrador, si su correo está en admin_emails).

const back = () => location.origin + location.pathname;

function friendly(error) {
  const m = error.message || String(error);
  if (/invalid login credentials/i.test(m)) return 'Correo o clave incorrectos.';
  if (/not confirmed/i.test(m)) return 'Primero confirma tu correo con el enlace que te enviamos.';
  if (/already|registered|exists/i.test(m)) return 'Ya existe una cuenta con ese correo. Entra con tu clave o usa "Olvidé mi contraseña".';
  if (/rate limit|security purposes/i.test(m)) return 'Se enviaron demasiados correos. Espera un rato e inténtalo de nuevo.';
  if (/password/i.test(m) && /least|short|weak/i.test(m)) return 'La clave debe tener al menos 6 caracteres.';
  return m;
}

/**
 * Convierte al usuario de este dispositivo en una cuenta con correo y clave
 * (conserva sus datos y mascotas). Devuelve true si quedó lista, o false si
 * Supabase pide confirmar el correo primero ("Confirm email" activado).
 */
export async function createAccount(email, password) {
  const auth = await session();
  const change = auth.email === email ? { password } : { email, password };
  const { data, error } = await sb().auth.updateUser(change, { emailRedirectTo: back() });
  if (error) throw new Error(friendly(error));
  if (data.user?.email !== email) return false;
  await sb().auth.refreshSession();
  sessionPromise = Promise.resolve(data.user);
  return true;
}

// Al entrar a la cuenta, lo que se hizo en este dispositivo como anónimo
// (mascotas, avisos) pasa a la cuenta. Ver start_transfer en schema.sql.
export async function signIn(email, password) {
  const before = await session().catch(() => null);
  const pass = before?.is_anonymous ? (await sb().rpc('start_transfer')).data : null;
  const { data, error } = await sb().auth.signInWithPassword({ email, password });
  if (error) throw new Error(friendly(error));
  sessionPromise = Promise.resolve(data.user);
  watching = null;
  if (pass) {
    const { error: e } = await sb().rpc('finish_transfer', { p_token: pass });
    if (e) console.warn('No se pasaron los datos del dispositivo', e.message);
  }
}

// Cambio de dirección (ver move.js): la sesión de este dispositivo viaja a la
// nueva dirección y allá se retoma.
export async function sessionToken() {
  const { data } = await sb().auth.getSession();
  sb().auth.stopAutoRefresh(); // que no la renueve aquí mientras viaja
  return data.session?.refresh_token || '';
}

export async function adoptSession(refreshToken) {
  const { data } = await sb().auth.getSession();
  const here = data.session?.user;
  // Si aquí ya se entró con correo y clave, se queda esa cuenta.
  if (here && !here.is_anonymous) return false;
  // Lo hecho aquí como anónimo (si algo) pasa a la cuenta que llega.
  const pass = here ? (await sb().rpc('start_transfer')).data : null;
  const { error } = await sb().auth.refreshSession({ refresh_token: refreshToken });
  if (error) throw new Error(error.message);
  sessionPromise = null;
  watching = null;
  if (pass) await sb().rpc('finish_transfer', { p_token: pass });
  return true;
}

/** Envía el correo para crear una clave nueva (vuelve a la app, ver finishEmailLink). */
export async function resetPassword(email) {
  const { error } = await sb().auth.resetPasswordForEmail(email, { redirectTo: back() });
  if (error) throw new Error(friendly(error));
}

export async function setPassword(password) {
  const { error } = await sb().auth.updateUser({ password });
  if (error) throw new Error(friendly(error));
}

export async function signOut() {
  await sb().auth.signOut();
  sessionPromise = null;
  watching = null;
}

/**
 * Al volver desde el enlace del correo, la dirección trae la sesión
 * (#access_token=…). Supabase la toma al iniciar; aquí se espera y se limpia
 * la dirección. Devuelve un mensaje de error si el enlace no sirvió.
 */
export async function finishEmailLink() {
  const params = new URLSearchParams(location.hash.slice(1));
  if (!params.has('access_token') && !params.has('error_description')) return null;
  await sb().auth.getSession();
  sessionPromise = null;
  return params.get('error_description') || '';
}

/** Correo con el que se entró en este dispositivo, o '' si es una sesión anónima. */
export async function loginEmail() {
  await session();
  // Si el correo se confirmó desde otro navegador (por ejemplo, el enlace se
  // abrió en Safari), se renueva la sesión para que ya lo incluya.
  const { data } = await sb().auth.getUser();
  const user = data.user;
  if (!user || user.is_anonymous || !user.email) return '';
  const { data: s } = await sb().auth.getSession();
  if (s.session?.user?.is_anonymous) await sb().auth.refreshSession();
  return user.email;
}

// El administrador pasa las mascotas de una cuenta a otra (celular perdido).
export async function moveUserPets(fromId, toId) {
  return run(sb().rpc('admin_move_pets', { p_from: fromId, p_to: toId }));
}

export async function listUsers() {
  return rows(await run(sb().from('profiles').select('*').order('created_at')));
}

// Correo de cada cuenta (también las de Clínica y Municipal sin perfil).
// Si aún no se corre el SQL nuevo, la lista sigue funcionando sin ellos.
export async function listAccounts() {
  try {
    return rows(await run(sb().rpc('admin_accounts')));
  } catch (err) {
    console.warn('Cuentas', err);
    return [];
  }
}

// ---------- Mascotas ----------

export async function registerPet(_owner, { name, species = '', breed = '', ownerName, diseases, vaccines, photo, biometric, crops }) {
  const id = await run(sb().rpc('register_pet', {
    p_name: name, p_species: species, p_breed: breed, p_owner_name: ownerName, p_diseases: diseases, p_vaccines: vaccines, p_photo: photo, p_bio: biometric,
  }));
  // Si falla la subida de fotos, la mascota queda registrada igual.
  if (crops) await saveTrainingPhotos(id, crops).catch((err) => console.warn('Fotos de entrenamiento', err));
  return { id, name };
}

// ---------- Fotos para entrenar (bucket privado "entrenamiento") ----------

const TRAIN = 'entrenamiento';

async function saveTrainingPhotos(petId, { face = [], nose = [] }) {
  await run(sb().from('pets').update({ train_ok: true, train_at: new Date().toISOString() }).eq('id', petId));
  const files = [...face.map((p, i) => [`cara-${i + 1}.jpg`, p]), ...nose.map((p, i) => [`nariz-${i + 1}.jpg`, p])];
  let saved = 0;
  for (const [file, dataUrl] of files) {
    const blob = await (await fetch(dataUrl)).blob();
    const { error } = await sb().storage.from(TRAIN).upload(`${petId}/${file}`, blob, { contentType: 'image/jpeg', upsert: true });
    if (!error) saved++;
  }
  await run(sb().from('pets').update({ train_photos: saved }).eq('id', petId));
}

async function removeTrainingPhotos(petId) {
  const { data } = await sb().storage.from(TRAIN).list(petId);
  if (data?.length) await sb().storage.from(TRAIN).remove(data.map((f) => `${petId}/${f.name}`));
}

/** Solo administrador: todas las fotos para entrenar, como [{ name, data }]. */
export async function trainingPhotos() {
  const out = [];
  const { data: folders, error } = await sb().storage.from(TRAIN).list('', { limit: 10000 });
  if (error) throw error;
  for (const folder of folders || []) {
    const { data: files } = await sb().storage.from(TRAIN).list(folder.name, { limit: 100 });
    for (const f of files || []) {
      const { data: blob } = await sb().storage.from(TRAIN).download(`${folder.name}/${f.name}`);
      if (blob) out.push({ name: `${folder.name}/${f.name}`, data: new Uint8Array(await blob.arrayBuffer()) });
    }
  }
  return out;
}

export async function myPets(user) {
  return rows(await run(sb().from('pets').select('*').eq('owner_id', user.id).order('created_at')));
}

export async function getPet(id) {
  return camel(await run(sb().from('pets').select('*').eq('id', id).maybeSingle()));
}

export async function allPets() {
  return rows(await run(sb().from('pets').select('*')));
}

export async function savePet(pet) {
  return run(sb().from('pets').update({
    name: pet.name, species: pet.species || '', breed: pet.breed || '', diseases: pet.diseases || '', vaccines: pet.vaccines || '',
  }).eq('id', pet.id));
}

export async function removeMyPet(_user, petId) {
  // Primero las fotos: después de borrar la mascota ya no se puede comprobar de quién son.
  await removeTrainingPhotos(petId).catch((err) => console.warn('Fotos de entrenamiento', err));
  await run(sb().from('pets').delete().eq('id', petId));
  return true;
}

// Pasar una mascota a otra persona (se la regaló): enlace de un uso, 7 días.
export async function createPetGift(petId) {
  return run(sb().rpc('create_pet_gift', { p_pet: petId }));
}

export async function petGiftInfo(code) {
  return camel(await run(sb().rpc('pet_gift_info', { p_code: code })));
}

export async function acceptPetGift(code) {
  return run(sb().rpc('accept_pet_gift', { p_code: code }));
}

// El administrador elimina una mascota (las reglas RLS lo permiten).
export const adminDeletePet = (petId) => removeMyPet(null, petId);

// El administrador elimina la cuenta de un usuario con sus mascotas.
export async function adminDeleteUser(userId) {
  return run(sb().rpc('admin_delete_user', { p_user: userId }));
}

// fb: publicar en la página de Facebook de Kiltrazo (solo se envía si se
// preguntó, así funciona aunque aún no se haya vuelto a correr schema.sql).
export async function reportLost(pet, point = null, fb = null) {
  const args = { p_pet: pet.id, p_lat: point?.lat ?? null, p_lng: point?.lng ?? null };
  if (fb != null) args.p_fb = fb;
  const r = await run(sb().rpc('report_lost', args));
  return { match: r.id ? { id: r.id } : null, suggestions: rows(r.suggestions), notified: r.notified };
}

/** Páginas de Facebook e Instagram de Kiltrazo, si están conectadas. */
export async function facebookPage() {
  const rows = await run(sb().from('app_settings').select('key, value').in('key', ['facebook_page', 'instagram_account']));
  const get = (k) => rows?.find((r) => r.key === k)?.value || '';
  return get('facebook_page') ? { facebook: get('facebook_page'), instagram: get('instagram_account') } : null;
}

/** Lo que ve quien recibió el aviso de mascota perdida (sin datos del dueño). */
export async function lostAlert(petId) {
  return camel(await run(sb().rpc('lost_alert', { p_pet: petId })));
}

// ---------- Avisos de mascotas perdidas cerca ----------
// La base guarda solo la zona redondeada (~1 km), ver set_my_area.

export async function myArea(user) {
  if (!user) return null;
  return camel(await run(sb().from('user_areas').select('*').eq('user_id', user.id).maybeSingle()));
}

export async function setMyArea(_user, { lat, lng }) {
  return run(sb().rpc('set_my_area', { p_lat: lat, p_lng: lng }));
}

export async function clearMyArea() {
  return run(sb().rpc('clear_my_area'));
}

/** El dueño reconoce a su mascota en un aviso sugerido. */
export async function claimFound(pet, reportId) {
  return run(sb().rpc('claim_found', { p_found: reportId, p_pet: pet.id }));
}

export async function markRecovered(pet, story = '') {
  return run(sb().rpc('mark_recovered', { p_pet: pet.id, p_story: story }));
}

// ---------- Mascotas encontradas ----------

export async function reportFound(_finder, { photo, biometric, lat, lng, species = '', finderName, finderPhone, source = '' }) {
  // p_source solo desde la placa: así "Encontré" sigue funcionando aunque aún
  // no se haya vuelto a correr schema.sql.
  const r = await run(sb().rpc('report_found', {
    p_species: species, p_photo: photo, p_bio: biometric, p_lat: lat, p_lng: lng, p_name: finderName, p_phone: finderPhone,
    ...(source ? { p_source: source } : {}),
  }));
  return {
    report: { id: r.id, bestScore: r.best_score },
    compared: r.compared,
    ownMatch: r.own_match,
    care: r.matched ? { diseases: r.diseases, vaccines: r.vaccines } : null,
    suggestions: rows(r.suggestions),
  };
}

// ---------- Placa del collar ----------

export async function logTagVisit() {
  await session();
  return run(sb().rpc('log_tag_visit'));
}

/** Para el administrador: visitas al QR de la placa y avisos enviados desde ahí. */
export async function tagStats() {
  return run(sb().rpc('tag_stats'));
}

/** Quien encontró la mascota elige una sugerida: se avisa al dueño. Devuelve sus cuidados. */
export async function confirmFound(_finder, reportId, petId) {
  return run(sb().rpc('confirm_found', { p_found: reportId, p_pet: petId }));
}

export async function getFound(id) {
  return camel(await run(sb().from('found_reports').select('*').eq('id', id).maybeSingle()));
}

export async function allFound() {
  return rows(await run(sb().from('found_reports').select('*')));
}

export async function saveFound(f) {
  return run(sb().from('found_reports').update({ status: f.status }).eq('id', f.id));
}

export async function deleteFound(id) {
  return run(sb().from('found_reports').delete().eq('id', id));
}

// ---------- Notificaciones ----------

export async function notify(userId, { title, body }) {
  return run(sb().rpc('admin_notify', { p_user: userId, p_title: title, p_body: body }));
}

export async function notifyAll({ title, body }) {
  return run(sb().rpc('admin_notify', { p_user: null, p_title: title, p_body: body }));
}

export async function myNotifications(user) {
  return rows(await run(sb().from('notifications').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(100)));
}

/** Muestra como notificación del sistema los avisos aún no mostrados. */
export async function deliverPending(user) {
  for (const n of await myNotifications(user)) {
    if (n.pushed) continue;
    await pushLocal(n);
    await run(sb().from('notifications').update({ pushed: true }).eq('id', n.id));
  }
}

export async function markRead(n) {
  n.read = true;
  return run(sb().from('notifications').update({ read: true }).eq('id', n.id));
}

// ---------- Notificaciones push (con la app cerrada) ----------

async function pushKey() {
  const row = await run(sb().from('app_settings').select('value').eq('key', 'vapid_public_key').maybeSingle());
  return row?.value || '';
}

/** Guarda la suscripción push de este celular. Devuelve true si quedó activa. */
export async function enablePush() {
  const sub = await subscribePush(await pushKey());
  if (!sub) return false;
  const auth = await session();
  await run(sb().from('push_subscriptions').upsert({ ...sub, user_id: auth.id }));
  return true;
}

export async function pushConfigured() {
  return Boolean(await pushKey());
}

/** El administrador publica la clave pública (la privada va solo en Supabase). */
export async function savePushKey(publicKey) {
  return run(sb().from('app_settings').upsert({ key: 'vapid_public_key', value: publicKey }));
}

// Mientras la app está abierta, los avisos nuevos llegan al instante.
let watching = null;
function watchNotifications(userId) {
  if (watching === userId) return;
  watching = userId;
  sb()
    .channel('avisos-' + userId)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, () =>
      window.dispatchEvent(new Event('petsafe:changed')),
    )
    .subscribe();
}

// ---------- Casos exitosos y comentarios ----------

export async function latestSuccesses(limit = 6) {
  return rows(await run(sb().from('successes').select('*').order('created_at', { ascending: false }).limit(limit)));
}

export async function getSuccess(id) {
  return camel(await run(sb().from('successes').select('*').eq('id', id).maybeSingle()));
}

export async function deleteSuccess(id) {
  return run(sb().from('successes').delete().eq('id', id));
}

export async function commentsFor(successId) {
  return rows(await run(sb().from('comments').select('*').eq('success_id', successId).order('created_at')));
}

export async function addComment(user, successId, text) {
  return run(sb().from('comments').insert({ success_id: successId, author: user.name, text }));
}

export async function deleteComment(id) {
  return run(sb().from('comments').delete().eq('id', id));
}

export async function countComments() {
  const counts = {};
  for (const c of await run(sb().from('comments').select('success_id'))) counts[c.success_id] = (counts[c.success_id] || 0) + 1;
  return counts;
}

export async function addSuccess({ petName, photo, story }) {
  return run(sb().from('successes').insert({ pet_name: petName, photo, story }));
}

// ---------- Administración ----------

export async function isAdmin() {
  return Boolean(await run(sb().rpc('is_admin')));
}

/** El primer usuario que entra al panel queda como administrador. */
// null si la función aún no está en la base (schema.sql sin actualizar).
export async function adminExists() {
  const { data, error } = await sb().rpc('admin_exists');
  return error ? null : Boolean(data);
}

export async function claimAdmin() {
  return Boolean(await run(sb().rpc('claim_admin')));
}

// ---------- Mensajes de usuarios al administrador ----------
// Al guardarse, la base avisa a los administradores (ver schema.sql).

export async function contactAdmin(user, body) {
  return run(sb().from('contacts').insert({ name: user.name, phone: user.phone, body }));
}

export async function listContacts() {
  return rows(await run(sb().from('contacts').select('*').order('created_at', { ascending: false }).limit(200)));
}

export async function markContactRead(id) {
  return run(sb().from('contacts').update({ read: true }).eq('id', id));
}

export async function deleteContact(id) {
  return run(sb().from('contacts').delete().eq('id', id));
}

// ---------- Estudio de ganado (bucket privado "estudio-ganado") ----------
// Videos de la cara y el morro de vacas y caballos para medir si el
// reconocimiento facial sirve con ganado. Una carpeta por autocrotal.

const STUDY = 'estudio-ganado';

/** ¿Esta cuenta puede filmar el estudio? (permiso del administrador, o es él). */
export async function studyAccess() {
  const { data, error } = await sb().rpc('study_ok');
  return !error && Boolean(data);
}

export async function studySave({ tag, species, sex, part, blob, ext }) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const path = `${tag}/${stamp}-${part}.${ext}`;
  const { error } = await sb().storage.from(STUDY).upload(path, blob, { contentType: blob.type || 'video/mp4', upsert: false });
  if (error) throw new Error(error.message);
  await run(sb().from('study_videos').insert({ tag, species, sex, part, path, size: blob.size }));
}

/** Solo administrador: lo filmado, del más nuevo al más antiguo. */
export async function studyList() {
  return rows(await run(sb().from('study_videos').select('*').order('created_at', { ascending: false })));
}

export async function studyFile(path) {
  const { data, error } = await sb().storage.from(STUDY).download(path);
  if (error) throw new Error(error.message);
  return new Uint8Array(await data.arrayBuffer());
}

/** Solo administrador: los invitados (Invitado 1, 2, ...) y cuántos celulares entraron con cada código. */
export async function studyGuests() {
  const [guests, users] = await Promise.all([
    run(sb().from('study_guests').select('*').order('n')),
    run(sb().from('study_users').select('guest')),
  ]);
  return rows(guests).map((g) => ({ ...g, devices: users.filter((u) => u.guest === g.id).length }));
}

export const studyNewGuest = () => run(sb().rpc('admin_new_study_guest'));
export const studyDeleteGuest = (id) => run(sb().rpc('admin_delete_study_guest', { p_id: id }));
/** El invitado entra con su código. Devuelve su número. */
export const studyJoin = (code) => run(sb().rpc('study_join', { p_code: code }));
