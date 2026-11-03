-- Day-before ladder deadline warnings and a free-text court on match challenges.
alter table competition_matches add column if not exists deadline_warned_at timestamptz;
alter table challenges add column if not exists court varchar(80);
