alter table public.schools
add column if not exists lower_primary_subject_ids uuid[] not null default '{}'::uuid[];

with default_lower_primary_subjects as (
  select
    school.id as school_id,
    array_agg(subject.id order by subject.name) as subject_ids
  from public.schools school
  join public.subjects subject
    on subject.name = any (array[
      'Edukatë fizike',
      'Matematikë',
      'Gjuhë shqipe',
      'Edukatë muzikore',
      'Anglisht'
    ]::text[])
  join public.school_subjects enabled_subject
    on enabled_subject.school_id = school.id
   and enabled_subject.subject_id = subject.id
   and enabled_subject.active = true
  group by school.id
)
update public.schools school
set lower_primary_subject_ids = default_lower_primary_subjects.subject_ids
from default_lower_primary_subjects
where school.id = default_lower_primary_subjects.school_id
  and coalesce(cardinality(school.lower_primary_subject_ids), 0) = 0;

drop policy if exists "chapters readable for assigned subjects" on public.chapters;
create policy "chapters readable for assigned subjects" on public.chapters
for select using (
  exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and profile.role in ('parent', 'admin')
      and profile.active = true
  )
  or exists (
    select 1
    from public.teacher_subjects assignment
    join public.profiles teacher on teacher.id = assignment.teacher_id
    join public.school_subjects enabled_subject
      on enabled_subject.school_id = teacher.school_id
     and enabled_subject.subject_id = assignment.subject_id
     and enabled_subject.active = true
    where assignment.teacher_id = auth.uid()
      and assignment.subject_id = chapters.subject_id
      and teacher.role = 'teacher'
      and teacher.active = true
      and coalesce(teacher.is_assistant_teacher, false) = false
  )
  or exists (
    select 1
    from public.teacher_classes assignment
    join public.profiles teacher on teacher.id = assignment.teacher_id
    join public.classes class on class.id = assignment.class_id
    join public.school_subjects enabled_subject
      on enabled_subject.school_id = teacher.school_id
     and enabled_subject.subject_id = assignment.subject_id
     and enabled_subject.active = true
    where assignment.teacher_id = auth.uid()
      and assignment.subject_id = chapters.subject_id
      and teacher.role = 'teacher'
      and teacher.active = true
      and coalesce(teacher.is_assistant_teacher, false) = false
      and class.active = true
  )
);

drop policy if exists "teachers create assigned chapters" on public.chapters;
create policy "teachers create assigned chapters" on public.chapters
for insert with check (
  exists (
    select 1
    from public.teacher_subjects assignment
    join public.profiles teacher on teacher.id = assignment.teacher_id
    join public.school_subjects enabled_subject
      on enabled_subject.school_id = teacher.school_id
     and enabled_subject.subject_id = assignment.subject_id
     and enabled_subject.active = true
    where assignment.teacher_id = auth.uid()
      and assignment.subject_id = chapters.subject_id
      and teacher.role = 'teacher'
      and teacher.active = true
      and coalesce(teacher.is_assistant_teacher, false) = false
  )
  or exists (
    select 1
    from public.teacher_classes assignment
    join public.profiles teacher on teacher.id = assignment.teacher_id
    join public.classes class on class.id = assignment.class_id
    join public.school_subjects enabled_subject
      on enabled_subject.school_id = teacher.school_id
     and enabled_subject.subject_id = assignment.subject_id
     and enabled_subject.active = true
    where assignment.teacher_id = auth.uid()
      and assignment.subject_id = chapters.subject_id
      and teacher.role = 'teacher'
      and teacher.active = true
      and coalesce(teacher.is_assistant_teacher, false) = false
      and class.active = true
  )
);
