// Lógica de negocio: registro, avisos de pérdida/hallazgo, coincidencias,
// notificaciones, casos exitosos y comentarios.

import { db, uid } from './db.js';
import { compare } from './biometrics.js';
import { pushLocal } from './notify.js';

const now = () => new Date().toISOString();

// ---------- Usuarios ----------

export async function currentUser() {
  const meta = await db.get('meta', 'currentUser');
  return meta ? db.get('users', meta.userId) : null;
}

export async function saveUser({ id, ...fields }) {
  const old = id ? await db.get('users', id) : null;
  const user = await db.put('users', { ...old, ...fields, id: id || uid('u_'), createdAt: old?.createdAt || now() });
  await db.put('meta', { id: 'currentUser', userId: user.id });
  return user;
}

export async function switchUser(userId) {
  await db.put('meta', { id: 'currentUser', userId });
}

export const listUsers = () => db.all('users');

// ---------- Mascotas ----------

export async function registerPet(owner, { name, ownerName, diseases, vaccines, photo, biometric }) {
  return db.put('pets', {
    id: uid('p_'),
    ownerId: owner.id,
    name,
    ownerName,
    diseases,
    vaccines,
    photo,
    biometric,
    status: 'home',
    createdAt: now(),
  });
}

export async function myPets(user) {
  return (await db.all('pets')).filter((p) => p.ownerId === user.id);
}

export const getPet = (id) => db.get('pets', id);
export const allPets = () => db.all('pets');
export const savePet = (pet) => db.put('pets', pet);
export const deletePet = (id) => db.delete('pets', id);

/** El dueño elimina su mascota: se borra su biometría y se desligan los avisos. */
export async function removeMyPet(user, petId) {
  const pet = await db.get('pets', petId);
  if (!pet || pet.ownerId !== user.id) return false;
  for (const f of await db.all('found')) {
    if (f.petId === petId) await db.put('found', { ...f, petId: null });
  }
  await db.delete('pets', petId);
  return true;
}

/** "Perdí mi mascota": activa el aviso y busca entre los avisos de "encontré". */
export async function reportLost(pet) {
  pet.status = 'lost';
  pet.lostAt = now();
  await db.put('pets', pet);

  const found = (await db.all('found')).filter((f) => f.status === 'open' && (!f.petId || f.petId === pet.id));
  let best = null;
  for (const f of found) {
    const { score, match } = compare(pet.biometric, f.biometric);
    if (match && (!best || score > best.score)) best = { report: f, score };
  }
  if (best) {
    best.report.petId = pet.id;
    await db.put('found', best.report);
    await notifyOwnerOfMatch(pet, best.report);
    return best.report;
  }
  return null;
}

/** "Ya encontré mi mascota": quita el aviso y lo convierte en caso exitoso. */
export async function markRecovered(pet, story = '') {
  pet.status = 'home';
  pet.recoveredAt = now();
  await db.put('pets', pet);
  for (const f of await db.all('found')) {
    if (f.petId === pet.id && f.status === 'open') {
      f.status = 'closed';
      await db.put('found', f);
    }
  }
  return db.put('successes', {
    id: uid('s_'),
    petId: pet.id,
    petName: pet.name,
    photo: pet.photo,
    story,
    createdAt: now(),
  });
}

// ---------- Mascotas encontradas ----------

/**
 * "Encontré una mascota": guarda el aviso y, si la cara coincide con una
 * mascota registrada, avisa al dueño. Al que la encontró solo se le devuelven
 * los cuidados (vacunas y enfermedades), nunca datos del dueño.
 */
export async function reportFound(finder, { photo, biometric, lat, lng, finderName, finderPhone }) {
  const report = {
    id: uid('f_'),
    finderId: finder.id,
    finderName,
    finderPhone,
    photo,
    biometric,
    lat,
    lng,
    status: 'open',
    createdAt: now(),
  };

  let best = null;
  let compared = 0;
  let ownMatch = null;
  for (const pet of await db.all('pets')) {
    const { score, match } = compare(pet.biometric, biometric);
    // Una mascota propia no se "encuentra"; se informa para no confundir.
    if (pet.ownerId === finder.id) {
      if (match) ownMatch = pet.name;
      continue;
    }
    compared++;
    report.bestScore = Math.max(report.bestScore || 0, score);
    if (match && (!best || score > best.score)) best = { pet, score };
  }
  if (best) report.petId = best.pet.id;
  await db.put('found', report);
  if (best) await notifyOwnerOfMatch(best.pet, report);

  return {
    report,
    compared,
    ownMatch,
    care: best ? { diseases: best.pet.diseases, vaccines: best.pet.vaccines } : null,
  };
}

export const getFound = (id) => db.get('found', id);
export const allFound = () => db.all('found');
export const saveFound = (f) => db.put('found', f);
export const deleteFound = (id) => db.delete('found', id);

// ---------- Notificaciones ----------

async function notifyOwnerOfMatch(pet, report) {
  await notify(pet.ownerId, {
    type: 'match',
    title: `¡Encontraron a ${pet.name}! 🐾`,
    body: 'Toca para ver dónde está y contactar a quien la encontró.',
    url: `#/encontrada/${report.id}`,
  });
}

export async function notify(userId, { type = 'info', title, body, url = '#/avisos' }) {
  const n = await db.put('notifications', {
    id: uid('n_'),
    userId,
    type,
    title,
    body,
    url,
    read: false,
    pushed: false,
    createdAt: now(),
  });
  const me = await currentUser();
  if (me?.id === userId) await deliverPending(me);
  return n;
}

export async function notifyAll({ title, body }) {
  for (const u of await listUsers()) await notify(u.id, { type: 'admin', title, body });
}

/** Muestra como notificación del sistema los avisos aún no mostrados. */
export async function deliverPending(user) {
  for (const n of await myNotifications(user)) {
    if (n.pushed) continue;
    await pushLocal(n);
    n.pushed = true;
    await db.put('notifications', n);
  }
}

export async function myNotifications(user) {
  return (await db.all('notifications'))
    .filter((n) => n.userId === user.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function markRead(n) {
  n.read = true;
  await db.put('notifications', n);
}

// ---------- Casos exitosos y comentarios ----------

export async function latestSuccesses(limit = 6) {
  return (await db.all('successes')).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}

export const getSuccess = (id) => db.get('successes', id);
export const deleteSuccess = (id) => db.delete('successes', id);

export async function commentsFor(successId) {
  return (await db.all('comments'))
    .filter((c) => c.successId === successId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function addComment(user, successId, text) {
  return db.put('comments', { id: uid('c_'), successId, userId: user.id, author: user.name, text, createdAt: now() });
}

export const deleteComment = (id) => db.delete('comments', id);

export async function countComments() {
  const counts = {};
  for (const c of await db.all('comments')) counts[c.successId] = (counts[c.successId] || 0) + 1;
  return counts;
}

export async function addSuccess(s) {
  return db.put('successes', { id: uid('s_'), createdAt: now(), ...s });
}

// ---------- Administración ----------
// En modo local el acceso de administrador es con el PIN (ver views/admin.js).

export const isAdmin = async () => false;
export const claimAdmin = async () => false;

// ---------- Mensajes de usuarios al administrador ----------

export async function contactAdmin(user, body) {
  return db.put('contacts', { id: uid('m_'), userId: user.id, name: user.name, phone: user.phone, body, read: false, createdAt: now() });
}

export async function listContacts() {
  return (await db.all('contacts')).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function markContactRead(id) {
  const c = await db.get('contacts', id);
  if (c) await db.put('contacts', { ...c, read: true });
}

export const deleteContact = (id) => db.delete('contacts', id);
