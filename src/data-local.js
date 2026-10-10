// Lógica de negocio: registro, avisos de pérdida/hallazgo, coincidencias,
// notificaciones, casos exitosos y comentarios.

import { db, uid } from './db.js';
import { compare } from './biometrics.js';
import { pushLocal } from './notify.js';
import { kmBetween, roundArea, distanceText, NEARBY_KM } from './geo.js';

const now = () => new Date().toISOString();

// ---------- Usuarios ----------

export async function currentUser() {
  const meta = await db.get('meta', 'currentUser');
  return meta ? db.get('users', meta.userId) : null;
}

export async function saveUser({ id, ...fields }) {
  const old = id ? await db.get('users', id) : null;
  // Igual que en Supabase: la fecha del consentimiento cambia solo si cambia la respuesta.
  if (fields.promos !== undefined && fields.promos !== Boolean(old?.promos)) fields.promosAt = now();
  const user = await db.put('users', { ...old, ...fields, id: id || uid('u_'), createdAt: old?.createdAt || now() });
  await db.put('meta', { id: 'currentUser', userId: user.id });
  return user;
}

export async function switchUser(userId) {
  await db.put('meta', { id: 'currentUser', userId });
}

export const listUsers = () => db.all('users');
export const listAccounts = async () => (await db.all('users')).filter((u) => u.email).map(({ id, email, createdAt }) => ({ id, email, createdAt }));

/** El administrador pasa las mascotas de una cuenta a otra (celular perdido). */
export async function moveUserPets(fromId, toId) {
  const pets = (await db.all('pets')).filter((p) => p.ownerId === fromId);
  for (const p of pets) await db.put('pets', { ...p, ownerId: toId });
  return pets.length;
}

// ---------- Mascotas ----------

export async function registerPet(owner, { name, species = '', breed = '', ownerName, diseases, vaccines, photo, biometric, crops }) {
  // En modo local las fotos para entrenar quedan dentro del registro de la mascota.
  const train = crops ? { trainOk: true, trainAt: now(), trainCrops: crops, trainPhotos: crops.face.length + crops.nose.length } : {};
  return db.put('pets', {
    ...train,
    id: uid('p_'),
    ownerId: owner.id,
    name,
    species,
    breed,
    ownerName,
    diseases,
    vaccines,
    photo,
    biometric,
    status: 'home',
    createdAt: now(),
  });
}

/** Fotos para entrenar de una mascota que ya existe (las que vienen del punto). */
export async function saveTrainingPhotos(petId, crops) {
  const pet = await db.get('pets', petId);
  if (pet) await db.put('pets', { ...pet, trainOk: true, trainAt: now(), trainCrops: crops, trainPhotos: crops.face.length + crops.nose.length });
}

export async function myPets(user) {
  return (await db.all('pets')).filter((p) => p.ownerId === user.id);
}

/** Fotos para entrenar, como [{ name, data }] (carpeta por mascota). */
export async function trainingPhotos() {
  const out = [];
  for (const pet of await db.all('pets')) {
    if (!pet.trainCrops) continue;
    const files = [...pet.trainCrops.face.map((p, i) => [`cara-${i + 1}.jpg`, p]), ...pet.trainCrops.nose.map((p, i) => [`nariz-${i + 1}.jpg`, p])];
    for (const [file, dataUrl] of files) {
      out.push({ name: `${pet.id}/${file}`, data: new Uint8Array(await (await fetch(dataUrl)).arrayBuffer()) });
    }
  }
  return out;
}

export const getPet = (id) => db.get('pets', id);
export const allPets = () => db.all('pets');
export const savePet = (pet) => db.put('pets', pet);
export const deletePet = (id) => db.delete('pets', id);

/** El administrador elimina una mascota de cualquier usuario. */
export async function adminDeletePet(petId) {
  const pet = await db.get('pets', petId);
  return pet ? removeMyPet({ id: pet.ownerId }, petId) : false;
}

/** El administrador elimina un usuario con sus mascotas. */
export async function adminDeleteUser(userId) {
  for (const p of await db.all('pets')) if (p.ownerId === userId) await removeMyPet({ id: userId }, p.id);
  await db.delete('users', userId);
  return true;
}

/** El dueño elimina su mascota: se borra su biometría y se desligan los avisos. */
// Pasar una mascota a otra persona: el enlace se guarda en "meta" (gift:CÓDIGO).
const WEEK = 7 * 24 * 3600000;
export async function createPetGift(petId) {
  const code = Math.random().toString(36).slice(2, 10).toUpperCase();
  const me = await currentUser();
  await db.put('meta', { id: `gift:${code}`, petId, fromUser: me.id, createdAt: now() });
  return code;
}

async function giftOf(code) {
  const g = await db.get('meta', `gift:${String(code).trim().toUpperCase()}`);
  const pet = g && await db.get('pets', g.petId);
  if (!g || !pet || pet.ownerId !== g.fromUser || Date.now() - Date.parse(g.createdAt) > WEEK) return null;
  return { g, pet };
}

export async function petGiftInfo(code) {
  const it = await giftOf(code);
  if (!it) return null;
  const from = await db.get('users', it.g.fromUser);
  const me = await currentUser();
  return { name: it.pet.name, photo: it.pet.photo, species: it.pet.species, breed: it.pet.breed,
    from: from?.firstName || (from?.name || '').split(' ')[0] || '', mine: it.pet.ownerId === me?.id };
}

export async function acceptPetGift(code) {
  const me = await currentUser();
  if (!me) throw new Error('Primero completa tu perfil');
  const it = await giftOf(code);
  if (!it) throw new Error('Este enlace ya no sirve. Pide uno nuevo.');
  if (it.pet.ownerId === me.id) throw new Error('Esta mascota ya es tuya');
  await db.put('pets', { ...it.pet, ownerId: me.id, ownerName: `${me.firstName || me.name} ${me.lastName || ''}`.trim() });
  await db.delete('meta', it.g.id);
  return it.pet.id;
}

export async function removeMyPet(user, petId) {
  const pet = await db.get('pets', petId);
  if (!pet || pet.ownerId !== user.id) return false;
  for (const f of await db.all('found')) {
    if (f.petId === petId) await db.put('found', { ...f, petId: null });
  }
  await db.delete('pets', petId);
  return true;
}

/**
 * "Perdí mi mascota": activa el aviso y busca entre los avisos de "encontré".
 * Si el dueño marca dónde se perdió (point), la primera vez avisa a quienes
 * activaron los avisos cerca a 5 km o menos.
 */
// Sin nube no hay página de Facebook.
export async function facebookPage() {
  return null;
}

export async function reportLost(pet, point = null) {
  if (pet.status !== 'lost') {
    Object.assign(pet, { lostAt: now(), lostLat: null, lostLng: null, lostAlertedAt: null, lostAlerted: 0 });
  }
  pet.status = 'lost';
  if (point) Object.assign(pet, { lostLat: point.lat, lostLng: point.lng });
  if (pet.lostLat != null && !pet.lostAlertedAt) {
    const at = { lat: pet.lostLat, lng: pet.lostLng };
    const what = [pet.species !== 'otro' && pet.species, pet.breed].filter(Boolean).join(', ');
    let n = 0;
    for (const a of await db.all('areas')) {
      const km = kmBetween(a, at);
      if (a.id === pet.ownerId || km > NEARBY_KM) continue;
      await notify(a.id, {
        type: 'lost',
        title: `Se perdió ${pet.name} cerca de ti`,
        body: `${what ? what[0].toUpperCase() + what.slice(1) + ', ' : ''}${distanceText(km)}. Toca para ver su foto. Si la ves, escanéala en Kiltrazo y le avisamos a su dueño.`,
        url: `#/perdida/${pet.id}`,
      });
      n++;
    }
    Object.assign(pet, { lostAlertedAt: now(), lostAlerted: n });
  }
  await db.put('pets', pet);

  // También los avisos que se hicieron antes de que el dueño avisara.
  const found = (await db.all('found')).filter((f) => f.status === 'open' && (!f.petId || f.petId === pet.id));
  let best = null;
  const similar = [];
  for (const f of found) {
    if (!sameSpecies(pet.species, f.species)) continue;
    const { score, match, suggest } = compare(pet.biometric, f.biometric);
    if (match && (!best || score > best.score)) best = { report: f, score };
    if (suggest && !f.petId) similar.push({ id: f.id, photo: f.photo, createdAt: f.createdAt, score });
  }
  if (best && best.report.petId !== pet.id) {
    Object.assign(best.report, { petId: pet.id, matchKind: 'auto', matchScore: best.score });
    await db.put('found', best.report);
    await notifyOwnerOfMatch(pet, best.report);
  }
  return {
    match: best?.report || null,
    suggestions: similar.filter((s) => s.id !== best?.report.id).sort((a, b) => b.score - a.score).slice(0, 3),
    notified: pet.lostLat != null ? pet.lostAlerted : null,
  };
}

/** Lo que ve quien recibió el aviso de mascota perdida (sin datos del dueño). */
export async function lostAlert(petId) {
  const p = await db.get('pets', petId);
  if (!p) return null;
  const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
  return { id: p.id, name: p.name, photo: p.photo, species: p.species, breed: p.breed, status: p.status, lostAt: p.lostAt, lat: r3(p.lostLat), lng: r3(p.lostLng) };
}

// ---------- Avisos de mascotas perdidas cerca ----------

export async function myArea(user) {
  return user ? (await db.get('areas', user.id)) || null : null;
}

export async function setMyArea(user, point) {
  return db.put('areas', { id: user.id, ...roundArea(point), updatedAt: now() });
}

export async function clearMyArea(user) {
  await db.delete('areas', user.id);
  return true;
}

/** "Ya encontré mi mascota": quita el aviso y lo convierte en caso exitoso. */
export async function markRecovered(pet, story = '') {
  pet.status = 'home';
  pet.recoveredAt = now();
  Object.assign(pet, { lostLat: null, lostLng: null, lostAlertedAt: null, lostAlerted: 0 });
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
export async function reportFound(finder, { photo, biometric, lat, lng, species = '', finderName, finderPhone, source = '' }) {
  const report = {
    id: uid('f_'),
    finderId: finder?.id || null,
    source,
    finderName,
    finderPhone,
    photo,
    biometric,
    lat,
    lng,
    species,
    status: 'open',
    createdAt: now(),
  };

  let best = null;
  let compared = 0;
  let ownMatch = null;
  const similar = [];
  for (const pet of await db.all('pets')) {
    if (!sameSpecies(pet.species, species)) continue;
    const { score, match, sure, suggest } = compare(pet.biometric, biometric);
    // Una mascota propia no se "encuentra"; se informa para no confundir.
    if (finder && pet.ownerId === finder.id) {
      if (match) ownMatch = pet.name;
      report.ownScore = Math.max(report.ownScore || 0, score);
      continue;
    }
    compared++;
    report.bestScore = Math.max(report.bestScore || 0, score);
    // Si no está perdida, solo se avisa con un parecido mucho mayor.
    if ((pet.status === 'lost' ? match : sure) && (!best || score > best.score)) best = { pet, score };
    // Perdidas algo parecidas: quien la encontró puede decir "¡es esta!".
    if (suggest && pet.status === 'lost') similar.push({ ...pick(pet), score });
  }
  // Igual que report_found en schema.sql: se anota cómo se ligó y con qué parecido.
  if (best) Object.assign(report, { petId: best.pet.id, matchKind: 'auto', matchScore: best.score });
  await db.put('found', report);
  if (best) await notifyOwnerOfMatch(best.pet, report);

  return {
    report,
    compared,
    ownMatch,
    care: best ? { diseases: best.pet.diseases, vaccines: best.pet.vaccines } : null,
    suggestions: similar.filter((s) => s.id !== best?.pet.id).sort((a, b) => b.score - a.score).slice(0, 3),
  };
}

const pick = ({ id, name, photo, species, breed, lostAt }) => ({ id, name, photo, species, breed, lostAt });

/** Quien encontró la mascota elige una sugerida: se avisa al dueño. Devuelve sus cuidados. */
export async function confirmFound(finder, reportId, petId) {
  const [report, pet] = await Promise.all([db.get('found', reportId), db.get('pets', petId)]);
  if (!report || !pet || report.finderId !== (finder?.id || null) || report.petId || pet.status !== 'lost') throw new Error('Aviso no disponible');
  Object.assign(report, { petId: pet.id, matchKind: 'finder', matchScore: compare(pet.biometric, report.biometric).score });
  await db.put('found', report);
  await notify(pet.ownerId, {
    type: 'match',
    title: `¿Encontraron a ${pet.name}? 🐾`,
    body: 'Alguien cree que la encontró. Toca para ver su foto, dónde está y contactarle.',
    url: `#/encontrada/${report.id}`,
  });
  return { diseases: pet.diseases, vaccines: pet.vaccines };
}

/** El dueño reconoce a su mascota en un aviso sugerido. */
export async function claimFound(pet, reportId) {
  const report = await db.get('found', reportId);
  if (!report || report.status !== 'open' || (report.petId && report.petId !== pet.id)) throw new Error('Aviso no disponible');
  // Si la app ya la había ligado sola, se mantiene como coincidencia automática.
  if (report.petId !== pet.id) Object.assign(report, { matchKind: 'owner', matchScore: compare(pet.biometric, report.biometric).score });
  report.petId = pet.id;
  await db.put('found', report);
  if (report.finderId) {
    await notify(report.finderId, {
      title: 'El dueño reconoció a la mascota que encontraste 🐾',
      body: `Se llama ${pet.name}. Te contactará pronto. ¡Gracias!`,
    });
  }
  return true;
}

// Un gato nunca es la mascota de un aviso de perro. Si alguno no sabe o es
// "otro", se compara igual. Mismo criterio que same_species() en schema.sql.
function sameSpecies(a, b) {
  return !a || !b || a === 'otro' || b === 'otro' || a === b;
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
export const adminExists = async () => true;

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

// Web Push necesita el servidor (Supabase): sin él, los avisos se ven al abrir la app.
export const enablePush = async () => false;
export const pushConfigured = async () => false;
export const savePushKey = async () => false;

// Entrar con correo necesita el servidor (Supabase).
export const createAccount = async () => { throw new Error('Disponible solo con la app conectada a internet.'); };
export const signIn = createAccount;
export const resetPassword = createAccount;
export const setPassword = createAccount;
export const signOut = async () => {};
export const loginEmail = async () => '';
export const finishEmailLink = async () => null;
export const sessionToken = async () => '';
export const adoptSession = async () => false;

// ---------- Placa del collar ----------

export async function logTagVisit() {
  const meta = (await db.get('meta', 'tagVisits')) || { id: 'tagVisits', count: 0 };
  await db.put('meta', { ...meta, count: meta.count + 1 });
}

export async function tagStats() {
  const found = (await db.all('found')).filter((f) => f.source === 'placa');
  return {
    visits: (await db.get('meta', 'tagVisits'))?.count || 0,
    reports: found.length,
    matched: found.filter((f) => f.petId).length,
    months: [],
  };
}

// ---------- Estudio de ganado ----------
// En modo local (pruebas) lo filmado queda en memoria hasta recargar.

const study = { videos: [], guests: [], joined: new Map(), files: new Map(), horses: [] };

export async function studyAccess() {
  const me = await currentUser();
  return sessionStorage.getItem('petsafe-admin') === 'ok' || study.joined.has(me?.id || 'anon');
}

export async function studySave({ tag, species, sex, part, blob, ext }) {
  const me = await currentUser();
  const guest = study.guests.find((g) => g.id === study.joined.get(me?.id || 'anon'))?.n ?? null;
  const path = `${tag}/${now().replace(/[:.]/g, '-').slice(0, 19)}-${part}.${ext}`;
  study.files.set(path, new Uint8Array(await blob.arrayBuffer()));
  study.videos.unshift({ id: uid('sv_'), tag, species, sex, part, path, size: blob.size, guest, createdAt: now() });
}

export const studyList = async () => [...study.videos];
export const studyFile = async (path) => study.files.get(path);
export const studyGuests = async () => study.guests.map((g) => ({ ...g, devices: [...study.joined.values()].filter((v) => v === g.id).length }));
export async function studyNewGuest() {
  const g = { id: uid('sg_'), n: Math.max(0, ...study.guests.map((x) => x.n)) + 1, code: Math.random().toString(36).slice(2, 8).toUpperCase(), createdAt: now() };
  study.guests.push(g);
  return g;
}
export async function studyDeleteGuest(id) {
  study.guests = study.guests.filter((g) => g.id !== id);
}
export async function studyJoin(code) {
  const g = study.guests.find((x) => x.code === String(code).trim().toUpperCase());
  if (!g) throw new Error('Ese código no existe. Revísalo o pídele uno nuevo al administrador.');
  const me = await currentUser();
  study.joined.set(me?.id || 'anon', g.id);
  return g.n;
}

export async function studyNewHorse(name, sex) {
  if (!String(name).trim()) throw new Error('Falta el nombre del caballo');
  const tag = `C-${String(study.horses.length + 1).padStart(4, '0')}`;
  study.horses.push({ tag, name: String(name).trim(), sex });
  return tag;
}
export const studyHorses = async () => [...study.horses];
