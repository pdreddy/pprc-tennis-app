-- TRIACE score submission, opposing-captain confirmation, and dispute metadata.
-- Safe on both a fresh database and a database already using migrations 001-003.
alter table fixtures
  add column if not exists result_detail jsonb not null default '{}'::jsonb;

create index if not exists fixtures_reported_idx
  on fixtures (club_id, status)
  where status = 'reported';
