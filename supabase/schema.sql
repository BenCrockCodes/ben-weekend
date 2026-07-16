-- ============================================================
-- NEOVOLT — Supabase schema (run in the SQL Editor of a fresh project)
--
-- Tables:  profiles, stats, messages, levels
-- Every table lives in the exposed `public` schema, so every table has
-- Row Level Security enabled with explicit least-privilege policies.
-- The browser only ever uses the publishable (anon) key; RLS is the
-- security boundary. The service_role key is never used by the game.
-- ============================================================

-- ---------------------------------------------------------- profiles ----
-- One row per account, created automatically by a trigger on signup.
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  username    text not null,
  icon        integer not null default 0 check (icon between 0 and 5),
  created_at  timestamptz not null default now(),
  constraint username_format check (username ~ '^[A-Za-z0-9_]{3,16}$')
);

-- usernames are unique case-insensitively
create unique index if not exists profiles_username_lower_idx
  on public.profiles (lower(username));

alter table public.profiles enable row level security;

-- everyone (including logged-out visitors) can view profiles
create policy "profiles are public"
  on public.profiles for select
  to anon, authenticated
  using (true);

-- users may update ONLY their own profile, and cannot re-own the row
create policy "own profile update"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- users may create their OWN profile row — normally the signup trigger
-- does this, but the game self-heals accounts whose signup ran while the
-- trigger was absent (see Backend.ensureProfile in js/backend/backend.js)
create policy "create own profile"
  on public.profiles for insert
  to authenticated
  with check ((select auth.uid()) = id);

-- no DELETE policy: rows are removed by the auth.users cascade.

-- ---------------------------------------------------------- stats ----
-- The player's full save (best %, attempts, coins) as one jsonb document.
create table if not exists public.stats (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.stats enable row level security;

-- stats are shown on public profiles
create policy "stats are public"
  on public.stats for select
  to anon, authenticated
  using (true);

create policy "own stats insert"
  on public.stats for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "own stats update"
  on public.stats for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------- messages ----
-- Wall messages: posted BY author_id ON the wall of profile_id.
create table if not exists public.messages (
  id          bigint generated always as identity primary key,
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  author_id   uuid not null references public.profiles (id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 280),
  created_at  timestamptz not null default now()
);

create index if not exists messages_wall_idx
  on public.messages (profile_id, created_at desc);

alter table public.messages enable row level security;

create policy "messages are public"
  on public.messages for select
  to anon, authenticated
  using (true);

-- you may only post as yourself
create policy "post as yourself"
  on public.messages for insert
  to authenticated
  with check ((select auth.uid()) = author_id);

-- the author OR the wall owner may delete a message
create policy "author or wall owner deletes"
  on public.messages for delete
  to authenticated
  using ((select auth.uid()) = author_id or (select auth.uid()) = profile_id);

-- ---------------------------------------------------------- levels ----
-- User-generated levels (upload/browse arrives in a future update, but
-- the table + policies are production-ready now).
create table if not exists public.levels (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 24),
  description text not null default '' check (char_length(description) <= 200),
  difficulty  text not null default 'Custom',
  song        text not null default '' check (char_length(song) <= 60),
  data        jsonb not null              -- the level definition (formatVersion 2)
              check (pg_column_size(data) <= 262144),   -- 256 KB cap
  published   boolean not null default false,
  downloads   integer not null default 0,
  likes       integer not null default 0, -- future-ready rating counter
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists levels_published_idx
  on public.levels (published, created_at desc);
create index if not exists levels_downloads_idx
  on public.levels (published, downloads desc);
create index if not exists levels_likes_idx
  on public.levels (published, likes desc);

alter table public.levels enable row level security;

-- published levels are browsable by everyone; owners always see their own
create policy "published levels are public"
  on public.levels for select
  to anon, authenticated
  using (published or (select auth.uid()) = owner_id);

create policy "own levels insert"
  on public.levels for insert
  to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "own levels update"
  on public.levels for update
  to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "own levels delete"
  on public.levels for delete
  to authenticated
  using ((select auth.uid()) = owner_id);

-- ---------------------------------------------------------- triggers ----

-- keep updated_at fresh
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger stats_touch before update on public.stats
  for each row execute function public.touch_updated_at();
create trigger levels_touch before update on public.levels
  for each row execute function public.touch_updated_at();

-- Create a profile row whenever a user signs up.
-- SECURITY DEFINER is required (the trigger fires as the auth admin and
-- must insert into public.profiles); it is safe here because the function
-- takes no caller input beyond the new auth row, pins search_path, and is
-- not callable by API roles (EXECUTE is revoked below).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  wanted text;
begin
  -- username arrives via signUp options.data; used ONLY as a display name
  -- (never for authorization — see Supabase security guidance)
  wanted := coalesce(new.raw_user_meta_data ->> 'username', '');
  if wanted !~ '^[A-Za-z0-9_]{3,16}$' then
    wanted := 'player_' || substr(replace(new.id::text, '-', ''), 1, 8);
  end if;
  -- fall back to a generated name if the wanted one is taken
  begin
    insert into public.profiles (id, username) values (new.id, wanted);
  exception when unique_violation then
    insert into public.profiles (id, username)
    values (new.id, 'player_' || substr(replace(new.id::text, '-', ''), 1, 8));
  end;
  insert into public.stats (user_id) values (new.id);
  return new;
end;
$$;

-- Players can play levels they don't own, so they can't UPDATE the row's
-- download counter themselves (least privilege). SECURITY DEFINER lets this
-- function bump the counter for PUBLISHED levels only — nothing else.
create or replace function public.record_level_download(level_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.levels
     set downloads = downloads + 1
   where id = level_id
     and published;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;
revoke execute on function public.record_level_download(uuid) from public;
grant  execute on function public.record_level_download(uuid) to anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------- grants ----
-- Depending on the project's Data API settings, new tables may need
-- explicit grants for the API roles (RLS still filters the rows).
grant usage on schema public to anon, authenticated;
grant select on public.profiles, public.stats, public.messages, public.levels to anon;
grant select, insert, update, delete on public.profiles, public.stats,
  public.messages, public.levels to authenticated;
