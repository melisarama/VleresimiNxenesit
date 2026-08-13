-- Final grades may be published with incomplete chapter coverage, but require
-- an exact student-name confirmation to prevent accidental submissions.

revoke execute on function public.save_final_grade(uuid, uuid, uuid, smallint, text) from authenticated;
drop function public.save_final_grade(uuid, uuid, uuid, smallint, text);

create function public.save_final_grade(
  target_student uuid,
  target_subject uuid,
  target_period uuid,
  final_score smallint,
  final_parent_message text,
  confirmation_name text
)
returns public.final_grades
language plpgsql
security definer
set search_path = public
as $$
declare
  saved public.final_grades;
  expected_name text;
begin
  if final_score < 1 or final_score > 5 then raise exception 'INVALID_SCORE'; end if;
  if not public.can_teacher_assess(target_student, target_subject) then raise exception 'FORBIDDEN'; end if;
  if not public.can_teacher_use_academic_period(target_student, target_period) then raise exception 'PERIOD_NOT_ACTIVE'; end if;

  select lower(regexp_replace(trim(student.first_name || ' ' || student.last_name), '\s+', ' ', 'g'))
  into expected_name
  from public.students student
  where student.id = target_student;

  if expected_name is null
    or confirmation_name is null
    or lower(regexp_replace(trim(confirmation_name), '\s+', ' ', 'g')) <> expected_name
  then
    raise exception 'STUDENT_NAME_MISMATCH';
  end if;

  insert into public.final_grades (
    student_id, teacher_id, subject_id, academic_period_id, grade, parent_message, published_at, updated_at
  ) values (
    target_student, auth.uid(), target_subject, target_period, final_score,
    nullif(trim(final_parent_message), ''), now(), now()
  )
  on conflict (student_id, subject_id, academic_period_id)
  do update set
    teacher_id = auth.uid(),
    grade = excluded.grade,
    parent_message = excluded.parent_message,
    published_at = now(),
    updated_at = now()
  returning * into saved;

  return saved;
end
$$;

grant execute on function public.save_final_grade(uuid, uuid, uuid, smallint, text, text) to authenticated;
