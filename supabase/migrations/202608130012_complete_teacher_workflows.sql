-- Complete teacher assessments, message replies, and email preferences; retire PIA.

drop table if exists public.pia_plans cascade;

alter table public.grades add column if not exists parent_message text check (char_length(parent_message) <= 1200);
alter table public.grades add column if not exists updated_at timestamptz not null default now();

with ranked as (
  select id, row_number() over (
    partition by student_id, subject_id, chapter_id, academic_period_id
    order by graded_at desc, id desc
  ) as position
  from public.grades
)
delete from public.grades grade
using ranked
where grade.id = ranked.id and ranked.position > 1;

create unique index if not exists grades_one_chapter_assessment_idx
  on public.grades (student_id, subject_id, chapter_id, academic_period_id);

create table if not exists public.parent_notice_replies (
  id uuid primary key default gen_random_uuid(),
  notice_id uuid not null references public.subject_parent_notices(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  message text not null check (char_length(trim(message)) between 1 and 1200),
  created_at timestamptz not null default now()
);

create index if not exists parent_notice_replies_notice_idx
  on public.parent_notice_replies (notice_id, created_at);

create table if not exists public.teacher_notification_preferences (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  notification_email text,
  parent_message_emails boolean not null default false,
  daily_digest_emails boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (notification_email is null or char_length(notification_email) between 3 and 320)
);

alter table public.parent_notice_replies enable row level security;
alter table public.teacher_notification_preferences enable row level security;

create policy "participants read parent notice replies" on public.parent_notice_replies
for select using (
  exists (
    select 1 from public.subject_parent_notices notice
    where notice.id = parent_notice_replies.notice_id
      and (
        notice.parent_id = auth.uid()
        or public.can_teacher_manage_parent_notice(notice.student_id, notice.subject_id)
      )
  )
);

create policy "assigned teachers reply to parent notices" on public.parent_notice_replies
for insert with check (
  teacher_id = auth.uid()
  and exists (
    select 1 from public.subject_parent_notices notice
    where notice.id = parent_notice_replies.notice_id
      and public.can_teacher_manage_parent_notice(notice.student_id, notice.subject_id)
  )
);

create policy "teachers read own notification preferences" on public.teacher_notification_preferences
for select using (profile_id = auth.uid());

create policy "teachers create own notification preferences" on public.teacher_notification_preferences
for insert with check (
  profile_id = auth.uid()
  and exists (select 1 from public.profiles profile where profile.id = auth.uid() and profile.role = 'teacher' and profile.active)
);

create policy "teachers update own notification preferences" on public.teacher_notification_preferences
for update using (profile_id = auth.uid())
with check (profile_id = auth.uid());

create or replace function public.save_chapter_assessment(
  target_student uuid,
  target_subject uuid,
  target_chapter uuid,
  target_period uuid,
  assessment_score numeric,
  assessment_parent_message text default null
)
returns public.grades
language plpgsql
security definer
set search_path = public
as $$
declare
  saved public.grades;
begin
  if assessment_score < 1 or assessment_score > 5 then raise exception 'INVALID_SCORE'; end if;
  if not public.can_teacher_grade(target_student, target_subject, target_chapter) then raise exception 'FORBIDDEN'; end if;
  if not public.can_teacher_use_academic_period(target_student, target_period) then raise exception 'PERIOD_NOT_ACTIVE'; end if;

  insert into public.grades (
    student_id, subject_id, chapter_id, teacher_id, academic_period_id,
    score, parent_message, graded_at, updated_at
  ) values (
    target_student, target_subject, target_chapter, auth.uid(), target_period,
    assessment_score, nullif(trim(assessment_parent_message), ''), now(), now()
  )
  on conflict (student_id, subject_id, chapter_id, academic_period_id)
  do update set
    teacher_id = auth.uid(),
    score = excluded.score,
    parent_message = excluded.parent_message,
    graded_at = now(),
    updated_at = now()
  returning * into saved;

  return saved;
end
$$;

create or replace function public.save_final_grade(
  target_student uuid,
  target_subject uuid,
  target_period uuid,
  final_score smallint,
  final_parent_message text default null
)
returns public.final_grades
language plpgsql
security definer
set search_path = public
as $$
declare
  saved public.final_grades;
begin
  if final_score < 1 or final_score > 5 then raise exception 'INVALID_SCORE'; end if;
  if not public.can_teacher_assess(target_student, target_subject) then raise exception 'FORBIDDEN'; end if;
  if not public.can_teacher_use_academic_period(target_student, target_period) then raise exception 'PERIOD_NOT_ACTIVE'; end if;
  if not exists (select 1 from public.chapters chapter where chapter.subject_id = target_subject and chapter.active) then
    raise exception 'NO_ACTIVE_CHAPTERS';
  end if;
  if exists (
    select 1
    from public.chapters chapter
    where chapter.subject_id = target_subject
      and chapter.active
      and not exists (
        select 1 from public.grades grade
        where grade.student_id = target_student
          and grade.subject_id = target_subject
          and grade.chapter_id = chapter.id
          and grade.academic_period_id = target_period
      )
  ) then
    raise exception 'INCOMPLETE_ASSESSMENTS';
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

revoke insert, update on public.grades from authenticated;
revoke insert, update on public.final_grades from authenticated;

grant select, insert on public.parent_notice_replies to authenticated;
grant select, insert, update on public.teacher_notification_preferences to authenticated;
grant execute on function public.save_chapter_assessment(uuid, uuid, uuid, uuid, numeric, text) to authenticated;
grant execute on function public.save_final_grade(uuid, uuid, uuid, smallint, text) to authenticated;

