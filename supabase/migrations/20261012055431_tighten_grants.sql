-- Least-privilege table grants. Supabase grants anon and authenticated every privilege on new public tables and relies
-- on RLS; TRUNCATE (and REFERENCES/TRIGGER) are not governed by RLS, and the read-only tables need SELECT only.
-- Writes to shared data and the pool use the secret key (service_role), which these statements do not touch.
-- Guests are anonymous *authenticated* users, so the anon role (no session at all) needs no access to user rows.

-- Shared reference data and the team pool: read-only to clients.
revoke all on public.shared_files, public.pool_snapshots, public.pool_natures, public.pool_events, public.pool_players,
  public.pool_sets, public.pool_teams, public.pool_team_members, public.pool_species_usage, public.pool_spread_usage,
  public.pool_teammates from anon, authenticated;
grant select on public.shared_files, public.pool_snapshots, public.pool_natures, public.pool_events, public.pool_players,
  public.pool_sets, public.pool_teams, public.pool_team_members, public.pool_species_usage, public.pool_spread_usage,
  public.pool_teammates to anon, authenticated;

-- Per-user rows: signed-in users (including guests) read and write their own rows through RLS; nothing for anon.
revoke all on public.workspaces, public.user_files from anon, authenticated;
grant select, insert, update, delete on public.workspaces, public.user_files to authenticated;
