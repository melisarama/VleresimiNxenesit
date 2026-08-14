-- Keep teacher capabilities consistent for direct student and whole-class assignments.

drop policy if exists "teachers read own subject assignments" on public.teacher_subjects;
create policy "teachers read own subject assignments" on public.teacher_subjects
for select using (
  (
    teacher_id = auth.uid()
    and exists (
      select 1
      from public.profiles teacher
      join public.school_subjects enabled_subject
        on enabled_subject.school_id = teacher.school_id
       and enabled_subject.subject_id = teacher_subjects.subject_id
       and enabled_subject.active = true
      where teacher.id = auth.uid() and teacher.role = 'teacher' and teacher.active = true
    )
  )
  or exists (
    select 1
    from public.profiles admin
    join public.profiles teacher on teacher.id = teacher_subjects.teacher_id
    where admin.id = auth.uid()
      and admin.role = 'admin'
      and admin.active = true
      and admin.school_id = teacher.school_id
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
      and teacher.active = true
  )
);

drop policy if exists "teachers insert notices for assigned students" on public.teacher_parent_notices;
create policy "teachers insert notices for assigned students" on public.teacher_parent_notices
for insert with check (
  teacher_id = auth.uid()
  and exists (
    select 1 from public.profiles teacher
    where teacher.id = auth.uid() and teacher.role = 'teacher' and teacher.active = true
  )
  and exists (
    select 1
    from public.students student
    where student.id = teacher_parent_notices.student_id
      and student.active = true
      and (
        exists (
          select 1 from public.teacher_students assignment
          where assignment.teacher_id = auth.uid() and assignment.student_id = student.id
        )
        or exists (
          select 1 from public.teacher_classes assignment
          where assignment.teacher_id = auth.uid() and assignment.class_id = student.class_id
        )
      )
  )
);

