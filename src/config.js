// Conexión a Supabase. La URL y la clave "publishable/anon" son públicas por
// diseño (van dentro de la app); la seguridad la ponen las reglas RLS de
// supabase/schema.sql. Si están vacías, la app guarda todo en este navegador.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY || '';

export const CLOUD = Boolean(SUPABASE_URL && SUPABASE_KEY);

// Servidor de reconocimiento (server/, un Space gratis de Hugging Face). Si
// está, el celular no descarga los modelos; si falla, se usan en el celular.
export const BIO_SERVER = (import.meta.env.VITE_BIO_SERVER || '').replace(/\/+$/, '');
