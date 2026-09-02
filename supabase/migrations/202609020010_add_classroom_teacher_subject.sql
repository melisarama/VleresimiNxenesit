insert into public.subjects (name, active)
values ('Mësimdhënës klasor', true)
on conflict (name) do update
set active = excluded.active;

insert into public.school_subjects (school_id, subject_id, active)
select school.id, subject.id, true
from public.schools school
join public.subjects subject
  on subject.name = 'Mësimdhënës klasor'
on conflict (school_id, subject_id) do update
set active = excluded.active;
