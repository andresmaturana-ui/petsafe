# Pet Safe 🐾

App (PWA) para registrar mascotas con reconocimiento facial y ayudar a que vuelvan a casa si se pierden.
Registrar una mascota es gratis.

## Pantallas

| Pantalla | Qué hace |
| --- | --- |
| **Inicio** | Botones grandes *Perdí mi mascota*, *Encontré una mascota* y *Ya encontré mi mascota*, acceso a *Registrar mascota* y los últimos 6 reencuentros con foto y comentarios. |
| **1 · Registrar mascota** | Registro guiado de 5 capturas en distintos ángulos (cámara o fotos de la galería, con el mismo control de calidad) y luego pide nombre de la mascota, nombre del dueño, enfermedades y vacunas. |
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
  cada ángulo guardado. Es un modelo genérico: sirve para probar el flujo,
  pero para producción conviene entrenar uno específico de caras de perros y gatos. Si el modelo no se puede
  descargar, se usa un descriptor simple de color (mucho menos preciso).
- **Datos**: se guardan en el navegador (IndexedDB, `src/db.js`). Para que funcione entre distintos celulares
  hay que conectar un backend (Supabase o Firebase) detrás de las mismas funciones de `src/data.js`.
  Mientras tanto, en *Perfil → Agregar otro usuario* se puede simular al dueño y a quien encuentra en un mismo celular.
- **Notificaciones**: se muestran con el Service Worker del dispositivo. El Service Worker ya escucha `push`;
  falta el servidor que envíe Web Push al celular del dueño.
- **Búsqueda de pago**: pendiente para una versión futura.
