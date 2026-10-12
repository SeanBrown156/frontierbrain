-- The tournament team pool as relational tables (filled by tools/pool-db.ts from knowledge/pool/teams.json).
-- Shared reference data: readable by everyone, written only by the loader with the secret key (bypasses RLS).
-- Lanes are never blended: official = Limitless official events (Day 2 lists, no stat points), online = Limitless
-- online tournaments (no stat points), shared = VGCPastes pastes (exact stat points). Species, items, abilities,
-- moves and natures are text checked by the app's Showdown engine at load time (names it cannot resolve are stored
-- as written and listed in pool_sets.unresolved), not foreign keys: the engine changes per regulation.
-- Every row carries refreshed_at = the pool snapshot it came from; a reload upserts by natural key and then deletes
-- rows from older snapshots.

-- One row per loaded pool snapshot (teams.json refreshedAt), with row counts and unresolved-name counts.
create table public.pool_snapshots (
  refreshed_at timestamptz primary key,
  loaded_at timestamptz,
  counts jsonb not null default '{}',
  unresolved jsonb not null default '{}'
);

-- Nature lookup for deriving final stats (Champions: +10% / -10%, neutral natures have neither).
create table public.pool_natures (
  name text primary key,
  plus text check (plus in ('atk', 'def', 'spa', 'spd', 'spe')),
  minus text check (minus in ('atk', 'def', 'spa', 'spd', 'spe')),
  check ((plus is null) = (minus is null) and (plus is null or plus <> minus))
);
insert into public.pool_natures (name, plus, minus) values
  ('Adamant', 'atk', 'spa'), ('Bashful', null, null), ('Bold', 'def', 'atk'), ('Brave', 'atk', 'spe'),
  ('Calm', 'spd', 'atk'), ('Careful', 'spd', 'spa'), ('Docile', null, null), ('Gentle', 'spd', 'def'),
  ('Hardy', null, null), ('Hasty', 'spe', 'def'), ('Impish', 'def', 'spa'), ('Jolly', 'spe', 'spa'),
  ('Lax', 'def', 'spd'), ('Lonely', 'atk', 'def'), ('Mild', 'spa', 'def'), ('Modest', 'spa', 'atk'),
  ('Naive', 'spe', 'spd'), ('Naughty', 'atk', 'spd'), ('Quiet', 'spa', 'spe'), ('Quirky', null, null),
  ('Rash', 'spa', 'spd'), ('Relaxed', 'def', 'spe'), ('Sassy', 'spd', 'spe'), ('Serious', null, null),
  ('Timid', 'spe', 'atk');

-- Tournaments (official and online lanes). Shared pastes carry only a free-text event label on the team.
create table public.pool_events (
  id text primary key,                         -- '<lane>:<source event id>', e.g. 'official:444'
  lane text not null check (lane in ('official', 'online')),
  source_event_id text not null,
  name text not null,
  event_date date,
  format text not null,                        -- regulation the pool was collected for, e.g. 'M-C'
  players_count integer check (players_count > 0),
  source text not null,                        -- 'Limitless' | 'Limitless online'
  url text,
  refreshed_at timestamptz not null,
  unique (lane, source_event_id)
);

-- Players by normalised name (lowercase ASCII letters/digits, as tools/pool.ts playerKey). Name-based identity:
-- two people with the same name are one row.
create table public.pool_players (
  id text primary key,
  name text not null,                          -- display name from the player's most recent team
  refreshed_at timestamptz not null
);

-- Distinct sets (deduplicated by content hash). Stat points (SP) only when the source has them (VGCPastes):
-- all six present or all six null. Champions: 0-32 per stat, 66 total at most. Final stats are derived, not stored.
create table public.pool_sets (
  id text primary key,                         -- sha1 of species, item, ability, nature, moves, SP
  species text not null,
  base_species text not null,                  -- Showdown baseSpecies (forms and megas count as the base)
  item text,
  ability text,
  nature text,
  moves text[] not null default '{}' check (cardinality(moves) <= 4 and array_position(moves, null) is null),
  hp_sp smallint check (hp_sp between 0 and 32),
  atk_sp smallint check (atk_sp between 0 and 32),
  def_sp smallint check (def_sp between 0 and 32),
  spa_sp smallint check (spa_sp between 0 and 32),
  spd_sp smallint check (spd_sp between 0 and 32),
  spe_sp smallint check (spe_sp between 0 and 32),
  unresolved text[] not null default '{}' check (unresolved <@ array['species', 'item', 'ability', 'nature', 'moves']),
  refreshed_at timestamptz not null,
  constraint pool_sets_sp_all_or_none check (
    num_nulls(hp_sp, atk_sp, def_sp, spa_sp, spd_sp, spe_sp) in (0, 6)),
  constraint pool_sets_sp_total check (
    coalesce(hp_sp + atk_sp + def_sp + spa_sp + spd_sp + spe_sp, 0) <= 66)
);

-- One row per pooled team (natural key from teams.json, e.g. 'official:444:1:juanfranciscosalerno').
create table public.pool_teams (
  id text primary key,
  lane text not null check (lane in ('official', 'online', 'shared')),
  event_id text references public.pool_events (id),
  event_label text,                            -- the event as the source wrote it (shared pastes: free text)
  player_id text references public.pool_players (id),
  player_name text not null,
  place integer check (place > 0),               -- final standing ("placing" is reserved in Postgres)
  wins smallint check (wins >= 0),
  losses smallint check (losses >= 0),
  ties smallint check (ties >= 0),
  source_url text not null,                    -- the team list (Limitless) or the paste (shared lane)
  shared_paste_url text,                       -- VGCPastes paste that supplied stat points, when any
  observed_on date,                            -- event date, or the paste's date for the shared lane
  refreshed_at timestamptz not null,
  check ((lane = 'shared') = (event_id is null)),
  check (num_nulls(wins, losses, ties) in (0, 3))
);

create table public.pool_team_members (
  team_id text not null references public.pool_teams (id) on delete cascade,
  slot smallint not null check (slot between 1 and 6),
  set_id text not null references public.pool_sets (id),
  primary key (team_id, slot)
);

create index pool_sets_base_species_idx on public.pool_sets (base_species);
create index pool_sets_species_idx on public.pool_sets (species);
create index pool_sets_moves_idx on public.pool_sets using gin (moves);
create index pool_sets_refreshed_idx on public.pool_sets (refreshed_at);
create index pool_team_members_set_idx on public.pool_team_members (set_id);
create index pool_teams_lane_idx on public.pool_teams (lane, observed_on);
create index pool_teams_event_idx on public.pool_teams (event_id);
create index pool_teams_player_idx on public.pool_teams (player_id);
create index pool_teams_refreshed_idx on public.pool_teams (refreshed_at);
create index pool_events_date_idx on public.pool_events (event_date);
create index pool_events_refreshed_idx on public.pool_events (refreshed_at);
create index pool_players_refreshed_idx on public.pool_players (refreshed_at);

alter table public.pool_snapshots enable row level security;
alter table public.pool_natures enable row level security;
alter table public.pool_events enable row level security;
alter table public.pool_players enable row level security;
alter table public.pool_sets enable row level security;
alter table public.pool_teams enable row level security;
alter table public.pool_team_members enable row level security;
create policy "Pool is readable" on public.pool_snapshots for select to anon, authenticated using (true);
create policy "Pool is readable" on public.pool_natures for select to anon, authenticated using (true);
create policy "Pool is readable" on public.pool_events for select to anon, authenticated using (true);
create policy "Pool is readable" on public.pool_players for select to anon, authenticated using (true);
create policy "Pool is readable" on public.pool_sets for select to anon, authenticated using (true);
create policy "Pool is readable" on public.pool_teams for select to anon, authenticated using (true);
create policy "Pool is readable" on public.pool_team_members for select to anon, authenticated using (true);

-- Species usage per lane: teams in the lane that include the species (forms counted under the base species, once
-- per team) over all teams in that lane. Lanes are separate rows; never add their percentages together.
create view public.pool_species_usage with (security_invoker = true) as
with lane_totals as (
  select lane, count(*) as lane_teams from public.pool_teams group by lane
), team_species as (
  select distinct t.id, t.lane, s.base_species
  from public.pool_teams t
  join public.pool_team_members m on m.team_id = t.id
  join public.pool_sets s on s.id = m.set_id
)
select ts.lane, ts.base_species as species, count(*)::integer as teams, lt.lane_teams::integer as lane_teams,
  round(100.0 * count(*) / lt.lane_teams, 1) as percent
from team_species ts join lane_totals lt using (lane)
group by ts.lane, ts.base_species, lt.lane_teams;

-- Exact stat-point spreads per species. Stat points come only from VGCPastes pastes: unmatched pastes (shared lane)
-- and pastes merged into the matching tournament team (official/online lane), each paste counted once. Matches
-- tools/pool.ts poolSets: per team, the first set of that base species. percent = share of that species' sets with SP.
create view public.pool_spread_usage with (security_invoker = true) as
with picked as (
  select distinct on (m.team_id, s.base_species) m.team_id, t.lane, s.base_species, s.nature,
    s.hp_sp, s.atk_sp, s.def_sp, s.spa_sp, s.spd_sp, s.spe_sp
  from public.pool_team_members m
  join public.pool_sets s on s.id = m.set_id
  join public.pool_teams t on t.id = m.team_id
  order by m.team_id, s.base_species, m.slot
), with_sp as (
  select * from picked where hp_sp is not null
)
select base_species as species, nature, hp_sp, atk_sp, def_sp, spa_sp, spd_sp, spe_sp,
  count(*)::integer as sets,
  (count(*) filter (where lane = 'shared'))::integer as from_shared_lane,
  (count(*) filter (where lane <> 'shared'))::integer as merged_into_tournament_team,
  (sum(count(*)) over (partition by base_species))::integer as species_sets_with_sp,
  round(100.0 * count(*) / sum(count(*)) over (partition by base_species), 1) as percent,
  'VGCPastes'::text as spread_source
from with_sp
group by base_species, nature, hp_sp, atk_sp, def_sp, spa_sp, spd_sp, spe_sp;

-- Teammates per lane: of the lane's teams that include a species (base), how many also include each other Pokémon
-- (named as listed, so forms stay distinct, as in tools/pool.ts).
create view public.pool_teammates with (security_invoker = true) as
with members as (
  select t.id as team_id, t.lane, s.species, s.base_species
  from public.pool_teams t
  join public.pool_team_members m on m.team_id = t.id
  join public.pool_sets s on s.id = m.set_id
), species_teams as (
  select lane, base_species, count(distinct team_id) as teams from members group by lane, base_species
)
select a.lane, a.base_species as species, b.species as teammate, count(distinct a.team_id)::integer as teams,
  st.teams::integer as species_teams, round(100.0 * count(distinct a.team_id) / st.teams, 1) as percent
from members a
join members b on b.team_id = a.team_id and b.base_species <> a.base_species
join species_teams st on st.lane = a.lane and st.base_species = a.base_species
group by a.lane, a.base_species, b.species, st.teams;
