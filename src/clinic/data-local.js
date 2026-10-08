// Kiltrazo Clínica sin servidor: todo en este navegador (para probar).
// Misma interfaz que data-remote.js. Usa su propia base IndexedDB para no
// tocar la de la app.

import * as app from '../data-local.js';
import { kmBetween } from '../geo.js';
import { comunaKey } from '../comunas.js';

const TABLES = ['clinics', 'clinic_members', 'clinic_invites', 'clinic_patients', 'clinic_visits', 'clinic_vaccines',
  'clinic_files', 'clinic_appointments', 'pet_codes', 'clinic_blobs', 'clinic_transfers', 'landing_banners', 'clinic_drives', 'muni_matches', 'drive_notices'];

let dbPromise;
function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('kiltrazo-clinica', 5);
    req.onupgradeneeded = () => {
      for (const t of TABLES) if (!req.result.objectStoreNames.contains(t)) req.result.createObjectStore(t, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(table, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(table, mode);
    const r = fn(t.objectStore(table));
    t.oncomplete = () => resolve(r && 'result' in r ? r.result : r);
    t.onerror = () => reject(t.error);
  }));
}

const all = (t) => tx(t, 'readonly', (s) => s.getAll());
const put = (t, v) => tx(t, 'readwrite', (s) => s.put(v)).then(() => v);
const del = (t, id) => tx(t, 'readwrite', (s) => s.delete(id));
const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);

const CODE = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const shortCode = () => Array.from({ length: 6 }, () => CODE[Math.floor(Math.random() * CODE.length)]).join('');

// ---------- Tablas ----------

export async function list(table, eq = {}, { gte, lt, lte, order, desc = false, limit = 2000 } = {}) {
  let rows = (await all(table)).filter((r) => Object.entries(eq).every(([k, v]) => r[k] === v));
  for (const [k, v] of Object.entries(gte || {})) rows = rows.filter((r) => r[k] != null && r[k] >= v);
  for (const [k, v] of Object.entries(lt || {})) rows = rows.filter((r) => r[k] != null && r[k] < v);
  for (const [k, v] of Object.entries(lte || {})) rows = rows.filter((r) => r[k] != null && r[k] <= v);
  if (order) rows.sort((a, b) => String(a[order] ?? '').localeCompare(String(b[order] ?? '')) * (desc ? -1 : 1));
  return rows.slice(0, limit);
}

export const get = (table, id) => tx(table, 'readonly', (s) => s.get(id));

const DEFAULTS = {
  clinic_visits: () => ({ visitedAt: now() }),
  clinic_appointments: () => ({ status: 'agendada', minutes: 30 }),
  clinic_vaccines: () => ({ kind: 'vacuna', appliedOn: today() }),
};

export async function insert(table, row) {
  const me = (await app.currentUser())?.id;
  const extra = { clinic_visits: { vetId: me }, clinic_files: { uploadedBy: me } }[table] || {};
  const saved = await put(table, { ...DEFAULTS[table]?.(), ...extra, ...row, id: uuid(), createdAt: now() });
  // Igual que en la base: si un paciente quitado vuelve a pedir hora, reaparece.
  if (table === 'clinic_appointments' && saved.patientId) {
    const cp = await get('clinic_patients', saved.patientId);
    if (cp?.removedAt) await update('clinic_patients', cp.id, { removedAt: null });
  }
  if (table === 'clinic_drives') await notifyDrive(saved.id);
  return saved;
}

export async function update(table, id, patch) {
  const saved = await put(table, { ...(await get(table, id)), ...patch, id });
  if (table === 'clinic_drives' && 'open' in patch) await notifyDrive(id);
  return saved;
}

export const remove = (table, id) => del(table, id);

// ---------- Sesión y equipo ----------

export async function session() {
  const user = await app.currentUser();
  if (!user) return { needsProfile: true };
  return { user: { id: user.id, email: user.email || '', name: user.name } };
}

export async function myClinics(userId) {
  const mine = (await all('clinic_members')).filter((m) => m.userId === userId);
  const clinics = await all('clinics');
  return mine.map((m) => ({ ...clinics.find((c) => c.id === m.clinicId), role: m.role, isAdmin: m.isAdmin, memberName: m.name }))
    .filter((c) => c.id);
}

export const members = (clinicId) => list('clinic_members', { clinicId }, { order: 'createdAt' });

export async function removeMember(clinicId, userId) {
  return del('clinic_members', `${clinicId}:${userId}`);
}

export async function saveClinic(c) {
  return update('clinics', c.id, {
    ...(c.logo !== undefined ? { logo: c.logo } : {}),
    name: c.name, address: c.address, phone: c.phone, onlyHome: Boolean(c.onlyHome), homeVisits: Boolean(c.homeVisits || c.onlyHome),
    lat: c.lat ?? null, lng: c.lng ?? null, onMap: Boolean(c.onMap), emergencies: Boolean(c.emergencies && !c.onlyHome), hours: c.hours || '',
    travelMinutes: c.travelMinutes ?? 30,
  });
}

async function addMember(clinicId, userId, name, role, isAdmin = false) {
  return put('clinic_members', { id: `${clinicId}:${userId}`, clinicId, userId, name, role, isAdmin, createdAt: now() });
}

export async function createClinic({ name, address, phone, memberName, role }) {
  const me = await app.currentUser();
  const c = await put('clinics', { id: uuid(), name, address, phone, approved: false, slug: await makeSlug(name), createdBy: me.id, createdAt: now() });
  await addMember(c.id, me.id, memberName, role || 'vet', true);
  return c.id;
}

export async function saveReview(clinicId, { rut, docs, termsVersion }) {
  const c = await get('clinics', clinicId);
  const termsAt = c.termsVersion === termsVersion ? c.termsAt : now();
  return update('clinics', clinicId, { rut, docs, termsVersion, termsAt });
}

export async function joinClinic(code, memberName) {
  const inv = await get('clinic_invites', code.trim().toUpperCase());
  if (!inv) throw new Error('El código no existe o ya venció. Pide uno nuevo.');
  await del('clinic_invites', inv.id);
  await addMember(inv.clinicId, (await app.currentUser()).id, memberName, inv.role, Boolean(inv.makeAdmin));
  return inv.clinicId;
}

export async function createInvite(clinicId, role, admin = false) {
  const code = shortCode();
  await put('clinic_invites', { id: code, clinicId, role, makeAdmin: admin, createdAt: now() });
  return code;
}

export async function setClinicAdmin(clinicId, userId, admin) {
  const team = await members(clinicId);
  if (!admin && !team.some((m) => m.isAdmin && m.userId !== userId)) {
    throw new Error('La clínica necesita al menos una persona que la administre');
  }
  return update('clinic_members', `${clinicId}:${userId}`, { isAdmin: admin });
}

export async function approveClinic(clinicId, ok = true) {
  const c = await update('clinics', clinicId, { approved: ok });
  if (ok && c.kind === 'municipio') for (const d of await list('clinic_drives', { clinicId })) await notifyDrive(d.id);
  if (ok) {
    for (const m of await list('clinic_members', { clinicId })) {
      await app.notify(m.userId, { title: `¡${c.name} fue aprobada! 🎉`, body: 'Ya puedes aparecer en "Clínicas cercanas" y recibir horas desde la app (actívalo en Equipo → Datos de la clínica).', url: '#/clinica/equipo' });
    }
  }
  return true;
}

export async function deleteClinic(clinicId) {
  for (const t of TABLES.filter((x) => x !== 'clinics' && x !== 'clinic_blobs')) {
    for (const r of await all(t)) if (r.clinicId === clinicId) await del(t, r.id);
  }
  await del('clinics', clinicId);
  return true;
}

export async function allClinics() {
  const team = await all('clinic_members');
  return (await all('clinics')).sort((a, b) => a.name.localeCompare(b.name, 'es'))
    .map((c) => ({ ...c, members: team.filter((m) => m.clinicId === c.id) }));
}

// ---------- Mascotas de Kiltrazo ----------

export async function createPetCode(petId) {
  for (const c of await all('pet_codes')) if (c.petId === petId) await del('pet_codes', c.id);
  const code = shortCode();
  await put('pet_codes', { id: code, petId, createdAt: now() });
  return code;
}

export async function linkPet(clinicId, code) {
  const pc = await get('pet_codes', code.trim().toUpperCase());
  if (!pc) throw new Error('El código no existe o ya venció. Pide al tutor que genere otro.');
  await del('pet_codes', pc.id);
  return patientFromPet(clinicId, await app.getPet(pc.petId));
}

async function patientFromPet(clinicId, pet) {
  const owner = (await app.listUsers()).find((u) => u.id === pet.ownerId) || {};
  const tutor = {
    tutorName: `${owner.firstName || owner.name || pet.ownerName} ${owner.lastName || ''}`.trim(),
    tutorPhone: owner.phone || '', tutorEmail: owner.email || '', tutorUser: pet.ownerId,
  };
  const existing = (await list('clinic_patients', { clinicId, petId: pet.id }))[0];
  if (existing) return (await update('clinic_patients', existing.id, tutor)).id;
  const notes = [pet.diseases && `Enfermedades (según el tutor): ${pet.diseases}`, pet.vaccines && `Vacunas (según el tutor): ${pet.vaccines}`]
    .filter(Boolean).join('\n');
  return (await insert('clinic_patients', {
    clinicId, petId: pet.id, name: pet.name, species: pet.species || '', breed: pet.breed || '', sex: '', neutered: false,
    chip: '', color: '', allergies: '', notes, photo: pet.photo, ...tutor,
  })).id;
}

export async function removePatient(patientId) {
  await update('clinic_patients', patientId, { removedAt: now() });
  const from = new Date(Date.now() - 3 * 3600000).toISOString();
  for (const a of await list('clinic_appointments', { patientId })) {
    if (a.startsAt >= from && ['solicitada', 'agendada', 'en_camino'].includes(a.status)) await update('clinic_appointments', a.id, { status: 'cancelada' });
  }
  return true;
}

export async function unlinkPet(petId, clinicId) {
  for (const p of await list('clinic_patients', { petId, clinicId })) await update('clinic_patients', p.id, { petId: null, tutorUser: null });
  return true;
}

export async function petHealth(petId) {
  const patients = await list('clinic_patients', { petId });
  const ids = new Set(patients.map((p) => p.id));
  const clinics = await all('clinics');
  const name = (id) => clinics.find((c) => c.id === id)?.name || '';
  return {
    clinics: clinics.filter((c) => patients.some((p) => p.clinicId === c.id && !p.removedAt)),
    vaccines: (await all('clinic_vaccines')).filter((v) => ids.has(v.patientId))
      .sort((a, b) => b.appliedOn.localeCompare(a.appliedOn))
      .map((v) => ({ kind: v.kind, name: v.name, appliedOn: v.appliedOn, nextDue: v.nextDue, clinic: name(v.clinicId) })),
    appointments: (await all('clinic_appointments'))
      .filter((a) => ids.has(a.patientId) && ['solicitada', 'agendada', 'en_camino'].includes(a.status) && a.startsAt >= new Date(Date.now() - 3 * 3600000).toISOString())
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .map((a) => ({ id: a.id, startsAt: a.startsAt, service: a.service, status: a.status, place: a.place || 'clinica', address: a.address || '', clinic: name(a.clinicId), confirmedAt: a.confirmedAt || null })),
  };
}

export async function runReminders() {
  await sendAppointmentReminders();
  const limit = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const vaccines = await all('clinic_vaccines');
  let n = 0;
  for (const v of vaccines) {
    if (v.remindedAt || !v.nextDue || v.nextDue < today() || v.nextDue > limit) continue;
    if (vaccines.some((w) => w.patientId === v.patientId && w.name.toLowerCase() === v.name.toLowerCase() && w.appliedOn > v.appliedOn)) continue;
    const p = await get('clinic_patients', v.patientId);
    if (!p?.tutorUser) continue;
    const clinic = await get('clinics', v.clinicId);
    await update('clinic_vaccines', v.id, { remindedAt: now() });
    await app.notify(p.tutorUser, {
      title: `Se acerca la ${v.kind === 'vacuna' ? 'vacuna' : 'desparasitación'} de ${p.name} 💉`,
      body: `${v.name} el ${v.nextDue.split('-').reverse().join('-')} en ${clinic?.name}.`,
      url: '#/perfil',
    });
    n++;
  }
  return n;
}

/** Aviso al tutor 1 hora antes de su hora (una vez por hora). */
async function sendAppointmentReminders() {
  const from = new Date(Date.now() + 5 * 60000).toISOString();
  const to = new Date(Date.now() + 65 * 60000).toISOString();
  for (const a of await all('clinic_appointments')) {
    if (a.remindedAt || a.status !== 'agendada' || a.service === 'urgencia' || a.startsAt < from || a.startsAt > to) continue;
    const p = await get('clinic_patients', a.patientId);
    if (!p?.tutorUser) continue;
    const clinic = await get('clinics', a.clinicId);
    await update('clinic_appointments', a.id, { remindedAt: now() });
    const t = new Date(a.startsAt).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false });
    await app.notify(p.tutorUser, {
      title: `⏰ ${a.patientName} tiene hora hoy a las ${t}`,
      body: `${SERVICE[a.service] || 'Hora'}${a.place === 'domicilio' ? ' a domicilio' : ` en ${clinic?.name}`}. Toca para confirmar que vas.`,
      url: `#/hora/${a.id}`,
    });
  }
}

async function myOwnAppointment(id) {
  const a = await get('clinic_appointments', id);
  const cp = a && await get('clinic_patients', a.patientId);
  const pet = cp?.petId && await app.getPet(cp.petId);
  if (!pet || pet.ownerId !== (await app.currentUser()).id) return null;
  return { a, cp };
}

export async function myAppointment(id) {
  const r = await myOwnAppointment(id);
  if (!r) return null;
  const c = await get('clinics', r.a.clinicId);
  return {
    id, startsAt: r.a.startsAt, service: r.a.service, status: r.a.status, place: r.a.place || 'clinica', address: r.a.address || '',
    confirmedAt: r.a.confirmedAt || null, pet: r.cp.name, clinic: c.name, clinicPhone: c.phone, clinicAddress: c.address, lat: c.lat, lng: c.lng,
  };
}

export async function confirmMyAppointment(id) {
  const r = await myOwnAppointment(id);
  if (!r || !['agendada', 'en_camino'].includes(r.a.status)) throw new Error('Hora no encontrada');
  await update('clinic_appointments', id, { confirmedAt: now() });
  return true;
}

// ---------- Archivos ----------

export async function upload(path, blob) {
  const data = await new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.readAsDataURL(blob);
  });
  await put('clinic_blobs', { id: path, data });
}

export async function fileUrls(files) {
  const out = {};
  for (const f of files) out[f.id] = (await get('clinic_blobs', f.path))?.data || '';
  return out;
}

export const removeObject = (path) => del('clinic_blobs', path);

// ---------- Horas pedidas por el tutor y avisos ----------

const SERVICE = { consulta: 'Consulta', control: 'Control', vacuna: 'Vacuna', cirugia: 'Cirugía', peluqueria: 'Peluquería', urgencia: 'Urgencia' };
const when = (iso) => {
  const d = new Date(iso);
  const z = (n) => String(n).padStart(2, '0');
  return `${z(d.getDate())}-${z(d.getMonth() + 1)} a las ${z(d.getHours())}:${z(d.getMinutes())}`;
};

async function tellClinic(clinicId, title, body, url) {
  for (const m of await list('clinic_members', { clinicId })) await app.notify(m.userId, { title, body, url });
}

export async function requestAppointment({ petId, clinicId, place, service, startsAt, address = '', lat = null, lng = null, notes = '' }) {
  const me = await app.currentUser();
  const pet = await app.getPet(petId);
  const clinic = await get('clinics', clinicId);
  if (pet?.ownerId !== me.id) throw new Error('Primero comparte tu mascota con la clínica');
  let cp = (await list('clinic_patients', { clinicId, petId }))[0];
  // Clínica del mapa: pedir hora la comparte, igual que el código.
  if (!cp && !(clinic && clinic.approved !== false)) throw new Error('Primero comparte tu mascota con la clínica');
  if (!cp) cp = await get('clinic_patients', await patientFromPet(clinicId, pet));
  if (place === 'domicilio' && !clinic.homeVisits) throw new Error('Esta clínica no hace visitas a domicilio');
  if (place === 'clinica' && clinic.onlyHome) throw new Error('Este veterinario atiende solo a domicilio');
  if (place === 'domicilio' && !address.trim()) throw new Error('Falta la dirección');
  if (startsAt < now()) throw new Error('Elige una fecha futura');
  let vetId = null;
  if (await hasSchedule(clinicId, place)) {
    vetId = await freeVet(clinicId, place, startsAt);
    if (!vetId) throw new Error('Esa hora ya no está disponible. Elige otra.');
  }
  const a = await insert('clinic_appointments', {
    clinicId, patientId: cp.id, patientName: cp.name, service, startsAt, status: 'solicitada', place, minutes: 30,
    address: place === 'domicilio' ? address.trim() : '', lat: place === 'domicilio' ? lat : null, lng: place === 'domicilio' ? lng : null,
    notes: notes.slice(0, 300), requestedBy: me.id, vetId,
  });
  if (place === 'domicilio') await update('clinic_patients', cp.id, { tutorAddress: address.trim() });
  await tellClinic(clinicId, 'Nueva solicitud de hora 📅', `${cp.name} · ${SERVICE[service] || 'Hora'}${place === 'domicilio' ? ' a domicilio' : ''} · ${when(startsAt)}`, '#/clinica/solicitudes');
  return a.id;
}

export async function alertEmergency(petId, clinicId, notes = '') {
  const me = await app.currentUser();
  const pet = await app.getPet(petId);
  if (pet?.ownerId !== me.id) throw new Error('Mascota no encontrada');
  const clinic = await get('clinics', clinicId);
  if (!clinic?.onMap || !clinic.emergencies || clinic.approved === false) throw new Error('Esta clínica no recibe avisos de urgencia. Llámala.');
  const cp = (await list('clinic_patients', { clinicId, petId }))[0] || await get('clinic_patients', await patientFromPet(clinicId, pet));
  const recent = (await list('clinic_appointments', { patientId: cp.id }))
    .some((a) => a.service === 'urgencia' && !['cancelada', 'atendida'].includes(a.status) && Date.now() - new Date(a.createdAt) < 2 * 3600e3);
  if (recent) throw new Error('Ya le avisaste a esta clínica. Si es grave, llámala.');
  const a = await insert('clinic_appointments', {
    clinicId, patientId: cp.id, patientName: cp.name, service: 'urgencia', startsAt: now(), status: 'agendada', place: 'clinica', minutes: 30,
    notes: notes.slice(0, 300), requestedBy: me.id,
  });
  await tellClinic(clinicId, '🚨 Urgencia en camino', [cp.name, notes.trim(), `${cp.tutorName} ${cp.tutorPhone}`.trim()].filter(Boolean).join(' · '), '#/clinica');
  return a.id;
}

export async function cancelMyAppointment(id) {
  const a = await get('clinic_appointments', id);
  if (!a || !['solicitada', 'agendada'].includes(a.status)) throw new Error('Hora no encontrada');
  await update('clinic_appointments', id, { status: 'cancelada' });
  await tellClinic(a.clinicId, 'Hora cancelada por el tutor', `${a.patientName} · ${when(a.startsAt)}`, '#/clinica');
  return true;
}

export async function notifyAppointment(id, kind) {
  const a = await get('clinic_appointments', id);
  const cp = a?.patientId && await get('clinic_patients', a.patientId);
  if (!cp?.tutorUser) return false;
  const c = await get('clinics', a.clinicId);
  const msg = {
    confirmada: [`Hora confirmada para ${cp.name} 📅`, `${SERVICE[a.service] || 'Hora'}${a.place === 'domicilio' ? ' a domicilio' : ''} el ${when(a.startsAt)} con ${c.name}.`],
    rechazada: [`No pudimos confirmar la hora de ${cp.name}`, `${c.name} no tiene esa hora disponible.${c.phone ? ` Llama al ${c.phone} para buscar otra.` : ' Pide otra hora en Kiltrazo.'}`],
    en_camino: ['La veterinaria va en camino 🚗', `${c.name} va hacia tu domicilio para atender a ${cp.name}.`],
    llego: ['La veterinaria llegó 🏠', `${c.name} está en tu puerta para atender a ${cp.name}.`],
  }[kind];
  await app.notify(cp.tutorUser, { title: msg[0], body: msg[1], url: '#/perfil' });
  return true;
}

// ---------- Traspaso de una mascota de la clínica a la app del tutor ----------

export async function createTransferCode(patientId) {
  const cp = await get('clinic_patients', patientId);
  if (cp.petId) throw new Error('Esta mascota ya está en la app de su tutor');
  for (const t of await list('clinic_transfers', { patientId })) await del('clinic_transfers', t.id);
  const code = shortCode() + shortCode().slice(0, 2);
  await put('clinic_transfers', { id: code, patientId, clinicId: cp.clinicId, createdAt: now() });
  return code;
}

export async function transferInfo(code) {
  const t = await get('clinic_transfers', code.trim().toUpperCase());
  const cp = t && await get('clinic_patients', t.patientId);
  if (!cp || cp.petId) return null;
  const c = await get('clinics', t.clinicId);
  return { clinic: c?.name, kind: c?.kind || 'clinica', name: cp.name, species: cp.species, breed: cp.breed, photo: cp.photo, hasScan: Boolean(cp.scan) };
}

export async function acceptTransfer(code) {
  const t = await get('clinic_transfers', code.trim().toUpperCase());
  const cp = t && await get('clinic_patients', t.patientId);
  if (!cp || cp.petId) throw new Error('El enlace ya se usó o venció. Pide uno nuevo a tu veterinaria.');
  if (!cp.scan) throw new Error('La clínica no filmó su cara. Regístrala tú desde la app.');
  const me = await app.currentUser();
  const clinic = await get('clinics', t.clinicId);
  const pet = await app.registerPet(me, {
    name: cp.name, species: cp.species || '', breed: cp.breed || '', ownerName: me.name || '',
    diseases: cp.allergies || '', vaccines: clinic?.kind === 'kiltrazo' ? '' : `Las registra ${clinic?.name}`, photo: cp.photo, biometric: cp.scan, crops: null,
  });
  await claimTransfer(code, pet.id);
  return pet.id;
}

export async function claimTransfer(code, petId) {
  const t = await get('clinic_transfers', code.trim().toUpperCase());
  if (!t) throw new Error('El enlace ya se usó o venció. Pide uno nuevo a tu veterinaria.');
  await del('clinic_transfers', t.id);
  const me = await app.currentUser();
  const cp = await get('clinic_patients', t.patientId);
  await update('clinic_patients', cp.id, {
    petId, tutorUser: me.id, tutorName: cp.tutorName || `${me.firstName || me.name} ${me.lastName || ''}`.trim(),
    tutorPhone: cp.tutorPhone || me.phone || '', tutorEmail: cp.tutorEmail || me.email || '', tutorAddress: cp.tutorAddress || me.address || '',
  });
  const c = await get('clinics', t.clinicId);
  // Del Punto Kiltrazo: entregada, sale de la lista (Kiltrazo no es su veterinaria).
  if (c?.kind === 'kiltrazo') await update('clinic_patients', cp.id, { removedAt: now() });
  return c?.name;
}

// ---------- Punto Kiltrazo (sin clínica) ----------

export async function kiltrazoPoint() {
  const me = await app.currentUser();
  let c = (await all('clinics')).find((x) => x.kind === 'kiltrazo');
  if (!c) c = await put('clinics', { id: uuid(), name: 'Punto Kiltrazo', address: '', phone: '', kind: 'kiltrazo', approved: true, slug: await makeSlug('Punto Kiltrazo'), createdBy: me.id, createdAt: now() });
  await addMember(c.id, me.id, `${me.firstName || me.name || ''} ${me.lastName || ''}`.trim(), 'vet', true);
  return c.id;
}

export async function pointRegister(clinicId, p) {
  const cp = await insert('clinic_patients', { clinicId, ...p });
  return { id: cp.id, code: await createTransferCode(cp.id) };
}

export async function setPointUser(userId, on) {
  const c = await kiltrazoPoint();
  if (userId === (await app.currentUser()).id) return true;
  if (!on) {
    await del('clinic_members', `${c}:${userId}`);
    return true;
  }
  const u = (await app.listUsers()).find((x) => x.id === userId);
  await addMember(c, userId, u ? `${u.firstName || u.name || ''} ${u.lastName || ''}`.trim() : '', 'punto', false);
  return true;
}

// ---------- Mapa de clínicas (urgencias) ----------

// ---------- Página propia de la clínica (también para quien no tiene la app) ----------

async function makeSlug(name) {
  const base = (name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'clinica';
  const taken = new Set((await all('clinics')).map((c) => c.slug));
  let s = base;
  for (let n = 2; taken.has(s); n++) s = `${base}-${n}`;
  return s;
}

export async function publicClinic(slug) {
  const c = (await all('clinics')).find((x) => x.slug === String(slug).toLowerCase() && x.approved !== false && x.kind !== 'municipio');
  if (!c) return null;
  return {
    id: c.id, name: c.name, slug: c.slug, logo: c.logo || null, address: c.address, phone: c.phone, hours: c.hours || '',
    homeVisits: Boolean(c.homeVisits), onlyHome: Boolean(c.onlyHome), emergencies: Boolean(c.emergencies),
    lat: c.onlyHome ? null : c.lat ?? null, lng: c.onlyHome ? null : c.lng ?? null,
    specialties: await clinicSpecialties(c.id),
    vets: (await all('clinic_members')).filter((m) => m.clinicId === c.id && m.role === 'vet' && m.name).map((m) => ({ name: m.name, specialties: m.specialties || [] })),
  };
}

export async function guestRequestAppointment({ clinicId, tutor, pet, place, service, startsAt, address = '', notes = '' }) {
  const me = await app.currentUser().catch(() => null);
  const clinic = await get('clinics', clinicId);
  if (!clinic || clinic.approved === false) throw new Error('Clínica no encontrada');
  const name = (tutor.name || '').trim();
  const phone = (tutor.phone || '').trim();
  const petName = (pet.name || '').trim();
  if (!name || phone.replace(/\D/g, '').length < 8) throw new Error('Escribe tu nombre y tu teléfono');
  if (!petName) throw new Error('Escribe el nombre de tu mascota');
  if (place === 'domicilio' && !clinic.homeVisits) throw new Error('Esta clínica no hace visitas a domicilio');
  if (place === 'clinica' && clinic.onlyHome) throw new Error('Este veterinario atiende solo a domicilio');
  if (place === 'domicilio' && !address.trim()) throw new Error('Falta la dirección');
  if (startsAt < now()) throw new Error('Elige una fecha futura');
  let vetId = null;
  if (await hasSchedule(clinicId, place)) {
    vetId = await freeVet(clinicId, place, startsAt);
    if (!vetId) throw new Error('Esa hora ya no está disponible. Elige otra.');
  }
  const last9 = (p) => String(p || '').replace(/\D/g, '').slice(-9);
  let cp = (await list('clinic_patients', { clinicId }))
    .find((p) => !p.petId && p.name.toLowerCase() === petName.toLowerCase() && last9(p.tutorPhone) === last9(phone));
  if (!cp) {
    cp = await insert('clinic_patients', {
      clinicId, name: petName, species: pet.species || '', breed: pet.breed || '', sex: '', neutered: false, birthDate: null, chip: '', color: '',
      allergies: '', notes: '', tutorName: name, tutorPhone: phone, tutorEmail: (tutor.email || '').trim().toLowerCase(),
      tutorAddress: place === 'domicilio' ? address.trim() : '', withoutApp: true,
    });
  } else if (place === 'domicilio') await update('clinic_patients', cp.id, { tutorAddress: address.trim() });
  const a = await insert('clinic_appointments', {
    clinicId, patientId: cp.id, patientName: petName, service, startsAt, status: 'solicitada', place, minutes: 30,
    address: place === 'domicilio' ? address.trim() : '', notes: notes.slice(0, 300), requestedBy: me?.id || null, vetId,
  });
  await tellClinic(clinicId, 'Nueva solicitud de hora 📅', `${petName} · ${SERVICE[service] || 'Hora'}${place === 'domicilio' ? ' a domicilio' : ''} · ${when(startsAt)} · sin app: confírmale por WhatsApp`, '#/clinica/solicitudes');
  return a.id;
}

export async function nearbyClinics(lat = null, lng = null, km = 50) {
  const here = lat != null && lng != null ? { lat, lng } : null;
  const specs = {};
  for (const c of await all('clinics')) specs[c.id] = await clinicSpecialties(c.id);
  return (await all('clinics'))
    .filter((c) => c.onMap && c.approved !== false && c.lat != null && c.lng != null)
    // Solo a domicilio: el punto se redondea (~1 km) para no mostrar su casa.
    .map((c) => (c.onlyHome ? { ...c, lat: Math.round(c.lat * 100) / 100, lng: Math.round(c.lng * 100) / 100 } : c))
    .map((c) => ({
      id: c.id, name: c.name, slug: c.slug, address: c.address, phone: c.phone, lat: c.lat, lng: c.lng,
      emergencies: Boolean(c.emergencies), homeVisits: Boolean(c.homeVisits), onlyHome: Boolean(c.onlyHome), hours: c.hours || '',
      specialties: specs[c.id] || [],
      km: here ? Math.round(kmBetween(here, c) * 10) / 10 : null,
    }))
    .filter((c) => c.km == null || c.km <= km)
    .sort((a, b) => (b.emergencies - a.emergencies) || ((a.km ?? 0) - (b.km ?? 0)) || a.name.localeCompare(b.name))
    .slice(0, 200);
}

// ---------- Días de trabajo y horas libres (mismas reglas que supabase/schema.sql) ----------

const hm = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const isoDow = (d) => String(d.getDay() || 7);

async function vets(clinicId) {
  return (await list('clinic_members', { clinicId })).filter((m) => m.role === 'vet');
}

async function hasSchedule(clinicId, place) {
  return (await vets(clinicId)).some((m) => Object.values(m.schedule || {}).some((d) => d.place === place));
}

async function freeVet(clinicId, place, at, minutes = 30) {
  const clinic = await get('clinics', clinicId);
  const gap = place === 'domicilio' ? clinic.travelMinutes ?? 30 : 0;
  const t = new Date(at);
  const mins = t.getHours() * 60 + t.getMinutes();
  const appts = (await all('clinic_appointments')).filter((a) => !['cancelada', 'no_vino'].includes(a.status));
  for (const m of await vets(clinicId)) {
    const d = m.schedule?.[isoDow(t)];
    if (d?.place !== place || mins < hm(d.from) || mins + minutes > hm(d.to)) continue;
    const busy = appts.some((a) => {
      if (a.vetId !== m.userId) return false;
      const g = a.place === 'domicilio' || place === 'domicilio' ? gap : 0;
      const s = new Date(a.startsAt).getTime();
      return s < t.getTime() + (minutes + g) * 60000 && s + ((a.minutes || 30) + g) * 60000 > t.getTime();
    });
    if (!busy) return m.userId;
  }
  return null;
}

export async function availableSlots(clinicId, place, days = 14) {
  if (!(await hasSchedule(clinicId, place))) return { configured: false, days: [] };
  const team = await vets(clinicId);
  const out = [];
  const z = (n) => String(n).padStart(2, '0');
  for (let i = 0; i <= Math.min(days, 31); i++) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + i);
    const today = team.map((m) => m.schedule?.[isoDow(d)]).filter((x) => x?.place === place);
    if (!today.length) continue;
    const lo = Math.min(...today.map((x) => hm(x.from)));
    const hi = Math.max(...today.map((x) => hm(x.to)));
    const times = [];
    for (let t = lo; t + 30 <= hi; t += 30) {
      const at = new Date(d);
      at.setHours(Math.floor(t / 60), t % 60, 0, 0);
      if (at.getTime() > Date.now() + 3600000 && (await freeVet(clinicId, place, at.toISOString()))) times.push(`${z(Math.floor(t / 60))}:${z(t % 60)}`);
    }
    if (times.length) out.push({ day: `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`, times });
  }
  return { configured: true, days: out };
}

export async function saveSpecialties(clinicId, userId, specialties) {
  const me = userId || (await app.currentUser())?.id;
  const m = await get('clinic_members', `${clinicId}:${me}`);
  if (!m || m.role !== 'vet') return false;
  await put('clinic_members', { ...m, specialties: [...new Set(specialties)] });
  return true;
}

async function clinicSpecialties(clinicId) {
  const ms = (await all('clinic_members')).filter((m) => m.clinicId === clinicId && m.role === 'vet');
  return [...new Set(ms.flatMap((m) => m.specialties || []))].sort();
}

export async function saveSchedule(clinicId, userId, schedule) {
  for (const [k, d] of Object.entries(schedule)) {
    if (hm(d.from) >= hm(d.to)) throw new Error('Revisa el horario: la hora de término debe ser después de la de inicio');
    for (const m of (await all('clinic_members')).filter((x) => x.userId === userId && x.clinicId !== clinicId)) {
      const o = m.schedule?.[k];
      if (o && hm(o.from) < hm(d.to) && hm(o.to) > hm(d.from)) throw new Error(`Ese horario se cruza con el que tiene en ${(await get('clinics', m.clinicId))?.name}`);
    }
  }
  const m = await get('clinic_members', `${clinicId}:${userId}`);
  await put('clinic_members', { ...m, schedule });
  return true;
}

export async function busyElsewhere(clinicId) {
  const me = await app.currentUser();
  const ids = new Set((await list('clinic_members', { clinicId })).map((m) => m.userId));
  const out = [];
  for (const m of (await all('clinic_members')).filter((x) => ids.has(x.userId) && x.clinicId !== clinicId)) {
    const name = m.userId === me.id ? (await get('clinics', m.clinicId))?.name : '';
    for (const [dow, d] of Object.entries(m.schedule || {})) out.push({ userId: m.userId, dow, fromHm: d.from, toHm: d.to, clinic: name });
  }
  return out;
}

// ---------- Publicidad del buscador ----------

/** Todos para el administrador (admin = true); si no, solo los activos y en fecha. */
export async function listBanners(admin = false) {
  const d = today();
  return (await all('landing_banners'))
    .filter((b) => admin || (b.active && (!b.startsOn || b.startsOn <= d) && (!b.endsOn || b.endsOn >= d)))
    .sort((a, b) => (a.sort - b.sort) || a.createdAt.localeCompare(b.createdAt));
}

export async function saveBanner(b) {
  const old = b.id ? await get('landing_banners', b.id) : null;
  return put('landing_banners', { clicks: 0, createdAt: now(), ...old, ...b, image: b.image || old?.image, id: b.id || uuid(),
    active: Boolean(b.active), sort: Number(b.sort) || 0 });
}

export const deleteBanner = (id) => del('landing_banners', id);

export async function bannerClick(id) {
  const b = await get('landing_banners', id);
  if (b) await put('landing_banners', { ...b, clicks: (b.clicks || 0) + 1 });
}

// ---------- Kiltrazo Municipal ----------

export async function createMunicipality({ name, comuna, address, phone, memberName, role, lat, lng }) {
  const me = await app.currentUser();
  if (!comuna?.trim()) throw new Error('Escribe la comuna');
  if (lat == null || lng == null) throw new Error('Marca la comuna en el mapa');
  const c = await put('clinics', {
    id: uuid(), kind: 'municipio', name, comuna: comuna.trim(), address, phone, lat, lng, areaKm: 5, approved: false, createdBy: me.id, createdAt: now(),
  });
  await addMember(c.id, me.id, memberName, role === 'recepcion' ? 'recepcion' : 'vet', true);
  return c.id;
}

export async function saveMuni(c) {
  return update('clinics', c.id, {
    ...(c.logo !== undefined ? { logo: c.logo } : {}),
    name: c.name, comuna: c.comuna, address: c.address, phone: c.phone, lat: c.lat ?? null, lng: c.lng ?? null, areaKm: c.areaKm ?? 5,
  });
}

// Igual que notify_drive en la base: avisa el operativo, una sola vez, a los
// tutores cuya comuna calza con la de la municipalidad.
async function notifyDrive(driveId) {
  const d = await get('clinic_drives', driveId);
  const c = d && await get('clinics', d.clinicId);
  if (!c || c.kind !== 'municipio' || c.approved === false || d.open === false || d.day < today() || !comunaKey(c.comuna)) return 0;
  if (await get('drive_notices', driveId)) return 0;
  const tutors = (await app.listUsers()).filter((u) => u.comuna && comunaKey(u.comuna) === comunaKey(c.comuna));
  await put('drive_notices', { id: driveId, sentCount: tutors.length, sentAt: now() });
  const [, m, day] = d.day.split('-');
  for (const u of tutors) {
    await app.notify(u.id, {
      title: `Operativo en ${c.comuna} 🏛️`,
      body: `${d.title}: ${day}/${m}, de ${d.starts.slice(0, 5)} a ${d.ends.slice(0, 5)}${d.place ? `, en ${d.place}` : ''}. Es gratis y con cupos: reserva el tuyo.`,
      url: `#/operativo/${d.id}`,
    });
  }
  return tutors.length;
}

export const driveNotice = (driveId) => get('drive_notices', driveId);

export async function comunaDrives() {
  const me = await app.currentUser();
  if (!me?.comuna) return [];
  const munis = (await all('clinics')).filter((c) => c.kind === 'municipio' && c.approved !== false && comunaKey(c.comuna) === comunaKey(me.comuna));
  return (await all('clinic_drives'))
    .filter((d) => d.open !== false && d.day >= today() && munis.some((c) => c.id === d.clinicId))
    .sort((a, b) => `${a.day}${a.starts}`.localeCompare(`${b.day}${b.starts}`))
    .map((d) => ({ id: d.id, title: d.title, day: d.day, place: d.place, starts: d.starts.slice(0, 5), ends: d.ends.slice(0, 5), muni: munis.find((c) => c.id === d.clinicId).name }));
}

// Horarios de un operativo, en la hora local de este navegador.
function driveSlots(d) {
  const start = new Date(`${d.day}T${d.starts.slice(0, 5)}:00`);
  const end = new Date(`${d.day}T${d.ends.slice(0, 5)}:00`);
  const out = [];
  for (let t = start.getTime(); t + d.slotMinutes * 60000 <= end.getTime(); t += d.slotMinutes * 60000) out.push(new Date(t).toISOString());
  return out;
}

const taken = async (driveId) => (await list('clinic_appointments', { driveId })).filter((a) => a.status !== 'cancelada');

export async function publicDrive(id) {
  const d = await get('clinic_drives', id);
  const c = d && await get('clinics', d.clinicId);
  if (!c || c.kind !== 'municipio' || c.approved === false) return null;
  const booked = await taken(id);
  return {
    id: d.id, title: d.title, services: d.services || [], place: d.place, address: d.address, lat: d.lat ?? null, lng: d.lng ?? null,
    day: d.day, starts: d.starts.slice(0, 5), ends: d.ends.slice(0, 5), notes: d.notes || '', open: d.open !== false && d.day >= new Date().toISOString().slice(0, 10),
    muni: c.name, comuna: c.comuna, logo: c.logo || null, phone: c.phone,
    slots: driveSlots(d).map((at) => ({ at, left: Math.max(0, d.perSlot - booked.filter((a) => a.startsAt === at).length) })),
  };
}

export async function bookDrive({ driveId, at, tutor = {}, pet = {}, petId = null }) {
  const info = await publicDrive(driveId);
  if (!info) throw new Error('Operativo no encontrado');
  if (!info.open) throw new Error('Las inscripciones de este operativo están cerradas');
  if (at < now()) throw new Error('Ese horario ya pasó. Elige otro.');
  const slot = info.slots.find((s) => s.at === at);
  if (!slot) throw new Error('Elige un horario de la lista');
  if (!slot.left) throw new Error('Ese horario se llenó. Elige otro.');
  const d = await get('clinic_drives', driveId);
  const clinicId = d.clinicId;
  const last9 = (p) => String(p || '').replace(/\D/g, '').slice(-9);
  let cp;
  if (petId) {
    const me = await app.currentUser();
    const p = await app.getPet(petId);
    if (p?.ownerId !== me?.id) throw new Error('Mascota no encontrada');
    cp = (await list('clinic_patients', { clinicId, petId }))[0] || await get('clinic_patients', await patientFromPet(clinicId, p));
  } else {
    const name = (tutor.name || '').trim();
    const phone = (tutor.phone || '').trim();
    const petName = (pet.name || '').trim();
    if (!name || phone.replace(/\D/g, '').length < 8) throw new Error('Escribe tu nombre y tu teléfono');
    if (!petName) throw new Error('Escribe el nombre de tu mascota');
    const mine = [];
    for (const a of await taken(driveId)) {
      const p = await get('clinic_patients', a.patientId);
      if (p && last9(p.tutorPhone) === last9(phone)) mine.push(a);
    }
    if (mine.length >= 4) throw new Error('Ya tienes 4 cupos en este operativo. Si necesitas más, llama a la municipalidad.');
    cp = (await list('clinic_patients', { clinicId }))
      .find((p) => !p.petId && p.name.toLowerCase() === petName.toLowerCase() && last9(p.tutorPhone) === last9(phone));
    cp ||= await insert('clinic_patients', {
      clinicId, name: petName, species: pet.species || '', breed: pet.breed || '', sex: '', neutered: false, birthDate: null, chip: '', color: '',
      allergies: '', notes: '', tutorName: name, tutorPhone: phone, tutorEmail: (tutor.email || '').trim().toLowerCase(), tutorAddress: '',
      status: 'con_responsable', withoutApp: true,
    });
  }
  if ((await taken(driveId)).some((a) => a.patientId === cp.id)) throw new Error(`${cp.name} ya tiene un cupo en este operativo`);
  const a = await insert('clinic_appointments', {
    clinicId, patientId: cp.id, patientName: cp.name, service: 'operativo', startsAt: at, status: 'agendada', place: 'clinica',
    minutes: d.slotMinutes, driveId, notes: (tutor.notes || '').slice(0, 300), requestedBy: (await app.currentUser().catch(() => null))?.id || null,
  });
  return a.id;
}

export async function muniBoard(clinicId) {
  const c = await get('clinics', clinicId);
  if (c?.approved === false) return { pending: true };
  if (c?.lat == null) return { noArea: true };
  const near = (p) => kmBetween(c, p) <= (c.areaKm ?? 5);
  const r3 = (x) => Math.round(x * 1000) / 1000;
  const ago = (iso, days) => Date.now() - new Date(iso) < days * 86400000;
  const lost = (await app.allPets())
    .filter((p) => p.status === 'lost' && p.lostLat != null && ago(p.lostAt || now(), 90) && near({ lat: p.lostLat, lng: p.lostLng }))
    .map((p) => ({ id: p.id, name: p.name, photo: p.photo, species: p.species || '', breed: p.breed || '', at: p.lostAt, lat: r3(p.lostLat), lng: r3(p.lostLng) }));
  const found = (await app.allFound())
    .filter((f) => ago(f.createdAt, 30) && near(f))
    .map((f) => ({ id: f.id, photo: f.photo, species: f.species || '', at: f.createdAt, lat: r3(f.lat), lng: r3(f.lng), reunited: Boolean(f.petId) }));
  const byDate = (a, b) => String(b.at).localeCompare(String(a.at));
  // Sin servidor no se comparan caras con las fichas: aquí solo se leen las guardadas.
  const matches = (await list('muni_matches', { clinicId })).sort(byDate);
  for (const f of found) f.known = matches.some((m) => m.foundId === f.id);
  return { matches, lost: lost.sort(byDate), found: found.sort(byDate) };
}

export async function muniStats() {
  const out = {};
  for (const c of (await all('clinics')).filter((x) => x.kind === 'municipio')) {
    const pats = await list('clinic_patients', { clinicId: c.id });
    out[c.id] = {
      patients: pats.filter((p) => !p.removedAt).length, filmed: pats.filter((p) => p.scan).length,
      drives: (await list('clinic_drives', { clinicId: c.id })).length,
      bookings: (await list('clinic_appointments', { clinicId: c.id })).filter((a) => a.driveId && a.status !== 'cancelada').length,
    };
  }
  return out;
}
