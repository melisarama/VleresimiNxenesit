-- Repair deterministic demo Auth users created by early seed attempts.
-- Supabase Auth expects several token columns to be empty strings, not NULL.

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values
  ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin.demo@mesimi.test',extensions.crypt('DemoPilot123!', extensions.gen_salt('bf')),now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','',''),
  ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','teacher.math@mesimi.test',extensions.crypt('DemoPilot123!', extensions.gen_salt('bf')),now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','',''),
  ('00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','teacher.lang@mesimi.test',extensions.crypt('DemoPilot123!', extensions.gen_salt('bf')),now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','',''),
  ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','parent.one@mesimi.test',extensions.crypt('DemoPilot123!', extensions.gen_salt('bf')),now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','',''),
  ('00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','parent.two@mesimi.test',extensions.crypt('DemoPilot123!', extensions.gen_salt('bf')),now(),now(),now(),'{"provider":"email","providers":["email"]}','{}','','','','')
on conflict (id) do update
set
  aud = excluded.aud,
  role = excluded.role,
  email = excluded.email,
  encrypted_password = excluded.encrypted_password,
  email_confirmed_at = now(),
  raw_app_meta_data = excluded.raw_app_meta_data,
  raw_user_meta_data = coalesce(auth.users.raw_user_meta_data, '{}'::jsonb),
  confirmation_token = '',
  email_change = '',
  email_change_token_new = '',
  recovery_token = '',
  updated_at = now();

update auth.users
set
  confirmation_token = coalesce(confirmation_token, ''),
  email_change = coalesce(email_change, ''),
  email_change_token_new = coalesce(email_change_token_new, ''),
  recovery_token = coalesce(recovery_token, ''),
  raw_app_meta_data = '{"provider":"email","providers":["email"]}'::jsonb,
  email_confirmed_at = coalesce(email_confirmed_at, now())
where id in (
  '00000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-0000000000b1',
  '00000000-0000-0000-0000-0000000000b2',
  '00000000-0000-0000-0000-0000000000c1',
  '00000000-0000-0000-0000-0000000000c2'
);

update auth.users
set
  email_change_token_current = coalesce(email_change_token_current, ''),
  phone_change = coalesce(phone_change, ''),
  phone_change_token = coalesce(phone_change_token, ''),
  reauthentication_token = coalesce(reauthentication_token, ''),
  is_sso_user = coalesce(is_sso_user, false),
  is_anonymous = coalesce(is_anonymous, false)
where id in (
  '00000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-0000000000b1',
  '00000000-0000-0000-0000-0000000000b2',
  '00000000-0000-0000-0000-0000000000c1',
  '00000000-0000-0000-0000-0000000000c2'
);

do $$
declare
  demo_ids uuid[] := array[
    '00000000-0000-0000-0000-0000000000a1'::uuid,
    '00000000-0000-0000-0000-0000000000b1'::uuid,
    '00000000-0000-0000-0000-0000000000b2'::uuid,
    '00000000-0000-0000-0000-0000000000c1'::uuid,
    '00000000-0000-0000-0000-0000000000c2'::uuid
  ];
  nullable_text_column record;
begin
  for nullable_text_column in
    select column_name
    from information_schema.columns
    where table_schema = 'auth'
      and table_name = 'users'
      and data_type in ('text', 'character varying', 'character')
      and column_name <> 'phone'
  loop
    execute format(
      'update auth.users set %I = '''' where id = any ($1) and %I is null',
      nullable_text_column.column_name,
      nullable_text_column.column_name
    ) using demo_ids;
  end loop;
end $$;

insert into auth.identities (
  id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
) values
  ('00000000-0000-0000-0001-0000000000a1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', '{"sub":"00000000-0000-0000-0000-0000000000a1","email":"admin.demo@mesimi.test","email_verified":true,"phone_verified":false}', 'email', now(), now(), now()),
  ('00000000-0000-0000-0001-0000000000b1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1', '{"sub":"00000000-0000-0000-0000-0000000000b1","email":"teacher.math@mesimi.test","email_verified":true,"phone_verified":false}', 'email', now(), now(), now()),
  ('00000000-0000-0000-0001-0000000000b2', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b2', '{"sub":"00000000-0000-0000-0000-0000000000b2","email":"teacher.lang@mesimi.test","email_verified":true,"phone_verified":false}', 'email', now(), now(), now()),
  ('00000000-0000-0000-0001-0000000000c1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c1', '{"sub":"00000000-0000-0000-0000-0000000000c1","email":"parent.one@mesimi.test","email_verified":true,"phone_verified":false}', 'email', now(), now(), now()),
  ('00000000-0000-0000-0001-0000000000c2', '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000c2', '{"sub":"00000000-0000-0000-0000-0000000000c2","email":"parent.two@mesimi.test","email_verified":true,"phone_verified":false}', 'email', now(), now(), now())
on conflict (provider_id, provider) do update
set
  user_id = excluded.user_id,
  identity_data = excluded.identity_data,
  updated_at = now();
