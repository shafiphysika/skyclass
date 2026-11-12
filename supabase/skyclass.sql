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

-- Checks a child's picture PIN and hands back their family code for this visit.
-- Guessing limits, per child: 8 wrong tries in 10 minutes locks them, and each lockout lasts twice as long
-- as the last (10, 20, 40 minutes ... up to a day); 20 wrong tries in a day locks them until the day is up.
-- Lockouts wear off after a quiet day, a right PIN clears them, and the teacher can clear them at any time.
create or replace function public.sky_pin_login(p_class text, p_student text, p_pin text) returns text
language plpgsql security definer set search_path = '' as $$
declare l public.sky_class_logins; f public.sky_pin_fails; ok boolean; k text; lock_len interval; nf integer; nl integer;
begin
  select * into l from public.sky_class_logins where code = upper(btrim(coalesce(p_class, '')));
  if not found then return null; end if;
  if not exists (select 1 from public.sky_pins where owner = l.owner and class_id = l.class_id and student_id = p_student) then return null; end if;
  -- One guess at a time per child, so a burst of simultaneous guesses cannot slip past the counters.
  perform pg_advisory_xact_lock(hashtextextended(l.owner::text || '|' || l.class_id || '|' || p_student, 0));
  select * into f from public.sky_pin_fails where owner = l.owner and class_id = l.class_id and student_id = p_student;
  if found then
    lock_len := least(interval '10 minutes' * power(2, greatest(f.locks, 1) - 1), interval '1 day');
    if (f.fails >= 8 and f.since > now() - lock_len) or (f.day_fails >= 20 and f.day_since > now() - interval '1 day') then return 'LOCKED'; end if;
  end if;
  select exists (select 1 from public.sky_pins where owner = l.owner and class_id = l.class_id and student_id = p_student and pin = p_pin) into ok;
  if ok then
    delete from public.sky_pin_fails where owner = l.owner and class_id = l.class_id and student_id = p_student;
  else
    if f.owner is null then
      insert into public.sky_pin_fails (owner, class_id, student_id, fails, since, locks, day_fails, day_since) values (l.owner, l.class_id, p_student, 1, now(), 0, 1, now());
      return null;
    end if;
    nl := case when f.since < now() - interval '1 day' - lock_len then 0 else f.locks end; -- a quiet day forgives earlier lockouts
    nf := case when f.fails >= 8 or f.since < now() - interval '10 minutes' then 1 else f.fails + 1 end;
    update public.sky_pin_fails set
      fails = least(nf, 8), since = case when nf = 1 or nf >= 8 then now() else since end, locks = nl + (case when nf >= 8 then 1 else 0 end),
      day_fails = case when day_since < now() - interval '1 day' then 1 else day_fails + 1 end,
      day_since = case when day_since < now() - interval '1 day' then now() else day_since end
      where owner = l.owner and class_id = l.class_id and student_id = p_student;
    return null;
  end if;
  select code into k from public.sky_codes where owner = l.owner and class_id = l.class_id and student_id = p_student;
  if k is null then
    loop
      select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (get_byte(b, i) % 32) + 1, 1), '') into k
        from (select uuid_send(gen_random_uuid()) b) r, generate_series(0, 9) i;
      exit when not exists (select 1 from public.sky_codes where code = k);
    end loop;
    insert into public.sky_codes (code, owner, class_id, student_id) values (k, l.owner, l.class_id, p_student);
  end if;
  return k;
end $$;
revoke all on function public.sky_class_roster(text), public.sky_pin_login(text, text, text) from public;
grant execute on function public.sky_class_roster(text), public.sky_pin_login(text, text, text) to anon, authenticated;

revoke all on function public.sky_family_play(text, text, integer, integer), public.sky_family_checkin(text, date, integer) from public;
grant execute on function public.sky_family_play(text, text, integer, integer), public.sky_family_checkin(text, date, integer) to anon, authenticated;

revoke all on function public.sky_save(jsonb, integer) from public, anon;
grant execute on function public.sky_save(jsonb, integer) to authenticated;
revoke all on function public.sky_family_view(text) from public;
grant execute on function public.sky_family_view(text) to anon, authenticated;
