// Notificaciones al celular.
//
// Hoy se muestran con el Service Worker del propio dispositivo. Para que le
// lleguen al dueño en otro celular hace falta un servidor que envíe Web Push
// (el Service Worker ya escucha el evento `push`, ver src/sw.js).

export function notificationsSupported() {
  return 'Notification' in window && 'serviceWorker' in navigator;
}

export async function askPermission() {
  if (!notificationsSupported()) return 'unsupported';
  if (Notification.permission === 'default') return Notification.requestPermission();
  return Notification.permission;
}

export async function pushLocal({ title, body, url }) {
  if (!notificationsSupported() || Notification.permission !== 'granted') return false;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const options = { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url }, vibrate: [120, 60, 120] };
    if (reg) await reg.showNotification(title, options);
    else new Notification(title, options);
    return true;
  } catch (err) {
    console.warn('No se pudo mostrar la notificación', err);
    return false;
  }
}
