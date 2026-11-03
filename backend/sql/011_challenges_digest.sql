-- Match challenges from the fair match finder, monthly club digest opt-in, admin test-email throttle.
create table if not exists challenges (
  id uuid primary key,
  club_id uuid not null references clubs(id) on delete cascade,
  challenger_id varchar(128) not null,
  opponent_id varchar(128) not null,
  kind varchar(16) not null default 'singles',
  proposed_at timestamptz,
  message varchar(280),
  status varchar(16) not null default 'pending',
  responded_at timestamptz,
  result_id uuid references rated_matches(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ix_challenges_club on challenges (club_id);
create index if not exists ix_challenges_challenger on challenges (challenger_id);
create index if not exists ix_challenges_opponent on challenges (opponent_id);
create index if not exists ix_challenges_status on challenges (status);
alter table challenges enable row level security;

alter table player_preferences add column if not exists monthly_digest boolean not null default false;
alter table player_preferences add column if not exists digest_sent_month varchar(7);
alter table player_preferences add column if not exists last_test_email_at timestamptz;
