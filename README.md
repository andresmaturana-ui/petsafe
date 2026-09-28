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

- **Reconocimiento facial**: MobileNet v2 (TensorFlow.js) genera una huella numérica de la cara en el propio
  celular y se compara por similitud (`src/biometrics.js`). Cada captura pasa un control de luz, nitidez y
  "¿es una mascota?"; al final se revisa que las 5 sean del mismo animal, y la búsqueda compara contra
  cada ángulo guardado. También se guarda una foto de la nariz (opcional): si las narices se parecen mucho,
  alcanza con una cara algo menos parecida. Es un modelo genérico: sirve para probar el flujo,
  pero para producción conviene entrenar uno específico de caras de perros y gatos. Si el modelo no se puede
  descargar, se usa un descriptor simple de color (mucho menos preciso).
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
