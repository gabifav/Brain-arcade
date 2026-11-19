\set A '''aaaaaaaa-0000-0000-0000-000000000001'''
\set B '''bbbbbbbb-0000-0000-0000-000000000002'''
\set C '''cccccccc-0000-0000-0000-000000000003'''
\set D '''dddddddd-0000-0000-0000-000000000004'''
create schema t; grant usage on schema t to authenticated, anon;
create function t.ok(label text, cond boolean) returns void language plpgsql as $$
begin raise notice '% %', case when cond then 'PASS' else '**FAIL**' end, label; end $$;
create function t.fails(label text, q text) returns void language plpgsql as $$
begin execute q; raise notice '**FAIL** % (no error)', label;
exception when others then raise notice 'PASS % (%)', label, left(sqlerrm,60); end $$;
grant execute on all functions in schema t to authenticated, anon;
insert into auth.users (id, raw_user_meta_data) values
 (:A, '{"display_name":"Amelie"}'), (:B, '{"display_name":"Bestie"}'), (:C, '{"display_name":"Stranger"}'), (:D, '{"display_name":"Dee"}');
select t.ok('profiles auto-created', (select count(*) from profiles) = 4);

-- ===== anon gets nothing
set role anon;
select t.fails('anon cannot read profiles', 'select * from profiles');
select t.fails('anon cannot call create_invite', 'select create_invite()');
reset role;

-- ===== A: quests + coins
select set_config('request.jwt.claim.sub', :A, false); set role authenticated;
insert into quests (id, title, emoji) values ('11111111-0000-0000-0000-000000000001','Clean bedroom','🛏️');
insert into mini_quests (id, quest_id, title, position) values
 ('22222222-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000001','Pick up clothes',0),
 ('22222222-0000-0000-0000-000000000002','11111111-0000-0000-0000-000000000001','Clear desk',1);
select t.ok('tick mini pays 2', set_mini_done('22222222-0000-0000-0000-000000000001', true) = 2);
select t.ok('untick pays 0', set_mini_done('22222222-0000-0000-0000-000000000001', false) = 0);
select t.ok('re-tick pays 0 (no double)', set_mini_done('22222222-0000-0000-0000-000000000001', true) = 0);
select t.ok('coins still 2 after untick/retick', (my_stats()->>'coins')::int = 2);
select t.fails('cannot insert coins directly', $q$insert into coin_ledger (user_id, amount, reason, ref_id) values (auth.uid(), 100, 'quest', gen_random_uuid())$q$);
select t.fails('cannot call _award directly', $q$select _award(auth.uid(), 100, 'quest', gen_random_uuid())$q$);
delete from coin_ledger; update coin_ledger set amount = 1;
select t.ok('delete/update coins had no effect', (my_stats()->>'coins')::int = 2);
select t.ok('partial completion pays 5', complete_quest('11111111-0000-0000-0000-000000000001','partial') = 5);
select t.ok('second completion pays 0', complete_quest('11111111-0000-0000-0000-000000000001','full') = 0);
select t.ok('coins = 7', (my_stats()->>'coins')::int = 7);
select t.ok('A creates invite', (select (create_invite()->>'code') is not null));
select t.ok('same invite reused', (create_invite()->>'code') = (create_invite()->>'code'));
reset role;
select code as acode from invites where inviter_id = :A \gset

-- ===== C (stranger) cannot see A's stuff
select set_config('request.jwt.claim.sub', :C, false); set role authenticated;
select t.ok('stranger sees 0 quests', (select count(*) from quests) = 0);
select t.ok('stranger sees only own profile', (select count(*) from profiles) = 1);
select t.ok('stranger sees no invites', (select count(*) from invites) = 0);
select t.fails('stranger cannot complete A quest', $q$select complete_quest('11111111-0000-0000-0000-000000000001','full')$q$);
select t.fails('stranger cannot send proof to A (not friend)', format($q$insert into proofs (friend_id, quest_title) values (%L, 'x')$q$, :A::uuid));
reset role;

-- ===== B accepts invite
select set_config('request.jwt.claim.sub', :B, false); set role authenticated;
select t.ok('B accepts invite (lowercase, dashes ok)', (accept_invite(lower(substr(:'acode',1,4)) || '-' || lower(substr(:'acode',5))) ->>'display_name') = 'Amelie');
select t.ok('B sees A profile now', (select count(*) from profiles) = 2);
select t.ok('B still sees 0 of A quests', (select count(*) from quests) = 0);
reset role;
select set_config('request.jwt.claim.sub', :C, false); set role authenticated;
select t.ok('used code cannot be reused by C', (accept_invite(:'acode')->>'ok')::boolean = false);
select t.ok('C still has no friends', (select count(*) from friendships) = 0);
reset role;

-- ===== A sends proof to B
select set_config('request.jwt.claim.sub', :A, false); set role authenticated;
insert into proofs (id, friend_id, quest_id, quest_title, caption, outcome)
 values ('33333333-0000-0000-0000-000000000001', :B, '11111111-0000-0000-0000-000000000001', 'Clean bedroom', 'I FINALLY DID IT!', 'partial');
select t.fails('proof cannot be inserted already-verified', format($q$insert into proofs (friend_id, quest_title, status) values (%L,'x','verified')$q$, :B::uuid));
select t.fails('A cannot send proof to stranger C', format($q$insert into proofs (friend_id, quest_title) values (%L,'x')$q$, :C::uuid));
insert into storage.objects (bucket_id, name) values ('quest-proof', :A || '/33333333-0000-0000-0000-000000000001/before.jpg'),
                                                     ('quest-proof', :A || '/33333333-0000-0000-0000-000000000001/after.jpg'),
                                                     ('quest-proof', :A || '/private/not-shared.jpg');
select t.fails('A cannot upload into B folder', format($q$insert into storage.objects (bucket_id, name) values ('quest-proof', %L)$q$, :B || '/x.jpg'));
insert into proof_photos (proof_id, kind, storage_path) values
 ('33333333-0000-0000-0000-000000000001','before', :A || '/33333333-0000-0000-0000-000000000001/before.jpg'),
 ('33333333-0000-0000-0000-000000000001','after',  :A || '/33333333-0000-0000-0000-000000000001/after.jpg');
select t.fails('photo row cannot point at another user path', $q$insert into proof_photos (proof_id, kind, storage_path) values ('33333333-0000-0000-0000-000000000001','extra','bbbbbbbb-0000-0000-0000-000000000002/x.jpg')$q$);
reset role;

-- B cannot see proof while it is still 'sending'
select set_config('request.jwt.claim.sub', :B, false); set role authenticated;
select t.ok('B cannot see a still-uploading proof', (select count(*) from proofs) = 0);
reset role;

select set_config('request.jwt.claim.sub', :A, false); set role authenticated;
select t.ok('send_proof with photos pays 3', send_proof('33333333-0000-0000-0000-000000000001') = 3);
select t.fails('A cannot verify own proof', $q$select verify_proof('33333333-0000-0000-0000-000000000001', 25)$q$);
update proofs set status='verified', friend_access=true;
select t.ok('direct status update had no effect', (select status from proofs) = 'pending');
reset role;

select set_config('request.jwt.claim.sub', :B, false); set role authenticated;
select t.ok('B sees the pending proof', (select count(*) from proofs where status='pending') = 1);
select t.ok('B sees 2 photo rows', (select count(*) from proof_photos) = 2);
select t.ok('B can open shared photo files (2)', (select count(*) from storage.objects) = 2);
select t.ok('B cannot see unshared photo', (select count(*) from storage.objects where name like '%not-shared%') = 0);
delete from storage.objects; delete from proof_photos; delete from proofs; update storage.objects set name = 'x';
reset role; select t.ok('B could not delete/rename A files or rows', (select count(*) from storage.objects where name like 'aaaa%') = 3 and (select count(*) from proof_photos) = 2 and (select count(*) from proofs)=1);
select set_config('request.jwt.claim.sub', :B, false); set role authenticated;
insert into proof_reactions (proof_id, emoji) values ('33333333-0000-0000-0000-000000000001','🎉');
insert into proof_comments (proof_id, body) values ('33333333-0000-0000-0000-000000000001','LEGENDARY EFFORT!');
select t.fails('B cannot insert clarify comment directly', $q$insert into proof_comments (proof_id, body, kind) values ('33333333-0000-0000-0000-000000000001','hmm','clarify')$q$);
select request_clarification('33333333-0000-0000-0000-000000000001', 'Can I see the desk too? 💖');
select t.ok('status clarify', (select status from proofs) = 'clarify');
reset role;

select set_config('request.jwt.claim.sub', :A, false); set role authenticated;
select t.ok('A coins unchanged after clarify (10)', (my_stats()->>'coins')::int = 10);
insert into proof_comments (proof_id, body, kind) values ('33333333-0000-0000-0000-000000000001','Added the desk!','reply');
select resend_proof('33333333-0000-0000-0000-000000000001');
reset role;

select set_config('request.jwt.claim.sub', :B, false); set role authenticated;
select t.ok('verify pays bonus capped at 25', (verify_proof('33333333-0000-0000-0000-000000000001', 999, 'legend', 'YOUR BESTIE APPROVES!')->>'bonus')::int = 25);
select t.fails('cannot verify twice', $q$select verify_proof('33333333-0000-0000-0000-000000000001', 5)$q$);
select t.ok('B got +2 cheer coins', (my_stats()->>'coins')::int = 2);
select t.fails('bad badge rejected', $q$select give_badge('33333333-0000-0000-0000-000000000001','hacker')$q$);
select give_badge('33333333-0000-0000-0000-000000000001','tidy');
reset role;

select set_config('request.jwt.claim.sub', :A, false); set role authenticated;
select t.ok('A coins = 35', (my_stats()->>'coins')::int = 35);
select t.ok('A has 2 badges', (my_stats()->>'badges')::int = 2);
select t.ok('leaderboard shows A and B', (select count(*) from friend_leaderboard()) = 2);
update profiles set show_on_leaderboard = false where id = :A;
reset role;
select set_config('request.jwt.claim.sub', :B, false); set role authenticated;
select t.ok('B leaderboard hides opted-out A', (select count(*) from friend_leaderboard()) = 1);
update profiles set display_name='x' where id=:A;
reset role; select t.ok('B could not edit A profile', (select display_name from profiles where id=:A) = 'Amelie');
select set_config('request.jwt.claim.sub', :B, false); set role authenticated;
reset role;

-- ===== challenge
select set_config('request.jwt.claim.sub', :A, false); set role authenticated;
select t.fails('cannot add stranger to challenge', format($q$select create_challenge('Tidy week', 5, 7, array[%L]::uuid[])$q$, :C::uuid));
select create_challenge('Tidy week', 5, 7, array[:B]::uuid[]) is not null as made \gset
select t.ok('A sees challenge (2 members, 0 done since start)', json_array_length(challenge_board()->0->'members') = 2 and ((challenge_board()->0->'members'->0->>'done')::int + (challenge_board()->0->'members'->1->>'done')::int) = 0);
reset role;
select set_config('request.jwt.claim.sub', :C, false); set role authenticated;
select t.ok('stranger sees no challenges', json_array_length(challenge_board()) = 0);
select t.ok('stranger sees no challenge rows', (select count(*) from challenges) = 0);
reset role;

-- ===== disconnect revokes forever
select set_config('request.jwt.claim.sub', :B, false); set role authenticated;
select disconnect_friend(:A);
select t.ok('after disconnect B sees no proofs', (select count(*) from proofs) = 0);
select t.ok('after disconnect B sees no photo files', (select count(*) from storage.objects) = 0);
select t.ok('after disconnect B sees no A profile', (select count(*) from profiles) = 1);
reset role;
select set_config('request.jwt.claim.sub', :A, false); set role authenticated;
select t.ok('A still has own verified proof', (select status from proofs) = 'verified');
select t.ok('A still has all coins (35)', (my_stats()->>'coins')::int = 35);
select (create_invite()->>'code') as acode2 \gset
reset role;
select set_config('request.jwt.claim.sub', :B, false); set role authenticated;
select accept_invite(:'acode2');
select t.ok('reconnected B still cannot see old proof', (select count(*) from proofs) = 0);
select block_user(:A);
select t.ok('blocked: no profile', (select count(*) from profiles) = 1);
reset role;
select set_config('request.jwt.claim.sub', :A, false); set role authenticated;
select (create_invite()->>'code') as acode3 \gset
select t.fails('A cannot send proof to B who blocked them', format($q$insert into proofs (friend_id, quest_title) values (%L,'x')$q$, :B::uuid));
reset role;
select set_config('request.jwt.claim.sub', :B, false); set role authenticated;
select t.ok('B (blocker) cannot accept invite from blocked A', (accept_invite(:'acode3')->>'ok')::boolean = false);
reset role;

-- ===== invite brute-force throttle
select set_config('request.jwt.claim.sub', :D, false); set role authenticated;
select accept_invite('WRONG' || i) from generate_series(1,9) i;
reset role;
select set_config('request.jwt.claim.sub', :D, false); set role authenticated;
select accept_invite('WRONG10');
select t.ok('11th try is throttled', accept_invite('ANYTHING')->>'message' like 'Too many%');
reset role;
-- note: attempts are recorded inside the failed call's transaction, check they persist
select t.ok('attempt rows persisted (10)', (select count(*) from invite_attempts where user_id = :D) = 10);

-- owner deletes proof → photo rows go
select set_config('request.jwt.claim.sub', :A, false); set role authenticated;
delete from proofs where id = '33333333-0000-0000-0000-000000000001';
select t.ok('photo rows cascade-deleted', (select count(*) from proof_photos) = 0);
delete from storage.objects where name like 'aaaaaaaa%';
select t.ok('A deleted own files', (select count(*) from storage.objects) = 0);
reset role;
