-- WOB güncelleme 5: etkinlikte "yoklama var/yok" ve "Çarşamba Buluşması" türü
-- Mevcut etkinlikler: yoklama var, normal etkinlik (hiçbir veri değişmez).

alter table public.events add column if not exists has_rollcall boolean not null default true;
alter table public.events add column if not exists kind text not null default 'normal';
do $$ begin
  alter table public.events add constraint events_kind_check check (kind in ('normal', 'wednesday'));
exception when duplicate_object then null; end $$;

-- Bir katılım rozetlere, sıralamaya ve seriye sayılır mı?
--   Yoklama var: yoklamada "geldi" işaretlenmiş olmalı.
--   Yoklama yok: "Katılıyorum" demiş olması yeter (etkinlik tamamlandıktan sonra sayılır).
create or replace function public.att_ok(p_rollcall boolean, p_completed timestamptz, p_going boolean, p_present boolean)
returns boolean language sql immutable as $$
  select case when p_rollcall then coalesce(p_present, false)
              else coalesce(p_going, false) and p_completed is not null end;
$$;

create or replace function public.leaderboard() returns json
language plpgsql stable security definer set search_path = public as $$
declare
  result json;
begin
  if not is_approved() then
    raise exception 'Bu bilgi sadece onaylı üyeler içindir.';
  end if;

  with
  -- Seri: tamamlanmış etkinlikler (yoklamalıysa yoklaması alınmış olanlar); üyelikten öncekiler sayılmaz
  ev as (
    select e.id, e.starts_at, e.has_rollcall, e.completed_at from events e
    where e.published and e.completed_at is not null
      and (not e.has_rollcall or exists (select 1 from attendances a where a.event_id = e.id and a.present is not null))
  ),
  ue as (
    select p.id as uid, ev.starts_at,
      coalesce((select att_ok(ev.has_rollcall, ev.completed_at, a.going, a.present) from attendances a where a.event_id = ev.id and a.user_id = p.id), false) as pres
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
    where att_ok(e.has_rollcall, e.completed_at, a.going, a.present) group by a.user_id
  ),
  stats as (
    select s.id as season_id, a.user_id, count(*) as attended
    from seasons s
    join events e on e.published and e.starts_at >= s.starts_at and (s.ends_at is null or e.starts_at < s.ends_at)
    join attendances a on a.event_id = e.id and att_ok(e.has_rollcall, e.completed_at, a.going, a.present)
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
      where a.user_id = (p_payload ->> 'user_id')::uuid and att_ok(e.has_rollcall, e.completed_at, a.going, a.present);
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

-- Dashboard: katıldı = att_ok kuralına göre sayılan katılım
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
    'past_events',      (select count(*) from events where published and completed_at is not null),
    'upcoming_events',  (select count(*) from events where published and completed_at is null),
    'approved_members', (select count(*) from profiles where status = 'approved'),
    'pending_members',  (select count(*) from profiles where status = 'pending'),
    'open_suggestions', (select count(*) from suggestions),
    'members', coalesce((
      select json_agg(m order by m.attended desc, m.yes_count desc, m.full_name)
      from (
        select p.id, p.full_name, p.edu_status,
          count(*) filter (where e.id is not null and att_ok(e.has_rollcall, e.completed_at, a.going, a.present)) as attended,
          count(*) filter (where e.id is not null and a.going) as yes_count,
          count(*) filter (where e.id is not null and not a.going) as no_count
        from profiles p
        left join attendances a on a.user_id = p.id
        left join events e on e.id = a.event_id and e.published
        where p.status = 'approved'
        group by p.id, p.full_name, p.edu_status
      ) m
    ), '[]'::json),
    'events', coalesce((
      select json_agg(x order by x.starts_at desc)
      from (
        select e.id, e.title, e.starts_at, e.completed_at, e.kind, e.has_rollcall,
          (select count(*) from attendances a where a.event_id = e.id and a.going) as going,
          (select count(*) from attendances a where a.event_id = e.id and not a.going) as not_going,
          (select count(*) from attendances a where a.event_id = e.id and att_ok(e.has_rollcall, e.completed_at, a.going, a.present)) as present,
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

-- Yoklamasız etkinlik tamamlanınca, katılanların rozet bildirimi kontrol edilir
create or replace function public.push_on_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  if new.published and (tg_op = 'INSERT' or not old.published) then
    perform push_send(jsonb_build_object('type', 'event', 'id', new.id));
  end if;
  if tg_op = 'UPDATE' and new.published and not new.has_rollcall
     and new.completed_at is not null and old.completed_at is null then
    for r in select user_id from attendances where event_id = new.id and going loop
      perform push_send(jsonb_build_object('type', 'badge', 'event_id', new.id, 'user_id', r.user_id));
    end loop;
  end if;
  return null;
end;
$$;
drop trigger if exists events_push on public.events;
create trigger events_push after insert or update of published, completed_at on public.events
  for each row execute function public.push_on_event();
