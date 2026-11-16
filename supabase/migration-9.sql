-- WOB güncelleme 9: rozet puanları yönetici tarafından ayarlanabilir.

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
drop policy if exists "ayar okuma" on public.app_settings;
drop policy if exists "ayar ekle" on public.app_settings;
drop policy if exists "ayar güncelle" on public.app_settings;
create policy "ayar okuma" on public.app_settings for select using (is_approved());
create policy "ayar ekle" on public.app_settings for insert with check (is_admin());
create policy "ayar güncelle" on public.app_settings for update using (is_admin()) with check (is_admin());
grant select, insert, update on public.app_settings to authenticated;

insert into public.app_settings (key, value)
values ('badge_tiers', '{"bronze": 16, "silver": 24, "gold": 32}')
on conflict (key) do nothing;

-- Geçerli değerler: 1 ≤ bronz < gümüş < altın
create or replace function public.check_settings() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  b int; s int; g int;
begin
  if new.key = 'badge_tiers' then
    b := (new.value ->> 'bronze')::int; s := (new.value ->> 'silver')::int; g := (new.value ->> 'gold')::int;
    if b is null or s is null or g is null or b < 1 or s <= b or g <= s or g > 1000 then
      raise exception 'Rozet puanları sırayla artmalı: Bronz < Gümüş < Altın.';
    end if;
    new.value := jsonb_build_object('bronze', b, 'silver', s, 'gold', g);
    if tg_op = 'UPDATE' and new.value is distinct from old.value then
      perform log_admin('Rozet puanlarını değiştirdi: Bronz ' || b || ', Gümüş ' || s || ', Altın ' || g);
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists app_settings_check on public.app_settings;
create trigger app_settings_check before insert or update on public.app_settings
  for each row execute function public.check_settings();

create or replace function public.push_job(p_secret text, p_payload jsonb) returns json
language plpgsql security definer set search_path = public as $$
declare
  kind text := p_payload ->> 'type';
  ev events;
  pr profiles;
  an announcements;
  aw awards;
  sid uuid;
  n int;
  w int;
  tb int;
  ts int;
  tg int;
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
      -- Sezon puanı: etkinlik 2, Çarşamba Buluşması 1 puan. Rozet eşikleri ayarlardan okunur.
      select coalesce(sum(case when e.kind = 'wednesday' then 1 else 2 end), 0) into n
      from attendances a join events e on e.id = a.event_id and e.published
      join seasons s on s.id = sid and e.starts_at >= s.starts_at and (s.ends_at is null or e.starts_at < s.ends_at)
      where a.user_id = (p_payload ->> 'user_id')::uuid and att_ok(e.has_rollcall, e.completed_at, a.going, a.present);
      w := case when ev.kind = 'wednesday' then 1 else 2 end;
      select coalesce((value ->> 'bronze')::int, 16), coalesce((value ->> 'silver')::int, 24), coalesce((value ->> 'gold')::int, 32)
        into tb, ts, tg from app_settings where key = 'badge_tiers';
      tb := coalesce(tb, 16); ts := coalesce(ts, 24); tg := coalesce(tg, 32);
      tier := case when n >= tg and n - w < tg then 'Altın'
                   when n >= ts and n - w < ts then 'Gümüş'
                   when n >= tb and n - w < tb then 'Bronz' end;
      if tier is not null then
        logkey := 'ptier:' || sid || ':' || (p_payload ->> 'user_id') || ':' || tier;
        title := tier || ' rozet kazandın! 🏅';
        body := 'Bu sezon ' || n || ' puana ulaştın.';
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

  elsif kind = 'announce' then
    select * into an from announcements where id = (p_payload ->> 'id')::uuid;
    if an.id is not null then
      logkey := 'announce:' || an.id;
      title := 'Duyuru: ' || an.title;
      body := left(coalesce(an.body, ''), 140);
      url := '#/announcements';
      select coalesce(array_agg(id), '{}') into targets from profiles
        where status = 'approved' and id is distinct from an.created_by;
    end if;

  elsif kind = 'award' then
    select * into aw from awards where id = (p_payload ->> 'id')::uuid;
    if aw.id is not null then
      logkey := 'award:' || aw.id;
      title := 'Yeni rozetin var! 🏅';
      body := '“' || aw.title || '” rozeti sana verildi.';
      url := '#/profile';
      targets := array[aw.user_id];
    end if;

  elsif kind in ('remind', 'nudge') then
    select * into ev from events where id = (p_payload ->> 'id')::uuid;
    if ev.id is not null and ev.published and ev.completed_at is null and ev.starts_at > now() then
      logkey := kind || ':' || ev.id;
      url := '#/event/' || ev.id;
      if kind = 'remind' then
        title := 'Etkinlik yaklaşıyor';
        body := ev.title || ' · ' || to_char(ev.starts_at at time zone 'Europe/Istanbul', 'DD.MM.YYYY HH24:MI');
        select coalesce(array_agg(user_id), '{}') into targets from attendances where event_id = ev.id and going;
      elsif not ev.registration_closed then
        title := 'Yanıtını bekliyoruz';
        body := ev.title || ' için henüz yanıt vermedin. ' || to_char(ev.starts_at at time zone 'Europe/Istanbul', 'DD.MM HH24:MI');
        select coalesce(array_agg(p.id), '{}') into targets from profiles p
          where p.status = 'approved'
            and not exists (select 1 from attendances a where a.event_id = ev.id and a.user_id = p.id);
      end if;
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
