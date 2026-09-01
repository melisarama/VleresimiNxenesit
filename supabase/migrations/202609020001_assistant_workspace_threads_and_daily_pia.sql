-- Extend assistant communications and simplify PIA updates to one entry per school day.

alter table public.communication_threads
  add column if not exists assistant_teacher_id uuid references public.profiles(id) on delete cascade,
  add column if not exists assistant_archived_at timestamptz;

alter table public.communication_threads
  alter column parent_id drop not null,
  alter column teacher_id drop not null,
  alter column subject_id drop not null;

alter table public.communication_threads
  drop constraint if exists communication_threads_participants_check;

alter table public.communication_threads
  add constraint communication_threads_participants_check
  check (
    (
      assistant_teacher_id is null
      and parent_id is not null
      and teacher_id is not null
      and subject_id is not null
    )
    or (
      assistant_teacher_id is not null
      and (
        (parent_id is not null and teacher_id is null and subject_id is null)
        or (parent_id is null and teacher_id is not null and subject_id is not null)
      )
    )
  );

create index if not exists communication_threads_assistant_idx
  on public.communication_threads (assistant_teacher_id, updated_at desc);

create or replace function public.can_use_communication_thread(target_thread uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.communication_threads thread
    join public.profiles viewer on viewer.id = auth.uid() and viewer.active = true
    where thread.id = target_thread
      and (
        thread.parent_id = viewer.id
        or thread.teacher_id = viewer.id
        or thread.assistant_teacher_id = viewer.id
      )
  )
$$;

drop policy if exists "participants read communication threads" on public.communication_threads;
create policy "participants read communication threads" on public.communication_threads
for select using (
  parent_id = auth.uid()
  or teacher_id = auth.uid()
  or assistant_teacher_id = auth.uid()
);

create or replace function public.assistant_message_options(target_student uuid)
returns table (
  recipient_role text,
  recipient_id uuid,
  recipient_name text,
  subject_id uuid,
  subject_name text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_assistant_teacher_for_student(target_student) then
    raise exception 'FORBIDDEN';
  end if;

  return query
  with student_scope as (
    select student.id, student.school_id, student.class_id
    from public.students student
    where student.id = target_student
      and student.active = true
  ),
  class_subject_teachers as (
    select assignment.teacher_id, assignment.subject_id
    from student_scope student
    join public.teacher_classes assignment
      on assignment.class_id = student.class_id
  ),
  direct_subject_teachers as (
    select assignment.teacher_id, subject_assignment.subject_id
    from public.teacher_students assignment
    join public.teacher_subjects subject_assignment
      on subject_assignment.teacher_id = assignment.teacher_id
    where assignment.student_id = target_student
  ),
  teacher_rows as (
    select distinct
      'teacher'::text as recipient_role,
      teacher.id as recipient_id,
      trim(teacher.first_name || ' ' || teacher.last_name) as recipient_name,
      subject.id as subject_id,
      subject.name as subject_name
    from student_scope student
    join (
      select * from class_subject_teachers
      union
      select * from direct_subject_teachers
    ) option_row
      on true
    join public.profiles teacher
      on teacher.id = option_row.teacher_id
     and teacher.school_id = student.school_id
     and teacher.role = 'teacher'
     and teacher.active = true
     and coalesce(teacher.is_assistant_teacher, false) = false
    join public.subjects subject
      on subject.id = option_row.subject_id
     and subject.active = true
    join public.school_subjects enabled_subject
      on enabled_subject.school_id = student.school_id
     and enabled_subject.subject_id = subject.id
     and enabled_subject.active = true
  ),
  parent_rows as (
    select
      'parent'::text as recipient_role,
      parent.id as recipient_id,
      trim(parent.first_name || ' ' || parent.last_name) as recipient_name,
      null::uuid as subject_id,
      null::text as subject_name
    from student_scope student
    join public.parent_students relation
      on relation.student_id = student.id
    join public.profiles parent
      on parent.id = relation.parent_id
     and parent.school_id = student.school_id
     and parent.role = 'parent'
     and parent.active = true
  )
  select *
  from (
    select * from parent_rows
    union all
    select * from teacher_rows
  ) options
  order by recipient_role, recipient_name, subject_name nulls first;
end
$$;

create or replace function public.start_assistant_thread(
  target_student uuid,
  target_recipient uuid,
  target_recipient_role text,
  target_subject uuid,
  thread_title text,
  first_message text
)
returns public.communication_threads
language plpgsql
security definer
set search_path = public
as $$
declare
  saved_thread public.communication_threads;
  assistant_profile public.profiles;
begin
  select * into assistant_profile
  from public.profiles
  where id = auth.uid()
    and role = 'teacher'
    and active = true
    and coalesce(is_assistant_teacher, false) = true;

  if assistant_profile.id is null or not public.is_assistant_teacher_for_student(target_student) then
    raise exception 'FORBIDDEN';
  end if;

  if char_length(trim(coalesce(thread_title, ''))) not between 2 and 160 then
    raise exception 'INVALID_TITLE';
  end if;

  if char_length(trim(coalesce(first_message, ''))) not between 1 and 2000 then
    raise exception 'INVALID_MESSAGE';
  end if;

  if target_recipient_role = 'parent' then
    if not exists (
      select 1
      from public.assistant_message_options(target_student) option_row
      where option_row.recipient_role = 'parent'
        and option_row.recipient_id = target_recipient
    ) then
      raise exception 'FORBIDDEN';
    end if;

    insert into public.communication_threads (
      student_id,
      parent_id,
      assistant_teacher_id,
      title
    )
    values (
      target_student,
      target_recipient,
      assistant_profile.id,
      trim(thread_title)
    )
    returning * into saved_thread;
  elsif target_recipient_role = 'teacher' then
    if target_subject is null then
      raise exception 'INVALID_SUBJECT';
    end if;

    if not exists (
      select 1
      from public.assistant_message_options(target_student) option_row
      where option_row.recipient_role = 'teacher'
        and option_row.recipient_id = target_recipient
        and option_row.subject_id = target_subject
    ) then
      raise exception 'FORBIDDEN';
    end if;

    insert into public.communication_threads (
      student_id,
      teacher_id,
      assistant_teacher_id,
      subject_id,
      title
    )
    values (
      target_student,
      target_recipient,
      assistant_profile.id,
      target_subject,
      trim(thread_title)
    )
    returning * into saved_thread;
  else
    raise exception 'INVALID_RECIPIENT_ROLE';
  end if;

  insert into public.communication_messages (thread_id, sender_id, body)
  values (saved_thread.id, auth.uid(), trim(first_message));

  return saved_thread;
end
$$;

create or replace function public.send_communication_message(target_thread uuid, message_body text)
returns public.communication_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  saved_message public.communication_messages;
begin
  if not public.can_use_communication_thread(target_thread) then raise exception 'FORBIDDEN'; end if;
  if char_length(trim(message_body)) not between 1 and 2000 then raise exception 'INVALID_MESSAGE'; end if;
  insert into public.communication_messages (thread_id, sender_id, body)
  values (target_thread, auth.uid(), trim(message_body))
  returning * into saved_message;
  update public.communication_threads
  set updated_at = now(),
      parent_archived_at = null,
      teacher_archived_at = null,
      assistant_archived_at = null
  where id = target_thread;
  return saved_message;
end
$$;

create or replace function public.archive_communication_thread(target_thread uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  thread public.communication_threads;
begin
  select * into thread from public.communication_threads where id = target_thread;

  if thread.id is null or (
    thread.parent_id <> auth.uid()
    and thread.teacher_id <> auth.uid()
    and thread.assistant_teacher_id <> auth.uid()
  ) then
    raise exception 'FORBIDDEN';
  end if;

  update public.communication_threads
  set parent_archived_at = case when parent_id = auth.uid() then now() else parent_archived_at end,
      teacher_archived_at = case when teacher_id = auth.uid() then now() else teacher_archived_at end,
      assistant_archived_at = case when assistant_teacher_id = auth.uid() then now() else assistant_archived_at end
  where id = target_thread;

  delete from public.user_notifications
  where recipient_id = auth.uid()
    and kind = 'message'
    and entity_id = target_thread;
end
$$;

create or replace function public.create_message_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  thread public.communication_threads;
  recipient uuid;
begin
  select * into thread from public.communication_threads where id = new.thread_id;

  recipient := case
    when thread.assistant_teacher_id is not null and thread.parent_id is not null
      then case when new.sender_id = thread.assistant_teacher_id then thread.parent_id else thread.assistant_teacher_id end
    when thread.assistant_teacher_id is not null and thread.teacher_id is not null
      then case when new.sender_id = thread.assistant_teacher_id then thread.teacher_id else thread.assistant_teacher_id end
    when new.sender_id = thread.parent_id
      then thread.teacher_id
    else thread.parent_id
  end;

  insert into public.user_notifications (recipient_id, student_id, kind, title, body, entity_id, created_at)
  values (recipient, thread.student_id, 'message', thread.title, new.body, thread.id, new.created_at)
  on conflict (recipient_id, kind, entity_id) do update
  set title = excluded.title,
      body = excluded.body,
      read_at = null,
      created_at = excluded.created_at;

  return new;
end
$$;

alter table public.pia_objective_updates
  add column if not exists reported_on date;

create or replace function public.current_school_day(reference_date date default current_date)
returns date
language sql
immutable
set search_path = public
as $$
  select case extract(isodow from reference_date)
    when 6 then reference_date - 1
    when 7 then reference_date - 2
    else reference_date
  end
$$;

update public.pia_objective_updates
set reported_on = public.current_school_day(created_at::date)
where reported_on is null;

with ranked as (
  select
    id,
    row_number() over (
      partition by objective_id, reported_on
      order by updated_at desc, created_at desc, id desc
    ) as position
  from public.pia_objective_updates
)
delete from public.pia_objective_updates target
using ranked
where target.id = ranked.id
  and ranked.position > 1;

alter table public.pia_objective_updates
  alter column reported_on set not null;

create unique index if not exists pia_objective_updates_objective_day_idx
  on public.pia_objective_updates (objective_id, reported_on);

create or replace function public.sync_pia_objective_update_scope()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  objective public.pia_objectives;
begin
  select * into objective
  from public.pia_objectives
  where id = new.objective_id;

  if objective.id is null then
    raise exception 'OBJECTIVE_NOT_FOUND';
  end if;

  new.student_id := objective.student_id;
  new.assistant_teacher_id := objective.assistant_teacher_id;
  new.reported_on := public.current_school_day(coalesce(new.reported_on, current_date));
  new.comment := trim(new.comment);
  new.updated_at := now();
  return new;
end
$$;

drop function if exists public.record_pia_objective_update(uuid, smallint, text);
create or replace function public.record_pia_objective_update(
  target_objective uuid,
  progress_rating smallint,
  progress_comment text
)
returns public.pia_objective_updates
language plpgsql
security definer
set search_path = public
as $$
declare
  objective public.pia_objectives;
  saved public.pia_objective_updates;
  school_day date := public.current_school_day(current_date);
begin
  if progress_rating not between 1 and 5 then
    raise exception 'INVALID_PIA_RATING';
  end if;

  if char_length(trim(coalesce(progress_comment, ''))) not between 1 and 2000 then
    raise exception 'INVALID_PIA_COMMENT';
  end if;

  select * into objective
  from public.pia_objectives
  where id = target_objective;

  if objective.id is null or objective.assistant_teacher_id <> auth.uid() or not public.is_assistant_teacher_for_student(objective.student_id) then
    raise exception 'FORBIDDEN';
  end if;

  insert into public.pia_objective_updates (
    objective_id,
    student_id,
    assistant_teacher_id,
    rating,
    comment,
    reported_on,
    updated_at
  )
  values (
    objective.id,
    objective.student_id,
    objective.assistant_teacher_id,
    progress_rating,
    trim(progress_comment),
    school_day,
    now()
  )
  on conflict (objective_id, reported_on) do update
  set rating = excluded.rating,
      comment = excluded.comment,
      updated_at = now()
  returning * into saved;

  update public.pia_objectives
  set updated_at = saved.updated_at
  where id = objective.id;

  return saved;
end
$$;

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
  select recipient_id, new.student_id, 'pia', 'PIA: ' || objective.title,
    coalesce(nullif(assistant_name, ''), 'Asistenti') || ' raportoi progres per ' || coalesce(student_name, 'nxenesin') ||
      ' me status ' || new.rating || '/5' ||
      case when trim(coalesce(new.comment, '')) = '' then '' else ' · ' || trim(new.comment) end,
    new.id, new.updated_at
  from (
    select parent_link.parent_id as recipient_id
    from public.parent_students parent_link
    where parent_link.student_id = new.student_id
    union
    select distinct profile.id as recipient_id
    from public.profiles profile
    join public.students student
      on student.id = new.student_id
     and student.school_id = profile.school_id
    where profile.role = 'teacher'
      and profile.active = true
      and coalesce(profile.is_assistant_teacher, false) = false
      and (
        exists (
          select 1 from public.teacher_students direct_link
          where direct_link.teacher_id = profile.id
            and direct_link.student_id = new.student_id
        )
        or exists (
          select 1 from public.teacher_classes class_link
          where class_link.teacher_id = profile.id
            and class_link.class_id = student.class_id
        )
      )
  ) recipients
  on conflict (recipient_id, kind, entity_id) do update
  set title = excluded.title,
      body = excluded.body,
      read_at = null,
      created_at = excluded.created_at;

  return new;
end
$$;

grant execute on function public.assistant_message_options(uuid) to authenticated;
grant execute on function public.start_assistant_thread(uuid, uuid, text, uuid, text, text) to authenticated;
grant execute on function public.current_school_day(date) to authenticated;
grant execute on function public.record_pia_objective_update(uuid, smallint, text) to authenticated;
