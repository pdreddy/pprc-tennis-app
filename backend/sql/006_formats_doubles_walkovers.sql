-- Doubles entries and double-elimination loser routing. Idempotent; requires migration 005.
alter table division_entries add column if not exists partner_user_id varchar(128);
alter table division_entries add column if not exists partner_name varchar(160);
alter table competition_matches add column if not exists loser_match_id uuid references competition_matches(id) on delete set null;
alter table competition_matches add column if not exists loser_slot integer;
