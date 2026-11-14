-- =====================================================================
-- MOTOR KULÜBÜ - VERİTABANI ŞEMASI
-- Supabase panelinde: SQL Editor > New query > bu dosyanın tamamını
-- yapıştır > Run. (Bir kez çalıştırman yeterli.)
-- =====================================================================

-- ---------- Tipler ----------
create type user_role as enum ('member', 'admin');
create type user_status as enum ('pending', 'approved', 'rejected');

-- ---------- Üye profilleri ----------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  phone text,
  bike text,
  role user_role not null default 'member',
  status user_status not null default 'pending',
  created_at timestamptz not null default now()
);

-- Yardımcı fonksiyonlar
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'admin' and status = 'approved'
  );
$$;

create or replace function public.is_approved() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles where id = auth.uid() and status = 'approved'
  );
$$;

-- Yeni kayıt olan herkese profil oluştur.
-- İLK kayıt olan kişi otomatik olarak onaylı YÖNETİCİ olur.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  first_user boolean;
begin
  select not exists (select 1 from profiles) into first_user;
  insert into profiles (id, full_name, phone, bike, role, status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.raw_user_meta_data ->> 'phone',
    new.raw_user_meta_data ->> 'bike',
    case when first_user then 'admin'::user_role else 'member'::user_role end,
    case when first_user then 'approved'::user_status else 'pending'::user_status end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Yönetici olmayanlar kendi rol/durumlarını değiştiremez
create or replace function public.protect_profile_fields() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    new.role := old.role;
    new.status := old.status;
  end if;
  return new;
end;
$$;

create trigger profiles_protect
  before update on public.profiles
  for each row execute function public.protect_profile_fields();

-- ---------- Etkinlikler ----------
create table public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  meeting_note text,
  starts_at timestamptz not null,
  published boolean not null default false,
  registration_closed boolean not null default false,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now()
);

-- Rota durakları (sırayla: başlangıç, ara duraklar, varış)
create table public.event_stops (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  position int not null,
  name text not null,
  lat double precision not null,
  lng double precision not null
);
create index on public.event_stops (event_id, position);

-- Katılım yanıtları
create table public.attendances (
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  going boolean not null,
  reason text,
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id),
  -- Katılamayacağını bildiren sebep yazmak zorunda
  constraint reason_required check (going or length(trim(coalesce(reason, ''))) >= 3)
);

-- Beğen / beğenme
create table public.reactions (
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  value smallint not null check (value in (-1, 1)),
  primary key (event_id, user_id)
);

-- Sürüş düzeni: position 0 = Head (tek kişi), sonrakiler fermuar düzeninde
create table public.formation_slots (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  position int not null check (position >= 0),
  rider_id uuid not null references public.profiles (id) on delete cascade,
  passenger_id uuid references public.profiles (id) on delete set null,
  unique (event_id, position),
  check (position > 0 or passenger_id is null),
  check (rider_id <> passenger_id)
);

-- Etkinlik önerileri
create table public.suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  title text not null,
  body text,
  created_at timestamptz not null default now()
);

-- ---------- Kurallar (trigger'lar) ----------

-- Katılım sadece yayınlanmış ve listesi açık etkinliklere verilebilir
create or replace function public.check_attendance() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ev events;
begin
  select * into ev from events where id = coalesce(new.event_id, old.event_id);
  if not is_admin() and (not ev.published or ev.registration_closed) then
    raise exception 'Bu etkinliğin katılım listesi kapalı.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger attendances_check
  before insert or update or delete on public.attendances
  for each row execute function public.check_attendance();

-- "Katılamıyorum"a dönen kişi sürüş düzeninden çıkarılır
create or replace function public.cleanup_formation() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := coalesce(new.user_id, old.user_id);
  eid uuid := coalesce(new.event_id, old.event_id);
begin
  if tg_op = 'DELETE' or not new.going then
    update formation_slots set passenger_id = null
      where event_id = eid and passenger_id = uid;
    delete from formation_slots where event_id = eid and rider_id = uid;
  end if;
  return null;
end;
$$;

create trigger attendances_cleanup
  after update or delete on public.attendances
  for each row execute function public.cleanup_formation();

-- ---------- Güvenlik kuralları (RLS) ----------
alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.event_stops enable row level security;
alter table public.attendances enable row level security;
alter table public.reactions enable row level security;
alter table public.formation_slots enable row level security;
alter table public.suggestions enable row level security;

-- profiles
create policy "profil okuma" on public.profiles for select
  using (id = auth.uid() or is_approved());
create policy "kendi profilini güncelle" on public.profiles for update
  using (id = auth.uid() or is_admin());
create policy "yönetici siler" on public.profiles for delete
  using (is_admin());

-- events: üyeler yalnızca yayınlananları, yöneticiler hepsini görür
create policy "etkinlik okuma" on public.events for select
  using (is_admin() or (is_approved() and published));
create policy "etkinlik ekle" on public.events for insert with check (is_admin());
create policy "etkinlik güncelle" on public.events for update using (is_admin());
create policy "etkinlik sil" on public.events for delete using (is_admin());

-- event_stops
create policy "durak okuma" on public.event_stops for select
  using (exists (select 1 from events e where e.id = event_id));
create policy "durak yaz" on public.event_stops for all
  using (is_admin()) with check (is_admin());

-- attendances
create policy "katılım okuma" on public.attendances for select
  using (is_approved() and exists (select 1 from events e where e.id = event_id));
create policy "katılım ekle" on public.attendances for insert
  with check (user_id = auth.uid() and is_approved());
create policy "katılım güncelle" on public.attendances for update
  using (user_id = auth.uid() or is_admin());
create policy "katılım sil" on public.attendances for delete
  using (user_id = auth.uid() or is_admin());

-- reactions
create policy "beğeni okuma" on public.reactions for select
  using (is_approved() and exists (select 1 from events e where e.id = event_id));
create policy "beğeni ekle" on public.reactions for insert
  with check (user_id = auth.uid() and is_approved()
              and exists (select 1 from events e where e.id = event_id));
create policy "beğeni güncelle" on public.reactions for update
  using (user_id = auth.uid());
create policy "beğeni sil" on public.reactions for delete
  using (user_id = auth.uid());

-- formation_slots (yazma save_formation fonksiyonu üzerinden)
create policy "düzen okuma" on public.formation_slots for select
  using (is_approved() and exists (select 1 from events e where e.id = event_id));
create policy "düzen yaz" on public.formation_slots for all
  using (is_admin()) with check (is_admin());

-- suggestions: üye kendi önerisini, yönetici hepsini görür
create policy "öneri okuma" on public.suggestions for select
  using (user_id = auth.uid() or is_admin());
create policy "öneri ekle" on public.suggestions for insert
  with check (user_id = auth.uid() and is_approved());
create policy "öneri sil" on public.suggestions for delete
  using (user_id = auth.uid() or is_admin());

-- ---------- Sürüş düzenini kaydet (tek seferde, doğrulamalı) ----------
-- slots: [{"rider_id": "...", "passenger_id": "..." veya null}, ...]
-- İlk eleman Head'dir.
create or replace function public.save_formation(p_event_id uuid, slots jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  s jsonb;
  i int := 0;
  rid uuid;
  pid uuid;
  seen uuid[] := '{}';
begin
  if not is_admin() then
    raise exception 'Sadece yöneticiler sürüş düzenini değiştirebilir.';
  end if;

  delete from formation_slots where event_id = p_event_id;

  for s in select * from jsonb_array_elements(coalesce(slots, '[]'::jsonb)) loop
    rid := nullif(s ->> 'rider_id', '')::uuid;
    pid := nullif(s ->> 'passenger_id', '')::uuid;

    if rid is null then
      raise exception '%. sıradaki motorun sürücüsü seçilmemiş.', i + 1;
    end if;
    if i = 0 then
      pid := null; -- Head tek kişi
    end if;

    if rid = any (seen) or (pid is not null and pid = any (seen)) or rid = pid then
      raise exception 'Bir kişi sürüş düzeninde birden fazla yerde olamaz.';
    end if;

    if not exists (select 1 from attendances
                   where event_id = p_event_id and user_id = rid and going)
       or (pid is not null and not exists (select 1 from attendances
                   where event_id = p_event_id and user_id = pid and going)) then
      raise exception 'Sürüş düzenine yalnızca etkinliğe katılan üyeler eklenebilir.';
    end if;

    seen := seen || rid;
    if pid is not null then seen := seen || pid; end if;

    insert into formation_slots (event_id, position, rider_id, passenger_id)
    values (p_event_id, i, rid, pid);
    i := i + 1;
  end loop;
end;
$$;

-- ---------- Yönetici dashboard verisi ----------
create or replace function public.admin_dashboard() returns json
language plpgsql stable security definer set search_path = public as $$
declare
  result json;
begin
  if not is_admin() then
    raise exception 'Bu ekran sadece yöneticiler içindir.';
  end if;

  select json_build_object(
    'total_events',     (select count(*) from events where published),
    'past_events',      (select count(*) from events where published and starts_at < now()),
    'upcoming_events',  (select count(*) from events where published and starts_at >= now()),
    'approved_members', (select count(*) from profiles where status = 'approved'),
    'pending_members',  (select count(*) from profiles where status = 'pending'),
    'open_suggestions', (select count(*) from suggestions),
    'members', coalesce((
      select json_agg(m order by m.attended desc, m.full_name)
      from (
        select p.id, p.full_name,
          count(*) filter (where e.id is not null and a.going and e.starts_at < now()) as attended,
          count(*) filter (where e.id is not null and a.going) as yes_count,
          count(*) filter (where e.id is not null and not a.going) as no_count
        from profiles p
        left join attendances a on a.user_id = p.id
        left join events e on e.id = a.event_id and e.published
        where p.status = 'approved'
        group by p.id, p.full_name
      ) m
    ), '[]'::json),
    'events', coalesce((
      select json_agg(x order by x.starts_at desc)
      from (
        select e.id, e.title, e.starts_at,
          (select count(*) from attendances a where a.event_id = e.id and a.going) as going,
          (select count(*) from attendances a where a.event_id = e.id and not a.going) as not_going,
          (select count(*) from reactions r where r.event_id = e.id and r.value = 1) as likes,
          (select count(*) from reactions r where r.event_id = e.id and r.value = -1) as dislikes
        from events e
        where e.published
      ) x
    ), '[]'::json)
  ) into result;

  return result;
end;
$$;

-- ---------- Uygulamanın tablolara erişim izni ----------
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
