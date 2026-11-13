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
    assign: [{ id: 'a1', setId: 'set1', game: 'quiz' }], results: { a1: { s1: { best: 2, total: 5, tries: 1 }, s2: { best: 5, total: 5, tries: 1 } } },
    checkin: { '2026-11-10': { s1: 4, s2: 1 } },
    posts: [{ id: 'p1', kind: 'news', text: 'Trip on Friday', t: 1 }],
  }],
  lessons: [{ id: 'l1', title: 'Water', slides: [{ type: 'info', title: 'Rain' }] }],
  lib: { repo: 'a/b', branch: 'main', items: [{ path: 'x.pptx', kind: 'slides' }] },
};

test('teachers are isolated, saves are revision-checked, family codes show one child only', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
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
    assert.equal(v.lib.items[0].path, 'x.pptx');
    assert.ok(!JSON.stringify(v).includes('Sara'), 'no other child leaks');
    assert.ok(!('students' in v.class));
    assert.deepEqual(v.credit, { s1: {} });

    // practice and check-ins from home
    assert.equal(v.assign[0].id, 'a1');
    assert.deepEqual(v.localResults, { a1: { best: 2, total: 5, tries: 1 } });
    assert.deepEqual(v.localCheckins, { '2026-11-10': 4 });
    const play = async (code, a, s, t) => (await q('select public.sky_family_play($1,$2,$3,$4) ok', [code, a, s, t]))[0].ok;
    assert.equal(await play('WRONGCODE2', 'a1', 3, 5), false);
    assert.equal(await play('ABCDEFGH23', 'not-assigned', 3, 5), false);
    assert.equal(await play('ABCDEFGH23', 'a1', 3, 5), true);
    assert.equal(await play('ABCDEFGH23', 'a1', 1, 5), true, 'a lower score keeps the best');
    assert.equal(await play('ABCDEFGH23', 'a1', 999, -4), false, 'nonsense is refused');
    assert.equal(await play('ABCDEFGH23', 'a1', 6, 5), false, 'more than the total is refused');
    const ci = async (code, day, mood) => (await q('select public.sky_family_checkin($1,$2::date,$3) ok', [code, day, mood]))[0].ok;
    const today = (await q('select current_date::text d'))[0].d;
    assert.equal(await ci('ABCDEFGH23', today, 5), true);
    assert.equal(await ci('ABCDEFGH23', today, 2), true, 'changing your mind replaces it');
    assert.equal(await ci('ABCDEFGH23', '2020-01-01', 3), false, 'only around today');
    assert.equal(await ci('ABCDEFGH23', today, 9), false);
    assert.equal(await ci('WRONGCODE2', today, 3), false);
    await assert.rejects(q('select * from public.sky_results'), /permission denied/);
    await assert.rejects(q("insert into public.sky_checkins values ($1,'c1','s2',current_date,5)", [T1]), /permission denied/);
    const v2 = (await q("select public.sky_family_view('ABCDEFGH23') v"))[0].v;
    assert.deepEqual(v2.homeResults.a1 && [v2.homeResults.a1.best, v2.homeResults.a1.total, v2.homeResults.a1.tries], [3, 5, 2]);
    assert.deepEqual(v2.homeCheckins, { [today]: 2 });
    assert.ok(!JSON.stringify(v2).includes('s2'), 'no other child leaks through results or check-ins');

    await as(T2);
    assert.equal((await q('select * from public.sky_results')).length, 0, 'other teacher sees no results');
    assert.equal((await q('select * from public.sky_checkins')).length, 0);
    await assert.rejects(q("insert into public.sky_results values ($1,'c1','s1','a1',1,1,1,now())", [T2]), /permission denied/);
    await as(T1);
    assert.equal((await q('select * from public.sky_results')).length, 1);
    assert.equal((await q('select mood from public.sky_checkins'))[0].mood, 2);

    // iPad login: class code -> first names of children with a PIN -> PIN -> their family code
    await as(T1);
    await q("insert into public.sky_class_logins(code,class_id) values ('CLASS234','c1')");
    await q("insert into public.sky_pins(class_id,student_id,pin) values ('c1','s2','1234')");
    await assert.rejects(q("insert into public.sky_pins(class_id,student_id,pin) values ('c1','s1','9999')"), /check/);
    await as(T2);
    assert.equal((await q('select * from public.sky_pins')).length, 0, 'other teacher cannot read PINs');
    await assert.rejects(q("insert into public.sky_class_logins(code,owner,class_id) values ('CLASS235',$1,'c1')", [T1]), /row-level security/);
    await as(null);
    await assert.rejects(q('select * from public.sky_pins'), /permission denied/);
    assert.equal((await q("select public.sky_class_roster('NOPE2345') v"))[0].v, null);
    const roster = (await q("select public.sky_class_roster(' class234 ') v"))[0].v;
    assert.deepEqual(roster, { name: '4 Blue', students: [{ id: 's2', name: 'Sara' }] }, 'only children with a PIN, first name only');
    const login = async pin => (await q("select public.sky_pin_login('CLASS234','s2',$1) k", [pin]))[0].k;
    assert.equal((await q("select public.sky_pin_login('CLASS234','s1','1234') k"))[0].k, null, 'no PIN, no login');
    for (let i = 0; i < 7; i++) assert.equal(await login('1111'), null);
    const k1 = await login('1234'); assert.match(k1, /^[A-HJ-NP-Z2-9]{10}$/, 'right PIN gives a family code');
    assert.equal(await login('1234'), k1, 'same code next time');
    assert.equal((await q('select public.sky_family_view($1) v', [k1]))[0].v.student.name, 'Sara');
    for (let i = 0; i < 8; i++) await login('1111');
    assert.equal(await login('1234'), 'LOCKED', 'eight wrong tries locks even the right PIN');
    await db.exec('reset role'); await db.exec("update public.sky_pin_fails set since = now() - interval '11 minutes'");
    await as(null); assert.equal(await login('1111'), null, 'first lockout lasts ten minutes');
    for (let i = 0; i < 7; i++) await login('1111');
    assert.equal(await login('1234'), 'LOCKED', 'second lockout');
    await db.exec('reset role'); await db.exec("update public.sky_pin_fails set since = now() - interval '11 minutes'");
    await as(null); assert.equal(await login('1234'), 'LOCKED', 'the second lockout lasts twice as long');
    await db.exec('reset role'); await db.exec("update public.sky_pin_fails set since = now() - interval '21 minutes'");
    await as(null); assert.equal(await login('1234'), k1, 'unlocks after twenty minutes');
    await db.exec('reset role'); assert.equal((await q('select count(*)::int n from public.sky_pin_fails'))[0].n, 0, 'a right PIN clears the record'); await as(null);
    // slow guessing: 7 tries every 10 minutes never trips the short lock, but 20 in a day does
    for (const n of [7, 7, 6]) {
      for (let i = 0; i < n; i++) assert.notEqual(await login('1111'), 'LOCKED');
      await db.exec('reset role'); await db.exec("update public.sky_pin_fails set since = now() - interval '11 minutes'"); await as(null);
    }
    assert.equal(await login('1234'), 'LOCKED', '20 wrong tries in a day locks for the day, even when spread out');
    await db.exec('reset role'); await db.exec("update public.sky_pin_fails set since = now() - interval '2 days', day_since = now() - interval '25 hours'"); await as(null);
    assert.equal(await login('1234'), k1, 'the daily lock ends after a day');
    // the teacher can clear a lockout straight away
    for (let i = 0; i < 8; i++) await login('1111');
    assert.equal(await login('1234'), 'LOCKED');
    await as(T2); assert.equal((await db.query('delete from public.sky_pin_fails')).affectedRows, 0, 'another teacher cannot clear it');
    await as(T1); assert.equal((await q('select count(*)::int n from public.sky_pin_fails'))[0].n, 1, 'teacher sees the lockout');
    await q("delete from public.sky_pin_fails where class_id = 'c1'");
    await as(null); assert.equal(await login('1234'), k1, 'unlocked by the teacher');

    await as(T1); await q("delete from public.sky_codes where code='ABCDEFGH23'");
    await as(null);
    assert.equal((await q("select public.sky_family_view('ABCDEFGH23') v"))[0].v, null, 'revoked code stops working');
  } finally { await db.close(); }
});
