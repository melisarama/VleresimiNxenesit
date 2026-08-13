-- Every classroom material must expire to keep private Storage usage bounded.

update public.class_materials
set expires_at = created_at + interval '120 days'
where expires_at is null;

alter table public.class_materials
  alter column expires_at set not null;
