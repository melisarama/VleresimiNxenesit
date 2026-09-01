create or replace function public.create_pia_update_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  objective public.pia_objectives;
  student_name text;
  assistant_name text;
begin
  select * into objective
  from public.pia_objectives
  where id = new.objective_id;

  select trim(first_name || ' ' || last_name)
    into student_name
  from public.students
  where id = new.student_id;

  select trim(first_name || ' ' || last_name)
    into assistant_name
  from public.profiles
  where id = new.assistant_teacher_id;

  insert into public.user_notifications (recipient_id, student_id, kind, title, body, entity_id, created_at)
  select
    parent_link.parent_id,
    new.student_id,
    'pia',
    'PIA: ' || objective.title,
    coalesce(nullif(assistant_name, ''), 'Asistenti') || ' raportoi statusin e objektives per ' || coalesce(student_name, 'nxenesin') ||
      ' me status ' || new.rating || '/5' ||
      case when trim(coalesce(new.comment, '')) = '' then '' else ' · ' || trim(new.comment) end,
    new.id,
    new.created_at
  from public.parent_students parent_link
  where parent_link.student_id = new.student_id
  on conflict (recipient_id, kind, entity_id) do update
  set title = excluded.title,
      body = excluded.body,
      read_at = null,
      created_at = excluded.created_at;

  return new;
end
$$;
