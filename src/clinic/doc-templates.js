// Plantillas de documentos de la clínica: consentimientos, receta y
// certificados. El texto se llena con los datos de la mascota y del tutor, y
// la clínica lo puede ajustar antes de crearlo.

import { SPECIES } from '../breeds.js';

// sign: lo firma el tutor. vet: solo un veterinario lo hace (y lo firma él).
// fields: datos que se piden en el formulario y se usan en el texto.
export const DOC_KINDS = {
  consentimiento_cirugia: {
    name: 'Cirugía y anestesia', icon: '🩺', sign: true, title: 'Consentimiento para cirugía y anestesia',
    fields: [['procedimiento', 'Procedimiento', 'Ej.: esterilización, extracción dental, cirugía de rodilla', true]],
    body: `Yo, quien firma este documento, como tutor/a responsable de {mascota} ({especie}), autorizo a {clinica} y a su equipo veterinario a realizar el siguiente procedimiento: {procedimiento}, incluida la anestesia, los exámenes y los medicamentos que sean necesarios.

Me explicaron en qué consiste, por qué se recomienda, qué alternativas hay y cuáles son sus riesgos. Entiendo que toda anestesia y cirugía tiene riesgos, incluso en animales sanos, como reacciones a medicamentos, sangrado, infección y, en casos poco frecuentes, la muerte.

Si durante el procedimiento surge una complicación o un hallazgo, autorizo al equipo a hacer lo necesario para proteger la vida y el bienestar de {mascota}, y a informarme apenas sea posible.

Me comprometo a cumplir el ayuno indicado antes de la cirugía y los cuidados posteriores, y a pagar los costos según el presupuesto que me informaron.`,
  },
  consentimiento_hospitalizacion: {
    name: 'Hospitalización', icon: '🏥', sign: true, title: 'Consentimiento para hospitalización',
    fields: [
      ['motivo', 'Motivo', 'Ej.: deshidratación y vómitos', true],
      ['reanimacion', 'Si su vida corre peligro', ['Intentar reanimarlo/a', 'No reanimar'], true],
    ],
    body: `Yo, quien firma este documento, como tutor/a responsable de {mascota} ({especie}), autorizo a {clinica} a hospitalizarlo/a por el siguiente motivo: {motivo}.

Autorizo los tratamientos, exámenes y procedimientos que el equipo veterinario considere necesarios durante la hospitalización. Me informarán de su estado y me consultarán antes de cualquier procedimiento mayor, salvo una urgencia.

Si su vida corre peligro y no alcanzan a ubicarme: {reanimacion}.

Entiendo que, aun con el mejor cuidado, su estado puede empeorar. Me comprometo a pagar los costos de la hospitalización y a retirarlo/a cuando me den el alta.`,
  },
  consentimiento_eutanasia: {
    name: 'Eutanasia', icon: '🕊️', sign: true, title: 'Consentimiento para eutanasia',
    fields: [
      ['motivo', 'Motivo', 'Ej.: insuficiencia renal avanzada', true],
      ['restos', 'Después', ['Me lo/la llevo', 'Cremación individual', 'Cremación colectiva', 'La clínica se encarga'], true],
    ],
    body: `Yo, quien firma este documento, declaro ser tutor/a responsable de {mascota} ({especie}) o estar autorizado/a para decidir por él/ella, y solicito y autorizo a {clinica} a realizar su eutanasia por el siguiente motivo: {motivo}.

Me explicaron que es un procedimiento sin dolor, bajo anestesia, y que es irreversible. Tomo esta decisión de forma libre e informada.

Declaro que en los últimos 15 días {mascota} no ha mordido a ninguna persona ni a otro animal.

Después del procedimiento: {restos}.`,
  },
  receta: { name: 'Receta', icon: '💊', vet: true, title: 'Receta médica' },
  certificado_vacunas: { name: 'Certificado de vacunas', icon: '💉', vet: true, title: 'Certificado de vacunas' },
  certificado_salud: {
    name: 'Certificado de salud', icon: '✈️', vet: true, title: 'Certificado de salud',
    fields: [['destino', 'Para (opcional)', 'Ej.: viaje a Argentina, ingreso a guardería', false]],
    body: `Certifico que hoy examiné a {mascota} ({especie}) y se encuentra clínicamente sano/a, sin signos de enfermedades infecciosas ni parasitarias.{destino_texto}`,
  },
};

const speciesWord = (p) => [SPECIES[p.species] || p.species, p.breed].filter(Boolean).join(', ').toLowerCase() || 'mascota';

/** Texto de la plantilla con los datos puestos. */
export function fillBody(kind, { p, clinic, values = {} }) {
  const k = DOC_KINDS[kind];
  if (!k.body) return '';
  const v = {
    mascota: p.name, especie: speciesWord(p), clinica: clinic.name,
    destino_texto: values.destino ? ` Se extiende para: ${values.destino}.` : '',
    ...values,
  };
  return k.body.replace(/\{(\w+)\}/g, (_, key) => (v[key] ? v[key] : `{${key}}`));
}
