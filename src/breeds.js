// Tipos de mascota y razas frecuentes, para sugerir al escribir.
// La raza es libre: si no está en la lista se escribe igual.

export const SPECIES = { perro: 'Perro', gato: 'Gato', otro: 'Otro' };

const BREEDS = {
  perro: [
    'Mestizo (quiltro)', 'Beagle', 'Bichón frisé', 'Border collie', 'Bóxer', 'Bulldog francés', 'Bulldog inglés',
    'Chihuahua', 'Cocker spaniel', 'Dachshund (salchicha)', 'Doberman', 'Fox terrier', 'Golden retriever',
    'Husky siberiano', 'Jack Russell terrier', 'Labrador retriever', 'Maltés', 'Pastor alemán',
    'Pastor australiano', 'Pequinés', 'Pinscher', 'Pit bull', 'Poodle', 'Pomerania', 'Pug', 'Rottweiler',
    'Schnauzer', 'Shar pei', 'Shih tzu', 'Weimaraner', 'Yorkshire terrier',
  ],
  gato: [
    'Mestizo', 'Angora', 'Azul ruso', 'Bengalí', 'Bosque de Noruega', 'British shorthair', 'Esfinge',
    'Maine coon', 'Persa', 'Ragdoll', 'Scottish fold', 'Siamés',
  ],
};

/** Opciones <option> para la raza según el tipo. */
export const breedOptions = (species) =>
  (BREEDS[species] || []).map((b) => `<option value="${b}"></option>`).join('');

/** "Perro · Labrador retriever", o '' si no hay datos. */
export const describe = (pet) =>
  [SPECIES[pet?.species], pet?.breed].filter(Boolean).join(' · ');
