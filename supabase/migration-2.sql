-- WOB güncelleme 2: okuyor/mezun bilgisi, önerilerin tüm üyelere açılması ve öneri oylaması

alter table public.profiles add column if not exists edu_status text
  check (edu_status in ('student', 'graduate'));

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  first_user boolean;
  edu text := new.raw_user_meta_data ->> 'edu_status';
begin
  select not exists (select 1 from profiles) into first_user;
  insert into profiles (id, full_name, phone, bike, edu_status, role, status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.raw_user_meta_data ->> 'phone',
    new.raw_user_meta_data ->> 'bike',
    case when edu in ('student', 'graduate') then edu else null end,
    case when first_user then 'admin'::user_role else 'member'::user_role end,
    case when first_user then 'approved'::user_status else 'pending'::user_status end
  );
  return new;
end;
$$;

-- Öneriler artık tüm onaylı üyelere görünür (oylama için)
drop policy if exists "öneri okuma" on public.suggestions;
create policy "öneri okuma" on public.suggestions for select using (is_approved());

create table if not exists public.suggestion_votes (
  suggestion_id uuid not null references public.suggestions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  value smallint not null check (value in (-1, 1)),
  primary key (suggestion_id, user_id)
);
alter table public.suggestion_votes enable row level security;

drop policy if exists "öneri oyu okuma" on public.suggestion_votes;
drop policy if exists "öneri oyu ekle" on public.suggestion_votes;
drop policy if exists "öneri oyu güncelle" on public.suggestion_votes;
drop policy if exists "öneri oyu sil" on public.suggestion_votes;
create policy "öneri oyu okuma" on public.suggestion_votes for select using (is_approved());
create policy "öneri oyu ekle" on public.suggestion_votes for insert
  with check (user_id = auth.uid() and is_approved());
create policy "öneri oyu güncelle" on public.suggestion_votes for update using (user_id = auth.uid());
create policy "öneri oyu sil" on public.suggestion_votes for delete using (user_id = auth.uid());

grant select, insert, update, delete on public.suggestion_votes to authenticated;
