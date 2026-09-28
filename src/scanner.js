// Componente de escaneo facial: cámara o fotos + control de calidad + biometría.
//
// Modo "enroll" (registrar): registro guiado en varios ángulos. Cada captura
// pasa un control de luz, nitidez y "¿es una mascota?", y al final se revisa
// que todas sean del mismo animal. Cámara y fotos pasan por los mismos
// controles, así que ambas sirven igual.
//
// Modo "identify" (encontré): una ráfaga rápida desde el frente.

import { SIZE, embed, average, warmUp, quality, consistency } from './biometrics.js';
import { esc } from './ui.js';

export const ENROLL_STEPS = [
  'De frente, a la altura de sus ojos',
  'Gira un poco hacia su izquierda',
  'Gira un poco hacia su derecha',
  'Más cerca: ojos y nariz',
  'De frente otra vez, con otra luz si puedes',
];

/**
 * Monta el escáner dentro de `root`.
 * `onDone({ photo, biometric, looksLikePet, quality })` se llama al terminar.
 */
export function mountScanner(root, { mode = 'identify', label = 'Escanear', onDone }) {
  warmUp();
  const enroll = mode === 'enroll';
  const total = enroll ? ENROLL_STEPS.length : 1;
  const shots = []; // { photo, emb, q }

  root.innerHTML = `
    <div class="scanner">
      <div class="scan-frame">
        <video playsinline muted autoplay></video>
        <img class="scan-preview" alt="" hidden>
        <svg class="scan-ring" viewBox="0 0 100 100"><circle cx="50" cy="50" r="47" pathLength="100"/></svg>
        <div class="scan-hint"></div>
      </div>
      ${enroll ? `<div class="shots">${ENROLL_STEPS.map((_, i) => `<span class="shot" data-i="${i}">${i + 1}</span>`).join('')}</div>` : ''}
      <p class="scan-status" aria-live="polite">Preparando cámara…</p>
      <div class="scan-warning" hidden>
        <p></p>
        <div class="row"><button class="btn small" data-act="retry">Repetir</button><button class="btn small ghost" data-act="keep">Usar igual</button></div>
      </div>
      <div class="scan-actions">
        <button class="btn primary big" data-act="scan" disabled>${esc(label)}</button>
        <label class="btn ghost">
          ${enroll ? 'Usar fotos de la galería' : 'Usar una foto'}
          <input type="file" accept="image/*" ${enroll ? 'multiple' : ''} hidden>
        </label>
      </div>
      ${enroll ? '<p class="muted small center">Consejo: toma cada foto desde un ángulo distinto. Así la app la reconoce aunque la encuentren de lado o con otra luz.</p>' : ''}
    </div>`;

  const $ = (s) => root.querySelector(s);
  const video = $('video');
  const status = $('.scan-status');
  const hint = $('.scan-hint');
  const btn = $('[data-act=scan]');
  const file = $('input[type=file]');
  const warning = $('.scan-warning');
  let stream;
  let busy = false;
  let touched = false; // ya se mostró un mensaje de captura

  const stop = () => stream?.getTracks().forEach((t) => t.stop());
  const setProgress = () => $('.scan-ring circle').style.setProperty('--p', shots.length / total);

  function refresh() {
    setProgress();
    if (enroll) {
      root.querySelectorAll('.shot').forEach((el, i) => {
        const s = shots[i];
        el.classList.toggle('ok', !!s);
        el.style.backgroundImage = s ? `url("${s.photo}")` : '';
        el.classList.toggle('current', i === shots.length);
      });
      hint.textContent = ENROLL_STEPS[shots.length] || '';
      btn.textContent = shots.length ? `Capturar ${shots.length + 1} de ${total}` : label;
    } else {
      hint.textContent = 'Centra la cara de la mascota en el círculo';
    }
  }

  (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      video.srcObject = stream;
      await video.play();
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
  })();

  // Toma una ráfaga corta y se queda con la captura más nítida.
  async function captureBest() {
    let best = null;
    for (let i = 0; i < 3; i++) {
      const canvas = squareCrop(video, video.videoWidth, video.videoHeight);
      const q = quality(canvas);
      if (!best || (q.ok && !best.q.ok) || (q.ok === best.q.ok && q.sharpness > best.q.sharpness)) best = { canvas, q };
      await new Promise((r) => setTimeout(r, 120));
    }
    return best;
  }

  // Revisa una captura; devuelve true si se aceptó.
  async function consider(canvas, q) {
    touched = true;
    if (!q.ok) {
      status.textContent = `⚠️ ${q.problem} Intenta de nuevo.`;
      return false;
    }
    status.textContent = 'Analizando…';
    const emb = await embed(canvas);
    const shot = { photo: canvas.toDataURL('image/jpeg', 0.85), emb, q };
    if (emb.looksLikePet === false) {
      const keep = await askKeep('No logramos ver bien a una mascota en esta captura. Acércate más a su cara.');
      if (!keep) {
        status.textContent = 'Repite la captura.';
        return false;
      }
    }
    shots.push(shot);
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
    if (shots.length < total) {
      if (enroll) status.textContent = `✅ Captura ${shots.length} lista. Ahora: ${ENROLL_STEPS[shots.length].toLowerCase()}.`;
      return;
    }
    if (enroll) {
      // ¿Todas las capturas son del mismo animal?
      const { scores, min } = consistency(shots.map((s) => s.emb));
      const worst = scores.indexOf(Math.min(...scores));
      if (scores[worst] < min && shots.length > 2) {
        shots.splice(worst, 1);
        refresh();
        status.textContent = `⚠️ La captura ${worst + 1} no se parece a las demás (¿otro animal o mal ángulo?). Tómala de nuevo.`;
        return;
      }
    }
    finish();
  }

  btn.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    btn.disabled = true;
    const { canvas, q } = await captureBest();
    if (await consider(canvas, q)) await afterShot();
    busy = false;
    btn.disabled = shots.length >= total;
  });

  file.addEventListener('change', async () => {
    if (busy) return;
    busy = true;
    btn.disabled = true;
    for (const f of [...file.files].slice(0, total - shots.length)) {
      const img = await loadImage(URL.createObjectURL(f));
      const canvas = squareCrop(img, img.naturalWidth, img.naturalHeight, 1);
      if (await consider(canvas, quality(canvas))) await afterShot();
      if (shots.length >= total) break;
    }
    file.value = '';
    busy = false;
    btn.disabled = shots.length >= total || video.hidden;
  });

  function finish() {
    stop();
    video.hidden = true;
    const preview = $('.scan-preview');
    preview.src = shots[0].photo;
    preview.hidden = false;
    hint.hidden = true;
    btn.hidden = true;
    file.closest('label').hidden = true;
    $('.scan-frame').classList.add('done');
    const embs = shots.map((s) => s.emb);
    const known = embs[0].looksLikePet !== null;
    const { scores, min } = consistency(embs);
    const level = !enroll ? null : Math.min(...scores) >= min + 0.1 ? 'Excelente' : 'Buena';
    status.textContent = enroll ? `¡Biometría registrada! Calidad: ${level}` : '¡Listo!';
    onDone({
      photo: shots[0].photo,
      biometric: average(embs),
      looksLikePet: known ? embs.some((e) => e.looksLikePet) : null,
      quality: level,
    });
  }

  // Detener la cámara si se sale de la pantalla.
  window.addEventListener('hashchange', stop, { once: true });
  return { stop };
}

// De la cámara se usa la zona del círculo guía (80%); de una foto, el cuadrado central completo.
function squareCrop(source, w, h, zoom = 0.8) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const side = Math.min(w, h) * zoom;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(source, (w - side) / 2, (h - side) / 2, side, side, 0, 0, SIZE, SIZE);
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
