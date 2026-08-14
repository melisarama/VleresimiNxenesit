-- Connect the parent workspace, teacher inbox, and recipient-specific notifications.

create table public.communication_threads (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  parent_id uuid not null references public.profiles(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  subject_id uuid not null references public.subjects(id),
  title text not null check (char_length(trim(title)) between 2 and 160),
  parent_archived_at timestamptz,
  teacher_archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.communication_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.communication_threads(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 2000),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  student_id uuid references public.students(id) on delete cascade,
  kind text not null check (kind in ('daily_mood', 'message', 'assessment', 'final_grade', 'material', 'teacher_notice')),
  title text not null check (char_length(title) between 1 and 180),
  body text not null default '' check (char_length(body) <= 2000),
  entity_id uuid not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (recipient_id, kind, entity_id)
);

create table public.parent_notification_preferences (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  notification_email text,
  teacher_message_emails boolean not null default false,
  assessment_emails boolean not null default false,
  material_emails boolean not null default false,
  updated_at timestamptz not null default now()
);

create index communication_threads_parent_idx on public.communication_threads (parent_id, updated_at desc);
create index communication_threads_teacher_idx on public.communication_threads (teacher_id, updated_at desc);
create index communication_messages_thread_idx on public.communication_messages (thread_id, created_at);
create index user_notifications_recipient_idx on public.user_notifications (recipient_id, read_at, created_at desc);

alter table public.communication_threads enable row level security;
alter table public.communication_messages enable row level security;
alter table public.user_notifications enable row level security;
alter table public.parent_notification_preferences enable row level security;

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
      and (thread.parent_id = viewer.id or thread.teacher_id = viewer.id)
  )
$$;

create policy "participants read communication threads" on public.communication_threads
for select using (parent_id = auth.uid() or teacher_id = auth.uid());

create policy "participants read communication messages" on public.communication_messages
for select using (public.can_use_communication_thread(thread_id));

create policy "recipients read notifications" on public.user_notifications
for select using (recipient_id = auth.uid());

create policy "recipients delete notifications" on public.user_notifications
for delete using (recipient_id = auth.uid());

create policy "parents read own notification preferences" on public.parent_notification_preferences
for select using (profile_id = auth.uid());

create policy "parents create own notification preferences" on public.parent_notification_preferences
for insert with check (
  profile_id = auth.uid()
  and exists (select 1 from public.profiles where id = auth.uid() and role = 'parent' and active)
);

create policy "parents update own notification preferences" on public.parent_notification_preferences
for update using (profile_id = auth.uid()) with check (profile_id = auth.uid());

create or replace function public.parent_teacher_options(target_student uuid)
returns table (teacher_id uuid, teacher_name text, subject_id uuid, subject_name text)
language sql
security definer
set search_path = public
stable
as $$
  select distinct teacher.id, trim(teacher.first_name || ' ' || teacher.last_name), subject.id, subject.name
  from public.parent_students parent_link
  join public.students student on student.id = parent_link.student_id and student.active
  join public.profiles teacher on teacher.school_id = student.school_id and teacher.role = 'teacher' and teacher.active
  join public.teacher_subjects teacher_subject on teacher_subject.teacher_id = teacher.id
  join public.subjects subject on subject.id = teacher_subject.subject_id and subject.active
  where parent_link.parent_id = auth.uid()
    and parent_link.student_id = target_student
    and (
      exists (select 1 from public.teacher_students direct_link where direct_link.teacher_id = teacher.id and direct_link.student_id = student.id)
      or exists (select 1 from public.teacher_classes class_link where class_link.teacher_id = teacher.id and class_link.class_id = student.class_id)
    )
  order by 2, 4
$$;

create or replace function public.start_parent_teacher_thread(
  target_student uuid,
  target_teacher uuid,
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
begin
  if char_length(trim(thread_title)) not between 2 and 160 then raise exception 'INVALID_TITLE'; end if;
  if char_length(trim(first_message)) not between 1 and 2000 then raise exception 'INVALID_MESSAGE'; end if;
  if not exists (
    select 1 from public.parent_teacher_options(target_student) option_row
    where option_row.teacher_id = target_teacher and option_row.subject_id = target_subject
  ) then raise exception 'FORBIDDEN'; end if;

  insert into public.communication_threads (student_id, parent_id, teacher_id, subject_id, title)
  values (target_student, auth.uid(), target_teacher, target_subject, trim(thread_title))
  returning * into saved_thread;

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
      teacher_archived_at = null
  where id = target_thread;
  return saved_message;
end
$$;

create or replace function public.mark_communication_thread_read(target_thread uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_use_communication_thread(target_thread) then raise exception 'FORBIDDEN'; end if;
  update public.communication_messages
  set read_at = coalesce(read_at, now())
  where thread_id = target_thread and sender_id <> auth.uid();
  update public.user_notifications
  set read_at = coalesce(read_at, now())
  where recipient_id = auth.uid() and kind = 'message' and entity_id = target_thread;
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
  if thread.id is null or (thread.parent_id <> auth.uid() and thread.teacher_id <> auth.uid()) then raise exception 'FORBIDDEN'; end if;
  update public.communication_threads
  set parent_archived_at = case when parent_id = auth.uid() then now() else parent_archived_at end,
      teacher_archived_at = case when teacher_id = auth.uid() then now() else teacher_archived_at end
  where id = target_thread;
  delete from public.user_notifications where recipient_id = auth.uid() and kind = 'message' and entity_id = target_thread;
end
$$;

create or replace function public.mark_user_notification_read(target_notification uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.user_notifications set read_at = coalesce(read_at, now())
  where id = target_notification and recipient_id = auth.uid();
  if not found then raise exception 'NOTIFICATION_NOT_FOUND'; end if;
end
$$;

create or replace function public.save_parent_student_preferences(
  target_student uuid,
  learning_preferences text[],
  communication_language text,
  communication_method text
)
returns public.student_support_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  saved public.student_support_profiles;
begin
  if not exists (select 1 from public.parent_students where parent_id = auth.uid() and student_id = target_student) then
    raise exception 'FORBIDDEN';
  end if;
  insert into public.student_support_profiles (student_id, preferences, updated_at)
  values (
    target_student,
    jsonb_build_object(
      'learning_preferences', coalesce(to_jsonb(learning_preferences), '[]'::jsonb),
      'preferred_mode', coalesce(learning_preferences[1], ''),
      'communication_language', trim(coalesce(communication_language, '')),
      'communication_method', trim(coalesce(communication_method, ''))
    ),
    now()
  )
  on conflict (student_id) do update
  set preferences = coalesce(student_support_profiles.preferences, '{}'::jsonb) || excluded.preferences,
      updated_at = now()
  returning * into saved;
  return saved;
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
  recipient := case when new.sender_id = thread.parent_id then thread.teacher_id else thread.parent_id end;
  insert into public.user_notifications (recipient_id, student_id, kind, title, body, entity_id, created_at)
  values (recipient, thread.student_id, 'message', thread.title, new.body, thread.id, new.created_at)
  on conflict (recipient_id, kind, entity_id) do update
  set title = excluded.title, body = excluded.body, read_at = null, created_at = excluded.created_at;
  return new;
end
$$;

create trigger communication_message_notification
after insert on public.communication_messages
for each row execute function public.create_message_notification();

create or replace function public.create_mood_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  student_name text;
begin
  select trim(first_name || ' ' || last_name) into student_name from public.students where id = new.student_id;
  insert into public.user_notifications (recipient_id, student_id, kind, title, body, entity_id, created_at)
  select distinct teacher.id, new.student_id, 'daily_mood', 'Gjendja ditore: ' || student_name,
    new.mood || case when nullif(trim(coalesce(new.general_comment, new.parent_comment, '')), '') is null then '' else ' · ' || trim(coalesce(new.general_comment, new.parent_comment)) end,
    new.id, now()
  from public.profiles teacher
  join public.students student on student.id = new.student_id and student.school_id = teacher.school_id
  where teacher.role = 'teacher' and teacher.active
    and (
      exists (select 1 from public.teacher_students direct_link where direct_link.teacher_id = teacher.id and direct_link.student_id = new.student_id)
      or exists (select 1 from public.teacher_classes class_link where class_link.teacher_id = teacher.id and class_link.class_id = student.class_id)
    )
  on conflict (recipient_id, kind, entity_id) do update
  set title = excluded.title, body = excluded.body, read_at = null, created_at = excluded.created_at;
  return new;
end
$$;

create trigger daily_mood_notifications
after insert or update of mood, general_comment, parent_comment on public.daily_moods
for each row execute function public.create_mood_notifications();

create or replace function public.create_grade_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  student_name text;
  subject_name text;
  chapter_name text;
begin
  select trim(first_name || ' ' || last_name) into student_name from public.students where id = new.student_id;
  select name into subject_name from public.subjects where id = new.subject_id;
  select name into chapter_name from public.chapters where id = new.chapter_id;
  insert into public.user_notifications (recipient_id, student_id, kind, title, body, entity_id, created_at)
  select parent_link.parent_id, new.student_id, 'assessment', 'Vlerësim i ri: ' || subject_name,
    student_name || ' · ' || chapter_name || ': ' || new.score || '/5' || case when nullif(trim(coalesce(new.parent_message, '')), '') is null then '' else ' · ' || trim(new.parent_message) end,
    new.id, now()
  from public.parent_students parent_link where parent_link.student_id = new.student_id
  on conflict (recipient_id, kind, entity_id) do update
  set title = excluded.title, body = excluded.body, read_at = null, created_at = excluded.created_at;
  return new;
end
$$;

create trigger grade_parent_notifications
after insert or update of score, parent_message on public.grades
for each row execute function public.create_grade_notifications();

create or replace function public.create_final_grade_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  student_name text;
  subject_name text;
begin
  select trim(first_name || ' ' || last_name) into student_name from public.students where id = new.student_id;
  select name into subject_name from public.subjects where id = new.subject_id;
  insert into public.user_notifications (recipient_id, student_id, kind, title, body, entity_id, created_at)
  select parent_link.parent_id, new.student_id, 'final_grade', 'Nota përfundimtare: ' || subject_name,
    student_name || ': ' || new.grade || '/5' || case when nullif(trim(coalesce(new.parent_message, '')), '') is null then '' else ' · ' || trim(new.parent_message) end,
    new.id, now()
  from public.parent_students parent_link where parent_link.student_id = new.student_id
  on conflict (recipient_id, kind, entity_id) do update
  set title = excluded.title, body = excluded.body, read_at = null, created_at = excluded.created_at;
  return new;
end
$$;

create trigger final_grade_parent_notifications
after insert or update of grade, parent_message on public.final_grades
for each row execute function public.create_final_grade_notifications();

create or replace function public.create_material_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  material public.class_materials;
begin
  select * into material from public.class_materials where id = new.material_id;
  if not material.notify_in_app then return new; end if;
  insert into public.user_notifications (recipient_id, student_id, kind, title, body, entity_id, created_at)
  select parent_link.parent_id, new.student_id, 'material', 'Material i ri', material.title, material.id, now()
  from public.parent_students parent_link where parent_link.student_id = new.student_id
  on conflict (recipient_id, kind, entity_id) do update
  set title = excluded.title, body = excluded.body, read_at = null, created_at = excluded.created_at;
  return new;
end
$$;

create trigger material_parent_notifications
after insert on public.class_material_recipients
for each row execute function public.create_material_notifications();

grant select on public.communication_threads, public.communication_messages, public.user_notifications to authenticated;
grant select, insert, update on public.parent_notification_preferences to authenticated;
grant delete on public.user_notifications to authenticated;
grant execute on function public.parent_teacher_options(uuid) to authenticated;
grant execute on function public.start_parent_teacher_thread(uuid, uuid, uuid, text, text) to authenticated;
grant execute on function public.send_communication_message(uuid, text) to authenticated;
grant execute on function public.mark_communication_thread_read(uuid) to authenticated;
grant execute on function public.archive_communication_thread(uuid) to authenticated;
grant execute on function public.mark_user_notification_read(uuid) to authenticated;
grant execute on function public.save_parent_student_preferences(uuid, text[], text, text) to authenticated;
