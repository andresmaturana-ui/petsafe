import { registerPet } from '../data.js';
import { mountScanner } from '../scanner.js';
import { esc, toast, go } from '../ui.js';

// Pantalla 1: registrar mascota (escaneo facial + datos).
export default async function register(el, _params, { user }) {
  el.innerHTML = `
    <div class="card">
      <div class="steps"><span class="on">1 · Escanear</span><span>2 · Datos</span></div>
      <h1>Registrar mascota</h1>
      <p>Escanea la cara de tu mascota de frente, con buena luz, hasta que quede registrada su biometría.</p>
      <div id="scanner"></div>
    </div>
    <div class="card" id="details" hidden>
      <h2>Datos de tu mascota</h2>
      <form class="form" id="petform">
        <label>1. Nombre de la mascota<input name="name" required></label>
        <label>2. Nombre del dueño<input name="ownerName" required value="${esc(user.name)}"></label>
        <label>3. Enfermedades<textarea name="diseases" rows="2" placeholder="Ej: alergia al pollo, epilepsia (o 'ninguna')"></textarea></label>
        <label>4. Vacunas<textarea name="vaccines" rows="2" placeholder="Ej: antirrábica 2026, óctuple"></textarea></label>
        <button class="btn primary big">Registrar</button>
      </form>
    </div>`;

  let scan = null;
  mountScanner(el.querySelector('#scanner'), {
    samples: 5,
    label: 'Escanear cara',
    onDone(result) {
      scan = result;
      el.querySelector('.steps span:last-child').classList.add('on');
      const details = el.querySelector('#details');
      details.hidden = false;
      details.scrollIntoView({ behavior: 'smooth' });
      details.querySelector('input').focus({ preventScroll: true });
    },
  });

  el.querySelector('#petform').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!scan) return toast('Primero escanea la cara de tu mascota');
    const f = new FormData(e.target);
    const pet = await registerPet(user, {
      name: f.get('name').trim(),
      ownerName: f.get('ownerName').trim(),
      diseases: f.get('diseases').trim(),
      vaccines: f.get('vaccines').trim(),
      photo: scan.photo,
      biometric: scan.biometric,
    });
    toast(`¡${pet.name} quedó registrada! 🎉`, 'ok');
    go('#/');
  });
}
