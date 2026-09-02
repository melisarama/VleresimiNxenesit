alter table public.profiles
  add column if not exists is_assistant_teacher boolean not null default false;

create index if not exists profiles_school_role_assistant_idx
  on public.profiles (school_id, role, is_assistant_teacher);

create table if not exists public.assistant_teacher_students (
  assistant_teacher_id uuid not null references public.profiles(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (assistant_teacher_id, student_id)
);

create index if not exists assistant_teacher_students_student_idx
  on public.assistant_teacher_students (student_id);

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
        or exists (
          select 1 from public.assistant_teacher_students relation
          where relation.assistant_teacher_id = profile.id and relation.student_id = student.id
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
      and coalesce(teacher.is_assistant_teacher, false) = false
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
      and coalesce(teacher.is_assistant_teacher, false) = false
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

alter table public.assistant_teacher_students enable row level security;

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
      and coalesce(teacher.is_assistant_teacher, false) = false
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
      and coalesce(teacher.is_assistant_teacher, false) = false
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
      and coalesce(teacher.is_assistant_teacher, false) = false
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
      and coalesce(teacher.is_assistant_teacher, false) = false
      and teacher.school_id = admin.school_id
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
      and coalesce(teacher.is_assistant_teacher, false) = false
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
      and coalesce(teacher.is_assistant_teacher, false) = false
      and teacher.school_id = admin.school_id
      and class.school_id = admin.school_id
  )
);

drop policy if exists "assistant teachers read own student assignments" on public.assistant_teacher_students;
create policy "assistant teachers read own student assignments" on public.assistant_teacher_students
for select using (
  assistant_teacher_id = auth.uid()
  or exists (
    select 1
    from public.profiles admin
    join public.profiles assistant on assistant.id = assistant_teacher_students.assistant_teacher_id
    join public.students student on student.id = assistant_teacher_students.student_id
    where admin.id = auth.uid()
      and admin.role = 'admin'
      and admin.active = true
      and assistant.role = 'teacher'
      and coalesce(assistant.is_assistant_teacher, false) = true
      and assistant.school_id = admin.school_id
      and student.school_id = admin.school_id
  )
);

drop policy if exists "admins manage assistant teacher students" on public.assistant_teacher_students;
create policy "admins manage assistant teacher students" on public.assistant_teacher_students
for all using (
  public.is_admin_for_student(student_id)
  and exists (
    select 1
    from public.profiles admin
    join public.profiles assistant on assistant.id = assistant_teacher_students.assistant_teacher_id
    where admin.id = auth.uid()
      and admin.role = 'admin'
      and admin.active = true
      and assistant.role = 'teacher'
      and coalesce(assistant.is_assistant_teacher, false) = true
      and assistant.school_id = admin.school_id
  )
)
with check (
  public.is_admin_for_student(student_id)
  and exists (
    select 1
    from public.profiles admin
    join public.profiles assistant on assistant.id = assistant_teacher_students.assistant_teacher_id
    where admin.id = auth.uid()
      and admin.role = 'admin'
      and admin.active = true
      and assistant.role = 'teacher'
      and coalesce(assistant.is_assistant_teacher, false) = true
      and assistant.school_id = admin.school_id
  )
);

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
  join public.profiles teacher
    on teacher.school_id = student.school_id
   and teacher.role = 'teacher'
   and teacher.active
   and coalesce(teacher.is_assistant_teacher, false) = false
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
  select distinct profile.id, new.student_id, 'daily_mood', 'Gjendja ditore: ' || student_name,
    new.mood || case when nullif(trim(coalesce(new.general_comment, new.parent_comment, '')), '') is null then '' else ' · ' || trim(coalesce(new.general_comment, new.parent_comment)) end,
    new.id, now()
  from public.profiles profile
  join public.students student on student.id = new.student_id and student.school_id = profile.school_id
  where profile.role = 'teacher'
    and profile.active
    and (
      (
        coalesce(profile.is_assistant_teacher, false) = false
        and (
          exists (select 1 from public.teacher_students direct_link where direct_link.teacher_id = profile.id and direct_link.student_id = new.student_id)
          or exists (select 1 from public.teacher_classes class_link where class_link.teacher_id = profile.id and class_link.class_id = student.class_id)
        )
      )
      or (
        coalesce(profile.is_assistant_teacher, false) = true
        and exists (
          select 1 from public.assistant_teacher_students assistant_link
          where assistant_link.assistant_teacher_id = profile.id
            and assistant_link.student_id = new.student_id
        )
      )
    )
  on conflict (recipient_id, kind, entity_id) do update
  set title = excluded.title, body = excluded.body, read_at = null, created_at = excluded.created_at;
  return new;
end
$$;

drop function if exists public.admin_register_invited_profile(uuid, text, text, text, text);

create or replace function public.admin_register_invited_profile(
  invited_user_id uuid,
  invited_email text,
  invited_first_name text,
  invited_last_name text,
  invited_role text,
  invited_is_assistant_teacher boolean default false
)
returns public.profiles
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  admin_profile public.profiles;
  created_profile public.profiles;
begin
  select * into admin_profile
  from public.profiles
  where id = auth.uid() and role = 'admin' and active = true;

  if admin_profile.id is null or admin_profile.school_id is null then
    raise exception 'ADMIN_FORBIDDEN';
  end if;

  if invited_role not in ('teacher', 'parent') then
    raise exception 'INVALID_ROLE';
  end if;

  if invited_is_assistant_teacher and invited_role <> 'teacher' then
    raise exception 'INVALID_ASSISTANT_ROLE';
  end if;

  if not exists (
    select 1 from auth.users
    where id = invited_user_id and lower(email) = lower(trim(invited_email))
  ) then
    raise exception 'AUTH_USER_MISMATCH';
  end if;

  insert into public.profiles (id, school_id, role, first_name, last_name, email, active, is_assistant_teacher)
  values (
    invited_user_id,
    admin_profile.school_id,
    invited_role::public.profile_role,
    trim(invited_first_name),
    trim(invited_last_name),
    lower(trim(invited_email)),
    true,
    coalesce(invited_is_assistant_teacher, false)
  )
  returning * into created_profile;

  return created_profile;
end;
$$;

grant select, insert, update, delete on public.assistant_teacher_students to authenticated;
revoke all on function public.admin_register_invited_profile(uuid, text, text, text, text, boolean) from public;
grant execute on function public.admin_register_invited_profile(uuid, text, text, text, text, boolean) to authenticated;
