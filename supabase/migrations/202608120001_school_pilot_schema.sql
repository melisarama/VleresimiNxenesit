-- Mësim i Qartë school-pilot schema hardening.
-- Apply with: supabase db push

create extension if not exists "pgcrypto";

do $$ begin
  create type public.profile_role as enum ('parent', 'teacher', 'admin');
exception when duplicate_object then null;
end $$;

create table if not exists public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  school_id uuid references public.schools(id),
  role public.profile_role not null,
  first_name text not null,
  last_name text not null,
  email text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  name text not null,
  school_year text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (school_id, name, school_year)
);

create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true
);

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools(id),
  class_id uuid references public.classes(id),
  first_name text not null,
  last_name text not null,
  class_name text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.students add column if not exists school_id uuid references public.schools(id);
alter table public.students add column if not exists class_id uuid references public.classes(id);
alter table public.students add column if not exists active boolean not null default true;
alter table public.students add column if not exists created_at timestamptz not null default now();

create table if not exists public.parent_students (
  parent_id uuid not null references public.profiles(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (parent_id, student_id)
);

create table if not exists public.teacher_subjects (
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (teacher_id, subject_id)
);

create table if not exists public.teacher_students (
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (teacher_id, student_id)
);

create table if not exists public.chapters (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete cascade,
  name text not null,
  target_score numeric(3,1) not null default 4.0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (subject_id, name)
);

alter table public.chapters add column if not exists target_score numeric(3,1) not null default 4.0;
alter table public.chapters add column if not exists active boolean not null default true;
alter table public.chapters add column if not exists created_at timestamptz not null default now();

create table if not exists public.grades (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id),
  score numeric(3,1) not null check (score >= 1 and score <= 5),
  graded_at timestamptz not null default now()
);

alter table public.grades add column if not exists teacher_id uuid references public.profiles(id);
alter table public.grades add column if not exists graded_at timestamptz not null default now();

create table if not exists public.daily_moods (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  parent_id uuid references public.profiles(id),
  mood text not null,
  general_comment text,
  parent_comment text,
  reported_on date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.daily_moods add column if not exists parent_id uuid references public.profiles(id);
alter table public.daily_moods add column if not exists general_comment text;
alter table public.daily_moods add column if not exists created_at timestamptz not null default now();
alter table public.daily_moods add column if not exists updated_at timestamptz not null default now();
create unique index if not exists daily_moods_parent_student_day_idx on public.daily_moods (student_id, parent_id, reported_on);

create table if not exists public.subject_parent_notices (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  parent_id uuid not null references public.profiles(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  comment text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.teacher_parent_notices (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  message text not null check (char_length(message) <= 1200),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create table if not exists public.student_support_profiles (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null unique references public.students(id) on delete cascade,
  support_summary text,
  preferences jsonb not null default '{}'::jsonb,
  accessibility_information text,
  updated_at timestamptz not null default now()
);

create table if not exists public.assessment_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  positive_label text not null,
  description text
);

create table if not exists public.continuous_assessments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  category_id uuid not null references public.assessment_categories(id),
  rating smallint not null check (rating between 1 and 5),
  teacher_observation text,
  support_strategy text,
  parent_summary text,
  created_at timestamptz not null default now()
);

create table if not exists public.pia_plans (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  objective text not null,
  adaptations text,
  progress_measurement text,
  document_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_school_role_idx on public.profiles (school_id, role);
create index if not exists students_school_class_idx on public.students (school_id, class_id) where active;
create index if not exists teacher_students_student_idx on public.teacher_students (student_id);
create index if not exists grades_student_subject_idx on public.grades (student_id, subject_id, graded_at desc);
create index if not exists daily_moods_student_day_idx on public.daily_moods (student_id, reported_on desc);
create index if not exists subject_parent_notices_subject_idx on public.subject_parent_notices (subject_id, created_at desc);
create index if not exists teacher_parent_notices_student_idx on public.teacher_parent_notices (student_id, created_at desc);

create or replace function public.current_profile()
returns public.profiles
language sql
security definer
set search_path = public
stable
as $$
  select * from public.profiles where id = auth.uid() and active = true
$$;

create or replace function public.is_admin_for_school(target_school uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
      and p.active = true
      and p.school_id = target_school
  )
$$;

create or replace function public.can_read_student(target_student uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.students s
    join public.profiles p on p.id = auth.uid() and p.active = true
    where s.id = target_student
      and s.active = true
      and (
        (p.role = 'admin' and p.school_id = s.school_id)
        or exists (select 1 from public.parent_students ps where ps.parent_id = p.id and ps.student_id = s.id)
        or exists (select 1 from public.teacher_students ts where ts.teacher_id = p.id and ts.student_id = s.id)
      )
  )
$$;

create or replace function public.can_teacher_grade(target_student uuid, target_subject uuid, target_chapter uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles p
    join public.students s on s.id = target_student and s.school_id = p.school_id and s.active = true
    join public.chapters c on c.id = target_chapter and c.subject_id = target_subject and c.active = true
    where p.id = auth.uid()
      and p.role = 'teacher'
      and p.active = true
      and exists (select 1 from public.teacher_students ts where ts.teacher_id = p.id and ts.student_id = target_student)
      and exists (select 1 from public.teacher_subjects tsub where tsub.teacher_id = p.id and tsub.subject_id = target_subject)
  )
$$;

alter table public.schools enable row level security;
alter table public.profiles enable row level security;
alter table public.classes enable row level security;
alter table public.subjects enable row level security;
alter table public.students enable row level security;
alter table public.parent_students enable row level security;
alter table public.teacher_subjects enable row level security;
alter table public.teacher_students enable row level security;
alter table public.chapters enable row level security;
alter table public.grades enable row level security;
alter table public.daily_moods enable row level security;
alter table public.subject_parent_notices enable row level security;
alter table public.teacher_parent_notices enable row level security;
alter table public.student_support_profiles enable row level security;
alter table public.assessment_categories enable row level security;
alter table public.continuous_assessments enable row level security;
alter table public.pia_plans enable row level security;

drop policy if exists "profiles self and school admin read" on public.profiles;
create policy "profiles self and school admin read" on public.profiles
for select using (id = auth.uid() or public.is_admin_for_school(school_id));

drop policy if exists "admins manage same school profiles" on public.profiles;
create policy "admins manage same school profiles" on public.profiles
for all using (public.is_admin_for_school(school_id)) with check (public.is_admin_for_school(school_id));

drop policy if exists "same school classes read" on public.classes;
create policy "same school classes read" on public.classes
for select using (public.is_admin_for_school(school_id) or exists (select 1 from public.profiles p where p.id = auth.uid() and p.school_id = classes.school_id and p.active));

drop policy if exists "admins manage classes" on public.classes;
create policy "admins manage classes" on public.classes
for all using (public.is_admin_for_school(school_id)) with check (public.is_admin_for_school(school_id));

drop policy if exists "subjects are readable to signed in users" on public.subjects;
create policy "subjects are readable to signed in users" on public.subjects
for select using (auth.uid() is not null and active = true);

drop policy if exists "admins manage subjects" on public.subjects;
create policy "admins manage subjects" on public.subjects
for all using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin' and p.active))
with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin' and p.active));

drop policy if exists "authorized users read students" on public.students;
create policy "authorized users read students" on public.students
for select using (public.can_read_student(id));

drop policy if exists "admins manage same school students" on public.students;
create policy "admins manage same school students" on public.students
for all using (public.is_admin_for_school(school_id)) with check (public.is_admin_for_school(school_id));

drop policy if exists "authorized relation read parent_students" on public.parent_students;
create policy "authorized relation read parent_students" on public.parent_students
for select using (parent_id = auth.uid() or public.can_read_student(student_id));

drop policy if exists "admins manage parent_students" on public.parent_students;
create policy "admins manage parent_students" on public.parent_students
for all using (public.can_read_student(student_id) and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
with check (public.can_read_student(student_id) and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

drop policy if exists "teachers read own subject assignments" on public.teacher_subjects;
create policy "teachers read own subject assignments" on public.teacher_subjects
for select using (teacher_id = auth.uid() or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin' and p.school_id = (select school_id from public.profiles tp where tp.id = teacher_id)));

drop policy if exists "admins manage teacher_subjects" on public.teacher_subjects;
create policy "admins manage teacher_subjects" on public.teacher_subjects
for all using (exists (select 1 from public.profiles p join public.profiles tp on tp.id = teacher_id where p.id = auth.uid() and p.role = 'admin' and p.school_id = tp.school_id))
with check (exists (select 1 from public.profiles p join public.profiles tp on tp.id = teacher_id where p.id = auth.uid() and p.role = 'admin' and p.school_id = tp.school_id));

drop policy if exists "teachers read own student assignments" on public.teacher_students;
create policy "teachers read own student assignments" on public.teacher_students
for select using (teacher_id = auth.uid() or public.can_read_student(student_id));

drop policy if exists "admins manage teacher_students" on public.teacher_students;
create policy "admins manage teacher_students" on public.teacher_students
for all using (public.can_read_student(student_id) and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
with check (public.can_read_student(student_id) and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

drop policy if exists "chapters readable for assigned subjects" on public.chapters;
create policy "chapters readable for assigned subjects" on public.chapters
for select using (exists (select 1 from public.teacher_subjects ts where ts.teacher_id = auth.uid() and ts.subject_id = chapters.subject_id) or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('parent','admin') and p.active));

drop policy if exists "teachers create assigned chapters" on public.chapters;
create policy "teachers create assigned chapters" on public.chapters
for insert with check (exists (select 1 from public.teacher_subjects ts where ts.teacher_id = auth.uid() and ts.subject_id = chapters.subject_id));

drop policy if exists "authorized users read grades" on public.grades;
create policy "authorized users read grades" on public.grades
for select using (public.can_read_student(student_id));

drop policy if exists "authorized teachers insert grades" on public.grades;
create policy "authorized teachers insert grades" on public.grades
for insert with check (teacher_id = auth.uid() and public.can_teacher_grade(student_id, subject_id, chapter_id));

drop policy if exists "authorized teachers update own grades" on public.grades;
create policy "authorized teachers update own grades" on public.grades
for update using (teacher_id = auth.uid() and public.can_teacher_grade(student_id, subject_id, chapter_id))
with check (teacher_id = auth.uid() and public.can_teacher_grade(student_id, subject_id, chapter_id));

drop policy if exists "authorized users read moods" on public.daily_moods;
create policy "authorized users read moods" on public.daily_moods
for select using (public.can_read_student(student_id));

drop policy if exists "parents upsert own moods" on public.daily_moods;
create policy "parents upsert own moods" on public.daily_moods
for all using (parent_id = auth.uid() and exists (select 1 from public.parent_students ps where ps.parent_id = auth.uid() and ps.student_id = daily_moods.student_id))
with check (parent_id = auth.uid() and exists (select 1 from public.parent_students ps where ps.parent_id = auth.uid() and ps.student_id = daily_moods.student_id));

drop policy if exists "authorized read subject parent notices" on public.subject_parent_notices;
create policy "authorized read subject parent notices" on public.subject_parent_notices
for select using (
  parent_id = auth.uid()
  or (
    public.can_read_student(student_id)
    and exists (select 1 from public.teacher_subjects ts where ts.teacher_id = auth.uid() and ts.subject_id = subject_parent_notices.subject_id)
  )
);

drop policy if exists "parents insert subject parent notices" on public.subject_parent_notices;
create policy "parents insert subject parent notices" on public.subject_parent_notices
for insert with check (parent_id = auth.uid() and exists (select 1 from public.parent_students ps where ps.parent_id = auth.uid() and ps.student_id = subject_parent_notices.student_id));

drop policy if exists "authorized read teacher notices" on public.teacher_parent_notices;
create policy "authorized read teacher notices" on public.teacher_parent_notices
for select using (
  teacher_id = auth.uid()
  or exists (select 1 from public.parent_students ps where ps.parent_id = auth.uid() and ps.student_id = teacher_parent_notices.student_id)
  or public.can_read_student(student_id)
);

drop policy if exists "teachers insert notices for assigned students" on public.teacher_parent_notices;
create policy "teachers insert notices for assigned students" on public.teacher_parent_notices
for insert with check (teacher_id = auth.uid() and public.can_read_student(student_id));

drop policy if exists "authorized read support profiles" on public.student_support_profiles;
create policy "authorized read support profiles" on public.student_support_profiles
for select using (public.can_read_student(student_id));

drop policy if exists "admins manage support profiles" on public.student_support_profiles;
create policy "admins manage support profiles" on public.student_support_profiles
for all using (public.can_read_student(student_id) and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
with check (public.can_read_student(student_id) and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

drop policy if exists "assessment categories readable" on public.assessment_categories;
create policy "assessment categories readable" on public.assessment_categories
for select using (auth.uid() is not null);

drop policy if exists "authorized read continuous assessments" on public.continuous_assessments;
create policy "authorized read continuous assessments" on public.continuous_assessments
for select using (public.can_read_student(student_id));

drop policy if exists "teachers insert continuous assessments" on public.continuous_assessments;
create policy "teachers insert continuous assessments" on public.continuous_assessments
for insert with check (teacher_id = auth.uid() and public.can_teacher_grade(student_id, subject_id, (select c.id from public.chapters c where c.subject_id = continuous_assessments.subject_id limit 1)));

drop policy if exists "authorized read pia plans" on public.pia_plans;
create policy "authorized read pia plans" on public.pia_plans
for select using (public.can_read_student(student_id));

drop policy if exists "admins manage pia plans" on public.pia_plans;
create policy "admins manage pia plans" on public.pia_plans
for all using (public.can_read_student(student_id) and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
with check (public.can_read_student(student_id) and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

insert into public.subjects (name) values
  ('Matematikë'), ('Gjuhë shqipe'), ('Anglisht'), ('Shkencat natyrore'),
  ('Shoqëria dhe mjedisi'), ('TIK'), ('Art figurativ'), ('Edukatë muzikore'),
  ('Edukatë fizike'), ('Aftësi për jetë'), ('Histori'), ('Gjeografi')
on conflict (name) do nothing;

insert into public.assessment_categories (name, positive_label, description) values
  ('participation', 'Po merr pjesë gradualisht', 'Pjesëmarrja në aktivitete dhe diskutime.'),
  ('task_completion', 'Po zhvillon përfundimin e detyrave', 'Përfundimi i detyrave me mbështetje të përshtatur.'),
  ('communication', 'Po forcon komunikimin', 'Komunikimi i nevojave, pyetjeve dhe ideve.'),
  ('problem_solving', 'Po tregon përparim në zgjidhje problemesh', 'Strategji të përdorura për zgjidhje problemesh.'),
  ('support_strategies', 'Përfiton nga strategjitë mbështetëse', 'Përdorimi i përshtatjeve dhe mbështetjeve.')
on conflict (name) do nothing;
