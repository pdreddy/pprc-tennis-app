-- TRIACE rubbers feed PPRC Rating: allow the 'triace' source on rated_matches.
alter table rated_matches drop constraint if exists rated_matches_source_check;
alter table rated_matches add constraint rated_matches_source_check check (source in ('reported', 'competition', 'triace'));
