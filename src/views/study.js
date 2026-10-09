// "#/estudio": Punto de estudio de ganado. Sirve para probar si el
// reconocimiento facial funciona con vacas y caballos: por cada animal se anota
// su autocrotal, especie y sexo, y se graba un video de la cara (10 s) y otro
// del morro (5 s). Los videos quedan en el servidor, en una carpeta por
// autocrotal, y el administrador los descarga desde Admin → Estudio.
// No usa el detector de cabezas (está entrenado con perros y gatos).

import { studyAccess, studySave, studyJoin, studyNewHorse, studyHorses, isAdmin, CLOUD } from '../data.js';
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
      <li>Marca si es bovino o caballo. Si es bovino, escribe su <strong>autocrotal</strong>. Si es un caballo nuevo, escribe su nombre y Kiltrazo le da un <strong>número de registro</strong>. El segundo día, elígelo en "Ya registrado".</li>
      <li>Marca si es hembra o macho.</li>
      <li>Graba la <strong>cara</strong>: toca "Grabar", el video se corta solo a los 10 segundos.</li>
      <li>Graba el <strong>morro</strong> de cerca: se corta solo a los 5 segundos.</li>
      <li>Si un video salió mal, toca "Repetir". Si quedó bien, "Guardar". Se sube solo al servidor.</li>
      <li>Toca "Siguiente animal" y repite.</li>
    </ol>
    <p><strong>Consejos:</strong> filma con luz de día, sin contraluz, y con el animal tranquilo (en la manga o amarrado). Limpia el lente del celular.</p>
    <p><strong>Importante:</strong> otro día, idealmente a otra hora, se filman de nuevo los <strong>mismos animales</strong> con su mismo autocrotal (o, si es caballo, eligiéndolo en "Ya registrado"). Así se mide si Kiltrazo los reconoce.</p>
    <p class="small muted">Se necesita internet para guardar. Cada video pesa unos pocos MB, así que conviene usar wifi si hay.</p>
    ${manual}
  </details>`;

export default async function studyPoint(el) {
  const admin = CLOUD ? await isAdmin().catch(() => false) : sessionStorage.getItem('petsafe-admin') === 'ok';
  if (!admin && !(await studyAccess().catch(() => false))) return enter(el, () => studyPoint(el));
  const exit = admin ? '<a href="#/admin" class="btn small ghost">Volver a Admin</a>' : '';
  let animal = { tag: '', species: 'bovino', sex: 'hembra' };
  const label = () => (animal.name ? `${animal.name} (${animal.tag})` : animal.tag);
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

  // Bovinos: se escribe su autocrotal. Caballos (no usan autocrotal): uno
  // nuevo recibe un número de registro de Kiltrazo que no se repite ni se
  // cambia; el segundo día se elige de la lista de caballos ya registrados.
  async function data() {
    stop();
    const done = doneToday();
    const horses = await studyHorses().catch(() => []);
    const chips = (name, list, value) => list.map(([v, t]) => `<label class="spec-chip"><input type="radio" name="${name}" value="${v}" ${value === v ? 'checked' : ''}><span>${t}</span></label>`).join('');
    el.innerHTML = `
      ${head}
      ${howTo}
      ${steps(1)}
      <form class="card form" id="study-form">
        <div class="chips" role="radiogroup" aria-label="Especie">${chips('species', SPECIES, animal.species)}</div>
        <div data-for="bovino">
          <label>Número del autocrotal<input name="tag" maxlength="30" autocomplete="off" inputmode="numeric" placeholder="Ej.: 0012345678" value="${esc(animal.species === 'bovino' ? animal.tag : '')}"></label>
          <p class="small muted">Es el número del arete (DIIO). Escríbelo igual los dos días.</p>
        </div>
        <div data-for="caballo">
          <div class="chips" role="radiogroup" aria-label="Caballo">${chips('horse', [['nuevo', 'Caballo nuevo'], ['registrado', 'Ya registrado']], horses.length && animal.horse === 'registrado' ? 'registrado' : 'nuevo')}</div>
          <div data-horse="nuevo">
            <label>Nombre del caballo<input name="horseName" maxlength="60" autocomplete="off" placeholder="Ej.: Pirata"></label>
            <p class="small muted">Al seguir, Kiltrazo le da un <strong>número de registro</strong> que no se repite. Con su nombre lo encuentras el segundo día en "Ya registrado".</p>
          </div>
          <div data-horse="registrado">
            ${horses.length ? `<label>Elige el caballo<select name="horseTag">${horses.map((h) => `<option value="${esc(h.tag)}" ${animal.tag === h.tag ? 'selected' : ''}>${esc(h.name)} · ${esc(h.tag)}</option>`).join('')}</select></label>`
              : '<p class="muted">Aún no hay caballos registrados. Elige "Caballo nuevo".</p>'}
          </div>
        </div>
        <div class="chips" role="radiogroup" aria-label="Sexo" data-sexes>${chips('sex', SEXES, animal.sex)}</div>
        <button class="btn primary big">Filmar la cara</button>
      </form>
      ${done.length ? `<div class="card"><h2>Filmados hoy en este celular (${done.length})</h2><p class="study-done">${done.map(esc).join(' · ')}</p></div>` : ''}`;
    const form = el.querySelector('#study-form');
    // Muestra solo lo que corresponde a la especie (y, en caballos, a nuevo o ya registrado).
    const sync = () => {
      const f = new FormData(form);
      const horse = f.get('species') === 'caballo';
      const known = horse && f.get('horse') === 'registrado';
      form.querySelector('[data-for="bovino"]').hidden = horse;
      form.querySelector('[data-for="caballo"]').hidden = !horse;
      form.querySelector('[data-horse="nuevo"]').hidden = known;
      form.querySelector('[data-horse="registrado"]').hidden = !known;
      // El sexo de un caballo ya registrado viene de su registro.
      form.querySelector('[data-sexes]').style.display = known && horses.length > 0 ? 'none' : '';
    };
    form.addEventListener('change', sync);
    sync();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const species = f.get('species');
      let sex = f.get('sex');
      let tag = '';
      let name = '';
      const b = form.querySelector('button.btn');
      if (species === 'bovino') {
        tag = String(f.get('tag')).trim().replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-|-$/g, '');
        if (!tag) return toast('Escribe el número del autocrotal', 'bad');
      } else if (f.get('horse') === 'registrado') {
        const h = horses.find((x) => x.tag === f.get('horseTag'));
        if (!h) return toast('Elige el caballo de la lista', 'bad');
        ({ tag, name, sex } = h);
      } else {
        name = String(f.get('horseName')).trim();
        if (!name) return toast('Escribe el nombre del caballo', 'bad');
        b.disabled = true;
        try {
          tag = await studyNewHorse(name, sex);
          toast(`${name} quedó registrado con el número ${tag}`, 'ok');
        } catch (err) {
          b.disabled = false;
          return toast(err.message, 'bad');
        }
      }
      // Si vuelve a "Cambiar los datos", el caballo ya registrado queda elegido.
      animal = { tag, species, sex, name, horse: 'registrado', choice: f.get('horse') };
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
        <h2>${title} · ${esc(label())}</h2>
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
        <h2>¿Quedó bien? · ${esc(label())}</h2>
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
        <h2>${esc(label())} guardado</h2>
        <p>${SPECIES.find(([v]) => v === animal.species)[1]} · ${SEXES.find(([v]) => v === animal.sex)[1]}</p>
        <button class="btn primary big" id="next">Siguiente animal</button>
      </div>`;
    el.querySelector('#next').addEventListener('click', () => {
      animal = { species: animal.species, sex: animal.sex, horse: animal.choice, tag: '', name: '' };
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
      <p>Después de entrar, por cada animal anotas su autocrotal (o, si es caballo, su nombre), grabas su cara (10 segundos) y su morro (5 segundos). El manual tiene todos los pasos.</p>
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
