-- The five newest authentication events on the linked project (Track B B2,
-- migration 0070). Run from WILSON/ with the CLI linked to the project you
-- just signed in to:  supabase db query --linked --file scripts/probes/auth-events-recent.sql
-- No secrets, no addresses: kinds, outcomes, factor and times only.
select inet_server_addr() as server,
       (select count(*) from public.workspaces) as workspaces,
       kind, outcome, source, factor_type, created_at
  from public.auth_events
 order by created_at desc
 limit 5;
