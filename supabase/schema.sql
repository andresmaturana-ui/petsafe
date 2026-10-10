-- Kiltrazo: base de datos en Supabase.
-- Pegar completo en Supabase → SQL Editor → "Run". Se puede volver a correr sin problemas.

create extension if not exists vector with schema extensions;

-- ---------- Tablas ----------

create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null,
  phone text not null,
  created_at timestamptz not null default now()
);

-- Datos personales: solo los ven la misma persona y el administrador (RLS abajo).
alter table public.profiles add column if not exists first_name text not null default '';
alter table public.profiles add column if not exists last_name text not null default '';
alter table public.profiles add column if not exists email text not null default '';
alter table public.profiles add column if not exists address text not null default '';

-- Promociones: solo si la persona marca la casilla (Ley 21.719: consentimiento
-- expreso, informado y específico). promos_at y promos_version los pone el
-- trigger de abajo; cada cambio queda en consent_log como respaldo.
alter table public.profiles add column if not exists promos boolean not null default false;
alter table public.profiles add column if not exists promos_at timestamptz;
alter table public.profiles add column if not exists promos_version text not null default '';

create table if not exists public.consent_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  kind text not null,
  granted boolean not null,
  version text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.admins (
  user_id uuid primary key references auth.users on delete cascade
);

create table if not exists public.pets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  owner_name text not null,
  diseases text not null default '',
  vaccines text not null default '',
  photo text,
  status text not null default 'home' check (status in ('home', 'lost')),
  lost_at timestamptz,
  recovered_at timestamptz,
  created_at timestamptz not null default now()
);

-- Tipo (perro, gato, otro o '' si no se sabe) y raza: ayudan a descartar
-- candidatos en la búsqueda.
alter table public.pets add column if not exists species text not null default '';
alter table public.pets add column if not exists breed text not null default '';

-- Fotos del escaneo para entrenar el reconocimiento: solo si el dueño da permiso
-- al registrar. Los recortes van al bucket privado "entrenamiento" (abajo), en
-- una carpeta por mascota; train_photos cuenta cuántos se subieron.
alter table public.pets add column if not exists train_ok boolean not null default false;
alter table public.pets add column if not exists train_at timestamptz;
alter table public.pets add column if not exists train_photos int not null default 0;

-- Dónde se perdió (lo marca el dueño en el mapa) y a cuántas personas cerca se
-- les avisó. Se borra cuando la mascota vuelve a casa.
alter table public.pets add column if not exists lost_lat double precision;
alter table public.pets add column if not exists lost_lng double precision;
alter table public.pets add column if not exists lost_alerted_at timestamptz;
alter table public.pets add column if not exists lost_alerted int not null default 0;
-- Publicación en la página de Facebook de Kiltrazo mientras está perdida.
alter table public.pets add column if not exists fb_share boolean not null default false;

-- Huellas biométricas: una fila por captura (y el promedio). Nadie las lee
-- directamente; solo las funciones de búsqueda.
create table if not exists public.pet_samples (
  id bigint generated always as identity primary key,
  pet_id uuid not null references public.pets on delete cascade,
  mobilenet extensions.vector(1280),
  basic extensions.vector(192) not null
);
create index if not exists pet_samples_pet on public.pet_samples (pet_id);
-- 'face' (cara) o 'nose' (nariz, huella nasal).
alter table public.pet_samples add column if not exists kind text not null default 'face';
-- Huella DINOv2 (vector de 384 números).
alter table public.pet_samples add column if not exists dino extensions.vector(384);

create table if not exists public.found_reports (
  id uuid primary key default gen_random_uuid(),
  finder_id uuid default auth.uid() references auth.users on delete set null,
  finder_name text not null,
  finder_phone text not null,
  photo text,
  lat double precision not null,
  lng double precision not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  pet_id uuid references public.pets on delete set null,
  best_score real,
  created_at timestamptz not null default now()
);

alter table public.found_reports add column if not exists species text not null default '';

-- Para medir el reconocimiento (pestaña Reconocimiento del admin): cómo se ligó
-- la mascota ('auto' = la app sola, 'finder' = quien la encontró eligió una
-- sugerida, 'owner' = el dueño la reconoció), el parecido con esa mascota y el
-- parecido con las mascotas propias de quien escaneó (pruebas del dueño).
alter table public.found_reports add column if not exists match_kind text;
alter table public.found_reports add column if not exists match_score real;
alter table public.found_reports add column if not exists own_score real;

-- Desde dónde llegó el aviso: '' = la app, 'placa' = QR de la placa del collar
-- (página #/placa, sin cuenta). Para saber cuántos probaron Kiltrazo por la placa.
alter table public.found_reports add column if not exists source text not null default '';

-- Visitas a la página de la placa (una por dispositivo). Sin datos personales.
create table if not exists public.tag_visits (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now()
);
alter table public.tag_visits enable row level security;

create table if not exists public.found_samples (
  id bigint generated always as identity primary key,
  found_id uuid not null references public.found_reports on delete cascade,
  mobilenet extensions.vector(1280),
  basic extensions.vector(192) not null
);
create index if not exists found_samples_found on public.found_samples (found_id);
alter table public.found_samples add column if not exists kind text not null default 'face';
alter table public.found_samples add column if not exists dino extensions.vector(384);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  type text not null default 'info',
  title text not null,
  body text not null default '',
  url text not null default '#/avisos',
  read boolean not null default false,
  pushed boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user on public.notifications (user_id, created_at desc);

create table if not exists public.successes (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid references public.pets on delete set null,
  pet_name text not null,
  photo text,
  story text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  success_id uuid not null references public.successes on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  author text not null,
  text text not null check (char_length(text) between 1 and 300),
  created_at timestamptz not null default now()
);

-- Zona aproximada de cada persona que pidió avisos de mascotas perdidas cerca
-- (Ley 21.719: solo con su permiso). Se guarda redondeada a ~1 km, nunca la
-- ubicación exacta, y se borra al desactivar los avisos. Solo la usa
-- report_lost para calcular la distancia; nadie más la lee.
create table if not exists public.user_areas (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  lat double precision not null,
  lng double precision not null,
  updated_at timestamptz not null default now()
);
create index if not exists user_areas_lat on public.user_areas (lat);

-- ---------- Funciones de apoyo ----------

-- Correos de administrador: quien entra con uno de estos correos (verificado
-- con el código que llega al correo) es administrador en cualquier dispositivo.
create table if not exists public.admin_emails (
  email text primary key check (email = lower(email))
);
alter table public.admin_emails enable row level security;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where user_id = auth.uid())
    or exists (
      select 1 from admin_emails
      where email = lower(auth.jwt() ->> 'email')
        and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false));
$$;

-- El primer usuario que lo pida queda como administrador.
create or replace function public.claim_admin() returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return false; end if;
  if not exists (select 1 from admins) then
    insert into admins (user_id) values (auth.uid());
  end if;
  return is_admin();
end $$;

-- Para esconder "¿Primera vez?" cuando ya hay administrador (por usuario o por correo).
create or replace function public.admin_exists() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins) or exists (select 1 from admin_emails);
$$;
grant execute on function public.admin_exists() to anon, authenticated;

-- Convierte la plantilla que arma la app ({ dino: {vector, samples}, basic: {...}, nose: {...} })
-- en filas: el promedio y cada captura, de la cara y de la nariz.
drop function if exists public.pet_scores(jsonb);
drop function if exists public.bio_samples(jsonb);
drop function if exists public.samples_from(jsonb);
create function public.samples_from(bio jsonb)
returns table (dino extensions.vector, mobilenet extensions.vector, basic extensions.vector)
language sql immutable set search_path = public, extensions as $$
  select
    case when jsonb_typeof(bio -> 'dino') = 'object'
      then (case when i = 0 then bio -> 'dino' -> 'vector' else bio -> 'dino' -> 'samples' -> (i - 1) end)::text::vector
    end,
    case when jsonb_typeof(bio -> 'mobilenet') = 'object'
      then (case when i = 0 then bio -> 'mobilenet' -> 'vector' else bio -> 'mobilenet' -> 'samples' -> (i - 1) end)::text::vector
    end,
    (case when i = 0 then bio -> 'basic' -> 'vector' else bio -> 'basic' -> 'samples' -> (i - 1) end)::text::vector
  from generate_series(0, jsonb_array_length(coalesce(bio -> 'basic' -> 'samples', '[]'::jsonb))) as i;
$$;

create function public.bio_samples(bio jsonb)
returns table (kind text, dino extensions.vector, mobilenet extensions.vector, basic extensions.vector)
language sql immutable set search_path = public, extensions as $$
  select 'face', s.dino, s.mobilenet, s.basic from samples_from(bio) s
  union all
  select 'nose', s.dino, s.mobilenet, s.basic from samples_from(bio -> 'nose') s
  where jsonb_typeof(bio -> 'nose') = 'object';
$$;

-- Mismos umbrales que src/biometrics.js. dino es un valor inicial a calibrar;
-- mobilenet queda para registros antiguos.
create or replace function public.face_threshold(model text) returns real
language sql immutable as $$
  select (case model when 'dino' then 0.78 when 'mobilenet' then 0.8 else 0.92 end)::real;
$$;

create or replace function public.is_match(score real, model text) returns boolean
language sql immutable as $$
  select score >= face_threshold(model);
$$;

-- Parecido suficiente para mostrarla como "¿es esta?" aunque no alcance para
-- una coincidencia segura. Igual que SUGGEST_MARGIN en src/biometrics.js.
create or replace function public.suggest_threshold(model text) returns real
language sql immutable as $$
  select (face_threshold(model) - 0.15)::real;
$$;

-- Mascota que su dueño no ha marcado como perdida: el aviso automático pide un
-- parecido mucho mayor (con 1.400 perros de prueba, 0.86 bajó los avisos
-- equivocados de 3.9% a 1.5%). Igual que UNLOST_MARGIN en src/biometrics.js.
create or replace function public.unlost_threshold(model text) returns real
language sql immutable as $$
  select (face_threshold(model) + 0.08)::real;
$$;

-- La cara decide; si las narices se parecen mucho, basta con una cara algo
-- menos parecida (por ejemplo, encontrada de lado). Igual que compare() en la app.
create or replace function public.is_pet_match(score real, model text, nose real) returns boolean
language sql immutable as $$
  select is_match(score, model) or (model <> 'basic' and nose >= 0.85 and score >= face_threshold(model) - 0.1);
$$;

-- Parecido de una plantilla con cada mascota registrada (mejor par de capturas),
-- con el mejor descriptor que tengan las dos. nose: parecido de las narices con
-- ese mismo descriptor, nulo si falta alguna.
create function public.pet_scores(bio jsonb)
returns table (pet_id uuid, score real, model text, nose real)
language sql stable security definer set search_path = public, extensions as $$
  with q as (select * from bio_samples(bio)),
  s as (
    select ps.pet_id,
      max(1 - (q.dino <=> ps.dino)) filter (where q.kind = 'face') as d,
      max(1 - (q.mobilenet <=> ps.mobilenet)) filter (where q.kind = 'face') as m,
      max(1 - (q.basic <=> ps.basic)) filter (where q.kind = 'face') as b,
      max(1 - (q.dino <=> ps.dino)) filter (where q.kind = 'nose') as nd,
      max(1 - (q.mobilenet <=> ps.mobilenet)) filter (where q.kind = 'nose') as nm
    from pet_samples ps join q on q.kind = ps.kind
    group by ps.pet_id
  )
  select pet_id, coalesce(d, m, b)::real,
    case when d is not null then 'dino' when m is not null then 'mobilenet' else 'basic' end,
    (case when d is not null then nd when m is not null then nm end)::real
  from s where coalesce(d, m, b) is not null;
$$;
revoke execute on function public.pet_scores(jsonb) from public, anon, authenticated;

-- Un gato nunca es la mascota de un aviso de perro. Si alguno no sabe o es
-- "otro", se compara igual. Mismo criterio que sameSpecies() en data-local.js.
create or replace function public.same_species(a text, b text) returns boolean
language sql immutable as $$
  select coalesce(a, '') in ('', 'otro') or coalesce(b, '') in ('', 'otro') or a = b;
$$;

-- Parecido de una mascota con cada aviso de "encontré" abierto (el inverso de
-- pet_scores).
drop function if exists public.found_scores(uuid);
create function public.found_scores(p_pet uuid)
returns table (found_id uuid, score real, model text, nose real)
language sql stable security definer set search_path = public, extensions as $$
  with ps as (select * from pet_samples where pet_id = p_pet),
  s as (
    select fs.found_id,
      max(1 - (ps.dino <=> fs.dino)) filter (where fs.kind = 'face') as d,
      max(1 - (ps.mobilenet <=> fs.mobilenet)) filter (where fs.kind = 'face') as m,
      max(1 - (ps.basic <=> fs.basic)) filter (where fs.kind = 'face') as b,
      max(1 - (ps.dino <=> fs.dino)) filter (where fs.kind = 'nose') as nd,
      max(1 - (ps.mobilenet <=> fs.mobilenet)) filter (where fs.kind = 'nose') as nm
    from found_samples fs
    join found_reports fr on fr.id = fs.found_id and fr.status = 'open'
      and same_species(fr.species, (select species from pets where id = p_pet))
    join ps on ps.kind = fs.kind
    group by fs.found_id
  )
  select found_id, coalesce(d, m, b)::real,
    case when d is not null then 'dino' when m is not null then 'mobilenet' else 'basic' end,
    (case when d is not null then nd when m is not null then nm end)::real
  from s where coalesce(d, m, b) is not null;
$$;
revoke execute on function public.found_scores(uuid) from public, anon, authenticated;

-- ---------- Acciones de la app ----------

-- Versiones anteriores, sin tipo ni raza.
drop function if exists public.register_pet(text, text, text, text, text, jsonb);
drop function if exists public.report_found(text, jsonb, double precision, double precision, text, text);
drop function if exists public.report_found(text, jsonb, double precision, double precision, text, text, text);

create or replace function public.register_pet(
  p_name text, p_owner_name text, p_diseases text, p_vaccines text, p_photo text, p_bio jsonb,
  p_species text default '', p_breed text default ''
) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare new_id uuid;
begin
  if auth.uid() is null then raise exception 'Sin sesión'; end if;
  insert into pets (owner_id, name, owner_name, diseases, vaccines, photo, species, breed)
  values (auth.uid(), p_name, p_owner_name, coalesce(p_diseases, ''), coalesce(p_vaccines, ''), p_photo,
          coalesce(p_species, ''), left(coalesce(p_breed, ''), 80))
  returning id into new_id;
  insert into pet_samples (pet_id, kind, dino, mobilenet, basic)
  select new_id, s.kind, s.dino, s.mobilenet, s.basic from bio_samples(p_bio) s;
  return new_id;
end $$;

-- "Encontré una mascota". A quien la encontró solo se le devuelven los
-- cuidados (vacunas y enfermedades), nunca datos del dueño.
create or replace function public.report_found(
  p_photo text, p_bio jsonb, p_lat double precision, p_lng double precision, p_name text, p_phone text,
  p_species text default '', p_source text default ''
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  r_id uuid; b_id uuid; b_owner uuid; b_name text; b_diseases text; b_vaccines text;
  own_name text; n int; top real; own_top real; b_score real;
begin
  if auth.uid() is null then raise exception 'Sin sesión'; end if;

  insert into found_reports (finder_id, finder_name, finder_phone, photo, lat, lng, species, source)
  values (auth.uid(), coalesce(p_name, ''), p_phone, p_photo, p_lat, p_lng, coalesce(p_species, ''),
          case when p_source in ('placa', 'facebook') then p_source else '' end) returning id into r_id;
  insert into found_samples (found_id, kind, dino, mobilenet, basic)
  select r_id, s.kind, s.dino, s.mobilenet, s.basic from bio_samples(p_bio) s;

  create temp table if not exists _scores (pet_id uuid, score real, model text, nose real) on commit drop;
  delete from _scores where true; -- Supabase (pg_safeupdate) exige WHERE
  insert into _scores select s.* from pet_scores(p_bio) s join pets p on p.id = s.pet_id
  where same_species(p.species, p_species);

  select p.name into own_name from _scores s join pets p on p.id = s.pet_id
  where p.owner_id = auth.uid() and is_pet_match(s.score, s.model, s.nose) order by s.score desc limit 1;
  select max(s.score) into own_top from _scores s join pets p on p.id = s.pet_id where p.owner_id = auth.uid();

  select count(*), max(s.score) into n, top from _scores s join pets p on p.id = s.pet_id
  where p.owner_id <> auth.uid();

  select p.id, p.owner_id, p.name, p.diseases, p.vaccines, s.score into b_id, b_owner, b_name, b_diseases, b_vaccines, b_score
  from _scores s join pets p on p.id = s.pet_id
  where p.owner_id <> auth.uid() and case when p.status = 'lost' then is_pet_match(s.score, s.model, s.nose)
    else s.model <> 'basic' and s.score >= unlost_threshold(s.model) end
  order by s.score desc limit 1;

  update found_reports set best_score = top, pet_id = b_id, own_score = own_top,
    match_kind = case when b_id is not null then 'auto' end, match_score = b_score
  where id = r_id;

  if b_id is not null then
    insert into notifications (user_id, type, title, body, url)
    values (b_owner, 'match', '¡Encontraron a ' || b_name || '! 🐾',
            'Toca para ver dónde está y contactar a quien la encontró.', '#/encontrada/' || r_id);
  end if;

  -- Mascotas perdidas que se parecen algo, para que quien la encontró diga
  -- "¡es esta!". Solo las perdidas: sus dueños las están buscando.
  return jsonb_build_object(
    'id', r_id, 'matched', b_id is not null, 'diseases', b_diseases, 'vaccines', b_vaccines,
    'compared', n, 'own_match', own_name, 'best_score', top,
    'suggestions', coalesce((select jsonb_agg(to_jsonb(x) order by x.score desc) from (
      select p.id, p.name, p.photo, p.species, p.breed, p.lost_at, s.score
      from _scores s join pets p on p.id = s.pet_id
      where p.owner_id <> auth.uid() and p.status = 'lost' and p.id is distinct from b_id
        and s.score >= suggest_threshold(s.model)
      order by s.score desc limit 3) x), '[]'::jsonb));
end $$;

-- Quien encontró una mascota elige una de las sugeridas: se liga el aviso y
-- se avisa al dueño. Devuelve sus cuidados.
create or replace function public.confirm_found(p_found uuid, p_pet uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pet pets;
begin
  select * into pet from pets where id = p_pet and status = 'lost' and owner_id <> auth.uid();
  if pet.id is null then raise exception 'Mascota no disponible'; end if;
  update found_reports set pet_id = p_pet, match_kind = 'finder',
    match_score = (select score from found_scores(p_pet) where found_id = p_found)
  where id = p_found and finder_id = auth.uid() and status = 'open' and pet_id is null;
  if not found then raise exception 'Aviso no disponible'; end if;
  insert into notifications (user_id, type, title, body, url)
  values (pet.owner_id, 'match', '¿Encontraron a ' || pet.name || '? 🐾',
          'Alguien cree que la encontró. Toca para ver su foto, dónde está y contactarle.', '#/encontrada/' || p_found);
  return jsonb_build_object('diseases', pet.diseases, 'vaccines', pet.vaccines);
end $$;

-- Placa del collar: se cuenta cada dispositivo que abre su QR (la app lo
-- llama una sola vez por dispositivo).
create or replace function public.log_tag_visit() returns void
language sql security definer set search_path = public as $$
  insert into tag_visits default values;
$$;
grant execute on function public.log_tag_visit() to anon, authenticated;

-- Para el administrador: cuántos abrieron el QR de la placa, cuántos
-- escanearon una mascota desde ahí y en cuántos se encontró a su dueño.
create or replace function public.tag_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Solo el administrador'; end if;
  return jsonb_build_object(
    'visits', (select count(*) from tag_visits),
    'reports', (select count(*) from found_reports where source = 'placa'),
    'matched', (select count(*) from found_reports where source = 'placa' and pet_id is not null),
    'months', coalesce((select jsonb_agg(m order by m.month desc) from (
      select to_char(date_trunc('month', created_at at time zone 'America/Santiago'), 'YYYY-MM') as month, count(*) as visits
      from tag_visits group by 1) m), '[]'::jsonb));
end $$;

-- Distancia en km entre dos puntos (fórmula del haversine).
create or replace function public.km_between(
  lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision
) returns double precision
language sql immutable as $$
  select 6371 * 2 * asin(sqrt(least(1, power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2))));
$$;

-- Avisos de mascotas perdidas cerca: la persona da permiso y la app guarda su
-- zona redondeada a 2 decimales (~1 km). El permiso queda en consent_log.
create or replace function public.set_my_area(p_lat double precision, p_lng double precision) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sin sesión'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'Ubicación no válida';
  end if;
  if not exists (select 1 from user_areas where user_id = auth.uid()) then
    insert into consent_log (user_id, kind, granted, version) values (auth.uid(), 'zona', true, '2026-10-01');
  end if;
  insert into user_areas (user_id, lat, lng, updated_at)
  values (auth.uid(), round(p_lat::numeric, 2), round(p_lng::numeric, 2), now())
  on conflict (user_id) do update set lat = excluded.lat, lng = excluded.lng, updated_at = now();
  return true;
end $$;

create or replace function public.clear_my_area() returns boolean
language plpgsql security definer set search_path = public as $$
begin
  delete from user_areas where user_id = auth.uid();
  if found then
    insert into consent_log (user_id, kind, granted, version) values (auth.uid(), 'zona', false, '2026-10-01');
  end if;
  return true;
end $$;

-- "Perdí mi mascota": activa el aviso y busca entre los avisos de "encontré",
-- también los que se hicieron antes de que el dueño avisara. Devuelve la
-- coincidencia (id, o nulo) y los avisos parecidos para que el dueño revise.
-- Si el dueño marca dónde se perdió, la primera vez se avisa a todas las
-- personas con avisos cerca activados a 5 km o menos (notified = cuántas).
drop function if exists public.report_lost(uuid);
drop function if exists public.report_lost(uuid, double precision, double precision);
drop function if exists public.report_lost(uuid, double precision, double precision, boolean);
-- p_fb: el dueño elige si se publica en la página de Facebook de Kiltrazo
-- (nulo = se mantiene lo que eligió antes).
create function public.report_lost(p_pet uuid, p_lat double precision default null, p_lng double precision default null,
  p_fb boolean default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare f_id uuid; f_score real; pet pets; what text; sugg jsonb; n int;
begin
  if p_lat is not null and (p_lat not between -90 and 90 or p_lng not between -180 and 180) then
    raise exception 'Ubicación no válida';
  end if;
  -- Si ya estaba perdida, se mantiene la fecha y el punto (a menos que marque otro).
  update pets set status = 'lost',
    lost_at = case when status = 'lost' then coalesce(lost_at, now()) else now() end,
    lost_lat = coalesce(p_lat, case when status = 'lost' then lost_lat end),
    lost_lng = coalesce(p_lng, case when status = 'lost' then lost_lng end),
    lost_alerted_at = case when status = 'lost' then lost_alerted_at end,
    lost_alerted = case when status = 'lost' then lost_alerted else 0 end,
    fb_share = coalesce(p_fb, case when status = 'lost' then fb_share else false end)
  where id = p_pet and owner_id = auth.uid() returning * into pet;
  if pet.id is null then raise exception 'Mascota no encontrada'; end if;

  -- Aviso a las personas cerca: una sola vez por pérdida.
  if pet.lost_lat is not null and pet.lost_alerted_at is null then
    what := concat_ws(', ', nullif(nullif(pet.species, ''), 'otro'), nullif(pet.breed, ''));
    what := upper(left(what, 1)) || substr(what, 2);
    insert into notifications (user_id, type, title, body, url)
    select a.user_id, 'lost', 'Se perdió ' || pet.name || ' cerca de ti',
      coalesce(nullif(what, '') || ', ', '')
        || case when d < 1 then 'a menos de 1 km de ti' else 'a ' || round(d) || ' km de ti' end
        || '. Toca para ver su foto. Si la ves, escanéala en Kiltrazo y le avisamos a su dueño.',
      '#/perdida/' || pet.id
    from (select user_id, km_between(lat, lng, pet.lost_lat, pet.lost_lng) as d from user_areas
          where user_id <> auth.uid() and lat between pet.lost_lat - 0.06 and pet.lost_lat + 0.06) a
    where a.d <= 5;
    get diagnostics n = row_count;
    update pets set lost_alerted_at = now(), lost_alerted = n where id = pet.id;
    pet.lost_alerted := n;
  end if;

  create temp table if not exists _found (found_id uuid, score real, model text, nose real) on commit drop;
  delete from _found where true;
  insert into _found select s.* from found_scores(p_pet) s
    join found_reports fr on fr.id = s.found_id
    where fr.pet_id is null or fr.pet_id = p_pet;

  select found_id, score into f_id, f_score from _found
  where is_pet_match(score, model, nose) order by score desc limit 1;

  if f_id is not null and not exists (select 1 from found_reports where id = f_id and pet_id = p_pet) then
    update found_reports set pet_id = p_pet, match_kind = 'auto', match_score = f_score where id = f_id;
    insert into notifications (user_id, type, title, body, url)
    values (auth.uid(), 'match', '¡Encontraron a ' || pet.name || '! 🐾',
            'Toca para ver dónde está y contactar a quien la encontró.', '#/encontrada/' || f_id);
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.score desc), '[]'::jsonb) into sugg from (
    select fr.id, fr.photo, fr.created_at, s.score
    from _found s join found_reports fr on fr.id = s.found_id
    where fr.pet_id is null and s.score >= suggest_threshold(s.model) and fr.id is distinct from f_id
    order by s.score desc limit 3) x;

  return jsonb_build_object('id', f_id, 'suggestions', sugg,
    'notified', case when pet.lost_lat is null then null else pet.lost_alerted end);
end $$;

-- Lo que ve quien recibió el aviso de mascota perdida: foto, nombre, tipo y la
-- zona aproximada (~100 m). Nunca datos del dueño. Solo para quien recibió el
-- aviso (o el dueño).
create or replace function public.lost_alert(p_pet uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', p.id, 'name', p.name, 'photo', p.photo, 'species', p.species, 'breed', p.breed,
    'status', p.status, 'lost_at', p.lost_at,
    'lat', round(p.lost_lat::numeric, 3), 'lng', round(p.lost_lng::numeric, 3))
  from pets p
  where p.id = p_pet and (p.owner_id = auth.uid() or exists (
    select 1 from notifications n where n.user_id = auth.uid() and n.url = '#/perdida/' || p.id::text));
$$;

-- El dueño reconoce a su mascota en un aviso sugerido: se liga el aviso (así
-- ve el contacto y el mapa) y se avisa a quien la encontró.
create or replace function public.claim_found(p_found uuid, p_pet uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare f found_reports; p_name text;
begin
  select name into p_name from pets where id = p_pet and owner_id = auth.uid();
  if p_name is null then raise exception 'Mascota no encontrada'; end if;
  -- Si la app ya la había ligado sola, se mantiene como coincidencia automática.
  update found_reports set pet_id = p_pet,
    match_kind = case when pet_id = p_pet then match_kind else 'owner' end,
    match_score = case when pet_id = p_pet then match_score
      else (select score from found_scores(p_pet) where found_id = p_found) end
  where id = p_found and status = 'open' and (pet_id is null or pet_id = p_pet)
  returning * into f;
  if f.id is null then raise exception 'Aviso no disponible'; end if;
  if f.finder_id is not null then
    insert into notifications (user_id, type, title, body)
    values (f.finder_id, 'info', 'El dueño reconoció a la mascota que encontraste 🐾',
            'Se llama ' || p_name || '. Te contactará pronto. ¡Gracias!');
  end if;
  return true;
end $$;

-- "Ya encontré mi mascota": quita el aviso y publica el reencuentro.
create or replace function public.mark_recovered(p_pet uuid, p_story text default '') returns uuid
language plpgsql security definer set search_path = public as $$
declare s_id uuid; pet pets;
begin
  select * into pet from pets where id = p_pet and (owner_id = auth.uid() or is_admin());
  if pet.id is null then raise exception 'Mascota no encontrada'; end if;
  update pets set status = 'home', recovered_at = now(), lost_lat = null, lost_lng = null,
    lost_alerted_at = null, lost_alerted = 0, fb_share = false where id = p_pet;
  update found_reports set status = 'closed' where pet_id = p_pet and status = 'open';
  insert into successes (pet_id, pet_name, photo, story)
  values (pet.id, pet.name, pet.photo, coalesce(p_story, '')) returning id into s_id;
  return s_id;
end $$;

-- Mensajes del administrador a un usuario o a todos (p_user nulo).
create or replace function public.admin_notify(p_user uuid, p_title text, p_body text) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not is_admin() then raise exception 'Solo administradores'; end if;
  insert into notifications (user_id, type, title, body)
  select id, 'admin', p_title, p_body from profiles where p_user is null or id = p_user;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- Mensajes de usuarios al administrador ----------

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null default '',
  phone text not null default '',
  body text not null check (char_length(body) between 1 and 1000),
  read boolean not null default false,
  created_at timestamptz not null default now()
);

-- Cada mensaje nuevo llega como aviso a los administradores.
create or replace function public.notify_admins_contact() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (user_id, type, title, body, url)
  select a.user_id, 'contact', 'Mensaje de ' || coalesce(nullif(new.name, ''), 'un usuario'), left(new.body, 140), '#/admin'
  from admins a;
  return new;
end $$;
drop trigger if exists contacts_notify on public.contacts;
create trigger contacts_notify after insert on public.contacts
  for each row execute function public.notify_admins_contact();

-- ---------- Notificaciones push (con la app cerrada) ----------
-- Cada celular que activa las notificaciones guarda aquí su suscripción. La
-- función send-push (supabase/functions/send-push) las usa para avisar.

create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user on public.push_subscriptions (user_id);

-- Ajustes públicos de la app (hoy, la clave pública de las notificaciones).
create table if not exists public.app_settings (
  key text primary key,
  value text not null
);

-- Cada aviso nuevo le pide a send-push que lo envíe. Si la función aún no
-- está publicada no pasa nada: el aviso se muestra al abrir la app.
create or replace function public.push_notification() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform net.http_post(
    url := 'https://zzudsvwqskypviqruevb.supabase.co/functions/v1/send-push',
    body := jsonb_build_object('id', new.id),
    headers := '{"Content-Type": "application/json"}'::jsonb);
  return new;
exception when others then
  return new;
end $$;

do $$ begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
    drop trigger if exists notifications_push on public.notifications;
    create trigger notifications_push after insert on public.notifications
      for each row execute function public.push_notification();
  end if;
end $$;

-- ---------- Página de Facebook (e Instagram) de Kiltrazo ----------
-- Si el dueño lo elige al avisar que se perdió, la mascota se publica en la
-- página de Facebook de Kiltrazo (y en su Instagram, si está conectado) y la
-- publicación se borra cuando vuelve a casa (o si se elimina la mascota). Lo hace la función facebook-page
-- (supabase/functions/facebook-page): se la llama con { pet } y ella mira el
-- estado de la mascota para publicar o borrar. Aquí queda qué publicación es
-- de qué mascota; no se borra junto con la mascota para poder quitarla.
create table if not exists public.facebook_posts (
  pet_id uuid primary key,
  post_id text,
  created_at timestamptz not null default now()
);
-- Lo mismo en Instagram (publicación e historia), si la página lo tiene conectado.
alter table public.facebook_posts add column if not exists ig_post_id text;
alter table public.facebook_posts add column if not exists ig_story_id text;
alter table public.facebook_posts enable row level security;

create or replace function public.facebook_sync() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare pet_id uuid := coalesce(new.id, old.id);
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status
     and new.fb_share is not distinct from old.fb_share then
    return new;
  end if;
  if tg_op = 'DELETE' and not exists (select 1 from facebook_posts f where f.pet_id = old.id) then
    return old;
  end if;
  perform net.http_post(
    url := 'https://zzudsvwqskypviqruevb.supabase.co/functions/v1/facebook-page',
    body := jsonb_build_object('pet', pet_id),
    headers := '{"Content-Type": "application/json"}'::jsonb);
  return coalesce(new, old);
exception when others then
  return coalesce(new, old);
end $$;

do $$ begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
    drop trigger if exists pets_facebook on public.pets;
    create trigger pets_facebook after update of status, fb_share or delete on public.pets
      for each row execute function public.facebook_sync();
  end if;
end $$;

-- ---------- Pasar los datos al entrar con la cuenta ----------
-- Cada dispositivo empieza como usuario anónimo. Si ahí se registraron
-- mascotas y después se entra con correo y clave, la app pide un pase como
-- anónimo (start_transfer) y, ya dentro de la cuenta, lo usa
-- (finish_transfer) para que las mascotas y avisos pasen a la cuenta. El pase
-- solo lo puede pedir el propio usuario anónimo y vence en 15 minutos.
create table if not exists public.user_transfers (
  token uuid primary key default gen_random_uuid(),
  from_user uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.user_transfers enable row level security;

create or replace function public.start_transfer() returns uuid
language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  if auth.uid() is null then return null; end if;
  delete from user_transfers where from_user = auth.uid() or created_at < now() - interval '1 day';
  insert into user_transfers (from_user) values (auth.uid()) returning token into t;
  return t;
end $$;

-- Pasa mascotas, avisos y datos de un usuario a otro. La usan el cambio de
-- celular (finish_transfer) y el administrador (admin_move_pets); nadie la
-- llama directo.
create or replace function public.move_user_data(f uuid, t uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update pets set owner_id = t where owner_id = f;
  get diagnostics n = row_count;
  update found_reports set finder_id = t where finder_id = f;
  update notifications set user_id = t where user_id = f;
  update comments set user_id = t where user_id = f;
  update contacts set user_id = t where user_id = f;
  update push_subscriptions set user_id = t where user_id = f;
  -- La zona para avisos cerca pasa solo si la cuenta aún no tiene una.
  if not exists (select 1 from user_areas where user_id = t) then
    update user_areas set user_id = t where user_id = f;
  end if;
  -- Kiltrazo Clínica (las tablas se crean más abajo; existen al correr esto).
  if to_regclass('public.clinic_patients') is not null then
    update clinic_patients set tutor_user = t where tutor_user = f;
    update pet_codes set owner_id = t where owner_id = f;
  end if;
  -- El perfil solo pasa si la cuenta aún no tiene uno.
  if not exists (select 1 from profiles where id = t) then
    update profiles set id = t where id = f;
  end if;
  return n;
end $$;
revoke execute on function public.move_user_data(uuid, uuid) from public, anon, authenticated;

create or replace function public.finish_transfer(p_token uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare f uuid;
begin
  delete from user_transfers where token = p_token and created_at > now() - interval '15 minutes'
  returning from_user into f;
  if f is null or auth.uid() is null or f = auth.uid() then return 0; end if;
  -- Solo desde un usuario anónimo: una cuenta con correo nunca se vacía así.
  if not exists (select 1 from auth.users where id = f and is_anonymous) then return 0; end if;
  return move_user_data(f, auth.uid());
end $$;

-- ---------- Seguridad (RLS) ----------

alter table public.profiles enable row level security;
alter table public.admins enable row level security;
alter table public.pets enable row level security;
alter table public.pet_samples enable row level security;
alter table public.found_reports enable row level security;
alter table public.found_samples enable row level security;
alter table public.notifications enable row level security;
alter table public.successes enable row level security;
alter table public.comments enable row level security;
alter table public.contacts enable row level security;
alter table public.user_areas enable row level security;

-- Cada persona ve solo su propia zona; se guarda y se borra con set_my_area y
-- clear_my_area. Ni el administrador la ve.
drop policy if exists "mi zona" on public.user_areas;
create policy "mi zona" on public.user_areas for select using (user_id = auth.uid());

drop policy if exists "perfil propio o admin" on public.profiles;
create policy "perfil propio o admin" on public.profiles for select using (id = auth.uid() or is_admin());
drop policy if exists "crear perfil propio" on public.profiles;
create policy "crear perfil propio" on public.profiles for insert with check (id = auth.uid());
drop policy if exists "editar perfil propio" on public.profiles;
create policy "editar perfil propio" on public.profiles for update using (id = auth.uid());

drop policy if exists "ver si soy admin" on public.admins;
create policy "ver si soy admin" on public.admins for select using (user_id = auth.uid());

drop policy if exists "dueño ve sus mascotas" on public.pets;
create policy "dueño ve sus mascotas" on public.pets for select using (owner_id = auth.uid() or is_admin());
drop policy if exists "dueño o admin edita" on public.pets;
create policy "dueño o admin edita" on public.pets for update using (owner_id = auth.uid() or is_admin());
drop policy if exists "dueño o admin elimina" on public.pets;
create policy "dueño o admin elimina" on public.pets for delete using (owner_id = auth.uid() or is_admin());

-- Un aviso de encontrada lo ven quien lo hizo, el dueño de la mascota que coincidió y el admin.
drop policy if exists "ver aviso encontrada" on public.found_reports;
create policy "ver aviso encontrada" on public.found_reports for select using (
  finder_id = auth.uid() or is_admin()
  or exists (select 1 from pets p where p.id = pet_id and p.owner_id = auth.uid()));
drop policy if exists "admin edita avisos" on public.found_reports;
create policy "admin edita avisos" on public.found_reports for update using (is_admin());
drop policy if exists "admin elimina avisos" on public.found_reports;
create policy "admin elimina avisos" on public.found_reports for delete using (is_admin());

drop policy if exists "mis avisos" on public.notifications;
create policy "mis avisos" on public.notifications for select using (user_id = auth.uid());
drop policy if exists "marcar mis avisos" on public.notifications;
create policy "marcar mis avisos" on public.notifications for update using (user_id = auth.uid());

drop policy if exists "reencuentros públicos" on public.successes;
create policy "reencuentros públicos" on public.successes for select using (true);
drop policy if exists "admin agrega reencuentros" on public.successes;
create policy "admin agrega reencuentros" on public.successes for insert with check (is_admin());
drop policy if exists "admin elimina reencuentros" on public.successes;
create policy "admin elimina reencuentros" on public.successes for delete using (is_admin());

drop policy if exists "comentarios públicos" on public.comments;
create policy "comentarios públicos" on public.comments for select using (true);
drop policy if exists "comentar" on public.comments;
create policy "comentar" on public.comments for insert with check (user_id = auth.uid());
drop policy if exists "borrar comentario" on public.comments;
create policy "borrar comentario" on public.comments for delete using (user_id = auth.uid() or is_admin());

drop policy if exists "escribir al admin" on public.contacts;
create policy "escribir al admin" on public.contacts for insert with check (user_id = auth.uid());
drop policy if exists "admin lee mensajes" on public.contacts;
create policy "admin lee mensajes" on public.contacts for select using (is_admin());
drop policy if exists "admin marca mensajes" on public.contacts;
create policy "admin marca mensajes" on public.contacts for update using (is_admin());
drop policy if exists "admin borra mensajes" on public.contacts;
create policy "admin borra mensajes" on public.contacts for delete using (is_admin());

alter table public.push_subscriptions enable row level security;
alter table public.app_settings enable row level security;

drop policy if exists "mis suscripciones" on public.push_subscriptions;
create policy "mis suscripciones" on public.push_subscriptions for select using (user_id = auth.uid());
drop policy if exists "suscribirme" on public.push_subscriptions;
create policy "suscribirme" on public.push_subscriptions for insert with check (user_id = auth.uid());
drop policy if exists "actualizar mi suscripción" on public.push_subscriptions;
create policy "actualizar mi suscripción" on public.push_subscriptions for update using (user_id = auth.uid());
drop policy if exists "borrar mi suscripción" on public.push_subscriptions;
create policy "borrar mi suscripción" on public.push_subscriptions for delete using (user_id = auth.uid());

drop policy if exists "ajustes públicos" on public.app_settings;
create policy "ajustes públicos" on public.app_settings for select using (true);
drop policy if exists "admin guarda ajustes" on public.app_settings;
create policy "admin guarda ajustes" on public.app_settings for insert with check (is_admin());
drop policy if exists "admin cambia ajustes" on public.app_settings;
create policy "admin cambia ajustes" on public.app_settings for update using (is_admin());

-- Avisos en tiempo real mientras la app está abierta.
do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null; end $$;

-- Registro de consentimientos: se escribe solo desde el trigger, al crear el
-- perfil con la casilla marcada o al cambiarla después.
create or replace function public.log_promos() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Un upsert sobre un perfil que ya existe pasa por aquí antes del UPDATE:
  -- se deja que el UPDATE registre el cambio, para no anotarlo dos veces.
  if tg_op = 'INSERT' and (not new.promos or exists (select 1 from profiles where id = new.id)) then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.promos is not distinct from old.promos then
    new.promos_at := old.promos_at;
    new.promos_version := old.promos_version;
    return new;
  end if;
  new.promos_at := now();
  insert into consent_log (user_id, kind, granted, version)
  values (new.id, 'promos', new.promos, new.promos_version);
  return new;
end $$;

drop trigger if exists profiles_promos on public.profiles;
create trigger profiles_promos before insert or update on public.profiles
  for each row execute function public.log_promos();

alter table public.consent_log enable row level security;
drop policy if exists "mis consentimientos o admin" on public.consent_log;
create policy "mis consentimientos o admin" on public.consent_log for select using (user_id = auth.uid() or is_admin());

-- Bucket privado con las fotos para entrenar. El dueño sube a la carpeta de su
-- mascota solo si dio permiso; solo el administrador las ve y las descarga.
insert into storage.buckets (id, name, public) values ('entrenamiento', 'entrenamiento', false)
on conflict (id) do nothing;

drop policy if exists "subir fotos de entrenamiento" on storage.objects;
create policy "subir fotos de entrenamiento" on storage.objects for insert to authenticated with check (
  bucket_id = 'entrenamiento' and exists (
    select 1 from public.pets p
    where p.id::text = (storage.foldername(objects.name))[1] and p.owner_id = auth.uid() and p.train_ok));
drop policy if exists "ver fotos de entrenamiento" on storage.objects;
create policy "ver fotos de entrenamiento" on storage.objects for select using (
  bucket_id = 'entrenamiento' and (public.is_admin() or exists (
    select 1 from public.pets p where p.id::text = (storage.foldername(objects.name))[1] and p.owner_id = auth.uid())));
drop policy if exists "borrar fotos de entrenamiento" on storage.objects;
create policy "borrar fotos de entrenamiento" on storage.objects for delete using (
  bucket_id = 'entrenamiento' and (public.is_admin() or exists (
    select 1 from public.pets p where p.id::text = (storage.foldername(objects.name))[1] and p.owner_id = auth.uid())));

-- ==========================================================================
-- ---------- Kiltrazo Clínica (fase 1) ----------
-- Software para veterinarias dentro de la misma app (#/clinica). Solo agrega
-- tablas nuevas: lo anterior sigue igual. Cada clínica ve solo lo suyo; el
-- tutor solo comparte su mascota mostrando un código (create_pet_code) y ve
-- sus vacunas y horas, nunca las notas clínicas.

create table if not exists public.clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  address text not null default '',
  phone text not null default '',
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now()
);

-- Equipo: 'vet' (veterinario) o 'recepcion'. is_admin: quien maneja el equipo.
create table if not exists public.clinic_members (
  clinic_id uuid not null references public.clinics on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  name text not null default '',
  role text not null default 'vet' check (role in ('vet', 'recepcion')),
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (clinic_id, user_id)
);
create index if not exists clinic_members_user on public.clinic_members (user_id);

-- Códigos para sumar gente al equipo (un uso, vencen en 7 días).
create table if not exists public.clinic_invites (
  code text primary key,
  clinic_id uuid not null references public.clinics on delete cascade,
  role text not null default 'vet' check (role in ('vet', 'recepcion')),
  created_at timestamptz not null default now()
);
-- Código que deja a la persona como administradora (lo usa el administrador
-- de Kiltrazo cuando una clínica se queda sin quien la administre).
alter table public.clinic_invites add column if not exists make_admin boolean not null default false;

-- Pacientes de la clínica. pet_id: la mascota de Kiltrazo, si el tutor la
-- vinculó con su código; tutor_user recibe los recordatorios en la app.
create table if not exists public.clinic_patients (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics on delete cascade,
  pet_id uuid references public.pets on delete set null,
  name text not null check (char_length(name) between 1 and 80),
  species text not null default '',
  breed text not null default '',
  sex text not null default '' check (sex in ('', 'macho', 'hembra')),
  neutered boolean not null default false,
  birth_date date,
  chip text not null default '',
  color text not null default '',
  allergies text not null default '',
  notes text not null default '',
  tutor_name text not null default '',
  tutor_phone text not null default '',
  tutor_email text not null default '',
  tutor_user uuid references auth.users on delete set null,
  photo text,
  created_at timestamptz not null default now()
);
create index if not exists clinic_patients_clinic on public.clinic_patients (clinic_id, name);
create index if not exists clinic_patients_pet on public.clinic_patients (pet_id);

-- Consultas (ficha clínica). Solo los veterinarios las escriben.
create table if not exists public.clinic_visits (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics on delete cascade,
  patient_id uuid not null references public.clinic_patients on delete cascade,
  vet_id uuid default auth.uid() references auth.users on delete set null,
  vet_name text not null default '',
  visited_at timestamptz not null default now(),
  template text not null default '',
  reason text not null default '',
  anamnesis text not null default '',
  exam text not null default '',
  weight numeric(6, 2),
  temperature numeric(4, 1),
  heart_rate int,
  resp_rate int,
  mucous text not null default '',
  diagnosis text not null default '',
  treatment text not null default '',
  next_control date,
  created_at timestamptz not null default now()
);
create index if not exists clinic_visits_patient on public.clinic_visits (patient_id, visited_at desc);

-- Vacunas y desparasitaciones. reminded_at: ya se avisó al tutor de la próxima dosis.
create table if not exists public.clinic_vaccines (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics on delete cascade,
  patient_id uuid not null references public.clinic_patients on delete cascade,
  kind text not null default 'vacuna' check (kind in ('vacuna', 'desparasitacion_interna', 'desparasitacion_externa')),
  name text not null check (char_length(name) between 1 and 80),
  applied_on date not null default current_date,
  next_due date,
  batch text not null default '',
  vet_name text not null default '',
  reminded_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists clinic_vaccines_patient on public.clinic_vaccines (patient_id);
create index if not exists clinic_vaccines_due on public.clinic_vaccines (clinic_id, next_due);

-- Exámenes y documentos: el archivo va al bucket privado "clinica", en
-- clinica/<clinic_id>/<patient_id>/...
create table if not exists public.clinic_files (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics on delete cascade,
  patient_id uuid not null references public.clinic_patients on delete cascade,
  visit_id uuid references public.clinic_visits on delete set null,
  name text not null default '',
  path text not null,
  mime text not null default '',
  size int not null default 0,
  uploaded_from text not null default '',
  uploaded_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists clinic_files_patient on public.clinic_files (patient_id, created_at desc);

-- Agenda y sala de espera.
create table if not exists public.clinic_appointments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics on delete cascade,
  patient_id uuid references public.clinic_patients on delete set null,
  patient_name text not null default '',
  vet_id uuid references auth.users on delete set null,
  service text not null default 'consulta' check (service in ('consulta', 'control', 'vacuna', 'cirugia', 'peluqueria', 'otro')),
  starts_at timestamptz not null,
  minutes int not null default 30 check (minutes between 5 and 600),
  status text not null default 'agendada'
    check (status in ('agendada', 'en_sala', 'en_atencion', 'atendida', 'no_vino', 'cancelada')),
  arrived_at timestamptz,
  notes text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists clinic_appointments_day on public.clinic_appointments (clinic_id, starts_at);

-- Código que el tutor muestra en su app para compartir su mascota con una
-- clínica (un uso, vence en 24 horas).
create table if not exists public.pet_codes (
  code text primary key,
  pet_id uuid not null references public.pets on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  created_at timestamptz not null default now()
);

-- El administrador de Kiltrazo (is_admin) entra a cualquier clínica o
-- municipalidad como si fuera su administrador (Admin → Clínicas → Entrar).
create or replace function public.is_clinic_member(p_clinic uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from clinic_members where clinic_id = p_clinic and user_id = auth.uid()) or is_admin();
$$;

-- Para las reglas del bucket, donde la carpeta es texto.
create or replace function public.is_clinic_folder(p_folder text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from clinic_members where clinic_id::text = p_folder and user_id = auth.uid()) or is_admin();
$$;

create or replace function public.is_clinic_vet(p_clinic uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from clinic_members where clinic_id = p_clinic and user_id = auth.uid() and role = 'vet') or is_admin();
$$;

create or replace function public.is_clinic_admin(p_clinic uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from clinic_members where clinic_id = p_clinic and user_id = auth.uid() and is_admin) or is_admin();
$$;

-- Códigos fáciles de dictar: sin 0/O ni 1/I/L.
create or replace function public.short_code(n int default 6) returns text
language sql volatile as $$
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '')
  from generate_series(1, n);
$$;

-- Para crear o unirse a una clínica hay que entrar con correo y clave, así
-- el mismo equipo entra desde el computador y desde el celular.
create or replace function public.require_account() returns void
language plpgsql stable as $$
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Primero entra con tu correo y clave';
  end if;
end $$;

create or replace function public.create_clinic(
  p_name text, p_address text, p_phone text, p_member_name text, p_role text default 'vet'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  perform require_account();
  insert into clinics (name, address, phone, created_by)
  values (trim(p_name), coalesce(p_address, ''), coalesce(p_phone, ''), auth.uid()) returning id into c;
  insert into clinic_members (clinic_id, user_id, name, role, is_admin)
  values (c, auth.uid(), coalesce(p_member_name, ''), coalesce(nullif(p_role, ''), 'vet'), true);
  return c;
end $$;

drop function if exists public.create_clinic_invite(uuid, text);
create or replace function public.create_clinic_invite(p_clinic uuid, p_role text, p_admin boolean default false) returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not (is_clinic_admin(p_clinic) or is_admin()) then raise exception 'Solo quien administra la clínica'; end if;
  delete from clinic_invites where created_at < now() - interval '7 days';
  loop
    c := short_code(6);
    exit when not exists (select 1 from clinic_invites where code = c);
  end loop;
  insert into clinic_invites (code, clinic_id, role, make_admin) values (c, p_clinic, p_role, coalesce(p_admin, false));
  return c;
end $$;

create or replace function public.join_clinic(p_code text, p_member_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare i clinic_invites;
begin
  perform require_account();
  delete from clinic_invites where code = upper(trim(p_code)) and created_at > now() - interval '7 days'
  returning * into i;
  if i.code is null then raise exception 'El código no existe o ya venció. Pide uno nuevo.'; end if;
  insert into clinic_members (clinic_id, user_id, name, role, is_admin)
  values (i.clinic_id, auth.uid(), coalesce(p_member_name, ''), i.role, i.make_admin)
  on conflict (clinic_id, user_id) do update set role = excluded.role, name = excluded.name,
    is_admin = clinic_members.is_admin or excluded.is_admin;
  return i.clinic_id;
end $$;

-- El tutor pide un código para su mascota.
create or replace function public.create_pet_code(p_pet uuid) returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not exists (select 1 from pets where id = p_pet and owner_id = auth.uid()) then
    raise exception 'Mascota no encontrada';
  end if;
  delete from pet_codes where pet_id = p_pet or created_at < now() - interval '1 day';
  loop
    c := short_code(6);
    exit when not exists (select 1 from pet_codes where code = c);
  end loop;
  insert into pet_codes (code, pet_id, owner_id) values (c, p_pet, auth.uid());
  return c;
end $$;

-- La clínica usa el código: la mascota queda como paciente, con los datos de
-- contacto del tutor (que los compartió al mostrar el código).
create or replace function public.link_pet(p_clinic uuid, p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare pc pet_codes; p pets; o profiles; pid uuid;
begin
  if not is_clinic_member(p_clinic) then raise exception 'No eres parte de esta clínica'; end if;
  delete from pet_codes where code = upper(trim(p_code)) and created_at > now() - interval '1 day'
  returning * into pc;
  if pc.code is null then raise exception 'El código no existe o ya venció. Pide al tutor que genere otro.'; end if;
  select * into p from pets where id = pc.pet_id;
  select * into o from profiles where id = p.owner_id;

  select id into pid from clinic_patients where clinic_id = p_clinic and pet_id = p.id;
  if pid is null then
    insert into clinic_patients (clinic_id, pet_id, name, species, breed, allergies, notes, photo,
      tutor_name, tutor_phone, tutor_email, tutor_user)
    values (p_clinic, p.id, p.name, p.species, p.breed, '',
      trim(both E'\n' from concat_ws(E'\n',
        nullif('Enfermedades (según el tutor): ' || nullif(p.diseases, ''), ''),
        nullif('Vacunas (según el tutor): ' || nullif(p.vaccines, ''), ''))),
      p.photo,
      coalesce(nullif(trim(concat_ws(' ', o.first_name, o.last_name)), ''), o.name, p.owner_name),
      coalesce(o.phone, ''), coalesce(o.email, ''), p.owner_id)
    returning id into pid;
  else
    update clinic_patients set tutor_user = p.owner_id,
      tutor_name = coalesce(nullif(trim(concat_ws(' ', o.first_name, o.last_name)), ''), o.name, tutor_name),
      tutor_phone = coalesce(nullif(o.phone, ''), tutor_phone), tutor_email = coalesce(nullif(o.email, ''), tutor_email)
    where id = pid;
  end if;
  return pid;
end $$;

-- El tutor deja de compartir su mascota con una clínica: la clínica conserva
-- su ficha (es su registro clínico), pero sin enlace ni avisos al tutor.
create or replace function public.unlink_pet(p_pet uuid, p_clinic uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from pets where id = p_pet and owner_id = auth.uid()) then
    raise exception 'Mascota no encontrada';
  end if;
  update clinic_patients set pet_id = null, tutor_user = null where pet_id = p_pet and clinic_id = p_clinic;
  return true;
end $$;

-- Lo que el tutor ve de su mascota en las clínicas: vacunas y próximas horas
-- (sin notas clínicas).
create or replace function public.pet_health(p_pet uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from pets where id = p_pet and owner_id = auth.uid()) then
    raise exception 'Mascota no encontrada';
  end if;
  return jsonb_build_object(
    'clinics', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone, 'address', c.address,
        'home_visits', c.home_visits, 'only_home', c.only_home))
      from clinics c where c.id in (select clinic_id from clinic_patients where pet_id = p_pet)), '[]'::jsonb),
    'vaccines', coalesce((select jsonb_agg(jsonb_build_object('kind', v.kind, 'name', v.name, 'applied_on', v.applied_on,
        'next_due', v.next_due, 'clinic', c.name) order by v.applied_on desc)
      from clinic_vaccines v join clinic_patients cp on cp.id = v.patient_id join clinics c on c.id = v.clinic_id
      where cp.pet_id = p_pet), '[]'::jsonb),
    'appointments', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'starts_at', a.starts_at, 'service', a.service,
        'status', a.status, 'place', a.place, 'address', a.address, 'clinic', c.name, 'confirmed_at', a.confirmed_at) order by a.starts_at)
      from clinic_appointments a join clinic_patients cp on cp.id = a.patient_id join clinics c on c.id = a.clinic_id
      where cp.pet_id = p_pet and a.starts_at >= now() - interval '3 hours'
        and a.status in ('solicitada', 'agendada', 'en_camino')), '[]'::jsonb));
end $$;

-- Recordatorio en la app al tutor 7 días antes de cada próxima dosis (una
-- vez por dosis). Lo corre pg_cron cada mañana y también la app de la
-- clínica al abrirse, por si pg_cron no está.
create or replace function public.send_vaccine_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with due as (
    update clinic_vaccines v set reminded_at = now()
    from clinic_patients cp
    where cp.id = v.patient_id and cp.tutor_user is not null and v.reminded_at is null
      and v.next_due between current_date and current_date + 7
      -- Si ya se puso una dosis más nueva, la anterior no se recuerda.
      and not exists (select 1 from clinic_vaccines w where w.patient_id = v.patient_id
        and lower(w.name) = lower(v.name) and w.applied_on > v.applied_on)
    returning v.*, cp.tutor_user, cp.name as pet_name
  )
  insert into notifications (user_id, type, title, body, url)
  select d.tutor_user, 'info',
    case when d.kind = 'vacuna' then 'Se acerca la vacuna de ' else 'Se acerca la desparasitación de ' end || d.pet_name || ' 💉',
    d.name || ' el ' || to_char(d.next_due, 'DD-MM-YYYY') || ' en ' || c.name || '.', '#/perfil'
  from due d join clinics c on c.id = d.clinic_id;
  get diagnostics n = row_count;
  return n;
end $$;

do $$ begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('kiltrazo-recordatorios-vacunas', '0 12 * * *', 'select public.send_vaccine_reminders()');
  end if;
exception when others then null;
end $$;

alter table public.clinics enable row level security;
alter table public.clinic_members enable row level security;
alter table public.clinic_invites enable row level security;
alter table public.clinic_patients enable row level security;
alter table public.clinic_visits enable row level security;
alter table public.clinic_vaccines enable row level security;
alter table public.clinic_files enable row level security;
alter table public.clinic_appointments enable row level security;
alter table public.pet_codes enable row level security;

drop policy if exists "ver mi clínica" on public.clinics;
create policy "ver mi clínica" on public.clinics for select using (is_clinic_member(id) or is_admin());
drop policy if exists "editar mi clínica" on public.clinics;
create policy "editar mi clínica" on public.clinics for update using (is_clinic_admin(id));

drop policy if exists "ver mi equipo" on public.clinic_members;
create policy "ver mi equipo" on public.clinic_members for select using (is_clinic_member(clinic_id) or is_admin());
drop policy if exists "admin de clínica edita equipo" on public.clinic_members;
create policy "admin de clínica edita equipo" on public.clinic_members for update using (is_clinic_admin(clinic_id));
drop policy if exists "admin de clínica quita del equipo" on public.clinic_members;
create policy "admin de clínica quita del equipo" on public.clinic_members for delete
  using (is_clinic_admin(clinic_id) and user_id <> auth.uid());

do $$
declare t text;
begin
  foreach t in array array['clinic_patients', 'clinic_vaccines', 'clinic_files', 'clinic_appointments'] loop
    execute format('drop policy if exists "equipo de la clínica" on public.%I', t);
    execute format('create policy "equipo de la clínica" on public.%I for all using (is_clinic_member(clinic_id)) with check (is_clinic_member(clinic_id))', t);
  end loop;
end $$;

drop policy if exists "equipo ve consultas" on public.clinic_visits;
create policy "equipo ve consultas" on public.clinic_visits for select using (is_clinic_member(clinic_id));
drop policy if exists "veterinario registra consultas" on public.clinic_visits;
create policy "veterinario registra consultas" on public.clinic_visits for insert with check (is_clinic_vet(clinic_id));
drop policy if exists "veterinario edita consultas" on public.clinic_visits;
create policy "veterinario edita consultas" on public.clinic_visits for update using (is_clinic_vet(clinic_id));
drop policy if exists "veterinario borra consultas" on public.clinic_visits;
create policy "veterinario borra consultas" on public.clinic_visits for delete using (is_clinic_vet(clinic_id));

-- Bucket privado de exámenes (máximo 10 MB por archivo).
insert into storage.buckets (id, name, public, file_size_limit) values ('clinica', 'clinica', false, 10485760)
on conflict (id) do nothing;

drop policy if exists "clínica sube exámenes" on storage.objects;
create policy "clínica sube exámenes" on storage.objects for insert to authenticated with check (
  bucket_id = 'clinica' and public.is_clinic_folder((storage.foldername(objects.name))[1]));
drop policy if exists "clínica ve exámenes" on storage.objects;
create policy "clínica ve exámenes" on storage.objects for select using (
  bucket_id = 'clinica' and public.is_clinic_folder((storage.foldername(objects.name))[1]));
drop policy if exists "clínica borra exámenes" on storage.objects;
create policy "clínica borra exámenes" on storage.objects for delete using (
  bucket_id = 'clinica' and public.is_clinic_folder((storage.foldername(objects.name))[1]));

-- ==========================================================================
-- ---------- Kiltrazo Clínica: horas pedidas por el tutor, domicilio y traspaso ----------

-- La clínica indica si hace visitas a domicilio (el tutor solo ve esa opción si es así).
alter table public.clinics add column if not exists home_visits boolean not null default false;
-- Dirección del tutor, para las visitas a domicilio.
alter table public.clinic_patients add column if not exists tutor_address text not null default '';
-- Escaneo de la cara hecho en la clínica, para pasar la mascota al tutor sin volver a filmarla.
alter table public.clinic_patients add column if not exists scan jsonb;

-- Horas: en la clínica o a domicilio (con dirección y, si el tutor la compartió,
-- su ubicación). 'solicitada' = la pidió el tutor y la clínica aún no confirma;
-- 'en_camino' = el veterinario va hacia el domicilio.
alter table public.clinic_appointments add column if not exists place text not null default 'clinica';
alter table public.clinic_appointments add column if not exists address text not null default '';
alter table public.clinic_appointments add column if not exists lat double precision;
alter table public.clinic_appointments add column if not exists lng double precision;
alter table public.clinic_appointments add column if not exists requested_by uuid references auth.users on delete set null;
alter table public.clinic_appointments drop constraint if exists clinic_appointments_status_check;
alter table public.clinic_appointments add constraint clinic_appointments_status_check
  check (status in ('solicitada', 'agendada', 'en_camino', 'en_sala', 'en_atencion', 'atendida', 'no_vino', 'cancelada'));
alter table public.clinic_appointments drop constraint if exists clinic_appointments_place_check;
alter table public.clinic_appointments add constraint clinic_appointments_place_check check (place in ('clinica', 'domicilio'));

-- Fecha y hora como se leen en Chile, para los avisos.
create or replace function public.cl_when(t timestamptz) returns text
language sql stable as $$
  select to_char(t at time zone 'America/Santiago', 'DD-MM') || ' a las ' || to_char(t at time zone 'America/Santiago', 'HH24:MI');
$$;

create or replace function public.service_name(s text) returns text
language sql immutable as $$
  select case s when 'consulta' then 'Consulta' when 'control' then 'Control' when 'vacuna' then 'Vacuna'
    when 'cirugia' then 'Cirugía' when 'peluqueria' then 'Peluquería' when 'urgencia' then 'Urgencia' else 'Hora' end;
$$;

-- Al pedir hora en una clínica del mapa sin haberla compartido antes, la
-- mascota queda compartida con esa clínica (la misma ficha que crea link_pet).
create or replace function public.patient_from_pet(p_clinic uuid, p_pet uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare p pets; o profiles; pid uuid;
begin
  select * into p from pets where id = p_pet;
  select * into o from profiles where id = p.owner_id;
  insert into clinic_patients (clinic_id, pet_id, name, species, breed, allergies, notes, photo,
    tutor_name, tutor_phone, tutor_email, tutor_user)
  values (p_clinic, p.id, p.name, p.species, p.breed, '',
    trim(both E'\n' from concat_ws(E'\n',
      nullif('Enfermedades (según el tutor): ' || nullif(p.diseases, ''), ''),
      nullif('Vacunas (según el tutor): ' || nullif(p.vaccines, ''), ''))),
    p.photo,
    coalesce(nullif(trim(concat_ws(' ', o.first_name, o.last_name)), ''), o.name, p.owner_name),
    coalesce(o.phone, ''), coalesce(o.email, ''), p.owner_id)
  returning id into pid;
  return pid;
end $$;
revoke execute on function public.patient_from_pet(uuid, uuid) from public, anon, authenticated;

-- El tutor pide una hora para su mascota en una clínica con la que la compartió
-- o que aparece en el mapa de Kiltrazo.
create or replace function public.request_appointment(
  p_pet uuid, p_clinic uuid, p_place text, p_service text, p_starts_at timestamptz,
  p_address text default '', p_lat double precision default null, p_lng double precision default null, p_notes text default ''
) returns uuid
language plpgsql security definer set search_path = public as $$
declare cp clinic_patients; c clinics; a_id uuid; v_vet uuid;
begin
  select * into cp from clinic_patients
  where clinic_id = p_clinic and pet_id = p_pet and pet_id in (select id from pets where owner_id = auth.uid());
  select * into c from clinics where id = p_clinic;
  if cp.id is null then
    -- Clínica aprobada (del mapa o de su propia página): pedir hora la comparte.
    if not coalesce(c.approved, false) or not exists (select 1 from pets where id = p_pet and owner_id = auth.uid()) then
      raise exception 'Primero comparte tu mascota con la clínica';
    end if;
    perform patient_from_pet(p_clinic, p_pet);
    select * into cp from clinic_patients where clinic_id = p_clinic and pet_id = p_pet;
  end if;
  if p_place not in ('clinica', 'domicilio') then raise exception 'Lugar no válido'; end if;
  if p_place = 'domicilio' and not c.home_visits then raise exception 'Esta clínica no hace visitas a domicilio'; end if;
  if p_place = 'domicilio' and coalesce(trim(p_address), '') = '' then raise exception 'Falta la dirección'; end if;
  if p_starts_at < now() then raise exception 'Elige una fecha futura'; end if;
  if (select count(*) from clinic_appointments where patient_id = cp.id and status = 'solicitada') >= 3 then
    raise exception 'Ya tienes horas esperando confirmación en esta clínica';
  end if;
  -- Si los veterinarios cargaron sus días de trabajo, la hora debe estar libre
  -- (con el traslado, si es a domicilio) y queda reservada a ese veterinario.
  if has_schedule(p_clinic, p_place) then
    v_vet := free_vet(p_clinic, p_place, p_starts_at);
    if v_vet is null then raise exception 'Esa hora ya no está disponible. Elige otra.'; end if;
  end if;
  insert into clinic_appointments (clinic_id, patient_id, patient_name, service, starts_at, status, place, address, lat, lng, notes, requested_by, vet_id)
  values (p_clinic, cp.id, cp.name, coalesce(nullif(p_service, ''), 'consulta'), p_starts_at, 'solicitada', p_place,
    case when p_place = 'domicilio' then left(trim(p_address), 200) else '' end,
    case when p_place = 'domicilio' then p_lat end, case when p_place = 'domicilio' then p_lng end,
    left(coalesce(p_notes, ''), 300), auth.uid(), v_vet)
  returning id into a_id;
  if p_place = 'domicilio' then update clinic_patients set tutor_address = left(trim(p_address), 200) where id = cp.id; end if;
  insert into notifications (user_id, type, title, body, url)
  select m.user_id, 'info', 'Nueva solicitud de hora 📅',
    cp.name || ' · ' || service_name(p_service) || case when p_place = 'domicilio' then ' a domicilio' else '' end
      || ' · ' || cl_when(p_starts_at), '#/clinica/solicitudes'
  from clinic_members m where m.clinic_id = p_clinic;
  return a_id;
end $$;

-- El tutor cancela una hora suya que aún no empieza.
create or replace function public.cancel_my_appointment(p_appt uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare a clinic_appointments;
begin
  update clinic_appointments set status = 'cancelada'
  where id = p_appt and status in ('solicitada', 'agendada')
    and patient_id in (select cp.id from clinic_patients cp join pets p on p.id = cp.pet_id where p.owner_id = auth.uid())
  returning * into a;
  if a.id is null then raise exception 'Hora no encontrada'; end if;
  insert into notifications (user_id, type, title, body, url)
  select m.user_id, 'info', 'Hora cancelada por el tutor', a.patient_name || ' · ' || cl_when(a.starts_at), '#/clinica/agenda/'
    || to_char(a.starts_at at time zone 'America/Santiago', 'YYYY-MM-DD')
  from clinic_members m where m.clinic_id = a.clinic_id;
  return true;
end $$;

-- La clínica avisa al tutor (si su mascota está vinculada): hora confirmada,
-- rechazada, veterinario en camino o en la puerta. Los textos son fijos.
create or replace function public.appointment_notify(p_appt uuid, p_kind text) returns boolean
language plpgsql security definer set search_path = public as $$
declare a clinic_appointments; cp clinic_patients; c clinics; t text; b text;
begin
  select * into a from clinic_appointments where id = p_appt;
  if a.id is null or not is_clinic_member(a.clinic_id) then raise exception 'Hora no encontrada'; end if;
  select * into cp from clinic_patients where id = a.patient_id;
  if cp.tutor_user is null then return false; end if;
  select * into c from clinics where id = a.clinic_id;
  case p_kind
    when 'confirmada' then
      t := 'Hora confirmada para ' || cp.name || ' 📅';
      b := service_name(a.service) || case when a.place = 'domicilio' then ' a domicilio' else '' end
        || ' el ' || cl_when(a.starts_at) || ' con ' || c.name || '.';
    when 'rechazada' then
      t := 'No pudimos confirmar la hora de ' || cp.name;
      b := c.name || ' no tiene esa hora disponible.' || case when c.phone <> '' then ' Llama al ' || c.phone || ' para buscar otra.' else ' Pide otra hora en Kiltrazo.' end;
    when 'en_camino' then
      t := 'La veterinaria va en camino 🚗';
      b := c.name || ' va hacia tu domicilio para atender a ' || cp.name || '.';
    when 'llego' then
      t := 'La veterinaria llegó 🏠';
      b := c.name || ' está en tu puerta para atender a ' || cp.name || '.';
    else raise exception 'Aviso no válido';
  end case;
  insert into notifications (user_id, type, title, body, url) values (cp.tutor_user, 'info', t, b, '#/perfil');
  return true;
end $$;

-- Traspaso: la clínica registró una mascota y se la pasa a la app de su tutor
-- con un enlace (un uso, 7 días). El tutor la registra con su cara (o elige una
-- que ya tenga) y queda vinculada a la ficha de la clínica.
create table if not exists public.clinic_transfers (
  code text primary key,
  patient_id uuid not null references public.clinic_patients on delete cascade,
  clinic_id uuid not null references public.clinics on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.clinic_transfers enable row level security;

create or replace function public.create_transfer_code(p_patient uuid) returns text
language plpgsql security definer set search_path = public as $$
declare cp clinic_patients; c text;
begin
  select * into cp from clinic_patients where id = p_patient;
  if cp.id is null or not is_clinic_member(cp.clinic_id) then raise exception 'Paciente no encontrado'; end if;
  if cp.pet_id is not null then raise exception 'Esta mascota ya está en la app de su tutor'; end if;
  delete from clinic_transfers where patient_id = p_patient or created_at < now() - interval '7 days';
  loop
    c := short_code(8);
    exit when not exists (select 1 from clinic_transfers where code = c);
  end loop;
  insert into clinic_transfers (code, patient_id, clinic_id) values (c, p_patient, cp.clinic_id);
  return c;
end $$;

-- Lo que ve el tutor al abrir el enlace, antes de aceptar.
create or replace function public.transfer_info(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('clinic', c.name, 'name', cp.name, 'species', cp.species, 'breed', cp.breed, 'photo', cp.photo,
    'has_scan', cp.scan is not null)
  from clinic_transfers t join clinic_patients cp on cp.id = t.patient_id join clinics c on c.id = t.clinic_id
  where t.code = upper(trim(p_code)) and t.created_at > now() - interval '7 days' and cp.pet_id is null
    and auth.uid() is not null;
$$;

create or replace function public.claim_transfer(p_code text, p_pet uuid) returns text
language plpgsql security definer set search_path = public as $$
declare t clinic_transfers; o profiles; c text;
begin
  if not exists (select 1 from pets where id = p_pet and owner_id = auth.uid()) then raise exception 'Mascota no encontrada'; end if;
  delete from clinic_transfers where code = upper(trim(p_code)) and created_at > now() - interval '7 days' returning * into t;
  if t.code is null then raise exception 'El enlace ya se usó o venció. Pide uno nuevo a tu veterinaria.'; end if;
  if exists (select 1 from clinic_patients where clinic_id = t.clinic_id and pet_id = p_pet and id <> t.patient_id) then
    raise exception 'Esa mascota ya está vinculada a esta clínica';
  end if;
  select * into o from profiles where id = auth.uid();
  update clinic_patients set pet_id = p_pet, tutor_user = auth.uid(),
    tutor_name = coalesce(nullif(tutor_name, ''), nullif(trim(concat_ws(' ', o.first_name, o.last_name)), ''), o.name, ''),
    tutor_phone = coalesce(nullif(tutor_phone, ''), o.phone, ''),
    tutor_email = coalesce(nullif(tutor_email, ''), o.email, ''),
    tutor_address = coalesce(nullif(tutor_address, ''), o.address, '')
  where id = t.patient_id and pet_id is null;
  if not found then raise exception 'Esta ficha ya está en la app de un tutor'; end if;
  select name into c from clinics where id = t.clinic_id;
  return c;
end $$;

-- La clínica puede filmar la cara de la mascota (mismo escaneo que la app).
-- Al recibirla, el tutor no tiene que volver a filmarla: la mascota se crea
-- con ese escaneo. Los vectores nunca salen hacia el tutor.
create or replace function public.accept_transfer(p_code text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare cp clinic_patients; o profiles; c text; new_id uuid;
begin
  if auth.uid() is null then raise exception 'Sin sesión'; end if;
  select p.* into cp from clinic_transfers t join clinic_patients p on p.id = t.patient_id
  where t.code = upper(trim(p_code)) and t.created_at > now() - interval '7 days' and p.pet_id is null;
  if cp.id is null then raise exception 'El enlace ya se usó o venció. Pide uno nuevo a tu veterinaria.'; end if;
  if cp.scan is null then raise exception 'La clínica no filmó su cara. Regístrala tú desde la app.'; end if;
  select * into o from profiles where id = auth.uid();
  select name into c from clinics where id = cp.clinic_id;
  insert into pets (owner_id, name, owner_name, diseases, vaccines, photo, species, breed)
  values (auth.uid(), cp.name, coalesce(nullif(trim(concat_ws(' ', o.first_name, o.last_name)), ''), o.name, ''),
          coalesce(nullif(cp.allergies, ''), ''), 'Las registra ' || c, cp.photo, coalesce(cp.species, ''), left(coalesce(cp.breed, ''), 80))
  returning id into new_id;
  insert into pet_samples (pet_id, kind, dino, mobilenet, basic)
  select new_id, s.kind, s.dino, s.mobilenet, s.basic from bio_samples(cp.scan) s;
  perform claim_transfer(p_code, new_id);
  return new_id;
end $$;

-- ---------- Mapa de clínicas Kiltrazo (urgencias) ----------
-- La clínica decide si aparece en el mapa de la app, con su ubicación, su
-- horario y si atiende urgencias. Solo se muestran esos datos públicos.
alter table public.clinics add column if not exists lat double precision;
alter table public.clinics add column if not exists lng double precision;
alter table public.clinics add column if not exists on_map boolean not null default false;
alter table public.clinics add column if not exists emergencies boolean not null default false;
alter table public.clinics add column if not exists hours text not null default '';

drop function if exists public.nearby_clinics(double precision, double precision, double precision);
create function public.nearby_clinics(p_lat double precision, p_lng double precision, p_km double precision default 50)
returns table (id uuid, name text, address text, phone text, lat double precision, lng double precision,
  emergencies boolean, home_visits boolean, hours text, km double precision)
language sql stable security definer set search_path = public as $$
  select * from (
    select c.id, c.name, c.address, c.phone, c.lat, c.lng, c.emergencies, c.home_visits, c.hours,
      case when p_lat is null or p_lng is null then null else
        6371 * 2 * asin(least(1, sqrt(power(sin(radians(c.lat - p_lat) / 2), 2)
          + cos(radians(p_lat)) * cos(radians(c.lat)) * power(sin(radians(c.lng - p_lng) / 2), 2)))) end as km
    from clinics c where c.on_map and c.lat is not null and c.lng is not null
  ) x
  where x.km is null or x.km <= p_km
  order by x.emergencies desc, x.km nulls last, x.name
  limit 100;
$$;
grant execute on function public.nearby_clinics(double precision, double precision, double precision) to anon, authenticated;

-- ---------- Días de trabajo de cada veterinario y traslado a domicilio ----------
-- Cada veterinario indica qué días atiende en esta clínica o a domicilio, y en
-- qué horario. schedule = {"1": {"place": "clinica", "from": "09:00", "to": "18:00"}, ...}
-- con 1 = lunes ... 7 = domingo. Un día sin entrada = no atiende aquí (por
-- ejemplo, trabaja en otra clínica). Entre visitas a domicilio se deja el
-- tiempo de traslado de la clínica. Si nadie cargó horario, la app deja pedir
-- cualquier hora, como antes.
alter table public.clinic_members add column if not exists schedule jsonb not null default '{}'::jsonb;
alter table public.clinics add column if not exists travel_minutes int not null default 30;
alter table public.clinics drop constraint if exists clinics_travel_minutes_check;
alter table public.clinics add constraint clinics_travel_minutes_check check (travel_minutes between 0 and 180);

-- Minutos de una hora en el día (texto 'HH:MI').
create or replace function public.hm(t text) returns int
language sql immutable as $$ select split_part(t, ':', 1)::int * 60 + split_part(t, ':', 2)::int $$;

create or replace function public.has_schedule(p_clinic uuid, p_place text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from clinic_members m, jsonb_each(m.schedule) d
    where m.clinic_id = p_clinic and m.role = 'vet' and d.value->>'place' = p_place);
$$;

-- Un veterinario que atiende en ese lugar a esa hora y no tiene otra hora
-- encima (a domicilio, contando el traslado antes y después).
create or replace function public.free_vet(p_clinic uuid, p_place text, p_at timestamptz, p_minutes int default 30)
returns uuid language sql stable security definer set search_path = public as $$
  with loc as (select (p_at at time zone 'America/Santiago') as t),
  c as (select case when p_place = 'domicilio' then travel_minutes else 0 end as gap from clinics where id = p_clinic)
  select m.user_id from clinic_members m, loc, c
  where m.clinic_id = p_clinic and m.role = 'vet'
    and m.schedule -> extract(isodow from loc.t)::text ->> 'place' = p_place
    and extract(hour from loc.t) * 60 + extract(minute from loc.t) >= hm(m.schedule -> extract(isodow from loc.t)::text ->> 'from')
    and extract(hour from loc.t) * 60 + extract(minute from loc.t) + p_minutes <= hm(m.schedule -> extract(isodow from loc.t)::text ->> 'to')
    and not exists (
      select 1 from clinic_appointments a
      where a.vet_id = m.user_id and a.status not in ('cancelada', 'no_vino')
        and a.starts_at < p_at + make_interval(mins => p_minutes + case when a.place = 'domicilio' or p_place = 'domicilio' then c.gap else 0 end)
        and a.starts_at + make_interval(mins => a.minutes + case when a.place = 'domicilio' or p_place = 'domicilio' then c.gap else 0 end) > p_at)
  order by (select count(*) from clinic_appointments a where a.vet_id = m.user_id and a.starts_at::date = p_at::date), m.created_at
  limit 1;
$$;

-- Horas libres de los próximos días para el tutor: {configured, days: [{day, times: ['09:00', ...]}]}.
create or replace function public.available_slots(p_clinic uuid, p_place text, p_days int default 14) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d date; t int; at_ timestamptz; times jsonb; out_ jsonb := '[]'::jsonb; lo int; hi int;
begin
  if auth.uid() is null then raise exception 'Sin sesión'; end if;
  if not has_schedule(p_clinic, p_place) then return jsonb_build_object('configured', false, 'days', '[]'::jsonb); end if;
  for d in select generate_series((now() at time zone 'America/Santiago')::date, (now() at time zone 'America/Santiago')::date + least(p_days, 31), '1 day')::date loop
    select min(hm(m.schedule -> extract(isodow from d)::text ->> 'from')), max(hm(m.schedule -> extract(isodow from d)::text ->> 'to'))
      into lo, hi from clinic_members m
      where m.clinic_id = p_clinic and m.role = 'vet' and m.schedule -> extract(isodow from d)::text ->> 'place' = p_place;
    continue when lo is null;
    times := '[]'::jsonb;
    t := lo;
    while t + 30 <= hi loop
      at_ := (d + make_interval(mins => t)) at time zone 'America/Santiago';
      if at_ > now() + interval '1 hour' and free_vet(p_clinic, p_place, at_) is not null then
        times := times || to_jsonb(lpad((t / 60)::text, 2, '0') || ':' || lpad((t % 60)::text, 2, '0'));
      end if;
      t := t + 30;
    end loop;
    if jsonb_array_length(times) > 0 then out_ := out_ || jsonb_build_object('day', d, 'times', times); end if;
  end loop;
  return jsonb_build_object('configured', true, 'days', out_);
end $$;

-- Lo guarda el mismo veterinario, o quien administra la clínica. No deja
-- cruzar horarios con los días que esa persona trabaja en otra clínica Kiltrazo.
create or replace function public.save_schedule(p_clinic uuid, p_user uuid, p_schedule jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare d record; other text;
begin
  if p_user <> auth.uid() and not is_clinic_admin(p_clinic) then raise exception 'Solo tú o quien administra la clínica'; end if;
  for d in select key, value from jsonb_each(coalesce(p_schedule, '{}'::jsonb)) loop
    if d.key not in ('1','2','3','4','5','6','7') or d.value->>'place' not in ('clinica', 'domicilio')
       or d.value->>'from' !~ '^\d\d:\d\d$' or d.value->>'to' !~ '^\d\d:\d\d$' or hm(d.value->>'from') >= hm(d.value->>'to') then
      raise exception 'Revisa el horario: la hora de término debe ser después de la de inicio';
    end if;
    select c.name into other from clinic_members m join clinics c on c.id = m.clinic_id
    where m.user_id = p_user and m.clinic_id <> p_clinic and m.schedule ? d.key
      and hm(m.schedule -> d.key ->> 'from') < hm(d.value->>'to') and hm(m.schedule -> d.key ->> 'to') > hm(d.value->>'from')
    limit 1;
    if other is not null then raise exception 'Ese horario se cruza con el que tiene en %', other; end if;
  end loop;
  update clinic_members set schedule = coalesce(p_schedule, '{}'::jsonb) where clinic_id = p_clinic and user_id = p_user;
  return found;
end $$;

-- Días que cada persona del equipo trabaja en otras clínicas Kiltrazo (el
-- nombre de la otra clínica solo se le muestra a la misma persona).
create or replace function public.busy_elsewhere(p_clinic uuid)
returns table (user_id uuid, dow text, from_hm text, to_hm text, clinic text)
language sql stable security definer set search_path = public as $$
  select o.user_id, d.key, d.value->>'from', d.value->>'to', case when o.user_id = auth.uid() then c.name else '' end
  from clinic_members me join clinic_members o on o.clinic_id <> p_clinic
    and o.user_id in (select user_id from clinic_members where clinic_id = p_clinic)
  join clinics c on c.id = o.clinic_id, jsonb_each(o.schedule) d
  where me.clinic_id = p_clinic and me.user_id = auth.uid();
$$;

-- ---------- Administrador de Kiltrazo y cuentas perdidas ----------

-- Nombrar o quitar a quien administra una clínica. Lo hace quien ya la
-- administra o el administrador de Kiltrazo. Siempre queda al menos uno.
create or replace function public.set_clinic_admin(p_clinic uuid, p_user uuid, p_admin boolean) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not (is_clinic_admin(p_clinic) or is_admin()) then raise exception 'Solo quien administra la clínica'; end if;
  if not p_admin and not exists (
    select 1 from clinic_members where clinic_id = p_clinic and is_admin and user_id <> p_user
  ) then
    raise exception 'La clínica necesita al menos una persona que la administre';
  end if;
  update clinic_members set is_admin = p_admin where clinic_id = p_clinic and user_id = p_user;
  return found;
end $$;

-- Alguien perdió su celular y no tenía correo: el administrador de Kiltrazo
-- pasa sus mascotas a la cuenta nueva (después de confirmar por teléfono).
create or replace function public.admin_move_pets(p_from uuid, p_to uuid) returns integer
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Solo administradores'; end if;
  if p_from = p_to or not exists (select 1 from auth.users where id = p_to) then
    raise exception 'Elige otra cuenta';
  end if;
  return move_user_data(p_from, p_to);
end $$;

-- El administrador de Kiltrazo elimina una clínica con todo su equipo,
-- pacientes, horas y fichas (las tablas de la clínica se borran en cascada).
create or replace function public.admin_delete_clinic(p_clinic uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Solo administradores'; end if;
  delete from clinics where id = p_clinic;
  return found;
end $$;

-- El administrador de Kiltrazo elimina la cuenta de un usuario: se borran su
-- perfil, sus mascotas y sus avisos (en cascada desde auth.users). Nunca a un
-- administrador ni a sí mismo.
create or replace function public.admin_delete_user(p_user uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Solo administradores'; end if;
  if p_user = auth.uid() or exists (select 1 from admins where user_id = p_user)
     or exists (select 1 from auth.users u join admin_emails e on e.email = lower(u.email) where u.id = p_user) then
    raise exception 'No se puede eliminar a un administrador de Kiltrazo';
  end if;
  delete from auth.users where id = p_user;
  return found;
end $$;

-- ---------- Pedir hora y avisar urgencias desde "Clínicas cercanas" ----------
-- El tutor avisa que va con una urgencia a una clínica del mapa que atiende
-- urgencias: queda en la agenda de hoy y al equipo le llega el aviso con su
-- teléfono para llamarlo.
alter table public.clinic_appointments drop constraint if exists clinic_appointments_service_check;
alter table public.clinic_appointments add constraint clinic_appointments_service_check
  check (service in ('consulta', 'control', 'vacuna', 'cirugia', 'peluqueria', 'otro', 'urgencia'));

create or replace function public.alert_emergency(p_pet uuid, p_clinic uuid, p_notes text default '') returns uuid
language plpgsql security definer set search_path = public as $$
declare cp clinic_patients; c clinics; a_id uuid;
begin
  if not exists (select 1 from pets where id = p_pet and owner_id = auth.uid()) then raise exception 'Mascota no encontrada'; end if;
  select * into c from clinics where id = p_clinic;
  if not coalesce(c.on_map and c.emergencies and c.approved, false) then raise exception 'Esta clínica no recibe avisos de urgencia. Llámala.'; end if;
  select * into cp from clinic_patients where clinic_id = p_clinic and pet_id = p_pet;
  if cp.id is null then
    perform patient_from_pet(p_clinic, p_pet);
    select * into cp from clinic_patients where clinic_id = p_clinic and pet_id = p_pet;
  end if;
  if exists (select 1 from clinic_appointments where patient_id = cp.id and service = 'urgencia'
             and status not in ('cancelada', 'atendida') and created_at > now() - interval '2 hours') then
    raise exception 'Ya le avisaste a esta clínica. Si es grave, llámala.';
  end if;
  insert into clinic_appointments (clinic_id, patient_id, patient_name, service, starts_at, status, place, notes, requested_by)
  values (p_clinic, cp.id, cp.name, 'urgencia', now(), 'agendada', 'clinica', left(coalesce(p_notes, ''), 300), auth.uid())
  returning id into a_id;
  insert into notifications (user_id, type, title, body, url)
  select m.user_id, 'info', '🚨 Urgencia en camino',
    cp.name || coalesce(' · ' || nullif(trim(p_notes), ''), '') || ' · ' || cp.tutor_name
      || coalesce(' ' || nullif(cp.tutor_phone, ''), ''), '#/clinica'
  from clinic_members m where m.clinic_id = p_clinic;
  return a_id;
end $$;
grant execute on function public.alert_emergency(uuid, uuid, text) to authenticated;

-- ---------- Aviso al tutor 1 hora antes de su hora ----------
-- Al tutor le llega "Tu hora es a las 15:00" con Confirmo / No puedo ir; la
-- clínica ve en la agenda quién confirmó. Lo corre pg_cron cada 5 minutos y
-- también la app de la clínica al abrirse.
alter table public.clinic_appointments add column if not exists reminded_at timestamptz;
alter table public.clinic_appointments add column if not exists confirmed_at timestamptz;

create or replace function public.send_appointment_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with due as (
    update clinic_appointments a set reminded_at = now()
    from clinic_patients cp
    where cp.id = a.patient_id and cp.tutor_user is not null and a.reminded_at is null
      and a.status = 'agendada' and a.service <> 'urgencia'
      and a.starts_at between now() + interval '5 minutes' and now() + interval '65 minutes'
    returning a.*, cp.tutor_user
  )
  insert into notifications (user_id, type, title, body, url)
  select d.tutor_user, 'info',
    '⏰ ' || d.patient_name || ' tiene hora hoy a las ' || to_char(d.starts_at at time zone 'America/Santiago', 'HH24:MI'),
    service_name(d.service) || case when d.place = 'domicilio' then ' a domicilio' else ' en ' || c.name end
      || '. Toca para confirmar que vas.',
    '#/hora/' || d.id
  from due d join clinics c on c.id = d.clinic_id;
  get diagnostics n = row_count;
  return n;
end $$;

do $$ begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('kiltrazo-recordatorios-horas', '*/5 * * * *', 'select public.send_appointment_reminders()');
  end if;
exception when others then null;
end $$;

-- Lo que ve el tutor al tocar el aviso: su hora, con la clínica.
create or replace function public.my_appointment(p_appt uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', a.id, 'starts_at', a.starts_at, 'service', a.service, 'status', a.status,
    'place', a.place, 'address', a.address, 'confirmed_at', a.confirmed_at, 'pet', cp.name,
    'clinic', c.name, 'clinic_phone', c.phone, 'clinic_address', c.address, 'lat', c.lat, 'lng', c.lng)
  from clinic_appointments a join clinic_patients cp on cp.id = a.patient_id
  join pets p on p.id = cp.pet_id join clinics c on c.id = a.clinic_id
  where a.id = p_appt and p.owner_id = auth.uid();
$$;
grant execute on function public.my_appointment(uuid) to authenticated;

create or replace function public.confirm_my_appointment(p_appt uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update clinic_appointments set confirmed_at = now()
  where id = p_appt and status in ('agendada', 'en_camino')
    and patient_id in (select cp.id from clinic_patients cp join pets p on p.id = cp.pet_id where p.owner_id = auth.uid());
  if not found then raise exception 'Hora no encontrada'; end if;
  return true;
end $$;
grant execute on function public.confirm_my_appointment(uuid) to authenticated;

-- ---------- El administrador de Kiltrazo aprueba cada clínica nueva ----------
-- Mientras no esté aprobada, la clínica puede usar su agenda y fichas, pero no
-- aparece en "Clínicas cercanas" ni recibe horas ni urgencias desde el mapa.
-- Las clínicas que ya existían quedan aprobadas.
alter table public.clinics add column if not exists approved boolean not null default true;
alter table public.clinics alter column approved set default false;

-- Solo el administrador de Kiltrazo cambia "aprobada" (la clínica edita sus
-- otros datos).
create or replace function public.keep_clinic_approval() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.approved is distinct from old.approved and not is_admin() then new.approved := old.approved; end if;
  return new;
end $$;
drop trigger if exists keep_clinic_approval on public.clinics;
create trigger keep_clinic_approval before update on public.clinics
  for each row execute function public.keep_clinic_approval();

-- Al crear una clínica, a los administradores de Kiltrazo les llega el aviso.
create or replace function public.tell_admins_new_clinic() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not new.approved then
    insert into notifications (user_id, type, title, body, url)
    select u, 'admin', 'Clínica nueva para aprobar 🏥', new.name || coalesce(' · ' || nullif(new.address, ''), ''), '#/admin'
    from (select user_id as u from admins
          union select p.id from profiles p join admin_emails e on e.email = lower(p.email)) x;
  end if;
  return new;
end $$;
drop trigger if exists tell_admins_new_clinic on public.clinics;
create trigger tell_admins_new_clinic after insert on public.clinics
  for each row execute function public.tell_admins_new_clinic();

create or replace function public.admin_approve_clinic(p_clinic uuid, p_ok boolean default true) returns boolean
language plpgsql security definer set search_path = public as $$
declare c clinics;
begin
  if not is_admin() then raise exception 'Solo administradores'; end if;
  update clinics set approved = p_ok where id = p_clinic returning * into c;
  if c.id is null then raise exception 'Clínica no encontrada'; end if;
  if p_ok then
    insert into notifications (user_id, type, title, body, url)
    select m.user_id, 'info', '¡' || c.name || ' fue aprobada! 🎉',
      'Ya puedes aparecer en "Clínicas cercanas" y recibir horas desde la app (actívalo en Equipo → Datos de la clínica).', '#/clinica/equipo'
    from clinic_members m where m.clinic_id = c.id;
  end if;
  return true;
end $$;
grant execute on function public.admin_approve_clinic(uuid, boolean) to authenticated;

-- ---------- Veterinario independiente: solo a domicilio ----------
-- Quien no tiene local: todas sus horas son a domicilio, en vez de dirección
-- indica la comuna o zona donde atiende, y en el mapa sale un punto aproximado.
alter table public.clinics add column if not exists only_home boolean not null default false;

create or replace function public.fix_only_home() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.only_home then
    new.home_visits := true;
    new.emergencies := false;  -- no hay a dónde llegar con una urgencia
  end if;
  return new;
end $$;
drop trigger if exists fix_only_home on public.clinics;
create trigger fix_only_home before insert or update on public.clinics
  for each row execute function public.fix_only_home();

-- Un tutor no puede pedir hora "en la clínica" a quien atiende solo a domicilio.
create or replace function public.check_only_home() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.place = 'clinica' and new.requested_by is not null
     and exists (select 1 from clinics where id = new.clinic_id and only_home) then
    raise exception 'Este veterinario atiende solo a domicilio';
  end if;
  return new;
end $$;
drop trigger if exists check_only_home on public.clinic_appointments;
create trigger check_only_home before insert on public.clinic_appointments
  for each row execute function public.check_only_home();

drop function if exists public.nearby_clinics(double precision, double precision, double precision);
create function public.nearby_clinics(p_lat double precision, p_lng double precision, p_km double precision default 50)
returns table (id uuid, name text, address text, phone text, lat double precision, lng double precision,
  emergencies boolean, home_visits boolean, only_home boolean, hours text, km double precision)
language sql stable security definer set search_path = public as $$
  select * from (
    select y.*,
      case when p_lat is null or p_lng is null then null else
        6371 * 2 * asin(least(1, sqrt(power(sin(radians(y.lat - p_lat) / 2), 2)
          + cos(radians(p_lat)) * cos(radians(y.lat)) * power(sin(radians(y.lng - p_lng) / 2), 2)))) end as km
    from (
      -- Solo a domicilio: el punto se redondea (~1 km) para no mostrar su casa.
      select c.id, c.name, c.address, c.phone,
        case when c.only_home then round(c.lat::numeric, 2)::double precision else c.lat end as lat,
        case when c.only_home then round(c.lng::numeric, 2)::double precision else c.lng end as lng,
        c.emergencies, c.home_visits, c.only_home, c.hours
      from clinics c where c.on_map and c.approved and c.lat is not null and c.lng is not null
    ) y
  ) x
  where x.km is null or x.km <= p_km
  order by x.emergencies desc, x.km nulls last, x.name
  limit 100;
$$;
grant execute on function public.nearby_clinics(double precision, double precision, double precision) to anon, authenticated;

-- ---------- Logo y página propia de la clínica; pedir hora sin la app ----------
-- Logo: imagen chica (data URL) que la clínica sube. Página propia:
-- …/#/c/<slug>, a la que puede apuntar su dominio .cl.
alter table public.clinics add column if not exists logo text;
alter table public.clinics drop constraint if exists clinics_logo_size;
alter table public.clinics add constraint clinics_logo_size check (logo is null or length(logo) < 400000);
alter table public.clinics add column if not exists slug text;
create unique index if not exists clinics_slug on public.clinics (slug);
alter table public.clinic_patients add column if not exists without_app boolean not null default false;

create or replace function public.make_clinic_slug(p_name text, p_id uuid) returns text
language plpgsql set search_path = public as $$
declare base text; s text; n int := 1;
begin
  base := trim(both '-' from regexp_replace(translate(lower(coalesce(p_name, '')), 'áàäâéèëêíìïîóòöôúùüûñç', 'aaaaeeeeiiiioooouuuunc'), '[^a-z0-9]+', '-', 'g'));
  base := left(nullif(base, ''), 40);
  base := coalesce(trim(both '-' from base), 'clinica');
  s := base;
  while exists (select 1 from clinics where slug = s and id <> p_id) loop
    n := n + 1;
    s := base || '-' || n;
  end loop;
  return s;
end $$;

create or replace function public.set_clinic_slug() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.slug is null or new.slug = '' then new.slug := make_clinic_slug(new.name, new.id); end if;
  return new;
end $$;
drop trigger if exists set_clinic_slug on public.clinics;
create trigger set_clinic_slug before insert or update on public.clinics
  for each row execute function public.set_clinic_slug();
update public.clinics set slug = make_clinic_slug(name, id) where slug is null;

-- Lo que muestra la página de la clínica (solo clínicas aprobadas).
create or replace function public.public_clinic(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', c.id, 'name', c.name, 'slug', c.slug, 'logo', c.logo, 'address', c.address, 'phone', c.phone,
    'hours', c.hours, 'home_visits', c.home_visits, 'only_home', c.only_home, 'emergencies', c.emergencies,
    'lat', case when c.only_home then null else c.lat end, 'lng', case when c.only_home then null else c.lng end)
  from clinics c where c.slug = lower(p_slug) and c.approved;
$$;
grant execute on function public.public_clinic(text) to anon, authenticated;

-- Pedir hora sin la app: los datos del tutor y la mascota llegan en el
-- formulario. La clínica lo confirma por teléfono o WhatsApp.
create or replace function public.guest_request_appointment(
  p_clinic uuid, p_tutor jsonb, p_pet jsonb, p_place text, p_service text, p_starts_at timestamptz,
  p_address text default '', p_notes text default ''
) returns uuid
language plpgsql security definer set search_path = public as $$
declare c clinics; pid uuid; a_id uuid; v_vet uuid;
  t_name text := left(trim(coalesce(p_tutor->>'name', '')), 120);
  t_phone text := left(trim(coalesce(p_tutor->>'phone', '')), 40);
  t_email text := left(lower(trim(coalesce(p_tutor->>'email', ''))), 120);
  m_name text := left(trim(coalesce(p_pet->>'name', '')), 80);
begin
  if auth.uid() is null then raise exception 'Sin sesión'; end if;
  select * into c from clinics where id = p_clinic and approved;
  if c.id is null then raise exception 'Clínica no encontrada'; end if;
  if t_name = '' or length(regexp_replace(t_phone, '\D', '', 'g')) < 8 then raise exception 'Escribe tu nombre y tu teléfono'; end if;
  if m_name = '' then raise exception 'Escribe el nombre de tu mascota'; end if;
  if p_place not in ('clinica', 'domicilio') then raise exception 'Lugar no válido'; end if;
  if p_place = 'domicilio' and not c.home_visits then raise exception 'Esta clínica no hace visitas a domicilio'; end if;
  if p_place = 'domicilio' and coalesce(trim(p_address), '') = '' then raise exception 'Falta la dirección'; end if;
  if p_starts_at < now() then raise exception 'Elige una fecha futura'; end if;
  if (select count(*) from clinic_appointments where requested_by = auth.uid() and status = 'solicitada') >= 3 then
    raise exception 'Ya tienes horas esperando confirmación';
  end if;
  if has_schedule(p_clinic, p_place) then
    v_vet := free_vet(p_clinic, p_place, p_starts_at);
    if v_vet is null then raise exception 'Esa hora ya no está disponible. Elige otra.'; end if;
  end if;
  -- Misma mascota y mismo teléfono: se usa la ficha que ya existe.
  select id into pid from clinic_patients
  where clinic_id = p_clinic and pet_id is null and lower(name) = lower(m_name)
    and right(regexp_replace(tutor_phone, '\D', '', 'g'), 9) = right(regexp_replace(t_phone, '\D', '', 'g'), 9)
  limit 1;
  if pid is null then
    insert into clinic_patients (clinic_id, name, species, breed, tutor_name, tutor_phone, tutor_email, tutor_address, without_app)
    values (p_clinic, m_name, left(coalesce(p_pet->>'species', ''), 20), left(coalesce(p_pet->>'breed', ''), 80),
      t_name, t_phone, t_email, case when p_place = 'domicilio' then left(trim(p_address), 200) else '' end, true)
    returning id into pid;
  elsif p_place = 'domicilio' then
    update clinic_patients set tutor_address = left(trim(p_address), 200) where id = pid;
  end if;
  insert into clinic_appointments (clinic_id, patient_id, patient_name, service, starts_at, status, place, address, notes, requested_by, vet_id)
  values (p_clinic, pid, m_name, coalesce(nullif(p_service, ''), 'consulta'), p_starts_at, 'solicitada', p_place,
    case when p_place = 'domicilio' then left(trim(p_address), 200) else '' end, left(coalesce(p_notes, ''), 300), auth.uid(), v_vet)
  returning id into a_id;
  insert into notifications (user_id, type, title, body, url)
  select m.user_id, 'info', 'Nueva solicitud de hora 📅',
    m_name || ' · ' || service_name(p_service) || case when p_place = 'domicilio' then ' a domicilio' else '' end
      || ' · ' || cl_when(p_starts_at) || ' · sin app: confírmale por WhatsApp', '#/clinica/solicitudes'
  from clinic_members m where m.clinic_id = p_clinic;
  return a_id;
end $$;
grant execute on function public.guest_request_appointment(uuid, jsonb, jsonb, text, text, timestamptz, text, text) to authenticated;

-- ---------- Especialidades de cada veterinario ----------
-- Lista fija (para poder buscar): cada veterinario marca las suyas y la
-- clínica muestra las de todo su equipo, en el mapa y en la página pública.
alter table public.clinic_members add column if not exists specialties text[] not null default '{}';
alter table public.clinic_members drop constraint if exists clinic_members_specialties_check;
alter table public.clinic_members add constraint clinic_members_specialties_check check (specialties <@ array[
  'general', 'felinos', 'exoticos', 'dermatologia', 'cirugia', 'traumatologia', 'cardiologia',
  'oftalmologia', 'odontologia', 'oncologia', 'comportamiento', 'imagenologia']::text[]);

create or replace function public.save_specialties(p_clinic uuid, p_user uuid, p_specialties text[]) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(p_user, auth.uid()) <> auth.uid() and not is_clinic_admin(p_clinic) then raise exception 'Solo tú o quien administra la clínica'; end if;
  update clinic_members set specialties = coalesce((select array_agg(distinct s) from unnest(p_specialties) s), '{}')
  where clinic_id = p_clinic and user_id = coalesce(p_user, auth.uid()) and role = 'vet';
  return found;
end $$;
grant execute on function public.save_specialties(uuid, uuid, text[]) to authenticated;

create or replace function public.clinic_specialties(p_clinic uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct s order by s), '{}') from clinic_members m, unnest(m.specialties) s
  where m.clinic_id = p_clinic and m.role = 'vet';
$$;

-- Mapa y buscador de veterinarios: ahora con el enlace a la página de cada
-- clínica y sus especialidades.
drop function if exists public.nearby_clinics(double precision, double precision, double precision);
create function public.nearby_clinics(p_lat double precision, p_lng double precision, p_km double precision default 50)
returns table (id uuid, name text, slug text, address text, phone text, lat double precision, lng double precision,
  emergencies boolean, home_visits boolean, only_home boolean, hours text, specialties text[], km double precision)
language sql stable security definer set search_path = public as $$
  select * from (
    select y.*,
      case when p_lat is null or p_lng is null then null else
        6371 * 2 * asin(least(1, sqrt(power(sin(radians(y.lat - p_lat) / 2), 2)
          + cos(radians(p_lat)) * cos(radians(y.lat)) * power(sin(radians(y.lng - p_lng) / 2), 2)))) end as km
    from (
      -- Solo a domicilio: el punto se redondea (~1 km) para no mostrar su casa.
      select c.id, c.name, c.slug, c.address, c.phone,
        case when c.only_home then round(c.lat::numeric, 2)::double precision else c.lat end as lat,
        case when c.only_home then round(c.lng::numeric, 2)::double precision else c.lng end as lng,
        c.emergencies, c.home_visits, c.only_home, c.hours, clinic_specialties(c.id) as specialties
      from clinics c where c.on_map and c.approved and c.lat is not null and c.lng is not null
    ) y
  ) x
  where x.km is null or x.km <= p_km
  order by x.emergencies desc, x.km nulls last, x.name
  limit 200;
$$;
grant execute on function public.nearby_clinics(double precision, double precision, double precision) to anon, authenticated;

create or replace function public.public_clinic(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', c.id, 'name', c.name, 'slug', c.slug, 'logo', c.logo, 'address', c.address, 'phone', c.phone,
    'hours', c.hours, 'home_visits', c.home_visits, 'only_home', c.only_home, 'emergencies', c.emergencies,
    'lat', case when c.only_home then null else c.lat end, 'lng', case when c.only_home then null else c.lng end,
    'specialties', to_jsonb(clinic_specialties(c.id)),
    'vets', coalesce((select jsonb_agg(jsonb_build_object('name', m.name, 'specialties', to_jsonb(m.specialties)) order by m.created_at)
      from clinic_members m where m.clinic_id = c.id and m.role = 'vet' and m.name <> ''), '[]'::jsonb))
  from clinics c where c.slug = lower(p_slug) and c.approved;
$$;
grant execute on function public.public_clinic(text) to anon, authenticated;

-- ---------- Publicidad en el buscador de veterinarios ----------
-- Banners que maneja el administrador general de Kiltrazo. Se muestran
-- marcados como "Publicidad", solo mientras estén activos y en sus fechas.
create table if not exists public.landing_banners (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  image text not null check (length(image) < 700000),
  link text not null default '',
  active boolean not null default true,
  sort int not null default 0,
  starts_on date,
  ends_on date,
  clicks int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.landing_banners enable row level security;
drop policy if exists "banners visibles" on public.landing_banners;
create policy "banners visibles" on public.landing_banners for select using (
  is_admin() or (active and (starts_on is null or starts_on <= current_date) and (ends_on is null or ends_on >= current_date)));
drop policy if exists "banners admin" on public.landing_banners;
create policy "banners admin" on public.landing_banners for all using (is_admin()) with check (is_admin());
grant select on public.landing_banners to anon, authenticated;
grant insert, update, delete on public.landing_banners to authenticated;

create or replace function public.banner_click(p_id uuid) returns void
language sql security definer set search_path = public as $$
  update landing_banners set clicks = clicks + 1 where id = p_id and active;
$$;
grant execute on function public.banner_click(uuid) to anon, authenticated;

-- ---------- Revisión de la clínica: RUT, título, patente y términos ----------
-- Al crear la clínica se sube el RUT y el título del veterinario a cargo (y la
-- patente si tiene local) y se aceptan los términos de uso. Los archivos van
-- a la carpeta "<clínica>/revision/" del bucket privado "clinica": los ve el
-- equipo de la clínica y el administrador de Kiltrazo, nadie más.
alter table public.clinics add column if not exists rut text not null default '';
alter table public.clinics add column if not exists docs jsonb not null default '[]'::jsonb;
alter table public.clinics add column if not exists terms_version text;
alter table public.clinics add column if not exists terms_at timestamptz;

-- La fecha de aceptación la pone la base, no el navegador.
create or replace function public.stamp_clinic_terms() returns trigger
language plpgsql as $$
begin
  if new.terms_version is distinct from old.terms_version then
    new.terms_at := case when new.terms_version is null then null else now() end;
  else
    new.terms_at := old.terms_at;
  end if;
  return new;
end $$;
drop trigger if exists stamp_clinic_terms on public.clinics;
create trigger stamp_clinic_terms before update on public.clinics
  for each row execute function public.stamp_clinic_terms();

drop policy if exists "admin ve documentos de revisión" on storage.objects;
create policy "admin ve documentos de revisión" on storage.objects for select using (
  bucket_id = 'clinica' and (storage.foldername(objects.name))[2] = 'revision' and public.is_admin());

-- ---------- Quitar un paciente de la clínica ----------
-- La clínica quita al paciente solo de su lista: no se borra la mascota de
-- Kiltrazo (es del tutor) ni el historial de la clínica, que vuelve si el
-- paciente regresa (pide hora o la vinculan de nuevo). Sus horas pendientes
-- en esta clínica se cancelan. Borrar la mascota de Kiltrazo solo lo puede
-- hacer su dueño o el administrador general.
alter table public.clinic_patients add column if not exists removed_at timestamptz;

create or replace function public.remove_clinic_patient(p_patient uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare cp clinic_patients;
begin
  select * into cp from clinic_patients where id = p_patient;
  if cp.id is null or not is_clinic_member(cp.clinic_id) then raise exception 'Paciente no encontrado'; end if;
  update clinic_patients set removed_at = now() where id = p_patient;
  update clinic_appointments set status = 'cancelada'
  where patient_id = p_patient and starts_at >= now() - interval '3 hours'
    and status in ('solicitada', 'agendada', 'en_camino');
  return true;
end $$;
grant execute on function public.remove_clinic_patient(uuid) to authenticated;

-- Si el paciente quitado vuelve a pedir hora, reaparece en la lista.
create or replace function public.restore_clinic_patient() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.patient_id is not null then
    update clinic_patients set removed_at = null where id = new.patient_id and removed_at is not null;
  end if;
  return new;
end $$;
drop trigger if exists restore_clinic_patient on public.clinic_appointments;
create trigger restore_clinic_patient after insert on public.clinic_appointments
  for each row execute function public.restore_clinic_patient();

-- El tutor deja de ver en "Mi veterinaria" la clínica que lo quitó (sus vacunas
-- puestas ahí siguen en el historial de la mascota).
create or replace function public.pet_health(p_pet uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from pets where id = p_pet and owner_id = auth.uid()) then
    raise exception 'Mascota no encontrada';
  end if;
  return jsonb_build_object(
    'clinics', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone, 'address', c.address,
        'home_visits', c.home_visits, 'only_home', c.only_home))
      from clinics c where c.id in (select clinic_id from clinic_patients where pet_id = p_pet and removed_at is null)), '[]'::jsonb),
    'vaccines', coalesce((select jsonb_agg(jsonb_build_object('kind', v.kind, 'name', v.name, 'applied_on', v.applied_on,
        'next_due', v.next_due, 'clinic', c.name) order by v.applied_on desc)
      from clinic_vaccines v join clinic_patients cp on cp.id = v.patient_id join clinics c on c.id = v.clinic_id
      where cp.pet_id = p_pet), '[]'::jsonb),
    'appointments', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'starts_at', a.starts_at, 'service', a.service,
        'status', a.status, 'place', a.place, 'address', a.address, 'clinic', c.name, 'confirmed_at', a.confirmed_at) order by a.starts_at)
      from clinic_appointments a join clinic_patients cp on cp.id = a.patient_id join clinics c on c.id = a.clinic_id
      where cp.pet_id = p_pet and a.starts_at >= now() - interval '3 hours'
        and a.status in ('solicitada', 'agendada', 'en_camino')), '[]'::jsonb));
end $$;

-- ---------- Pasar una mascota a otra persona ----------
-- Si el dueño se la regaló a alguien, en vez de borrarla crea un enlace (sirve
-- una vez y dura 7 días). Quien lo abre y la recibe queda como su nuevo dueño,
-- con su cara registrada. Las clínicas conservan su ficha, pero sin enlace con
-- el dueño anterior: el nuevo dueño la vincula con su propio código si quiere.
create table if not exists public.pet_gifts (
  code text primary key,
  pet_id uuid not null references public.pets on delete cascade,
  from_user uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.pet_gifts enable row level security;

create or replace function public.create_pet_gift(p_pet uuid) returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not exists (select 1 from pets where id = p_pet and owner_id = auth.uid()) then
    raise exception 'Mascota no encontrada';
  end if;
  delete from pet_gifts where pet_id = p_pet or created_at < now() - interval '7 days';
  loop
    c := short_code(8);
    exit when not exists (select 1 from pet_gifts where code = c);
  end loop;
  insert into pet_gifts (code, pet_id, from_user) values (c, p_pet, auth.uid());
  return c;
end $$;
grant execute on function public.create_pet_gift(uuid) to authenticated;

create or replace function public.pet_gift_info(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('name', p.name, 'photo', p.photo, 'species', p.species, 'breed', p.breed,
    'from', coalesce(nullif(o.first_name, ''), split_part(o.name, ' ', 1), ''), 'mine', p.owner_id = auth.uid())
  from pet_gifts g join pets p on p.id = g.pet_id left join profiles o on o.id = g.from_user
  where g.code = upper(trim(p_code)) and g.created_at > now() - interval '7 days' and p.owner_id = g.from_user;
$$;
grant execute on function public.pet_gift_info(text) to authenticated;

create or replace function public.accept_pet_gift(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare g pet_gifts; o profiles;
begin
  select * into o from profiles where id = auth.uid();
  if o.id is null then raise exception 'Primero completa tu perfil'; end if;
  delete from pet_gifts where code = upper(trim(p_code)) and created_at > now() - interval '7 days' returning * into g;
  if g.code is null or not exists (select 1 from pets where id = g.pet_id and owner_id = g.from_user) then
    raise exception 'Este enlace ya no sirve. Pide uno nuevo.';
  end if;
  if g.from_user = auth.uid() then raise exception 'Esta mascota ya es tuya'; end if;
  update pets set owner_id = auth.uid(),
    owner_name = coalesce(nullif(trim(concat_ws(' ', o.first_name, o.last_name)), ''), o.name)
  where id = g.pet_id;
  update clinic_patients set pet_id = null, tutor_user = null where pet_id = g.pet_id;
  delete from pet_codes where pet_id = g.pet_id;
  return g.pet_id;
end $$;
grant execute on function public.accept_pet_gift(text) to authenticated;

-- ==========================================================================
-- ---------- Kiltrazo Municipal ----------
-- Una municipalidad usa la misma base que Kiltrazo Clínica (equipo, fichas,
-- vacunas, agenda), marcada con kind = 'municipio'. Suma operativos con cupos
-- que reservan los vecinos y un tablero de animales perdidos y encontrados en
-- la comuna. No reemplaza al Registro Nacional de Mascotas: es la gestión local.

alter table public.clinics add column if not exists kind text not null default 'clinica';
alter table public.clinics drop constraint if exists clinics_kind_check;
alter table public.clinics add constraint clinics_kind_check check (kind in ('clinica', 'municipio'));
-- Comuna y radio del tablero de perdidos y encontrados (centro = lat/lng).
alter table public.clinics add column if not exists comuna text not null default '';
alter table public.clinics add column if not exists area_km numeric(4, 1) not null default 5;
alter table public.clinics drop constraint if exists clinics_area_km_check;
alter table public.clinics add constraint clinics_area_km_check check (area_km between 1 and 30);

-- Estado del animal en la ficha (sobre todo para el municipio).
alter table public.clinic_patients add column if not exists status text not null default 'con_responsable';
alter table public.clinic_patients drop constraint if exists clinic_patients_status_check;
alter table public.clinic_patients add constraint clinic_patients_status_check check (status in (
  'con_responsable', 'comunitario', 'extraviado', 'encontrado', 'en_recuperacion', 'en_adopcion', 'fallecido'));

-- Solo el administrador de Kiltrazo cambia "aprobada" y el tipo. Un municipio
-- no aparece en el mapa de clínicas ni recibe horas o urgencias desde ahí.
create or replace function public.keep_clinic_approval() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.approved is distinct from old.approved and not is_admin() then new.approved := old.approved; end if;
  if new.kind is distinct from old.kind and not is_admin() then new.kind := old.kind; end if;
  if new.kind = 'municipio' then
    new.on_map := false; new.emergencies := false; new.home_visits := false; new.only_home := false;
  end if;
  return new;
end $$;

create or replace function public.tell_admins_new_clinic() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not new.approved then
    insert into notifications (user_id, type, title, body, url)
    select u, 'admin',
      case when new.kind = 'municipio' then 'Municipalidad nueva para aprobar 🏛️' else 'Clínica nueva para aprobar 🏥' end,
      new.name || coalesce(' · ' || nullif(case when new.kind = 'municipio' then new.comuna else new.address end, ''), ''), '#/admin'
    from (select user_id as u from admins
          union select p.id from profiles p join admin_emails e on e.email = lower(p.email)) x;
  end if;
  return new;
end $$;

create or replace function public.admin_approve_clinic(p_clinic uuid, p_ok boolean default true) returns boolean
language plpgsql security definer set search_path = public as $$
declare c clinics;
begin
  if not is_admin() then raise exception 'Solo administradores'; end if;
  update clinics set approved = p_ok where id = p_clinic returning * into c;
  if c.id is null then raise exception 'Clínica no encontrada'; end if;
  if p_ok then
    insert into notifications (user_id, type, title, body, url)
    select m.user_id, 'info', '¡' || c.name || ' fue aprobada! 🎉',
      case when c.kind = 'municipio'
        then 'Ya puedes publicar operativos para que los vecinos reserven cupos y ver el tablero de perdidos y encontrados de la comuna.'
        else 'Ya puedes aparecer en "Clínicas cercanas" y recibir horas desde la app (actívalo en Equipo → Datos de la clínica).' end,
      case when c.kind = 'municipio' then '#/clinica/operativos' else '#/clinica/equipo' end
    from clinic_members m where m.clinic_id = c.id;
  end if;
  return true;
end $$;

create or replace function public.create_municipality(
  p_name text, p_comuna text, p_address text, p_phone text, p_member_name text, p_role text,
  p_lat double precision, p_lng double precision
) returns uuid
language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  perform require_account();
  if coalesce(trim(p_comuna), '') = '' then raise exception 'Escribe la comuna'; end if;
  if p_lat is null or p_lng is null then raise exception 'Marca la comuna en el mapa'; end if;
  insert into clinics (name, comuna, address, phone, created_by, kind, lat, lng)
  values (trim(p_name), trim(p_comuna), coalesce(p_address, ''), coalesce(p_phone, ''), auth.uid(), 'municipio', p_lat, p_lng)
  returning id into c;
  insert into clinic_members (clinic_id, user_id, name, role, is_admin)
  values (c, auth.uid(), coalesce(p_member_name, ''), case when p_role = 'recepcion' then 'recepcion' else 'vet' end, true);
  return c;
end $$;
grant execute on function public.create_municipality(text, text, text, text, text, text, double precision, double precision) to authenticated;

-- Los municipios no tienen página pública de clínica (?c=…).
create or replace function public.public_clinic(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', c.id, 'name', c.name, 'slug', c.slug, 'logo', c.logo, 'address', c.address, 'phone', c.phone,
    'hours', c.hours, 'home_visits', c.home_visits, 'only_home', c.only_home, 'emergencies', c.emergencies,
    'lat', case when c.only_home then null else c.lat end, 'lng', case when c.only_home then null else c.lng end,
    'specialties', to_jsonb(clinic_specialties(c.id)),
    'vets', coalesce((select jsonb_agg(jsonb_build_object('name', m.name, 'specialties', to_jsonb(m.specialties)) order by m.created_at)
      from clinic_members m where m.clinic_id = c.id and m.role = 'vet' and m.name <> ''), '[]'::jsonb))
  from clinics c where c.slug = lower(p_slug) and c.approved and c.kind = 'clinica';
$$;
grant execute on function public.public_clinic(text) to anon, authenticated;

-- Quien recibe una mascota sabe si se la entrega un municipio (para ofrecerle
-- la casilla de ofertas de Kiltrazo, que es aparte del municipio).
create or replace function public.transfer_info(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('clinic', c.name, 'name', cp.name, 'species', cp.species, 'breed', cp.breed, 'photo', cp.photo,
    'has_scan', cp.scan is not null, 'kind', c.kind)
  from clinic_transfers t join clinic_patients cp on cp.id = t.patient_id join clinics c on c.id = t.clinic_id
  where t.code = upper(trim(p_code)) and t.created_at > now() - interval '7 days' and cp.pet_id is null
    and auth.uid() is not null;
$$;

-- ---------- Operativos (vacunación, esterilización, microchip…) ----------
-- El municipio publica una jornada con cupos; el vecino reserva desde un
-- enlace, con o sin la app. Cada reserva queda como una hora en la agenda.
create table if not exists public.clinic_drives (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  services text[] not null default '{}',
  place text not null default '',
  address text not null default '',
  lat double precision,
  lng double precision,
  day date not null,
  starts time not null,
  ends time not null,
  slot_minutes int not null default 20 check (slot_minutes between 5 and 240),
  per_slot int not null default 2 check (per_slot between 1 and 50),
  notes text not null default '',
  open boolean not null default true,
  created_at timestamptz not null default now(),
  check (ends > starts)
);
create index if not exists clinic_drives_clinic on public.clinic_drives (clinic_id, day);
alter table public.clinic_drives enable row level security;
drop policy if exists "equipo de la clínica" on public.clinic_drives;
create policy "equipo de la clínica" on public.clinic_drives for all
  using (is_clinic_member(clinic_id)) with check (is_clinic_member(clinic_id));

alter table public.clinic_appointments add column if not exists drive_id uuid references public.clinic_drives on delete set null;
create index if not exists clinic_appointments_drive on public.clinic_appointments (drive_id, starts_at);
alter table public.clinic_appointments drop constraint if exists clinic_appointments_service_check;
alter table public.clinic_appointments add constraint clinic_appointments_service_check
  check (service in ('consulta', 'control', 'vacuna', 'cirugia', 'peluqueria', 'otro', 'urgencia', 'operativo'));

create or replace function public.service_name(s text) returns text
language sql immutable as $$
  select case s when 'consulta' then 'Consulta' when 'control' then 'Control' when 'vacuna' then 'Vacuna'
    when 'cirugia' then 'Cirugía' when 'peluqueria' then 'Peluquería' when 'urgencia' then 'Urgencia'
    when 'operativo' then 'Operativo' else 'Hora' end;
$$;

-- Horarios de un operativo (hora de Chile).
create or replace function public.drive_slots(d clinic_drives) returns setof timestamptz
language sql stable as $$
  select ((d.day + d.starts) + make_interval(mins => n * d.slot_minutes)) at time zone 'America/Santiago'
  from generate_series(0, floor(extract(epoch from (d.ends - d.starts)) / 60 / d.slot_minutes)::int - 1) n;
$$;

-- Lo que ve el vecino: datos del operativo y cupos libres por horario.
create or replace function public.public_drive(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', d.id, 'title', d.title, 'services', to_jsonb(d.services), 'place', d.place,
    'address', d.address, 'lat', d.lat, 'lng', d.lng, 'day', d.day, 'notes', d.notes,
    'starts', to_char(d.starts, 'HH24:MI'), 'ends', to_char(d.ends, 'HH24:MI'),
    'open', d.open and d.day >= (now() at time zone 'America/Santiago')::date,
    'muni', c.name, 'comuna', c.comuna, 'logo', c.logo, 'phone', c.phone,
    'slots', coalesce((select jsonb_agg(jsonb_build_object('at', s.at, 'left', greatest(0, d.per_slot - (
        select count(*) from clinic_appointments a where a.drive_id = d.id and a.starts_at = s.at and a.status <> 'cancelada')))
        order by s.at)
      from drive_slots(d) as s(at)), '[]'::jsonb))
  from clinic_drives d join clinics c on c.id = d.clinic_id
  where d.id = p_id and c.kind = 'municipio' and c.approved;
$$;
grant execute on function public.public_drive(uuid) to anon, authenticated;

-- El vecino reserva un cupo: con su mascota de Kiltrazo (p_pet_id) o dejando
-- sus datos. Queda agendado de inmediato (los cupos ya los definió el municipio).
create or replace function public.book_drive(
  p_drive uuid, p_at timestamptz, p_tutor jsonb, p_pet jsonb, p_pet_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare d clinic_drives; c clinics; cp_id uuid; pname text; nm text; ph text; a_id uuid;
begin
  select * into d from clinic_drives where id = p_drive;
  select * into c from clinics where id = d.clinic_id;
  if d.id is null or c.kind <> 'municipio' or not c.approved then raise exception 'Operativo no encontrado'; end if;
  if not d.open or d.day < (now() at time zone 'America/Santiago')::date then
    raise exception 'Las inscripciones de este operativo están cerradas';
  end if;
  if p_at < now() then raise exception 'Ese horario ya pasó. Elige otro.'; end if;
  if not exists (select 1 from drive_slots(d) as s(at) where s.at = p_at) then raise exception 'Elige un horario de la lista'; end if;
  -- Una reserva a la vez por operativo, para no pasarse de los cupos.
  perform pg_advisory_xact_lock(hashtext(p_drive::text));
  if (select count(*) from clinic_appointments where drive_id = d.id and starts_at = p_at and status <> 'cancelada') >= d.per_slot then
    raise exception 'Ese horario se llenó. Elige otro.';
  end if;

  if p_pet_id is not null then
    if not exists (select 1 from pets where id = p_pet_id and owner_id = auth.uid()) then raise exception 'Mascota no encontrada'; end if;
    select id into cp_id from clinic_patients where clinic_id = c.id and pet_id = p_pet_id limit 1;
    if cp_id is null then cp_id := patient_from_pet(c.id, p_pet_id); end if;
    update clinic_patients set removed_at = null where id = cp_id;
  else
    nm := left(trim(coalesce(p_tutor ->> 'name', '')), 120);
    ph := left(trim(coalesce(p_tutor ->> 'phone', '')), 30);
    pname := left(trim(coalesce(p_pet ->> 'name', '')), 80);
    if nm = '' or length(regexp_replace(ph, '\D', '', 'g')) < 8 then raise exception 'Escribe tu nombre y tu teléfono'; end if;
    if pname = '' then raise exception 'Escribe el nombre de tu mascota'; end if;
    if (select count(*) from clinic_appointments a join clinic_patients p on p.id = a.patient_id
        where a.drive_id = d.id and a.status <> 'cancelada'
          and right(regexp_replace(p.tutor_phone, '\D', '', 'g'), 9) = right(regexp_replace(ph, '\D', '', 'g'), 9)) >= 4 then
      raise exception 'Ya tienes 4 cupos en este operativo. Si necesitas más, llama a la municipalidad.';
    end if;
    select id into cp_id from clinic_patients
    where clinic_id = c.id and pet_id is null and lower(name) = lower(pname)
      and right(regexp_replace(tutor_phone, '\D', '', 'g'), 9) = right(regexp_replace(ph, '\D', '', 'g'), 9)
    limit 1;
    if cp_id is null then
      insert into clinic_patients (clinic_id, name, species, breed, tutor_name, tutor_phone, tutor_email, without_app)
      values (c.id, pname, case when p_pet ->> 'species' in ('perro', 'gato', 'otro') then p_pet ->> 'species' else '' end,
        left(coalesce(p_pet ->> 'breed', ''), 80), nm, ph, lower(left(trim(coalesce(p_tutor ->> 'email', '')), 120)), true)
      returning id into cp_id;
    else
      update clinic_patients set removed_at = null where id = cp_id;
    end if;
  end if;

  select name into pname from clinic_patients where id = cp_id;
  if exists (select 1 from clinic_appointments where drive_id = d.id and patient_id = cp_id and status <> 'cancelada') then
    raise exception '% ya tiene un cupo en este operativo', pname;
  end if;
  insert into clinic_appointments (clinic_id, patient_id, patient_name, service, starts_at, minutes, status, place, drive_id, notes, requested_by)
  values (c.id, cp_id, pname, 'operativo', p_at, d.slot_minutes, 'agendada', 'clinica', d.id,
    left(coalesce(p_tutor ->> 'notes', ''), 300), auth.uid())
  returning id into a_id;
  return a_id;
end $$;
grant execute on function public.book_drive(uuid, timestamptz, jsonb, jsonb, uuid) to authenticated;

-- ---------- Tablero de perdidos y encontrados de la comuna ----------
-- Lo mismo que ya ven los vecinos en los avisos (foto, nombre, zona a ~100 m),
-- dentro del radio de la comuna. Nunca datos del dueño ni de quien la encontró.
create or replace function public.muni_board(p_clinic uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c clinics;
begin
  select * into c from clinics where id = p_clinic;
  if c.id is null or not is_clinic_member(c.id) or c.kind <> 'municipio' then raise exception 'No eres parte de esta municipalidad'; end if;
  if not c.approved then return jsonb_build_object('pending', true); end if;
  if c.lat is null or c.lng is null then return jsonb_build_object('no_area', true); end if;
  return jsonb_build_object(
    'lost', coalesce((select jsonb_agg(x order by x ->> 'at' desc) from (
      select jsonb_build_object('id', p.id, 'name', p.name, 'photo', p.photo, 'species', p.species, 'breed', p.breed,
        'at', p.lost_at, 'lat', round(p.lost_lat::numeric, 3), 'lng', round(p.lost_lng::numeric, 3)) as x
      from pets p
      where p.status = 'lost' and p.lost_lat is not null and coalesce(p.lost_at, now()) > now() - interval '90 days'
        and km_between(c.lat, c.lng, p.lost_lat, p.lost_lng) <= c.area_km
      limit 200) l), '[]'::jsonb),
    'found', coalesce((select jsonb_agg(x order by x ->> 'at' desc) from (
      select jsonb_build_object('id', f.id, 'photo', f.photo, 'species', f.species, 'at', f.created_at,
        'lat', round(f.lat::numeric, 3), 'lng', round(f.lng::numeric, 3), 'reunited', f.pet_id is not null) as x
      from found_reports f
      where f.created_at > now() - interval '30 days' and km_between(c.lat, c.lng, f.lat, f.lng) <= c.area_km
      limit 200) r), '[]'::jsonb));
end $$;
grant execute on function public.muni_board(uuid) to authenticated;

-- ---------- Las caras que filma el municipio también encuentran perdidos ----------
-- Cuando el municipio filma la cara de un animal (operativo, rescate), esa
-- huella entra a la búsqueda: si un vecino escanea un animal en la calle y se
-- parece a uno de sus fichas, al equipo municipal le llega el aviso con el
-- contacto de quien lo encontró. Si el animal ya está en la app de su
-- responsable, lo busca la app como siempre (no se duplica).
create table if not exists public.muni_samples (
  id bigint generated always as identity primary key,
  patient_id uuid not null references public.clinic_patients on delete cascade,
  kind text not null default 'face',
  dino extensions.vector(384),
  mobilenet extensions.vector(1280),
  basic extensions.vector(192) not null
);
create index if not exists muni_samples_patient on public.muni_samples (patient_id);
alter table public.muni_samples enable row level security; -- nadie las lee directo

create table if not exists public.muni_matches (
  found_id uuid not null references public.found_reports on delete cascade,
  patient_id uuid not null references public.clinic_patients on delete cascade,
  clinic_id uuid not null references public.clinics on delete cascade,
  score real,
  created_at timestamptz not null default now(),
  primary key (found_id, patient_id)
);
alter table public.muni_matches enable row level security;
drop policy if exists "equipo municipal ve sus coincidencias" on public.muni_matches;
create policy "equipo municipal ve sus coincidencias" on public.muni_matches for select using (is_clinic_member(clinic_id));

-- Parecido de un aviso de "encontré" con cada animal filmado por municipios.
create or replace function public.muni_scores(p_found uuid, p_patient uuid default null)
returns table (patient_id uuid, score real, model text, nose real)
language sql stable security definer set search_path = public, extensions as $$
  with s as (
    select ms.patient_id,
      max(1 - (fs.dino <=> ms.dino)) filter (where fs.kind = 'face') as d,
      max(1 - (fs.mobilenet <=> ms.mobilenet)) filter (where fs.kind = 'face') as m,
      max(1 - (fs.basic <=> ms.basic)) filter (where fs.kind = 'face') as b,
      max(1 - (fs.dino <=> ms.dino)) filter (where fs.kind = 'nose') as nd,
      max(1 - (fs.mobilenet <=> ms.mobilenet)) filter (where fs.kind = 'nose') as nm
    from found_samples fs join muni_samples ms on ms.kind = fs.kind
    where fs.found_id = p_found and (p_patient is null or ms.patient_id = p_patient)
    group by ms.patient_id
  )
  select patient_id, coalesce(d, m, b)::real,
    case when d is not null then 'dino' when m is not null then 'mobilenet' else 'basic' end,
    (case when d is not null then nd when m is not null then nm end)::real
  from s where coalesce(d, m, b) is not null;
$$;
revoke execute on function public.muni_scores(uuid, uuid) from public, anon, authenticated;

-- Busca el animal municipal más parecido a un aviso (o solo p_patient) y, si
-- coincide, avisa al equipo. Mismo criterio que la app: si la ficha está como
-- extraviado basta el umbral normal; si no, se pide el umbral alto.
create or replace function public.muni_check(p_found uuid, p_patient uuid default null) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare f found_reports; cp clinic_patients; cp_id uuid; sc real;
begin
  select * into f from found_reports where id = p_found;
  if f.id is null or f.status <> 'open' or f.pet_id is not null or f.created_at < now() - interval '30 days' then return false; end if;
  select p.id, s.score into cp_id, sc
  from muni_scores(p_found, p_patient) s join clinic_patients p on p.id = s.patient_id
  where p.pet_id is null and p.status <> 'fallecido' and same_species(p.species, f.species)
    and not exists (select 1 from muni_matches mm where mm.found_id = p_found and mm.patient_id = p.id)
    and case when p.status = 'extraviado' then is_pet_match(s.score, s.model, s.nose)
      else s.model <> 'basic' and s.score >= unlost_threshold(s.model) end
  order by s.score desc limit 1;
  if cp_id is null then return false; end if;
  select * into cp from clinic_patients where id = cp_id;
  insert into muni_matches (found_id, patient_id, clinic_id, score) values (p_found, cp.id, cp.clinic_id, sc);
  insert into notifications (user_id, type, title, body, url)
  select m.user_id, 'match', '🐾 Un vecino encontró a ' || cp.name,
    'Es un animal de tus fichas. Toca para ver dónde está y contactar a quien lo encontró.', '#/clinica/perdidos'
  from clinic_members m where m.clinic_id = cp.clinic_id;
  return true;
end $$;
revoke execute on function public.muni_check(uuid, uuid) from public, anon, authenticated;

-- Huellas al día con la ficha (solo municipios, solo si aún no está en la app).
create or replace function public.muni_patient_samples() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare f uuid;
begin
  if tg_op = 'UPDATE' and new.scan is not distinct from old.scan and new.pet_id is not distinct from old.pet_id
     and new.status is not distinct from old.status then return null; end if;
  if tg_op = 'INSERT' or new.scan is distinct from old.scan or new.pet_id is distinct from old.pet_id then
    delete from muni_samples where patient_id = new.id;
    if new.scan is not null and new.pet_id is null and exists (select 1 from clinics where id = new.clinic_id and kind = 'municipio') then
      insert into muni_samples (patient_id, kind, dino, mobilenet, basic)
      select new.id, s.kind, s.dino, s.mobilenet, s.basic from bio_samples(new.scan) s;
    end if;
  end if;
  -- Recién filmado o marcado como extraviado: se revisan los avisos abiertos de los últimos 30 días.
  if exists (select 1 from muni_samples where patient_id = new.id) then
    for f in select id from found_reports where status = 'open' and pet_id is null and created_at > now() - interval '30 days'
      and same_species(species, new.species) order by created_at desc limit 500 loop
      perform muni_check(f, new.id);
    end loop;
  end if;
  return null;
end $$;
drop trigger if exists muni_patient_samples on public.clinic_patients;
create trigger muni_patient_samples after insert or update on public.clinic_patients
  for each row execute function public.muni_patient_samples();

-- Aviso nuevo de "encontré" sin dueño en la app: se compara con los municipios.
-- report_found guarda best_score después de guardar las huellas del aviso.
create or replace function public.muni_found_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.pet_id is null and old.best_score is null and old.match_kind is null then perform muni_check(new.id); end if;
  return null;
end $$;
drop trigger if exists muni_found_check on public.found_reports;
create trigger muni_found_check after update of best_score on public.found_reports
  for each row execute function public.muni_found_check();

-- El tablero suma lo reconocido de las fichas, con el contacto de quien lo encontró.
create or replace function public.muni_board(p_clinic uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c clinics;
begin
  select * into c from clinics where id = p_clinic;
  if c.id is null or not is_clinic_member(c.id) or c.kind <> 'municipio' then raise exception 'No eres parte de esta municipalidad'; end if;
  if not c.approved then return jsonb_build_object('pending', true); end if;
  if c.lat is null or c.lng is null then return jsonb_build_object('no_area', true); end if;
  return jsonb_build_object(
    'matches', coalesce((select jsonb_agg(x order by x ->> 'at' desc) from (
      select jsonb_build_object('found_id', f.id, 'patient_id', p.id, 'name', p.name, 'pet_photo', p.photo, 'photo', f.photo,
        'species', f.species, 'at', f.created_at, 'lat', round(f.lat::numeric, 4), 'lng', round(f.lng::numeric, 4),
        'finder_name', f.finder_name, 'finder_phone', f.finder_phone, 'open', f.status = 'open') as x
      from muni_matches mm join found_reports f on f.id = mm.found_id join clinic_patients p on p.id = mm.patient_id
      where mm.clinic_id = c.id and mm.created_at > now() - interval '60 days'
      limit 100) m), '[]'::jsonb),
    'lost', coalesce((select jsonb_agg(x order by x ->> 'at' desc) from (
      select jsonb_build_object('id', p.id, 'name', p.name, 'photo', p.photo, 'species', p.species, 'breed', p.breed,
        'at', p.lost_at, 'lat', round(p.lost_lat::numeric, 3), 'lng', round(p.lost_lng::numeric, 3)) as x
      from pets p
      where p.status = 'lost' and p.lost_lat is not null and coalesce(p.lost_at, now()) > now() - interval '90 days'
        and km_between(c.lat, c.lng, p.lost_lat, p.lost_lng) <= c.area_km
      limit 200) l), '[]'::jsonb),
    'found', coalesce((select jsonb_agg(x order by x ->> 'at' desc) from (
      select jsonb_build_object('id', f.id, 'photo', f.photo, 'species', f.species, 'at', f.created_at,
        'lat', round(f.lat::numeric, 3), 'lng', round(f.lng::numeric, 3),
        'reunited', f.pet_id is not null, 'known', exists (select 1 from muni_matches mm where mm.found_id = f.id)) as x
      from found_reports f
      where f.created_at > now() - interval '30 days' and km_between(c.lat, c.lng, f.lat, f.lng) <= c.area_km
      limit 200) r), '[]'::jsonb));
end $$;

-- Para el administrador de Kiltrazo: cuánto usa cada municipalidad.
create or replace function public.muni_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Solo el administrador'; end if;
  return coalesce((select jsonb_object_agg(c.id, jsonb_build_object(
    'patients', (select count(*) from clinic_patients p where p.clinic_id = c.id and p.removed_at is null),
    'filmed', (select count(*) from clinic_patients p where p.clinic_id = c.id and p.scan is not null),
    'drives', (select count(*) from clinic_drives d where d.clinic_id = c.id),
    'bookings', (select count(*) from clinic_appointments a where a.clinic_id = c.id and a.drive_id is not null and a.status <> 'cancelada')))
    from clinics c where c.kind = 'municipio'), '{}'::jsonb);
end $$;
grant execute on function public.muni_stats() to authenticated;

-- ---------- Registro Nacional de Mascotas (registratumascota.cl) ----------
-- El municipio sigue inscribiendo en el registro nacional; Kiltrazo le deja los
-- datos listos para copiar y anota cuándo quedó inscrito. RUT del responsable:
-- lo pide el registro nacional.
alter table public.clinic_patients add column if not exists tutor_rut text not null default '';
alter table public.clinic_patients add column if not exists rnm_at date;
alter table public.clinic_patients add column if not exists rnm_number text not null default '';

-- ---------- Operativos: aviso a los tutores de la comuna ----------
-- El tutor elige su comuna en el perfil. Cuando una municipalidad aprobada
-- publica un operativo, se avisa a los tutores cuya comuna calza con la de la
-- municipalidad (y a nadie más). La municipalidad solo ve a cuántos se avisó,
-- nunca quiénes son.
alter table public.profiles add column if not exists comuna text not null default '';

-- "Ñuñoa " y "nunoa" son la misma comuna (igual que comunaKey en src/comunas.js).
create or replace function public.comuna_key(t text) returns text
language sql immutable as $$
  select regexp_replace(lower(translate(coalesce(t, ''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')), '[^a-z0-9]', '', 'g');
$$;
create index if not exists profiles_comuna on public.profiles (public.comuna_key(comuna)) where comuna <> '';

-- Un registro por operativo avisado: así se avisa una sola vez, aunque el
-- operativo se edite después. Solo lo escribe notify_drive.
create table if not exists public.drive_notices (
  id uuid primary key references public.clinic_drives on delete cascade,
  sent_count int not null default 0,
  sent_at timestamptz not null default now()
);
alter table public.drive_notices enable row level security;
drop policy if exists "equipo municipal ve sus avisos" on public.drive_notices;
create policy "equipo municipal ve sus avisos" on public.drive_notices for select
  using (exists (select 1 from clinic_drives d where d.id = drive_notices.id and is_clinic_member(d.clinic_id)));

-- Avisa el operativo a los tutores de la comuna. No hace nada si la
-- municipalidad aún no está aprobada, si las inscripciones están cerradas, si
-- el operativo ya pasó o si ya se avisó. Devuelve a cuántos tutores avisó.
create or replace function public.notify_drive(p_drive uuid) returns int
language plpgsql security definer set search_path = public as $$
declare d clinic_drives; c clinics; n int;
begin
  select * into d from clinic_drives where id = p_drive;
  if d.id is null then return 0; end if;
  select * into c from clinics where id = d.clinic_id;
  if c.kind <> 'municipio' or not c.approved or not d.open or comuna_key(c.comuna) = ''
     or d.day < (now() at time zone 'America/Santiago')::date then
    return 0;
  end if;
  insert into drive_notices (id) values (d.id) on conflict (id) do nothing;
  if not found then return 0; end if;
  insert into notifications (user_id, type, title, body, url)
  select p.id, 'info', 'Operativo en ' || trim(c.comuna) || ' 🏛️',
    d.title || ': ' || to_char(d.day, 'DD/MM') || ', de ' || to_char(d.starts, 'HH24:MI') || ' a ' || to_char(d.ends, 'HH24:MI')
      || coalesce(', en ' || nullif(d.place, ''), '') || '. Es gratis y con cupos: reserva el tuyo.',
    '#/operativo/' || d.id::text
  from profiles p
  where p.comuna <> '' and comuna_key(p.comuna) = comuna_key(c.comuna);
  get diagnostics n = row_count;
  update drive_notices set sent_count = n where id = d.id;
  return n;
end $$;
revoke execute on function public.notify_drive(uuid) from public, anon, authenticated;

-- Al crear el operativo (o al abrir sus inscripciones) se avisa a la comuna.
create or replace function public.drive_notify_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform notify_drive(new.id);
  return new;
end $$;
drop trigger if exists clinic_drives_notify on public.clinic_drives;
create trigger clinic_drives_notify after insert or update of open on public.clinic_drives
  for each row execute function public.drive_notify_trigger();

-- Los operativos preparados antes de la aprobación se avisan al aprobar la municipalidad.
create or replace function public.muni_approved_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'municipio' and new.approved and not old.approved then
    perform notify_drive(d.id) from clinic_drives d where d.clinic_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists clinics_approved_notify on public.clinics;
create trigger clinics_approved_notify after update of approved on public.clinics
  for each row execute function public.muni_approved_notify();

-- Lo que ve el tutor en el inicio: los próximos operativos de su comuna.
create or replace function public.comuna_drives() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'title', d.title, 'day', d.day, 'place', d.place,
    'starts', to_char(d.starts, 'HH24:MI'), 'ends', to_char(d.ends, 'HH24:MI'), 'muni', c.name) order by d.day, d.starts), '[]'::jsonb)
  from profiles p
  join clinics c on c.kind = 'municipio' and c.approved and comuna_key(c.comuna) = comuna_key(p.comuna)
  join clinic_drives d on d.clinic_id = c.id
  where p.id = auth.uid() and p.comuna <> '' and d.open and d.day >= (now() at time zone 'America/Santiago')::date;
$$;
grant execute on function public.comuna_drives() to authenticated;

-- ---------- Admin: usuarios de Clínica y Municipal ----------
-- Quien entra a Kiltrazo Clínica o Municipal con correo y clave puede no tener
-- perfil en la app. Para poder contactarlo, el administrador ve el correo de
-- su cuenta y desde cuándo existe.
create or replace function public.admin_accounts() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Solo administradores'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'email', u.email, 'created_at', u.created_at)), '[]'::jsonb)
    from auth.users u where coalesce(u.email, '') <> '');
end $$;
grant execute on function public.admin_accounts() to authenticated;

-- Punto de reconocimiento facial (2026-10-08): cuenta del equipo que solo
-- registra mascotas (filma la cara) y se las entrega a su dueño con un QR.
alter table public.clinic_members drop constraint if exists clinic_members_role_check;
alter table public.clinic_members add constraint clinic_members_role_check check (role in ('vet', 'recepcion', 'punto'));
alter table public.clinic_invites drop constraint if exists clinic_invites_role_check;
alter table public.clinic_invites add constraint clinic_invites_role_check check (role in ('vet', 'recepcion', 'punto'));

-- ---------- Punto Kiltrazo (2026-10-08) ----------
-- Un punto de reconocimiento facial propio de Kiltrazo, sin clínica: el
-- administrador lo abre desde Admin y da (o quita) el permiso de punto a
-- usuarios de la app. Por dentro es una "clínica" de tipo 'kiltrazo' que no
-- aparece en mapas ni listas; las mascotas que registra quedan ahí hasta que
-- su dueño las recibe, y entonces salen de la lista (no es su veterinaria).
alter table public.clinics drop constraint if exists clinics_kind_check;
alter table public.clinics add constraint clinics_kind_check check (kind in ('clinica', 'municipio', 'kiltrazo'));

create or replace function public.kiltrazo_point() returns uuid
language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  if not is_admin() then raise exception 'Solo el administrador de Kiltrazo'; end if;
  select id into c from clinics where kind = 'kiltrazo' order by created_at limit 1;
  if c is null then
    insert into clinics (name, address, phone, kind, approved, on_map, created_by)
    values ('Punto Kiltrazo', '', '', 'kiltrazo', true, false, auth.uid()) returning id into c;
  end if;
  insert into clinic_members (clinic_id, user_id, name, role, is_admin)
  select c, auth.uid(), coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.name, ''), 'vet', true
  from (select 1) x left join profiles p on p.id = auth.uid()
  on conflict (clinic_id, user_id) do update set role = 'vet', is_admin = true;
  return c;
end $$;
grant execute on function public.kiltrazo_point() to authenticated;

create or replace function public.admin_set_point(p_user uuid, p_on boolean) returns boolean
language plpgsql security definer set search_path = public as $$
declare c uuid := kiltrazo_point();
begin
  if p_user = auth.uid() then return true; end if;
  if p_on then
    insert into clinic_members (clinic_id, user_id, name, role, is_admin)
    select c, p_user, coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.name, ''), 'punto', false
    from (select 1) x left join profiles p on p.id = p_user
    on conflict (clinic_id, user_id) do update set role = 'punto', is_admin = false;
  else
    delete from clinic_members where clinic_id = c and user_id = p_user;
  end if;
  return true;
end $$;
grant execute on function public.admin_set_point(uuid, boolean) to authenticated;

create or replace function public.claim_transfer(p_code text, p_pet uuid) returns text
language plpgsql security definer set search_path = public as $$
declare t clinic_transfers; o profiles; c text;
begin
  if not exists (select 1 from pets where id = p_pet and owner_id = auth.uid()) then raise exception 'Mascota no encontrada'; end if;
  delete from clinic_transfers where code = upper(trim(p_code)) and created_at > now() - interval '7 days' returning * into t;
  if t.code is null then raise exception 'El enlace ya se usó o venció. Pide uno nuevo a tu veterinaria.'; end if;
  if exists (select 1 from clinic_patients where clinic_id = t.clinic_id and pet_id = p_pet and id <> t.patient_id) then
    raise exception 'Esa mascota ya está vinculada a esta clínica';
  end if;
  select * into o from profiles where id = auth.uid();
  update clinic_patients set pet_id = p_pet, tutor_user = auth.uid(),
    tutor_name = coalesce(nullif(tutor_name, ''), nullif(trim(concat_ws(' ', o.first_name, o.last_name)), ''), o.name, ''),
    tutor_phone = coalesce(nullif(tutor_phone, ''), o.phone, ''),
    tutor_email = coalesce(nullif(tutor_email, ''), o.email, ''),
    tutor_address = coalesce(nullif(tutor_address, ''), o.address, '')
  where id = t.patient_id and pet_id is null;
  if not found then raise exception 'Esta ficha ya está en la app de un tutor'; end if;
  -- Del Punto Kiltrazo: entregada, sale de la lista (Kiltrazo no es su veterinaria).
  update clinic_patients set removed_at = now()
  where id = t.patient_id and exists (select 1 from clinics where id = t.clinic_id and kind = 'kiltrazo');
  select name into c from clinics where id = t.clinic_id;
  return c;
end $$;

create or replace function public.accept_transfer(p_code text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare cp clinic_patients; o profiles; c clinics; new_id uuid;
begin
  if auth.uid() is null then raise exception 'Sin sesión'; end if;
  select p.* into cp from clinic_transfers t join clinic_patients p on p.id = t.patient_id
  where t.code = upper(trim(p_code)) and t.created_at > now() - interval '7 days' and p.pet_id is null;
  if cp.id is null then raise exception 'El enlace ya se usó o venció. Pide uno nuevo a tu veterinaria.'; end if;
  if cp.scan is null then raise exception 'La clínica no filmó su cara. Regístrala tú desde la app.'; end if;
  select * into o from profiles where id = auth.uid();
  select * into c from clinics where id = cp.clinic_id;
  insert into pets (owner_id, name, owner_name, diseases, vaccines, photo, species, breed)
  values (auth.uid(), cp.name, coalesce(nullif(trim(concat_ws(' ', o.first_name, o.last_name)), ''), o.name, ''),
          coalesce(nullif(cp.allergies, ''), ''), case when c.kind = 'kiltrazo' then '' else 'Las registra ' || c.name end,
          cp.photo, coalesce(cp.species, ''), left(coalesce(cp.breed, ''), 80))
  returning id into new_id;
  insert into pet_samples (pet_id, kind, dino, mobilenet, basic)
  select new_id, s.kind, s.dino, s.mobilenet, s.basic from bio_samples(cp.scan) s;
  perform claim_transfer(p_code, new_id);
  return new_id;
end $$;

-- Las cuentas punto (de una clínica, municipalidad o del Punto Kiltrazo) no
-- ven fichas, agenda ni datos de dueños: solo registran con point_register.
create or replace function public.is_clinic_member(p_clinic uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from clinic_members where clinic_id = p_clinic and user_id = auth.uid() and role <> 'punto') or is_admin();
$$;
create or replace function public.is_clinic_folder(p_folder text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from clinic_members where clinic_id::text = p_folder and user_id = auth.uid() and role <> 'punto') or is_admin();
$$;
drop policy if exists "veo mi membresía" on public.clinic_members;
create policy "veo mi membresía" on public.clinic_members for select using (user_id = auth.uid());
drop policy if exists "veo dónde soy punto" on public.clinics;
create policy "veo dónde soy punto" on public.clinics for select
  using (exists (select 1 from clinic_members m where m.clinic_id = clinics.id and m.user_id = auth.uid()));

-- Registrar una mascota en el punto y crear su enlace para el dueño.
-- (2026-10-10: guarda la raza y las fotos de la cara del escaneo. Las fotos
-- esperan a que el dueño la reciba: se quedan solo si él marca la casilla
-- para mejorar el reconocimiento; si no, o si no la recibe en unos días, se borran.)
alter table public.clinic_patients add column if not exists train_crops jsonb;
drop function if exists public.point_register(uuid, text, text, text, jsonb, text, text);
drop function if exists public.point_register(uuid, text, text, text, jsonb, text, text, text);
create or replace function public.point_register(
  p_clinic uuid, p_name text, p_species text, p_photo text, p_scan jsonb, p_tutor_name text, p_tutor_phone text,
  p_breed text default '', p_train_crops jsonb default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p uuid; c text;
begin
  if not exists (select 1 from clinic_members where clinic_id = p_clinic and user_id = auth.uid()) then
    raise exception 'No tienes permiso para este punto';
  end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Falta el nombre de la mascota'; end if;
  if p_scan is null then raise exception 'Falta filmar su cara'; end if;
  update clinic_patients set train_crops = null
  where train_crops is not null and created_at < now() - interval '8 days';
  insert into clinic_patients (clinic_id, name, species, breed, photo, scan, tutor_name, tutor_phone, train_crops)
  values (p_clinic, left(trim(p_name), 80), coalesce(p_species, ''), left(coalesce(trim(p_breed), ''), 80), p_photo, p_scan,
          left(coalesce(trim(p_tutor_name), ''), 80), left(coalesce(trim(p_tutor_phone), ''), 30),
          case when jsonb_typeof(p_train_crops) = 'object' and length(p_train_crops::text) < 3000000 then p_train_crops end)
  returning id into p;
  loop
    c := short_code(8);
    exit when not exists (select 1 from clinic_transfers where code = c);
  end loop;
  insert into clinic_transfers (code, patient_id, clinic_id) values (c, p, p_clinic);
  return jsonb_build_object('id', p, 'code', c);
end $$;
grant execute on function public.point_register(uuid, text, text, text, jsonb, text, text, text, jsonb) to authenticated;

-- Lo que ve el dueño antes de recibirla (ahora dice si hay fotos del punto).
create or replace function public.transfer_info(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('clinic', c.name, 'name', cp.name, 'species', cp.species, 'breed', cp.breed, 'photo', cp.photo,
    'has_scan', cp.scan is not null, 'kind', c.kind, 'has_train', cp.train_crops is not null)
  from clinic_transfers t join clinic_patients cp on cp.id = t.patient_id join clinics c on c.id = t.clinic_id
  where t.code = upper(trim(p_code)) and t.created_at > now() - interval '7 days' and cp.pet_id is null
    and auth.uid() is not null;
$$;

-- El dueño ya recibió su mascota: si marcó la casilla se le devuelven las
-- fotos para subirlas a "entrenamiento"; en ambos casos se borran de aquí.
create or replace function public.take_train_crops(p_pet uuid, p_keep boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if not exists (select 1 from pets where id = p_pet and owner_id = auth.uid()) then raise exception 'Mascota no encontrada'; end if;
  with old as (
    select id, train_crops from clinic_patients where pet_id = p_pet and train_crops is not null limit 1 for update
  )
  update clinic_patients cp set train_crops = null from old where cp.id = old.id returning old.train_crops into r;
  update clinic_patients set train_crops = null where pet_id = p_pet and train_crops is not null;
  return case when p_keep then r end;
end $$;
grant execute on function public.take_train_crops(uuid, boolean) to authenticated;

-- ---------- Estudio de ganado (2026-10-09) ----------
-- Prueba para saber si el reconocimiento facial sirve con vacas y caballos.
-- El administrador crea invitados (Invitado 1, 2, ...) en Admin → Estudio, cada
-- uno con su código. El invitado abre #/estudio, escribe el código (sin crear
-- cuenta) y filma la cara y el morro de cada animal con su autocrotal y sexo.
-- Los videos quedan en el bucket privado "estudio-ganado", una carpeta por
-- autocrotal, y solo el administrador los ve y los descarga.
create table if not exists public.study_guests (
  id uuid primary key default gen_random_uuid(),
  n integer not null,
  code text not null unique,
  created_at timestamptz not null default now()
);
alter table public.study_guests enable row level security;
drop policy if exists "admin ve los invitados del estudio" on public.study_guests;
create policy "admin ve los invitados del estudio" on public.study_guests for select using (is_admin());

-- Qué sesión (celular) entró con qué código.
create table if not exists public.study_users (
  user_id uuid primary key references auth.users on delete cascade,
  guest uuid references public.study_guests on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.study_users enable row level security;
drop policy if exists "admin ve quién filma el estudio" on public.study_users;
create policy "admin ve quién filma el estudio" on public.study_users for select using (is_admin());

create or replace function public.study_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from study_users u join study_guests g on g.id = u.guest where u.user_id = auth.uid()) or is_admin();
$$;
grant execute on function public.study_ok() to authenticated;

create or replace function public.admin_new_study_guest() returns jsonb
language plpgsql security definer set search_path = public as $$
declare c text; g study_guests;
begin
  if not is_admin() then raise exception 'Solo el administrador de Kiltrazo'; end if;
  loop
    c := short_code(6);
    exit when not exists (select 1 from study_guests where code = c);
  end loop;
  insert into study_guests (n, code) values ((select coalesce(max(n), 0) + 1 from study_guests), c) returning * into g;
  return jsonb_build_object('id', g.id, 'n', g.n, 'code', g.code);
end $$;
grant execute on function public.admin_new_study_guest() to authenticated;

create or replace function public.admin_delete_study_guest(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Solo el administrador de Kiltrazo'; end if;
  delete from study_guests where id = p_id;
  return true;
end $$;
grant execute on function public.admin_delete_study_guest(uuid) to authenticated;

-- El invitado entra con su código. Devuelve su número (Invitado N).
create or replace function public.study_join(p_code text) returns integer
language plpgsql security definer set search_path = public as $$
declare g study_guests;
begin
  if auth.uid() is null then raise exception 'Sin sesión'; end if;
  select * into g from study_guests where code = upper(trim(p_code));
  if g.id is null then raise exception 'Ese código no existe. Revísalo o pídele uno nuevo al administrador.'; end if;
  insert into study_users (user_id, guest) values (auth.uid(), g.id)
  on conflict (user_id) do update set guest = excluded.guest;
  return g.n;
end $$;
grant execute on function public.study_join(text) to authenticated;

create table if not exists public.study_videos (
  id uuid primary key default gen_random_uuid(),
  tag text not null,
  species text not null check (species in ('bovino', 'caballo')),
  sex text not null check (sex in ('macho', 'hembra')),
  part text not null check (part in ('cara', 'morro')),
  path text not null,
  size integer not null default 0,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  guest integer,
  created_at timestamptz not null default now()
);
create index if not exists study_videos_tag on public.study_videos (tag);
alter table public.study_videos enable row level security;
-- El número de invitado lo pone la base de datos, no el celular.
create or replace function public.study_video_guest() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.guest := (select g.n from study_users u join study_guests g on g.id = u.guest where u.user_id = auth.uid());
  return new;
end $$;
drop trigger if exists study_video_guest on public.study_videos;
create trigger study_video_guest before insert on public.study_videos for each row execute function public.study_video_guest();
drop policy if exists "quien filma guarda el estudio" on public.study_videos;
create policy "quien filma guarda el estudio" on public.study_videos for insert to authenticated
  with check (user_id = auth.uid() and study_ok());
drop policy if exists "admin ve el estudio" on public.study_videos;
create policy "admin ve el estudio" on public.study_videos for select using (is_admin());
drop policy if exists "admin borra del estudio" on public.study_videos;
create policy "admin borra del estudio" on public.study_videos for delete using (is_admin());

insert into storage.buckets (id, name, public, file_size_limit) values ('estudio-ganado', 'estudio-ganado', false, 52428800)
  on conflict (id) do nothing;
drop policy if exists "quien filma sube al estudio" on storage.objects;
create policy "quien filma sube al estudio" on storage.objects for insert to authenticated with check (
  bucket_id = 'estudio-ganado' and public.study_ok());
drop policy if exists "admin ve videos del estudio" on storage.objects;
create policy "admin ve videos del estudio" on storage.objects for select using (
  bucket_id = 'estudio-ganado' and public.is_admin());
drop policy if exists "admin borra videos del estudio" on storage.objects;
create policy "admin borra videos del estudio" on storage.objects for delete using (
  bucket_id = 'estudio-ganado' and public.is_admin());

-- Los caballos no tienen autocrotal: Kiltrazo les da un número de registro
-- (C-0001, C-0002, ...) que no se repite ni se puede cambiar. Se guarda su
-- nombre para reconocerlos el segundo día, cuando se eligen de la lista.
create sequence if not exists public.study_horse_seq;
create table if not exists public.study_horses (
  tag text primary key,
  name text not null,
  sex text not null check (sex in ('macho', 'hembra')),
  user_id uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now()
);
alter table public.study_horses enable row level security;
drop policy if exists "admin ve los caballos del estudio" on public.study_horses;
create policy "admin ve los caballos del estudio" on public.study_horses for select using (is_admin());

create or replace function public.study_new_horse(p_name text, p_sex text) returns text
language plpgsql security definer set search_path = public as $$
declare t text;
begin
  if not study_ok() then raise exception 'Sin permiso para el estudio'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Falta el nombre del caballo'; end if;
  loop
    t := 'C-' || lpad(nextval('study_horse_seq')::text, 4, '0');
    exit when not exists (select 1 from study_horses where tag = t);
  end loop;
  insert into study_horses (tag, name, sex) values (t, left(trim(p_name), 60), p_sex);
  return t;
end $$;
grant execute on function public.study_new_horse(text, text) to authenticated;

create or replace function public.study_horse_list() returns table (tag text, name text, sex text)
language sql stable security definer set search_path = public as $$
  select h.tag, h.name, h.sex from study_horses h where study_ok() order by h.tag;
$$;
grant execute on function public.study_horse_list() to authenticated;

-- ---------- Kiltrazo Clínica (fase 2): documentos y consentimientos ----------
-- La clínica arma el documento desde una plantilla con los datos de la
-- mascota y el tutor. Los consentimientos los firma el tutor con el dedo en su
-- celular (llega un aviso a su app o un enlace por WhatsApp) o en la clínica.
-- Las recetas y certificados no se firman: quedan listos al crearlos, con la
-- firma del veterinario. Nada se edita después de crearlo; si hay un error se
-- anula y se hace otro. Quien tiene el enlace (token) ve el documento.
create table if not exists public.clinic_documents (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics on delete cascade,
  patient_id uuid not null references public.clinic_patients on delete cascade,
  kind text not null check (kind in ('consentimiento_cirugia', 'consentimiento_hospitalizacion', 'consentimiento_eutanasia',
    'receta', 'certificado_vacunas', 'certificado_salud')),
  title text not null check (char_length(title) between 1 and 120),
  body text not null default '' check (char_length(body) <= 8000),
  data jsonb not null default '{}'::jsonb,
  vet_id uuid default auth.uid() references auth.users on delete set null,
  vet_name text not null default '',
  vet_signature text check (vet_signature is null or length(vet_signature) < 300000),
  status text not null default 'listo' check (status in ('por_firmar', 'firmado', 'listo', 'anulado')),
  token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  signer_name text,
  signer_rut text,
  signature text,
  signer_user uuid references auth.users on delete set null,
  signed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists clinic_documents_patient on public.clinic_documents (patient_id, created_at desc);

-- Al crearlo la base decide el estado y el enlace: los consentimientos quedan
-- por firmar y lo demás listo. Recetas y certificados solo los hace un veterinario.
create or replace function public.new_clinic_document() returns trigger
language plpgsql security definer set search_path = public as $$
declare cp clinic_patients;
begin
  select * into cp from clinic_patients where id = new.patient_id;
  if cp.clinic_id is distinct from new.clinic_id then raise exception 'Paciente no encontrado'; end if;
  if new.kind not like 'consentimiento%' and not is_clinic_vet(new.clinic_id) then
    raise exception 'Solo un veterinario puede hacer recetas y certificados';
  end if;
  new.status := case when new.kind like 'consentimiento%' then 'por_firmar' else 'listo' end;
  new.token := replace(gen_random_uuid()::text, '-', '');
  new.vet_id := auth.uid();
  new.signer_name := null; new.signer_rut := null; new.signature := null; new.signer_user := null; new.signed_at := null;
  new.created_at := now();
  return new;
end $$;
drop trigger if exists new_clinic_document on public.clinic_documents;
create trigger new_clinic_document before insert on public.clinic_documents
  for each row execute function public.new_clinic_document();

-- Aviso en la app del tutor, si la mascota está vinculada.
create or replace function public.notify_clinic_document() returns trigger
language plpgsql security definer set search_path = public as $$
declare cp clinic_patients; c clinics;
begin
  select * into cp from clinic_patients where id = new.patient_id;
  if cp.tutor_user is null then return new; end if;
  select * into c from clinics where id = new.clinic_id;
  insert into notifications (user_id, type, title, body, url) values (cp.tutor_user, 'documento',
    case when new.status = 'por_firmar' then 'Firma pendiente para ' || cp.name else new.title || ' de ' || cp.name end,
    case when new.status = 'por_firmar' then c.name || ' te pide firmar: ' || new.title || '. Tócalo para leerlo y firmar con el dedo.'
      else c.name || ' te dejó este documento en Kiltrazo.' end,
    '#/doc/' || new.token);
  return new;
end $$;
drop trigger if exists notify_clinic_document on public.clinic_documents;
create trigger notify_clinic_document after insert on public.clinic_documents
  for each row execute function public.notify_clinic_document();

alter table public.clinic_documents enable row level security;
drop policy if exists "equipo ve documentos" on public.clinic_documents;
create policy "equipo ve documentos" on public.clinic_documents for select using (is_clinic_member(clinic_id));
drop policy if exists "equipo crea documentos" on public.clinic_documents;
create policy "equipo crea documentos" on public.clinic_documents for insert with check (is_clinic_member(clinic_id));
-- Sin update ni delete: solo se anula con void_document.

create or replace function public.void_document(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update clinic_documents set status = 'anulado' where id = p_id and is_clinic_member(clinic_id) and status <> 'anulado';
  if not found then raise exception 'Documento no encontrado'; end if;
end $$;
grant execute on function public.void_document(uuid) to authenticated;

-- El documento para mostrarlo o imprimirlo, con el enlace (sin cuenta).
create or replace function public.document_by_token(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', d.id, 'kind', d.kind, 'title', d.title, 'body', d.body, 'data', d.data, 'vet_name', d.vet_name,
    'vet_signature', d.vet_signature, 'status', case when d.status = 'por_firmar' and d.created_at < now() - interval '7 days' then 'vencido' else d.status end,
    'signer_name', d.signer_name, 'signer_rut', d.signer_rut, 'signature', d.signature, 'signed_at', d.signed_at, 'created_at', d.created_at,
    'clinic', jsonb_build_object('name', c.name, 'address', c.address, 'phone', c.phone, 'logo', c.logo, 'rut', c.rut),
    'patient', jsonb_build_object('name', cp.name, 'species', cp.species, 'breed', cp.breed, 'sex', cp.sex, 'neutered', cp.neutered,
      'birth_date', cp.birth_date, 'chip', cp.chip, 'color', cp.color, 'tutor_name', cp.tutor_name, 'tutor_phone', cp.tutor_phone,
      'tutor_address', cp.tutor_address))
  from clinic_documents d join clinics c on c.id = d.clinic_id join clinic_patients cp on cp.id = d.patient_id
  where d.token = trim(p_token);
$$;
grant execute on function public.document_by_token(text) to anon, authenticated;

-- El tutor firma con el dedo. El enlace para firmar dura 7 días.
create or replace function public.sign_document(p_token text, p_name text, p_rut text, p_signature text) returns void
language plpgsql security definer set search_path = public as $$
declare d clinic_documents; pname text;
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'Escribe tu nombre'; end if;
  if p_signature is null or p_signature not like 'data:image/png;base64,%' or length(p_signature) > 300000 then
    raise exception 'Falta la firma';
  end if;
  update clinic_documents set status = 'firmado', signer_name = left(trim(p_name), 120), signer_rut = left(trim(coalesce(p_rut, '')), 20),
    signature = p_signature, signer_user = auth.uid(), signed_at = now()
  where token = trim(p_token) and status = 'por_firmar' and created_at > now() - interval '7 days'
  returning * into d;
  if d.id is null then raise exception 'Este documento ya se firmó, se anuló o el enlace venció. Pide uno nuevo a tu veterinaria.'; end if;
  select name into pname from clinic_patients where id = d.patient_id;
  if d.vet_id is not null then
    insert into notifications (user_id, type, title, body, url) values (d.vet_id, 'documento',
      d.signer_name || ' firmó', d.title || ' de ' || pname || '.', '#/clinica/paciente/' || d.patient_id || '/documentos');
  end if;
end $$;
grant execute on function public.sign_document(text, text, text, text) to anon, authenticated;

-- El tutor ve en "Mi veterinaria" los documentos de su mascota.
create or replace function public.pet_health(p_pet uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from pets where id = p_pet and owner_id = auth.uid()) then
    raise exception 'Mascota no encontrada';
  end if;
  return jsonb_build_object(
    'clinics', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone, 'address', c.address,
        'home_visits', c.home_visits, 'only_home', c.only_home))
      from clinics c where c.id in (select clinic_id from clinic_patients where pet_id = p_pet and removed_at is null)), '[]'::jsonb),
    'vaccines', coalesce((select jsonb_agg(jsonb_build_object('kind', v.kind, 'name', v.name, 'applied_on', v.applied_on,
        'next_due', v.next_due, 'clinic', c.name) order by v.applied_on desc)
      from clinic_vaccines v join clinic_patients cp on cp.id = v.patient_id join clinics c on c.id = v.clinic_id
      where cp.pet_id = p_pet), '[]'::jsonb),
    'appointments', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'starts_at', a.starts_at, 'service', a.service,
        'status', a.status, 'place', a.place, 'address', a.address, 'clinic', c.name, 'confirmed_at', a.confirmed_at) order by a.starts_at)
      from clinic_appointments a join clinic_patients cp on cp.id = a.patient_id join clinics c on c.id = a.clinic_id
      where cp.pet_id = p_pet and a.starts_at >= now() - interval '3 hours'
        and a.status in ('solicitada', 'agendada', 'en_camino')), '[]'::jsonb),
    'documents', coalesce((select jsonb_agg(jsonb_build_object('token', d.token, 'kind', d.kind, 'title', d.title,
        'status', case when d.status = 'por_firmar' and d.created_at < now() - interval '7 days' then 'vencido' else d.status end,
        'created_at', d.created_at, 'clinic', c.name) order by d.created_at desc)
      from clinic_documents d join clinic_patients cp on cp.id = d.patient_id join clinics c on c.id = d.clinic_id
      where cp.pet_id = p_pet and d.status <> 'anulado'), '[]'::jsonb));
end $$;
