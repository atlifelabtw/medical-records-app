-- Build 42: add stable, case-insensitive login names without changing existing
-- Supabase Auth emails or passwords.

alter table public.profiles
  add column if not exists login_name text;

with normalized as (
  select
    id,
    case
      when length(regexp_replace(lower(split_part(coalesce(email, ''), '@', 1)), '[^a-z0-9._-]', '', 'g')) >= 3
        then left(regexp_replace(lower(split_part(email, '@', 1)), '[^a-z0-9._-]', '', 'g'), 32)
      else 'user-' || left(id::text, 8)
    end as base_name
  from public.profiles
  where login_name is null or btrim(login_name) = ''
),
ranked as (
  select
    id,
    base_name,
    row_number() over (partition by base_name order by id) as duplicate_number
  from normalized
)
update public.profiles p
set login_name = case
  when r.duplicate_number = 1 then r.base_name
  else left(r.base_name, 28) || '-' || r.duplicate_number::text
end
from ranked r
where p.id = r.id;

update public.profiles
set login_name = lower(btrim(login_name));

alter table public.profiles
  alter column login_name set not null;

alter table public.profiles
  drop constraint if exists profiles_login_name_format_check;

alter table public.profiles
  add constraint profiles_login_name_format_check
  check (login_name ~ '^[a-z0-9][a-z0-9._-]{2,31}$');

create unique index if not exists profiles_login_name_unique
  on public.profiles (lower(login_name));

comment on column public.profiles.login_name is
  'Case-insensitive account name used by the username-login Edge Function. Auth email and password remain unchanged.';

