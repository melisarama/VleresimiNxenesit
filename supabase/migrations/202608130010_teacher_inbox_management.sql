-- Let assigned teachers manage the lifecycle of messages parents send to them.

alter table public.subject_parent_notices
  add column if not exists read_at timestamptz;

create index if not exists subject_parent_notices_teacher_inbox_idx
  on public.subject_parent_notices (subject_id, read_at, created_at desc);

create or replace function public.can_teacher_manage_parent_notice(target_student uuid, target_subject uuid)
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
      and exists (
        select 1 from public.teacher_subjects assignment
        where assignment.teacher_id = teacher.id and assignment.subject_id = target_subject
      )
      and (
        exists (
          select 1 from public.teacher_students assignment
          where assignment.teacher_id = teacher.id and assignment.student_id = student.id
        )
        or exists (
          select 1 from public.teacher_classes assignment
          where assignment.teacher_id = teacher.id and assignment.class_id = student.class_id
        )
      )
  )
$$;

drop policy if exists "authorized read subject parent notices" on public.subject_parent_notices;
create policy "authorized read subject parent notices" on public.subject_parent_notices
for select using (
  parent_id = auth.uid()
  or public.can_read_student(student_id)
  or public.can_teacher_manage_parent_notice(student_id, subject_id)
);

drop policy if exists "assigned teachers mark parent notices read" on public.subject_parent_notices;
create policy "assigned teachers mark parent notices read" on public.subject_parent_notices
for update using (public.can_teacher_manage_parent_notice(student_id, subject_id))
with check (public.can_teacher_manage_parent_notice(student_id, subject_id));

drop policy if exists "assigned teachers delete parent notices" on public.subject_parent_notices;
create policy "assigned teachers delete parent notices" on public.subject_parent_notices
for delete using (public.can_teacher_manage_parent_notice(student_id, subject_id));

grant update, delete on public.subject_parent_notices to authenticated;
grant execute on function public.can_teacher_manage_parent_notice(uuid, uuid) to authenticated;

