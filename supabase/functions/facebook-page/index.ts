// Kiltrazo: publica las mascotas perdidas en la página de Facebook de
// Kiltrazo (si el dueño lo eligió) y borra la publicación cuando vuelven a
// casa o se eliminan.
//
// La base de datos la llama con { pet } cuando cambia el estado de una
// mascota (ver facebook_sync() en supabase/schema.sql). La función mira el
// estado actual y solo publica o borra lo que corresponde, una vez, así que no
// hace falta clave para llamarla.
//
// Abrir la dirección de la función en el navegador (sin datos) revisa la
// conexión con la página y la guarda para que la app muestre la casilla.
//
// Secretos (Supabase → Edge Functions → Secrets): FACEBOOK_PAGE_ID y
// FACEBOOK_PAGE_TOKEN (el token de la página, que no vence).

import { createClient } from 'npm:@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const PAGE = Deno.env.get('FACEBOOK_PAGE_ID') || '';
const TOKEN = Deno.env.get('FACEBOOK_PAGE_TOKEN') || '';
const GRAPH = `https://graph.facebook.com/${Deno.env.get('FACEBOOK_GRAPH_VERSION') || 'v23.0'}`;
const SITE = 'https://kiltrazo.cl';

async function graph(path: string, init: RequestInit = {}) {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${GRAPH}/${path}${sep}access_token=${encodeURIComponent(TOKEN)}`, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error?.message || `Facebook respondió ${res.status}`);
  return data;
}

// Revisa la página y la guarda en app_settings (la app muestra la casilla
// solo si existe).
async function check() {
  if (!PAGE || !TOKEN) return new Response('Faltan los secretos FACEBOOK_PAGE_ID y FACEBOOK_PAGE_TOKEN.', { status: 500 });
  try {
    const page = await graph(`${PAGE}?fields=name,link`);
    await db.from('app_settings').upsert({ key: 'facebook_page', value: page.link || `https://www.facebook.com/${PAGE}` });
    return new Response(`Listo: Kiltrazo publicará en la página "${page.name}".`);
  } catch (err) {
    await db.from('app_settings').delete().eq('key', 'facebook_page');
    return new Response(`No se pudo conectar con la página: ${err.message}`, { status: 500 });
  }
}

// "en Providencia, Santiago" a partir del punto donde se perdió. Si no se
// marcó, la comuna del dueño.
async function sector(lat: number | null, lng: number | null, owner: string) {
  if (lat != null && lng != null) {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&accept-language=es&lat=${lat}&lon=${lng}`,
        { headers: { 'User-Agent': 'Kiltrazo (https://kiltrazo.cl)' }, signal: AbortSignal.timeout(8000) },
      );
      const a = (await res.json())?.address || {};
      const parts = [a.suburb || a.neighbourhood || a.quarter, a.city || a.town || a.village || a.municipality]
        .filter(Boolean);
      if (parts.length) return [...new Set(parts)].join(', ');
    } catch (err) {
      console.error('sector', err);
    }
  }
  const { data } = await db.from('profiles').select('comuna').eq('id', owner).maybeSingle();
  return data?.comuna || '';
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

async function message(pet: Record<string, any>) {
  const what = [pet.species && pet.species !== 'otro' ? pet.species : '', pet.breed].filter(Boolean).join(', ');
  const where = await sector(pet.lost_lat, pet.lost_lng, pet.owner_id);
  const when = new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'long', timeZone: 'America/Santiago' })
    .format(new Date(pet.lost_at || Date.now()));
  return [
    `🐾 SE BUSCA: ${pet.name}`,
    '',
    `${what ? `${cap(what)}. ` : ''}Se perdió el ${when}${where ? ` en ${where}` : ''}.`,
    '',
    `¿La viste? Usa el reconocimiento facial para volver a casa: entra a ${SITE}/vi/ , filma su carita y le avisamos a su dueño al instante. No necesitas crear cuenta.`,
    '',
    'Comparte para que vuelva pronto a casa 🧡',
    '#MascotaPerdida #Kiltrazo',
  ].join('\n');
}

async function photo(src: string) {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(src || '');
  if (!m) return null;
  const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: m[1] });
}

async function publish(pet: Record<string, any>) {
  // Se reserva la fila antes de publicar para no publicar dos veces.
  const { data: claimed } = await db.from('facebook_posts').insert({ pet_id: pet.id }).select().maybeSingle();
  if (!claimed) return 'ya publicada';
  try {
    const form = new FormData();
    form.set('message', await message(pet));
    form.set('published', 'true');
    const img = await photo(pet.photo);
    if (img) form.set('source', img, 'mascota.jpg');
    else if (/^https?:/.test(pet.photo || '')) form.set('url', pet.photo);
    const post = img || pet.photo
      ? await graph(`${PAGE}/photos`, { method: 'POST', body: form })
      : await graph(`${PAGE}/feed`, { method: 'POST', body: form });
    await db.from('facebook_posts').update({ post_id: post.post_id || post.id }).eq('pet_id', pet.id);
    return 'publicada';
  } catch (err) {
    await db.from('facebook_posts').delete().eq('pet_id', pet.id);
    throw err;
  }
}

async function remove(petId: string) {
  const { data: row } = await db.from('facebook_posts').delete().eq('pet_id', petId).select().maybeSingle();
  if (!row?.post_id) return 'nada que borrar';
  try {
    await graph(row.post_id, { method: 'DELETE' });
  } catch (err) {
    // Si ya no existe (la borraron a mano), está bien.
    if (!/does not exist|Unsupported delete|cannot be loaded/i.test(err.message)) {
      await db.from('facebook_posts').insert(row);
      throw err;
    }
  }
  return 'borrada';
}

Deno.serve(async (req) => {
  if (req.method === 'GET') return check();
  const { pet: petId } = await req.json().catch(() => ({}));
  if (!petId) return new Response('Falta pet', { status: 400 });
  if (!PAGE || !TOKEN) return Response.json({ skipped: 'sin página configurada' });

  const { data: pet } = await db.from('pets').select('*').eq('id', petId).maybeSingle();
  try {
    const want = pet && pet.status === 'lost' && pet.fb_share;
    const done = want ? await publish(pet) : await remove(petId);
    return Response.json({ done });
  } catch (err) {
    console.error('facebook', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
});
