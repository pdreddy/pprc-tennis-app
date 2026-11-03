-- PPRC Rating, player profiles and player-reported results (formula pprc-rating-1.0).
create table if not exists player_profiles (
  id uuid primary key,
  club_id uuid not null references clubs(id) on delete cascade,
  user_id varchar(128) not null,
  display_name varchar(160) not null,
  city varchar(120),
  state varchar(60),
  home_club varchar(160),
  image_url varchar(500),
  preferred_sport varchar(40) not null default 'tennis',
  age_group varchar(40),
  gender_category varchar(40),
  visibility varchar(16) not null default 'club' check (visibility in ('public', 'club', 'private')),
  starting_singles numeric(5, 2) not null default 5 check (starting_singles between 1 and 16.5),
  starting_doubles numeric(5, 2) not null default 5 check (starting_doubles between 1 and 16.5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_player_profile_club_user unique (club_id, user_id)
);
create index if not exists ix_player_profiles_club_city on player_profiles (club_id, city);
create index if not exists ix_player_profiles_public on player_profiles (visibility) where visibility = 'public';

create table if not exists rated_matches (
  id uuid primary key,
  club_id uuid not null references clubs(id) on delete cascade,
  source varchar(16) not null default 'reported' check (source in ('reported', 'competition')),
  source_id varchar(64) unique,
  division_id uuid references divisions(id) on delete set null,
  kind varchar(16) not null check (kind in ('singles', 'doubles')),
  side_one jsonb not null default '[]',
  side_two jsonb not null default '[]',
  score_text varchar(120),
  games_one integer,
  games_two integer,
  winner_side integer check (winner_side in (1, 2)),
  outcome varchar(16) not null default 'completed' check (outcome in ('completed', 'retired', 'walkover', 'incomplete', 'no_score')),
  match_format varchar(16) not null default 'best_of_3',
  played_at timestamptz not null,
  status varchar(16) not null default 'reported' check (status in ('reported', 'finalized', 'disputed', 'cancelled')),
  rated boolean not null default false,
  reported_by varchar(128),
  confirmed_by varchar(128),
  dispute_reason text,
  correction_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ix_rated_matches_club_status_played on rated_matches (club_id, status, played_at);
create index if not exists ix_rated_matches_division on rated_matches (division_id);

create table if not exists player_ratings (
  id uuid primary key,
  club_id uuid not null references clubs(id) on delete cascade,
  user_id varchar(128) not null,
  kind varchar(16) not null check (kind in ('singles', 'doubles')),
  rating numeric(6, 4) not null check (rating between 1 and 16.5),
  reliability numeric(5, 1) not null default 0,
  verified_matches integer not null default 0,
  wins integer not null default 0,
  losses integer not null default 0,
  provisional boolean not null default true,
  last_played_at timestamptz,
  formula_version varchar(32) not null,
  updated_at timestamptz not null default now(),
  constraint uq_player_rating unique (club_id, user_id, kind)
);
create index if not exists ix_player_ratings_ranking on player_ratings (club_id, kind, rating desc, reliability desc);
create index if not exists ix_player_ratings_platform on player_ratings (kind, rating desc) where verified_matches > 0;

create table if not exists rating_history (
  id uuid primary key,
  club_id uuid not null references clubs(id) on delete cascade,
  user_id varchar(128) not null,
  kind varchar(16) not null,
  rated_match_id uuid not null references rated_matches(id) on delete cascade,
  rating_before numeric(6, 4) not null,
  rating_after numeric(6, 4) not null,
  played_at timestamptz not null,
  formula_version varchar(32) not null
);
create index if not exists ix_rating_history_player on rating_history (club_id, user_id, kind, played_at);

alter table player_profiles enable row level security;
alter table rated_matches enable row level security;
alter table player_ratings enable row level security;
alter table rating_history enable row level security;

-- Members read their club; private profiles only by the player or staff; public profiles by anyone.
drop policy if exists player_profiles_read on player_profiles;
create policy player_profiles_read on player_profiles for select using (
  visibility = 'public'
  or (visibility = 'club' and public.is_club_member(club_id))
  or user_id = current_setting('request.jwt.claim.sub', true)
  or public.is_club_staff(club_id)
);
drop policy if exists player_profiles_write_self on player_profiles;
create policy player_profiles_write_self on player_profiles for update using (user_id = current_setting('request.jwt.claim.sub', true));
drop policy if exists rated_matches_member_read on rated_matches;
create policy rated_matches_member_read on rated_matches for select using (public.is_club_member(club_id));
drop policy if exists player_ratings_member_read on player_ratings;
create policy player_ratings_member_read on player_ratings for select using (public.is_club_member(club_id));
drop policy if exists rating_history_member_read on rating_history;
create policy rating_history_member_read on rating_history for select using (public.is_club_member(club_id));
-- Ratings and history are written only by FastAPI (service role) during deterministic replay.
