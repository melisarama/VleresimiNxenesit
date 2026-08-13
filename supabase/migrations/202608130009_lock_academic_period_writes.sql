-- Academic period changes must pass through admin_save_academic_period so
-- active-period transitions and closed-period immutability cannot be bypassed.

revoke insert, update, delete on public.academic_periods from authenticated;

