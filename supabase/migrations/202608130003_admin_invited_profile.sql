-- Allow an authenticated school admin to finish an Auth invitation without exposing service-role database access.

create unique index if not exists profiles_email_lower_unique_idx
on public.profiles (lower(email));

create or replace function public.admin_register_invited_profile(
  invited_user_id uuid,
  invited_email text,
  invited_first_name text,
  invited_last_name text,
  invited_role text
)
returns public.profiles
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  admin_profile public.profiles;
  created_profile public.profiles;
begin
  select * into admin_profile
  from public.profiles
  where id = auth.uid() and role = 'admin' and active = true;

  if admin_profile.id is null or admin_profile.school_id is null then
    raise exception 'ADMIN_FORBIDDEN';
  end if;

  if invited_role not in ('teacher', 'parent') then
    raise exception 'INVALID_ROLE';
  end if;

  if not exists (
    select 1 from auth.users
    where id = invited_user_id and lower(email) = lower(trim(invited_email))
  ) then
    raise exception 'AUTH_USER_MISMATCH';
  end if;

  insert into public.profiles (id, school_id, role, first_name, last_name, email, active)
  values (
    invited_user_id,
    admin_profile.school_id,
    invited_role::public.profile_role,
    trim(invited_first_name),
    trim(invited_last_name),
    lower(trim(invited_email)),
    true
  )
  returning * into created_profile;

  return created_profile;
end;
$$;

revoke all on function public.admin_register_invited_profile(uuid, text, text, text, text) from public;
grant execute on function public.admin_register_invited_profile(uuid, text, text, text, text) to authenticated;

