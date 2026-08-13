-- Preserve the operational distinction between inactive and transferred students.

alter table public.students
add column if not exists status text not null default 'active';

alter table public.students
drop constraint if exists students_status_check;

alter table public.students
add constraint students_status_check check (status in ('active', 'inactive', 'transferred'));

update public.students
set status = 'inactive'
where status = 'active' and active = false;

create or replace function public.sync_student_active_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'active' then
    new.active := true;
  else
    new.active := false;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_student_active_status_trigger on public.students;
create trigger sync_student_active_status_trigger
before insert or update of status on public.students
for each row execute function public.sync_student_active_status();
