-- =====================================================================
--  BRAIN ARCADE + QUEST PROOF — Supabase database setup
--  Paste this whole file into Supabase → SQL Editor → New query → Run.
--  Safe to run once on a fresh project.
--
--  Security model (short version):
--   * Every table has Row Level Security switched on.
--   * You can only ever read/write your own quests.
--   * A proof is visible only to its owner and to the ONE friend it was
--     sent to — and only while you are still friends and nobody is blocked.
--   * Photos live in a PRIVATE storage bucket, in a folder named after the
--     owner's user id. Friends can only open a photo file if it is attached
--     to a proof that was sent to them.
--   * Coins can only be added by server functions, never removed, and
--     never typed in by the app directly.
--   * Invite codes only create a friendship between two signed-in people.
--     They never grant access to anything else.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- PROFILES
-- ---------------------------------------------------------------------
create table public.profiles (
  id                   uuid primary key references auth.users(id) on delete cascade,
  display_name         text not null default 'Player'
                         check (char_length(btrim(display_name)) between 1 and 30),
  mascot               text not null default 'bleep'
                         check (mascot in ('bleep','coinny','zap','pip')),
  show_on_leaderboard  boolean not null default true,  -- do friends see my score?
  leaderboard_enabled  boolean not null default true,  -- do I see the board at all?
  created_at           timestamptz not null default now()
);

-- Auto-create a profile when someone signs up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id,
          coalesce(nullif(btrim(left(new.raw_user_meta_data->>'display_name', 30)), ''), 'Player'))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- FRIENDS, INVITES, BLOCKS
-- ---------------------------------------------------------------------
-- One row per direction: (me → friend) and (friend → me).
create table public.friendships (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  friend_id  uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);

create table public.blocks (
  blocker_id   uuid not null references public.profiles(id) on delete cascade,
  blocked_id   uuid not null references public.profiles(id) on delete cascade,
  blocked_name text not null default 'Player',
  created_at   timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

create table public.invites (
  code        text primary key,
  inviter_id  uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '7 days',
  used_by     uuid references public.profiles(id) on delete set null,
  used_at     timestamptz
);

-- Throttle for guessing invite codes.
create table public.invite_attempts (
  id         bigserial primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index on public.invite_attempts (user_id, created_at);

-- True when a and b are connected friends and neither has blocked the other.
create or replace function public.is_friend(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select a is not null and b is not null and a <> b
     and exists (select 1 from friendships f where f.user_id = a and f.friend_id = b)
     and exists (select 1 from friendships f where f.user_id = b and f.friend_id = a)
     and not exists (select 1 from blocks k
                     where (k.blocker_id = a and k.blocked_id = b)
                        or (k.blocker_id = b and k.blocked_id = a));
$$;

-- ---------------------------------------------------------------------
-- QUESTS (tasks) + MINI-QUESTS (steps)
-- ---------------------------------------------------------------------
create table public.quests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  title         text not null check (char_length(btrim(title)) between 1 and 120),
  emoji         text not null default '⭐' check (char_length(emoji) <= 8),
  status        text not null default 'active' check (status in ('active','done')),
  outcome       text check (outcome in ('full','partial')),
  created_at    timestamptz not null default now(),
  completed_at  timestamptz
);
create index on public.quests (user_id, status, created_at desc);

create table public.mini_quests (
  id          uuid primary key default gen_random_uuid(),
  quest_id    uuid not null references public.quests(id) on delete cascade,
  user_id     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  title       text not null check (char_length(btrim(title)) between 1 and 80),
  done        boolean not null default false,
  position    int not null default 0,
  created_at  timestamptz not null default now()
);
create index on public.mini_quests (quest_id, position);

-- Mini-quests must belong to a quest owned by the same person.
create or replace function public.check_mini_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from quests q where q.id = new.quest_id and q.user_id = new.user_id) then
    raise exception 'Quest not found';
  end if;
  return new;
end $$;
create trigger mini_owner_check before insert or update on public.mini_quests
  for each row execute function public.check_mini_owner();

-- ---------------------------------------------------------------------
-- COINS — append-only ledger. Amount is always positive. No app writes.
-- ---------------------------------------------------------------------
create table public.coin_ledger (
  id          bigserial primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  amount      int  not null check (amount > 0 and amount <= 100),
  reason      text not null check (reason in
                ('mini','quest','quest_partial','proof','friend_bonus','cheer_given','challenge')),
  ref_id      uuid not null,           -- the mini-quest / quest / proof it was for
  group_id    uuid,                    -- e.g. the quest a mini-quest belongs to
  from_user   uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (user_id, reason, ref_id)     -- each thing pays out once, ever
);
create index on public.coin_ledger (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- QUEST PROOF
-- ---------------------------------------------------------------------
create table public.proofs (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  friend_id    uuid not null references public.profiles(id) on delete cascade,
  quest_id     uuid references public.quests(id) on delete set null,
  quest_title  text not null check (char_length(quest_title) between 1 and 120),
  quest_emoji  text not null default '⭐' check (char_length(quest_emoji) <= 8),
  progress     jsonb not null default '[]'::jsonb,  -- snapshot of mini-quests the owner chose to include
  outcome      text check (outcome in ('full','partial')),
  caption      text check (char_length(caption) <= 200),
  -- sending  = still uploading, invisible to friend
  -- pending  = waiting for friend
  -- clarify  = friend asked a gentle question
  -- verified = friend approved
  -- withdrawn= friendship ended; friend can no longer see it
  status       text not null default 'sending'
                 check (status in ('sending','pending','clarify','verified','withdrawn')),
  created_at   timestamptz not null default now(),
  sent_at      timestamptz,
  verified_at  timestamptz,
  seen_by_owner boolean not null default true,      -- for the celebration animation
  friend_access boolean not null default true,      -- switched off for good on disconnect/block
  check (owner_id <> friend_id),
  check (octet_length(progress::text) < 8000)
);
create index on public.proofs (friend_id, status, created_at desc);
create index on public.proofs (owner_id, created_at desc);

create table public.proof_photos (
  id            uuid primary key default gen_random_uuid(),
  proof_id      uuid not null references public.proofs(id) on delete cascade,
  owner_id      uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  kind          text not null check (kind in ('before','after','extra')),
  storage_path  text not null unique,
  width         int,
  height        int,
  created_at    timestamptz not null default now()
);
create index on public.proof_photos (proof_id);

create table public.proof_reactions (
  proof_id    uuid not null references public.proofs(id) on delete cascade,
  user_id     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  emoji       text not null check (emoji in ('🎉','🔥','💪','🌟','💖','👏','🏆','🚀')),
  created_at  timestamptz not null default now(),
  primary key (proof_id, user_id, emoji)
);

create table public.proof_comments (
  id          uuid primary key default gen_random_uuid(),
  proof_id    uuid not null references public.proofs(id) on delete cascade,
  author_id   uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  body        text not null check (char_length(btrim(body)) between 1 and 500),
  kind        text not null default 'cheer' check (kind in ('cheer','clarify','reply')),
  created_at  timestamptz not null default now()
);
create index on public.proof_comments (proof_id, created_at);

create table public.badges (
  id          uuid primary key default gen_random_uuid(),
  proof_id    uuid references public.proofs(id) on delete set null,
  from_user   uuid references public.profiles(id) on delete set null,
  to_user     uuid not null references public.profiles(id) on delete cascade,
  badge_key   text not null check (badge_key in
                ('legend','glowup','brave','tidy','focus','comeback','kind','starter')),
  created_at  timestamptz not null default now(),
  unique (proof_id, badge_key)
);
create index on public.badges (to_user, created_at desc);

-- Who may see a proof (and therefore its photos, reactions and comments)?
create or replace function public.can_see_proof(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from proofs p
     where p.id = pid
       and ( p.owner_id = auth.uid()
          or ( p.friend_id = auth.uid()
               and p.friend_access
               and p.status in ('pending','clarify','verified')
               and is_friend(auth.uid(), p.owner_id) ) )
  );
$$;

-- ---------------------------------------------------------------------
-- SHARED CHALLENGES (cooperative: the team works toward one goal)
-- ---------------------------------------------------------------------
create table public.challenges (
  id          uuid primary key default gen_random_uuid(),
  creator_id  uuid not null references public.profiles(id) on delete cascade,
  title       text not null check (char_length(btrim(title)) between 1 and 60),
  goal        int  not null check (goal between 1 and 100),
  starts_at   timestamptz not null default now(),
  ends_at     timestamptz not null,
  created_at  timestamptz not null default now()
);

create table public.challenge_members (
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  status       text not null default 'invited' check (status in ('invited','joined')),
  joined_at    timestamptz,
  primary key (challenge_id, user_id)
);

create or replace function public.is_challenge_member(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from challenge_members m where m.challenge_id = cid and m.user_id = auth.uid());
$$;

-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================
alter table public.profiles          enable row level security;
alter table public.friendships       enable row level security;
alter table public.blocks            enable row level security;
alter table public.invites           enable row level security;
alter table public.invite_attempts   enable row level security;
alter table public.quests            enable row level security;
alter table public.mini_quests       enable row level security;
alter table public.coin_ledger       enable row level security;
alter table public.proofs            enable row level security;
alter table public.proof_photos      enable row level security;
alter table public.proof_reactions   enable row level security;
alter table public.proof_comments    enable row level security;
alter table public.badges            enable row level security;
alter table public.challenges        enable row level security;
alter table public.challenge_members enable row level security;

-- Nobody signed-out gets anything.
revoke all on all tables in schema public from anon;

-- PROFILES: me, plus my current friends.
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.is_friend((select auth.uid()), id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- FRIENDSHIPS / BLOCKS / INVITES: read your own rows; changes only via functions.
create policy friendships_select on public.friendships for select to authenticated
  using (user_id = (select auth.uid()));
create policy blocks_select on public.blocks for select to authenticated
  using (blocker_id = (select auth.uid()));
create policy invites_select on public.invites for select to authenticated
  using (inviter_id = (select auth.uid()));
create policy invites_delete on public.invites for delete to authenticated
  using (inviter_id = (select auth.uid()) and used_by is null);
-- invite_attempts: no policies → no direct access at all.

-- QUESTS / MINI-QUESTS: owner only.
create policy quests_all on public.quests for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy mini_all on public.mini_quests for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- COINS: read your own. No insert/update/delete policies → app cannot write.
create policy coins_select on public.coin_ledger for select to authenticated
  using (user_id = (select auth.uid()));

-- PROOFS
create policy proofs_select on public.proofs for select to authenticated
  using (public.can_see_proof(id));
create policy proofs_insert on public.proofs for insert to authenticated
  with check (owner_id = (select auth.uid())
              and status = 'sending'
              and public.is_friend((select auth.uid()), friend_id)
              and (quest_id is null or exists (select 1 from public.quests q
                                                where q.id = quest_id and q.user_id = (select auth.uid()))));
create policy proofs_delete on public.proofs for delete to authenticated
  using (owner_id = (select auth.uid()));
-- No update policy: status changes go through functions below.

-- PROOF PHOTOS
create policy photos_select on public.proof_photos for select to authenticated
  using (public.can_see_proof(proof_id));
create policy photos_insert on public.proof_photos for insert to authenticated
  with check (owner_id = (select auth.uid())
              and storage_path like (select auth.uid())::text || '/%'
              and exists (select 1 from public.proofs p
                           where p.id = proof_id and p.owner_id = (select auth.uid())
                             and p.status in ('sending','pending','clarify')));
create policy photos_delete on public.proof_photos for delete to authenticated
  using (owner_id = (select auth.uid()));

-- REACTIONS
create policy reactions_select on public.proof_reactions for select to authenticated
  using (public.can_see_proof(proof_id));
create policy reactions_insert on public.proof_reactions for insert to authenticated
  with check (user_id = (select auth.uid()) and public.can_see_proof(proof_id));
create policy reactions_delete on public.proof_reactions for delete to authenticated
  using (user_id = (select auth.uid()));

-- COMMENTS (gentle questions go through request_clarification)
create policy comments_select on public.proof_comments for select to authenticated
  using (public.can_see_proof(proof_id));
create policy comments_insert on public.proof_comments for insert to authenticated
  with check (author_id = (select auth.uid())
              and kind in ('cheer','reply')
              and public.can_see_proof(proof_id));
create policy comments_delete on public.proof_comments for delete to authenticated
  using (author_id = (select auth.uid()));

-- BADGES: given or received.
create policy badges_select on public.badges for select to authenticated
  using (to_user = (select auth.uid()) or from_user = (select auth.uid()));

-- CHALLENGES
create policy challenges_select on public.challenges for select to authenticated
  using (public.is_challenge_member(id));
create policy members_select on public.challenge_members for select to authenticated
  using (public.is_challenge_member(challenge_id));

-- =====================================================================
-- SERVER FUNCTIONS (the only way to change coins, friends and statuses)
-- =====================================================================

-- Small helper: add coins once. Returns coins actually added (0 if already paid).
create or replace function public._award(p_user uuid, p_amount int, p_reason text,
                                        p_ref uuid, p_group uuid default null, p_from uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_amount <= 0 then return 0; end if;
  insert into coin_ledger (user_id, amount, reason, ref_id, group_id, from_user)
  values (p_user, p_amount, p_reason, p_ref, p_group, p_from)
  on conflict (user_id, reason, ref_id) do nothing;
  get diagnostics n = row_count;
  return case when n > 0 then p_amount else 0 end;
end $$;

-- Tick / untick a mini-quest. First tick pays 2 coins (up to 12 steps per quest).
-- Unticking never removes coins.
create or replace function public.set_mini_done(p_mini uuid, p_done boolean)
returns int language plpgsql security definer set search_path = public as $$
declare m mini_quests; paid int;
begin
  select * into m from mini_quests where id = p_mini and user_id = auth.uid();
  if not found then raise exception 'Mini-quest not found'; end if;
  update mini_quests set done = p_done where id = p_mini;
  if p_done and (select count(*) from coin_ledger
                  where user_id = auth.uid() and reason = 'mini' and group_id = m.quest_id) < 12 then
    return _award(auth.uid(), 2, 'mini', p_mini, m.quest_id);
  end if;
  return 0;
end $$;

-- Finish a quest. 'full' = 10 coins, 'partial' ("I did some of it!") = 5 coins.
-- Daily cap of 25 paid quests keeps the leaderboard fair. No friend needed.
create or replace function public.complete_quest(p_quest uuid, p_outcome text)
returns int language plpgsql security definer set search_path = public as $$
declare q quests;
begin
  if p_outcome not in ('full','partial') then raise exception 'Bad outcome'; end if;
  select * into q from quests where id = p_quest and user_id = auth.uid();
  if not found then raise exception 'Quest not found'; end if;
  if q.status = 'done' then return 0; end if;
  update quests set status = 'done', outcome = p_outcome, completed_at = now() where id = p_quest;
  if (select count(*) from coin_ledger
       where user_id = auth.uid() and reason in ('quest','quest_partial')
         and created_at > now() - interval '1 day') >= 25 then
    return 0;
  end if;
  return _award(auth.uid(), case when p_outcome = 'full' then 10 else 5 end,
                case when p_outcome = 'full' then 'quest' else 'quest_partial' end, p_quest);
end $$;

-- Put a finished quest back on the board (coins are kept).
create or replace function public.reopen_quest(p_quest uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update quests set status = 'active', outcome = null, completed_at = null
   where id = p_quest and user_id = auth.uid();
end $$;

-- After photos are uploaded, actually send the proof to the friend.
-- Proof with at least one photo earns a small +3 bonus (once).
create or replace function public.send_proof(p_proof uuid)
returns int language plpgsql security definer set search_path = public as $$
declare p proofs;
begin
  select * into p from proofs where id = p_proof and owner_id = auth.uid();
  if not found then raise exception 'Proof not found'; end if;
  if p.status <> 'sending' then return 0; end if;
  if not is_friend(auth.uid(), p.friend_id) then raise exception 'You are not connected to this friend'; end if;
  update proofs set status = 'pending', sent_at = now() where id = p_proof;
  if exists (select 1 from proof_photos where proof_id = p_proof) then
    return _award(auth.uid(), 3, 'proof', p_proof);
  end if;
  return 0;
end $$;

-- Friend approves. Optional bonus coins (0–25), optional badge, optional message.
-- The verifier gets +2 "cheerleader" coins for showing up for their friend.
create or replace function public.verify_proof(p_proof uuid, p_bonus int default 0,
                                               p_badge text default null, p_message text default null)
returns json language plpgsql security definer set search_path = public as $$
declare p proofs; bonus int; given int := 0;
begin
  select * into p from proofs where id = p_proof for update;
  if not found or p.friend_id <> auth.uid() or not is_friend(auth.uid(), p.owner_id)
     or p.status not in ('pending','clarify') then
    raise exception 'This proof is not waiting for you';
  end if;
  bonus := greatest(0, least(coalesce(p_bonus, 0), 25));
  update proofs set status = 'verified', verified_at = now(), seen_by_owner = false where id = p_proof;
  if bonus > 0 then
    given := _award(p.owner_id, bonus, 'friend_bonus', p_proof, null, auth.uid());
  end if;
  if p_badge is not null then
    insert into badges (proof_id, from_user, to_user, badge_key)
    values (p_proof, auth.uid(), p.owner_id, p_badge) on conflict do nothing;
  end if;
  if nullif(btrim(coalesce(p_message, '')), '') is not null then
    insert into proof_comments (proof_id, author_id, body, kind)
    values (p_proof, auth.uid(), left(btrim(p_message), 500), 'cheer');
  end if;
  perform _award(auth.uid(), 2, 'cheer_given', p_proof);
  return json_build_object('bonus', given);
end $$;

-- Friend gives a badge any time after it was sent (one of each per proof).
create or replace function public.give_badge(p_proof uuid, p_badge text)
returns void language plpgsql security definer set search_path = public as $$
declare p proofs;
begin
  select * into p from proofs where id = p_proof;
  if not found or p.friend_id <> auth.uid() or not is_friend(auth.uid(), p.owner_id)
     or p.status not in ('pending','clarify','verified') then
    raise exception 'Proof not found';
  end if;
  insert into badges (proof_id, from_user, to_user, badge_key)
  values (p_proof, auth.uid(), p.owner_id, p_badge) on conflict do nothing;
end $$;

-- Friend asks a kind question instead of approving yet. Never costs coins.
create or replace function public.request_clarification(p_proof uuid, p_message text)
returns void language plpgsql security definer set search_path = public as $$
declare p proofs;
begin
  if nullif(btrim(coalesce(p_message, '')), '') is null then raise exception 'Add a short note'; end if;
  select * into p from proofs where id = p_proof for update;
  if not found or p.friend_id <> auth.uid() or not is_friend(auth.uid(), p.owner_id)
     or p.status <> 'pending' then
    raise exception 'This proof is not waiting for you';
  end if;
  update proofs set status = 'clarify', seen_by_owner = false where id = p_proof;
  insert into proof_comments (proof_id, author_id, body, kind)
  values (p_proof, auth.uid(), left(btrim(p_message), 500), 'clarify');
end $$;

-- Owner answered the question → back to the friend's pending list.
create or replace function public.resend_proof(p_proof uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update proofs set status = 'pending'
   where id = p_proof and owner_id = auth.uid() and status = 'clarify';
end $$;

create or replace function public.mark_proofs_seen()
returns void language plpgsql security definer set search_path = public as $$
begin
  update proofs set seen_by_owner = true where owner_id = auth.uid() and seen_by_owner = false;
end $$;

-- ---------------- INVITES ----------------
create or replace function public.create_invite()
returns json language plpgsql security definer set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  c text; i int; inv invites;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  -- reuse a still-valid code so tapping repeatedly doesn't spray codes around
  select * into inv from invites
   where inviter_id = auth.uid() and used_by is null and expires_at > now() + interval '1 day'
   order by created_at desc limit 1;
  if found then return json_build_object('code', inv.code, 'expires_at', inv.expires_at); end if;
  if (select count(*) from invites where inviter_id = auth.uid() and created_at > now() - interval '1 day') >= 20 then
    raise exception 'That is a lot of invites today — try again tomorrow';
  end if;
  loop
    c := '';
    for i in 1..8 loop
      c := c || substr(alphabet, 1 + (get_byte(gen_random_bytes(1), 0) % length(alphabet)), 1);
    end loop;
    begin
      insert into invites (code, inviter_id) values (c, auth.uid()) returning * into inv;
      exit;
    exception when unique_violation then
      -- try another code
    end;
  end loop;
  return json_build_object('code', inv.code, 'expires_at', inv.expires_at);
end $$;

-- Returns {ok:false, message} instead of raising, so failed guesses are still
-- recorded and the 10-tries-per-hour throttle actually works.
create or replace function public.accept_invite(p_code text)
returns json language plpgsql security definer set search_path = public as $$
declare inv invites; me uuid := auth.uid(); clean text; nm text;
begin
  if me is null then raise exception 'Sign in first'; end if;
  if (select count(*) from invite_attempts where user_id = me and created_at > now() - interval '1 hour') >= 10 then
    return json_build_object('ok', false, 'message', 'Too many tries — have a breather and try again in an hour');
  end if;
  insert into invite_attempts (user_id) values (me);
  clean := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  select * into inv from invites where code = clean for update;
  if not found or inv.used_by is not null or inv.expires_at < now() or inv.inviter_id = me
     or exists (select 1 from blocks k where (k.blocker_id = me and k.blocked_id = inv.inviter_id)
                                         or (k.blocker_id = inv.inviter_id and k.blocked_id = me)) then
    return json_build_object('ok', false, 'message', 'That code didn''t work. Ask your friend for a fresh one!');
  end if;
  update invites set used_by = me, used_at = now() where code = clean;
  insert into friendships (user_id, friend_id) values (me, inv.inviter_id), (inv.inviter_id, me)
  on conflict do nothing;
  select display_name into nm from profiles where id = inv.inviter_id;
  return json_build_object('ok', true, 'friend_id', inv.inviter_id, 'display_name', nm);
end $$;

-- ---------------- DISCONNECT / BLOCK ----------------
create or replace function public.disconnect_friend(p_friend uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  delete from friendships where (user_id = me and friend_id = p_friend) or (user_id = p_friend and friend_id = me);
  -- Anything either of you sent the other can no longer be opened by the other
  -- person — permanently, even if you reconnect later. Owners keep their own copies.
  update proofs set friend_access = false,
                    status = case when status in ('sending','pending','clarify') then 'withdrawn' else status end
   where (owner_id = me and friend_id = p_friend) or (owner_id = p_friend and friend_id = me);
end $$;

create or replace function public.block_user(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); nm text;
begin
  if p_user = me then return; end if;
  select display_name into nm from profiles where id = p_user;
  perform disconnect_friend(p_user);
  insert into blocks (blocker_id, blocked_id, blocked_name) values (me, p_user, coalesce(nm, 'Player'))
  on conflict do nothing;
  -- remove them from any challenge I created, and me from theirs
  delete from challenge_members m using challenges c
   where m.challenge_id = c.id
     and ((c.creator_id = me and m.user_id = p_user) or (c.creator_id = p_user and m.user_id = me));
end $$;

create or replace function public.unblock_user(p_user uuid)
returns void language sql security definer set search_path = public as $$
  delete from blocks where blocker_id = auth.uid() and blocked_id = p_user;
$$;

-- ---------------- STATS / LEADERBOARD ----------------
create or replace function public.my_stats()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'coins',       coalesce((select sum(amount) from coin_ledger where user_id = auth.uid()), 0),
    'coins_week',  coalesce((select sum(amount) from coin_ledger where user_id = auth.uid()
                               and created_at > now() - interval '7 days'), 0),
    'quests_done', (select count(*) from quests where user_id = auth.uid() and status = 'done'),
    'verified',    (select count(*) from proofs where owner_id = auth.uid() and status = 'verified'),
    'badges',      (select count(*) from badges where to_user = auth.uid())
  );
$$;

-- Friendly weekly board: me + friends who opted in. Coins earned in the last 7 days.
create or replace function public.friend_leaderboard()
returns table (user_id uuid, display_name text, mascot text, coins_week bigint, is_me boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name, p.mascot,
         coalesce((select sum(amount) from coin_ledger l
                    where l.user_id = p.id and l.created_at > now() - interval '7 days'), 0),
         p.id = auth.uid()
    from profiles p
   where p.id = auth.uid()
      or (public.is_friend(auth.uid(), p.id) and p.show_on_leaderboard)
   order by 4 desc, 2;
$$;

-- ---------------- SHARED CHALLENGES ----------------
create or replace function public.create_challenge(p_title text, p_goal int, p_days int, p_friends uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid; f uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if p_days not between 1 and 31 then raise exception 'Pick 1–31 days'; end if;
  if coalesce(array_length(p_friends, 1), 0) = 0 or array_length(p_friends, 1) > 10 then
    raise exception 'Pick 1–10 friends';
  end if;
  foreach f in array p_friends loop
    if not is_friend(auth.uid(), f) then raise exception 'You can only invite friends'; end if;
  end loop;
  insert into challenges (creator_id, title, goal, ends_at)
  values (auth.uid(), btrim(p_title), p_goal, now() + make_interval(days => p_days))
  returning id into cid;
  insert into challenge_members (challenge_id, user_id, status, joined_at) values (cid, auth.uid(), 'joined', now());
  insert into challenge_members (challenge_id, user_id)
  select cid, x from unnest(p_friends) as x on conflict do nothing;
  return cid;
end $$;

create or replace function public.respond_challenge(p_challenge uuid, p_join boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_join then
    update challenge_members set status = 'joined', joined_at = now()
     where challenge_id = p_challenge and user_id = auth.uid();
  else
    delete from challenge_members where challenge_id = p_challenge and user_id = auth.uid();
  end if;
end $$;

-- Team progress: quests (full or partial) finished by joined members during the window.
create or replace function public.challenge_board()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(row_to_json(t) order by t.ends_at), '[]'::json) from (
    select c.id, c.title, c.goal, c.starts_at, c.ends_at, c.creator_id,
           (select m.status from challenge_members m where m.challenge_id = c.id and m.user_id = auth.uid()) as my_status,
           (select coalesce(json_agg(json_build_object(
                    'user_id', m.user_id,
                    'display_name', p.display_name,
                    'mascot', p.mascot,
                    'status', m.status,
                    'done', (select count(*) from quests q
                              where q.user_id = m.user_id and q.status = 'done'
                                and q.completed_at between c.starts_at and c.ends_at)
                  )), '[]'::json)
              from challenge_members m join profiles p on p.id = m.user_id
             where m.challenge_id = c.id
               and not exists (select 1 from blocks k where (k.blocker_id = auth.uid() and k.blocked_id = m.user_id)
                                                       or (k.blocker_id = m.user_id and k.blocked_id = auth.uid()))
           ) as members
      from challenges c
     where public.is_challenge_member(c.id)
       and c.ends_at > now() - interval '3 days'
  ) t;
$$;

-- Lock function execution down to signed-in users.
revoke execute on all functions in schema public from public, anon;
grant  execute on function
  public.is_friend(uuid, uuid), public.can_see_proof(uuid), public.is_challenge_member(uuid),
  public.set_mini_done(uuid, boolean), public.complete_quest(uuid, text), public.reopen_quest(uuid),
  public.send_proof(uuid), public.verify_proof(uuid, int, text, text), public.give_badge(uuid, text),
  public.request_clarification(uuid, text), public.resend_proof(uuid), public.mark_proofs_seen(),
  public.create_invite(), public.accept_invite(text), public.disconnect_friend(uuid),
  public.block_user(uuid), public.unblock_user(uuid), public.my_stats(), public.friend_leaderboard(),
  public.create_challenge(text, int, int, uuid[]), public.respond_challenge(uuid, boolean),
  public.challenge_board()
to authenticated;
-- Supabase grants EXECUTE on new functions to signed-in users by default,
-- so explicitly take the internal ones away again (stops coin forging).
revoke execute on function public._award(uuid, int, text, uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.check_mini_owner() from public, anon, authenticated;

-- =====================================================================
-- PRIVATE PHOTO STORAGE
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('quest-proof', 'quest-proof', false, 5242880, array['image/jpeg','image/webp','image/png'])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- May the current user open this storage object?
create or replace function public.can_view_photo(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select split_part(p_name, '/', 1) = auth.uid()::text
      or exists (select 1 from proof_photos ph
                  where ph.storage_path = p_name and public.can_see_proof(ph.proof_id));
$$;
grant execute on function public.can_view_photo(text) to authenticated;

create policy "quest-proof: upload into own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'quest-proof' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "quest-proof: owner or invited friend can view" on storage.objects
  for select to authenticated
  using (bucket_id = 'quest-proof' and public.can_view_photo(name));

create policy "quest-proof: owner can delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'quest-proof' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- =====================================================================
-- REALTIME (live updates between phones; still filtered by RLS)
-- =====================================================================
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.proofs, public.proof_comments, public.proof_reactions, public.badges, public.friendships;
  end if;
end $$;
