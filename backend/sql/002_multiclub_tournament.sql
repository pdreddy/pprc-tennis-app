-- Apply after 001_initial.sql. These tables support TRIACE, leagues, fixtures, and notifications.
create table if not exists seasons (
  id uuid primary key default gen_random_uuid(), club_id uuid not null references clubs(id) on delete cascade,
  name text not null, starts_on date, ends_on date, status text not null default 'draft', unique(club_id, name)
);
create table if not exists divisions (
  id uuid primary key default gen_random_uuid(), club_id uuid not null references clubs(id) on delete cascade,
  event_id uuid references events(id) on delete cascade, name text not null, format text not null,
  min_rating numeric(4,2), max_rating numeric(4,2), capacity integer not null default 32, rules jsonb not null default '{}'::jsonb
);
create table if not exists teams (
  id uuid primary key default gen_random_uuid(), club_id uuid not null references clubs(id) on delete cascade,
  season_id uuid references seasons(id) on delete set null, division_id uuid references divisions(id) on delete set null,
  name text not null, captain_user_id text not null, status text not null default 'pending', metadata jsonb not null default '{}'::jsonb
);
create table if not exists team_members (
  id uuid primary key default gen_random_uuid(), club_id uuid not null references clubs(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade, user_id text not null, lineup_position integer,
  rating numeric(4,2), active boolean not null default true, unique(team_id, user_id)
);
create table if not exists courts (
  id uuid primary key default gen_random_uuid(), club_id uuid not null references clubs(id) on delete cascade,
  name text not null, venue text, active boolean not null default true, unique(club_id, name)
);
create table if not exists schedules (
  id uuid primary key default gen_random_uuid(), club_id uuid not null references clubs(id) on delete cascade,
  event_id uuid references events(id) on delete cascade, match_id uuid references matches(id) on delete cascade,
  court_id uuid references courts(id) on delete set null, starts_at timestamptz not null, ends_at timestamptz, status text not null default 'scheduled'
);
create table if not exists standings (
  id uuid primary key default gen_random_uuid(), club_id uuid not null references clubs(id) on delete cascade,
  event_id uuid references events(id) on delete cascade, division_id uuid references divisions(id) on delete cascade,
  subject_type text not null check (subject_type in ('player','team')), subject_id text not null,
  played integer not null default 0, wins integer not null default 0, losses integer not null default 0, points integer not null default 0,
  tiebreak jsonb not null default '{}'::jsonb, unique(event_id, division_id, subject_type, subject_id)
);
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(), club_id uuid not null references clubs(id) on delete cascade,
  user_id text not null, kind text not null, title text not null, body text not null, data jsonb not null default '{}'::jsonb,
  read_at timestamptz, created_at timestamptz not null default now()
);

create index if not exists teams_club_division_idx on teams(club_id, division_id);
create index if not exists schedules_club_starts_idx on schedules(club_id, starts_at);
create index if not exists notifications_user_created_idx on notifications(user_id, created_at desc);

-- Supabase RLS: the API uses its service role, while direct client access must be tenant scoped.
alter table seasons enable row level security;
alter table divisions enable row level security;
alter table teams enable row level security;
alter table team_members enable row level security;
alter table courts enable row level security;
alter table schedules enable row level security;
alter table standings enable row level security;
alter table notifications enable row level security;

create or replace function public.is_club_member(target_club uuid) returns boolean language sql stable as $$
  select exists (
    select 1 from memberships
    where club_id = target_club
      and user_id = current_setting('request.jwt.claim.sub', true)
  );
$$;

drop policy if exists "club members can read teams" on teams;
create policy "club members can read teams" on teams for select using (public.is_club_member(club_id));
drop policy if exists "users read own notifications" on notifications;
create policy "users read own notifications" on notifications for select using (user_id = current_setting('request.jwt.claim.sub', true));
