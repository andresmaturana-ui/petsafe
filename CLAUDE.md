# Kiltrazo: guía para Claude

Este archivo explica todo el proyecto para que una sesión nueva de Claude Code pueda seguir el trabajo sin
preguntar de nuevo. Última actualización: 5 de octubre de 2026 (después del PR #80).

## Qué es

Kiltrazo (antes "Pet Safe") es una app chilena para que perros y gatos perdidos vuelvan a casa reconociendo su
cara con el celular. Está publicada en **https://kiltrazo.cl** (GitHub Pages; la dirección antigua
https://andresmaturana-ui.github.io/petsafe/ redirige una vez activado el dominio propio en GitHub). El repositorio y algunas claves internas siguen
llamándose `petsafe` a propósito (IndexedDB `petsafe`, caché `petsafe-models`): no renombrarlos, se perderían
datos de los usuarios.

Tres productos sobre la misma app y la misma base de datos:

1. **App para tutores** (gratis siempre): registrar mascotas grabando su cara, "Perdí mi mascota" con alerta a
   vecinos a 5 km, "Encontré una mascota" con reconocimiento facial, placa del collar con QR, Mi veterinaria,
   pedir hora, clínicas cercanas.
2. **Kiltrazo Clínica** (`#/clinica`): software veterinario para computador y celular. Agenda, fichas, vacunas,
   solicitudes de hora, veterinario a domicilio, página pública de la clínica, buscador `#/veterinarios`,
   publicidad. Gratis en piloto, será de pago.
3. **Kiltrazo Municipal** (`#/municipio`): las mismas pantallas de Clínica con `clinics.kind = 'municipio'`.
   Operativos con reserva pública, registro de animales, perdidos y encontrados de la comuna, ayuda para el
   Registro Nacional de Mascotas.

## Quién es el usuario y cómo trabajar con él

- **Andrés** (GitHub `andresmaturana-ui`) es el fundador. Escribe en español de Chile: responderle **siempre en
  español**, sencillo, sin jerga técnica.
- Quiere todo **simple e intuitivo**, para tutores y para el personal de las clínicas. No complicar flujos.
- **Antes de mezclar un cambio de pantalla, mostrarle capturas** (celular y computador) y esperar su OK, salvo
  que diga explícitamente que se publique sin verlas.
- Prueba en un **iPhone 11**: cuidar la memoria (liberar canvas por cuadro, un solo motor ONNX).
- Regla de redacción: en textos de la app, posts y manuales decir **"reconocimiento facial para volver a
  casa"** en vez de "escaneo"/"escanear" donde calce.
- Mezclar PRs con **"Merge pull request" normal (merge commit), nunca squash**: hay enlaces manuales a commits.
- Andrés no puede abrir `.sql` en el celular: cuando deba correr SQL, entregarle un `.txt` (los bloques de código
  largos se cortan al copiar).
- Colores cálidos y amigables (coral, naranjo, sol, verde sobre crema; fuente Nunito).

## Cómo correrla

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # dist/
```

No hay tests automáticos ni linter; validar con `npm run build` y, para pantallas, con Playwright (Chromium está
en `/opt/pw-browsers` en las sesiones en la nube). Al hacer push a `main` se publica sola
(`.github/workflows/deploy.yml`). Si un usuario tiene una versión vieja abierta, `src/main.js` recarga la app
una vez cuando falla un módulo (PR #62).

Sin `VITE_SUPABASE_URL`/`VITE_SUPABASE_KEY` la app funciona en **modo local** (IndexedDB, `src/data-local.js`,
`src/clinic/data-local.js`), útil para capturas. Con ellas (`.env.production`) usa Supabase
(`src/data-remote.js`, `src/clinic/data-remote.js`). `src/data.js` y `src/clinic/data.js` eligen uno u otro:
**mantener las mismas funciones en ambos**.

Desde el sandbox de Claude normalmente **no se llega** a `*.supabase.co`, `huggingface.co` ni jsDelivr: el modo
nube lo verifica Andrés. Para probar el reconocimiento en Playwright se usan modelos ONNX de prueba servidos con
rutas de Playwright.

## Estructura

| Ruta | Qué hay |
| --- | --- |
| `src/main.js` | Router por hash (`routes`), barras, avisos en vivo, alarma, instalación. `#/clinica`, `#/municipio`, `#/municipal` cargan `src/clinic/` aparte (lazy) |
| `src/views/` | Pantallas de la app: `home`, `register`, `lost`, `found`, `tag` (`#/placa`), `match`, `profile`, `admin`, `landing` (`#/kiltrazo`), `finder` (`#/veterinarios`), `clinic-page` (`#/c/:slug`), `drive` (`#/operativo/:id`), `receive`/`gift` (traspasos), `privacy`, `terms`, etc. |
| `src/clinic/` | Kiltrazo Clínica y Municipal: `index.js` (router interno, modo municipio), `views/` (agenda, pacientes, ficha, solicitudes, equipo, vacunas, operativos `drives`, tablero `board`), `muni.js`, `rnm.js`, `eta.js` (hora de llegada OSRM), `review.js` (RUT y título), `clinic.css` (prefijo `ck-`) |
| `src/biometrics.js` | Reconocimiento: detector de cabezas + DINOv2, en el celular o en `VITE_BIO_SERVER` |
| `src/scanner.js` | Captura en video tipo Face ID (cuadros automáticos, anillo de avance, paso de nariz) |
| `src/nearby.js` | Alertas de perdidos a 5 km (zona redondeada a ~1 km, con permiso) |
| `src/notify.js`, `src/sw.js`, `src/alarm.js` | Notificaciones push, service worker, alarma cuando encuentran la mascota |
| `src/live.js` | Refresco automático de pantallas sin parpadeo |
| `src/move.js` | Mudanza de sesión de github.io a kiltrazo.cl |
| `src/seo.js`, `src/analytics.js`, `seo.config.js` | SEO, sitemap, JSON-LD; GA4/Meta solo con consentimiento y si hay ID |
| `src/config.js` | Variables (`VITE_*`), versiones de textos legales (`PROMOS_VERSION`, `TERMS_VERSION`) |
| `supabase/schema.sql` | **Todo** el backend: tablas, RLS, funciones RPC, triggers, pg_cron. Idempotente |
| `supabase/functions/send-push/` | Edge Function que envía Web Push (secretos `VAPID_*`) |
| `server/` | Servidor de reconocimiento FastAPI + Docker, **sin publicar** (no hay hosting gratis) |
| `training/` | Colab: `entrenar_detector.ipynb` (YOLO11n), `medir_reconocimiento.ipynb` (DogFaceNet) |
| `public/models/pet-head.onnx` | Detector de cabezas propio (entrada 320, salida `[1,5,2100]`) |
| `public/manuales/` | Manuales PDF descargables desde la app (actualizarlos si cambian las pantallas) |

## Backend (Supabase)

- Proyecto `zzudsvwqskypviqruevb`. Usuarios anónimos por dispositivo; "Guarda tu cuenta" les agrega correo y
  clave. "Confirm email" está apagado (límite de correos del plan gratis).
- **Cada cambio de `schema.sql` lo tiene que volver a correr Andrés** en el SQL Editor
  (https://supabase.com/dashboard/project/zzudsvwqskypviqruevb/sql/new, "Run and enable RLS"). Avisarle siempre y
  darle el archivo como `.txt`. El script debe poder correrse muchas veces sin borrar datos.
- Supabase corre con **pg_safeupdate**: todo `DELETE`/`UPDATE` dentro de funciones necesita `WHERE` (en tablas
  temporales, `where true`). Un Postgres local no detecta esto.
- Probar el SQL en un Postgres 16 local con pgvector antes de entregarlo.
- Administrador: el primero que toca "Soy el administrador" (o cuyo correo está en `admin_emails`). Se resetea
  borrando de `public.admins`. En computador: `#/perfil` → "Entrar con mi correo y clave" → `#/admin`.
- Nunca poner la clave `service_role` en la app. La URL y la clave publishable de `.env.production` son públicas.

## Reconocimiento

1. Detector de cabezas propio (YOLO11n entrenado en Colab con Ultralytics, AGPL-3.0) recorta la cara.
2. DINOv2-small (cuantizado, desde Hugging Face) da un vector de 384 números.
3. `pgvector` compara contra todos los ángulos guardados, filtrando por especie.
4. Alerta automática con similitud ≥ 0.78 si la mascota está perdida; ≥ 0.86 (`unlost_threshold`) si no lo está.
   Con menos, sugerencia "¿Es esta?".

Medido el 1 de octubre de 2026 con DogFaceNet (1.393 perros, 8.363 fotos; Mougeot, Li y Jia, PRICAI 2019):
96% llega al dueño, 92,9% primero, 97,3% entre los 5 primeros, 98% cabeza detectada, 3,9% alertas equivocadas
(1,5% con 0.86).

Pendientes: afinar el modelo con caras de mascotas; **reemplazar el detector entrenado con Ultralytics por uno de
licencia permisiva antes de cobrar**; no usar PetFace (solo uso no comercial); publicar `server/` cuando haya
hosting (créditos de nube) y poner su dirección en `VITE_BIO_SERVER`.

## Privacidad y legal

- Quien encuentra nunca ve datos del dueño (solo vacunas y enfermedades); lo resuelve `report_found` en la base.
- Promociones con casilla aparte, sin marcar, con fecha y versión (`consent_log`); nunca se comparte la base.
  Ley 21.719 rige desde el 1 de diciembre de 2026.
- Crear clínica pide RUT del veterinario, título y patente; Kiltrazo aprueba antes de mostrarla. Los términos
  (`#/terminos`) los redactó Claude: un abogado debe revisarlos antes de cobrar.

## Estado y pendientes (5 de octubre de 2026)

- Dominio kiltrazo.cl en Cloudflare (DNS only) → GitHub Pages. Falta que Andrés marque Custom domain + Enforce
  HTTPS en Settings → Pages si aún no lo hizo.
- Push funciona (función `send-push`, trigger con `pg_net`); conviene probar en más celulares.
- Kiltrazo Clínica fase 2 (documentos, consentimientos, hospitalización) no está hecha. Municipal fase 2
  (denuncias) y 3 (adopciones, estadísticas) tampoco.
- Ideas en espera de Andrés: esconder funciones de clínica hasta que el tutor escanee un QR de clínica;
  "Encontré una mascota" sin perfil completo (hoy solo `#/placa` funciona sin cuenta); estrellas de reseñas
  después de visitas reales; otros países (hoy todo está en español de Chile, `wa.me` agrega +56, mapa en
  Santiago).
- Negocio: app gratis para tutores; cobran Clínica, Municipal, publicidad y placas. Fondos en evaluación:
  Corfo Semilla Inicia (exige cero ventas) y Start-Up Chile Build.
