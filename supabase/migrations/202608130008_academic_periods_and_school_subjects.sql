-- School academic periods, period-linked assessment records, and safe subject management.

create table if not exists public.academic_periods (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  school_year text not null check (char_length(school_year) between 4 and 20),
  starts_on date not null,
  ends_on date not null,
  status text not null default 'planned' check (status in ('planned', 'active', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  unique (school_id, school_year, name)
);

create unique index if not exists academic_periods_one_active_school_idx
  on public.academic_periods (school_id) where status = 'active';
create index if not exists academic_periods_school_year_idx
  on public.academic_periods (school_id, school_year, starts_on);

insert into public.academic_periods (school_id, name, school_year, starts_on, ends_on, status)
select
  school.id,
  'Gjysmëvjetori I',
  coalesce(
    (select class.school_year from public.classes class where class.school_id = school.id and class.active order by class.created_at desc limit 1),
    extract(year from current_date)::int::text || '/' || (extract(year from current_date)::int + 1)::text
  ),
  current_date,
  current_date + 180,
  'active'
from public.schools school
where not exists (select 1 from public.academic_periods period where period.school_id = school.id);

alter table public.grades add column if not exists academic_period_id uuid references public.academic_periods(id);
alter table public.continuous_assessments add column if not exists academic_period_id uuid references public.academic_periods(id);

update public.grades grade
set academic_period_id = period.id
from public.students student
join public.academic_periods period on period.school_id = student.school_id and period.status = 'active'
where student.id = grade.student_id and grade.academic_period_id is null;

update public.continuous_assessments assessment
set academic_period_id = period.id
from public.students student
join public.academic_periods period on period.school_id = student.school_id and period.status = 'active'
where student.id = assessment.student_id and assessment.academic_period_id is null;

alter table public.grades alter column academic_period_id set not null;
alter table public.continuous_assessments alter column academic_period_id set not null;

create index if not exists grades_period_student_subject_idx
  on public.grades (academic_period_id, student_id, subject_id, graded_at desc);
create index if not exists continuous_assessments_period_idx
  on public.continuous_assessments (academic_period_id, student_id, subject_id, created_at desc);

create table if not exists public.final_grades (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id),
  subject_id uuid not null references public.subjects(id),
  academic_period_id uuid not null references public.academic_periods(id),
  grade smallint not null check (grade between 1 and 5),
  parent_message text check (char_length(parent_message) <= 1200),
  published_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, subject_id, academic_period_id)
);

create index if not exists final_grades_period_student_idx
  on public.final_grades (academic_period_id, student_id, subject_id);

create or replace function public.can_teacher_use_academic_period(target_student uuid, target_period uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.students student
    join public.profiles teacher
      on teacher.id = auth.uid()
     and teacher.role = 'teacher'
     and teacher.active = true
     and teacher.school_id = student.school_id
    join public.academic_periods period
      on period.id = target_period
     and period.school_id = student.school_id
     and period.school_year = coalesce(
       (select class.school_year from public.classes class where class.id = student.class_id),
       period.school_year
     )
     and period.status = 'active'
    where student.id = target_student and student.active = true
  )
$$;

alter table public.academic_periods enable row level security;
alter table public.final_grades enable row level security;

drop policy if exists "school members read academic periods" on public.academic_periods;
create policy "school members read academic periods" on public.academic_periods
for select using (
  exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid() and profile.active = true and profile.school_id = academic_periods.school_id
  )
);

drop policy if exists "admins manage school academic periods" on public.academic_periods;
create policy "admins manage school academic periods" on public.academic_periods
for all using (public.is_admin_for_school(school_id))
with check (public.is_admin_for_school(school_id));

drop policy if exists "authorized users read final grades" on public.final_grades;
create policy "authorized users read final grades" on public.final_grades
for select using (public.can_read_student(student_id));

drop policy if exists "teachers publish final grades in active period" on public.final_grades;
create policy "teachers publish final grades in active period" on public.final_grades
for insert with check (
  teacher_id = auth.uid()
  and public.can_teacher_assess(student_id, subject_id)
  and public.can_teacher_use_academic_period(student_id, academic_period_id)
);

drop policy if exists "teachers update own final grades in active period" on public.final_grades;
create policy "teachers update own final grades in active period" on public.final_grades
for update using (
  teacher_id = auth.uid()
  and public.can_teacher_use_academic_period(student_id, academic_period_id)
) with check (
  teacher_id = auth.uid()
  and public.can_teacher_assess(student_id, subject_id)
  and public.can_teacher_use_academic_period(student_id, academic_period_id)
);

drop policy if exists "authorized teachers insert grades" on public.grades;
create policy "authorized teachers insert grades" on public.grades
for insert with check (
  teacher_id = auth.uid()
  and public.can_teacher_grade(student_id, subject_id, chapter_id)
  and public.can_teacher_use_academic_period(student_id, academic_period_id)
);

drop policy if exists "authorized teachers update own grades" on public.grades;
create policy "authorized teachers update own grades" on public.grades
for update using (
  teacher_id = auth.uid()
  and public.can_teacher_grade(student_id, subject_id, chapter_id)
  and public.can_teacher_use_academic_period(student_id, academic_period_id)
) with check (
  teacher_id = auth.uid()
  and public.can_teacher_grade(student_id, subject_id, chapter_id)
  and public.can_teacher_use_academic_period(student_id, academic_period_id)
);

drop policy if exists "teachers insert continuous assessments" on public.continuous_assessments;
create policy "teachers insert continuous assessments" on public.continuous_assessments
for insert with check (
  teacher_id = auth.uid()
  and public.can_teacher_assess(student_id, subject_id)
  and public.can_teacher_use_academic_period(student_id, academic_period_id)
);

create or replace function public.admin_save_academic_period(
  period_id uuid,
  target_school_id uuid,
  period_name text,
  period_school_year text,
  period_starts_on date,
  period_ends_on date,
  period_status text
)
returns public.academic_periods
language plpgsql
security definer
set search_path = public
as $$
declare
  saved public.academic_periods;
begin
  if not public.is_admin_for_school(target_school_id) then raise exception 'FORBIDDEN'; end if;
  if period_status not in ('planned', 'active', 'closed') then raise exception 'INVALID_STATUS'; end if;
  if period_ends_on < period_starts_on then raise exception 'INVALID_DATES'; end if;
  if char_length(trim(period_name)) < 2 or char_length(trim(period_school_year)) < 4 then raise exception 'INVALID_INPUT'; end if;

  if period_id is not null and exists (
    select 1 from public.academic_periods period
    where period.id = period_id and period.school_id = target_school_id and period.status = 'closed'
  ) then
    raise exception 'CLOSED_PERIOD_IMMUTABLE';
  end if;

  if period_status = 'active' then
    update public.academic_periods
    set status = 'closed', updated_at = now()
    where school_id = target_school_id and status = 'active' and id is distinct from period_id;
  end if;

  if period_id is null then
    insert into public.academic_periods (school_id, name, school_year, starts_on, ends_on, status)
    values (target_school_id, trim(period_name), trim(period_school_year), period_starts_on, period_ends_on, period_status)
    returning * into saved;
  else
    update public.academic_periods
    set name = trim(period_name), school_year = trim(period_school_year), starts_on = period_starts_on,
        ends_on = period_ends_on, status = period_status, updated_at = now()
    where id = period_id and school_id = target_school_id
    returning * into saved;
    if saved.id is null then raise exception 'PERIOD_NOT_FOUND'; end if;
  end if;
  return saved;
end
$$;

create unique index if not exists subjects_name_case_insensitive_idx on public.subjects (lower(name));

create or replace function public.admin_add_school_subject(target_school_id uuid, subject_name text)
returns public.school_subjects
language plpgsql
security definer
set search_path = public
as $$
declare
  target_subject uuid;
  saved public.school_subjects;
begin
  if not public.is_admin_for_school(target_school_id) then raise exception 'FORBIDDEN'; end if;
  subject_name := regexp_replace(trim(subject_name), '\s+', ' ', 'g');
  if char_length(subject_name) < 2 or char_length(subject_name) > 100 then raise exception 'INVALID_SUBJECT_NAME'; end if;

  select id into target_subject from public.subjects where lower(name) = lower(subject_name);
  if target_subject is null then
    insert into public.subjects (name, active) values (subject_name, true) returning id into target_subject;
  end if;

  insert into public.school_subjects (school_id, subject_id, active)
  values (target_school_id, target_subject, true)
  on conflict (school_id, subject_id) do update set active = true
  returning * into saved;
  return saved;
end
$$;

drop policy if exists "admins manage subjects" on public.subjects;

grant select, insert, update, delete on public.academic_periods to authenticated;
grant select, insert, update on public.final_grades to authenticated;
grant execute on function public.can_teacher_use_academic_period(uuid, uuid) to authenticated;
grant execute on function public.admin_save_academic_period(uuid, uuid, text, text, date, date, text) to authenticated;
grant execute on function public.admin_add_school_subject(uuid, text) to authenticated;
