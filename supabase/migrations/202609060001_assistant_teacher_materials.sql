-- Allow assistant teachers to use the same material publishing workflow as main teachers,
-- scoped only to students assigned to that assistant.

create or replace function public.publish_teacher_material(
  target_subject uuid,
  target_class uuid,
  target_audience text,
  material_title text,
  material_description text,
  notify_parent boolean,
  target_expires_at timestamptz,
  recipient_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_school uuid;
  caller_is_assistant boolean;
  created_material_id uuid;
begin
  select school_id, coalesce(is_assistant_teacher, false)
    into caller_school, caller_is_assistant
  from public.profiles
  where id = auth.uid()
    and role = 'teacher'
    and active = true;

  if caller_school is null then raise exception 'TEACHER_NOT_AUTHORIZED'; end if;

  if target_audience not in ('class', 'subject', 'selected') then raise exception 'INVALID_AUDIENCE'; end if;
  if cardinality(recipient_ids) is null or cardinality(recipient_ids) = 0 then raise exception 'RECIPIENT_REQUIRED'; end if;
  if not exists (
    select 1
    from public.school_subjects enabled_subject
    where enabled_subject.school_id = caller_school
      and enabled_subject.subject_id = target_subject
      and enabled_subject.active = true
  ) then raise exception 'SUBJECT_NOT_ACTIVE'; end if;

  if caller_is_assistant then
    if exists (
      select 1
      from unnest(recipient_ids) as recipient(student_id)
      join public.students student on student.id = recipient.student_id
      where student.school_id is distinct from caller_school
        or not student.active
        or not exists (
          select 1
          from public.assistant_teacher_students assignment
          where assignment.assistant_teacher_id = auth.uid()
            and assignment.student_id = recipient.student_id
        )
    ) then raise exception 'STUDENT_NOT_ASSIGNED'; end if;

    if target_audience = 'class' then
      if target_class is null or not exists (
        select 1
        from public.classes class
        where class.id = target_class
          and class.school_id = caller_school
          and class.active = true
      ) then raise exception 'CLASS_NOT_ASSIGNED'; end if;

      if exists (
        select 1
        from unnest(recipient_ids) as recipient(student_id)
        join public.students student on student.id = recipient.student_id
        where student.class_id is distinct from target_class
      ) then raise exception 'INVALID_CLASS_RECIPIENT'; end if;
    end if;
  else
    if not (
      exists (
        select 1 from public.teacher_subjects assignment
        where assignment.teacher_id = auth.uid() and assignment.subject_id = target_subject
      )
      or exists (
        select 1 from public.teacher_classes assignment
        where assignment.teacher_id = auth.uid() and assignment.subject_id = target_subject
      )
    ) then raise exception 'SUBJECT_NOT_ASSIGNED'; end if;

    if target_audience = 'class' then
      if target_class is null or not exists (
        select 1
        from public.teacher_classes assignment
        join public.classes class on class.id = assignment.class_id
        where assignment.teacher_id = auth.uid()
          and assignment.class_id = target_class
          and assignment.subject_id = target_subject
          and class.school_id = caller_school
          and class.active = true
      ) then raise exception 'CLASS_NOT_ASSIGNED'; end if;

      if exists (
        select 1
        from unnest(recipient_ids) as recipient(student_id)
        join public.students student on student.id = recipient.student_id
        where student.class_id is distinct from target_class
          or student.school_id is distinct from caller_school
          or not student.active
      ) then raise exception 'INVALID_CLASS_RECIPIENT'; end if;
    end if;

    if exists (
      select 1
      from unnest(recipient_ids) as recipient(student_id)
      where not public.can_teacher_access_student_for_subject(recipient.student_id, target_subject)
    ) then raise exception 'STUDENT_NOT_ASSIGNED'; end if;
  end if;

  insert into public.class_materials (
    school_id, teacher_id, subject_id, class_id, audience, title, description,
    notify_in_app, expires_at
  ) values (
    caller_school, auth.uid(), target_subject,
    case when target_audience = 'class' then target_class else null end,
    target_audience, trim(material_title), trim(coalesce(material_description, '')),
    coalesce(notify_parent, true), target_expires_at
  ) returning id into created_material_id;

  insert into public.class_material_recipients (material_id, student_id)
  select created_material_id, recipient.student_id
  from (select distinct unnest(recipient_ids) as student_id) recipient;

  return created_material_id;
end
$$;

grant execute on function public.publish_teacher_material(uuid, uuid, text, text, text, boolean, timestamptz, uuid[]) to authenticated;
