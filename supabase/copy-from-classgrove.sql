-- One-time copy of ClassGrove records into the Skyclass school of one teacher:
-- class lists, points, class goals, attendance marks and announcements.
-- Reads pp_* tables only; writes a single sky_schools row. Does nothing if that teacher already
-- has a Skyclass school, so it can never overwrite work. Set the email on the "owner" line.
-- Not copied (Skyclass has no place for them): ClassGrove lessons, assessments and scores.
-- "Excused" attendance is left unmarked so it does not count against the child.
with owner as (select id from auth.users where lower(email) = lower('teacher@example.org') limit 1),
src as (
  select s.id sid, s.name sname, r.key ckey, r.value rv, st.data->'classes'->r.key cd, coalesce(st.data->'portal', '{}'::jsonb) portal,
         left('cg-' || left(s.id::text, 8) || '-' || r.key, 33) cid
  from public.pp_schools s
  join public.pp_school_state st on st.school_id = s.id,
  jsonb_each(case when jsonb_typeof(st.data->'roster') = 'object' then st.data->'roster' else '{}'::jsonb end) r
  where jsonb_typeof(r.value->'names') = 'array'
),
many as (select count(distinct sid) > 1 as yes from src),
built as (
  select sname, ckey, jsonb_build_object(
    'id', cid,
    -- with several schools, class names start with the school's first word, e.g. "Beitun · 601"
    'name', left(case when (select yes from many) then split_part(btrim(sname), ' ', 1) || ' · ' else '' end || coalesce(nullif(rv->>'label', ''), nullif(rv->>'name', ''), ckey), 40),
    'students', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', cid || '-' || n.ord,
        'name', left(btrim(n.name), 60),
        'points', case when (cd->'pts'->>(n.ord::text)) ~ '^\d+(\.\d+)?$' then round((cd->'pts'->>(n.ord::text))::numeric)::int else 0 end,
        'log', '[]'::jsonb) order by n.ord)
      from jsonb_array_elements_text(rv->'names') with ordinality n(name, ord)
      where btrim(coalesce(n.name, '')) <> ''), '[]'::jsonb),
    'attendance', coalesce((
      select jsonb_object_agg(day, marks) from (
        select d.key as day, (
          select jsonb_object_agg(cid || '-' || m.key, case m.value when 'present' then 'p' when 'late' then 'l' else 'a' end)
          from jsonb_each_text(d.value->ckey) m where m.value in ('present', 'late', 'absent') and m.key ~ '^\d+$') as marks
        from jsonb_each(case when jsonb_typeof(portal->'attendance') = 'object' then portal->'attendance' else '{}'::jsonb end) d
        where d.key ~ '^\d{4}-\d{2}-\d{2}$' and jsonb_typeof(d.value->ckey) = 'object') x
      where marks is not null), '{}'::jsonb),
    'posts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', left(a->>'id', 40), 'kind', 'news', 'due', '',
        'text', left(concat_ws(E'\n', a->>'title', nullif(a->>'body', '')), 2000),
        -- midday UTC, so the date shows as the same day in any time zone near the school
        't', (extract(epoch from case when (a->>'date') ~ '^\d{4}-\d{2}-\d{2}$' then ((a->>'date') || ' 12:00:00+00')::timestamptz else now() end) * 1000)::bigint))
      from jsonb_array_elements(case when jsonb_typeof(portal->'announcements') = 'array' then portal->'announcements' else '[]'::jsonb end) a
      where coalesce(a->>'classId', '') in ('', ckey) and coalesce(a->>'title', '') <> ''), '[]'::jsonb),
    'goal', jsonb_build_object(
      'target', case when (cd->>'goal') ~ '^\d{1,6}$' then greatest(10, (cd->>'goal')::int) else 300 end,
      'reward', coalesce(nullif(left(cd->>'reward', 60), ''), 'Game time'))) c
  from src
)
insert into public.sky_schools (owner, state, rev)
select o.id, jsonb_build_object('v', 1, 'classes', (select jsonb_agg(c order by sname, ckey) from built where jsonb_array_length(c->'students') > 0)), 1
from owner o
where exists (select 1 from built where jsonb_array_length(c->'students') > 0)
on conflict (owner) do nothing
returning jsonb_array_length(state->'classes') as classes_copied,
  (select count(*) from jsonb_array_elements(state->'classes') k, jsonb_array_elements(k->'students')) as students_copied,
  (select coalesce(sum((s->>'points')::int), 0) from jsonb_array_elements(state->'classes') k, jsonb_array_elements(k->'students') s) as points_copied,
  (select count(*) from jsonb_array_elements(state->'classes') k, jsonb_each(k->'attendance') d, jsonb_each(d.value)) as attendance_marks_copied,
  (select count(*) from jsonb_array_elements(state->'classes') k, jsonb_array_elements(k->'posts')) as posts_copied;
