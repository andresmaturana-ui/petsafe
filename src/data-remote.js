// Datos en Supabase: compartidos entre celulares.
// Misma interfaz que data-local.js. La búsqueda por biometría y las reglas de
// privacidad (quien encuentra no ve datos del dueño) corren en la base de
// datos: ver supabase/schema.sql.

import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { pushLocal } from './notify.js';

let client;
function sb() {
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

export async function saveUser({ name, phone, firstName = '', lastName = '', email = '', address = '' }) {
  const auth = await session();
  const row = { id: auth.id, name, phone, first_name: firstName, last_name: lastName, email, address };
  return camel(await run(sb().from('profiles').upsert(row).select().single()));
}

export async function switchUser() {}

export async function listUsers() {
  return rows(await run(sb().from('profiles').select('*').order('created_at')));
}

// ---------- Mascotas ----------

export async function registerPet(_owner, { name, ownerName, diseases, vaccines, photo, biometric }) {
  const id = await run(sb().rpc('register_pet', {
    p_name: name, p_owner_name: ownerName, p_diseases: diseases, p_vaccines: vaccines, p_photo: photo, p_bio: biometric,
  }));
  return { id, name };
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
  return run(sb().from('pets').update({ name: pet.name, diseases: pet.diseases, vaccines: pet.vaccines }).eq('id', pet.id));
}

export async function removeMyPet(_user, petId) {
  await run(sb().from('pets').delete().eq('id', petId));
  return true;
}

export async function reportLost(pet) {
  const foundId = await run(sb().rpc('report_lost', { p_pet: pet.id }));
  return foundId ? { id: foundId } : null;
}

export async function markRecovered(pet, story = '') {
  return run(sb().rpc('mark_recovered', { p_pet: pet.id, p_story: story }));
}

// ---------- Mascotas encontradas ----------

export async function reportFound(_finder, { photo, biometric, lat, lng, finderName, finderPhone }) {
  const r = await run(sb().rpc('report_found', {
    p_photo: photo, p_bio: biometric, p_lat: lat, p_lng: lng, p_name: finderName, p_phone: finderPhone,
  }));
  return {
    report: { id: r.id, bestScore: r.best_score },
    compared: r.compared,
    ownMatch: r.own_match,
    care: r.matched ? { diseases: r.diseases, vaccines: r.vaccines } : null,
  };
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
export async function claimAdmin() {
  return Boolean(await run(sb().rpc('claim_admin')));
}
