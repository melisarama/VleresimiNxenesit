-- Synthetic demo data for local Supabase only.
-- Demo password for every account: DemoPilot123!

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

insert into public.schools (id, name, address)
values ('10000000-0000-0000-0000-000000000001', 'Shkolla Demo Prishtinë', 'Adresë sintetike')
on conflict (id) do nothing;

insert into public.classes (id, school_id, name, school_year)
values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'V-A', '2026/2027'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'V-B', '2026/2027')
on conflict (school_id, name, school_year) do nothing;

insert into public.profiles (id, school_id, role, first_name, last_name, email)
values
  ('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', 'admin', 'Administratore', 'Demo', 'admin.demo@mesimi.test'),
  ('00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-000000000001', 'teacher', 'Arta', 'Mësimi', 'teacher.math@mesimi.test'),
  ('00000000-0000-0000-0000-0000000000b2', '10000000-0000-0000-0000-000000000001', 'teacher', 'Besim', 'Leximi', 'teacher.lang@mesimi.test'),
  ('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-000000000001', 'parent', 'Prind', 'Një', 'parent.one@mesimi.test'),
  ('00000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-000000000001', 'parent', 'Prind', 'Dy', 'parent.two@mesimi.test')
on conflict (id) do nothing;

insert into public.students (id, school_id, class_id, first_name, last_name, class_name)
values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Ana', 'Demo', 'V-A'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Driton', 'Demo', 'V-A'),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'Lina', 'Demo', 'V-B')
on conflict (id) do nothing;

insert into public.parent_students (parent_id, student_id)
values
  ('00000000-0000-0000-0000-0000000000c1', '30000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000000c1', '30000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-0000000000c2', '30000000-0000-0000-0000-000000000003')
on conflict do nothing;

insert into public.teacher_subjects (teacher_id, subject_id)
select '00000000-0000-0000-0000-0000000000b1', id from public.subjects where name = 'Matematikë'
on conflict do nothing;

insert into public.teacher_subjects (teacher_id, subject_id)
select '00000000-0000-0000-0000-0000000000b2', id from public.subjects where name = 'Gjuhë shqipe'
on conflict do nothing;

insert into public.teacher_students (teacher_id, student_id)
values
  ('00000000-0000-0000-0000-0000000000b1', '30000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000000b1', '30000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-0000000000b2', '30000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000000b2', '30000000-0000-0000-0000-000000000003')
on conflict do nothing;

insert into public.chapters (id, subject_id, name, target_score)
select '40000000-0000-0000-0000-000000000001', id, 'Numrat dhe veprimet', 4.0 from public.subjects where name = 'Matematikë'
on conflict do nothing;

insert into public.chapters (id, subject_id, name, target_score)
select '40000000-0000-0000-0000-000000000002', id, 'Leximi kuptimor', 4.0 from public.subjects where name = 'Gjuhë shqipe'
on conflict do nothing;

insert into public.grades (student_id, subject_id, chapter_id, teacher_id, score)
select '30000000-0000-0000-0000-000000000001', s.id, '40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', 4.2
from public.subjects s where s.name = 'Matematikë';

insert into public.daily_moods (student_id, parent_id, mood, general_comment, parent_comment, reported_on)
values
  ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c1', '😌 E qetë', 'Ka pasur mëngjes të qetë dhe është gati për punë me hapa të shkurtër.', 'Ka pasur mëngjes të qetë dhe është gati për punë me hapa të shkurtër.', current_date)
on conflict (student_id, parent_id, reported_on) do update
set mood = excluded.mood, general_comment = excluded.general_comment, parent_comment = excluded.parent_comment, updated_at = now();

insert into public.student_support_profiles (student_id, support_summary, preferences, accessibility_information)
values
  ('30000000-0000-0000-0000-000000000001', 'Përfiton nga udhëzime të lexuara me zë dhe hapa të vegjël.', '{"preferred_mode":"listening"}', 'Tekst i qartë dhe kontrast i mirë.')
on conflict (student_id) do nothing;
