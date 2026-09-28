// Biometría facial de mascotas (PROTOTIPO).
//
// 1. Detección: un detector tipo YOLO entrenado para encontrar la cabeza de
//    perros y gatos (public/models/pet-head.onnx, ver training/) recorta
//    justo la cara.
// 2. Huella: DINOv2-small convierte el recorte en un vector de 384 números.
//    Dos fotos de la misma mascota producen vectores parecidos (similitud
//    coseno). Funciona sin entrenamiento extra; más adelante se puede ajustar
//    con metric learning (ArcFace) sobre fotos de mascotas.
// 3. Búsqueda: los vectores se comparan en la base con pgvector
//    (supabase/schema.sql) o en el celular en modo local.
//
// Los dos modelos corren en el celular con un solo ONNX Runtime (en iPhone la
// memoria es justa: dos motores a la vez cerraban la página). Se descargan una
// vez y quedan guardados. Si hay servidor de reconocimiento (server/,
// VITE_BIO_SERVER), el celular le envía la foto y no descarga nada. Si nada
// de eso funciona, se usa un descriptor simple de color y textura.
//
// Además de la cara se puede guardar una foto de la nariz: sus pliegues son
// únicos en cada perro, como una huella digital.

import { BIO_SERVER } from './config.js';

export const SIZE = 224;

// Umbral de coincidencia de la cara, contra la captura más parecida.
// dino: valor inicial, a calibrar con pruebas reales. mobilenet: registros
// antiguos. Mismos valores que face_threshold() en supabase/schema.sql.
const THRESHOLDS = { dino: 0.78, mobilenet: 0.8, basic: 0.92 };

const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.0-dev.20260914-8d85527a0/dist/';
const HEAD_MODEL = 'models/pet-head.onnx';
const DINO_MODEL = 'https://huggingface.co/Xenova/dinov2-small/resolve/main/onnx/model_quantized.onnx';
const HEAD = { size: 320, threshold: 0.4 };
const MODEL_CACHE = 'petsafe-models';

let ortPromise, dinoPromise, headPromise;

function runtime() {
  ortPromise ??= import(/* @vite-ignore */ ORT + 'ort.wasm.min.mjs').then(
    (ort) => {
      ort.env.wasm.wasmPaths = ORT;
      ort.env.wasm.numThreads = 1;
      return ort;
    },
    (err) => {
      ortPromise = null; // se reintenta en la próxima captura
      throw err;
    },
  );
  return ortPromise;
}

// Descarga en curso: bytes por archivo, para mostrar el avance.
const downloads = new Map();
function progress(url, loaded, total) {
  downloads.set(url, [loaded, total]);
  let l = 0, t = 0;
  for (const [a, b] of downloads.values()) { l += a; t += b; }
  window.dispatchEvent(new CustomEvent('petsafe:model-progress', { detail: { loaded: l, total: t } }));
}

// Baja un modelo una sola vez y lo guarda en el celular. Devuelve null si
// no existe (404 o la página de inicio en su lugar).
async function modelBytes(url) {
  const cache = await caches.open(MODEL_CACHE).catch(() => null);
  let res = await cache?.match(url);
  if (!res) {
    res = await fetch(url);
    if (!res.ok || /text\/html/.test(res.headers.get('content-type') || '')) return null;
    const total = Number(res.headers.get('content-length')) || 0;
    const reader = res.body.getReader();
    const parts = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      loaded += value.length;
      if (total) progress(url, loaded, total);
    }
    const blob = new Blob(parts);
    await cache?.put(url, new Response(blob)).catch(() => {});
    return new Uint8Array(await blob.arrayBuffer());
  }
  return new Uint8Array(await res.arrayBuffer());
}

// Carga un modelo una sola vez; si falla se reintenta en la próxima captura.
function session(get, set, url) {
  if (!get()) {
    set(
      (async () => {
        const [ort, bytes] = await Promise.all([runtime(), modelBytes(url)]);
        if (!bytes) return null;
        return { ort, session: await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] }) };
      })().catch((err) => {
        console.warn(`${url} no disponible`, err);
        set(null);
        return null;
      }),
    );
  }
  return get();
}
const dino = () => session(() => dinoPromise, (p) => (dinoPromise = p), DINO_MODEL);
const headModel = () => session(() => headPromise, (p) => (headPromise = p), HEAD_MODEL);

/** Despierta el servidor o empieza a descargar los modelos en segundo plano. */
export function warmUp() {
  // Caché de la versión anterior (transformers.js): ya no se usa.
  caches?.delete('transformers-cache').catch(() => {});
  server().then((up) => {
    if (up) return;
    // Uno después del otro, para no ocupar el doble de memoria a la vez.
    headModel().then(() => dino());
  });
}

// ---------- Servidor de reconocimiento ----------

// El servidor gratis se duerme si nadie lo usa y tarda hasta un minuto en
// despertar. Si no responde, se usa el celular y se reintenta más tarde.
let serverPromise = null, serverDownUntil = 0;
function server() {
  if (!BIO_SERVER || Date.now() < serverDownUntil) return Promise.resolve(false);
  serverPromise ??= (async () => {
    const waking = setTimeout(() => window.dispatchEvent(new CustomEvent('petsafe:server-waking')), 4000);
    try {
      const res = await fetch(BIO_SERVER + '/health', { signal: AbortSignal.timeout(90000) });
      if (!res.ok) throw new Error(res.status);
      return true;
    } finally {
      clearTimeout(waking);
    }
  })().catch(serverDown);
  return serverPromise;
}

function serverDown(err) {
  console.warn('Servidor de reconocimiento no disponible', err);
  serverPromise = null;
  serverDownUntil = Date.now() + 2 * 60000;
  return false;
}

async function ask(path, canvas, type = 'image/jpeg') {
  const blob = await new Promise((ok) => canvas.toBlob(ok, type, 0.92));
  const body = new FormData();
  body.append('image', blob, type === 'image/png' ? 'foto.png' : 'foto.jpg');
  const res = await fetch(BIO_SERVER + path, { method: 'POST', body, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

// ---------- Modelos en el celular ----------

// Píxeles de un canvas n x n en formato CHW (canales separados).
function pixels(canvas, n, mean = [0, 0, 0], std = [1, 1, 1]) {
  const { data } = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, n, n);
  const input = new Float32Array(3 * n * n);
  for (let i = 0; i < n * n; i++) {
    for (let c = 0; c < 3; c++) input[c * n * n + i] = (data[i * 4 + c] / 255 - mean[c]) / std[c];
  }
  return input;
}

/**
 * Busca la cabeza de un perro o gato. Devuelve { x, y, w, h, head: true },
 * false si no ve ninguna, o null si el modelo no está.
 */
async function locateHead(canvas) {
  const model = await headModel();
  if (!model) return null;
  const { ort, session } = model;
  const n = HEAD.size;
  // Se achica sin deformar y se rellena con gris, como en el entrenamiento.
  const k = n / Math.max(canvas.width, canvas.height);
  const w = Math.round(canvas.width * k), h = Math.round(canvas.height * k);
  const dx = (n - w) / 2, dy = (n - h) / 2;
  const box = document.createElement('canvas');
  box.width = box.height = n;
  const ctx = box.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = 'rgb(114,114,114)';
  ctx.fillRect(0, 0, n, n);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, dx, dy, w, h);
  const feeds = { [session.inputNames[0]]: new ort.Tensor('float32', pixels(box, n), [1, 3, n, n]) };
  box.width = box.height = 0;
  const out = (await session.run(feeds))[session.outputNames[0]];
  // Salida de YOLO: [1, 5, N] con (cx, cy, ancho, alto, puntaje) por columna.
  const count = out.dims[2], d = out.data;
  let best = -1, score = HEAD.threshold;
  for (let i = 0; i < count; i++) if (d[4 * count + i] > score) { score = d[4 * count + i]; best = i; }
  if (best < 0) return false;
  const bw = d[2 * count + best] / k, bh = d[3 * count + best] / k;
  const cx = (d[best] - dx) / k, cy = (d[count + best] - dy) / k;
  return { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh, head: true };
}

/**
 * Busca la cabeza de la mascota en la imagen. Devuelve { x, y, w, h, head },
 * false si no hay ninguna, o null si no hay detector disponible.
 */
export async function locatePet(canvas) {
  if (await server()) {
    try {
      return (await ask('/detect', canvas)).box || false;
    } catch (err) {
      serverDown(err);
    }
  }
  return locateHead(canvas);
}

/**
 * Calcula la huella de una imagen cuadrada (canvas SIZE x SIZE).
 * Siempre incluye el descriptor básico y, si el modelo cargó, el de DINOv2;
 * así dos huellas siempre se pueden comparar aunque una se haya tomado sin
 * conexión. Devuelve { dino, basic }.
 */
export async function embed(canvas) {
  const basic = normalize(basicDescriptor(canvas));
  if (await server()) {
    try {
      // PNG: el servidor recibe exactamente los mismos píxeles.
      const { dino } = await ask('/embed', canvas, 'image/png');
      if (dino?.length) return { dino, basic };
    } catch (err) {
      serverDown(err);
    }
  }
  const model = await dino();
  if (!model) return { dino: null, basic };
  // Se suma la imagen con su espejo: la huella queda estable aunque la
  // mascota gire un poco la cabeza.
  const a = await cls(model, canvas, false);
  const b = await cls(model, canvas, true);
  return { dino: normalize(a.map((v, i) => v + b[i])), basic };
}

// Token [CLS] de DINOv2. Mismo preprocesamiento que antes (transformers.js)
// y que server/app.py: se agranda a 256 y se toma el centro de 224, o sea el
// cuadro central de 196 px del recorte.
const DINO_MEAN = [0.485, 0.456, 0.406], DINO_STD = [0.229, 0.224, 0.225];
async function cls({ ort, session }, canvas, mirror) {
  const input = document.createElement('canvas');
  input.width = input.height = SIZE;
  const ctx = input.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  if (mirror) {
    ctx.translate(SIZE, 0);
    ctx.scale(-1, 1);
  }
  const m = SIZE / 256 * 16, side = SIZE - 2 * m;
  ctx.drawImage(canvas, m, m, side, side, 0, 0, SIZE, SIZE);
  const tensor = new ort.Tensor('float32', pixels(input, SIZE, DINO_MEAN, DINO_STD), [1, 3, SIZE, SIZE]);
  input.width = input.height = 0;
  const res = await session.run({ [session.inputNames[0]]: tensor });
  const out = res.last_hidden_state ?? res[session.outputNames[0]];
  const d = out.dims[out.dims.length - 1];
  return Array.from(out.data.slice(0, d));
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
  else if (nose && sharpness < 35) problem = 'La nariz salió movida o desenfocada. Aléjate un poco (unos 10 cm) y mantén el celular quieto.';
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
