# Servidor de reconocimiento de Pet Safe (Hugging Face Space, gratis).
#
# Hace lo mismo que src/biometrics.js en el celular, para que la app no tenga
# que descargar los modelos:
#   POST /detect  foto completa -> caja de la cabeza (detector YOLO propio)
#   POST /embed   recorte de 224x224 -> huella DINOv2 de 384 números
# Usa los mismos archivos ONNX que el celular, así las huellas de uno y otro
# se pueden comparar entre sí.

import io
import json
import os

import numpy as np
import onnxruntime as ort
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from huggingface_hub import hf_hub_download
from PIL import Image, ImageOps

MAX_BYTES = 3 * 1024 * 1024
HEAD = {"size": 320, "threshold": 0.4}

app = FastAPI(title="Pet Safe")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("ALLOWED_ORIGINS", "https://andresmaturana-ui.github.io").split(","),
    allow_origin_regex=r"http://localhost(:\d+)?",
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

opts = ort.SessionOptions()
opts.intra_op_num_threads = 2
here = os.path.dirname(os.path.abspath(__file__))
# DINO_DIR permite probar con una copia local del modelo.
dino_file = lambda name: os.path.join(os.environ["DINO_DIR"], name) if os.environ.get("DINO_DIR") else hf_hub_download("Xenova/dinov2-small", name)
head = ort.InferenceSession(os.environ.get("HEAD_MODEL", os.path.join(here, "pet-head.onnx")), opts)
dino = ort.InferenceSession(dino_file("onnx/model_quantized.onnx"), opts)
with open(dino_file("preprocessor_config.json")) as f:
    pre = json.load(f)


async def read_image(file: UploadFile) -> Image.Image:
    data = await file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "Imagen muy grande")
    try:
        return Image.open(io.BytesIO(data)).convert("RGB")
    except Exception:
        raise HTTPException(400, "No es una imagen")


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/detect")
async def detect(image: UploadFile = File(...)):
    """Caja de la cabeza en píxeles de la imagen recibida, o null."""
    img = await read_image(image)
    n = HEAD["size"]
    k = n / max(img.width, img.height)
    w, h = round(img.width * k), round(img.height * k)
    dx, dy = (n - w) / 2, (n - h) / 2
    box = Image.new("RGB", (n, n), (114, 114, 114))
    box.paste(img.resize((w, h), Image.BILINEAR), (round(dx), round(dy)))
    x = (np.asarray(box, np.float32) / 255).transpose(2, 0, 1)[None]
    out = head.run(None, {head.get_inputs()[0].name: x})[0][0]  # [5, N]
    best = int(out[4].argmax())
    score = float(out[4, best])
    if score < HEAD["threshold"]:
        return {"box": None}
    cx, cy, bw, bh = (float(v) for v in out[:4, best])
    bw, bh = bw / k, bh / k
    cx, cy = (cx - dx) / k, (cy - dy) / k
    return {"box": {"x": cx - bw / 2, "y": cy - bh / 2, "w": bw, "h": bh, "head": True}, "score": score}


def cls(img: Image.Image) -> np.ndarray:
    # Mismo preprocesamiento que transformers.js (BitImageProcessor).
    s = pre["size"]["shortest_edge"]
    k = s / min(img.width, img.height)
    img = img.resize((round(img.width * k), round(img.height * k)), Image.BICUBIC)
    c = pre["crop_size"]["height"]
    left, top = (img.width - c) // 2, (img.height - c) // 2
    img = img.crop((left, top, left + c, top + c))
    x = np.asarray(img, np.float32) * pre["rescale_factor"]
    x = (x - np.array(pre["image_mean"], np.float32)) / np.array(pre["image_std"], np.float32)
    out = dino.run(None, {dino.get_inputs()[0].name: x.transpose(2, 0, 1)[None]})[0]
    return out[0, 0]


@app.post("/embed")
async def embed(image: UploadFile = File(...)):
    """Huella DINOv2 (token CLS de la imagen más su espejo, normalizada)."""
    img = await read_image(image)
    v = cls(img) + cls(ImageOps.mirror(img))
    v = v / (np.linalg.norm(v) or 1)
    return {"dino": [round(float(a), 6) for a in v]}
