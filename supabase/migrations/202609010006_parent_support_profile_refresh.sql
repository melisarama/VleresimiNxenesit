drop function if exists public.save_parent_student_preferences(uuid, text[], text, text);

create or replace function public.save_parent_student_preferences(
  target_student uuid,
  learning_preferences text[],
  communication_language text,
  communication_method text,
  support_summary text,
  accessibility_information text,
  additional_notes text
)
returns public.student_support_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  saved public.student_support_profiles;
  normalized_preferences text[];
  normalized_count integer;
  merged_preferences jsonb;
begin
  if not exists (
    select 1
    from public.parent_students
    where parent_id = auth.uid()
      and student_id = target_student
  ) then
    raise exception 'FORBIDDEN';
  end if;

  with normalized as (
    select trim(pref) as value, min(ord)::integer as first_ord
    from unnest(coalesce(learning_preferences, array[]::text[])) with ordinality as source(pref, ord)
    where trim(pref) <> ''
    group by trim(pref)
  )
  select
    coalesce(array_agg(value order by first_ord), array[]::text[]),
    count(*)
  into normalized_preferences, normalized_count
  from normalized;

  if normalized_count > 3 then
    raise exception 'MAX_PREFERENCES_EXCEEDED';
  end if;

  merged_preferences := jsonb_build_object(
    'learning_preferences', to_jsonb(normalized_preferences),
    'support_preferences', to_jsonb(normalized_preferences),
    'preferred_mode', coalesce(normalized_preferences[1], ''),
    'communication_language', trim(coalesce(communication_language, '')),
    'communication_method', trim(coalesce(communication_method, '')),
    'support_summary', trim(coalesce(support_summary, '')),
    'accessibility_information', trim(coalesce(accessibility_information, '')),
    'additional_notes', trim(coalesce(additional_notes, ''))
  );

  insert into public.student_support_profiles (
    student_id,
    support_summary,
    preferences,
    accessibility_information,
    updated_at
  )
  values (
    target_student,
    nullif(trim(coalesce(support_summary, '')), ''),
    merged_preferences,
    nullif(trim(coalesce(accessibility_information, '')), ''),
    now()
  )
  on conflict (student_id) do update
  set support_summary = excluded.support_summary,
      preferences = coalesce(student_support_profiles.preferences, '{}'::jsonb) || excluded.preferences,
      accessibility_information = excluded.accessibility_information,
      updated_at = now()
  returning * into saved;

  return saved;
end
$$;

grant execute on function public.save_parent_student_preferences(uuid, text[], text, text, text, text, text) to authenticated;
