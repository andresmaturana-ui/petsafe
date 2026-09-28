// Biometría facial de mascotas (PROTOTIPO).
//
// 1. Detección: un detector de objetos (YOLOS-tiny, entrenado en COCO) busca
//    al perro o gato en la foto para recortar alrededor de él.
// 2. Huella: DINOv2-small convierte el recorte en un vector de 384 números.
//    Dos fotos de la misma mascota producen vectores parecidos (similitud
//    coseno). Funciona sin entrenamiento extra; más adelante se puede ajustar
//    con metric learning (ArcFace) sobre fotos de mascotas.
// 3. Búsqueda: los vectores se comparan en la base con pgvector
//    (supabase/schema.sql) o en el celular en modo local.
//
// Los modelos corren en el celular con transformers.js y se descargan una vez
// (unos 35 MB) y quedan guardados. Si no se pueden descargar, se usa un
// descriptor simple de color y textura para que la app siga funcionando.
//
// Además de la cara se puede guardar una foto de la nariz: sus pliegues son
// únicos en cada perro, como una huella digital.

export const SIZE = 224;

// Umbral de coincidencia de la cara, contra la captura más parecida.
// dino: valor inicial, a calibrar con pruebas reales. mobilenet: registros
// antiguos. Mismos valores que face_threshold() en supabase/schema.sql.
const THRESHOLDS = { dino: 0.78, mobilenet: 0.8, basic: 0.92 };

const TRANSFORMERS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/dist/transformers.min.js';
const MODEL_OPTIONS = { dtype: 'q8', device: 'wasm' };

let libPromise, dinoPromise, detectorPromise;

function lib() {
  libPromise ??= import(/* @vite-ignore */ TRANSFORMERS).then(
    (t) => {
      t.env.allowLocalModels = false;
      return t;
    },
    (err) => {
      libPromise = null; // se reintenta en la próxima captura
      throw err;
    },
  );
  return libPromise;
}

// Descarga en curso: bytes por archivo, para mostrar el avance.
const downloads = new Map();
function progress(info) {
  if (info.status !== 'progress' || !info.total) return;
  downloads.set(info.file + info.name, [info.loaded, info.total]);
  let loaded = 0, total = 0;
  for (const [l, t] of downloads.values()) { loaded += l; total += t; }
  window.dispatchEvent(new CustomEvent('petsafe:model-progress', { detail: { loaded, total } }));
}

// Carga un modelo una sola vez; si falla se reintenta en la próxima captura.
function load(get, set, task, model) {
  if (!get()) {
    set(
      withTimeout(lib().then((t) => t.pipeline(task, model, { ...MODEL_OPTIONS, progress_callback: progress })), 180000).catch((err) => {
        console.warn(`${model} no disponible`, err);
        set(null);
        return null;
      }),
    );
  }
  return get();
}
const dino = () => load(() => dinoPromise, (p) => (dinoPromise = p), 'image-feature-extraction', 'Xenova/dinov2-small');
const detector = () => load(() => detectorPromise, (p) => (detectorPromise = p), 'object-detection', 'Xenova/yolos-tiny');

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

/** Empieza a descargar los modelos en segundo plano. */
export function warmUp() {
  dino();
  detector();
}

/**
 * Busca un perro o gato en la imagen. Devuelve la caja más segura
 * { x, y, w, h } en píxeles, false si no hay ninguno, o null si el detector
 * no está disponible.
 */
export async function locatePet(canvas) {
  const [t, det] = await Promise.all([lib().catch(() => null), detector()]);
  if (!t || !det) return null;
  const found = (await det(t.RawImage.fromCanvas(canvas), { threshold: 0.5 }))
    .filter((d) => d.label === 'dog' || d.label === 'cat')
    .sort((a, b) => b.score - a.score)[0];
  if (!found) return false;
  const { xmin, ymin, xmax, ymax } = found.box;
  return { x: xmin, y: ymin, w: xmax - xmin, h: ymax - ymin };
}

/**
 * Calcula la huella de una imagen cuadrada (canvas SIZE x SIZE).
 * Siempre incluye el descriptor básico y, si el modelo cargó, el de DINOv2;
 * así dos huellas siempre se pueden comparar aunque una se haya tomado sin
 * conexión. Devuelve { dino, basic }.
 */
export async function embed(canvas) {
  const basic = normalize(basicDescriptor(canvas));
  const [t, model] = await Promise.all([lib().catch(() => null), dino()]);
  if (!t || !model) return { dino: null, basic };
  // Se suma la imagen con su espejo: la huella queda estable aunque la
  // mascota gire un poco la cabeza.
  const flipped = document.createElement('canvas');
  flipped.width = flipped.height = SIZE;
  const ctx = flipped.getContext('2d');
  ctx.scale(-1, 1);
  ctx.drawImage(canvas, -SIZE, 0);
  const a = cls(await model(t.RawImage.fromCanvas(canvas)));
  const b = cls(await model(t.RawImage.fromCanvas(flipped)));
  return { dino: normalize(a.map((v, i) => v + b[i])), basic };
}

// Vector del token [CLS] (el primero) de la última capa.
function cls(tensor) {
  const d = tensor.dims[tensor.dims.length - 1];
  return Array.from(tensor.data.slice(0, d));
}

const MODELS = ['dino', 'mobilenet', 'basic'];

/** El mejor descriptor que tienen todas las huellas. */
function commonModel(items) {
  return MODELS.find((m) => items.every((x) => x?.[m])) || null;
}

/**
 * Arma la plantilla biométrica con varias capturas: guarda, por descriptor,
 * el promedio y cada captura, para comparar contra el ángulo más parecido.
 * Las fotos de la nariz (huella nasal) van aparte, en `nose`.
 */
export function average(faces, noses = []) {
  const template = averageOf(faces);
  if (noses.length) template.nose = averageOf(noses);
  return template;
}

function averageOf(embeddings) {
  const template = {};
  for (const m of MODELS) {
    if (!embeddings.every((e) => e[m])) continue;
    const out = new Array(embeddings[0][m].length).fill(0);
    for (const e of embeddings) e[m].forEach((v, i) => (out[i] += v));
    template[m] = { vector: normalize(out), samples: embeddings.map((e) => e[m]) };
  }
  return template;
}

// Plantillas guardadas con el formato anterior: { model, vector, samples }.
function upgrade(t) {
  if (t && t.model && t.vector) return { [t.model]: { vector: t.vector, samples: t.samples || [] } };
  return t;
}

const dot = (a, b) => {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += a[i] * b[i];
  return d;
};

/**
 * Compara dos plantillas de cara (el mejor par entre el promedio y cada
 * captura). Devuelve { score (0 a 1), model, match }.
 */
function compareFace(a, b) {
  const model = commonModel([a, b]);
  if (!model) return { score: 0, model: null, match: false };
  const as = [a[model].vector, ...(a[model].samples || [])];
  const bs = [b[model].vector, ...(b[model].samples || [])];
  let score = 0;
  for (const x of as) for (const y of bs) if (x.length === y.length) score = Math.max(score, dot(x, y));
  return { score, model, match: score >= THRESHOLDS[model] };
}

/**
 * Compara dos registros biométricos. La cara decide; si los dos tienen foto
 * de la nariz y las narices se parecen mucho, basta con que la cara se
 * parezca algo menos (por ejemplo, si la encontraron de lado).
 * Devuelve { score, model, match, nose } (nose es null si falta alguna).
 */
export function compare(a, b) {
  a = upgrade(a);
  b = upgrade(b);
  const face = compareFace(a, b);
  const nose = a?.nose && b?.nose ? compareFace(a.nose, b.nose) : null;
  const noseHelps = nose && nose.model === face.model && face.model !== 'basic' &&
    nose.score >= NOSE.threshold && face.score >= THRESHOLDS[face.model] - NOSE.faceMargin;
  return { ...face, match: face.match || noseHelps, nose: nose && nose.score };
}

// Mismos valores que is_pet_match() en supabase/schema.sql.
const NOSE = { threshold: 0.85, faceMargin: 0.1 };

/**
 * Qué tan parecida es cada captura al resto (0 a 1). Una captura con valor
 * bajo probablemente es de otro animal o salió mal.
 * Devuelve { scores, min } donde min es el mínimo aceptable.
 */
export function consistency(embeddings) {
  const model = commonModel(embeddings);
  const scores = embeddings.map((e, i) => {
    const others = embeddings.filter((_, j) => j !== i);
    if (!others.length) return 1;
    return others.reduce((acc, o) => acc + dot(e[model], o[model]), 0) / others.length;
  });
  return { scores, min: CONSISTENCY_MIN[model] };
}

// Solo detecta errores gruesos (otro animal, foto equivocada).
const CONSISTENCY_MIN = { dino: 0.5, mobilenet: 0.6, basic: 0.6 };

/**
 * Revisa luz y nitidez de una captura. Una nariz negra de cerca es oscura por
 * naturaleza, así que con `nose` se acepta menos luz.
 * Devuelve { ok, brightness (0-255), sharpness, problem }.
 */
export function quality(canvas, { nose = false } = {}) {
  const n = 128;
  const small = document.createElement('canvas');
  small.width = small.height = n;
  const ctx = small.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0, n, n);
  const { data } = ctx.getImageData(0, 0, n, n);
  const g = new Float32Array(n * n);
  let sum = 0;
  for (let i = 0; i < n * n; i++) {
    g[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    sum += g[i];
  }
  const brightness = sum / (n * n);
  // Varianza del laplaciano: valores bajos = foto borrosa.
  let lsum = 0, lsq = 0, count = 0;
  for (let y = 1; y < n - 1; y++) {
    for (let x = 1; x < n - 1; x++) {
      const i = y * n + x;
      const l = g[i - 1] + g[i + 1] + g[i - n] + g[i + n] - 4 * g[i];
      lsum += l; lsq += l * l; count++;
    }
  }
  const sharpness = lsq / count - (lsum / count) ** 2;
  let problem = null;
  if (brightness < (nose ? 20 : 45)) problem = 'Está muy oscuro, busca más luz.';
  else if (brightness > 225) problem = 'Hay demasiada luz, evita el sol directo o el flash.';
  else if (sharpness < 25) problem = 'Salió borrosa, mantén el celular quieto.';
  return { ok: !problem, brightness, sharpness, problem };
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
