-- ============================================================
-- NEOVOLT — community levels upgrade (run once in the SQL Editor)
--
-- Adds to the existing `levels` table:
--   · song   — display-only song title for level cards (avoids fetching
--              the full jsonb payload just to show a song name)
--   · likes  — future-ready rating counter (sortable now, writable when
--              the like system ships)
--   · a payload size cap so a hostile client can't store megabytes
--   · sort indexes for the community browser
--   · record_level_download(uuid) — counts a download/play without
--     letting players update rows they don't own
--
-- Safe to re-run. The game works before AND after this script
-- (the frontend falls back to the legacy columns until it runs).
-- ============================================================

alter table public.levels add column if not exists song  text    not null default '';
alter table public.levels add column if not exists likes integer not null default 0;

-- keep uploads a sane size (the whole game is ~120 KB — a level should
-- never be bigger than the game)
alter table public.levels drop constraint if exists levels_data_size;
alter table public.levels add constraint levels_data_size
  check (pg_column_size(data) <= 262144);   -- 256 KB

alter table public.levels drop constraint if exists levels_song_len;
alter table public.levels add constraint levels_song_len
  check (char_length(song) <= 60);

-- browser sort orders: newest (existing levels_published_idx), popular, top
create index if not exists levels_downloads_idx
  on public.levels (published, downloads desc);
create index if not exists levels_likes_idx
  on public.levels (published, likes desc);

-- Players can play levels they don't own, so they can't UPDATE the row's
-- download counter themselves (least privilege). This function bumps the
-- counter for PUBLISHED levels only, nothing else.
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

revoke execute on function public.record_level_download(uuid) from public;
grant  execute on function public.record_level_download(uuid) to anon, authenticated;

-- ---- verify ----
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'levels'
 order by ordinal_position;
