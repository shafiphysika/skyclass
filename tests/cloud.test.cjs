// Runs the real SQL in PGlite (Postgres in Node) to check who can see and change what.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const T1 = '00000000-0000-0000-0000-000000000001', T2 = '00000000-0000-0000-0000-000000000002';
const school = {
  classes: [{
    id: 'c1', name: '4 Blue', goal: { target: 300, reward: 'Picnic' },
    students: [{ id: 's1', name: 'Ali', points: 12, log: [] }, { id: 's2', name: 'Sara', points: 30, log: [] }],
    attendance: { '2026-11-10': { s1: 'p', s2: 'a' }, '2026-11-11': { s2: 'p' } },
    posts: [{ id: 'p1', kind: 'news', text: 'Trip on Friday', t: 1 }],
  }],
  lessons: [{ id: 'l1', title: 'Water', slides: [{ type: 'info', title: 'Rain' }] }],
};

test('teachers are isolated, saves are revision-checked, family codes show one child only', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
      insert into auth.users values ('${T1}'), ('${T2}');`);
    const sql = fs.readFileSync(path.join(__dirname, '../supabase/skyclass.sql'), 'utf8');
    await db.exec(sql); await db.exec(sql); // must be re-runnable
    const as = async id => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id || '']); await db.exec(`set role ${id ? 'authenticated' : 'anon'}`); };
    const q = async (s, a = []) => (await db.query(s, a)).rows;

    await as(T1);
    assert.equal((await q('select public.sky_save($1,0) r', [school]))[0].r, 1);
    assert.equal((await q('select public.sky_save($1,1) r', [school]))[0].r, 2);
    assert.equal((await q('select public.sky_save($1,1) r', [{ classes: [] }]))[0].r, null, 'stale save must not overwrite');
    assert.equal((await q('select state from public.sky_schools'))[0].state.classes.length, 1);
    await q("insert into public.sky_codes(code,class_id,student_id) values ('ABCDEFGH23','c1','s1')");
    await assert.rejects(q("insert into public.sky_codes(code,class_id,student_id) values ('short','c1','s2')"), /check/);
    await assert.rejects(q("insert into public.sky_codes(code,owner,class_id,student_id) values ('ZZZZZZZZ99',$1,'c1','s2')", [T2]), /row-level security/);

    await as(T2);
    assert.equal((await q('select * from public.sky_schools')).length, 0, 'other teacher sees no school');
    assert.equal((await q('select * from public.sky_codes')).length, 0, 'other teacher sees no codes');
    assert.equal((await db.query("update public.sky_schools set state='{}'")).affectedRows, 0);
    assert.equal((await db.query('delete from public.sky_codes')).affectedRows, 0);

    await as(null);
    await assert.rejects(q('select * from public.sky_schools'), /permission denied/);
    await assert.rejects(q('select * from public.sky_codes'), /permission denied/);
    await assert.rejects(q('select public.sky_save($1,0)', [school]), /permission denied/);
    assert.equal((await q("select public.sky_family_view('WRONGCODE2') v"))[0].v, null);
    assert.equal((await q('select public.sky_family_view(null) v'))[0].v, null);
    const v = (await q("select public.sky_family_view(' abcdefgh23 ') v"))[0].v;
    assert.equal(v.student.name, 'Ali');
    assert.equal(v.class.total, 42);
    assert.deepEqual(v.class.attendance, { '2026-11-10': { s1: 'p' } });
    assert.equal(v.class.posts.length, 1);
    assert.equal(v.lessons.length, 1);
    assert.ok(!JSON.stringify(v).includes('Sara'), 'no other child leaks');
    assert.ok(!('students' in v.class));

    await as(T1); await q("delete from public.sky_codes where code='ABCDEFGH23'");
    await as(null);
    assert.equal((await q("select public.sky_family_view('ABCDEFGH23') v"))[0].v, null, 'revoked code stops working');
  } finally { await db.close(); }
});
