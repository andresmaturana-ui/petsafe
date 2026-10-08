// Piezas de interfaz de Kiltrazo Clínica.

import { esc } from '../ui.js';
import { SPECIES } from '../breeds.js';

export const SERVICES = { consulta: 'Consulta', control: 'Control', vacuna: 'Vacuna', cirugia: 'Cirugía', peluqueria: 'Peluquería', otro: 'Otro', urgencia: '🚨 Urgencia', operativo: '🏛️ Operativo' };
export const STATUS = {
  solicitada: 'Pedida por el tutor', en_camino: 'En camino',
  agendada: 'Agendada', en_sala: 'En sala', en_atencion: 'En atención', atendida: 'Atendida', no_vino: 'No vino', cancelada: 'Cancelada',
};
export const ROLES = { vet: 'Veterinario/a', recepcion: 'Recepción', punto: 'Punto de reconocimiento facial' };
/** En una municipalidad, "recepción" es el funcionario o funcionaria municipal. */
export const roleName = (role, clinic) => (clinic?.kind === 'municipio' && role === 'recepcion' ? 'Funcionario/a' : ROLES[role] || '');

// ---------- Kiltrazo Municipal ----------

/** Estado del animal en la ficha, con su color. */
export const PET_STATUS = {
  con_responsable: ['Con responsable', 'green'],
  comunitario: ['Comunitario', 'sun'],
  extraviado: ['Extraviado', 'red'],
  encontrado: ['Encontrado', 'sun'],
  en_recuperacion: ['En recuperación', 'sun'],
  en_adopcion: ['En adopción', 'green'],
  fallecido: ['Fallecido', ''],
};
export const statusTag = (s) => (PET_STATUS[s] ? `<span class="ck-tag ${PET_STATUS[s][1]}">${PET_STATUS[s][0]}</span>` : '');

/** Qué se hace en un operativo. */
export const DRIVE_SERVICES = {
  esterilizacion: '✂️ Esterilización',
  chip: '🔖 Microchip',
  antirrabica: '💉 Vacuna antirrábica',
  desparasitacion: '💊 Desparasitación',
  cara: '📷 Registro de su cara en Kiltrazo',
};

/** El microchip (ISO 11784) tiene 15 números. Vacío también vale. */
export const chipOk = (chip) => !chip || /^\d{15}$/.test(String(chip).replace(/\s/g, ''));
export const KINDS = { vacuna: 'Vacuna', desparasitacion_interna: 'Desparasitación interna', desparasitacion_externa: 'Desparasitación externa' };

/** 2026-10-13 → 13-10-2026 */
export const fmtDate = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('-') : '');
export const fmtTime = (iso) => new Date(iso).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false });
export const fmtDay = (day) =>
  new Date(`${day}T12:00:00`).toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' });
export const num = (n, dec = 1) => (n == null || n === '' ? '' : Number(n).toLocaleString('es-CL', { maximumFractionDigits: dec }));

export function age(birth) {
  if (!birth) return '';
  const b = new Date(`${birth}T12:00:00`);
  const n = new Date();
  let months = (n.getFullYear() - b.getFullYear()) * 12 + n.getMonth() - b.getMonth() - (n.getDate() < b.getDate() ? 1 : 0);
  if (months < 0) return '';
  if (months < 12) return `${months} ${months === 1 ? 'mes' : 'meses'}`;
  const y = Math.floor(months / 12);
  months %= 12;
  return `${y} ${y === 1 ? 'año' : 'años'}${months ? ` ${months} ${months === 1 ? 'mes' : 'meses'}` : ''}`;
}

export const speciesLine = (p) => [SPECIES[p.species], p.breed].filter(Boolean).join(' · ');
export const sexLine = (p) => (p.sex ? `${p.sex === 'macho' ? 'Macho' : 'Hembra'}${p.neutered ? (p.sex === 'macho' ? ' castrado' : ' esterilizada') : ''}` : '');

export function avatar(p, size = '') {
  return p.photo
    ? `<img class="ck-avatar ${size}" src="${esc(p.photo)}" alt="">`
    : `<span class="ck-avatar ${size}" aria-hidden="true">${esc((p.name || '?')[0].toUpperCase())}</span>`;
}

/** Estado de una próxima dosis: vencida, pronto (≤ 14 días) o al día. */
export function dueTone(nextDue, today) {
  if (!nextDue) return '';
  if (nextDue < today) return 'red';
  const days = (new Date(`${nextDue}T12:00:00`) - new Date(`${today}T12:00:00`)) / 86400000;
  return days <= 14 ? 'sun' : 'green';
}

export function dueLabel(nextDue, today) {
  const days = Math.round((new Date(`${nextDue}T12:00:00`) - new Date(`${today}T12:00:00`)) / 86400000);
  if (days < 0) return `vencida hace ${-days} ${days === -1 ? 'día' : 'días'}`;
  if (days === 0) return 'vence hoy';
  return `vence en ${days} ${days === 1 ? 'día' : 'días'}`;
}

/** Teléfono para WhatsApp: solo dígitos, con 56 si es un celular chileno sin código. */
export function waLink(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.length === 9 && d.startsWith('9')) d = '56' + d;
  return d ? `https://wa.me/${d}` : '';
}

/** Curva simple (peso, temperatura…) en SVG, con la escala en el eje izquierdo. */
export function lineChart(points, { unit = '', height = 120 } = {}) {
  const pts = points.filter((p) => p.value != null && p.value !== '').map((p) => ({ ...p, value: Number(p.value) }));
  if (pts.length < 2) {
    return `<p class="muted small">${pts.length ? `Un registro: ${num(pts[0].value)} ${unit}. Con dos o más se dibuja la curva.` : 'Aún no hay registros.'}</p>`;
  }
  const W = 300, H = height, L = 42, R = 10, T = 10, B = 20;
  const vals = pts.map((p) => p.value);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = Math.max((hi - lo) * 0.15, hi * 0.02, 0.1);
  lo -= pad; hi += pad;
  const t0 = new Date(pts[0].date).getTime(), t1 = new Date(pts[pts.length - 1].date).getTime();
  const x = (d) => L + ((new Date(d).getTime() - t0) / Math.max(t1 - t0, 1)) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const line = pts.map((p) => `${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const ticks = [lo + (hi - lo) * 0.15, (lo + hi) / 2, hi - (hi - lo) * 0.15];
  const last = pts[pts.length - 1];
  const label = (d) => new Date(d).toLocaleDateString('es-CL', { month: 'short', year: '2-digit' });
  return `<svg class="ck-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Curva de ${num(pts[0].value)} a ${num(last.value)} ${unit}">
    ${ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${L - 6}" y="${y(t) + 3}" text-anchor="end">${num(t)}</text>`).join('')}
    <polygon points="${x(pts[0].date)},${H - B} ${line} ${x(last.date)},${H - B}" class="area"/>
    <polyline points="${line}" class="line"/>
    <circle cx="${x(last.date)}" cy="${y(last.value)}" r="4.5" class="dot"/>
    <text x="${L}" y="${H - 4}">${label(pts[0].date)}</text>
    <text x="${W - R}" y="${H - 4}" text-anchor="end">${label(last.date)}</text>
  </svg>`;
}
