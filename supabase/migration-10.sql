-- WOB güncelleme 10: yönetici bir üyenin kaydını tamamen silebilir.
-- Silinen: hesap (giriş), profil, katılım ve yoklama geçmişi, öneriler ve oyları,
-- beğeniler, sürüş düzenindeki yeri, rozetler, bildirim kayıtları. Geri alınamaz.

-- Üyenin oluşturduğu etkinlikler silinmesin: oluşturan alanı boşalsın
do $$
declare c text;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.events'::regclass and contype = 'f'
             and conkey = array[(select attnum from pg_attribute where attrelid = 'public.events'::regclass and attname = 'created_by')]
  loop
    execute format('alter table public.events drop constraint %I', c);
  end loop;
end $$;
alter table public.events add constraint events_created_by_fkey
  foreign key (created_by) references public.profiles (id) on delete set null;

-- Silinen üyenin önerileri kayıtta tek tek "öneriyi sildi" diye görünmesin
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
    if old.user_id is distinct from auth.uid() and exists (select 1 from profiles where id = old.user_id) then
      perform log_admin('Öneriyi sildi: ' || old.title);
    end if;
  end if;
  return null;
end;
$$;

create or replace function public.admin_delete_member(p_id uuid) returns void
language plpgsql security definer set search_path = public, auth as $$
declare
  who text;
begin
  if not is_admin() then raise exception 'Bu işlem sadece yöneticiler içindir.'; end if;
  if p_id = auth.uid() then raise exception 'Kendi kaydını silemezsin.'; end if;
  select coalesce(nullif(full_name, ''), 'İsimsiz üye') into who from profiles where id = p_id;
  if who is null and not exists (select 1 from auth.users where id = p_id) then
    raise exception 'Üye bulunamadı.';
  end if;
  perform log_admin('Üye kaydını tamamen sildi: ' || coalesce(who, 'İsimsiz üye'));
  delete from auth.users where id = p_id; -- profil ve bağlı kayıtlar zincirleme silinir
end;
$$;
revoke all on function public.admin_delete_member(uuid) from public, anon;
grant execute on function public.admin_delete_member(uuid) to authenticated;
