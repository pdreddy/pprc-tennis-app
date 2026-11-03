-- Databases created by the app's create_all() used native PostgreSQL enum types for status/role columns,
-- while the SQL migrations (and the models now) use plain text. Converge them; a no-op on migrated databases.
do $$
declare col record;
begin
  for col in
    select c.table_name, c.column_name, c.column_default
    from information_schema.columns c
    where c.table_schema = 'public' and c.data_type = 'USER-DEFINED'
      and c.udt_name in ('membershiprole', 'eventstatus', 'registrationstatus', 'teamstatus', 'fixturestatus')
  loop
    execute format('alter table %I alter column %I drop default', col.table_name, col.column_name);
    execute format('alter table %I alter column %I type text using %I::text', col.table_name, col.column_name, col.column_name);
  end loop;
end $$;
