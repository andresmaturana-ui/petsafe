// Datos de Kiltrazo Clínica. Igual que src/data.js: Supabase si está
// configurado, si no este navegador. La lógica común va aquí.

import { CLOUD } from '../config.js';
import * as remote from './data-remote.js';
import * as local from './data-local.js';

const B = CLOUD ? remote : local;

export const {
  session, myClinics, visitClinic, members, removeMember, saveClinic, createClinic, joinClinic, createInvite, setClinicAdmin, allClinics, deleteClinic, approveClinic,
  linkPet, createPetCode, petHealth, unlinkPet, runReminders, fileUrls,
  requestAppointment, alertEmergency, cancelMyAppointment, myAppointment, confirmMyAppointment, notifyAppointment, createTransferCode, transferInfo, claimTransfer, acceptTransfer,
  saveReview, nearbyClinics, listBanners, saveBanner, deleteBanner, bannerClick, saveSpecialties, saveSchedule, busyElsewhere, availableSlots, publicClinic, guestRequestAppointment,
  createMunicipality, saveMuni, publicDrive, bookDrive, muniBoard, muniStats, comunaDrives, driveNotice,
  kiltrazoPoint, setPointUser, pointRegister,
} = B;

/** ¿Es una municipalidad (Kiltrazo Municipal) y no una clínica? */
export const isMuni = (c) => c?.kind === 'municipio';
/** ¿Es el Punto Kiltrazo (punto de reconocimiento facial sin clínica)? */
export const isPoint = (c) => c?.kind === 'kiltrazo';

// ---------- Clínica activa (por si alguien trabaja en dos) ----------

const KEY = 'kiltrazo-clinica';
export function activeClinicId() {
  try { return localStorage.getItem(KEY) || ''; } catch { return ''; }
}
export function setActiveClinic(id) {
  try { localStorage.setItem(KEY, id); } catch { /* sin almacenamiento */ }
}

// ---------- El administrador de Kiltrazo dentro de una clínica ----------

// Solo en esta pestaña: al cerrarla vuelve a ser él mismo.
const VISIT = 'kiltrazo-visita';
export function visitingId() {
  try { return sessionStorage.getItem(VISIT) || ''; } catch { return ''; }
}
export function setVisiting(id) {
  try { id ? sessionStorage.setItem(VISIT, id) : sessionStorage.removeItem(VISIT); } catch { /* sin almacenamiento */ }
}

// ---------- Pacientes ----------

export const listPatients = (clinicId) => B.list('clinic_patients', { clinicId }, { order: 'name' });
export const getPatient = (id) => B.get('clinic_patients', id);
export const savePatient = ({ id, ...p }) => (id ? B.update('clinic_patients', id, p) : B.insert('clinic_patients', p));
// Quitar de la lista de la clínica (no borra la mascota de Kiltrazo) y devolverlo.
export const removePatient = (id) => B.removePatient(id);
export const restorePatient = (id) => B.update('clinic_patients', id, { removedAt: null });

// ---------- Consultas ----------

export const listVisits = (patientId) => B.list('clinic_visits', { patientId }, { order: 'visitedAt', desc: true });
export const saveVisit = ({ id, ...v }) => (id ? B.update('clinic_visits', id, v) : B.insert('clinic_visits', v));

// ---------- Vacunas ----------

export const listVaccines = (patientId) => B.list('clinic_vaccines', { patientId }, { order: 'appliedOn', desc: true });
export const saveVaccine = ({ id, ...v }) => (id ? B.update('clinic_vaccines', id, v) : B.insert('clinic_vaccines', v));
export const deleteVaccine = (id) => B.remove('clinic_vaccines', id);

/** Solo la dosis más reciente de cada vacuna cuenta para la próxima. */
export function currentDoses(vaccines) {
  const seen = new Map();
  for (const v of [...vaccines].sort((a, b) => b.appliedOn.localeCompare(a.appliedOn))) {
    const k = `${v.patientId}|${v.name.toLowerCase()}`;
    if (!seen.has(k)) seen.set(k, v);
  }
  return [...seen.values()];
}

/** Próximas dosis de la clínica: vencidas hace hasta 60 días o que vencen en los próximos `days`. */
export async function dueVaccines(clinicId, days = 30) {
  const all = await B.list('clinic_vaccines', { clinicId });
  const from = addDays(today(), -60);
  const to = addDays(today(), days);
  return currentDoses(all).filter((v) => v.nextDue && v.nextDue >= from && v.nextDue <= to)
    .sort((a, b) => a.nextDue.localeCompare(b.nextDue));
}

// ---------- Exámenes y documentos ----------

export const listFiles = (patientId) => B.list('clinic_files', { patientId }, { order: 'createdAt', desc: true });

/** Sube una foto (achicada a 2000 px) o un PDF a la ficha del paciente. */
export async function uploadFile(clinicId, patientId, file, { visitId = null, name = '' } = {}) {
  const blob = file.type.startsWith('image/') ? await shrink(file) : file;
  if (blob.size > 10 * 1024 * 1024) throw new Error('El archivo pesa más de 10 MB.');
  const safe = (file.name || 'archivo').normalize('NFD').replace(/[^\w.-]+/g, '-').slice(-60);
  const path = `${clinicId}/${patientId}/${Date.now().toString(36)}-${safe}`;
  await B.upload(path, blob);
  return B.insert('clinic_files', {
    clinicId, patientId, visitId, path, name: name || file.name || 'Archivo', mime: blob.type, size: blob.size,
    uploadedFrom: matchMedia('(pointer: coarse)').matches ? 'celular' : 'computador',
  });
}

export async function deleteFile(f) {
  await B.removeObject(f.path);
  await B.remove('clinic_files', f.id);
}

// ---------- Revisión de Kiltrazo (RUT, título, patente) ----------

/** Sube un documento para que Kiltrazo revise la clínica. Va a la carpeta "revision". */
export async function uploadReviewDoc(clinicId, file, kind) {
  const blob = file.type.startsWith('image/') ? await shrink(file) : file;
  if (blob.size > 10 * 1024 * 1024) throw new Error('El archivo pesa más de 10 MB.');
  const safe = (file.name || kind).normalize('NFD').replace(/[^\w.-]+/g, '-').slice(-60);
  const path = `${clinicId}/revision/${kind}-${Date.now().toString(36)}-${safe}`;
  await B.upload(path, blob);
  return { kind, path, name: file.name || kind, mime: blob.type, at: new Date().toISOString() };
}

async function shrink(file, max = 2000) {
  try {
    const img = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    img.close?.();
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
    canvas.width = canvas.height = 0; // libera memoria en iPhone
    return blob || file;
  } catch {
    return file;
  }
}

// ---------- Agenda ----------

/** Horas de un día (YYYY-MM-DD, hora local). */
export function listAppointments(clinicId, day) {
  const start = new Date(`${day}T00:00:00`);
  const end = new Date(start.getTime() + 86400000);
  return B.list('clinic_appointments', { clinicId }, { gte: { startsAt: start.toISOString() }, lt: { startsAt: end.toISOString() }, order: 'startsAt' });
}
export const saveAppointment = ({ id, ...a }) => (id ? B.update('clinic_appointments', id, a) : B.insert('clinic_appointments', a));

/** Horas que pidieron los tutores y la clínica aún no confirma. */
export const pendingRequests = (clinicId) => B.list('clinic_appointments', { clinicId, status: 'solicitada' }, { order: 'startsAt' });

/** Visitas a domicilio desde `day` por `days` días que aún no terminan. */
export async function upcomingHomeVisits(clinicId, day, days = 7) {
  const start = new Date(`${day}T00:00:00`);
  const end = new Date(start.getTime() + days * 86400000);
  const rows = await B.list('clinic_appointments', { clinicId, place: 'domicilio' }, { gte: { startsAt: start.toISOString() }, lt: { startsAt: end.toISOString() }, order: 'startsAt' });
  return rows.filter((a) => ['agendada', 'en_camino', 'en_atencion'].includes(a.status));
}

/** Enlaces para llegar al domicilio en Google Maps y Waze. */
export function directions(a) {
  const dest = a.lat != null && a.lng != null ? `${a.lat},${a.lng}` : a.address;
  if (!dest) return null;
  const q = encodeURIComponent(dest);
  return {
    google: `https://www.google.com/maps/dir/?api=1&destination=${q}`,
    waze: a.lat != null && a.lng != null ? `https://waze.com/ul?ll=${q}&navigate=yes` : `https://waze.com/ul?q=${q}&navigate=yes`,
  };
}

// ---------- Operativos (Kiltrazo Municipal) ----------

export const listDrives = (clinicId) => B.list('clinic_drives', { clinicId }, { order: 'day' });
export const getDrive = (id) => B.get('clinic_drives', id);
export const saveDrive = ({ id, ...d }) => (id ? B.update('clinic_drives', id, d) : B.insert('clinic_drives', d));
export const deleteDrive = (id) => B.remove('clinic_drives', id);
/** Todas las reservas de operativos de la municipalidad. */
export const muniBookings = (clinicId) => B.list('clinic_appointments', { clinicId, service: 'operativo' });
/** Reservas de un operativo (horas de la agenda), por horario. */
export const driveBookings = (driveId) => B.list('clinic_appointments', { driveId }, { order: 'startsAt' });

/** Cuántos cupos tiene en total: horarios × animales por horario. */
export function driveCapacity(d) {
  const mins = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
  return Math.max(0, Math.floor((mins(d.ends) - mins(d.starts)) / d.slotMinutes)) * d.perSlot;
}

// ---------- Fechas ----------

export const today = () => localDay(new Date());
export function localDay(d) {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
export function addDays(day, n) {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  return localDay(d);
}
