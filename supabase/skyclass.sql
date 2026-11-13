-- Skyclass online storage. Safe to run more than once. Every object is prefixed sky_ and
-- nothing here reads or changes ClassGrove (pp_*) tables.
--
-- Model: one row per teacher holding their whole school as JSON, plus family codes.
-- A family code is a secret the teacher hands to one child's family. It unlocks a
-- read-only view of that one child and nothing else.

create table if not exists public.sky_schools (
  owner uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  rev integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint sky_state_size check (pg_column_size(state) < 2000000)
);

create table if not exists public.sky_codes (
  code text primary key check (code ~ '^[A-HJ-NP-Z2-9]{10}$'),
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  class_id text not null check (length(class_id) between 1 and 40),
  student_id text not null check (length(student_id) between 1 and 40),
  created_at timestamptz not null default now(),
  unique (owner, class_id, student_id)
);

-- Practice scores and morning check-ins sent from families' own devices. Written only through the
-- sky_family_* functions below; teachers can read and clear their own rows.
create table if not exists public.sky_results (
  owner uuid not null references auth.users(id) on delete cascade,
  class_id text not null check (length(class_id) between 1 and 40),
  student_id text not null check (length(student_id) between 1 and 40),
  assign_id text not null check (length(assign_id) between 1 and 40),
  best integer not null check (best >= 0), total integer not null check (total between 1 and 500), tries integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key (owner, class_id, student_id, assign_id), check (best <= total)
);
create table if not exists public.sky_checkins (
  owner uuid not null references auth.users(id) on delete cascade,
  class_id text not null check (length(class_id) between 1 and 40),
  student_id text not null check (length(student_id) between 1 and 40),
  day date not null, mood smallint not null check (mood between 1 and 5),
  primary key (owner, class_id, student_id, day)
);
alter table public.sky_results enable row level security;
alter table public.sky_checkins enable row level security;
revoke all on public.sky_results, public.sky_checkins from anon, authenticated;
grant select, delete on public.sky_results, public.sky_checkins to authenticated;
drop policy if exists sky_results_own on public.sky_results;
create policy sky_results_own on public.sky_results for all to authenticated using (owner = (select auth.uid()));
drop policy if exists sky_checkins_own on public.sky_checkins;
create policy sky_checkins_own on public.sky_checkins for all to authenticated using (owner = (select auth.uid()));

alter table public.sky_schools enable row level security;
alter table public.sky_codes enable row level security;

revoke all on public.sky_schools, public.sky_codes from anon, authenticated;
grant select, insert, update on public.sky_schools to authenticated;
grant select, insert, delete on public.sky_codes to authenticated;

drop policy if exists sky_schools_own on public.sky_schools;
create policy sky_schools_own on public.sky_schools for all to authenticated
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));

drop policy if exists sky_codes_own on public.sky_codes;
create policy sky_codes_own on public.sky_codes for all to authenticated
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));

-- Save the teacher's school. Returns the new revision, or null when another device
-- saved first (the caller must reload instead of overwriting).
create or replace function public.sky_save(p_state jsonb, p_rev integer) returns integer
language plpgsql security invoker set search_path = '' as $$
declare new_rev integer;
begin
  if auth.uid() is null then raise exception 'SIGN_IN_REQUIRED' using errcode = '28000'; end if;
  insert into public.sky_schools as s (owner, state, rev) values (auth.uid(), p_state, 1)
    on conflict (owner) do update set state = excluded.state, rev = s.rev + 1, updated_at = now()
    where s.rev = p_rev
    returning s.rev into new_rev;
  return new_rev;
end $$;

-- What a family sees for one code: that child, their own attendance marks, the class
-- name, goal, total and posts, and the lessons. No other child's name or data.
-- Lessons include quiz answers: they are practice, checked in the browser, not grades.
create or replace function public.sky_family_view(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c public.sky_codes; st jsonb; cls jsonb; stu jsonb; att jsonb;
begin
  select * into c from public.sky_codes where code = upper(btrim(coalesce(p_code, '')));
  if not found then return null; end if;
  select state into st from public.sky_schools where owner = c.owner;
  select x into cls from jsonb_array_elements(coalesce(st->'classes', '[]'::jsonb)) x where x->>'id' = c.class_id limit 1;
  if cls is null then return null; end if;
  select x into stu from jsonb_array_elements(coalesce(cls->'students', '[]'::jsonb)) x where x->>'id' = c.student_id limit 1;
  if stu is null then return null; end if;
  select coalesce(jsonb_object_agg(d.key, jsonb_build_object(c.student_id, d.value->c.student_id)), '{}'::jsonb) into att
    from jsonb_each(coalesce(cls->'attendance', '{}'::jsonb)) d where d.value ? c.student_id;
  return jsonb_build_object(
    'class', jsonb_build_object('id', cls->'id', 'name', cls->'name', 'goal', cls->'goal',
      'posts', coalesce(cls->'posts', '[]'::jsonb), 'attendance', att,
      'total', (select coalesce(sum(greatest(0, (s->>'points')::numeric)), 0) from jsonb_array_elements(cls->'students') s)),
    'student', stu,
    'lessons', coalesce(st->'lessons', '[]'::jsonb),
    'lib', coalesce(st->'lib', '{}'::jsonb),
    'sets', coalesce(st->'sets', '[]'::jsonb),
    'packs', coalesce(st->'packs', '[]'::jsonb),
    'credit', jsonb_build_object(c.student_id, coalesce(cls->'credit'->c.student_id, '{}'::jsonb)),
    'assign', coalesce(cls->'assign', '[]'::jsonb),
    -- this child's practice scores and check-ins: from the class device (in the school record) and from home (tables)
    'localResults', coalesce((select jsonb_object_agg(r.key, r.value->c.student_id) from jsonb_each(case when jsonb_typeof(cls->'results') = 'object' then cls->'results' else '{}'::jsonb end) r where r.value ? c.student_id), '{}'::jsonb),
    'homeResults', coalesce((select jsonb_object_agg(assign_id, jsonb_build_object('best', best, 'total', total, 'tries', tries, 't', (extract(epoch from updated_at) * 1000)::bigint))
      from public.sky_results where owner = c.owner and class_id = c.class_id and student_id = c.student_id), '{}'::jsonb),
    'localCheckins', coalesce((select jsonb_object_agg(d.key, d.value->c.student_id) from jsonb_each(case when jsonb_typeof(cls->'checkin') = 'object' then cls->'checkin' else '{}'::jsonb end) d where d.value ? c.student_id), '{}'::jsonb),
    'homeCheckins', coalesce((select jsonb_object_agg(day::text, mood) from public.sky_checkins where owner = c.owner and class_id = c.class_id and student_id = c.student_id and day > current_date - 14), '{}'::jsonb));
end $$;

-- A child playing assigned practice at home. Only assignments that exist for the code's class count.
create or replace function public.sky_family_play(p_code text, p_assign text, p_score integer, p_total integer) returns boolean
language plpgsql security definer set search_path = '' as $$
declare c public.sky_codes; cls jsonb; tot integer := p_total;
begin
  if p_total is null or p_total not between 1 and 500 or p_score is null or p_score not between 0 and p_total then return false; end if;
  select * into c from public.sky_codes where code = upper(btrim(coalesce(p_code, '')));
  if not found then return false; end if;
  select x into cls from public.sky_schools s, jsonb_array_elements(coalesce(s.state->'classes', '[]'::jsonb)) x where s.owner = c.owner and x->>'id' = c.class_id limit 1;
  if cls is null or not exists (select 1 from jsonb_array_elements(coalesce(cls->'assign', '[]'::jsonb)) a where a->>'id' = p_assign) then return false; end if;
  insert into public.sky_results as r (owner, class_id, student_id, assign_id, best, total)
    values (c.owner, c.class_id, c.student_id, p_assign, least(greatest(coalesce(p_score, 0), 0), tot), tot)
    on conflict (owner, class_id, student_id, assign_id) do update set
      best = case when excluded.best::numeric / excluded.total > r.best::numeric / r.total then excluded.best else r.best end,
      total = case when excluded.best::numeric / excluded.total > r.best::numeric / r.total then excluded.total else r.total end,
      tries = least(r.tries + 1, 100000), updated_at = now();
  return true;
end $$;

-- Morning check-in from home. The day must be today give or take one, to allow for time zones.
create or replace function public.sky_family_checkin(p_code text, p_day date, p_mood integer) returns boolean
language plpgsql security definer set search_path = '' as $$
declare c public.sky_codes;
begin
  if p_mood is null or p_mood not between 1 and 5 or p_day is null or abs(p_day - current_date) > 1 then return false; end if;
  select * into c from public.sky_codes where code = upper(btrim(coalesce(p_code, '')));
  if not found then return false; end if;
  insert into public.sky_checkins (owner, class_id, student_id, day, mood) values (c.owner, c.class_id, c.student_id, p_day, p_mood)
    on conflict (owner, class_id, student_id, day) do update set mood = excluded.mood;
  return true;
end $$;
-- iPad login without QR codes: a class code shows first names; each child then enters a 4-picture PIN.
create table if not exists public.sky_class_logins (
  code text primary key check (code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  class_id text not null check (length(class_id) between 1 and 40),
  unique (owner, class_id)
);
create table if not exists public.sky_pins (
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  class_id text not null check (length(class_id) between 1 and 40),
  student_id text not null check (length(student_id) between 1 and 40),
  pin text not null check (pin ~ '^[1-8]{4}$'),
  primary key (owner, class_id, student_id)
);
create table if not exists public.sky_pin_fails (
  owner uuid not null references auth.users(id) on delete cascade, class_id text not null, student_id text not null,
  fails integer not null default 0, since timestamptz not null default now(), primary key (owner, class_id, student_id)
);
alter table public.sky_pin_fails add column if not exists locks integer not null default 0;
alter table public.sky_pin_fails add column if not exists day_fails integer not null default 0;
alter table public.sky_pin_fails add column if not exists day_since timestamptz not null default now();
alter table public.sky_class_logins enable row level security;
alter table public.sky_pins enable row level security;
alter table public.sky_pin_fails enable row level security;
revoke all on public.sky_class_logins, public.sky_pins, public.sky_pin_fails from anon, authenticated;
grant select, insert, delete on public.sky_class_logins to authenticated;
grant select, insert, update, delete on public.sky_pins to authenticated;
grant select, delete on public.sky_pin_fails to authenticated; -- teachers see and clear their own lockouts
drop policy if exists sky_class_logins_own on public.sky_class_logins;
create policy sky_class_logins_own on public.sky_class_logins for all to authenticated using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
drop policy if exists sky_pins_own on public.sky_pins;
create policy sky_pins_own on public.sky_pins for all to authenticated using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
drop policy if exists sky_pin_fails_own on public.sky_pin_fails;
create policy sky_pin_fails_own on public.sky_pin_fails for all to authenticated using (owner = (select auth.uid()));

-- First names of children who have a PIN, for the "tap your name" screen. Nothing else about them.
create or replace function public.sky_class_roster(p_class text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare l public.sky_class_logins; cls jsonb;
begin
  select * into l from public.sky_class_logins where code = upper(btrim(coalesce(p_class, '')));
  if not found then return null; end if;
  select x into cls from public.sky_schools s, jsonb_array_elements(coalesce(s.state->'classes', '[]'::jsonb)) x where s.owner = l.owner and x->>'id' = l.class_id limit 1;
  if cls is null then return null; end if;
  return jsonb_build_object('name', cls->'name', 'students', coalesce((
    select jsonb_agg(jsonb_build_object('id', st->>'id', 'name', split_part(btrim(st->>'name'), ' ', 1)) order by o)
    from jsonb_array_elements(cls->'students') with ordinality t(st, o)
    where exists (select 1 from public.sky_pins p where p.owner = l.owner and p.class_id = l.class_id and p.student_id = st->>'id')), '[]'::jsonb));
end $$;

-- sky_pin_login (picture PIN sign-in) is defined further down, beside the username sign-in that shares its PIN check.

revoke all on function public.sky_class_roster(text) from public;
grant execute on function public.sky_class_roster(text) to anon, authenticated;

revoke all on function public.sky_family_play(text, text, integer, integer), public.sky_family_checkin(text, date, integer) from public;
grant execute on function public.sky_family_play(text, text, integer, integer), public.sky_family_checkin(text, date, integer) to anon, authenticated;

revoke all on function public.sky_save(jsonb, integer) from public, anon;
grant execute on function public.sky_save(jsonb, integer) to authenticated;
revoke all on function public.sky_family_view(text) from public;
grant execute on function public.sky_family_view(text) to anon, authenticated;

-- =====================================================================================================
-- Co-teachers, usernames, profile photos and behaviour notes.
-- =====================================================================================================

-- A co-teacher is invited by email to some of the owner's classes. Access needs a confirmed email.
create table if not exists public.sky_coteachers (
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and email like '%_@_%'),
  classes text[] not null default '{}',
  created_at timestamptz not null default now(),
  primary key (owner, email)
);
alter table public.sky_coteachers enable row level security;
revoke all on public.sky_coteachers from anon, authenticated;
grant select, insert, update, delete on public.sky_coteachers to authenticated;
drop policy if exists sky_coteachers_own on public.sky_coteachers;
create policy sky_coteachers_own on public.sky_coteachers for all to authenticated using (owner = (select auth.uid())) with check (owner = (select auth.uid()));

create or replace function public.sky__my_email() returns text
language sql stable security definer set search_path = '' as $$
  select lower(email) from auth.users where id = auth.uid() and email_confirmed_at is not null
$$;
-- True for the class's owner, or a co-teacher invited to that class.
create or replace function public.sky_can(p_owner uuid, p_class text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_owner = auth.uid() or exists (select 1 from public.sky_coteachers c where c.owner = p_owner and c.email = public.sky__my_email() and p_class = any (c.classes))
$$;

-- Schools shared with the signed-in teacher.
create or replace function public.sky_shared_schools() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('owner', c.owner, 'teacher', (select u.email from auth.users u where u.id = c.owner), 'classes', to_jsonb(c.classes))), '[]'::jsonb)
  from public.sky_coteachers c where c.email = public.sky__my_email() and c.owner <> auth.uid()
$$;
-- A shared school, with only the classes this co-teacher was invited to.
create or replace function public.sky_load_shared(p_owner uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare allowed text[]; s public.sky_schools;
begin
  select classes into allowed from public.sky_coteachers where owner = p_owner and email = public.sky__my_email();
  if allowed is null then return null; end if;
  select * into s from public.sky_schools where owner = p_owner; if not found then return null; end if;
  return jsonb_build_object('rev', s.rev, 'state', jsonb_set(s.state, '{classes}', coalesce((select jsonb_agg(x) from jsonb_array_elements(s.state->'classes') x where x->>'id' = any (allowed)), '[]'::jsonb)));
end $$;
-- A co-teacher's save only replaces the classes they were invited to; everything else stays as it is.
create or replace function public.sky_save_shared(p_owner uuid, p_state jsonb, p_rev integer) returns integer
language plpgsql security definer set search_path = '' as $$
declare allowed text[]; s public.sky_schools; merged jsonb; new_rev integer;
begin
  select classes into allowed from public.sky_coteachers where owner = p_owner and email = public.sky__my_email();
  if allowed is null then raise exception 'NO_ACCESS' using errcode = '42501'; end if;
  select * into s from public.sky_schools where owner = p_owner for update;
  if not found or s.rev <> p_rev then return null; end if;
  select coalesce(jsonb_agg(coalesce((select y from jsonb_array_elements(p_state->'classes') y where y->>'id' = x->>'id' and x->>'id' = any (allowed) limit 1), x) order by o), '[]'::jsonb)
    into merged from jsonb_array_elements(s.state->'classes') with ordinality t(x, o);
  update public.sky_schools set state = jsonb_set(state, '{classes}', merged), rev = rev + 1, updated_at = now() where owner = p_owner returning rev into new_rev;
  return new_rev;
end $$;

-- Owner and co-teachers share class records. Picture PINs and class codes stay the owner's to change.
drop policy if exists sky_codes_own on public.sky_codes;
-- Family codes and picture PINs open a child's page, so only the owner can see or make them; removing a co-teacher
-- then cuts their access at once.
create policy sky_codes_own on public.sky_codes for all to authenticated using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
drop policy if exists sky_results_own on public.sky_results;
create policy sky_results_own on public.sky_results for all to authenticated using (public.sky_can(owner, class_id));
drop policy if exists sky_checkins_own on public.sky_checkins;
create policy sky_checkins_own on public.sky_checkins for all to authenticated using (public.sky_can(owner, class_id));
-- Co-teachers can see who is locked out; only the owner can unlock, so the PIN limits cannot be reset over and over.
drop policy if exists sky_pin_fails_own on public.sky_pin_fails;
drop policy if exists sky_pin_fails_read on public.sky_pin_fails;
drop policy if exists sky_pin_fails_unlock on public.sky_pin_fails;
create policy sky_pin_fails_read on public.sky_pin_fails for select to authenticated using (public.sky_can(owner, class_id));
create policy sky_pin_fails_unlock on public.sky_pin_fails for delete to authenticated using (owner = (select auth.uid()));
drop policy if exists sky_pins_own on public.sky_pins;
drop policy if exists sky_pins_read on public.sky_pins;
drop policy if exists sky_pins_write on public.sky_pins;
create policy sky_pins_write on public.sky_pins for all to authenticated using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
drop policy if exists sky_class_logins_own on public.sky_class_logins;
drop policy if exists sky_class_logins_read on public.sky_class_logins;
drop policy if exists sky_class_logins_write on public.sky_class_logins;
create policy sky_class_logins_read on public.sky_class_logins for select to authenticated using (public.sky_can(owner, class_id));
create policy sky_class_logins_write on public.sky_class_logins for all to authenticated using (owner = (select auth.uid())) with check (owner = (select auth.uid()));

-- Usernames: each child signs in anywhere with a username and their picture PIN.
create table if not exists public.sky_usernames (
  username text primary key check (username ~ '^[a-z0-9][a-z0-9-]{2,23}$'),
  owner uuid not null references auth.users(id) on delete cascade,
  class_id text not null check (length(class_id) between 1 and 40),
  student_id text not null check (length(student_id) between 1 and 40),
  unique (owner, class_id, student_id)
);
alter table public.sky_usernames drop constraint if exists sky_usernames_username_check;
alter table public.sky_usernames add constraint sky_usernames_username_check check (username ~ '^[a-z0-9][a-z0-9-]{2,23}$');
alter table public.sky_usernames enable row level security;
revoke all on public.sky_usernames from anon, authenticated;
grant select, delete on public.sky_usernames to authenticated;
drop policy if exists sky_usernames_read on public.sky_usernames;
create policy sky_usernames_read on public.sky_usernames for select to authenticated using (public.sky_can(owner, class_id));
drop policy if exists sky_usernames_delete on public.sky_usernames;
create policy sky_usernames_delete on public.sky_usernames for delete to authenticated using (owner = (select auth.uid()));

-- Makes usernames for children in one of the owner's classes who have none yet: first name + class (ann601),
-- or class + seat number when the name has no Latin letters (60107), then a random part (60107-k7mpq).
-- The random part is what keeps a username from being guessed from a seat number.
create or replace function public.sky_make_usernames(p_class text) returns integer
language plpgsql security definer set search_path = '' as $$
declare cls jsonb; st jsonb; o bigint; base text; num text; seat text; cand text; made integer := 0;
begin
  if auth.uid() is null then raise exception 'SIGN_IN_REQUIRED' using errcode = '28000'; end if;
  select x into cls from public.sky_schools s, jsonb_array_elements(s.state->'classes') x where s.owner = auth.uid() and x->>'id' = p_class;
  if cls is null then return 0; end if;
  num := coalesce(substring(cls->>'name' from '(\d+)\s*$'), substring(cls->>'name' from '\d+'), '');
  for st, o in select y, ord from jsonb_array_elements(cls->'students') with ordinality t(y, ord) loop
    continue when exists (select 1 from public.sky_usernames where owner = auth.uid() and class_id = p_class and student_id = st->>'id');
    base := left(lower(regexp_replace(split_part(btrim(st->>'name'), ' ', 1), '[^A-Za-z]', '', 'g')), 10);
    if length(base) >= 2 then base := base || num;
    else seat := coalesce(substring(st->>'id' from '-(\d+)$'), o::text); base := case when num <> '' then num else 'kid' end || lpad(seat, 2, '0');
    end if;
    loop
      select left(base, 12) || '-' || string_agg(substr('abcdefghjkmnpqrstuvwxyz23456789', (get_byte(b, i) % 31) + 1, 1), '') into cand
        from (select uuid_send(gen_random_uuid()) b) r, generate_series(0, 4) i;
      exit when not exists (select 1 from public.sky_usernames where username = cand);
    end loop;
    insert into public.sky_usernames values (cand, auth.uid(), p_class, st->>'id');
    made := made + 1;
  end loop;
  return made;
end $$;

-- The PIN check shared by both ways of signing in.
-- Guessing limits, per child: 8 wrong tries in 10 minutes locks them, and each lockout lasts twice as long
-- as the last (10, 20, 40 minutes ... up to a day); 20 wrong tries in a day locks them until the day is up.
-- Lockouts wear off after a quiet day, a right PIN clears them, and the teacher can clear them at any time.
create or replace function public.sky__pin_try(p_owner uuid, p_class text, p_student text, p_pin text) returns text
language plpgsql security definer set search_path = '' as $$
declare f public.sky_pin_fails; ok boolean; k text; lock_len interval; nf integer; nl integer;
begin
  if not exists (select 1 from public.sky_pins where owner = p_owner and class_id = p_class and student_id = p_student) then return null; end if;
  -- One guess at a time per child, so a burst of simultaneous guesses cannot slip past the counters.
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text || '|' || p_class || '|' || p_student, 0));
  select * into f from public.sky_pin_fails where owner = p_owner and class_id = p_class and student_id = p_student;
  if found then
    lock_len := least(interval '10 minutes' * power(2, greatest(f.locks, 1) - 1), interval '1 day');
    if (f.fails >= 8 and f.since > now() - lock_len) or (f.day_fails >= 20 and f.day_since > now() - interval '1 day') then return 'LOCKED'; end if;
  end if;
  select exists (select 1 from public.sky_pins where owner = p_owner and class_id = p_class and student_id = p_student and pin = p_pin) into ok;
  if not ok then
    if f.owner is null then
      insert into public.sky_pin_fails (owner, class_id, student_id, fails, since, locks, day_fails, day_since) values (p_owner, p_class, p_student, 1, now(), 0, 1, now());
      return null;
    end if;
    nl := case when f.since < now() - interval '1 day' - lock_len then 0 else f.locks end; -- a quiet day forgives earlier lockouts
    nf := case when f.fails >= 8 or f.since < now() - interval '10 minutes' then 1 else f.fails + 1 end;
    update public.sky_pin_fails set
      fails = least(nf, 8), since = case when nf = 1 or nf >= 8 then now() else since end, locks = nl + (case when nf >= 8 then 1 else 0 end),
      day_fails = case when day_since < now() - interval '1 day' then 1 else day_fails + 1 end,
      day_since = case when day_since < now() - interval '1 day' then now() else day_since end
      where owner = p_owner and class_id = p_class and student_id = p_student;
    return null;
  end if;
  delete from public.sky_pin_fails where owner = p_owner and class_id = p_class and student_id = p_student;
  select code into k from public.sky_codes where owner = p_owner and class_id = p_class and student_id = p_student;
  if k is null then
    loop
      select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (get_byte(b, i) % 32) + 1, 1), '') into k
        from (select uuid_send(gen_random_uuid()) b) r, generate_series(0, 9) i;
      exit when not exists (select 1 from public.sky_codes where code = k);
    end loop;
    insert into public.sky_codes (code, owner, class_id, student_id) values (k, p_owner, p_class, p_student);
  end if;
  return k;
end $$;
revoke all on function public.sky__pin_try(uuid, text, text, text) from public, anon, authenticated;

create or replace function public.sky_pin_login(p_class text, p_student text, p_pin text) returns text
language plpgsql security definer set search_path = '' as $$
declare l public.sky_class_logins;
begin
  select * into l from public.sky_class_logins where code = upper(btrim(coalesce(p_class, '')));
  if not found then return null; end if;
  return public.sky__pin_try(l.owner, l.class_id, coalesce(p_student, ''), p_pin);
end $$;
-- Username sign-in works from anywhere, so on top of each child's own limits each internet connection gets
-- 60 failed username sign-ins an hour; after that, that connection gets 'BUSY' until the hour is over.
-- It is per connection, so one person guessing cannot block everyone else. Unknown usernames and wrong PINs
-- give the same answer, so usernames cannot be fished for, and usernames without the random part never work.
drop table if exists public.sky_login_hour;
create table if not exists public.sky_login_ip (hour timestamptz not null, ip text not null, fails integer not null default 0, primary key (hour, ip));
alter table public.sky_login_ip enable row level security;
revoke all on public.sky_login_ip from anon, authenticated;
create or replace function public.sky_user_login(p_user text, p_pin text) returns text
language plpgsql security definer set search_path = '' as $$
declare u public.sky_usernames; h timestamptz := date_trunc('hour', now()); k text; v_ip text; hd json; xff text[]; name text := lower(btrim(coalesce(p_user, '')));
begin
  -- The visitor's address as the network saw it: Cloudflare's header, or the last x-forwarded-for entry
  -- (added by the proxy). Earlier entries are whatever the visitor sent, so they are never trusted.
  hd := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json;
  xff := string_to_array(coalesce(hd->>'x-forwarded-for', ''), ',');
  v_ip := left(coalesce(nullif(btrim(hd->>'cf-connecting-ip'), ''), nullif(btrim(xff[array_length(xff, 1)]), ''), 'unknown'), 64);
  if coalesce((select l.fails from public.sky_login_ip l where l.hour = h and l.ip = v_ip), 0) >= 60 then return 'BUSY'; end if;
  if name ~ '^[a-z0-9]+-[a-z2-9]{5}$' then
    select * into u from public.sky_usernames where username = name;
    if found then k := public.sky__pin_try(u.owner, u.class_id, u.student_id, p_pin); end if;
  end if;
  if k is null then
    insert into public.sky_login_ip values (h, v_ip, 1) on conflict (hour, ip) do update set fails = public.sky_login_ip.fails + 1;
    delete from public.sky_login_ip where hour < h - interval '1 day';
  end if;
  return k;
end $$;

-- Profile photos and behaviour notes. Private: the class's teachers and the child's own login only.
create table if not exists public.sky_avatars (
  owner uuid not null references auth.users(id) on delete cascade,
  class_id text not null, student_id text not null,
  data text not null check (data ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$' and length(data) < 60000),
  updated_at timestamptz not null default now(),
  primary key (owner, class_id, student_id)
);
create table if not exists public.sky_notes (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade,
  class_id text not null, student_id text not null,
  kind text not null check (kind in ('star', 'kind', 'work', 'remind', 'moment')),
  body text not null default '' check (length(body) <= 500),
  photo text check (photo is null or (photo ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$' and length(photo) < 400000)),
  author uuid default auth.uid(), created_at timestamptz not null default now()
);
alter table public.sky_notes add column if not exists has_photo boolean generated always as (photo is not null) stored;
create index if not exists sky_notes_child on public.sky_notes (owner, class_id, student_id, created_at desc);
alter table public.sky_avatars enable row level security;
alter table public.sky_notes enable row level security;
revoke all on public.sky_avatars, public.sky_notes from anon, authenticated;
grant select, insert, update, delete on public.sky_avatars to authenticated;
grant select, insert, delete on public.sky_notes to authenticated;
drop policy if exists sky_avatars_class on public.sky_avatars;
create policy sky_avatars_class on public.sky_avatars for all to authenticated using (public.sky_can(owner, class_id)) with check (public.sky_can(owner, class_id));
drop policy if exists sky_notes_class on public.sky_notes;
create policy sky_notes_class on public.sky_notes for all to authenticated using (public.sky_can(owner, class_id)) with check (public.sky_can(owner, class_id));

-- The child (or their parent) changes their own profile picture. Empty removes it.
create or replace function public.sky_family_avatar(p_code text, p_data text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare c public.sky_codes;
begin
  select * into c from public.sky_codes where code = upper(btrim(coalesce(p_code, '')));
  if not found then return false; end if;
  if coalesce(p_data, '') = '' then delete from public.sky_avatars where owner = c.owner and class_id = c.class_id and student_id = c.student_id; return true; end if;
  if p_data !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$' or length(p_data) >= 60000 then return false; end if;
  insert into public.sky_avatars values (c.owner, c.class_id, c.student_id, p_data, now())
    on conflict (owner, class_id, student_id) do update set data = excluded.data, updated_at = now();
  return true;
end $$;
-- A note's photo, only for the child it is about.
create or replace function public.sky_family_note_photo(p_code text, p_note uuid) returns text
language sql stable security definer set search_path = '' as $$
  select n.photo from public.sky_codes c join public.sky_notes n on n.owner = c.owner and n.class_id = c.class_id and n.student_id = c.student_id
  where c.code = upper(btrim(coalesce(p_code, ''))) and n.id = p_note
$$;
-- Extra parts of the family page: photo, username, and the latest notes (photos fetched one at a time).
create or replace function public.sky_family_extra(p_code text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'avatar', (select data from public.sky_avatars a where a.owner = c.owner and a.class_id = c.class_id and a.student_id = c.student_id),
    'username', (select username from public.sky_usernames u where u.owner = c.owner and u.class_id = c.class_id and u.student_id = c.student_id),
    'notes', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'body', n.body, 'photo', n.photo is not null, 't', (extract(epoch from n.created_at) * 1000)::bigint) order by n.created_at desc)
      from (select * from public.sky_notes n where n.owner = c.owner and n.class_id = c.class_id and n.student_id = c.student_id order by created_at desc limit 30) n), '[]'::jsonb))
  from public.sky_codes c where c.code = upper(btrim(coalesce(p_code, '')))
$$;

revoke all on function public.sky__my_email(), public.sky_can(uuid, text) from public, anon;
grant execute on function public.sky_can(uuid, text), public.sky__my_email() to authenticated;
revoke all on function public.sky_shared_schools(), public.sky_load_shared(uuid), public.sky_save_shared(uuid, jsonb, integer), public.sky_make_usernames(text) from public, anon;
grant execute on function public.sky_shared_schools(), public.sky_load_shared(uuid), public.sky_save_shared(uuid, jsonb, integer), public.sky_make_usernames(text) to authenticated;
revoke all on function public.sky_pin_login(text, text, text), public.sky_user_login(text, text), public.sky_family_avatar(text, text), public.sky_family_note_photo(text, uuid), public.sky_family_extra(text) from public;
grant execute on function public.sky_pin_login(text, text, text), public.sky_user_login(text, text), public.sky_family_avatar(text, text), public.sky_family_note_photo(text, uuid), public.sky_family_extra(text) to anon, authenticated;
