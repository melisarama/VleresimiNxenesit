-- Synthetic demo data for local Supabase only.
-- Demo password for every account: DemoPilot123!

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values
  ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin.demo@mesimi.test',crypt('DemoPilot123!', gen_salt('bf')),now(),now(),now(),'{"provider":"email","providers":["email"]}','{}'),
  ('00000000-0000-0000-0000-0000000000t1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','teacher.math@mesimi.test',crypt('DemoPilot123!', gen_salt('bf')),now(),now(),now(),'{"provider":"email","providers":["email"]}','{}'),
  ('00000000-0000-0000-0000-0000000000t2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','teacher.lang@mesimi.test',crypt('DemoPilot123!', gen_salt('bf')),now(),now(),now(),'{"provider":"email","providers":["email"]}','{}'),
  ('00000000-0000-0000-0000-0000000000p1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','parent.one@mesimi.test',crypt('DemoPilot123!', gen_salt('bf')),now(),now(),now(),'{"provider":"email","providers":["email"]}','{}'),
  ('00000000-0000-0000-0000-0000000000p2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','parent.two@mesimi.test',crypt('DemoPilot123!', gen_salt('bf')),now(),now(),now(),'{"provider":"email","providers":["email"]}','{}')
on conflict (id) do nothing;

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
  ('00000000-0000-0000-0000-0000000000t1', '10000000-0000-0000-0000-000000000001', 'teacher', 'Arta', 'Mësimi', 'teacher.math@mesimi.test'),
  ('00000000-0000-0000-0000-0000000000t2', '10000000-0000-0000-0000-000000000001', 'teacher', 'Besim', 'Leximi', 'teacher.lang@mesimi.test'),
  ('00000000-0000-0000-0000-0000000000p1', '10000000-0000-0000-0000-000000000001', 'parent', 'Prind', 'Një', 'parent.one@mesimi.test'),
  ('00000000-0000-0000-0000-0000000000p2', '10000000-0000-0000-0000-000000000001', 'parent', 'Prind', 'Dy', 'parent.two@mesimi.test')
on conflict (id) do nothing;

insert into public.students (id, school_id, class_id, first_name, last_name, class_name)
values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Ana', 'Demo', 'V-A'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Driton', 'Demo', 'V-A'),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'Lina', 'Demo', 'V-B')
on conflict (id) do nothing;

insert into public.parent_students (parent_id, student_id)
values
  ('00000000-0000-0000-0000-0000000000p1', '30000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000000p1', '30000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-0000000000p2', '30000000-0000-0000-0000-000000000003')
on conflict do nothing;

insert into public.teacher_subjects (teacher_id, subject_id)
select '00000000-0000-0000-0000-0000000000t1', id from public.subjects where name = 'Matematikë'
on conflict do nothing;

insert into public.teacher_subjects (teacher_id, subject_id)
select '00000000-0000-0000-0000-0000000000t2', id from public.subjects where name = 'Gjuhë shqipe'
on conflict do nothing;

insert into public.teacher_students (teacher_id, student_id)
values
  ('00000000-0000-0000-0000-0000000000t1', '30000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000000t1', '30000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-0000000000t2', '30000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000000t2', '30000000-0000-0000-0000-000000000003')
on conflict do nothing;

insert into public.chapters (id, subject_id, name, target_score)
select '40000000-0000-0000-0000-000000000001', id, 'Numrat dhe veprimet', 4.0 from public.subjects where name = 'Matematikë'
on conflict do nothing;

insert into public.chapters (id, subject_id, name, target_score)
select '40000000-0000-0000-0000-000000000002', id, 'Leximi kuptimor', 4.0 from public.subjects where name = 'Gjuhë shqipe'
on conflict do nothing;

insert into public.grades (student_id, subject_id, chapter_id, teacher_id, score)
select '30000000-0000-0000-0000-000000000001', s.id, '40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000t1', 4.2
from public.subjects s where s.name = 'Matematikë';

insert into public.daily_moods (student_id, parent_id, mood, general_comment, parent_comment, reported_on)
values
  ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000p1', '😌 E qetë', 'Ka pasur mëngjes të qetë dhe është gati për punë me hapa të shkurtër.', 'Ka pasur mëngjes të qetë dhe është gati për punë me hapa të shkurtër.', current_date)
on conflict (student_id, parent_id, reported_on) do update
set mood = excluded.mood, general_comment = excluded.general_comment, parent_comment = excluded.parent_comment, updated_at = now();

insert into public.student_support_profiles (student_id, support_summary, preferences, accessibility_information)
values
  ('30000000-0000-0000-0000-000000000001', 'Përfiton nga udhëzime të lexuara me zë dhe hapa të vegjël.', '{"preferred_mode":"listening"}', 'Tekst i qartë dhe kontrast i mirë.')
on conflict (student_id) do nothing;
