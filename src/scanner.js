// Componente de escaneo facial: cámara + capturas + biometría.

import { SIZE, embed, average, warmUp } from './biometrics.js';
import { esc } from './ui.js';

/**
 * Monta el escáner dentro de `root`.
 * `samples`: cuántas capturas se promedian (más = biometría más estable).
 * `onDone({ photo, biometric, looksLikePet })` se llama al terminar.
 */
export function mountScanner(root, { samples = 5, label = 'Escanear cara', onDone }) {
  warmUp();
  root.innerHTML = `
    <div class="scanner">
      <div class="scan-frame">
        <video playsinline muted autoplay></video>
        <img class="scan-preview" alt="" hidden>
        <svg class="scan-ring" viewBox="0 0 100 100"><circle cx="50" cy="50" r="47" pathLength="100"/></svg>
        <div class="scan-hint">Centra la cara de la mascota en el círculo</div>
      </div>
      <p class="scan-status" aria-live="polite">Preparando cámara…</p>
      <div class="scan-actions">
        <button class="btn primary big" data-act="scan" disabled>${esc(label)}</button>
        <label class="btn ghost">
          Usar una foto
          <input type="file" accept="image/*" capture="environment" hidden>
        </label>
      </div>
    </div>`;

  const video = root.querySelector('video');
  const preview = root.querySelector('.scan-preview');
  const status = root.querySelector('.scan-status');
  const ring = root.querySelector('.scan-ring circle');
  const btn = root.querySelector('[data-act=scan]');
  const file = root.querySelector('input[type=file]');
  let stream;

  const setProgress = (p) => ring.style.setProperty('--p', p);
  const stop = () => stream?.getTracks().forEach((t) => t.stop());

  (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      video.srcObject = stream;
      await video.play();
      status.textContent = 'Acércate a la cara y presiona escanear';
      btn.disabled = false;
    } catch {
      status.textContent = 'No se pudo abrir la cámara. Puedes usar una foto.';
      video.hidden = true;
    }
  })();

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const embeddings = [];
    let photo = null;
    let petVotes = 0;
    for (let i = 0; i < samples; i++) {
      status.textContent = `Registrando biometría… ${i + 1} de ${samples}`;
      const canvas = squareCrop(video, video.videoWidth, video.videoHeight);
      if (i === 0) photo = canvas.toDataURL('image/jpeg', 0.8);
      const e = await embed(canvas);
      embeddings.push(e);
      if (e.looksLikePet) petVotes++;
      setProgress((i + 1) / samples);
      await new Promise((r) => setTimeout(r, 250));
    }
    stop();
    finish(photo, embeddings, petVotes);
  });

  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    btn.disabled = true;
    status.textContent = 'Analizando foto…';
    const img = await loadImage(URL.createObjectURL(f));
    const canvas = squareCrop(img, img.naturalWidth, img.naturalHeight);
    const photo = canvas.toDataURL('image/jpeg', 0.8);
    const e = await embed(canvas);
    setProgress(1);
    stop();
    finish(photo, [e], e.looksLikePet ? 1 : 0);
  });

  function finish(photo, embeddings, petVotes) {
    video.hidden = true;
    preview.src = photo;
    preview.hidden = false;
    root.querySelector('.scan-hint').hidden = true;
    const known = embeddings[0].looksLikePet !== null;
    const looksLikePet = known ? petVotes > 0 : null;
    status.textContent = looksLikePet === false
      ? 'Listo. No estamos seguros de ver una mascota; si puedes, repite más cerca.'
      : '¡Biometría registrada!';
    root.querySelector('.scan-frame').classList.add('done');
    onDone({ photo, biometric: average(embeddings), looksLikePet });
  }

  // Detener la cámara si se sale de la pantalla.
  window.addEventListener('hashchange', stop, { once: true });
  return { stop };
}

function squareCrop(source, w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const side = Math.min(w, h) * 0.8; // la zona del círculo guía
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
