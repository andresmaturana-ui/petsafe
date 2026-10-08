import { SUPPORT_URL } from '../config.js';
import { esc } from '../ui.js';
import { analyticsOn, cookieChoice, setCookieChoice } from '../analytics.js';

// Casilla de ofertas: aparte, opcional y siempre desmarcada al comienzo
// (Ley 21.719: consentimiento expreso, informado y específico). Si cambia el
// texto, subir PROMOS_VERSION en src/config.js.
export const promosBox = (checked = false) => `
  <label class="consent">
    <input type="checkbox" name="promos" ${checked ? 'checked' : ''}>
    <span>Quiero recibir ofertas y novedades útiles para mi mascota (veterinarias, tiendas y servicios de mi comuna), por correo o WhatsApp. Kiltrazo las envía y <strong>nunca entrega mis datos</strong> a esas empresas. Es opcional y puedo darme de baja cuando quiera desde mi perfil.</span>
  </label>`;

// Aporte voluntario: no cambia nada en la app y no se pide nunca como condición.
export const supportCard = () => `
  <div class="card support">
    <h2>Apoya a Kiltrazo 💛</h2>
    <p>Kiltrazo es gratis y lo mantiene una persona. Si te sirvió, puedes ayudar con un aporte voluntario para pagar el servidor y seguir mejorándolo.</p>
    <a class="btn secondary" href="${esc(SUPPORT_URL)}" target="_blank" rel="noopener">Hacer un aporte</a>
    <p class="muted small">Es voluntario: la app sigue igual de completa aunque no aportes.</p>
  </div>`;

// Política de privacidad: qué datos se piden, para qué, quién los ve y cómo
// ejercer los derechos de la Ley 19.628 y la Ley 21.719.
export default async function privacy(el) {
  el.innerHTML = `
    <div class="card legal">
      <h1>Política de privacidad</h1>
      <p class="muted small">Vigente desde el 1 de octubre de 2026.</p>

      <h2>Quién es responsable</h2>
      <p>El administrador de Kiltrazo es responsable de tus datos. Puedes escribirle desde la app en Perfil → "Ayuda".</p>

      <h2>Qué datos pedimos</h2>
      <ul>
        <li>Tuyos: nombres, apellidos, teléfono, correo, dirección y comuna.</li>
        <li>De tu mascota: nombre, tipo, raza, vacunas, enfermedades, fotos y la huella biométrica de su cara y nariz.</li>
        <li>De los avisos: la ubicación que entregas al reportar una mascota perdida o encontrada.</li>
        <li>Solo si activas los avisos de mascotas perdidas cerca: tu zona aproximada (redondeada a unos 1 km), nunca tu ubicación exacta.</li>
      </ul>

      <h2>Para qué los usamos</h2>
      <ul>
        <li>Para reconocer a tu mascota y avisarte si alguien la encuentra.</li>
        <li>Para que el dueño de una mascota que encontraste pueda contactarte.</li>
        <li>Si reportas tu mascota como perdida y marcas dónde se perdió, para avisar a las personas que estén a 5 km o menos. Ellas ven su foto, su nombre y la zona aproximada, nunca tus datos.</li>
        <li>Solo si lo eliges al avisar que se perdió: su foto, su nombre y el sector se publican en la página de Facebook de Kiltrazo y en su Instagram, nunca tus datos. La publicación se borra cuando vuelve a casa o si eliminas la mascota.</li>
        <li>Solo si lo activaste: tu zona aproximada, para avisarte de mascotas perdidas a 5 km o menos. Nadie más la ve (ni el administrador) y se borra al desactivarlo en tu perfil.</li>
        <li>Tu comuna, para avisarte de los operativos de tu municipalidad (vacunación, esterilización, microchip). La municipalidad solo sabe a cuántas personas se avisó, nunca quiénes son.</li>
        <li>Solo si lo permitiste al registrar a tu mascota: para mejorar el reconocimiento de mascotas con las fotos de su escaneo. Esas fotos solo las ve el administrador y se borran si eliminas a tu mascota.</li>
        <li>Solo si marcaste la casilla: para enviarte ofertas y novedades útiles para tu mascota. Puedes darte de baja cuando quieras desde tu perfil, y eso no cambia nada más en la app.</li>
      </ul>

      <h2>Quién los ve</h2>
      <ul>
        <li>Si encuentras una mascota, su dueño ve tu nombre y teléfono para coordinar la entrega. Quien encuentra a tu mascota no ve tus datos.</li>
        <li>El correo, la dirección y la comuna solo los ve el administrador de Kiltrazo.</li>
        <li>No vendemos ni entregamos tus datos a empresas. Si recibes una oferta, la envía Kiltrazo.</li>
        <li>Los datos se guardan en Supabase, un servicio de base de datos en la nube que Kiltrazo usa para funcionar.</li>
      </ul>

      <h2>Cookies y estadísticas</h2>
      ${analyticsOn ? `
      <p>Solo si aceptas en el aviso de cookies, Kiltrazo usa Google Analytics y el píxel de Meta (Facebook e Instagram). Sirven para saber cuántas personas usan la app, qué pantallas visitan y si llegaron por un anuncio nuestro. Ellos reciben datos técnicos de tu navegador y el nombre de la pantalla que ves, nunca tus datos, los de tu mascota, sus fotos ni las fichas de la veterinaria.</p>
      <p>Es opcional y no cambia nada en la app. Ahora: <b data-cookie-now>${cookieChoice() === 'si' ? 'aceptadas' : 'rechazadas'}</b>.</p>
      <button type="button" class="btn small secondary" data-cookies>${cookieChoice() === 'si' ? 'Dejar de usarlas' : 'Aceptarlas'}</button>`
      : '<p>Kiltrazo no usa cookies de publicidad ni de estadísticas. Solo guarda en tu navegador lo necesario para que la app funcione (tu sesión y tus preferencias).</p>'}

      <h2>Tus derechos</h2>
      <p>Puedes pedir acceso a tus datos, corregirlos, borrarlos, oponerte a su uso para ofertas y pedir una copia. Tus datos y mascotas los puedes editar o eliminar en tu perfil. Para lo demás, escríbele al administrador desde la app.</p>

      <h2>Cuánto tiempo los guardamos</h2>
      <p>Mientras tengas tu cuenta. Si eliminas una mascota, se borran sus datos y su biometría.</p>

      <h2>Cambios</h2>
      <p>Si esta política cambia, lo avisaremos en la app. Para usar tus datos en algo nuevo te pediremos permiso otra vez.</p>
    </div>
    ${SUPPORT_URL ? supportCard() : ''}`;
  el.querySelector('[data-cookies]')?.addEventListener('click', () => {
    setCookieChoice(cookieChoice() !== 'si');
    privacy(el);
  });
}
