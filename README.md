# Pet Safe 🐾

App (PWA) para registrar mascotas con reconocimiento facial y ayudar a que vuelvan a casa si se pierden.
Registrar una mascota es gratis.

## Pantallas

| Pantalla | Qué hace |
| --- | --- |
| **Inicio** | Botones grandes *Perdí mi mascota*, *Encontré una mascota* y *Ya encontré mi mascota*, acceso a *Registrar mascota* y los últimos 6 reencuentros con foto y comentarios. |
| **1 · Registrar mascota** | Registro guiado de 5 capturas de la cara en distintos ángulos más una de la nariz (cámara o fotos de la galería, con el mismo control de calidad) y luego pide nombre de la mascota, nombre del dueño, enfermedades y vacunas. |
| **Perdí mi mascota** | Activa el aviso y busca entre los avisos de "encontré". Si hay coincidencia, notifica al dueño. |
| **2 · Mascota encontrada** | Solo para el dueño: llamar o escribir por WhatsApp a quien la encontró, mapa con la ubicación y botones *cómo llegar* en auto, bicicleta, a pie o transporte. |
| **3 · Encontré una mascota** | Escanea la cara. Si está registrada se avisa al dueño y al que la encontró **solo** se le muestran vacunas y enfermedades (ningún dato del dueño, para evitar pedidos de recompensa). |
| **Ya encontré mi mascota** | Quita el aviso y publica el reencuentro en el inicio. |
| **Administrador** | Modificar, cerrar o eliminar alertas, enviar mensajes a un usuario o a todos, moderar reencuentros y comentarios. PIN de prueba: `1234` (cambiar con `VITE_ADMIN_PIN`). |

## Cómo correrla

```bash
npm install
npm run dev      # desarrollo, abre http://localhost:5173
npm run build    # versión de producción en dist/
```

La cámara y las notificaciones requieren HTTPS (o `localhost`). Al hacer push a `main` se publica en GitHub Pages
(activar en *Settings → Pages → Source: GitHub Actions*).

## Estado del prototipo

- **Reconocimiento facial** (`src/biometrics.js`), en el propio celular con transformers.js:
  1. *Detección*: un detector YOLO11n propio (`public/models/pet-head.onnx`) encuentra la cabeza y se recorta
     justo la cara. Si ese archivo no está o no ve una cabeza, YOLOS-tiny (COCO) busca al animal completo.
  2. *Huella*: DINOv2-small convierte el recorte en un vector de 384 números (token CLS, con la imagen y su espejo).
  3. *Búsqueda*: similitud coseno con pgvector en Supabase (o en el navegador en modo local), contra cada ángulo guardado.

  Cada captura pasa un control de luz, nitidez y "¿es una mascota?"; al final se revisa que las 5 sean del mismo
  animal. También se guarda una foto de la nariz (opcional): si las narices se parecen mucho, alcanza con una cara
  algo menos parecida. Los modelos (~40 MB) se descargan la primera vez. El umbral de DINOv2 (0.78) es inicial y
  hay que calibrarlo con pruebas reales. Próximo paso: ajuste fino con metric learning
  (ArcFace). Si los modelos no se pueden descargar, se usa un descriptor simple de
  color (mucho menos preciso).
- **Servidor de reconocimiento (opcional)**: `server/` hace la detección y la huella en un servidor (un Space
  gratis de Hugging Face o un VPS), así el celular no descarga los modelos. Se activa con `VITE_BIO_SERVER` en
  `.env.production`; si el servidor no responde, la app vuelve a hacerlo en el celular. Da las mismas huellas que
  el celular (mismos modelos ONNX), así que los registros de uno y otro se pueden comparar.
- **Entrenar el detector de cabezas**: abrir
  [`training/entrenar_detector.ipynb` en Colab](https://colab.research.google.com/github/andresmaturana-ui/petsafe/blob/main/training/entrenar_detector.ipynb),
  elegir GPU y *Ejecutar todo*. Usa Oxford-IIIT Pet (cajas de cabezas) y Ultralytics YOLO11n (AGPL-3.0); al final
  descarga `pet-head.onnx` (entrada 320x320, salida `[1, 5, 2100]`), que va en `public/models/`. Al activarlo cambia
  el recorte de la cara, así que conviene registrar de nuevo las mascotas de prueba.
- **Datos**: con Supabase configurado (`VITE_SUPABASE_URL` y `VITE_SUPABASE_KEY` en `.env.production`) se
  comparten entre celulares (`src/data-remote.js`); si no, se guardan en el navegador (IndexedDB,
  `src/data-local.js`) y en *Perfil → Agregar otro usuario* se simula al dueño y a quien encuentra en un mismo celular.

## Supabase

1. Crear el proyecto y activar *Authentication → Sign In / Providers → Allow anonymous sign-ins*.
2. Pegar `supabase/schema.sql` en *SQL Editor* y ejecutarlo (se puede repetir sin problemas). Crea las tablas,
   las reglas de seguridad y las funciones de búsqueda biométrica (pgvector).
3. Poner la *Project URL* y la clave *publishable/anon* en `.env.production`. Son públicas por diseño; nunca usar
   la clave *secret/service_role* en la app.
4. El primer usuario que entra a *Administrador* y toca "Soy el administrador" queda como admin.

Quien encuentra una mascota nunca puede leer datos del dueño: la comparación biométrica y la respuesta con los
cuidados ocurren en la base de datos (`report_found`), y las reglas RLS solo dejan ver cada aviso a quien lo hizo,
al dueño de la mascota que coincidió y al administrador.
- **Notificaciones**: se muestran con el Service Worker del dispositivo. El Service Worker ya escucha `push`;
  falta el servidor que envíe Web Push al celular del dueño.
- **Búsqueda de pago**: pendiente para una versión futura.

## Licencia

AGPL-3.0 (ver `LICENSE`). El detector de cabezas se entrena con Ultralytics YOLO, que usa esta misma licencia:
quien publique una versión modificada de la app debe compartir su código.
