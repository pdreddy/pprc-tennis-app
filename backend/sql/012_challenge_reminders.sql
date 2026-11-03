-- Challenge reminders, configurable expiry, back-and-forth time suggestions.
alter table clubs add column if not exists challenge_expiry_days integer not null default 7;
alter table challenges add column if not exists awaiting_id varchar(128);
alter table challenges add column if not exists last_action_at timestamptz;
alter table challenges add column if not exists reminded_at timestamptz;
update challenges set awaiting_id = opponent_id, last_action_at = created_at where status = 'pending' and awaiting_id is null;
