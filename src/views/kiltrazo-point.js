// "#/punto": Punto Kiltrazo, el punto de reconocimiento facial propio de
// Kiltrazo (sin clínica). Lo abre el administrador desde Admin, y los usuarios
// de la app a quienes él les dio el permiso (desde Perfil).

import { isAdmin, CLOUD } from '../data.js';

export default async function kiltrazoPoint(el, _params, { user }) {
  const { myClinics, kiltrazoPoint: openPoint, isPoint } = await import('../clinic/data.js');
  const { pointScreen } = await import('../clinic/views/point.js');
  await import('../clinic/clinic.css');
  document.body.classList.add('clinic-mode');
  el.className = '';
  const admin = CLOUD ? await isAdmin().catch(() => false) : sessionStorage.getItem('petsafe-admin') === 'ok';
  let mine = user ? (await myClinics(user.id)).find(isPoint) : null;
  if (!mine && admin) {
    await openPoint();
    mine = (await myClinics(user.id)).find(isPoint);
  }
  if (!mine) {
    document.body.classList.remove('clinic-mode');
    el.className = 'view';
    el.innerHTML = `<div class="card"><h1>Punto Kiltrazo</h1>
      <p>Tu cuenta no tiene permiso para usar el punto de reconocimiento facial. Pídeselo al administrador de Kiltrazo.</p>
      <a class="btn primary" href="#/">Ir al inicio</a></div>`;
    return;
  }
  const me = { userId: user.id, role: mine.role };
  const exit = admin ? '<a href="#/admin" class="btn small ghost">Volver a Admin</a>' : '<a href="#/" class="btn small ghost">Salir</a>';
  return pointScreen(el, { clinic: mine, me, exit });
}
