// Componente de escaneo facial: cámara o fotos + control de calidad + biometría.
//
// Modo "enroll" (registrar): registro guiado en varios ángulos. Cada captura
// pasa un control de luz, nitidez y "¿es una mascota?", y al final se revisa
// que todas sean del mismo animal. Cámara y fotos pasan por los mismos
// controles, así que ambas sirven igual.
//
// Modo "identify" (encontré): una captura de frente.
//
// En los dos modos el último paso es la nariz bien de cerca (huella nasal).
// Se puede omitir si la mascota no se deja.

import { SIZE, embed, locatePet, average, warmUp, quality, consistency } from './biometrics.js';
import { esc } from './ui.js';

const NOSE_STEP = { text: 'A unos 10 cm: que la nariz llene el círculo', kind: 'nose', optional: true };
// La nariz se recorta más cerrada (60% del cuadro) para que se vean los pliegues.
const NOSE_ZOOM = 0.6;

export const ENROLL_STEPS = [
  { text: 'De frente, a la altura de sus ojos', kind: 'face' },
  { text: 'Gira un poco hacia su izquierda', kind: 'face' },
  { text: 'Gira un poco hacia su derecha', kind: 'face' },
  { text: 'Más cerca: ojos y nariz', kind: 'face' },
  { text: 'De frente otra vez, con otra luz si puedes', kind: 'face' },
  NOSE_STEP,
];

// Dos ángulos: si una foto sale movida o de lado, la otra todavía puede coincidir.
const IDENTIFY_STEPS = [
  { text: 'Centra la cara de la mascota en el círculo', kind: 'face' },
  { text: 'Otra desde un ángulo un poco distinto', kind: 'face' },
  NOSE_STEP,
];

const SKIPPED = { skipped: true };

/**
 * Monta el escáner dentro de `root`.
 * `onDone({ photo, biometric, looksLikePet, quality })` se llama al terminar.
 */
export function mountScanner(root, { mode = 'identify', label = 'Escanear', onDone, onReset }) {
  warmUp();
  const enroll = mode === 'enroll';
  const steps = enroll ? ENROLL_STEPS : IDENTIFY_STEPS;
  const total = steps.length;
  const faceSteps = steps.filter((s) => s.kind === 'face').length;
  const shots = new Array(total).fill(null); // { photo, emb, q } por paso, o SKIPPED
  const count = () => shots.filter(Boolean).length;
  const next = () => shots.indexOf(null);
  const kindAt = (i) => steps[i]?.kind;

  root.innerHTML = `
    <div class="scanner">
      <div class="scan-frame">
        <video playsinline muted autoplay></video>
        <img class="scan-preview" alt="" hidden>
        <svg class="scan-ring" viewBox="0 0 100 100"><circle cx="50" cy="50" r="47" pathLength="100"/></svg>
        <div class="scan-hint"></div>
      </div>
      <div class="shots">${steps.map((step, i) => `<button type="button" class="shot" data-i="${i}" title="${esc(step.text)}"><span>${step.kind === 'nose' ? '👃' : i + 1}</span></button>`).join('')}</div>
      <p class="muted small center shots-help" hidden>¿Alguna no quedó bien? Tócala para quitarla y tomarla de nuevo.</p>
      <p class="scan-status" aria-live="polite">Preparando cámara…</p>
      <div class="scan-warning" hidden>
        <p></p>
        <div class="row"><button class="btn small" data-act="retry">Repetir</button><button class="btn small ghost" data-act="keep">Usar igual</button></div>
      </div>
      <div class="scan-actions">
        <button class="btn primary big" data-act="scan" disabled>${esc(label)}</button>
        <button class="btn ghost" data-act="torch" hidden>🔦 Encender linterna</button>
        <button class="btn ghost" data-act="skip" hidden>Omitir la nariz</button>
        <label class="btn ghost">
          Usar fotos de la galería
          <input type="file" accept="image/*" multiple hidden>
        </label>
      </div>
      ${enroll ? '<p class="muted small center">Consejo: toma cada foto desde un ángulo distinto. Así la app la reconoce aunque la encuentren de lado o con otra luz. La última es la nariz: sus pliegues son únicos, como una huella digital.</p>' : ''}
    </div>`;

  const $ = (s) => root.querySelector(s);
  const video = $('video');
  const status = $('.scan-status');
  const hint = $('.scan-hint');
  const btn = $('[data-act=scan]');
  const skip = $('[data-act=skip]');
  const torch = $('[data-act=torch]');
  const file = $('input[type=file]');
  const warning = $('.scan-warning');
  let stream;
  let track; // pista de video de la cámara
  let noseMode = false;
  let torchOn = false;
  let done = false;
  let busy = false;
  let touched = false; // ya se mostró un mensaje de captura

  const stop = () => stream?.getTracks().forEach((t) => t.stop());

  // La primera vez se descarga el reconocimiento: se muestra el avance
  // mientras se analiza una captura.
  let analyzing = false;
  const onModel = ({ detail: { loaded, total } }) => {
    if (analyzing && loaded < total) {
      status.textContent = `Preparando el reconocimiento (solo la primera vez): ${Math.round((loaded / total) * 100)}%…`;
    }
  };
  window.addEventListener('petsafe:model-progress', onModel);
  const setProgress = () => $('.scan-ring circle').style.setProperty('--p', count() / total);

  function refresh() {
    setProgress();
    root.querySelectorAll('.shot').forEach((el, i) => {
      const s = shots[i];
      el.classList.toggle('ok', !!s?.photo);
      el.classList.toggle('skipped', s === SKIPPED);
      el.style.backgroundImage = s?.photo ? `url("${s.photo}")` : '';
      el.classList.toggle('current', i === next());
      el.setAttribute('aria-label', s ? `Quitar captura ${i + 1}` : `Captura ${i + 1}: ${steps[i].text}`);
    });
    $('.shots-help').hidden = !count();
    const n = next();
    hint.textContent = steps[n]?.text || '';
    skip.hidden = !steps[n]?.optional;
    btn.textContent = kindAt(n) === 'nose' ? 'Capturar la nariz' : count() ? `Capturar ${n + 1} de ${faceSteps}` : label;
    setNoseMode(kindAt(n) === 'nose' && !done);
  }

  // Paso de la nariz: máxima resolución de la cámara, vista más cerrada y
  // linterna disponible. Si el celular no lo permite, sigue igual.
  async function setNoseMode(on) {
    if (on === noseMode) return;
    noseMode = on;
    $('.scan-frame').classList.toggle('nose', on);
    const caps = track?.getCapabilities?.() || {};
    torch.hidden = !on || !caps.torch;
    if (!on && torchOn) await setTorch(false);
    try {
      await track?.applyConstraints(on
        ? { width: { ideal: 3840 }, height: { ideal: 2160 } }
        : { width: { ideal: 1280 }, height: { ideal: 720 } });
    } catch { /* se queda con la resolución actual */ }
  }

  async function setTorch(on) {
    try {
      await track.applyConstraints({ advanced: [{ torch: on }] });
      torchOn = on;
    } catch { /* sin linterna */ }
    torch.textContent = torchOn ? '🔦 Apagar linterna' : '🔦 Encender linterna';
  }
  torch.addEventListener('click', () => setTorch(!torchOn));

  async function startCamera() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      video.srcObject = stream;
      await video.play();
      track = stream.getVideoTracks()[0];
      noseMode = false;
      // Enfoque automático continuo, importante para la nariz de cerca.
      if (track.getCapabilities?.().focusMode?.includes('continuous')) {
        track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
      }
      if (!touched) status.textContent = enroll
        ? `Vamos a tomar ${total} capturas desde distintos ángulos.`
        : 'Acércate a la cara y presiona escanear';
      btn.disabled = false;
    } catch {
      if (!touched) status.textContent = enroll
        ? `No se pudo abrir la cámara. Sube ${total} fotos distintas de su cara.`
        : 'No se pudo abrir la cámara. Puedes usar una foto.';
      video.hidden = true;
    }
    refresh();
  }
  startCamera();

  // Toma una ráfaga corta y se queda con el cuadro más nítido. La nariz usa
  // la resolución completa de la cámara y una ráfaga más larga, porque el
  // perro se mueve y de cerca cuesta enfocar.
  async function captureBest() {
    let best = null;
    const nose = kindAt(next()) === 'nose';
    const zoom = nose ? NOSE_ZOOM : 0.8;
    for (let i = 0; i < (nose ? 6 : 3); i++) {
      const frame = snapshot(video, video.videoWidth, video.videoHeight, nose ? Infinity : FRAME);
      const { sharpness } = quality(centerCrop(frame, zoom));
      if (!best || sharpness > best.sharpness) best = { frame, sharpness };
      await new Promise((r) => setTimeout(r, 120));
    }
    return best.frame;
  }

  // Recorta la captura, revisa su calidad y calcula la huella.
  // Devuelve true si se aceptó.
  async function consider(frame, zoom) {
    touched = true;
    const nose = kindAt(next()) === 'nose';
    status.textContent = 'Analizando…';
    analyzing = true;
    try {
      return await analyze(frame, zoom, nose);
    } finally {
      analyzing = false;
    }
  }

  async function analyze(frame, zoom, nose) {
    // Para la cara se busca al perro o gato y se recorta a su alrededor. La
    // nariz de cerca no se ve como "un perro" para el detector: va al centro.
    const box = nose ? null : await locatePet(frame);
    const canvas = box ? cropAround(frame, box) : centerCrop(frame, nose ? NOSE_ZOOM : zoom);
    const q = quality(canvas, { nose });
    if (!q.ok) {
      status.textContent = `⚠️ ${q.problem} Intenta de nuevo.`;
      return false;
    }
    const emb = await embed(canvas);
    const shot = { photo: canvas.toDataURL('image/jpeg', 0.85), emb, q, looksLikePet: box === null ? null : !!box };
    if (box === false) {
      const keep = await askKeep('No logramos ver bien a una mascota en esta captura. Acércate más a su cara.');
      if (!keep) {
        status.textContent = 'Repite la captura.';
        return false;
      }
    }
    shots[next()] = shot;
    return true;
  }

  function askKeep(message) {
    warning.querySelector('p').textContent = message;
    warning.hidden = false;
    return new Promise((resolve) => {
      warning.querySelector('[data-act=retry]').onclick = () => { warning.hidden = true; resolve(false); };
      warning.querySelector('[data-act=keep]').onclick = () => { warning.hidden = true; resolve(true); };
    });
  }

  async function afterShot() {
    refresh();
    const n = next();
    if (n !== -1) {
      if (kindAt(n) === 'nose') status.textContent = '✅ Captura lista. Ahora la nariz bien de cerca: sus pliegues son únicos, como una huella digital. Si no se deja, puedes omitirla.';
      else status.textContent = `✅ Captura lista. Ahora la ${n + 1}: ${steps[n].text.toLowerCase()}.`;
      return;
    }
    if (enroll) {
      // ¿Todas las capturas de la cara son del mismo animal?
      const faces = shots.map((s, i) => (kindAt(i) === 'face' ? i : -1)).filter((i) => i >= 0);
      const { scores, min } = consistency(faces.map((i) => shots[i].emb));
      const w = scores.indexOf(Math.min(...scores));
      if (scores[w] < min && faces.length > 2) {
        shots[faces[w]] = null;
        refresh();
        status.textContent = `⚠️ La captura ${faces[w] + 1} no se parece a las demás (¿otro animal o mal ángulo?). Tómala de nuevo.`;
        return;
      }
    }
    finish();
  }

  btn.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    btn.disabled = true;
    if (await consider(await captureBest(), 0.8)) await afterShot();
    busy = false;
    btn.disabled = next() === -1 || video.hidden;
  });

  skip.addEventListener('click', async () => {
    if (busy || !steps[next()]?.optional) return;
    shots[next()] = SKIPPED;
    touched = true;
    await afterShot();
  });

  file.addEventListener('change', async () => {
    if (busy) return;
    busy = true;
    btn.disabled = true;
    for (const f of [...file.files].slice(0, total - count())) {
      const img = await loadImage(URL.createObjectURL(f));
      const max = kindAt(next()) === 'nose' ? Infinity : FRAME;
      if (await consider(snapshot(img, img.naturalWidth, img.naturalHeight, max), 1)) await afterShot();
      if (next() === -1) break;
    }
    file.value = '';
    busy = false;
    btn.disabled = next() === -1 || video.hidden;
  });

  // Quitar una captura (de cámara o subida) para tomarla de nuevo.
  root.querySelectorAll('.shot').forEach((el) =>
    el.addEventListener('click', () => {
      const i = Number(el.dataset.i);
      if (busy || !shots[i]) return;
      shots[i] = null;
      if (done) reopen();
      refresh();
      touched = true;
      status.textContent = `Toma de nuevo la captura ${i + 1}: ${steps[i].text.toLowerCase()}.`;
    }),
  );

  function reopen() {
    done = false;
    $('.scan-frame').classList.remove('done');
    $('.scan-preview').hidden = true;
    hint.hidden = false;
    btn.hidden = false;
    file.closest('label').hidden = false;
    video.hidden = false;
    startCamera();
    onReset?.();
  }

  function finish() {
    done = true;
    setNoseMode(false);
    stop();
    video.hidden = true;
    const faces = shots.filter((s, i) => kindAt(i) === 'face');
    const noses = shots.filter((s, i) => kindAt(i) === 'nose' && s !== SKIPPED);
    const preview = $('.scan-preview');
    preview.src = faces[0].photo;
    preview.hidden = false;
    hint.hidden = true;
    btn.hidden = true;
    file.closest('label').hidden = true;
    $('.scan-frame').classList.add('done');
    skip.hidden = true;
    const embs = faces.map((s) => s.emb);
    const known = faces[0].looksLikePet !== null;
    const { scores, min } = consistency(embs);
    const level = !enroll ? null : Math.min(...scores) >= min + 0.1 && noses.length ? 'Excelente' : 'Buena';
    const noseNote = noses.length ? ' (cara y nariz)' : ' (sin nariz)';
    status.textContent = enroll ? `¡Biometría registrada${noseNote}! Calidad: ${level}` : '¡Listo!';
    onDone({
      photo: faces[0].photo,
      biometric: average(embs, noses.map((s) => s.emb)),
      looksLikePet: known ? faces.some((s) => s.looksLikePet) : null,
      quality: level,
    });
  }

  // Detener la cámara si se sale de la pantalla.
  window.addEventListener('hashchange', () => {
    stop();
    window.removeEventListener('petsafe:model-progress', onModel);
  }, { once: true });
  return { stop };
}

// Copia la imagen completa (cámara o foto) a un canvas de hasta `max` px.
const FRAME = 1024;
function snapshot(source, w, h, max = FRAME) {
  const k = Math.min(1, max / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * k);
  canvas.height = Math.round(h * k);
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// Cuadrado central. De la cámara se usa la zona del círculo guía (80%); de
// una foto, el cuadrado completo; la nariz, más cerrada (60%).
function centerCrop(frame, zoom) {
  const side = Math.min(frame.width, frame.height) * zoom;
  return square(frame, (frame.width - side) / 2, (frame.height - side) / 2, side);
}

// Cuadrado alrededor de la mascota detectada, con un pequeño margen (algo
// mayor para la cabeza, así entran las orejas).
function cropAround(frame, { x, y, w, h, head }) {
  const side = Math.min(Math.max(w, h) * (head ? 1.25 : 1.1), Math.max(frame.width, frame.height));
  return square(frame, x + w / 2 - side / 2, y + h / 2 - side / 2, side);
}

function square(frame, sx, sy, side) {
  // Al achicar mucho de una vez se pierden los detalles finos (los pliegues
  // de la nariz): se reduce a la mitad por pasos.
  while (side > SIZE * 2) {
    frame = half(frame);
    sx /= 2; sy /= 2; side /= 2;
  }
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, SIZE, SIZE);
  const k = SIZE / side;
  ctx.drawImage(frame, -sx * k, -sy * k, frame.width * k, frame.height * k);
  return canvas;
}

function half(frame) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(frame.width / 2));
  canvas.height = Math.max(1, Math.round(frame.height / 2));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
