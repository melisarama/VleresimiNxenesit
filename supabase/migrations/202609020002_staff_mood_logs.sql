create table if not exists public.staff_mood_logs (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reporter_role text not null check (reporter_role in ('teacher', 'assistant')),
  mood text not null check (length(trim(mood)) > 0),
  comment text,
  context text,
  reported_on date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists staff_mood_logs_student_day_idx
  on public.staff_mood_logs (student_id, reported_on desc, created_at desc);

create index if not exists staff_mood_logs_reporter_idx
  on public.staff_mood_logs (reporter_id, created_at desc);

alter table public.staff_mood_logs enable row level security;

drop policy if exists "authorized read staff mood logs" on public.staff_mood_logs;
create policy "authorized read staff mood logs" on public.staff_mood_logs
for select using (
  public.can_teacher_access_student(student_id)
  or public.is_assistant_teacher_for_student(student_id)
  or exists (
    select 1
    from public.parent_students relation
    where relation.parent_id = auth.uid()
      and relation.student_id = staff_mood_logs.student_id
  )
  or exists (
    select 1
    from public.profiles admin
    join public.students student on student.id = staff_mood_logs.student_id
    where admin.id = auth.uid()
      and admin.role = 'admin'
      and admin.active = true
      and admin.school_id = student.school_id
  )
);

drop policy if exists "teachers insert own mood logs" on public.staff_mood_logs;
create policy "teachers insert own mood logs" on public.staff_mood_logs
for insert with check (
  reporter_id = auth.uid()
  and reporter_role = 'teacher'
  and public.can_teacher_access_student(student_id)
);

drop policy if exists "assistants insert own mood logs" on public.staff_mood_logs;
create policy "assistants insert own mood logs" on public.staff_mood_logs
for insert with check (
  reporter_id = auth.uid()
  and reporter_role = 'assistant'
  and public.is_assistant_teacher_for_student(student_id)
);

grant select, insert on public.staff_mood_logs to authenticated;
