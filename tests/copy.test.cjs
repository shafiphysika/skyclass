// The ClassGrove copy query must produce what the in-app importer produces, and never overwrite.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const C = require('../core.js');

test('ClassGrove copy: names, points, attendance and news match; second run changes nothing', async () => {
  const db = new PGlite();
  try {
    const U = '00000000-0000-0000-0000-000000000001', A = '10000000-0000-0000-0000-00000000000a', B = '20000000-0000-0000-0000-00000000000b';
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key, email text);
      create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
      insert into auth.users values ('${U}', 'Teacher@Example.org');
      create table public.pp_schools(id uuid primary key, name text);
      create table public.pp_school_state(school_id uuid primary key, data jsonb, revision bigint default 0);`);
    await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/skyclass.sql'), 'utf8'));
    const a = {
      roster: { '601': { names: ['Ali', '', 'Sara', null, '  Zed  '] }, '602': { names: [] } },
      classes: { '601': { pts: { 1: 12, 3: 7, 5: 'x', 9: 99 }, goal: 500, reward: 'Picnic' } },
      portal: {
        attendance: { '2026-11-10': { '601': { 1: 'present', 2: 'late', 3: 'absent', 5: 'excused' }, '999': { 1: 'present' } }, 'bad-day': { '601': { 1: 'present' } } },
        announcements: [{ id: 'n1', classId: '601', title: 'Trip', body: 'Friday', date: '2026-11-09' }, { id: 'n2', classId: '', title: 'All', body: '' }, { id: 'n3', classId: '999', title: 'Other' }],
      },
    };
    const b = { roster: { K1: { names: ['Mia'], label: 'Kinder One' } }, classes: { K1: { pts: { 1: 3.6 } } } };
    await db.query('insert into public.pp_schools values ($1,$2),($3,$4),($5,$6)', [A, 'North Elementary School (long name)', B, 'South', '30000000-0000-0000-0000-00000000000c', 'Empty']);
    await db.query('insert into public.pp_school_state(school_id,data) values ($1,$2),($3,$4),($5,$6)', [A, a, B, b, '30000000-0000-0000-0000-00000000000c', {}]);
    const sql = fs.readFileSync(path.join(__dirname, '../supabase/copy-from-classgrove.sql'), 'utf8');
    const first = (await db.query(sql)).rows.map(r => Object.values(r).map(Number));
    assert.deepEqual(first, [[2, 4, 23, 3, 2]]);
    const state = C.normalize((await db.query('select state from public.sky_schools')).rows[0].state);
    const shape = s => s.map(c => [c.name, c.goal, c.students.map(x => [x.name, x.points])]);
    const expected = [...C.fromClassGrove(a, 'North'), ...C.fromClassGrove({ ...b, classes: { K1: { pts: { 1: 4 } } } }, 'South')];
    assert.deepEqual(shape(state.classes), shape(expected));
    const north = state.classes[0], id = n => north.students.find(s => s.name === n).id;
    assert.deepEqual(north.attendance, { '2026-11-10': { [id('Ali')]: 'p', [id('Sara')]: 'a' } }, 'empty seats and excused marks are dropped');
    assert.deepEqual(north.posts.map(p => p.text), ['Trip\nFriday', 'All']);
    assert.equal(new Date(north.posts[0].t).toISOString().slice(0, 10), '2026-11-09');
    assert.equal(state.classes[1].posts.length, 0, 'another school\'s news does not leak across');
    assert.equal(new Set(state.classes.flatMap(c => c.students.map(s => s.id))).size, 4, 'student ids are unique');
    assert.equal(state.lessons.length, 2, 'sample lessons are kept');
    assert.equal((await db.query(sql)).rows.length, 0, 'second run must not overwrite');
  } finally { await db.close(); }
});
