// "#/estudio": Punto de estudio de ganado. Sirve para probar si el
// reconocimiento facial funciona con vacas y caballos: por cada animal se anota
// su autocrotal, especie y sexo, y se graba un video de la cara (10 s) y otro
// del morro (5 s). Los videos quedan en el servidor, en una carpeta por
// autocrotal, y el administrador los descarga desde Admin → Estudio.
// No usa el detector de cabezas (está entrenado con perros y gatos).

import { studyAccess, studySave, studyJoin, isAdmin, CLOUD } from '../data.js';
import { esc, toast } from '../ui.js';
import { SITE_URL } from '../config.js';

const PARTS = {
  cara: { secs: 10, title: 'Filma la cara', how: 'De frente, a 1 o 2 metros. Mueve el celular despacio un poco a cada lado, sin perder la cara.' },
  morro: { secs: 5, title: 'Filma el morro', how: 'De cerca (unos 20 a 30 cm), de frente al morro, que se vean bien los pliegues. Si está sucio o mojado, límpialo antes.' },
};
const SPECIES = [['bovino', '🐄 Bovino'], ['caballo', '🐴 Caballo']];
const SEXES = [['hembra', 'Hembra'], ['macho', 'Macho']];
const DONE_KEY = 'kiltrazo-estudio-hoy';

// Lo filmado hoy en este celular, para no repetir y para el segundo día.
function doneToday() {
  try {
    const d = JSON.parse(localStorage.getItem(DONE_KEY) || '{}');
    return d.day === new Date().toDateString() ? d.tags : [];
  } catch {
    return [];
  }
}
function markDone(tag) {
  try {
    const tags = [...new Set([...doneToday(), tag])];
    localStorage.setItem(DONE_KEY, JSON.stringify({ day: new Date().toDateString(), tags }));
  } catch { /* sin almacenamiento: solo se pierde la lista */ }
}

// Formato que el celular sabe grabar (iPhone graba mp4; Android, webm o mp4).
function recorderType() {
  if (typeof MediaRecorder === 'undefined') return null;
  return ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
}
const extOf = (type) => (/mp4/.test(type) ? 'mp4' : /quicktime/.test(type) ? 'mov' : 'webm');

// No hace falta instalar la app: el punto funciona en el navegador. (La app
// instalada abre en la portada y en iPhone no comparte el código con Safari,
// así que instalarla solo complicaría a quien filma.)
const setup = `
  <ol>
    <li>Abre el enlace <strong>${SITE_URL.replace(/^https?:\/\//, '')}/#/estudio</strong> en el celular: en iPhone con <strong>Safari</strong>, en Android con <strong>Chrome</strong>. No hay que instalar nada.</li>
    <li>Escribe tu código y toca <strong>Entrar</strong>. El celular lo recuerda.</li>
    <li>La primera vez que grabes, el celular pide permiso para usar la cámara: toca <strong>Permitir</strong>.</li>
    <li>Si el enlace se abre dentro de WhatsApp y no deja grabar, toca ⋯ o ⋮ y elige <strong>Abrir en Safari</strong> o <strong>Abrir en Chrome</strong>.</li>
    <li>Para volver otro día, abre el mismo enlace.</li>
  </ol>`;
const manual = '<a class="btn secondary" href="manuales/Manual-Punto-de-estudio.pdf" target="_blank" rel="noopener" download>📘 Descargar el manual (PDF)</a>';

const howTo = `
  <details class="card study-how" id="study-how">
    <summary><strong>¿Cómo se usa?</strong></summary>
    <details class="study-setup"><summary>Antes de empezar</summary>${setup}</details>
    <ol>
      <li>Escribe el número del <strong>autocrotal</strong> del animal y marca si es bovino o caballo, y hembra o macho.</li>
      <li>Graba la <strong>cara</strong>: toca "Grabar", el video se corta solo a los 10 segundos.</li>
      <li>Graba el <strong>morro</strong> de cerca: se corta solo a los 5 segundos.</li>
      <li>Si un video salió mal, toca "Repetir". Si quedó bien, "Guardar". Se sube solo al servidor.</li>
      <li>Toca "Siguiente animal" y repite.</li>
    </ol>
    <p><strong>Consejos:</strong> filma con luz de día, sin contraluz, y con el animal tranquilo (en la manga o amarrado). Limpia el lente del celular.</p>
    <p><strong>Importante:</strong> otro día, idealmente a otra hora, se filman de nuevo los <strong>mismos animales</strong> con su mismo autocrotal. Así se mide si Kiltrazo los reconoce.</p>
    <p class="small muted">Se necesita internet para guardar. Cada video pesa unos pocos MB, así que conviene usar wifi si hay.</p>
    ${manual}
  </details>`;

export default async function studyPoint(el) {
  const admin = CLOUD ? await isAdmin().catch(() => false) : sessionStorage.getItem('petsafe-admin') === 'ok';
  if (!admin && !(await studyAccess().catch(() => false))) return enter(el, () => studyPoint(el));
  const exit = admin ? '<a href="#/admin" class="btn small ghost">Volver a Admin</a>' : '';
  let animal = { tag: '', species: 'bovino', sex: 'hembra' };
  let stream = null;
  const stop = () => {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  };
  // Al salir de la pantalla se apaga la cámara.
  const leave = () => {
    stop();
    window.removeEventListener('hashchange', leave);
  };
  window.addEventListener('hashchange', leave);

  const steps = (n) => `
    <ol class="study-steps">
      ${['Datos', 'Cara', 'Morro'].map((t, i) => `<li class="${i + 1 === n ? 'on' : i + 1 < n ? 'done' : ''}"><b>${i + 1 < n ? '✓' : i + 1}</b>${t}</li>`).join('')}
    </ol>`;
  const head = `<div class="study-head"><h1>🐄 Punto de estudio</h1>${exit}</div>`;

  function data() {
    stop();
    const done = doneToday();
    el.innerHTML = `
      ${head}
      ${howTo}
      ${steps(1)}
      <form class="card form" id="study-form">
        <label>Número del autocrotal<input name="tag" required maxlength="30" autocomplete="off" inputmode="numeric" placeholder="Ej.: 0012345678" value="${esc(animal.tag)}"></label>
        <p class="small muted">Es el número del arete (DIIO). Escríbelo igual los dos días. Si no tiene, usa su nombre o un número que no se repita.</p>
        <div class="chips" role="radiogroup" aria-label="Especie">
          ${SPECIES.map(([v, t]) => `<label class="spec-chip"><input type="radio" name="species" value="${v}" ${animal.species === v ? 'checked' : ''}><span>${t}</span></label>`).join('')}
        </div>
        <div class="chips" role="radiogroup" aria-label="Sexo">
          ${SEXES.map(([v, t]) => `<label class="spec-chip"><input type="radio" name="sex" value="${v}" ${animal.sex === v ? 'checked' : ''}><span>${t}</span></label>`).join('')}
        </div>
        <button class="btn primary big">Filmar la cara</button>
      </form>
      ${done.length ? `<div class="card"><h2>Filmados hoy en este celular (${done.length})</h2><p class="study-done">${done.map(esc).join(' · ')}</p></div>` : ''}`;
    el.querySelector('#study-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const tag = String(f.get('tag')).trim().replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-|-$/g, '');
      if (!tag) return toast('Escribe el número del autocrotal', 'bad');
      animal = { tag, species: f.get('species'), sex: f.get('sex') };
      if (doneToday().includes(tag)) toast(`El ${tag} ya se filmó hoy. Se guardará otra vez.`, 'ok');
      record('cara');
    });
  }

  async function record(part) {
    const { secs, title, how } = PARTS[part];
    const type = recorderType();
    el.innerHTML = `
      ${head}
      ${steps(part === 'cara' ? 2 : 3)}
      <div class="card">
        <h2>${title} · ${esc(animal.tag)}</h2>
        <p>${how}</p>
        <div class="study-cam"><video playsinline muted autoplay></video><span class="study-count" hidden></span></div>
        <p class="study-msg small muted"></p>
        <div class="study-actions">
          <button class="btn primary big" id="rec" ${type === null ? 'hidden' : ''}>⏺ Grabar ${secs} segundos</button>
        </div>
        <label class="link small study-file">o elige un video ya grabado<input type="file" accept="video/*" hidden></label>
        ${part === 'morro' ? '<button type="button" class="link small" id="skip">No se puede filmar el morro: saltar</button>' : '<button type="button" class="link small" id="back">← Cambiar los datos</button>'}
      </div>`;
    const video = el.querySelector('video');
    const msg = el.querySelector('.study-msg');
    const count = el.querySelector('.study-count');
    const recBtn = el.querySelector('#rec');
    el.querySelector('#back')?.addEventListener('click', data);
    el.querySelector('#skip')?.addEventListener('click', finish);
    el.querySelector('.study-file input').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) review(part, file, extOf(file.type || file.name));
    });
    if (type === null) {
      msg.textContent = 'Este celular no puede grabar desde aquí. Graba el video con la cámara y elígelo abajo.';
      return;
    }
    try {
      stream ??= await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      video.srcObject = stream;
    } catch {
      recBtn.hidden = true;
      msg.textContent = 'No pudimos abrir la cámara. Revisa el permiso de cámara, o graba con la cámara del celular y elige el video abajo.';
      return;
    }
    recBtn.addEventListener('click', () => {
      recBtn.disabled = true;
      const rec = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), videoBitsPerSecond: 4_000_000 });
      const chunks = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: rec.mimeType || type || 'video/mp4' });
        review(part, blob, extOf(blob.type));
      };
      rec.start(1000);
      let left = secs;
      count.hidden = false;
      count.textContent = left;
      recBtn.textContent = '⏺ Grabando…';
      const tick = setInterval(() => {
        left -= 1;
        count.textContent = left;
        if (left <= 0) {
          clearInterval(tick);
          rec.stop();
        }
      }, 1000);
    });
  }

  function review(part, blob, ext) {
    const url = URL.createObjectURL(blob);
    el.innerHTML = `
      ${head}
      ${steps(part === 'cara' ? 2 : 3)}
      <div class="card">
        <h2>¿Quedó bien? · ${esc(animal.tag)}</h2>
        <p class="small muted">Revisa que se vea ${part === 'cara' ? 'la cara completa' : 'el morro de cerca'}, nítido y con luz.</p>
        <div class="study-cam"><video src="${url}" playsinline controls autoplay muted loop></video></div>
        <div class="study-actions">
          <button class="btn primary big" id="save">✓ Guardar</button>
          <button class="btn ghost" id="redo">Repetir</button>
        </div>
      </div>`;
    const done = () => URL.revokeObjectURL(url);
    el.querySelector('#redo').addEventListener('click', () => (done(), record(part)));
    el.querySelector('#save').addEventListener('click', async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      b.textContent = 'Subiendo…';
      try {
        await studySave({ ...animal, part, blob, ext });
        done();
        if (part === 'cara') record('morro');
        else finish();
      } catch (err) {
        toast(`No se pudo guardar: ${err.message}. Revisa la conexión y vuelve a intentar.`, 'bad');
        b.disabled = false;
        b.textContent = '✓ Guardar';
      }
    });
  }

  function finish() {
    stop();
    markDone(animal.tag);
    el.innerHTML = `
      ${head}
      <div class="card study-ok">
        <p class="study-big">✅</p>
        <h2>${esc(animal.tag)} guardado</h2>
        <p>${SPECIES.find(([v]) => v === animal.species)[1]} · ${SEXES.find(([v]) => v === animal.sex)[1]}</p>
        <button class="btn primary big" id="next">Siguiente animal</button>
      </div>`;
    el.querySelector('#next').addEventListener('click', () => {
      animal = { ...animal, tag: '' };
      data();
    });
  }

  data();
}

// Sin código todavía: el invitado escribe el que le dio el administrador.
function enter(el, done) {
  el.innerHTML = `
    <div class="study-head"><h1>🐄 Punto de estudio</h1></div>
    <form class="card form" id="study-code">
      <p>Escribe el código que te dio el administrador de Kiltrazo. No necesitas crear cuenta.</p>
      <label>Código<input name="code" required maxlength="12" autocomplete="off" autocapitalize="characters" placeholder="Ej.: K7P2QX"></label>
      <button class="btn primary big">Entrar</button>
    </form>
    <details class="card study-how">
      <summary><strong>¿Cómo se usa?</strong></summary>
      <details class="study-setup"><summary>Antes de empezar</summary>${setup}</details>
      <p>Después de entrar, por cada animal escribes su autocrotal, grabas su cara (10 segundos) y su morro (5 segundos). El manual tiene todos los pasos.</p>
      ${manual}
    </details>`;
  el.querySelector('#study-code').addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = e.target.querySelector('button');
    b.disabled = true;
    try {
      const n = await studyJoin(new FormData(e.target).get('code'));
      toast(`Entraste como Invitado ${n} 🐄`, 'ok');
      done();
    } catch (err) {
      toast(err.message, 'bad');
      b.disabled = false;
    }
  });
}
