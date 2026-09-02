-- Queue opt-in notification emails for delivery by the email-dispatch Edge Function.

create table if not exists public.email_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid references public.user_notifications(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  recipient_email text not null check (recipient_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  template text not null check (template in ('message', 'assessment', 'final_grade', 'material')),
  subject text not null check (char_length(subject) between 1 and 180),
  body_text text not null default '' check (char_length(body_text) <= 4000),
  body_html text not null default '' check (char_length(body_html) <= 8000),
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0 check (attempts >= 0),
  provider text not null default 'resend',
  provider_message_id text,
  error text,
  source_created_at timestamptz not null,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (notification_id, template, source_created_at)
);

create index if not exists email_deliveries_status_idx
  on public.email_deliveries (status, created_at)
  where status in ('queued', 'failed');

create index if not exists email_deliveries_recipient_idx
  on public.email_deliveries (recipient_id, created_at desc);

alter table public.email_deliveries enable row level security;

drop policy if exists "recipients read own email deliveries" on public.email_deliveries;
create policy "recipients read own email deliveries" on public.email_deliveries
for select using (recipient_id = auth.uid());

create or replace function public.email_template_for_notification(notification_kind text)
returns text
language sql
immutable
as $$
  select case
    when notification_kind = 'message' then 'message'
    when notification_kind = 'assessment' then 'assessment'
    when notification_kind = 'final_grade' then 'final_grade'
    when notification_kind = 'material' then 'material'
    else null
  end
$$;

create or replace function public.queue_notification_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recipient public.profiles;
  parent_preferences public.parent_notification_preferences;
  teacher_preferences public.teacher_notification_preferences;
  template_name text;
  target_email text;
  email_enabled boolean := false;
  email_subject text;
  plain_body text;
  html_body text;
begin
  template_name := public.email_template_for_notification(new.kind);
  if template_name is null then return new; end if;

  select * into recipient from public.profiles where id = new.recipient_id and active = true;
  if recipient.id is null then return new; end if;

  if recipient.role = 'parent' then
    select * into parent_preferences from public.parent_notification_preferences where profile_id = recipient.id;
    target_email := coalesce(nullif(trim(parent_preferences.notification_email), ''), recipient.email);
    email_enabled := case new.kind
      when 'message' then coalesce(parent_preferences.teacher_message_emails, false)
      when 'assessment' then coalesce(parent_preferences.assessment_emails, false)
      when 'final_grade' then coalesce(parent_preferences.assessment_emails, false)
      when 'material' then coalesce(parent_preferences.material_emails, false)
      else false
    end;
  elsif recipient.role = 'teacher' then
    select * into teacher_preferences from public.teacher_notification_preferences where profile_id = recipient.id;
    target_email := coalesce(nullif(trim(teacher_preferences.notification_email), ''), recipient.email);
    email_enabled := new.kind = 'message' and coalesce(teacher_preferences.parent_message_emails, false);
  end if;

  if not email_enabled or target_email is null then return new; end if;

  email_subject := 'Mësim i Qartë: ' || new.title;
  plain_body := trim(new.title || E'\n\n' || coalesce(new.body, '') || E'\n\nHyni në platformë për detajet e plota.');
  html_body :=
    '<div style="font-family:Arial,sans-serif;line-height:1.5;color:#29233f">' ||
    '<h1 style="font-size:20px;margin:0 0 12px">Mësim i Qartë</h1>' ||
    '<h2 style="font-size:16px;margin:0 0 10px">' || replace(replace(replace(new.title, '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || '</h2>' ||
    '<p style="margin:0 0 16px">' || replace(replace(replace(coalesce(new.body, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || '</p>' ||
    '<p style="margin:0;color:#676075">Hyni në platformë për detajet e plota.</p>' ||
    '</div>';

  insert into public.email_deliveries (
    notification_id, recipient_id, recipient_email, template, subject, body_text, body_html, status, source_created_at, updated_at
  ) values (
    new.id, new.recipient_id, lower(trim(target_email)), template_name, email_subject, plain_body, html_body, 'queued', new.created_at, now()
  )
  on conflict (notification_id, template, source_created_at) do update
  set recipient_email = excluded.recipient_email,
      subject = excluded.subject,
      body_text = excluded.body_text,
      body_html = excluded.body_html,
      status = case when email_deliveries.status = 'sent' then email_deliveries.status else 'queued' end,
      error = null,
      updated_at = now();

  return new;
end
$$;

drop trigger if exists queue_user_notification_email on public.user_notifications;
create trigger queue_user_notification_email
after insert or update of title, body, read_at, created_at on public.user_notifications
for each row
when (new.read_at is null)
execute function public.queue_notification_email();

grant select on public.email_deliveries to authenticated;
grant select, insert, update on public.email_deliveries to service_role;
grant execute on function public.email_template_for_notification(text) to authenticated, service_role;
grant execute on function public.queue_notification_email() to service_role;
