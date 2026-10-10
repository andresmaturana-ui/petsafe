// Documento de la clínica (…/#/doc/<enlace>): consentimiento, receta o
// certificado. Lo abre el tutor desde el aviso de su app o el WhatsApp, sin
// necesitar cuenta. Si es un consentimiento por firmar, firma aquí con el dedo.
// "Descargar PDF" usa la impresión del navegador (Guardar como PDF).

import { esc, toast } from '../ui.js';
import { documentByToken, signDocument } from '../clinic/data.js';
import { speciesLine, sexLine, age, fmtDate, KINDS } from '../clinic/ui.js';
import { signaturePad } from '../signature.js';
import { setPage } from '../seo.js';

const when = (iso) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' })} a las ${d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
};

const vaccineTable = (list) => `
  <table class="doc-table">
    <thead><tr><th>Vacuna o tratamiento</th><th>Fecha</th><th>Próxima dosis</th><th>Lote</th></tr></thead>
    <tbody>${list.map((v) => `<tr><td>${esc(v.name)}<small>${KINDS[v.kind] || ''}</small></td><td>${fmtDate(v.appliedOn)}</td><td>${fmtDate(v.nextDue) || '—'}</td><td>${esc(v.batch || '')}</td></tr>`).join('')}</tbody>
  </table>`;

function content(d) {
  const data = d.data || {};
  if (d.kind === 'receta') {
    return `
      <ol class="doc-rx">${(data.items || []).map((i) => `
        <li><b>${esc(i.med)}</b><span>${[i.dose, i.every && `cada ${i.every}`, i.days && `por ${i.days}`].filter(Boolean).map(esc).join(' · ')}</span></li>`).join('')}</ol>
      ${data.notes ? `<h3>Indicaciones</h3><p class="doc-text">${esc(data.notes)}</p>` : ''}`;
  }
  return `
    ${d.body ? `<p class="doc-text">${esc(d.body)}</p>` : ''}
    ${d.kind === 'certificado_vacunas' ? '<p class="doc-text">Certifico que el paciente recibió las siguientes vacunas y tratamientos en esta clínica:</p>' : ''}
    ${d.kind.startsWith('certificado') && data.vaccines?.length ? vaccineTable(data.vaccines) : ''}`;
}

export default async function doc(el, { token }, { user } = {}) {
  const d = await documentByToken(token);
  if (!d) {
    el.innerHTML = '<div class="card doc-missing"><h2>No encontramos este documento</h2><p>Revisa que el enlace esté completo o pide uno nuevo a tu veterinaria.</p></div>';
    return;
  }
  const { clinic: c, patient: p } = d;
  setPage({ title: `${d.title} · ${p.name}` });
  const isVetDoc = !d.kind.startsWith('consentimiento');

  el.innerHTML = `
    <div class="doc-page">
      <div class="doc-bar no-print">
        ${user ? '<a href="#/" class="link">← Volver a Kiltrazo</a>' : '<img src="brand/kiltrazo.svg" alt="Kiltrazo" class="doc-brand">'}
        ${d.status !== 'por_firmar' ? '<button class="btn small secondary" id="doc-pdf">⬇️ Descargar PDF</button>' : ''}
      </div>
      ${d.status === 'anulado' ? '<div class="doc-void">Este documento fue anulado por la clínica.</div>' : ''}
      <article class="doc-sheet">
        <header class="doc-head">
          ${c.logo ? `<img src="${esc(c.logo)}" alt="" class="doc-logo">` : ''}
          <div>
            <b>${esc(c.name)}</b>
            <small>${[c.address, c.phone, c.rut && `RUT ${c.rut}`].filter(Boolean).map(esc).join(' · ')}</small>
          </div>
        </header>
        <h1>${esc(d.title)}</h1>
        <p class="doc-date">${new Date(d.createdAt).toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
        <dl class="doc-facts">
          <div><dt>Paciente</dt><dd>${esc(p.name)}</dd></div>
          <div><dt>Especie y raza</dt><dd>${esc(speciesLine(p)) || '—'}</dd></div>
          ${p.sex ? `<div><dt>Sexo</dt><dd>${esc(sexLine(p))}</dd></div>` : ''}
          ${p.birthDate ? `<div><dt>Edad</dt><dd>${esc(age(p.birthDate))}</dd></div>` : ''}
          ${p.color ? `<div><dt>Color</dt><dd>${esc(p.color)}</dd></div>` : ''}
          ${p.chip ? `<div><dt>Chip</dt><dd>${esc(p.chip)}</dd></div>` : ''}
          <div><dt>Tutor/a</dt><dd>${esc(p.tutorName || '—')}</dd></div>
          ${p.tutorPhone ? `<div><dt>Teléfono</dt><dd>${esc(p.tutorPhone)}</dd></div>` : ''}
        </dl>
        ${content(d)}
        <div class="doc-signs">
          ${isVetDoc ? `
            <div class="doc-sign">
              ${d.vetSignature ? `<img src="${esc(d.vetSignature)}" alt="Firma del veterinario">` : '<span class="doc-line"></span>'}
              <b>${esc(d.vetName)}</b><small>Médico veterinario${d.data?.vetRut ? ` · RUT ${esc(d.data.vetRut)}` : ''}</small>
            </div>` : ''}
          ${d.status === 'firmado' ? `
            <div class="doc-sign">
              <img src="${esc(d.signature)}" alt="Firma del tutor">
              <b>${esc(d.signerName)}</b><small>${d.signerRut ? `RUT ${esc(d.signerRut)} · ` : ''}Firmado el ${when(d.signedAt)}</small>
            </div>` : ''}
        </div>
        ${!isVetDoc && d.vetName ? `<p class="doc-small">Preparado por ${esc(d.vetName)}, ${esc(c.name)}.</p>` : ''}
        <footer class="doc-foot">Documento emitido con Kiltrazo Clínica · Código ${esc(token.slice(0, 8).toUpperCase())}</footer>
      </article>
      ${d.status === 'por_firmar' ? `
        <form class="card form doc-signform no-print" id="doc-sign">
          <h2>Firma</h2>
          <label>Tu nombre completo<input name="name" required maxlength="120" value="${esc(p.tutorName || '')}" autocomplete="name"></label>
          <label>Tu RUT<input name="rut" maxlength="20" placeholder="12.345.678-9"></label>
          <div id="doc-pad"></div>
          <label class="check"><input type="checkbox" name="ok" required> Leí el documento y estoy de acuerdo</label>
          <button class="btn primary big">Firmar</button>
        </form>` : ''}
      ${d.status === 'vencido' ? '<div class="card no-print"><p>El enlace para firmar venció. Pide uno nuevo a tu veterinaria.</p></div>' : ''}
      ${d.status !== 'por_firmar' ? '<p class="muted small no-print doc-tip">Para guardarlo, toca "Descargar PDF" y elige "Guardar como PDF".</p>' : ''}
    </div>`;

  el.querySelector('#doc-pdf')?.addEventListener('click', () => window.print());

  const form = el.querySelector('#doc-sign');
  if (!form) return;
  const pad = signaturePad(form.querySelector('#doc-pad'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (pad.isEmpty()) return toast('Falta tu firma', 'bad');
    const btn = form.querySelector('button.primary');
    btn.disabled = true;
    btn.textContent = 'Firmando…';
    try {
      await signDocument(token, { name: form.name.value.trim(), rut: form.rut.value.trim(), signature: pad.toDataURL() });
      toast('¡Listo! Quedó firmado', 'ok');
      await doc(el, { token }, { user });
      window.scrollTo(0, 0);
    } catch (err) {
      toast(err.message, 'bad');
      btn.disabled = false;
      btn.textContent = 'Firmar';
    }
  });
}
