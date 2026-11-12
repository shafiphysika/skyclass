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
    'lib', coalesce(st->'lib', '{}'::jsonb));
end $$;

revoke all on function public.sky_save(jsonb, integer) from public, anon;
grant execute on function public.sky_save(jsonb, integer) to authenticated;
revoke all on function public.sky_family_view(text) from public;
grant execute on function public.sky_family_view(text) to anon, authenticated;
