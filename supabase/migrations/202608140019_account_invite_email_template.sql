-- Allow admin-created account credential emails in the shared delivery queue.

alter table public.email_deliveries
drop constraint if exists email_deliveries_template_check;

alter table public.email_deliveries
add constraint email_deliveries_template_check
check (template in ('account_invite', 'message', 'assessment', 'final_grade', 'material'));
