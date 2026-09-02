-- Normalize the demo school's saved identity, simplify student status values,
-- and make teacher-class assignments subject-aware.

update public.schools
set name = 'SHFMU "Iliria"',
    address = 'Elementary School "Iliria", Isa Kastrati, Pristina District, Prishtinë 10000'
where id = '10000000-0000-0000-0000-000000000001';

update public.students
set status = 'inactive',
    active = false
where status = 'transferred';

alter table public.students
drop constraint if exists students_status_check;

alter table public.students
add constraint students_status_check
check (status in ('active', 'inactive'));

alter table public.teacher_classes
add column if not exists subject_id uuid references public.subjects(id) on delete cascade;

alter table public.teacher_classes
drop constraint if exists teacher_classes_pkey;

create index if not exists teacher_classes_subject_idx
  on public.teacher_classes (subject_id);

create index if not exists teacher_classes_teacher_subject_idx
  on public.teacher_classes (teacher_id, subject_id);

insert into public.teacher_classes (teacher_id, class_id, subject_id, created_at)
select legacy.teacher_id, legacy.class_id, teacher_subject.subject_id, legacy.created_at
from public.teacher_classes legacy
join public.teacher_subjects teacher_subject
  on teacher_subject.teacher_id = legacy.teacher_id
where legacy.subject_id is null
  and not exists (
    select 1
    from public.teacher_classes existing
    where existing.teacher_id = legacy.teacher_id
      and existing.class_id = legacy.class_id
      and existing.subject_id = teacher_subject.subject_id
  );

delete from public.teacher_classes
where subject_id is null;

with ranked as (
  select ctid,
         row_number() over (
           partition by class_id, subject_id
           order by created_at desc, teacher_id
         ) as position
  from public.teacher_classes
)
delete from public.teacher_classes target
using ranked
where target.ctid = ranked.ctid
  and ranked.position > 1;

alter table public.teacher_classes
alter column subject_id set not null;

alter table public.teacher_classes
add constraint teacher_classes_pkey primary key (teacher_id, class_id, subject_id);

create unique index if not exists teacher_classes_class_subject_unique_idx
  on public.teacher_classes (class_id, subject_id);

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
        (
          exists (
            select 1 from public.teacher_students relation
            where relation.teacher_id = teacher.id and relation.student_id = student.id
          )
          and exists (
            select 1 from public.teacher_subjects assignment
            where assignment.teacher_id = teacher.id and assignment.subject_id = target_subject
          )
        )
        or exists (
          select 1 from public.teacher_classes relation
          where relation.teacher_id = teacher.id
            and relation.class_id = student.class_id
            and relation.subject_id = target_subject
        )
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
        (
          exists (
            select 1 from public.teacher_students relation
            where relation.teacher_id = teacher.id and relation.student_id = student.id
          )
          and exists (
            select 1 from public.teacher_subjects assignment
            where assignment.teacher_id = teacher.id and assignment.subject_id = target_subject
          )
        )
        or exists (
          select 1 from public.teacher_classes relation
          where relation.teacher_id = teacher.id
            and relation.class_id = student.class_id
            and relation.subject_id = target_subject
        )
      )
      and exists (
        select 1 from public.school_subjects enabled_subject
        where enabled_subject.school_id = teacher.school_id
          and enabled_subject.subject_id = target_subject
          and enabled_subject.active = true
      )
  )
$$;

create or replace function public.can_teacher_access_student(target_student uuid)
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
          select 1 from public.teacher_students assignment
          where assignment.teacher_id = teacher.id and assignment.student_id = student.id
        )
        or exists (
          select 1 from public.teacher_classes assignment
          where assignment.teacher_id = teacher.id and assignment.class_id = student.class_id
        )
      )
  )
$$;

create or replace function public.can_teacher_access_student_for_subject(target_student uuid, target_subject uuid)
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
        (
          exists (
            select 1 from public.teacher_students assignment
            where assignment.teacher_id = teacher.id and assignment.student_id = student.id
          )
          and exists (
            select 1 from public.teacher_subjects subject_assignment
            where subject_assignment.teacher_id = teacher.id
              and subject_assignment.subject_id = target_subject
          )
        )
        or exists (
          select 1 from public.teacher_classes assignment
          where assignment.teacher_id = teacher.id
            and assignment.class_id = student.class_id
            and assignment.subject_id = target_subject
        )
      )
  )
$$;

create or replace function public.can_teacher_manage_parent_notice(target_student uuid, target_subject uuid)
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
        (
          exists (
            select 1 from public.teacher_students assignment
            where assignment.teacher_id = teacher.id and assignment.student_id = student.id
          )
          and exists (
            select 1 from public.teacher_subjects subject_assignment
            where subject_assignment.teacher_id = teacher.id
              and subject_assignment.subject_id = target_subject
          )
        )
        or exists (
          select 1 from public.teacher_classes assignment
          where assignment.teacher_id = teacher.id
            and assignment.class_id = student.class_id
            and assignment.subject_id = target_subject
        )
      )
  )
$$;

create or replace function public.parent_teacher_options(target_student uuid)
returns table (teacher_id uuid, teacher_name text, subject_id uuid, subject_name text)
language sql
security definer
set search_path = public
stable
as $$
  with class_subject_teachers as (
    select assignment.teacher_id, assignment.subject_id
    from public.teacher_classes assignment
    join public.students student on student.class_id = assignment.class_id
    where student.id = target_student
  ),
  direct_subject_teachers as (
    select assignment.teacher_id, subject_assignment.subject_id
    from public.teacher_students assignment
    join public.teacher_subjects subject_assignment
      on subject_assignment.teacher_id = assignment.teacher_id
    where assignment.student_id = target_student
  )
  select distinct teacher.id,
         trim(teacher.first_name || ' ' || teacher.last_name),
         subject.id,
         subject.name
  from public.parent_students parent_link
  join public.students student
    on student.id = parent_link.student_id
   and student.active = true
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
  where parent_link.parent_id = auth.uid()
    and parent_link.student_id = target_student
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
    join public.school_subjects enabled_subject
      on enabled_subject.school_id = admin.school_id
     and enabled_subject.subject_id = teacher_classes.subject_id
     and enabled_subject.active = true
    where admin.id = auth.uid()
      and admin.role = 'admin'
      and admin.active = true
      and teacher.role = 'teacher'
      and coalesce(teacher.is_assistant_teacher, false) = false
      and teacher.school_id = admin.school_id
      and class.school_id = admin.school_id
  )
);

drop policy if exists "teachers create assigned subject materials" on public.class_materials;
create policy "teachers create assigned subject materials" on public.class_materials
for insert with check (
  teacher_id = auth.uid()
  and exists (
    select 1
    from public.profiles teacher
    where teacher.id = auth.uid()
      and teacher.role = 'teacher'
      and teacher.active = true
      and coalesce(teacher.is_assistant_teacher, false) = false
      and teacher.school_id = class_materials.school_id
  )
  and (
    exists (
      select 1 from public.teacher_subjects assignment
      where assignment.teacher_id = auth.uid() and assignment.subject_id = class_materials.subject_id
    )
    or exists (
      select 1 from public.teacher_classes assignment
      where assignment.teacher_id = auth.uid() and assignment.subject_id = class_materials.subject_id
    )
  )
  and (
    class_materials.audience <> 'class'
    or exists (
      select 1 from public.teacher_classes assignment
      where assignment.teacher_id = auth.uid()
        and assignment.class_id = class_materials.class_id
        and assignment.subject_id = class_materials.subject_id
    )
  )
);

drop policy if exists "teachers add assigned material recipients" on public.class_material_recipients;
create policy "teachers add assigned material recipients" on public.class_material_recipients
for insert with check (
  exists (
    select 1
    from public.class_materials material
    where material.id = class_material_recipients.material_id
      and material.teacher_id = auth.uid()
      and public.can_teacher_access_student_for_subject(class_material_recipients.student_id, material.subject_id)
  )
);

create or replace function public.publish_teacher_material(
  target_subject uuid,
  target_class uuid,
  target_audience text,
  material_title text,
  material_description text,
  notify_parent boolean,
  target_expires_at timestamptz,
  recipient_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_school uuid;
  created_material_id uuid;
begin
  select school_id into caller_school
  from public.profiles
  where id = auth.uid()
    and role = 'teacher'
    and active = true
    and coalesce(is_assistant_teacher, false) = false;
  if caller_school is null then raise exception 'TEACHER_NOT_AUTHORIZED'; end if;

  if target_audience not in ('class', 'subject', 'selected') then raise exception 'INVALID_AUDIENCE'; end if;
  if cardinality(recipient_ids) is null or cardinality(recipient_ids) = 0 then raise exception 'RECIPIENT_REQUIRED'; end if;
  if not exists (
    select 1
    from public.school_subjects enabled_subject
    where enabled_subject.school_id = caller_school
      and enabled_subject.subject_id = target_subject
      and enabled_subject.active = true
  ) then raise exception 'SUBJECT_NOT_ACTIVE'; end if;

  if not (
    exists (
      select 1 from public.teacher_subjects assignment
      where assignment.teacher_id = auth.uid() and assignment.subject_id = target_subject
    )
    or exists (
      select 1 from public.teacher_classes assignment
      where assignment.teacher_id = auth.uid() and assignment.subject_id = target_subject
    )
  ) then raise exception 'SUBJECT_NOT_ASSIGNED'; end if;

  if target_audience = 'class' then
    if target_class is null or not exists (
      select 1
      from public.teacher_classes assignment
      join public.classes class on class.id = assignment.class_id
      where assignment.teacher_id = auth.uid()
        and assignment.class_id = target_class
        and assignment.subject_id = target_subject
        and class.school_id = caller_school
        and class.active = true
    ) then raise exception 'CLASS_NOT_ASSIGNED'; end if;
    if exists (
      select 1
      from unnest(recipient_ids) as recipient(student_id)
      join public.students student on student.id = recipient.student_id
      where student.class_id is distinct from target_class
        or student.school_id is distinct from caller_school
        or not student.active
    ) then raise exception 'INVALID_CLASS_RECIPIENT'; end if;
  end if;

  if exists (
    select 1
    from unnest(recipient_ids) as recipient(student_id)
    where not public.can_teacher_access_student_for_subject(recipient.student_id, target_subject)
  ) then raise exception 'STUDENT_NOT_ASSIGNED'; end if;

  insert into public.class_materials (
    school_id, teacher_id, subject_id, class_id, audience, title, description,
    notify_in_app, expires_at
  ) values (
    caller_school, auth.uid(), target_subject,
    case when target_audience = 'class' then target_class else null end,
    target_audience, trim(material_title), trim(coalesce(material_description, '')),
    coalesce(notify_parent, true), target_expires_at
  ) returning id into created_material_id;

  insert into public.class_material_recipients (material_id, student_id)
  select created_material_id, recipient.student_id
  from (select distinct unnest(recipient_ids) as student_id) recipient;

  return created_material_id;
end
$$;

grant execute on function public.can_teacher_access_student_for_subject(uuid, uuid) to authenticated;
grant execute on function public.publish_teacher_material(uuid, uuid, text, text, text, boolean, timestamptz, uuid[]) to authenticated;
