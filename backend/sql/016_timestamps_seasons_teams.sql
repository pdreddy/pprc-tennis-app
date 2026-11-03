-- The models give every table created_at/updated_at (Timestamped); seasons and teams were created without them.
alter table seasons add column if not exists created_at timestamptz not null default now();
alter table seasons add column if not exists updated_at timestamptz not null default now();
alter table teams add column if not exists created_at timestamptz not null default now();
alter table teams add column if not exists updated_at timestamptz not null default now();
