// Biometría facial de mascotas (PROTOTIPO).
//
// Se usa MobileNet v2 (TensorFlow.js) en el navegador para convertir la foto
// de la cara de la mascota en un vector numérico ("embedding"). Dos fotos de
// la misma mascota producen vectores parecidos; se comparan con similitud
// coseno. Si el modelo no se puede descargar, se usa un descriptor simple de
// color y textura para que la app siga funcionando.
//
// Un modelo entrenado específicamente para caras de perros y gatos mejoraría
// mucho la precisión; basta con reemplazar `embed()` manteniendo la interfaz.

export const SIZE = 224;

const THRESHOLDS = { mobilenet: 0.78, basic: 0.9 };

let modelPromise;

function loadModel() {
  if (!modelPromise) {
    modelPromise = (async () => {
      const [tf, mobilenet] = await Promise.all([
        import('@tensorflow/tfjs'),
        import('@tensorflow-models/mobilenet'),
      ]);
      await tf.ready();
      const model = await withTimeout(mobilenet.load({ version: 2, alpha: 1.0 }), 20000);
      return { tf, model };
    })().catch((err) => {
      console.warn('MobileNet no disponible, se usa el descriptor básico', err);
      return null;
    });
  }
  return modelPromise;
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

/** Empieza a descargar el modelo en segundo plano. */
export function warmUp() {
  loadModel();
}

// Índices ImageNet: perros 151-268, lobos/zorros 269-280, gatos 281-293.
const isPetClass = (i) => i >= 151 && i <= 293;

/**
 * Calcula el embedding de una imagen cuadrada (canvas SIZE x SIZE).
 * Devuelve { model, vector, looksLikePet } — looksLikePet es null si no se sabe.
 */
export async function embed(canvas) {
  const loaded = await loadModel();
  if (loaded) {
    const { tf, model } = loaded;
    const { vector, logits } = tf.tidy(() => {
      const emb = model.infer(canvas, true);
      const log = model.infer(canvas, false);
      return { vector: emb.dataSync().slice(), logits: log.dataSync().slice() };
    });
    // MobileNet v2 tiene 1001 clases (la 0 es "fondo").
    const offset = logits.length === 1001 ? 1 : 0;
    const top = [...logits.keys()].sort((a, b) => logits[b] - logits[a]).slice(0, 5);
    return {
      model: 'mobilenet',
      vector: normalize(Array.from(vector)),
      looksLikePet: top.some((i) => isPetClass(i - offset)),
    };
  }
  return { model: 'basic', vector: normalize(basicDescriptor(canvas)), looksLikePet: null };
}

/** Promedia varias capturas en una sola huella biométrica. */
export function average(embeddings) {
  const model = embeddings[0].model;
  const same = embeddings.filter((e) => e.model === model);
  const out = new Array(same[0].vector.length).fill(0);
  for (const e of same) e.vector.forEach((v, i) => (out[i] += v));
  return { model, vector: normalize(out) };
}

export function similarity(a, b) {
  if (!a || !b || a.model !== b.model || a.vector.length !== b.vector.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.vector.length; i++) dot += a.vector[i] * b.vector[i];
  return dot;
}

export function isMatch(score, model) {
  return score >= (THRESHOLDS[model] ?? 0.9);
}

function normalize(v) {
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}

// Histograma de color HSV + mapa de brillo reducido.
function basicDescriptor(canvas) {
  const small = document.createElement('canvas');
  small.width = small.height = 32;
  const ctx = small.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0, 32, 32);
  const { data } = ctx.getImageData(0, 0, 32, 32);
  const hist = new Array(8 * 4 * 4).fill(0);
  const gray = new Array(64).fill(0);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const i = (y * 32 + x) * 4;
      const [h, s, v] = rgbToHsv(data[i], data[i + 1], data[i + 2]);
      hist[Math.min(7, (h * 8) | 0) * 16 + Math.min(3, (s * 4) | 0) * 4 + Math.min(3, (v * 4) | 0)]++;
      gray[((y >> 2) * 8) + (x >> 2)] += v / 16;
    }
  }
  const meanGray = gray.reduce((a, b) => a + b, 0) / gray.length;
  return [...hist.map((h) => h / 1024), ...gray.map((g) => (g - meanGray) * 0.5)];
}

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  return [h, max ? d / max : 0, max];
}
