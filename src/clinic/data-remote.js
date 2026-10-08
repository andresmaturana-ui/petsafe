// Kiltrazo Clínica en Supabase. Las reglas de quién ve qué están en
// supabase/schema.sql (sección "Kiltrazo Clínica"): cada clínica ve solo lo suyo.

import { sb } from '../data-remote.js';

const BUCKET = 'clinica';

const snake = (k) => k.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
const camel = (row) =>
  row && Object.fromEntries(Object.entries(row).map(([k, v]) => [k.replace(/_(\w)/g, (_, c) => c.toUpperCase()), v]));
const toRow = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined).map(([k, v]) => [snake(k), v]));

async function run(query) {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

// ---------- Tablas ----------

export async function list(table, eq = {}, { gte, lt, lte, order, desc = false, limit = 2000 } = {}) {
  let q = sb().from(table).select('*');
  for (const [k, v] of Object.entries(eq)) q = q.eq(snake(k), v);
  for (const [k, v] of Object.entries(gte || {})) q = q.gte(snake(k), v);
  for (const [k, v] of Object.entries(lt || {})) q = q.lt(snake(k), v);
  for (const [k, v] of Object.entries(lte || {})) q = q.lte(snake(k), v);
  if (order) q = q.order(snake(order), { ascending: !desc });
  return (await run(q.limit(limit))).map(camel);
}

export async function get(table, id) {
  return camel(await run(sb().from(table).select('*').eq('id', id).maybeSingle()));
}

export async function insert(table, row) {
  return camel(await run(sb().from(table).insert(toRow(row)).select().single()));
}

export async function update(table, id, patch) {
  const { id: _, ...rest } = patch;
  return camel(await run(sb().from(table).update(toRow(rest)).eq('id', id).select().single()));
}

export async function remove(table, id) {
  return run(sb().from(table).delete().eq('id', id));
}

// ---------- Sesión y equipo ----------

/** Para usar la clínica hay que entrar con correo y clave (mismo equipo en el computador y el celular). */
export async function session() {
  const { data } = await sb().auth.getSession();
  const u = data.session?.user;
  if (!u || u.is_anonymous || !u.email) return { needsLogin: true };
  return { user: { id: u.id, email: u.email } };
}

export async function myClinics(userId) {
  const data = await run(sb().from('clinic_members').select('role, is_admin, name, clinic:clinics(*)').eq('user_id', userId));
  return data.filter((m) => m.clinic).map((m) => ({ ...camel(m.clinic), role: m.role, isAdmin: m.is_admin, memberName: m.name }));
}

export async function members(clinicId) {
  return (await run(sb().from('clinic_members').select('*').eq('clinic_id', clinicId).order('created_at'))).map(camel);
}

export async function removeMember(clinicId, userId) {
  return run(sb().from('clinic_members').delete().eq('clinic_id', clinicId).eq('user_id', userId));
}

export async function saveClinic({ id, name, address, phone, homeVisits, onlyHome = false, logo, lat = null, lng = null, onMap, emergencies, hours = '', travelMinutes = 30 }) {
  return run(sb().from('clinics').update({
    name, address, phone, home_visits: Boolean(homeVisits), only_home: Boolean(onlyHome), ...(logo !== undefined ? { logo } : {}), lat, lng, on_map: Boolean(onMap), emergencies: Boolean(emergencies), hours,
    travel_minutes: travelMinutes,
  }).eq('id', id));
}

export async function createClinic({ name, address, phone, memberName, role }) {
  return run(sb().rpc('create_clinic', { p_name: name, p_address: address, p_phone: phone, p_member_name: memberName, p_role: role }));
}

// RUT, documentos y versión de los términos aceptados (la fecha la pone la base).
export async function saveReview(clinicId, { rut, docs, termsVersion }) {
  return run(sb().from('clinics').update({ rut, docs, terms_version: termsVersion }).eq('id', clinicId));
}

export async function joinClinic(code, memberName) {
  return run(sb().rpc('join_clinic', { p_code: code, p_member_name: memberName }));
}

export async function createInvite(clinicId, role, admin = false) {
  return run(sb().rpc('create_clinic_invite', { p_clinic: clinicId, p_role: role, p_admin: admin }));
}

export async function setClinicAdmin(clinicId, userId, admin) {
  return run(sb().rpc('set_clinic_admin', { p_clinic: clinicId, p_user: userId, p_admin: admin }));
}

export async function approveClinic(clinicId, ok = true) {
  return run(sb().rpc('admin_approve_clinic', { p_clinic: clinicId, p_ok: ok }));
}

export async function deleteClinic(clinicId) {
  return run(sb().rpc('admin_delete_clinic', { p_clinic: clinicId }));
}

// Todas las clínicas con su equipo (solo lo ve el administrador de Kiltrazo).
export async function allClinics() {
  const rows = await run(sb().from('clinics').select('*, members:clinic_members(*)').order('name'));
  return rows.map((c) => ({ ...camel(c), members: (c.members || []).map(camel) }));
}

// ---------- Punto Kiltrazo (sin clínica) ----------

export const kiltrazoPoint = () => run(sb().rpc('kiltrazo_point'));
export const setPointUser = (userId, on) => run(sb().rpc('admin_set_point', { p_user: userId, p_on: on }));
/** Punto de reconocimiento facial: crea la ficha y el enlace para el dueño. Devuelve { id, code }. */
export const pointRegister = (clinicId, p) => run(sb().rpc('point_register', {
  p_clinic: clinicId, p_name: p.name, p_species: p.species, p_photo: p.photo, p_scan: p.scan, p_tutor_name: p.tutorName, p_tutor_phone: p.tutorPhone,
}));

// ---------- Mascotas de Kiltrazo ----------

export async function linkPet(clinicId, code) {
  return run(sb().rpc('link_pet', { p_clinic: clinicId, p_code: code }));
}

export async function createPetCode(petId) {
  return run(sb().rpc('create_pet_code', { p_pet: petId }));
}

export async function petHealth(petId) {
  const r = await run(sb().rpc('pet_health', { p_pet: petId }));
  return { clinics: r.clinics.map(camel), vaccines: r.vaccines.map(camel), appointments: r.appointments.map(camel) };
}

export async function removePatient(patientId) {
  return run(sb().rpc('remove_clinic_patient', { p_patient: patientId }));
}

export async function unlinkPet(petId, clinicId) {
  return run(sb().rpc('unlink_pet', { p_pet: petId, p_clinic: clinicId }));
}

export async function runReminders() {
  await run(sb().rpc('send_appointment_reminders')).catch((err) => console.warn('Avisos de horas', err));
  return run(sb().rpc('send_vaccine_reminders'));
}

export async function myAppointment(id) {
  const r = await run(sb().rpc('my_appointment', { p_appt: id }));
  return r && camel(r);
}

export async function confirmMyAppointment(id) {
  return run(sb().rpc('confirm_my_appointment', { p_appt: id }));
}

// ---------- Archivos (bucket privado "clinica") ----------

export async function upload(path, blob) {
  const { error } = await sb().storage.from(BUCKET).upload(path, blob, { contentType: blob.type, upsert: false });
  if (error) throw new Error(error.message);
}

/** Enlaces temporales (1 hora) para ver los archivos: { id: url }. */
export async function fileUrls(files) {
  if (!files.length) return {};
  const { data, error } = await sb().storage.from(BUCKET).createSignedUrls(files.map((f) => f.path), 3600);
  if (error) throw new Error(error.message);
  return Object.fromEntries(files.map((f, i) => [f.id, data[i]?.signedUrl || '']));
}

export async function removeObject(path) {
  await sb().storage.from(BUCKET).remove([path]);
}

// ---------- Horas pedidas por el tutor y avisos ----------

export async function requestAppointment({ petId, clinicId, place, service, startsAt, address = '', lat = null, lng = null, notes = '' }) {
  return run(sb().rpc('request_appointment', {
    p_pet: petId, p_clinic: clinicId, p_place: place, p_service: service, p_starts_at: startsAt,
    p_address: address, p_lat: lat, p_lng: lng, p_notes: notes,
  }));
}

export async function alertEmergency(petId, clinicId, notes = '') {
  return run(sb().rpc('alert_emergency', { p_pet: petId, p_clinic: clinicId, p_notes: notes }));
}

export async function cancelMyAppointment(id) {
  return run(sb().rpc('cancel_my_appointment', { p_appt: id }));
}

/** Avisa al tutor: 'confirmada', 'rechazada', 'en_camino' o 'llego'. */
export async function notifyAppointment(id, kind) {
  return run(sb().rpc('appointment_notify', { p_appt: id, p_kind: kind }));
}

// ---------- Traspaso de una mascota de la clínica a la app del tutor ----------

export async function createTransferCode(patientId) {
  return run(sb().rpc('create_transfer_code', { p_patient: patientId }));
}

export async function transferInfo(code) {
  return camel(await run(sb().rpc('transfer_info', { p_code: code })));
}

/** Crea la mascota del tutor con el escaneo que hizo la clínica. */
export async function acceptTransfer(code) {
  return run(sb().rpc('accept_transfer', { p_code: code }));
}

export async function claimTransfer(code, petId) {
  return run(sb().rpc('claim_transfer', { p_code: code, p_pet: petId }));
}

// ---------- Mapa de clínicas (urgencias) ----------

// ---------- Página propia de la clínica (también para quien no tiene la app) ----------

export async function publicClinic(slug) {
  const r = await run(sb().rpc('public_clinic', { p_slug: slug }));
  return r ? camel(r) : null;
}

// Necesita la sesión (anónima) de la app: la página llama antes a currentUser().
export async function guestRequestAppointment({ clinicId, tutor, pet, place, service, startsAt, address = '', notes = '' }) {
  return run(sb().rpc('guest_request_appointment', {
    p_clinic: clinicId, p_tutor: tutor, p_pet: pet, p_place: place, p_service: service, p_starts_at: startsAt, p_address: address, p_notes: notes,
  }));
}

export async function nearbyClinics(lat = null, lng = null, km = 50) {
  return (await run(sb().rpc('nearby_clinics', { p_lat: lat, p_lng: lng, p_km: km }))).map(camel);
}

// ---------- Días de trabajo y horas libres ----------

export async function saveSpecialties(clinicId, userId, specialties) {
  return run(sb().rpc('save_specialties', { p_clinic: clinicId, p_user: userId || null, p_specialties: specialties }));
}

export async function saveSchedule(clinicId, userId, schedule) {
  return run(sb().rpc('save_schedule', { p_clinic: clinicId, p_user: userId, p_schedule: schedule }));
}

/** Días que el equipo trabaja en otras clínicas: [{ userId, dow, fromHm, toHm, clinic }]. */
export async function busyElsewhere(clinicId) {
  return (await run(sb().rpc('busy_elsewhere', { p_clinic: clinicId }))).map(camel);
}

/** { configured, days: [{ day, times }] } */
export async function availableSlots(clinicId, place, days = 14) {
  return run(sb().rpc('available_slots', { p_clinic: clinicId, p_place: place, p_days: days }));
}

// ---------- Publicidad del buscador (la maneja el administrador general) ----------

export async function listBanners() {
  return (await run(sb().from('landing_banners').select('*').order('sort').order('created_at'))).map(camel);
}

export async function saveBanner(b) {
  const row = { title: b.title || '', link: b.link || '', active: Boolean(b.active), sort: Number(b.sort) || 0,
    starts_on: b.startsOn || null, ends_on: b.endsOn || null, ...(b.image ? { image: b.image } : {}) };
  return b.id ? run(sb().from('landing_banners').update(row).eq('id', b.id)) : run(sb().from('landing_banners').insert(row));
}

export async function deleteBanner(id) {
  return run(sb().from('landing_banners').delete().eq('id', id));
}

export function bannerClick(id) {
  return sb().rpc('banner_click', { p_id: id }).then(() => {}, () => {});
}

// ---------- Kiltrazo Municipal ----------

export async function createMunicipality({ name, comuna, address, phone, memberName, role, lat, lng }) {
  return run(sb().rpc('create_municipality', {
    p_name: name, p_comuna: comuna, p_address: address, p_phone: phone, p_member_name: memberName, p_role: role, p_lat: lat, p_lng: lng,
  }));
}

export async function saveMuni({ id, name, comuna, address, phone, logo, lat, lng, areaKm }) {
  return run(sb().from('clinics').update({
    name, comuna, address, phone, ...(logo !== undefined ? { logo } : {}), lat, lng, area_km: areaKm,
  }).eq('id', id));
}

/** Operativo para el vecino: datos y cupos libres por horario ({ at, left }). */
export async function publicDrive(id) {
  const r = await run(sb().rpc('public_drive', { p_id: id }));
  return r ? camel(r) : null;
}

// Necesita la sesión (anónima) de la app: la página llama antes a currentUser().
export async function bookDrive({ driveId, at, tutor = {}, pet = {}, petId = null }) {
  return run(sb().rpc('book_drive', { p_drive: driveId, p_at: at, p_tutor: tutor, p_pet: pet, p_pet_id: petId }));
}

/** Próximos operativos de la comuna del tutor (la que eligió en su perfil). */
export async function comunaDrives() {
  return (await run(sb().rpc('comuna_drives'))) || [];
}

/** A cuántos tutores de la comuna se avisó el operativo: { sentCount, sentAt } o null. */
export async function driveNotice(driveId) {
  return camel(await run(sb().from('drive_notices').select('*').eq('id', driveId).maybeSingle()));
}

/** { lost, found } en el radio de la comuna, o { pending } / { noArea }. */
export async function muniBoard(clinicId) {
  const r = camel(await run(sb().rpc('muni_board', { p_clinic: clinicId })));
  for (const k of ['matches', 'lost', 'found']) if (r[k]) r[k] = r[k].map(camel);
  return r;
}

/** Solo el administrador de Kiltrazo: { clinicId: { patients, filmed, drives, bookings } }. */
export async function muniStats() {
  return run(sb().rpc('muni_stats'));
}
