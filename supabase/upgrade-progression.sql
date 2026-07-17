-- ============================================================
-- NEOVOLT — progression & community systems upgrade
-- (run once in the SQL Editor, after upgrade-community-levels.sql)
--
-- Adds:
--   · profiles: style (shared customisation), is_mod, creator_points,
--     triangles — with COLUMN-LEVEL grants so players can only ever
--     write their own display fields, never their own stats
--   · level_votes: community difficulty voting (1–10) with a trigger
--     keeping levels.community_difficulty = the most-voted option
--   · levels: community_difficulty / official_difficulty / rating
--   · level_completions + record_level_completion(): first-completion
--     Triangles, awarded server-side (clients cannot fake amounts)
--   · rate_level(): moderator-only official ratings that lock voting
--     and award Creator Points (amounts per rating type, extensible)
--   · weekly_levels + get_weekly_level(): one community level per week,
--     rolling over at 12:00 UK time each Sunday, picked in the DATABASE
--     (pg_cron when available, plus a self-healing fetch path), never
--     repeating a level
--
-- Safe to re-run.
-- ============================================================

-- ================================================= profiles ====

alter table public.profiles add column if not exists style          jsonb;
alter table public.profiles add column if not exists is_mod         boolean not null default false;
alter table public.profiles add column if not exists creator_points integer not null default 0;
alter table public.profiles add column if not exists triangles      integer not null default 0;

-- the ONLY moderator account (add future moderators manually, same way)
update public.profiles set is_mod = true where lower(username) = lower('BenCrockCodes');

-- players may update/insert only their display fields; stats and moderation
-- flags are written exclusively by SECURITY DEFINER functions below
revoke update on public.profiles from authenticated;
grant  update (username, icon, style) on public.profiles to authenticated;
revoke insert on public.profiles from authenticated;
grant  insert (id, username, icon, style) on public.profiles to authenticated;

-- ================================================= levels ====

alter table public.levels add column if not exists community_difficulty integer
  check (community_difficulty between 1 and 10);
alter table public.levels add column if not exists official_difficulty integer
  check (official_difficulty between 1 and 10);
alter table public.levels add column if not exists rating text
  check (rating in ('star', 'feature', 'epic'));

-- creators can no longer write difficulty/rating fields (kept insertable
-- for legacy clients; official_difficulty/rating are moderator-only)
revoke update on public.levels from authenticated;
grant  update (name, description, difficulty, song, data, published) on public.levels to authenticated;
revoke insert on public.levels from authenticated;
grant  insert (owner_id, name, description, difficulty, song, data, published) on public.levels to authenticated;

-- ================================================= difficulty votes ====

create table if not exists public.level_votes (
  level_id   uuid not null references public.levels (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  vote       integer not null check (vote between 1 and 10),
  created_at timestamptz not null default now(),
  primary key (level_id, user_id)
);

alter table public.level_votes enable row level security;

drop policy if exists "votes are public" on public.level_votes;
create policy "votes are public"
  on public.level_votes for select
  to anon, authenticated
  using (true);

-- you vote as yourself, and only while the level has no official rating
drop policy if exists "vote as yourself" on public.level_votes;
create policy "vote as yourself"
  on public.level_votes for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id and
    (select official_difficulty from public.levels where id = level_id) is null
  );

drop policy if exists "change own vote" on public.level_votes;
create policy "change own vote"
  on public.level_votes for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id and
    (select official_difficulty from public.levels where id = level_id) is null
  );

grant select on public.level_votes to anon;
grant select, insert, update on public.level_votes to authenticated;

-- keep levels.community_difficulty = the most-voted option (ties → easier)
create or replace function public.refresh_community_difficulty()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  lid uuid;
  best integer;
begin
  lid := coalesce(new.level_id, old.level_id);
  select vote into best
    from public.level_votes
   where level_id = lid
   group by vote
   order by count(*) desc, vote asc
   limit 1;
  update public.levels set community_difficulty = best where id = lid;
  return null;
end;
$$;
revoke execute on function public.refresh_community_difficulty() from public, anon, authenticated;

drop trigger if exists level_votes_refresh on public.level_votes;
create trigger level_votes_refresh
  after insert or update or delete on public.level_votes
  for each row execute function public.refresh_community_difficulty();

-- ================================================= completions & triangles ====

create table if not exists public.level_completions (
  user_id      uuid not null references public.profiles (id) on delete cascade,
  level_id     uuid not null references public.levels (id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (user_id, level_id)
);

alter table public.level_completions enable row level security;

drop policy if exists "own completions" on public.level_completions;
create policy "own completions"
  on public.level_completions for select
  to authenticated
  using ((select auth.uid()) = user_id);
-- no INSERT policy: rows are written only by record_level_completion()

grant select on public.level_completions to authenticated;

-- First completion of a community level → Triangles equal to the level's
-- FINAL difficulty (official if rated, else community vote, else 1).
-- Returns the amount awarded (0 on repeat completions).
create or replace function public.record_level_completion(p_level uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid;
  diff integer;
  awarded integer := 0;
begin
  uid := auth.uid();
  if uid is null then return 0; end if;
  select coalesce(official_difficulty, community_difficulty, 1) into diff
    from public.levels where id = p_level and published;
  if diff is null then return 0; end if;
  insert into public.level_completions (user_id, level_id)
       values (uid, p_level)
  on conflict do nothing;
  if found then
    awarded := diff;
    update public.profiles set triangles = triangles + awarded where id = uid;
  end if;
  return awarded;
end;
$$;
revoke execute on function public.record_level_completion(uuid) from public, anon;
grant  execute on function public.record_level_completion(uuid) to authenticated;

-- ================================================= moderator ratings ====

-- Official rating: locks community voting (via the policies above), sets
-- the permanent difficulty, and awards Creator Points on the first rating.
-- Point amounts per rating type live here — extend the CASE to change them.
create or replace function public.rate_level(p_level uuid, p_difficulty integer, p_rating text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid;
  owner uuid;
  previous text;
  had_official integer;
  points integer;
begin
  caller := auth.uid();
  if caller is null or
     not exists (select 1 from public.profiles where id = caller and is_mod) then
    raise exception 'Only moderators can rate levels';
  end if;
  if p_difficulty < 1 or p_difficulty > 10 then
    raise exception 'Difficulty must be between 1 and 10';
  end if;
  if p_rating is not null and p_rating not in ('star', 'feature', 'epic') then
    raise exception 'Rating must be star, feature or epic';
  end if;

  select owner_id, rating, official_difficulty
    into owner, previous, had_official
    from public.levels where id = p_level and published;
  if owner is null then raise exception 'Level not found'; end if;

  update public.levels
     set official_difficulty = p_difficulty, rating = p_rating
   where id = p_level;

  -- creator points: awarded once, when the level first receives a rating
  if had_official is null and previous is null and p_rating is not null then
    points := case p_rating
      when 'star'    then 1
      when 'feature' then 2
      when 'epic'    then 3
      else 0 end;
    update public.profiles
       set creator_points = creator_points + points
     where id = owner;
  end if;
end;
$$;
revoke execute on function public.rate_level(uuid, integer, text) from public, anon;
grant  execute on function public.rate_level(uuid, integer, text) to authenticated;

-- ================================================= weekly level ====

create table if not exists public.weekly_levels (
  week_start date primary key,    -- the Sunday (12:00 Europe/London) it began
  level_id   uuid not null unique references public.levels (id) on delete cascade,
  picked_at  timestamptz not null default now()
);
-- `unique level_id` guarantees a level can never be the weekly twice

alter table public.weekly_levels enable row level security;

drop policy if exists "weekly is public" on public.weekly_levels;
create policy "weekly is public"
  on public.weekly_levels for select
  to anon, authenticated
  using (true);

grant select on public.weekly_levels to anon, authenticated;

-- The Sunday the CURRENT weekly week began: weeks roll over at 12:00 UK
-- time each Sunday (before noon on Sunday, last week's pick is still live).
create or replace function public.current_week_start()
returns date
language sql
stable
set search_path = ''
as $$
  select (date_trunc('week',
            ((now() at time zone 'Europe/London') - interval '12 hours')
            + interval '1 day')::date - 1);
$$;

-- Pick this week's level if it hasn't been picked yet. Runs entirely in
-- the database; random among published levels never featured before.
create or replace function public.ensure_weekly_level()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  wk date;
  pick uuid;
begin
  wk := public.current_week_start();
  if exists (select 1 from public.weekly_levels where week_start = wk) then return; end if;
  select id into pick
    from public.levels
   where published
     and id not in (select level_id from public.weekly_levels)
   order by random()
   limit 1;
  if pick is null then return; end if;   -- every level already featured
  begin
    insert into public.weekly_levels (week_start, level_id) values (wk, pick)
    on conflict (week_start) do nothing;
  exception when unique_violation then null;   -- concurrent pick — keep first
  end;
end;
$$;
revoke execute on function public.ensure_weekly_level() from public, anon, authenticated;

-- Client entry point: returns the current weekly level id. Self-healing —
-- if the scheduler hasn't run (or pg_cron isn't enabled), the first fetch
-- after the Sunday deadline performs the pick, still entirely server-side.
create or replace function public.get_weekly_level()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare lid uuid;
begin
  perform public.ensure_weekly_level();
  select level_id into lid
    from public.weekly_levels
   where week_start = public.current_week_start();
  return lid;
end;
$$;
revoke execute on function public.get_weekly_level() from public;
grant  execute on function public.get_weekly_level() to anon, authenticated;

-- Primary scheduler when the pg_cron extension is enabled on the project:
-- Sundays at 11:05 and 12:05 UTC (covers UK summer/winter time; the week
-- key above makes early/late runs harmless and idempotent).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('neovolt-weekly-level', '5 11,12 * * 0',
                          'select public.ensure_weekly_level()');
  end if;
exception when others then
  raise notice 'pg_cron not available — weekly level will self-heal on fetch';
end;
$$;

-- ================================================= verify ====

select 'profiles cols' as check_, count(*) from information_schema.columns
 where table_schema = 'public' and table_name = 'profiles'
   and column_name in ('style', 'is_mod', 'creator_points', 'triangles')
union all
select 'levels cols', count(*) from information_schema.columns
 where table_schema = 'public' and table_name = 'levels'
   and column_name in ('community_difficulty', 'official_difficulty', 'rating')
union all
select 'new tables', count(*) from information_schema.tables
 where table_schema = 'public'
   and table_name in ('level_votes', 'level_completions', 'weekly_levels');
