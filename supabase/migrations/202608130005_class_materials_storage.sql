-- Private classroom materials with recipient snapshots and retention metadata.

create table if not exists public.class_materials (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  subject_id uuid not null references public.subjects(id),
  class_id uuid references public.classes(id),
  audience text not null check (audience in ('class', 'subject', 'selected')),
  title text not null check (char_length(title) between 2 and 160),
  description text not null default '' check (char_length(description) <= 1200),
  notify_in_app boolean not null default true,
  expires_at timestamptz,
  warning_sent_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at is null or expires_at between created_at + interval '89 days' and created_at + interval '121 days'),
  check ((audience = 'class' and class_id is not null) or audience <> 'class')
);

create table if not exists public.class_material_recipients (
  material_id uuid not null references public.class_materials(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (material_id, student_id)
);

create table if not exists public.class_material_files (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.class_materials(id) on delete cascade,
  storage_path text not null unique,
  original_name text not null check (char_length(original_name) between 1 and 240),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  byte_size bigint not null check (byte_size > 0 and byte_size <= 10485760),
  original_byte_size bigint not null check (original_byte_size > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.material_retention_warnings (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null unique references public.class_materials(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  expires_at timestamptz not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists class_materials_teacher_created_idx on public.class_materials (teacher_id, created_at desc);
create index if not exists class_materials_expiry_idx on public.class_materials (expires_at) where expires_at is not null;
create index if not exists class_material_recipients_student_idx on public.class_material_recipients (student_id, material_id);
create index if not exists class_material_files_material_idx on public.class_material_files (material_id);
create index if not exists material_retention_warnings_teacher_idx on public.material_retention_warnings (teacher_id, read_at, created_at desc);

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

create or replace function public.can_read_class_material(target_material uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.class_materials material
    join public.profiles viewer on viewer.id = auth.uid() and viewer.active = true
    where material.id = target_material
      and (
        material.teacher_id = viewer.id
        or (viewer.role = 'admin' and viewer.school_id = material.school_id)
        or (
          viewer.role = 'parent'
          and exists (
            select 1
            from public.class_material_recipients recipient
            join public.parent_students relation
              on relation.parent_id = viewer.id
             and relation.student_id = recipient.student_id
            where recipient.material_id = material.id
          )
        )
      )
  )
$$;

create or replace function public.material_id_from_storage_path(object_name text)
returns uuid
language plpgsql
security definer
set search_path = public, storage
stable
as $$
declare
  folders text[];
begin
  folders := storage.foldername(object_name);
  if cardinality(folders) < 3 then return null; end if;
  return folders[3]::uuid;
exception when others then
  return null;
end
$$;

alter table public.class_materials enable row level security;
alter table public.class_material_recipients enable row level security;
alter table public.class_material_files enable row level security;
alter table public.material_retention_warnings enable row level security;

drop policy if exists "authorized users read class materials" on public.class_materials;
create policy "authorized users read class materials" on public.class_materials
for select using (public.can_read_class_material(id));

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
      and teacher.school_id = class_materials.school_id
  )
  and exists (
    select 1 from public.teacher_subjects assignment
    where assignment.teacher_id = auth.uid() and assignment.subject_id = class_materials.subject_id
  )
  and (
    class_materials.audience <> 'class'
    or exists (
      select 1 from public.teacher_classes assignment
      where assignment.teacher_id = auth.uid() and assignment.class_id = class_materials.class_id
    )
  )
);

drop policy if exists "teachers update own class materials" on public.class_materials;
create policy "teachers update own class materials" on public.class_materials
for update using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());

drop policy if exists "teachers delete own class materials" on public.class_materials;
create policy "teachers delete own class materials" on public.class_materials
for delete using (teacher_id = auth.uid());

drop policy if exists "authorized users read material recipients" on public.class_material_recipients;
create policy "authorized users read material recipients" on public.class_material_recipients
for select using (public.can_read_class_material(material_id));

drop policy if exists "teachers add assigned material recipients" on public.class_material_recipients;
create policy "teachers add assigned material recipients" on public.class_material_recipients
for insert with check (
  exists (
    select 1 from public.class_materials material
    where material.id = class_material_recipients.material_id and material.teacher_id = auth.uid()
  )
  and public.can_teacher_access_student(student_id)
);

drop policy if exists "teachers remove own material recipients" on public.class_material_recipients;
create policy "teachers remove own material recipients" on public.class_material_recipients
for delete using (
  exists (
    select 1 from public.class_materials material
    where material.id = class_material_recipients.material_id and material.teacher_id = auth.uid()
  )
);

drop policy if exists "authorized users read material files" on public.class_material_files;
create policy "authorized users read material files" on public.class_material_files
for select using (public.can_read_class_material(material_id));

drop policy if exists "teachers add own material files" on public.class_material_files;
create policy "teachers add own material files" on public.class_material_files
for insert with check (
  exists (
    select 1 from public.class_materials material
    where material.id = class_material_files.material_id and material.teacher_id = auth.uid()
  )
);

drop policy if exists "teachers remove own material files" on public.class_material_files;
create policy "teachers remove own material files" on public.class_material_files
for delete using (
  exists (
    select 1 from public.class_materials material
    where material.id = class_material_files.material_id and material.teacher_id = auth.uid()
  )
);

drop policy if exists "teachers read own retention warnings" on public.material_retention_warnings;
create policy "teachers read own retention warnings" on public.material_retention_warnings
for select using (teacher_id = auth.uid());

drop policy if exists "teachers mark own retention warnings" on public.material_retention_warnings;
create policy "teachers mark own retention warnings" on public.material_retention_warnings
for update using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'class-materials',
  'class-materials',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "authorized users download class material objects" on storage.objects;
create policy "authorized users download class material objects" on storage.objects
for select using (
  bucket_id = 'class-materials'
  and public.can_read_class_material(public.material_id_from_storage_path(name))
);

drop policy if exists "teachers upload own class material objects" on storage.objects;
create policy "teachers upload own class material objects" on storage.objects
for insert with check (
  bucket_id = 'class-materials'
  and owner_id = auth.uid()::text
  and exists (
    select 1 from public.class_materials material
    where material.id = public.material_id_from_storage_path(name)
      and material.teacher_id = auth.uid()
  )
);

drop policy if exists "teachers update own class material objects" on storage.objects;
create policy "teachers update own class material objects" on storage.objects
for update using (
  bucket_id = 'class-materials'
  and exists (
    select 1 from public.class_materials material
    where material.id = public.material_id_from_storage_path(name)
      and material.teacher_id = auth.uid()
  )
) with check (bucket_id = 'class-materials' and owner_id = auth.uid()::text);

drop policy if exists "teachers delete own class material objects" on storage.objects;
create policy "teachers delete own class material objects" on storage.objects
for delete using (
  bucket_id = 'class-materials'
  and exists (
    select 1 from public.class_materials material
    where material.id = public.material_id_from_storage_path(name)
      and material.teacher_id = auth.uid()
  )
);

grant select, insert, update, delete on public.class_materials to authenticated;
grant select, insert, delete on public.class_material_recipients to authenticated;
grant select, insert, delete on public.class_material_files to authenticated;
grant select, update on public.material_retention_warnings to authenticated;
grant execute on function public.can_teacher_access_student(uuid) to authenticated;
grant execute on function public.can_read_class_material(uuid) to authenticated;
grant execute on function public.material_id_from_storage_path(text) to authenticated;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault;

create or replace function public.configure_material_retention_cron(function_url text, cron_secret text)
returns void
language plpgsql
security definer
set search_path = public, vault, cron, extensions
as $$
declare
  existing_secret uuid;
  existing_job bigint;
  cron_command text;
begin
  if not exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid() and profile.role = 'admin' and profile.active = true
  ) then
    raise exception 'FORBIDDEN';
  end if;
  if function_url !~ '^https://[a-z0-9]+\.supabase\.co/functions/v1/material-retention$' then
    raise exception 'INVALID_FUNCTION_URL';
  end if;
  if char_length(cron_secret) < 32 then
    raise exception 'CRON_SECRET_TOO_SHORT';
  end if;

  select id into existing_secret from vault.secrets where name = 'material_retention_cron_secret';
  if existing_secret is null then
    perform vault.create_secret(cron_secret, 'material_retention_cron_secret', 'Authenticates the daily material retention Edge Function.');
  else
    perform vault.update_secret(existing_secret, cron_secret, 'material_retention_cron_secret', 'Authenticates the daily material retention Edge Function.');
  end if;

  for existing_job in select jobid from cron.job where jobname = 'material-retention-daily' loop
    perform cron.unschedule(existing_job);
  end loop;

  cron_command := format(
    $command$
      select net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'material_retention_cron_secret')
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 30000
      );
    $command$,
    function_url
  );
  perform cron.schedule('material-retention-daily', '15 2 * * *', cron_command);
end
$$;

revoke all on function public.configure_material_retention_cron(text, text) from public;
grant execute on function public.configure_material_retention_cron(text, text) to authenticated;
