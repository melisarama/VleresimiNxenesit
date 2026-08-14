-- Edge retention worker uses the service role and still requires table privileges.

grant select, insert, update, delete on public.class_materials to service_role;
grant select, insert, update, delete on public.class_material_recipients to service_role;
grant select, insert, update, delete on public.class_material_files to service_role;
grant select, insert, update, delete on public.material_retention_warnings to service_role;
