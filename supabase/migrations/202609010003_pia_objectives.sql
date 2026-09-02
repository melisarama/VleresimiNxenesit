create table if not exists public.pia_objectives (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  assistant_teacher_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 2 and 160),
  details text not null default '' check (char_length(details) <= 2000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pia_objectives_student_idx
  on public.pia_objectives (student_id, updated_at desc);

create index if not exists pia_objectives_assistant_idx
  on public.pia_objectives (assistant_teacher_id, student_id, updated_at desc);

create table if not exists public.pia_objective_updates (
  id uuid primary key default gen_random_uuid(),
  objective_id uuid not null references public.pia_objectives(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  assistant_teacher_id uuid not null references public.profiles(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text not null check (char_length(trim(comment)) between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pia_objective_updates_student_idx
  on public.pia_objective_updates (student_id, created_at desc);

create index if not exists pia_objective_updates_objective_idx
  on public.pia_objective_updates (objective_id, created_at desc);

alter table public.pia_objectives enable row level security;
alter table public.pia_objective_updates enable row level security;

alter table public.user_notifications
  drop constraint if exists user_notifications_kind_check;

alter table public.user_notifications
  add constraint user_notifications_kind_check
  check (kind in ('daily_mood', 'message', 'assessment', 'final_grade', 'material', 'teacher_notice', 'pia'));

create or replace function public.is_assistant_teacher_for_student(target_student uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles profile
    join public.students student
      on student.id = target_student
     and student.active = true
     and student.school_id = profile.school_id
    where profile.id = auth.uid()
      and profile.role = 'teacher'
      and profile.active = true
      and coalesce(profile.is_assistant_teacher, false) = true
      and exists (
        select 1
        from public.assistant_teacher_students relation
        where relation.assistant_teacher_id = profile.id
          and relation.student_id = student.id
      )
  )
$$;

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
  new.comment := trim(new.comment);
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists pia_objective_updates_scope on public.pia_objective_updates;
create trigger pia_objective_updates_scope
before insert or update on public.pia_objective_updates
for each row execute function public.sync_pia_objective_update_scope();

drop policy if exists "authorized read pia objectives" on public.pia_objectives;
create policy "authorized read pia objectives" on public.pia_objectives
for select using (public.can_read_student(student_id));

drop policy if exists "assistant teachers insert pia objectives" on public.pia_objectives;
create policy "assistant teachers insert pia objectives" on public.pia_objectives
for insert with check (
  assistant_teacher_id = auth.uid()
  and public.is_assistant_teacher_for_student(student_id)
);

drop policy if exists "assistant teachers update pia objectives" on public.pia_objectives;
create policy "assistant teachers update pia objectives" on public.pia_objectives
for update using (
  assistant_teacher_id = auth.uid()
  and public.is_assistant_teacher_for_student(student_id)
)
with check (
  assistant_teacher_id = auth.uid()
  and public.is_assistant_teacher_for_student(student_id)
);

drop policy if exists "admins manage pia objectives" on public.pia_objectives;
create policy "admins manage pia objectives" on public.pia_objectives
for all using (public.is_admin_for_student(student_id))
with check (public.is_admin_for_student(student_id));

drop policy if exists "authorized read pia objective updates" on public.pia_objective_updates;
create policy "authorized read pia objective updates" on public.pia_objective_updates
for select using (public.can_read_student(student_id));

drop policy if exists "assistant teachers insert pia objective updates" on public.pia_objective_updates;
create policy "assistant teachers insert pia objective updates" on public.pia_objective_updates
for insert with check (
  assistant_teacher_id = auth.uid()
  and public.is_assistant_teacher_for_student(student_id)
);

drop policy if exists "assistant teachers update pia objective updates" on public.pia_objective_updates;
create policy "assistant teachers update pia objective updates" on public.pia_objective_updates
for update using (
  assistant_teacher_id = auth.uid()
  and public.is_assistant_teacher_for_student(student_id)
)
with check (
  assistant_teacher_id = auth.uid()
  and public.is_assistant_teacher_for_student(student_id)
);

drop policy if exists "admins manage pia objective updates" on public.pia_objective_updates;
create policy "admins manage pia objective updates" on public.pia_objective_updates
for all using (public.is_admin_for_student(student_id))
with check (public.is_admin_for_student(student_id));

create or replace function public.save_pia_objective(
  target_objective uuid,
  target_student uuid,
  objective_title text,
  objective_details text default '',
  objective_active boolean default true
)
returns public.pia_objectives
language plpgsql
security definer
set search_path = public
as $$
declare
  saved public.pia_objectives;
begin
  if char_length(trim(coalesce(objective_title, ''))) not between 2 and 160 then
    raise exception 'INVALID_OBJECTIVE_TITLE';
  end if;

  if char_length(coalesce(objective_details, '')) > 2000 then
    raise exception 'INVALID_OBJECTIVE_DETAILS';
  end if;

  if target_objective is null then
    if not public.is_assistant_teacher_for_student(target_student) then
      raise exception 'FORBIDDEN';
    end if;

    insert into public.pia_objectives (
      student_id,
      assistant_teacher_id,
      title,
      details,
      active,
      updated_at
    )
    values (
      target_student,
      auth.uid(),
      trim(objective_title),
      coalesce(objective_details, ''),
      coalesce(objective_active, true),
      now()
    )
    returning * into saved;

    return saved;
  end if;

  select * into saved
  from public.pia_objectives
  where id = target_objective;

  if saved.id is null or saved.assistant_teacher_id <> auth.uid() or not public.is_assistant_teacher_for_student(saved.student_id) then
    raise exception 'FORBIDDEN';
  end if;

  update public.pia_objectives
  set title = trim(objective_title),
      details = coalesce(objective_details, ''),
      active = coalesce(objective_active, saved.active),
      updated_at = now()
  where id = saved.id
  returning * into saved;

  return saved;
end
$$;

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
    updated_at
  )
  values (
    objective.id,
    objective.student_id,
    objective.assistant_teacher_id,
    progress_rating,
    trim(progress_comment),
    now()
  )
  returning * into saved;

  update public.pia_objectives
  set updated_at = saved.created_at
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
  select
    parent_link.parent_id,
    new.student_id,
    'pia',
    'PIA: ' || objective.title,
    coalesce(nullif(assistant_name, ''), 'Asistenti') || ' raportoi progres per ' || coalesce(student_name, 'nxenesin') ||
      ' me vleresim ' || new.rating || '/5' ||
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

drop trigger if exists pia_update_notifications on public.pia_objective_updates;
create trigger pia_update_notifications
after insert or update of rating, comment on public.pia_objective_updates
for each row execute function public.create_pia_update_notifications();

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'pia_objectives'
  ) then
    alter publication supabase_realtime add table public.pia_objectives;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'pia_objective_updates'
  ) then
    alter publication supabase_realtime add table public.pia_objective_updates;
  end if;
end
$$;

grant select on public.pia_objectives, public.pia_objective_updates to authenticated;
grant execute on function public.is_assistant_teacher_for_student(uuid) to authenticated;
grant execute on function public.save_pia_objective(uuid, uuid, text, text, boolean) to authenticated;
grant execute on function public.record_pia_objective_update(uuid, smallint, text) to authenticated;
