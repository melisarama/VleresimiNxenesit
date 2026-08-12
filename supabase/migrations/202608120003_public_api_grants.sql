-- Let authenticated Supabase API requests reach public tables.
-- Row level security policies still decide which rows each role can access.

grant usage on schema public to anon, authenticated;
grant all privileges on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

alter default privileges in schema public
grant all privileges on tables to authenticated;

alter default privileges in schema public
grant usage, select on sequences to authenticated;
