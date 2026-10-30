-- Tenant isolation for direct Supabase access. FastAPI connects with the service role;
-- browser clients must receive a JWT with request.jwt.claim.sub set to the Firebase UID.
create or replace function public.is_club_member(target_club uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships
    where club_id = target_club
      and user_id = current_setting('request.jwt.claim.sub', true)
  );
$$;

create or replace function public.is_club_staff(target_club uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships
    where club_id = target_club
      and user_id = current_setting('request.jwt.claim.sub', true)
      and role in ('owner', 'admin', 'organizer')
  );
$$;

alter table clubs enable row level security;
alter table memberships enable row level security;
alter table events enable row level security;
alter table registrations enable row level security;
alter table matches enable row level security;
alter table payments enable row level security;
alter table audit_logs enable row level security;
alter table seasons enable row level security;
alter table divisions enable row level security;
alter table teams enable row level security;
alter table team_members enable row level security;
alter table fixtures enable row level security;
alter table player_appearances enable row level security;
alter table courts enable row level security;
alter table schedules enable row level security;
alter table standings enable row level security;
alter table notifications enable row level security;

do $$
declare t text;
begin
  foreach t in array array['memberships','events','registrations','matches','payments','audit_logs','seasons','divisions','teams','team_members','fixtures','player_appearances','courts','schedules','standings'] loop
    execute format('drop policy if exists tenant_select on %I', t);
    execute format('create policy tenant_select on %I for select using (public.is_club_member(club_id))', t);
    execute format('drop policy if exists tenant_staff_write on %I', t);
    execute format('create policy tenant_staff_write on %I for all using (public.is_club_staff(club_id)) with check (public.is_club_staff(club_id))', t);
  end loop;
end $$;

drop policy if exists club_member_select on clubs;
create policy club_member_select on clubs for select using (public.is_club_member(id));

drop policy if exists notification_owner_select on notifications;
create policy notification_owner_select on notifications for select
  using (user_id = current_setting('request.jwt.claim.sub', true) and public.is_club_member(club_id));
drop policy if exists notification_owner_update on notifications;
create policy notification_owner_update on notifications for update
  using (user_id = current_setting('request.jwt.claim.sub', true) and public.is_club_member(club_id))
  with check (user_id = current_setting('request.jwt.claim.sub', true) and public.is_club_member(club_id));
