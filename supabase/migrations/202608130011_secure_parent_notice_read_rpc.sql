-- Read status is the only mutable part of a parent's message.

drop policy if exists "assigned teachers mark parent notices read" on public.subject_parent_notices;
revoke update on public.subject_parent_notices from authenticated;

create or replace function public.mark_parent_notice_read(notice_id uuid)
returns public.subject_parent_notices
language plpgsql
security definer
set search_path = public
as $$
declare
  notice public.subject_parent_notices;
begin
  select * into notice
  from public.subject_parent_notices
  where id = notice_id;

  if notice.id is null then raise exception 'NOTICE_NOT_FOUND'; end if;
  if not public.can_teacher_manage_parent_notice(notice.student_id, notice.subject_id) then
    raise exception 'FORBIDDEN';
  end if;

  update public.subject_parent_notices
  set read_at = coalesce(read_at, now())
  where id = notice_id
  returning * into notice;

  return notice;
end
$$;

grant execute on function public.mark_parent_notice_read(uuid) to authenticated;

