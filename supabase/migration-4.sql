-- WOB güncelleme 4: sezonlar, sıralama/rozet verisi ve bildirim altyapısı
-- Supabase panelinde SQL Editor'da bir kez çalıştırılır (tekrar çalıştırmak zararsızdır).

-- =====================================================================
-- SEZONLAR
-- =====================================================================
create table if not exists public.seasons (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) >= 2),
  starts_at timestamptz not null,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);
-- Aynı anda tek açık sezon
create unique index if not exists seasons_one_open on public.seasons ((true)) where ends_at is null;

-- Sezonlar birbiriyle çakışamaz
create or replace function public.check_season() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from seasons s
    where s.id <> new.id
      and new.starts_at < coalesce(s.ends_at, 'infinity'::timestamptz)
      and coalesce(new.ends_at, 'infinity'::timestamptz) > s.starts_at
  ) then
    raise exception 'Bu tarihler başka bir sezonla çakışıyor.';
  end if;
  return new;
end;
$$;
drop trigger if exists seasons_check on public.seasons;
create trigger seasons_check before insert or update on public.seasons
  for each row execute function public.check_season();

alter table public.seasons enable row level security;
drop policy if exists "sezon okuma" on public.seasons;
drop policy if exists "sezon yaz" on public.seasons;
create policy "sezon okuma" on public.seasons for select using (is_approved());
create policy "sezon yaz" on public.seasons for all using (is_admin()) with check (is_admin());
grant select, insert, update, delete on public.seasons to authenticated;

-- =====================================================================
-- SIRALAMA VE ROZET VERİSİ (tüm onaylı üyeler görebilir)
-- Katılım = yoklamada "geldi" işaretlenen, yayınlanmış etkinlik.
-- Rozetler bu veriden uygulamada hesaplanır; ayrıca saklanmaz.
-- =====================================================================
create or replace function public.leaderboard() returns json
language plpgsql stable security definer set search_path = public as $$
declare
  result json;
begin
  if not is_approved() then
    raise exception 'Bu bilgi sadece onaylı üyeler içindir.';
  end if;

  with
  -- Seri: yoklaması alınmış, tamamlanmış etkinlikler; üyelikten öncekiler sayılmaz
  ev as (
    select e.id, e.starts_at from events e
    where e.published and e.completed_at is not null
      and exists (select 1 from attendances a where a.event_id = e.id and a.present is not null)
  ),
  ue as (
    select p.id as uid, ev.starts_at,
      coalesce((select a.present from attendances a where a.event_id = ev.id and a.user_id = p.id), false) as pres
    from profiles p join ev on ev.starts_at >= p.created_at
    where p.status = 'approved'
  ),
  g as (
    select uid, pres, sum(case when pres then 0 else 1 end) over (partition by uid order by starts_at) as grp from ue
  ),
  isl as (
    select uid, grp, count(*) filter (where pres) as len from g group by uid, grp
  ),
  streaks as (
    select uid, max(len) as best,
      (array_agg(len order by grp desc))[1] as cur
    from isl group by uid
  ),
  totals as (
    select a.user_id, count(*) as n
    from attendances a join events e on e.id = a.event_id and e.published
    where a.present group by a.user_id
  ),
  stats as (
    select s.id as season_id, a.user_id, count(*) as attended
    from seasons s
    join events e on e.published and e.starts_at >= s.starts_at and (s.ends_at is null or e.starts_at < s.ends_at)
    join attendances a on a.event_id = e.id and a.present
    join profiles p on p.id = a.user_id and p.status = 'approved'
    group by s.id, a.user_id
  ),
  sug as (
    select s.id as season_id, g.id, g.user_id, g.title,
      (select count(*) from suggestion_votes v where v.suggestion_id = g.id and v.value = 1) as likes
    from seasons s
    join suggestions g on g.created_at >= s.starts_at and (s.ends_at is null or g.created_at < s.ends_at)
    join profiles p on p.id = g.user_id and p.status = 'approved'
  ),
  top_sug as (
    select * from sug x
    where x.likes >= 3 and x.likes = (select max(y.likes) from sug y where y.season_id = x.season_id)
  )
  select json_build_object(
    'seasons', coalesce((
      select json_agg(json_build_object('id', s.id, 'name', s.name, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
        'events', (select count(*) from events e where e.published and e.starts_at >= s.starts_at and (s.ends_at is null or e.starts_at < s.ends_at)),
        'open_events', (select count(*) from events e where e.published and e.completed_at is null and e.starts_at < now()
                         and e.starts_at >= s.starts_at and (s.ends_at is null or e.starts_at < s.ends_at)))
        order by s.starts_at desc)
      from seasons s), '[]'::json),
    'stats', coalesce((select json_agg(json_build_object('season_id', season_id, 'user_id', user_id, 'attended', attended)) from stats), '[]'::json),
    'top_suggestions', coalesce((select json_agg(json_build_object('season_id', season_id, 'user_id', user_id, 'title', title, 'likes', likes)) from top_sug), '[]'::json),
    'members', coalesce((
      select json_agg(json_build_object('id', p.id, 'full_name', p.full_name, 'edu_status', p.edu_status,
        'streak', coalesce(st.cur, 0), 'best_streak', coalesce(st.best, 0), 'total', coalesce(t.n, 0)) order by p.full_name)
      from profiles p
      left join streaks st on st.uid = p.id
      left join totals t on t.user_id = p.id
      where p.status = 'approved'), '[]'::json)
  ) into result;

  return result;
end;
$$;
grant execute on function public.leaderboard() to authenticated;

-- =====================================================================
-- BİLDİRİMLER
-- Akış: tablo tetikleyicisi -> "push" Edge Function -> push_job() -> telefonlar.
-- Gizli anahtarlar veritabanında üretilir ve saklanır; uygulama kodunda yer almaz.
-- =====================================================================
create extension if not exists pg_net;

create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists "abonelik okuma" on public.push_subscriptions;
create policy "abonelik okuma" on public.push_subscriptions for select using (user_id = auth.uid());
grant select on public.push_subscriptions to authenticated;

-- Özel ayarlar: hiçbir kullanıcı doğrudan okuyamaz (RLS açık, kural yok)
create table if not exists public.push_config (
  key text primary key,
  value text not null
);
alter table public.push_config enable row level security;
revoke all on public.push_config from anon, authenticated;

-- Aynı bildirimin iki kez gitmesini önler
create table if not exists public.push_log (
  key text primary key,
  created_at timestamptz not null default now()
);
alter table public.push_log enable row level security;
revoke all on public.push_log from anon, authenticated;

insert into public.push_config (key, value)
values ('hook_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;
insert into public.push_config (key, value)
values ('function_url', 'https://hgpncthohgxvazoizvho.supabase.co/functions/v1/push')
on conflict (key) do nothing;

-- Telefonu bildirimlere kaydet / kayıttan çıkar
create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_approved() then raise exception 'Önce üyeliğin onaylanmalı.'; end if;
  if p_endpoint !~ '^https://' or length(p_endpoint) > 2000 then raise exception 'Geçersiz abonelik.'; end if;
  insert into push_subscriptions (endpoint, user_id, p256dh, auth)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth;
end;
$$;

create or replace function public.push_unsubscribe(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;

-- Abonelik için gereken açık anahtar (gizli değildir)
create or replace function public.push_public_key() returns text
language sql stable security definer set search_path = public as $$
  select value from push_config where key = 'vapid_public' and is_approved();
$$;

-- Edge Function'a haber ver (hata olursa asıl işlemi bozmaz)
create or replace function public.push_send(payload jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  secret text;
  url text;
begin
  select value into secret from push_config where key = 'hook_secret';
  select value into url from push_config where key = 'function_url';
  perform net.http_post(url := url, body := payload || jsonb_build_object('secret', secret),
                        headers := '{"Content-Type": "application/json"}'::jsonb);
exception when others then
  null;
end;
$$;
revoke all on function public.push_send(jsonb) from public, anon, authenticated;

-- Yönetici: bildirim anahtarlarını ilk kez ürettirir
create or replace function public.push_init() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() and auth.uid() is not null then raise exception 'Sadece yöneticiler.'; end if;
  perform push_send('{"type": "init"}'::jsonb);
end;
$$;

-- Edge Function'ın çağırdığı fonksiyonlar: gizli anahtarı bilmeyen kullanamaz
create or replace function public.push_check(p_secret text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_secret is null or p_secret <> (select value from push_config where key = 'hook_secret') then
    raise exception 'Yetkisiz.';
  end if;
end;
$$;
revoke all on function public.push_check(text) from public, anon, authenticated;

create or replace function public.push_set_vapid(p_secret text, p_public text, p_private text) returns json
language plpgsql security definer set search_path = public as $$
begin
  perform push_check(p_secret);
  insert into push_config (key, value) values ('vapid_public', p_public), ('vapid_private', p_private)
  on conflict (key) do nothing;
  return json_build_object(
    'public', (select value from push_config where key = 'vapid_public'),
    'private', (select value from push_config where key = 'vapid_private'));
end;
$$;

create or replace function public.push_gone(p_secret text, p_endpoints text[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform push_check(p_secret);
  delete from push_subscriptions where endpoint = any (p_endpoints);
end;
$$;

-- Bir olay için kime ne gönderileceğini hesaplar
create or replace function public.push_job(p_secret text, p_payload jsonb) returns json
language plpgsql security definer set search_path = public as $$
declare
  kind text := p_payload ->> 'type';
  ev events;
  pr profiles;
  sid uuid;
  n int;
  tier text;
  targets uuid[] := '{}';
  title text;
  body text;
  url text := '#/';
  logkey text;
  inserted int;
begin
  perform push_check(p_secret);

  if kind = 'event' then
    select * into ev from events where id = (p_payload ->> 'id')::uuid;
    if ev.id is not null and ev.published and ev.completed_at is null then
      logkey := 'event:' || ev.id;
      title := 'Yeni etkinlik';
      body := ev.title || ' · ' || to_char(ev.starts_at at time zone 'Europe/Istanbul', 'DD.MM.YYYY HH24:MI');
      url := '#/event/' || ev.id;
      select coalesce(array_agg(id), '{}') into targets from profiles
        where status = 'approved' and id is distinct from ev.created_by;
    end if;

  elsif kind = 'badge' then
    select * into ev from events where id = (p_payload ->> 'event_id')::uuid;
    select s.id into sid from seasons s
      where ev.starts_at >= s.starts_at and (s.ends_at is null or ev.starts_at < s.ends_at);
    if sid is not null then
      select count(*) into n
      from attendances a join events e on e.id = a.event_id and e.published
      join seasons s on s.id = sid and e.starts_at >= s.starts_at and (s.ends_at is null or e.starts_at < s.ends_at)
      where a.user_id = (p_payload ->> 'user_id')::uuid and a.present;
      tier := case n when 8 then 'Bronz' when 12 then 'Gümüş' when 16 then 'Altın' end;
      if tier is not null then
        logkey := 'tier:' || sid || ':' || (p_payload ->> 'user_id') || ':' || n;
        title := tier || ' rozet kazandın! 🏅';
        body := 'Bu sezon ' || n || ' etkinliğe katıldın.';
        url := '#/profile';
        targets := array[(p_payload ->> 'user_id')::uuid];
      end if;
    end if;

  elsif kind = 'pending' then
    select * into pr from profiles where id = (p_payload ->> 'user_id')::uuid;
    if pr.id is not null and pr.status = 'pending' then
      logkey := 'pending:' || pr.id;
      title := 'Onay bekleyen yeni üye';
      body := coalesce(nullif(pr.full_name, ''), 'Yeni kayıt') || ' kulübe katılmak istiyor.';
      url := '#/members';
      select coalesce(array_agg(id), '{}') into targets from profiles where status = 'approved' and role = 'admin';
    end if;
  end if;

  -- Aynı bildirim daha önce gönderildiyse tekrar gönderme
  if logkey is not null then
    insert into push_log (key) values (logkey) on conflict do nothing;
    get diagnostics inserted = row_count;
    if inserted = 0 then targets := '{}'; end if;
  end if;

  return json_build_object(
    'vapid', (select json_build_object('public', a.value, 'private', b.value)
              from push_config a, push_config b where a.key = 'vapid_public' and b.key = 'vapid_private'),
    'message', json_build_object('title', title, 'body', body, 'url', url),
    'subscriptions', coalesce((
      select json_agg(json_build_object('endpoint', endpoint, 'p256dh', p256dh, 'auth', auth))
      from push_subscriptions where user_id = any (targets)), '[]'::json));
end;
$$;

grant execute on function public.push_subscribe(text, text, text), public.push_unsubscribe(text),
  public.push_public_key(), public.push_init() to authenticated;
grant execute on function public.push_job(text, jsonb), public.push_set_vapid(text, text, text),
  public.push_gone(text, text[]) to anon, authenticated;

-- ---------- Tetikleyiciler ----------
create or replace function public.push_on_event() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.published and (tg_op = 'INSERT' or not old.published) then
    perform push_send(jsonb_build_object('type', 'event', 'id', new.id));
  end if;
  return null;
end;
$$;
drop trigger if exists events_push on public.events;
create trigger events_push after insert or update of published on public.events
  for each row execute function public.push_on_event();

create or replace function public.push_on_present() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.present is true and old.present is distinct from true then
    perform push_send(jsonb_build_object('type', 'badge', 'event_id', new.event_id, 'user_id', new.user_id));
  end if;
  return null;
end;
$$;
drop trigger if exists attendances_push on public.attendances;
create trigger attendances_push after update of present on public.attendances
  for each row execute function public.push_on_present();

create or replace function public.push_on_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'pending' then
    perform push_send(jsonb_build_object('type', 'pending', 'user_id', new.id));
  end if;
  return null;
end;
$$;
drop trigger if exists profiles_push on public.profiles;
create trigger profiles_push after insert on public.profiles
  for each row execute function public.push_on_profile();

revoke all on function public.push_init() from public, anon;
