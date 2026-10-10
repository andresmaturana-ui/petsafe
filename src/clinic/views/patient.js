// Ficha de un paciente: consulta nueva, historial, vacunas, exámenes,
// documentos (consentimientos, recetas y certificados) y curvas de peso y
// signos vitales.

import { esc, toast, go } from '../../ui.js';
import { createTransferCode } from '../data.js';
import {
  getPatient, savePatient, listVisits, saveVisit, listVaccines, saveVaccine, deleteVaccine, currentDoses, listFiles, uploadFile,
  deleteFile, fileUrls, listAppointments, saveAppointment, today, localDay, isMuni, listDocuments, createDocument, voidDocument,
} from '../data.js';
import { avatar, speciesLine, sexLine, age, fmtDate, num, dueTone, dueLabel, waLink, lineChart, KINDS, statusTag } from '../ui.js';
import { TEMPLATES, VACCINE_NAMES, NEXT_MONTHS } from '../templates.js';
import { rnmCard, bindRnm } from '../rnm.js';
import { DOC_KINDS, fillBody } from '../doc-templates.js';
import { signaturePad } from '../../signature.js';

const TABS = { consulta: 'Consulta', historial: 'Historial', vacunas: 'Vacunas', examenes: 'Exámenes', documentos: 'Documentos', signos: 'Peso y signos' };

let poll = null;

export default async function patient(el, { id, tab }, ctx) {
  clearInterval(poll);
  const isVet = ctx.me.role === 'vet';
  const muni = isMuni(ctx.clinic);
  const tabs = muni ? Object.fromEntries(Object.entries(TABS).filter(([k]) => k !== 'documentos')) : TABS;
  tab = tabs[tab] ? tab : isVet ? 'consulta' : 'historial';
  const [p, visits, vaccines, files] = await Promise.all([getPatient(id), listVisits(id), listVaccines(id), listFiles(id)]);
  if (!p) {
    el.innerHTML = '<div class="card"><p>No encontramos este paciente.</p><a class="btn primary" href="#/clinica/pacientes">Ver pacientes</a></div>';
    return;
  }
  const t = today();
  const doses = currentDoses(vaccines).filter((v) => v.nextDue).sort((a, b) => a.nextDue.localeCompare(b.nextDue));
  const nextDose = doses[0];
  const lastWeight = visits.find((v) => v.weight != null);
  const wa = waLink(p.tutorPhone);

  el.innerHTML = `
    <div class="ck-patient">
      <div class="card ck-pat">
        ${avatar(p, 'big')}
        <div class="ck-pat-main">
          <h1>${esc(p.name)}</h1>
          <div class="ck-facts">
            ${[esc(speciesLine(p)), esc(sexLine(p)), esc(age(p.birthDate)), lastWeight ? `<b>${num(lastWeight.weight)} kg</b>` : '',
              p.chip ? `Chip <b class="ck-mono">${esc(p.chip)}</b>` : ''].filter(Boolean).map((x) => `<span>${x}</span>`).join('')}
          </div>
          <div class="ck-tags">
            ${muni ? statusTag(p.status || 'con_responsable') : ''}
            ${p.allergies ? `<span class="ck-tag red">Alergia: ${esc(p.allergies)}</span>` : ''}
            ${nextDose ? `<span class="ck-tag ${dueTone(nextDose.nextDue, t)}">${esc(nextDose.name)} ${dueLabel(nextDose.nextDue, t)}</span>` : ''}
            ${p.petId ? '<span class="ck-tag green">Vinculada a Kiltrazo</span>' : ''}
          </div>
        </div>
        <div class="ck-tutor">
          <strong>${esc(p.tutorName || (muni ? 'Sin responsable' : 'Sin tutor'))}</strong>
          <span>${muni ? 'Responsable' : 'Tutor/a'}</span>
          ${p.tutorPhone ? `<span class="ck-mono">${esc(p.tutorPhone)}</span>` : ''}
          <span class="ck-tutor-btns">
            ${wa ? `<a class="btn small whatsapp" href="${wa}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
            <a class="btn small ghost" href="#/clinica/paciente/${p.id}/editar">Editar ficha</a>
          </span>
        </div>
      </div>

      <nav class="ck-tabs">${Object.entries(tabs).map(([k, label]) => `
        <a href="#/clinica/paciente/${p.id}/${k}" class="${k === tab ? 'on' : ''}">${label}${k === 'historial' && visits.length ? ` <small>${visits.length}</small>` : ''}${k === 'examenes' && files.length ? ` <small>${files.length}</small>` : ''}</a>`).join('')}
      </nav>

      <div class="ck-pgrid">
        <div class="ck-pcol" id="ck-tab"></div>
        <aside class="ck-pside">
          ${muni ? rnmCard(p) : ''}
          <div class="card">
            <h3>Peso</h3>
            ${lineChart([...visits].reverse().map((v) => ({ date: v.visitedAt, value: v.weight })), { unit: 'kg' })}
          </div>
          <div class="card">
            <h3>Vacunas y desparasitación</h3>
            ${doses.length ? doses.map((v) => `
              <div class="ck-vrow">
                <span>${esc(v.name)}<small>puesta ${fmtDate(v.appliedOn)}</small></span>
                <span class="ck-tag ${dueTone(v.nextDue, t)}">${fmtDate(v.nextDue)}</span>
              </div>`).join('') : '<p class="muted small">Sin registros.</p>'}
            ${p.tutorUser ? '<p class="muted small">El tutor recibe un aviso en su app Kiltrazo 7 días antes.</p>' : ''}
          </div>
          ${!p.petId ? `<div class="card ck-transfer">
            <h3>${muni ? 'Entregar en la app del responsable' : 'Pasar a la app del tutor'}</h3>
            <p class="small muted">${muni ? `Al entregarlo o darlo en adopción, el nuevo responsable recibe a ${esc(p.name)} en su Kiltrazo con sus datos y sus vacunas. Si se pierde, Kiltrazo lo reconoce por su cara.` : `El tutor recibe a ${esc(p.name)} en su Kiltrazo con sus datos, y desde ahí ve sus vacunas y pide horas.`}</p>
            ${p.scan
              ? `<p class="small ck-scan-ok">✓ Cara filmada: ${muni ? 'el responsable' : 'el tutor'} no tendrá que filmarla.${muni ? ' Ya sirve para reconocerlo si se pierde.' : ''} <button class="link small" id="ck-scan">Filmar de nuevo</button></p>`
              : `<p class="small"><b>1.</b> Filma su cara (así ${muni ? 'el responsable' : 'el tutor'} solo toca "Agregar"${muni ? ', y desde ya sirve para reconocerlo si se pierde' : ''}).</p>
                 <button class="btn small ghost" id="ck-scan">📷 Filmar su cara</button>
                 <p class="small"><b>2.</b> Envía el enlace ${muni ? 'al responsable' : 'al tutor'}.</p>`}
            <div id="ck-scanner" hidden></div>
            <button class="btn small secondary" id="ck-transfer">Crear enlace para ${muni ? 'el responsable' : 'el tutor'}</button>
            <div id="ck-transfer-out" hidden></div>
          </div>` : ''}
          ${p.notes ? `<div class="card"><h3>Notas</h3><p class="ck-pre small">${esc(p.notes)}</p></div>` : ''}
        </aside>
      </div>
    </div>`;

  bindRnm(el, p, ctx.refresh);

  // Escaneo de la cara en la clínica (mismo que la app), guardado en la ficha.
  el.querySelector('#ck-scan')?.addEventListener('click', async (e) => {
    e.target.hidden = true;
    const box = el.querySelector('#ck-scanner');
    box.hidden = false;
    const { mountScanner } = await import('../../scanner.js');
    mountScanner(box, {
      mode: 'enroll',
      label: 'Empezar a filmar',
      async onDone(result) {
        try {
          await savePatient({ id: p.id, scan: result.biometric, ...(p.photo ? {} : { photo: result.photo }) });
          toast(`Cara de ${p.name} guardada`, 'ok');
          ctx.refresh();
        } catch (err) {
          toast(err.message, 'bad');
        }
      },
    });
  });

  el.querySelector('#ck-transfer')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const code = await createTransferCode(p.id);
      const url = `${location.origin}${location.pathname}#/recibir/${code}`;
      const msg = muni
        ? `Hola${p.tutorName ? ` ${p.tutorName.split(' ')[0]}` : ''}, te dejamos la ficha de ${p.name} en Kiltrazo, la app gratis donde verás sus vacunas y que lo reconoce por su cara si algún día se pierde: ${url}`
        : `Hola${p.tutorName ? ` ${p.tutorName.split(' ')[0]}` : ''}, te dejamos la ficha de ${p.name} en Kiltrazo, la app gratis donde verás sus vacunas y podrás pedir hora con nosotros: ${url}`;
      const wa = waLink(p.tutorPhone);
      const out = el.querySelector('#ck-transfer-out');
      const QR = (await import('qrcode')).default;
      out.hidden = false;
      out.innerHTML = `
        <img class="ck-transfer-qr" alt="QR para el tutor" src="${await QR.toDataURL(url, { margin: 1, width: 200, color: { dark: '#4a3428' } })}">
        <p class="small">El tutor escanea el QR con su celular, o envíale el enlace. Sirve una vez y dura 7 días.</p>
        <span class="ck-tutor-btns">
          <a class="btn small whatsapp" href="${wa ? `${wa}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`}" target="_blank" rel="noopener">Enviar por WhatsApp</a>
          <button class="btn small ghost" data-copy>Copiar enlace</button>
        </span>`;
      out.querySelector('[data-copy]').addEventListener('click', () => navigator.clipboard?.writeText(url).then(() => toast('Enlace copiado', 'ok')));
      e.target.hidden = true;
    } catch (err) {
      toast(err.message, 'bad');
      e.target.disabled = false;
    }
  });

  const box = el.querySelector('#ck-tab');
  const draw = { consulta: drawVisitForm, historial: drawHistory, vacunas: drawVaccines, examenes: drawFiles, documentos: drawDocuments, signos: drawVitals }[tab];
  await draw(box, { p, visits, vaccines, files, ctx, isVet });
}

// ---------- Consulta nueva ----------

function drawVisitForm(box, { p, ctx, isVet }) {
  if (!isVet) {
    box.innerHTML = '<div class="card"><p>Solo los veterinarios registran consultas. Desde recepción puedes registrar vacunas y subir exámenes.</p></div>';
    return;
  }
  const key = `ck-draft-${p.id}`;
  let draft = {};
  try { draft = JSON.parse(localStorage.getItem(key) || '{}'); } catch { /* nada */ }
  const d = (k) => esc(draft[k] ?? '');
  const pending = [];

  box.innerHTML = `
    <form class="card form ck-visit" id="ck-visit">
      <div class="ck-templates"><span>Plantilla:</span>${Object.entries(TEMPLATES).map(([k, tpl]) => `<button type="button" class="ck-tpl ${draft.template === k ? 'on' : ''}" data-tpl="${k}">${tpl.name}</button>`).join('')}</div>
      <label class="ck-span">Motivo de consulta<input name="reason" value="${d('reason')}" placeholder="Ej.: se rasca las orejas hace una semana"></label>
      <label class="ck-span">Anamnesis<textarea name="anamnesis" rows="4">${d('anamnesis')}</textarea></label>
      <div class="ck-vitals">
        <label>Peso (kg)<input name="weight" inputmode="decimal" value="${d('weight')}"></label>
        <label>Temp. (°C)<input name="temperature" inputmode="decimal" value="${d('temperature')}"></label>
        <label>FC (lpm)<input name="heartRate" inputmode="numeric" value="${d('heartRate')}"></label>
        <label>FR (rpm)<input name="respRate" inputmode="numeric" value="${d('respRate')}"></label>
        <label>Mucosas<input name="mucous" value="${d('mucous')}" placeholder="Rosadas, TLLC < 2 s"></label>
      </div>
      <label class="ck-span">Examen físico<textarea name="exam" rows="5">${d('exam')}</textarea></label>
      <label class="ck-span">Diagnóstico<input name="diagnosis" value="${d('diagnosis')}"></label>
      <label class="ck-span">Tratamiento<textarea name="treatment" rows="3">${d('treatment')}</textarea></label>
      <label class="ck-short">Próximo control<input name="nextControl" type="date" value="${d('nextControl')}"></label>
      <div class="ck-attach">
        <label class="btn small ghost">📎 Adjuntar foto o PDF<input type="file" accept="image/*,application/pdf" multiple hidden id="ck-vfiles"></label>
        <span id="ck-pending" class="ck-pending"></span>
      </div>
      <div class="ck-row-end"><button class="btn primary">Guardar consulta</button></div>
    </form>`;

  const form = box.querySelector('#ck-visit');
  const saveDraft = () => {
    const f = Object.fromEntries(new FormData(form));
    try { localStorage.setItem(key, JSON.stringify({ ...f, template: form.dataset.template || draft.template || '' })); } catch { /* sin espacio */ }
  };
  form.addEventListener('input', saveDraft);

  form.querySelectorAll('[data-tpl]').forEach((b) => b.addEventListener('click', () => {
    const tpl = TEMPLATES[b.dataset.tpl];
    const dirty = (form.anamnesis.value.trim() || form.exam.value.trim()) && !confirm(`¿Reemplazar la anamnesis y el examen con la plantilla "${tpl.name}"?`);
    if (dirty) return;
    form.anamnesis.value = tpl.anamnesis;
    form.exam.value = tpl.exam;
    form.dataset.template = b.dataset.tpl;
    form.querySelectorAll('[data-tpl]').forEach((x) => x.classList.toggle('on', x === b));
    saveDraft();
  }));

  const pendingBox = box.querySelector('#ck-pending');
  const showPending = () => {
    pendingBox.innerHTML = pending.map((f, i) => `<span class="ck-file-chip">${esc(f.name)} <button type="button" data-rm="${i}" aria-label="Quitar">×</button></span>`).join('');
  };
  box.querySelector('#ck-vfiles').addEventListener('change', (e) => {
    pending.push(...e.target.files);
    e.target.value = '';
    showPending();
  });
  pendingBox.addEventListener('click', (e) => {
    if (e.target.dataset.rm == null) return;
    pending.splice(Number(e.target.dataset.rm), 1);
    showPending();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    const btn = form.querySelector('.ck-row-end button');
    btn.disabled = true;
    btn.textContent = 'Guardando…';
    try {
      const visit = await saveVisit({
        clinicId: ctx.clinic.id, patientId: p.id, vetName: ctx.me.name || '', visitedAt: new Date().toISOString(),
        template: form.dataset.template || draft.template || '', reason: f.reason.trim(), anamnesis: f.anamnesis.trim(),
        exam: f.exam.trim(), weight: decimal(f.weight), temperature: decimal(f.temperature), heartRate: int(f.heartRate),
        respRate: int(f.respRate), mucous: f.mucous.trim(), diagnosis: f.diagnosis.trim(), treatment: f.treatment.trim(),
        nextControl: f.nextControl || null,
      });
      for (const file of pending) await uploadFile(ctx.clinic.id, p.id, file, { visitId: visit.id });
      // Si estaba en atención por la agenda, queda atendida.
      const appts = await listAppointments(ctx.clinic.id, today());
      for (const a of appts) if (a.patientId === p.id && a.status === 'en_atencion') await saveAppointment({ id: a.id, status: 'atendida' });
      try { localStorage.removeItem(key); } catch { /* nada */ }
      toast('Consulta guardada', 'ok');
      go(`#/clinica/paciente/${p.id}/historial`);
    } catch (err) {
      toast(err.message, 'bad');
      btn.disabled = false;
      btn.textContent = 'Guardar consulta';
    }
  });
}

const decimal = (s) => (String(s ?? '').trim() === '' ? null : Number(String(s).replace(',', '.'))) ?? null;
const int = (s) => (String(s ?? '').trim() === '' ? null : Math.round(Number(String(s).replace(',', '.'))));

// ---------- Historial ----------

async function drawHistory(box, { visits, files, p, isVet }) {
  const urls = await fileUrls(files.filter((f) => f.visitId));
  box.innerHTML = visits.length ? `<div class="card ck-history">${visits.map((v) => {
    const vitals = [v.weight != null && `${num(v.weight)} kg`, v.temperature != null && `${num(v.temperature)} °C`,
      v.heartRate != null && `${v.heartRate} lpm`, v.respRate != null && `${v.respRate} rpm`, v.mucous].filter(Boolean);
    const vf = files.filter((f) => f.visitId === v.id);
    return `
      <details class="ck-visit-row">
        <summary>
          <span class="ck-date">${fmtDate(localDay(new Date(v.visitedAt)))}</span>
          <span><strong>${esc(v.diagnosis || v.reason || 'Consulta')}</strong>
          <small>${esc([v.reason && v.diagnosis ? v.reason : '', v.vetName].filter(Boolean).join(' · '))}</small></span>
        </summary>
        <div class="ck-visit-body">
          ${vitals.length ? `<p class="ck-vitals-line">${vitals.map(esc).join(' · ')}</p>` : ''}
          ${v.anamnesis ? `<h4>Anamnesis</h4><p class="ck-pre">${esc(v.anamnesis)}</p>` : ''}
          ${v.exam ? `<h4>Examen físico</h4><p class="ck-pre">${esc(v.exam)}</p>` : ''}
          ${v.treatment ? `<h4>Tratamiento</h4><p class="ck-pre">${esc(v.treatment)}</p>` : ''}
          ${v.nextControl ? `<p><strong>Próximo control:</strong> ${fmtDate(v.nextControl)}</p>` : ''}
          ${vf.length ? `<p>${vf.map((f) => `<a class="ck-file-chip" href="${urls[f.id]}" target="_blank" rel="noopener">${esc(f.name)}</a>`).join('')}</p>` : ''}
        </div>
      </details>`;
  }).join('')}</div>`
    : `<div class="card"><p class="ck-empty">Aún no hay consultas.${isVet ? ` <a href="#/clinica/paciente/${p.id}/consulta">Registrar la primera</a>.` : ''}</p></div>`;
  box.querySelector('details')?.setAttribute('open', '');
}

// ---------- Vacunas ----------

function drawVaccines(box, { p, vaccines, ctx }) {
  const t = today();
  const current = new Set(currentDoses(vaccines).map((v) => v.id));
  box.innerHTML = `
    <form class="card form ck-form-grid" id="ck-vac">
      <h2 class="ck-span">Registrar dosis</h2>
      <label>Tipo<select name="kind">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      <label>Nombre<input name="name" list="ck-vnames" required maxlength="80" autocomplete="off"></label>
      <datalist id="ck-vnames"></datalist>
      <label>Puesta el<input name="appliedOn" type="date" required value="${t}"></label>
      <label>Próxima dosis<input name="nextDue" type="date"></label>
      <label class="ck-span2">Lote<input name="batch"></label>
      <div class="ck-row-end ck-span2"><button class="btn primary small">Guardar dosis</button></div>
    </form>
    <div class="card ck-list">
      ${vaccines.length ? `<div class="ck-table-wrap"><table class="ck-table">
        <thead><tr><th>Dosis</th><th>Puesta</th><th>Próxima</th><th>Lote</th><th></th></tr></thead>
        <tbody>${vaccines.map((v) => `
          <tr class="${current.has(v.id) ? '' : 'old'}">
            <td><strong>${esc(v.name)}</strong><small>${KINDS[v.kind]}${v.vetName ? ` · ${esc(v.vetName)}` : ''}</small></td>
            <td class="ck-mono">${fmtDate(v.appliedOn)}</td>
            <td>${v.nextDue ? (current.has(v.id) ? `<span class="ck-tag ${dueTone(v.nextDue, t)}">${fmtDate(v.nextDue)}</span>` : `<span class="ck-mono muted">${fmtDate(v.nextDue)}</span>`) : '—'}</td>
            <td class="ck-mono">${esc(v.batch || '')}</td>
            <td><button class="link danger small" data-delvac="${v.id}">Borrar</button></td>
          </tr>`).join('')}</tbody></table></div>` : '<p class="ck-empty">Sin vacunas registradas.</p>'}
    </div>`;

  const form = box.querySelector('#ck-vac');
  const suggest = () => {
    box.querySelector('#ck-vnames').innerHTML = VACCINE_NAMES[form.kind.value].map((n) => `<option value="${n}"></option>`).join('');
    const d = new Date(`${form.appliedOn.value || t}T12:00:00`);
    d.setMonth(d.getMonth() + NEXT_MONTHS[form.kind.value]);
    form.nextDue.value = localDay(d);
  };
  suggest();
  form.kind.addEventListener('change', suggest);
  form.appliedOn.addEventListener('change', suggest);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    try {
      await saveVaccine({
        clinicId: ctx.clinic.id, patientId: p.id, kind: f.kind, name: f.name.trim(), appliedOn: f.appliedOn,
        nextDue: f.nextDue || null, batch: f.batch.trim(), vetName: ctx.me.name || '',
      });
      toast('Dosis guardada', 'ok');
      ctx.refresh();
    } catch (err) {
      toast(err.message, 'bad');
    }
  });
  box.querySelectorAll('[data-delvac]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('¿Borrar esta dosis?')) return;
    await deleteVaccine(b.dataset.delvac);
    ctx.refresh();
  }));
}

// ---------- Exámenes ----------

async function drawFiles(box, { p, files, ctx }) {
  const urls = await fileUrls(files);
  box.innerHTML = `
    <form class="card form ck-upload" id="ck-up">
      <label>Nombre del examen<input name="name" placeholder="Ej.: Radiografía de cadera, Hemograma"></label>
      <div class="ck-upload-btns">
        <label class="btn primary">📷 Tomar foto<input type="file" accept="image/*" capture="environment" hidden data-file></label>
        <label class="btn secondary">Subir foto o PDF<input type="file" accept="image/*,application/pdf" multiple hidden data-file></label>
      </div>
      <p class="muted small">Desde el celular puedes fotografiar una radiografía o un informe, y aparece al tiro en el computador.</p>
    </form>
    <div class="ck-files">
      ${files.length ? files.map((f) => `
        <div class="ck-file">
          <a href="${urls[f.id]}" target="_blank" rel="noopener" class="ck-thumb">
            ${f.mime.startsWith('image/') ? `<img src="${urls[f.id]}" alt="" loading="lazy">` : '<span>PDF</span>'}
          </a>
          <strong>${esc(f.name)}</strong>
          <small>${fmtDate(localDay(new Date(f.createdAt)))}${f.uploadedFrom ? ` · desde el ${esc(f.uploadedFrom)}` : ''}</small>
          <button class="link danger small" data-delfile="${f.id}">Borrar</button>
        </div>`).join('') : '<div class="card"><p class="ck-empty">Aún no hay exámenes.</p></div>'}
    </div>`;

  const form = box.querySelector('#ck-up');
  form.querySelectorAll('[data-file]').forEach((input) => input.addEventListener('change', async () => {
    const list = [...input.files];
    if (!list.length) return;
    const label = form.name.value.trim();
    toast(`Subiendo ${list.length === 1 ? 'archivo' : `${list.length} archivos`}…`);
    try {
      for (const [i, file] of list.entries()) {
        await uploadFile(ctx.clinic.id, p.id, file, { name: label ? (list.length > 1 ? `${label} (${i + 1})` : label) : '' });
      }
      toast('Listo', 'ok');
      ctx.refresh();
    } catch (err) {
      toast(err.message, 'bad');
    }
  }));
  box.querySelectorAll('[data-delfile]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('¿Borrar este archivo?')) return;
    await deleteFile(files.find((f) => f.id === b.dataset.delfile));
    ctx.refresh();
  }));

  // Lo que se sube desde otro dispositivo aparece solo.
  const hash = location.hash;
  poll = setInterval(async () => {
    if (location.hash !== hash) return clearInterval(poll);
    if (document.hidden) return;
    const now = await listFiles(p.id).catch(() => files);
    if (now.length !== files.length) ctx.refresh();
  }, 15000);
}

// ---------- Documentos ----------

const DOC_STATUS = { por_firmar: ['Por firmar', 'sun'], firmado: ['Firmado', 'green'], listo: ['Listo', 'green'], anulado: ['Anulado', ''], vencido: ['Enlace vencido', 'red'] };
const docStatus = (d) => (d.status === 'por_firmar' && d.createdAt < new Date(Date.now() - 7 * 86400000).toISOString() ? 'vencido' : d.status);
const docUrl = (d) => `${location.origin}${location.pathname}#/doc/${d.token}`;

function docMessage(d, p, clinic) {
  const hi = `Hola${p.tutorName ? ` ${p.tutorName.split(' ')[0]}` : ''}`;
  return d.status === 'por_firmar'
    ? `${hi}, ${clinic.name} te pide firmar el ${d.title.toLowerCase()} de ${p.name}. Léelo y fírmalo con el dedo aquí: ${docUrl(d)}`
    : `${hi}, te dejamos ${d.kind === 'receta' ? 'la receta' : `el ${d.title.toLowerCase()}`} de ${p.name}: ${docUrl(d)}`;
}

async function drawDocuments(box, { p, vaccines, ctx, isVet }, fresh = null) {
  const docs = await listDocuments(p.id);
  const kinds = Object.entries(DOC_KINDS);
  const kindBtn = ([k, d]) => `<button type="button" class="ck-doc-kind" data-kind="${k}"${d.vet && !isVet ? ' disabled title="Solo un veterinario"' : ''}><span>${d.icon}</span>${d.name}</button>`;

  box.innerHTML = `
    <div class="card ck-docs-new">
      <h2>Nuevo documento</h2>
      <p class="muted small">Elige uno y se llena solo con los datos de ${esc(p.name)} y su tutor.</p>
      <h4>Consentimientos <small>los firma el tutor con el dedo</small></h4>
      <div class="ck-doc-kinds">${kinds.filter(([, d]) => d.sign).map(kindBtn).join('')}</div>
      <h4>Recetas y certificados <small>${isVet ? 'con tu firma' : 'solo un veterinario'}</small></h4>
      <div class="ck-doc-kinds">${kinds.filter(([, d]) => d.vet).map(kindBtn).join('')}</div>
      <form class="form ck-doc-form" id="ck-doc-form" hidden></form>
    </div>
    ${fresh ? sendBox(fresh, p, ctx) : ''}
    <div class="card ck-list">
      <h3>Documentos de ${esc(p.name)}</h3>
      ${docs.length ? docs.map((d) => {
        const st = docStatus(d);
        const [label, tone] = DOC_STATUS[st];
        return `
          <div class="ck-doc-row ${st === 'anulado' ? 'old' : ''}">
            <span class="ck-doc-icon">${DOC_KINDS[d.kind]?.icon || '📄'}</span>
            <span class="ck-doc-main"><strong>${esc(d.title)}</strong>
              <small>${fmtDate(localDay(new Date(d.createdAt)))}${d.vetName ? ` · ${esc(d.vetName)}` : ''}${d.signerName ? ` · firmó ${esc(d.signerName)}` : ''}</small></span>
            <span class="ck-tag ${tone}">${label}</span>
            <span class="ck-doc-acts">
              <a class="btn small ghost" href="#/doc/${d.token}" target="_blank" rel="noopener">${st === 'por_firmar' ? 'Ver o firmar aquí' : 'Ver e imprimir'}</a>
              ${['por_firmar', 'firmado', 'listo'].includes(st) ? `<button class="btn small whatsapp" data-wa="${d.id}">WhatsApp</button>` : ''}
              ${st !== 'anulado' ? `<button class="link danger small" data-void="${d.id}">Anular</button>` : ''}
            </span>
          </div>`;
      }).join('') : '<p class="ck-empty">Aún no hay documentos.</p>'}
    </div>`;

  const form = box.querySelector('#ck-doc-form');
  box.querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', () => {
    box.querySelectorAll('[data-kind]').forEach((x) => x.classList.toggle('on', x === b));
    docForm(form, b.dataset.kind, { p, vaccines, ctx, redraw: (d) => drawDocuments(box, { p, vaccines, ctx, isVet }, d) });
    form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }));

  const sendWa = (d) => {
    const wa = waLink(p.tutorPhone);
    const text = encodeURIComponent(docMessage(d, p, ctx.clinic));
    window.open(wa ? `${wa}?text=${text}` : `https://wa.me/?text=${text}`, '_blank', 'noopener');
  };
  box.querySelectorAll('[data-wa]').forEach((b) => b.addEventListener('click', () => sendWa(docs.find((d) => d.id === b.dataset.wa))));
  box.querySelector('[data-wa-new]')?.addEventListener('click', () => sendWa(fresh));
  box.querySelector('[data-copy-new]')?.addEventListener('click', () => navigator.clipboard?.writeText(docUrl(fresh)).then(() => toast('Enlace copiado', 'ok')));
  box.querySelectorAll('[data-void]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('¿Anular este documento? Sigue guardado, pero marcado como anulado. Si había un error, crea uno nuevo.')) return;
    try {
      await voidDocument(b.dataset.void);
      drawDocuments(box, { p, vaccines, ctx, isVet });
    } catch (err) {
      toast(err.message, 'bad');
    }
  }));
}

function sendBox(d, p, ctx) {
  const sign = d.status === 'por_firmar';
  return `
    <div class="card ck-doc-sent">
      <h3>✓ ${esc(d.title)} creado</h3>
      <p>${sign ? `Ahora falta la firma de ${esc(p.tutorName || 'su tutor')}. Si está aquí, que firme en este equipo; si no, envíale el enlace.` : `Envíaselo a ${esc(p.tutorName || 'su tutor')} o imprímelo.`}</p>
      ${p.tutorUser ? `<p class="small ck-scan-ok">✓ Le llegó un aviso en su app Kiltrazo.</p>` : ''}
      <span class="ck-tutor-btns">
        <a class="btn small ${sign ? 'primary' : 'secondary'}" href="#/doc/${d.token}" target="_blank" rel="noopener">${sign ? '✍️ Firmar en este equipo' : 'Ver e imprimir'}</a>
        <button class="btn small whatsapp" data-wa-new>Enviar por WhatsApp</button>
        <button class="btn small ghost" data-copy-new>Copiar enlace</button>
      </span>
      ${sign ? '<p class="muted small">El enlace para firmar dura 7 días.</p>' : ''}
    </div>`;
}

const SIGN_KEY = (ctx) => `ck-firma-${ctx.me.userId || ctx.me.name}`;

function docForm(form, kind, { p, vaccines, ctx, redraw }) {
  const k = DOC_KINDS[kind];
  const doses = [...vaccines].sort((a, b) => b.appliedOn.localeCompare(a.appliedOn));
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(SIGN_KEY(ctx)) || '{}'); } catch { /* nada */ }
  const field = ([key, label, opt, req]) => (Array.isArray(opt)
    ? `<label>${label}<select name="f_${key}"${req ? ' required' : ''}><option value="">Elige…</option>${opt.map((o) => `<option>${o}</option>`).join('')}</select></label>`
    : `<label>${label}<input name="f_${key}" placeholder="${esc(opt)}"${req ? ' required' : ''} maxlength="200"></label>`);
  const item = () => `
    <div class="ck-rx-item">
      <input name="med" placeholder="Medicamento y concentración" maxlength="120">
      <input name="dose" placeholder="Dosis (ej.: 1 comprimido)" maxlength="80">
      <input name="every" placeholder="Cada (ej.: 12 horas)" maxlength="60">
      <input name="days" placeholder="Por (ej.: 7 días)" maxlength="60">
    </div>`;
  const vacTable = doses.length
    ? `<div class="ck-table-wrap"><table class="ck-table"><thead><tr><th>Dosis</th><th>Puesta</th><th>Próxima</th></tr></thead><tbody>${doses.map((v) => `
        <tr><td><strong>${esc(v.name)}</strong><small>${KINDS[v.kind]}</small></td><td class="ck-mono">${fmtDate(v.appliedOn)}</td><td class="ck-mono">${fmtDate(v.nextDue) || '—'}</td></tr>`).join('')}</tbody></table></div>`
    : '';

  form.hidden = false;
  form.innerHTML = `
    <h3>${k.icon} ${k.name}</h3>
    <label>Título<input name="title" value="${esc(k.title)}" required maxlength="120"></label>
    ${k.fields ? `<div class="ck-doc-fields">${k.fields.map(field).join('')}</div>` : ''}
    ${k.body ? `<label>Texto <small class="muted">puedes cambiarlo antes de crearlo</small><textarea name="body" rows="${k.sign ? 12 : 4}" maxlength="8000"></textarea></label>` : ''}
    ${kind === 'receta' ? `
      <div class="ck-rx"><b>Medicamentos</b>
        <div class="ck-rx-item ck-rx-head"><span>Medicamento</span><span>Dosis</span><span>Cada</span><span>Por</span></div><div id="ck-rx-items">${item()}</div>
        <button type="button" class="link small" id="ck-rx-add">+ Agregar otro medicamento</button></div>
      <label>Indicaciones<textarea name="notes" rows="3" maxlength="2000" placeholder="Ej.: dar con comida. Control en 10 días."></textarea></label>` : ''}
    ${kind === 'certificado_vacunas' || kind === 'certificado_salud' ? `
      <div><b>${kind === 'certificado_salud' ? 'Vacunas que se incluyen' : 'Dosis que se certifican'}</b>
      ${vacTable || `<p class="muted small">${esc(p.name)} no tiene vacunas registradas. ${kind === 'certificado_vacunas' ? 'Regístralas primero en la pestaña Vacunas.' : ''}</p>`}</div>` : ''}
    ${k.vet ? `
      <div class="ck-doc-vet">
        <label>Tu nombre<input name="vetName" value="${esc(ctx.me.name || '')}" required maxlength="120"></label>
        <label>Tu RUT (opcional)<input name="vetRut" value="${esc(saved.rut || '')}" maxlength="20" placeholder="12.345.678-9"></label>
        <div class="ck-span"><b>Tu firma</b> <small class="muted">queda guardada en este equipo para la próxima</small><div id="ck-vet-sign"></div></div>
      </div>` : ''}
    <div class="ck-row-end">
      <button type="button" class="btn ghost small" id="ck-doc-cancel">Cancelar</button>
      <button class="btn primary"${kind === 'certificado_vacunas' && !doses.length ? ' disabled' : ''}>${k.sign ? 'Crear y pedir firma' : 'Crear documento'}</button>
    </div>`;

  // El texto se arma con los datos; si la persona lo cambia a mano, se respeta.
  const body = form.body;
  let touched = false;
  const values = () => Object.fromEntries((k.fields || []).map(([key]) => [key, form[`f_${key}`].value.trim()]));
  const refill = () => { if (body && !touched) body.value = fillBody(kind, { p, clinic: ctx.clinic, values: values() }); };
  refill();
  body?.addEventListener('input', () => { touched = true; });
  form.querySelectorAll('[name^="f_"]').forEach((i) => i.addEventListener('input', refill));
  form.querySelectorAll('select[name^="f_"]').forEach((i) => i.addEventListener('change', refill));

  form.querySelector('#ck-rx-add')?.addEventListener('click', () => {
    form.querySelector('#ck-rx-items').insertAdjacentHTML('beforeend', item());
    form.querySelector('#ck-rx-items').lastElementChild.querySelector('input').focus();
  });
  const pad = k.vet ? signaturePad(form.querySelector('#ck-vet-sign'), { initial: saved.signature || '' }) : null;
  form.querySelector('#ck-doc-cancel').addEventListener('click', () => {
    form.hidden = true;
    form.closest('.card').querySelectorAll('[data-kind]').forEach((x) => x.classList.remove('on'));
  });

  form.onsubmit = async (e) => {
    e.preventDefault();
    if (body && /\{\w+\}/.test(body.value)) return toast('Completa los datos que faltan en el texto', 'bad');
    if (pad?.isEmpty()) return toast('Falta tu firma', 'bad');
    const data = {};
    if (k.fields) Object.assign(data, values());
    if (kind === 'receta') {
      data.items = [...form.querySelectorAll('#ck-rx-items .ck-rx-item')].map((r) => Object.fromEntries([...r.querySelectorAll('input')].map((i) => [i.name, i.value.trim()])))
        .filter((i) => i.med);
      if (!data.items.length) return toast('Escribe al menos un medicamento', 'bad');
      data.notes = form.notes.value.trim();
    }
    if (kind.startsWith('certificado')) data.vaccines = doses.map((v) => ({ kind: v.kind, name: v.name, appliedOn: v.appliedOn, nextDue: v.nextDue, batch: v.batch || '' }));
    let vetSignature = null;
    if (k.vet) {
      vetSignature = pad.toDataURL();
      data.vetRut = form.vetRut.value.trim();
      try { localStorage.setItem(SIGN_KEY(ctx), JSON.stringify({ rut: data.vetRut, signature: vetSignature })); } catch { /* sin espacio */ }
    }
    const btn = form.querySelector('.ck-row-end .primary');
    btn.disabled = true;
    try {
      const d = await createDocument({
        clinicId: ctx.clinic.id, patientId: p.id, kind, title: form.title.value.trim(), body: body ? body.value.trim() : '', data,
        vetName: k.vet ? form.vetName.value.trim() : ctx.me.name || '', vetSignature,
      });
      toast('Documento creado', 'ok');
      redraw(d);
    } catch (err) {
      toast(err.message, 'bad');
      btn.disabled = false;
    }
  };
}

// ---------- Peso y signos ----------

function drawVitals(box, { visits }) {
  const asc = [...visits].reverse();
  const rows = visits.filter((v) => v.weight != null || v.temperature != null || v.heartRate != null || v.respRate != null);
  box.innerHTML = `
    <div class="ck-cols-2">
      <div class="card"><h3>Peso (kg)</h3>${lineChart(asc.map((v) => ({ date: v.visitedAt, value: v.weight })), { unit: 'kg', height: 150 })}</div>
      <div class="card"><h3>Temperatura (°C)</h3>${lineChart(asc.map((v) => ({ date: v.visitedAt, value: v.temperature })), { unit: '°C', height: 150 })}</div>
    </div>
    <div class="card ck-list">
      ${rows.length ? `<div class="ck-table-wrap"><table class="ck-table">
        <thead><tr><th>Fecha</th><th>Peso</th><th>Temp.</th><th>FC</th><th>FR</th><th>Mucosas</th></tr></thead>
        <tbody>${rows.map((v) => `<tr>
          <td class="ck-mono">${fmtDate(localDay(new Date(v.visitedAt)))}</td><td>${v.weight != null ? `${num(v.weight)} kg` : ''}</td>
          <td>${v.temperature != null ? `${num(v.temperature)} °C` : ''}</td><td>${v.heartRate ?? ''}</td><td>${v.respRate ?? ''}</td><td>${esc(v.mucous || '')}</td>
        </tr>`).join('')}</tbody></table></div>` : '<p class="ck-empty">Los signos se registran en cada consulta.</p>'}
    </div>`;
}
