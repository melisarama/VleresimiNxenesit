-- Allow notifications and conversation threads to toggle between read and unread.

create or replace function public.mark_user_notification_unread(target_notification uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.user_notifications
  set read_at = null
  where id = target_notification and recipient_id = auth.uid();
  if not found then raise exception 'NOTIFICATION_NOT_FOUND'; end if;
end
$$;

create or replace function public.mark_communication_thread_unread(target_thread uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_use_communication_thread(target_thread) then raise exception 'FORBIDDEN'; end if;
  update public.communication_messages
  set read_at = null
  where thread_id = target_thread and sender_id <> auth.uid();
  update public.user_notifications
  set read_at = null
  where recipient_id = auth.uid() and kind = 'message' and entity_id = target_thread;
end
$$;

grant execute on function public.mark_user_notification_unread(uuid) to authenticated;
grant execute on function public.mark_communication_thread_unread(uuid) to authenticated;
