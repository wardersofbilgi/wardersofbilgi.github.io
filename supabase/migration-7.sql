-- WOB güncelleme 7: duyurular, elle verilen rozetler, yönetici işlem kaydı,
-- hatırlatma bildirimleri ve yöneticinin katılım listesine kişi eklemesi.
-- Mevcut veriler değişmez.

-- ---------- Yönetici, listeye başkası adına katılım ekleyebilir ----------
drop policy if exists "katılım ekle" on public.attendances;
create policy "katılım ekle" on public.attendances for insert
  with check ((user_id = auth.uid() and is_approved()) or is_admin());

-- ---------- Duyurular ----------
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) >= 3),
  body text,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.announcements enable row level security;
drop policy if exists "duyuru okuma" on public.announcements;
drop policy if exists "duyuru ekle" on public.announcements;
drop policy if exists "duyuru sil" on public.announcements;
create policy "duyuru okuma" on public.announcements for select using (is_approved());
create policy "duyuru ekle" on public.announcements for insert with check (is_admin());
create policy "duyuru sil" on public.announcements for delete using (is_admin());
grant select, insert, delete on public.announcements to authenticated;

-- ---------- Elle verilen rozetler ----------
create table if not exists public.awards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (length(trim(title)) between 2 and 40),
  icon text not null default 'star' check (icon in ('star', 'crown', 'road', 'helmet', 'heart', 'wrench')),
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists awards_user on public.awards (user_id);
alter table public.awards enable row level security;
drop policy if exists "ödül okuma" on public.awards;
drop policy if exists "ödül ekle" on public.awards;
drop policy if exists "ödül sil" on public.awards;
create policy "ödül okuma" on public.awards for select using (is_approved());
create policy "ödül ekle" on public.awards for insert with check (is_admin());
create policy "ödül sil" on public.awards for delete using (is_admin());
grant select, insert, delete on public.awards to authenticated;

-- ---------- Yönetici işlem kaydı ----------
create table if not exists public.admin_log (
  id bigint generated always as identity primary key,
  actor uuid references public.profiles (id) on delete set null,
  actor_name text,
  message text not null,
  created_at timestamptz not null default now()
);
alter table public.admin_log enable row level security;
drop policy if exists "kayıt okuma" on public.admin_log;
create policy "kayıt okuma" on public.admin_log for select using (is_admin());
revoke all on public.admin_log from anon, authenticated;
grant select on public.admin_log to authenticated;

-- Yalnızca yöneticinin yaptığı işlemler kaydedilir
create or replace function public.log_admin(p_message text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not is_admin() then return; end if;
  insert into admin_log (actor, actor_name, message)
  values (auth.uid(), (select full_name from profiles where id = auth.uid()), p_message);
end;
$$;
revoke all on function public.log_admin(text) from public, anon, authenticated;

create or replace function public.pname(p_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif((select full_name from profiles where id = p_id), ''), 'Bir üye');
$$;
revoke all on function public.pname(uuid) from public, anon, authenticated;

create or replace function public.log_profiles() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.id = auth.uid() then return null; end if;
  if new.status is distinct from old.status then
    perform log_admin(case
      when new.status = 'approved' and old.status = 'pending' then pname(new.id) || ' üyeliğini onayladı'
      when new.status = 'approved' then pname(new.id) || ' üyeliğini yeniden onayladı'
      when old.status = 'pending' then pname(new.id) || ' başvurusunu reddetti'
      else pname(new.id) || ' kişisini üyelikten çıkardı' end);
  elsif new.role is distinct from old.role then
    perform log_admin(case when new.role = 'admin' then pname(new.id) || ' kişisini yönetici yaptı'
                           else pname(new.id) || ' kişisinin yöneticiliğini aldı' end);
  end if;
  return null;
end;
$$;
drop trigger if exists profiles_log on public.profiles;
create trigger profiles_log after update of status, role on public.profiles
  for each row execute function public.log_profiles();

create or replace function public.log_events() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform log_admin('Etkinlik oluşturdu: ' || new.title || case when new.published then '' else ' (taslak)' end);
  elsif tg_op = 'DELETE' then
    perform log_admin('Etkinliği sildi: ' || old.title);
  elsif new.completed_at is distinct from old.completed_at and (new.completed_at is null) <> (old.completed_at is null) then
    perform log_admin(case when new.completed_at is not null then 'Etkinliği tamamladı: ' else 'Tamamlandı işaretini kaldırdı: ' end || new.title);
  elsif new.published is distinct from old.published then
    perform log_admin(case when new.published then 'Etkinliği yayınladı: ' else 'Etkinliği yayından kaldırdı: ' end || new.title);
  elsif new.registration_closed is distinct from old.registration_closed then
    perform log_admin(case when new.registration_closed then 'Katılım listesini kapattı: ' else 'Katılım listesini açtı: ' end || new.title);
  elsif (new.title, new.starts_at, new.kind, new.has_rollcall, new.description, new.meeting_note)
        is distinct from (old.title, old.starts_at, old.kind, old.has_rollcall, old.description, old.meeting_note) then
    perform log_admin('Etkinliği düzenledi: ' || new.title);
  end if;
  return null;
end;
$$;
drop trigger if exists events_log on public.events;
create trigger events_log after insert or update or delete on public.events
  for each row execute function public.log_events();

create or replace function public.log_attendances() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t text;
begin
  select title into t from events where id = coalesce(new.event_id, old.event_id);
  if t is null then return null; end if; -- etkinlik silinirken
  if tg_op = 'INSERT' then
    if new.user_id is distinct from auth.uid() then
      perform log_admin(t || ': ' || pname(new.user_id) || ' kişisini katılım listesine ekledi');
    end if;
  elsif tg_op = 'DELETE' then
    if old.user_id is distinct from auth.uid() and exists (select 1 from profiles where id = old.user_id) then
      perform log_admin(t || ': ' || pname(old.user_id) || ' kişisini katılım listesinden çıkardı');
    end if;
  elsif new.present is distinct from old.present then
    perform log_admin(t || ': ' || pname(new.user_id) || ' yoklaması → ' ||
      case when new.present is true then 'geldi' when new.present is false then 'gelmedi' else 'işaret kaldırıldı' end);
  end if;
  return null;
end;
$$;
drop trigger if exists attendances_log on public.attendances;
create trigger attendances_log after insert or update or delete on public.attendances
  for each row execute function public.log_attendances();

create or replace function public.log_misc() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'seasons' then
    if tg_op = 'INSERT' then perform log_admin('Sezon başlattı: ' || new.name);
    elsif new.ends_at is not null and old.ends_at is null then perform log_admin('Sezonu bitirdi: ' || new.name);
    end if;
  elsif tg_table_name = 'awards' then
    if tg_op = 'INSERT' then perform log_admin(pname(new.user_id) || ' kişisine rozet verdi: ' || new.title);
    elsif exists (select 1 from profiles where id = old.user_id) then
      perform log_admin(pname(old.user_id) || ' kişisinin rozetini geri aldı: ' || old.title);
    end if;
  elsif tg_table_name = 'announcements' then
    if tg_op = 'INSERT' then perform log_admin('Duyuru yayınladı: ' || new.title);
    else perform log_admin('Duyuruyu sildi: ' || old.title);
    end if;
  elsif tg_table_name = 'suggestions' then
    if old.user_id is distinct from auth.uid() then perform log_admin('Öneriyi sildi: ' || old.title); end if;
  end if;
  return null;
end;
$$;
drop trigger if exists seasons_log on public.seasons;
create trigger seasons_log after insert or update on public.seasons for each row execute function public.log_misc();
drop trigger if exists awards_log on public.awards;
create trigger awards_log after insert or delete on public.awards for each row execute function public.log_misc();
drop trigger if exists announcements_log on public.announcements;
create trigger announcements_log after insert or delete on public.announcements for each row execute function public.log_misc();
drop trigger if exists suggestions_log on public.suggestions;
create trigger suggestions_log after delete on public.suggestions for each row execute function public.log_misc();

-- ---------- Bildirimler: duyuru, elle rozet, hatırlatma ----------
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
      where a.user_id = (p_payload ->> 'user_id')::uuid and e.kind = ev.kind and att_ok(e.has_rollcall, e.completed_at, a.going, a.present);
      tier := case n when 8 then 'Bronz' when 12 then 'Gümüş' when 16 then 'Altın' end;
      if tier is not null then
        logkey := 'tier:' || sid || ':' || (p_payload ->> 'user_id') || ':' || case when ev.kind = 'wednesday' then 'w' else '' end || n;
        title := case when ev.kind = 'wednesday' then 'Çarşamba ' else '' end || tier || ' rozet kazandın! 🏅';
        body := 'Bu sezon ' || n || case when ev.kind = 'wednesday' then ' Çarşamba Buluşmasına katıldın.' else ' etkinliğe katıldın.' end;
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

create or replace function public.push_on_misc() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform push_send(jsonb_build_object('type', case tg_table_name when 'awards' then 'award' else 'announce' end, 'id', new.id));
  return null;
end;
$$;
drop trigger if exists announcements_push on public.announcements;
create trigger announcements_push after insert on public.announcements for each row execute function public.push_on_misc();
drop trigger if exists awards_push on public.awards;
create trigger awards_push after insert on public.awards for each row execute function public.push_on_misc();

-- Başlamasına 24 saatten az kalan etkinlikler için: katılanlara hatırlatma,
-- yanıt vermeyenlere "yanıtını bekliyoruz". Her etkinlik için bir kez gider.
create or replace function public.push_reminders() returns void
language plpgsql security definer set search_path = public as $$
declare
  e record;
begin
  for e in
    select id from events
    where published and completed_at is null
      and starts_at > now() and starts_at <= now() + interval '24 hours'
      and created_at < now() - interval '6 hours'
      and not exists (select 1 from push_log where key = 'remind:' || events.id)
  loop
    perform push_send(jsonb_build_object('type', 'remind', 'id', e.id));
    perform push_send(jsonb_build_object('type', 'nudge', 'id', e.id));
  end loop;
end;
$$;
revoke all on function public.push_reminders() from public, anon, authenticated;

-- Yarım saatte bir çalıştır
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('wob-reminders', '*/30 * * * *', 'select public.push_reminders()');
exception when others then
  raise notice 'pg_cron kurulamadı: %', sqlerrm;
end $$;
