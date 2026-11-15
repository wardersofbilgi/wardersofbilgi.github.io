-- WOB güncelleme 3: etkinliği "Tamamlandı" olarak işaretleme ve yoklama

-- Etkinlik, yönetici "Tamamlandı" diyene kadar aktif kalır
alter table public.events add column if not exists completed_at timestamptz;

-- Yoklama: null = alınmadı, true = geldi, false = gelmedi
alter table public.attendances add column if not exists present boolean;

-- Bu güncellemeden önce tarihi geçmiş etkinlikler tamamlanmış sayılır (yerleri değişmesin)
update public.events set completed_at = starts_at
where completed_at is null and starts_at < date_trunc('day', now());

-- Katılım kuralları: tamamlanan ya da listesi kapalı etkinliğe üye yanıt veremez;
-- yoklamayı yalnızca yönetici işaretler.
create or replace function public.check_attendance() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ev events;
begin
  select * into ev from events where id = coalesce(new.event_id, old.event_id);
  if not is_admin() then
    if not ev.published or ev.registration_closed or ev.completed_at is not null then
      raise exception 'Bu etkinliğin katılım listesi kapalı.';
    end if;
    if tg_op = 'INSERT' then
      new.present := null;
    elsif tg_op = 'UPDATE' then
      new.present := old.present;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if not new.going then new.present := null; end if;
  new.updated_at := now();
  return new;
end;
$$;

-- Dashboard: yapılan = tamamlanan; katıldı = yoklamada "geldi" işaretlenen
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
          count(*) filter (where e.id is not null and a.present) as attended,
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
        select e.id, e.title, e.starts_at, e.completed_at,
          (select count(*) from attendances a where a.event_id = e.id and a.going) as going,
          (select count(*) from attendances a where a.event_id = e.id and not a.going) as not_going,
          (select count(*) from attendances a where a.event_id = e.id and a.present) as present,
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
