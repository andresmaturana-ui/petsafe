import found from './found.js';

// Página del QR de la placa del collar (…/#/placa). Es "Encontré una mascota"
// sin cuenta ni perfil: quien encontró la mascota escanea su cara y deja un
// teléfono. Así prueba Kiltrazo y sabemos cuántos llegaron por la placa.
export default function tag(el, params, ctx) {
  return found(el, { ...params, placa: true }, ctx);
}

// …/#/vi (y kiltrazo.cl/vi/): quien vio una mascota perdida publicada en la
// página de Facebook de Kiltrazo.
export function seen(el, params, ctx) {
  return found(el, { ...params, facebook: true }, ctx);
}
