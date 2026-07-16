-- ============================================================
-- NEOVOLT — restore the signup trigger + backfill missing rows
--
-- Run this ONCE in the Supabase SQL Editor (safe to re-run).
--
-- Why: the on_auth_user_created trigger was dropped at some point
-- during debugging, so users created since then have an auth.users
-- row but no profiles/stats rows. This script recreates the trigger
-- (identical to supabase/schema.sql) and backfills the missing rows.
-- ============================================================

-- ---- 1) Recreate the trigger function (same as schema.sql) ----
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

revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---- 1b) Self-heal policy: a signed-in user may create their OWN ----
-- profile row (normally the trigger does this; the game now repairs
-- accounts that signed up while the trigger was absent). Ownership is
-- enforced by auth.uid() = id; username rules by the table constraints.
drop policy if exists "create own profile" on public.profiles;
create policy "create own profile"
  on public.profiles for insert
  to authenticated
  with check ((select auth.uid()) = id);

-- ---- 2) Backfill users created while the trigger was missing ----
-- first pass: use the username they chose at signup where possible
insert into public.profiles (id, username)
select u.id,
       case
         when coalesce(u.raw_user_meta_data ->> 'username', '') ~ '^[A-Za-z0-9_]{3,16}$'
           then u.raw_user_meta_data ->> 'username'
         else 'player_' || substr(replace(u.id::text, '-', ''), 1, 8)
       end
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict do nothing;

-- second pass: generated name for anyone whose chosen name collided
insert into public.profiles (id, username)
select u.id, 'player_' || substr(replace(u.id::text, '-', ''), 1, 8)
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict do nothing;

insert into public.stats (user_id)
select u.id
from auth.users u
where not exists (select 1 from public.stats s where s.user_id = u.id);

-- ---- 3) Verify: every auth user must have a profile and stats ----
select u.email, p.username, (s.user_id is not null) as has_stats
from auth.users u
left join public.profiles p on p.id = u.id
left join public.stats  s on s.user_id = u.id
order by u.created_at desc;
