---
title: Pet Safe
emoji: 🐾
colorFrom: yellow
colorTo: red
sdk: docker
app_port: 7860
license: agpl-3.0
---

Servidor de reconocimiento de [Pet Safe](https://github.com/andresmaturana-ui/petsafe):
detecta la cabeza de la mascota y calcula su huella con DINOv2, para que la app
no tenga que descargar los modelos al celular.

## Dónde correrlo

**Hugging Face (gratis):** crear un Space tipo *Docker* (plantilla en blanco) y subir
estos archivos (`Dockerfile`, `app.py`, `requirements.txt`, `README.md`). La
dirección queda como `https://<usuario>-<space>.hf.space`. Si nadie lo usa en 48
horas se duerme y la primera foto tarda cerca de un minuto.

**Un VPS (por ejemplo Hostinger KVM):** con Docker instalado,

    docker build -t petsafe-bio .
    docker run -d --restart unless-stopped -p 7860:7860 petsafe-bio

y ponerle HTTPS (por ejemplo con Caddy o Nginx), porque la app se abre por HTTPS.

Luego, en la app, poner la dirección en `.env.production`:

    VITE_BIO_SERVER=https://...

Para otro dominio que no sea andresmaturana-ui.github.io, definir la variable
`ALLOWED_ORIGINS` (separados por coma).
