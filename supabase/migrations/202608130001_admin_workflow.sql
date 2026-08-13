-- School administrator workflow and authorization hardening.

create table if not exists public.school_subjects (
  school_id uuid not null references public.schools(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (school_id, subject_id)
);

create table if not exists public.teacher_classes (
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (teacher_id, class_id)
);

create index if not exists teacher_classes_class_idx on public.teacher_classes (class_id);
create index if not exists school_subjects_subject_idx on public.school_subjects (subject_id);

insert into public.school_subjects (school_id, subject_id)
select schools.id, subjects.id
from public.schools
cross join public.subjects
on conflict (school_id, subject_id) do nothing;

create or replace function public.is_admin_for_student(target_student uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.students student
    join public.profiles admin
      on admin.id = auth.uid()
     and admin.role = 'admin'
     and admin.active = true
     and admin.school_id = student.school_id
    where student.id = target_student
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
    from public.students student
    join public.profiles profile on profile.id = auth.uid() and profile.active = true
    where student.id = target_student
      and student.active = true
      and (
        (profile.role = 'admin' and profile.school_id = student.school_id)
        or exists (
          select 1 from public.parent_students relation
          where relation.parent_id = profile.id and relation.student_id = student.id
        )
        or exists (
          select 1 from public.teacher_students relation
          where relation.teacher_id = profile.id and relation.student_id = student.id
        )
        or exists (
          select 1 from public.teacher_classes relation
          where relation.teacher_id = profile.id and relation.class_id = student.class_id
        )
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
    from public.profiles teacher
    join public.students student
      on student.id = target_student
     and student.school_id = teacher.school_id
     and student.active = true
    join public.chapters chapter
      on chapter.id = target_chapter
     and chapter.subject_id = target_subject
     and chapter.active = true
    where teacher.id = auth.uid()
      and teacher.role = 'teacher'
      and teacher.active = true
      and (
        exists (
          select 1 from public.teacher_students relation
          where relation.teacher_id = teacher.id and relation.student_id = student.id
        )
        or exists (
          select 1 from public.teacher_classes relation
          where relation.teacher_id = teacher.id and relation.class_id = student.class_id
        )
      )
      and exists (
        select 1 from public.teacher_subjects assignment
        where assignment.teacher_id = teacher.id and assignment.subject_id = target_subject
      )
      and exists (
        select 1 from public.school_subjects enabled_subject
        where enabled_subject.school_id = teacher.school_id
          and enabled_subject.subject_id = target_subject
          and enabled_subject.active = true
      )
  )
$$;

create or replace function public.can_teacher_assess(target_student uuid, target_subject uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles teacher
    join public.students student
      on student.id = target_student
     and student.school_id = teacher.school_id
     and student.active = true
    where teacher.id = auth.uid()
      and teacher.role = 'teacher'
      and teacher.active = true
      and (
        exists (
          select 1 from public.teacher_students relation
          where relation.teacher_id = teacher.id and relation.student_id = student.id
        )
        or exists (
          select 1 from public.teacher_classes relation
          where relation.teacher_id = teacher.id and relation.class_id = student.class_id
        )
      )
      and exists (
        select 1 from public.teacher_subjects assignment
        where assignment.teacher_id = teacher.id and assignment.subject_id = target_subject
      )
      and exists (
        select 1 from public.school_subjects enabled_subject
        where enabled_subject.school_id = teacher.school_id
          and enabled_subject.subject_id = target_subject
          and enabled_subject.active = true
      )
  )
$$;

alter table public.school_subjects enable row level security;
alter table public.teacher_classes enable row level security;

drop policy if exists "same school reads school" on public.schools;
create policy "same school reads school" on public.schools
for select using (
  exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid() and profile.active = true and profile.school_id = schools.id
  )
);

drop policy if exists "admins update own school" on public.schools;
create policy "admins update own school" on public.schools
for update using (public.is_admin_for_school(id))
with check (public.is_admin_for_school(id));

drop policy if exists "admins manage same school profiles" on public.profiles;
drop policy if exists "admins update same school members" on public.profiles;
create policy "admins update same school members" on public.profiles
for update using (
  public.is_admin_for_school(school_id) and role in ('teacher', 'parent')
)
with check (
  public.is_admin_for_school(school_id) and role in ('teacher', 'parent')
);

drop policy if exists "admins manage subjects" on public.subjects;

drop policy if exists "admins manage same school students" on public.students;
create policy "admins manage same school students" on public.students
for all using (public.is_admin_for_school(school_id))
with check (
  public.is_admin_for_school(school_id)
  and (
    class_id is null
    or exists (
      select 1 from public.classes class
      where class.id = students.class_id and class.school_id = students.school_id
    )
  )
);

drop policy if exists "admins manage parent_students" on public.parent_students;
create policy "admins manage parent_students" on public.parent_students
for all using (
  public.is_admin_for_student(student_id)
  and exists (
    select 1
    from public.profiles parent
    join public.students student on student.id = parent_students.student_id
    where parent.id = parent_students.parent_id
      and parent.role = 'parent'
      and parent.school_id = student.school_id
  )
)
with check (
  public.is_admin_for_student(student_id)
  and exists (
    select 1
    from public.profiles parent
    join public.students student on student.id = parent_students.student_id
    where parent.id = parent_students.parent_id
      and parent.role = 'parent'
      and parent.school_id = student.school_id
  )
);

drop policy if exists "admins manage teacher_subjects" on public.teacher_subjects;
create policy "admins manage teacher_subjects" on public.teacher_subjects
for all using (
  exists (
    select 1
    from public.profiles admin
    join public.profiles teacher on teacher.id = teacher_subjects.teacher_id
    where admin.id = auth.uid()
      and admin.role = 'admin'
      and admin.active = true
      and teacher.role = 'teacher'
      and teacher.school_id = admin.school_id
  )
)
with check (
  exists (
    select 1
    from public.profiles admin
    join public.profiles teacher on teacher.id = teacher_subjects.teacher_id
    join public.school_subjects enabled_subject
      on enabled_subject.school_id = admin.school_id
     and enabled_subject.subject_id = teacher_subjects.subject_id
     and enabled_subject.active = true
    where admin.id = auth.uid()
      and admin.role = 'admin'
      and admin.active = true
      and teacher.role = 'teacher'
      and teacher.school_id = admin.school_id
  )
);

drop policy if exists "admins manage teacher_students" on public.teacher_students;
create policy "admins manage teacher_students" on public.teacher_students
for all using (
  public.is_admin_for_student(student_id)
  and exists (
    select 1
    from public.profiles admin
    join public.profiles teacher on teacher.id = teacher_students.teacher_id
    where admin.id = auth.uid()
      and admin.role = 'admin'
      and admin.active = true
      and teacher.role = 'teacher'
      and teacher.school_id = admin.school_id
  )
)
with check (
  public.is_admin_for_student(student_id)
  and exists (
    select 1
    from public.profiles admin
    join public.profiles teacher on teacher.id = teacher_students.teacher_id
    where admin.id = auth.uid()
      and admin.role = 'admin'
      and admin.active = true
      and teacher.role = 'teacher'
      and teacher.school_id = admin.school_id
  )
);

drop policy if exists "school members read enabled subjects" on public.school_subjects;
create policy "school members read enabled subjects" on public.school_subjects
for select using (
  exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid() and profile.active = true and profile.school_id = school_subjects.school_id
  )
);

drop policy if exists "admins manage school subjects" on public.school_subjects;
create policy "admins manage school subjects" on public.school_subjects
for all using (public.is_admin_for_school(school_id))
with check (public.is_admin_for_school(school_id));

drop policy if exists "teachers read own class assignments" on public.teacher_classes;
create policy "teachers read own class assignments" on public.teacher_classes
for select using (
  teacher_id = auth.uid()
  or exists (
    select 1
    from public.profiles admin
    join public.profiles teacher on teacher.id = teacher_classes.teacher_id
    join public.classes class on class.id = teacher_classes.class_id
    where admin.id = auth.uid()
      and admin.role = 'admin'
      and admin.active = true
      and teacher.school_id = admin.school_id
      and class.school_id = admin.school_id
  )
);

drop policy if exists "admins manage teacher classes" on public.teacher_classes;
create policy "admins manage teacher classes" on public.teacher_classes
for all using (
  exists (
    select 1
    from public.profiles admin
    join public.profiles teacher on teacher.id = teacher_classes.teacher_id
    join public.classes class on class.id = teacher_classes.class_id
    where admin.id = auth.uid()
      and admin.role = 'admin'
      and admin.active = true
      and teacher.role = 'teacher'
      and teacher.school_id = admin.school_id
      and class.school_id = admin.school_id
  )
)
with check (
  exists (
    select 1
    from public.profiles admin
    join public.profiles teacher on teacher.id = teacher_classes.teacher_id
    join public.classes class on class.id = teacher_classes.class_id
    where admin.id = auth.uid()
      and admin.role = 'admin'
      and admin.active = true
      and teacher.role = 'teacher'
      and teacher.school_id = admin.school_id
      and class.school_id = admin.school_id
  )
);

grant select, insert, update, delete on public.school_subjects to authenticated;
grant select, insert, update, delete on public.teacher_classes to authenticated;
grant execute on function public.is_admin_for_student(uuid) to authenticated;

-- Repair text inserted by early Windows-1252 seed files.
update public.schools set name = 'Shkolla Demo Prishtinë'
where name = convert_from(convert_to('Shkolla Demo Prishtinë', 'UTF8'), 'WIN1252');
update public.schools set address = 'Adresë sintetike'
where address = convert_from(convert_to('Adresë sintetike', 'UTF8'), 'WIN1252');
update public.profiles set last_name = 'Mësimi'
where last_name = convert_from(convert_to('Mësimi', 'UTF8'), 'WIN1252');
update public.profiles set last_name = 'Një'
where last_name = convert_from(convert_to('Një', 'UTF8'), 'WIN1252');
update public.subjects set name = 'Matematikë'
where name = convert_from(convert_to('Matematikë', 'UTF8'), 'WIN1252');
update public.subjects set name = 'Gjuhë shqipe'
where name = convert_from(convert_to('Gjuhë shqipe', 'UTF8'), 'WIN1252');
update public.subjects set name = 'Shoqëria dhe mjedisi'
where name = convert_from(convert_to('Shoqëria dhe mjedisi', 'UTF8'), 'WIN1252');
update public.subjects set name = 'Edukatë muzikore'
where name = convert_from(convert_to('Edukatë muzikore', 'UTF8'), 'WIN1252');
update public.subjects set name = 'Edukatë fizike'
where name = convert_from(convert_to('Edukatë fizike', 'UTF8'), 'WIN1252');
update public.subjects set name = 'Aftësi për jetë'
where name = convert_from(convert_to('Aftësi për jetë', 'UTF8'), 'WIN1252');
