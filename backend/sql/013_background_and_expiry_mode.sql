-- Challenge expiry mode: false counts from when a challenge was sent; true restarts on each new suggested time.
alter table clubs add column if not exists challenge_expiry_restarts boolean not null default false;
