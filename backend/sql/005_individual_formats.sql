-- Individual tournament formats: round robin, single elimination and ladder.
-- Idempotent; safe on databases already using migrations 001-004.
create table if not exists division_entries (
  id uuid primary key,
  club_id uuid not null references clubs(id) on delete cascade,
  division_id uuid not null references divisions(id) on delete cascade,
  user_id varchar(128) not null,
  display_name varchar(160) not null,
  seed integer,
  rating numeric(4,2),
  rank integer,
  status varchar(16) not null default 'active',
  created_at timestamptz not null default now(),
  constraint uq_division_entry_user unique (division_id, user_id)
);
create index if not exists division_entries_club_idx on division_entries (club_id);
create index if not exists division_entries_division_idx on division_entries (division_id);
create index if not exists division_entries_user_idx on division_entries (user_id);

create table if not exists competition_matches (
  id uuid primary key,
  club_id uuid not null references clubs(id) on delete cascade,
  division_id uuid not null references divisions(id) on delete cascade,
  round_number integer not null default 1,
  round_name varchar(64) not null default 'regular',
  position integer not null default 0,
  player_one_id varchar(128),
  player_two_id varchar(128),
  winner_id varchar(128),
  score_one integer,
  score_two integer,
  score_text varchar(120),
  status varchar(16) not null default 'pending',
  reported_by varchar(128),
  starts_at timestamptz,
  next_match_id uuid references competition_matches(id) on delete set null,
  next_slot integer,
  created_at timestamptz not null default now()
);
create index if not exists competition_matches_club_idx on competition_matches (club_id);
create index if not exists competition_matches_division_idx on competition_matches (division_id);

alter table division_entries enable row level security;
alter table competition_matches enable row level security;
do $$
declare t text;
begin
  foreach t in array array['division_entries','competition_matches'] loop
    execute format('drop policy if exists tenant_select on %I', t);
    execute format('create policy tenant_select on %I for select using (public.is_club_member(club_id))', t);
    execute format('drop policy if exists tenant_staff_write on %I', t);
    execute format('create policy tenant_staff_write on %I for all using (public.is_club_staff(club_id)) with check (public.is_club_staff(club_id))', t);
  end loop;
end $$;
