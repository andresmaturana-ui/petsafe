-- Pet Safe: base de datos en Supabase.
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

-- ---------- Funciones de apoyo ----------

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where user_id = auth.uid());
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

-- ---------- Acciones de la app ----------

-- Versiones anteriores, sin tipo ni raza.
drop function if exists public.register_pet(text, text, text, text, text, jsonb);
drop function if exists public.report_found(text, jsonb, double precision, double precision, text, text);

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
  p_species text default ''
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  r_id uuid; b_id uuid; b_owner uuid; b_name text; b_diseases text; b_vaccines text;
  own_name text; n int; top real;
begin
  if auth.uid() is null then raise exception 'Sin sesión'; end if;

  insert into found_reports (finder_id, finder_name, finder_phone, photo, lat, lng, species)
  values (auth.uid(), p_name, p_phone, p_photo, p_lat, p_lng, coalesce(p_species, '')) returning id into r_id;
  insert into found_samples (found_id, kind, dino, mobilenet, basic)
  select r_id, s.kind, s.dino, s.mobilenet, s.basic from bio_samples(p_bio) s;

  create temp table if not exists _scores (pet_id uuid, score real, model text, nose real) on commit drop;
  delete from _scores;
  insert into _scores select s.* from pet_scores(p_bio) s join pets p on p.id = s.pet_id
  where same_species(p.species, p_species);

  select p.name into own_name from _scores s join pets p on p.id = s.pet_id
  where p.owner_id = auth.uid() and is_pet_match(s.score, s.model, s.nose) order by s.score desc limit 1;

  select count(*), max(s.score) into n, top from _scores s join pets p on p.id = s.pet_id
  where p.owner_id <> auth.uid();

  select p.id, p.owner_id, p.name, p.diseases, p.vaccines into b_id, b_owner, b_name, b_diseases, b_vaccines
  from _scores s join pets p on p.id = s.pet_id
  where p.owner_id <> auth.uid() and is_pet_match(s.score, s.model, s.nose)
  order by s.score desc limit 1;

  update found_reports set best_score = top, pet_id = b_id where id = r_id;

  if b_id is not null then
    insert into notifications (user_id, type, title, body, url)
    values (b_owner, 'match', '¡Encontraron a ' || b_name || '! 🐾',
            'Toca para ver dónde está y contactar a quien la encontró.', '#/encontrada/' || r_id);
  end if;

  return jsonb_build_object(
    'id', r_id, 'matched', b_id is not null, 'diseases', b_diseases, 'vaccines', b_vaccines,
    'compared', n, 'own_match', own_name, 'best_score', top);
end $$;

-- "Perdí mi mascota": activa el aviso y busca entre los avisos de "encontré".
create or replace function public.report_lost(p_pet uuid) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare f_id uuid; p_name text;
begin
  update pets set status = 'lost', lost_at = now()
  where id = p_pet and owner_id = auth.uid() returning name into p_name;
  if p_name is null then raise exception 'Mascota no encontrada'; end if;

  with ps as (select * from pet_samples where pet_id = p_pet),
  s as (
    select fs.found_id,
      max(1 - (ps.dino <=> fs.dino)) filter (where fs.kind = 'face') as d,
      max(1 - (ps.mobilenet <=> fs.mobilenet)) filter (where fs.kind = 'face') as m,
      max(1 - (ps.basic <=> fs.basic)) filter (where fs.kind = 'face') as b,
      max(1 - (ps.dino <=> fs.dino)) filter (where fs.kind = 'nose') as nd,
      max(1 - (ps.mobilenet <=> fs.mobilenet)) filter (where fs.kind = 'nose') as nm
    from found_samples fs
    join found_reports fr on fr.id = fs.found_id and fr.status = 'open' and (fr.pet_id is null or fr.pet_id = p_pet)
      and same_species(fr.species, (select species from pets where id = p_pet))
    join ps on ps.kind = fs.kind
    group by fs.found_id
  )
  select found_id into f_id from s
  where is_pet_match(coalesce(d, m, b)::real,
    case when d is not null then 'dino' when m is not null then 'mobilenet' else 'basic' end,
    (case when d is not null then nd when m is not null then nm end)::real)
  order by coalesce(d, m, b) desc limit 1;

  if f_id is not null then
    update found_reports set pet_id = p_pet where id = f_id;
    insert into notifications (user_id, type, title, body, url)
    values (auth.uid(), 'match', '¡Encontraron a ' || p_name || '! 🐾',
            'Toca para ver dónde está y contactar a quien la encontró.', '#/encontrada/' || f_id);
  end if;
  return f_id;
end $$;

-- "Ya encontré mi mascota": quita el aviso y publica el reencuentro.
create or replace function public.mark_recovered(p_pet uuid, p_story text default '') returns uuid
language plpgsql security definer set search_path = public as $$
declare s_id uuid; pet pets;
begin
  select * into pet from pets where id = p_pet and (owner_id = auth.uid() or is_admin());
  if pet.id is null then raise exception 'Mascota no encontrada'; end if;
  update pets set status = 'home', recovered_at = now() where id = p_pet;
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

-- Avisos en tiempo real mientras la app está abierta.
do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null; end $$;
