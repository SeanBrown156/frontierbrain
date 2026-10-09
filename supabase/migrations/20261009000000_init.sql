-- Frontier Brain hosted storage. Every user row is keyed on auth.uid(); guests are anonymous Supabase users.

-- The whole team/Pokémon workspace per user, saved with a revision check (optimistic concurrency).
create table public.workspaces (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  revision integer not null default 0,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- Everything else a user owns, addressed by workspace path: replays (originals and parsed), summaries,
-- digests, AI jobs, chats, profile and settings.
create table public.user_files (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  path text not null check (path !~ '(^/|\.\.)'),
  body text not null,
  encoding text not null default 'utf8' check (encoding in ('utf8', 'base64')),
  updated_at timestamptz not null default now(),
  primary key (user_id, path)
);

-- Shared reference data under knowledge/ (tournament pool, cached usage pages, icon sheet).
-- Readable by everyone; written only by the server with the secret key (which bypasses RLS).
create table public.shared_files (
  path text primary key check (path like 'knowledge/%'),
  body text not null,
  encoding text not null default 'utf8' check (encoding in ('utf8', 'base64')),
  updated_at timestamptz not null default now()
);

alter table public.workspaces enable row level security;
alter table public.user_files enable row level security;
alter table public.shared_files enable row level security;

create policy "Own workspace" on public.workspaces for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Own files" on public.user_files for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Shared data is readable" on public.shared_files for select to anon, authenticated using (true);
