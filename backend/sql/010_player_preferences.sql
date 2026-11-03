-- Weekly recap opt-in, verified email for delivery, and milestone notification bookkeeping.
create table if not exists player_preferences (
  id uuid primary key,
  club_id uuid not null references clubs(id) on delete cascade,
  user_id varchar(128) not null,
  email varchar(320),
  weekly_recap boolean not null default false,
  recap_sent_week varchar(10),
  milestones_notified jsonb not null default '[]',
  last_self_recap_at timestamptz,
  constraint uq_player_preference unique (club_id, user_id)
);
alter table player_preferences add column if not exists last_self_recap_at timestamptz;
create index if not exists ix_player_preferences_recap on player_preferences (club_id) where weekly_recap;
alter table player_preferences enable row level security;
-- Written and read only by FastAPI (service role); players never read other players' emails.
