-- Supabase-compatible migration. Apply with: psql "$DATABASE_URL" -f backend/sql/001_initial.sql
-- FastAPI bootstraps the same tables for a local Docker run; use this file for hosted environments.
create extension if not exists pgcrypto;

create table if not exists clubs (
  id uuid primary key default gen_random_uuid(), slug text not null unique, name text not null, sport text not null default 'tennis',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists memberships (
  id uuid primary key default gen_random_uuid(), club_id uuid not null references clubs(id) on delete cascade,
  user_id text not null, display_name text not null, role text not null check (role in ('owner','admin','organizer','player','support')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(club_id, user_id)
);
create table if not exists events (
  id uuid primary key default gen_random_uuid(), club_id uuid not null references clubs(id) on delete cascade,
  name text not null, starts_at timestamptz not null, capacity integer not null check (capacity > 1), entry_fee_cents integer not null default 0,
  status text not null default 'draft' check (status in ('draft','published','closed','completed')), rules jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists registrations (
  id uuid primary key default gen_random_uuid(), club_id uuid not null references clubs(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade, user_id text not null,
  status text not null check (status in ('pending','confirmed','waitlisted','withdrawn')), waitlist_position integer,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(event_id, user_id)
);
create table if not exists matches (
  id uuid primary key default gen_random_uuid(), club_id uuid not null references clubs(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade, player_one_id text not null, player_two_id text not null,
  score text, winner_id text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists payments (
  id uuid primary key default gen_random_uuid(), club_id uuid not null references clubs(id) on delete cascade,
  registration_id uuid not null references registrations(id), provider text not null default 'stripe', provider_reference text not null unique,
  amount_cents integer not null, status text not null default 'pending', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(), club_id uuid not null references clubs(id) on delete cascade,
  actor_id text not null, action text not null, entity_type text not null, entity_id text not null, detail text,
  created_at timestamptz not null default now()
);
create index if not exists events_club_starts_idx on events(club_id, starts_at);
create index if not exists registrations_event_status_idx on registrations(event_id, status);
create index if not exists audit_logs_club_created_idx on audit_logs(club_id, created_at desc);
