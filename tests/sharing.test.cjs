// Co-teachers, usernames, profile photos and behaviour notes, run against the real SQL in PGlite.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const OWN = '00000000-0000-0000-0000-000000000001', CO = '00000000-0000-0000-0000-000000000002', FAKE = '00000000-0000-0000-0000-000000000003', OTHER = '00000000-0000-0000-0000-000000000004';
const PIC = 'data:image/jpeg;base64,' + 'A'.repeat(200);

test('co-teachers see only invited classes, usernames sign in, photos and notes stay private', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
      insert into auth.users values ('${OWN}', 'owner@example.org', now()), ('${CO}', 'co@example.org', now()), ('${FAKE}', 'fake@example.org', null), ('${OTHER}', 'other@example.org', now());`);
    await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/skyclass.sql'), 'utf8'));
    const as = async id => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id || '']); await db.exec(`set role ${id ? 'authenticated' : 'anon'}`); };
    const q = async (s, a = []) => (await db.query(s, a)).rows;
    const one = async (s, a) => Object.values((await q(s, a))[0])[0];
    const school = { classes: [
      { id: 'c601', name: 'Dazhu · 601', students: [{ id: 's1', name: 'Ann Lee', points: 1 }, { id: 's2', name: '王小明', points: 0 }, { id: 's3', name: 'Ann', points: 0 }] },
      { id: 'c602', name: 'Dazhu · 602', students: [{ id: 't1', name: 'Bo', points: 0 }] }] };

    await as(OWN);
    assert.equal(await one('select public.sky_save($1,0)', [school]), 1);
    await q("insert into public.sky_coteachers(email, classes) values ('co@example.org', '{c601}'), ('fake@example.org', '{c601}')");
    await q("insert into public.sky_pins(class_id,student_id,pin) values ('c601','s1','1234'),('c601','s2','5678'),('c602','t1','1111')");
    await q("insert into public.sky_codes(code,class_id,student_id) values ('ABCDEFGH23','c602','t1')");

    // usernames: first name + class number, unique, made by the owner only
    assert.equal(await one("select public.sky_make_usernames('c601')"), 3);
    assert.equal(await one("select public.sky_make_usernames('c601')"), 0, 'only children without one');
    const names = (await q('select username from public.sky_usernames order by student_id')).map(r => r.username);
    assert.match(names[0], /^ann601-[a-z2-9]{5}$/); assert.match(names[1], /^60102-[a-z2-9]{5}$/); assert.match(names[2], /^ann601-[a-z2-9]{5}$/);
    assert.notEqual(names[0], names[2]);

    // co-teacher: sees and saves only the invited class
    await as(CO);
    const shared = await one('select public.sky_shared_schools()');
    assert.equal(shared.length, 1); assert.equal(shared[0].teacher, 'owner@example.org'); assert.deepEqual(shared[0].classes, ['c601']);
    const loaded = await one('select public.sky_load_shared($1)', [OWN]);
    assert.deepEqual(loaded.state.classes.map(c => c.id), ['c601']);
    const edited = JSON.parse(JSON.stringify(loaded.state)); edited.classes[0].students[0].points = 9;
    edited.classes.push({ id: 'c602', name: 'Hacked', students: [] });
    assert.equal(await one('select public.sky_save_shared($1,$2,$3)', [OWN, edited, loaded.rev]), 2);
    assert.equal(await one('select public.sky_save_shared($1,$2,1)', [OWN, edited]), null, 'stale save refused');
    assert.equal((await q('select * from public.sky_pins')).length, 0, 'co-teachers never see PINs');
    await assert.rejects(q("insert into public.sky_pins(owner,class_id,student_id,pin) values ($1,'c601','s3','4444')", [OWN]), /row-level security/, 'cannot change PINs');
    assert.equal((await q('select * from public.sky_usernames')).length, 3);
    assert.equal((await q('select * from public.sky_codes')).length, 0, 'co-teachers never see family codes');
    await assert.rejects(q("insert into public.sky_codes(code,owner,class_id,student_id) values ('QQQQQQQQ22',$1,'c601','s1')", [OWN]), /row-level security/);
    await q("insert into public.sky_notes(owner,class_id,student_id,kind,body,photo) values ($1,'c601','s1','kind','Helped a friend',$2)", [OWN, PIC]);
    await assert.rejects(q("insert into public.sky_notes(owner,class_id,student_id,kind,body) values ($1,'c602','t1','star','x')", [OWN]), /row-level security/);
    await q("insert into public.sky_avatars(owner,class_id,student_id,data) values ($1,'c601','s2',$2)", [OWN, PIC]);
    await as(OWN);
    const st = await one('select state from public.sky_schools');
    assert.deepEqual(st.classes.map(c => c.name), ['Dazhu · 601', 'Dazhu · 602'], 'other class untouched');
    assert.equal(st.classes[0].students[0].points, 9);

    // an unconfirmed email or an uninvited teacher gets nothing
    for (const who of [FAKE, OTHER]) {
      await as(who);
      assert.deepEqual(await one('select public.sky_shared_schools()'), []);
      assert.equal(await one('select public.sky_load_shared($1)', [OWN]), null);
      await assert.rejects(q('select public.sky_save_shared($1,$2,2)', [OWN, school]), /NO_ACCESS/);
      assert.equal((await q('select * from public.sky_notes')).length + (await q('select * from public.sky_avatars')).length + (await q('select * from public.sky_pins')).length, 0);
    }

    // children sign in with username + picture PIN; same lockout as before
    await as(null);
    const ann = names[0];
    const k = await one('select public.sky_user_login($1, $2)', [' ' + ann.toUpperCase() + ' ', '1234']); assert.match(k, /^[A-HJ-NP-Z2-9]{10}$/);
    assert.equal(await one("select public.sky_user_login('ann601', '1234')"), null, 'the seat or name part alone is not enough');
    assert.equal(await one('select public.sky_user_login($1, $2)', [ann, '9999']), null);
    assert.equal(await one("select public.sky_user_login('nobody', '1234')"), null, 'unknown user looks like a wrong PIN');
    for (let i = 0; i < 8; i++) await q('select public.sky_user_login($1, $2)', [ann, '1111']);
    assert.equal(await one('select public.sky_user_login($1, $2)', [ann, '1234']), 'LOCKED');
    for (let i = 0; i < 290; i++) await q("select public.sky_user_login('guess' || $1, '1234')", [String(i)]);
    assert.equal(await one('select public.sky_user_login($1, $2)', [names[1], '5678']), 'BUSY', '300 failures in an hour pause username sign-in for everyone');
    assert.equal(await one("select public.sky_pin_login('NOPE2345','s2','5678')"), null, 'class-code sign-in is not affected');
    await db.exec('reset role'); await db.exec('delete from public.sky_login_hour'); await as(null);
    await assert.rejects(q("select public.sky__pin_try($1,'c601','s1','1234')", [OWN]), /permission denied/, 'the PIN check is not callable directly');

    // photos and notes: the child's own login sees theirs, nobody else's
    const extra = await one('select public.sky_family_extra($1)', [k]);
    assert.equal(extra.username, ann); assert.equal(extra.avatar, null);
    assert.equal(extra.notes.length, 1); assert.equal(extra.notes[0].body, 'Helped a friend'); assert.equal(extra.notes[0].photo, true);
    assert.equal(await one('select public.sky_family_note_photo($1,$2)', [k, extra.notes[0].id]), PIC);
    assert.equal(await one('select public.sky_family_note_photo($1,$2)', ['ABCDEFGH23', extra.notes[0].id]), null, 'another child cannot open it');
    assert.equal(await one('select public.sky_family_avatar($1,$2)', [k, PIC]), true);
    assert.equal(await one('select public.sky_family_avatar($1,$2)', [k, 'javascript:alert(1)']), false);
    assert.equal(await one('select public.sky_family_avatar($1,$2)', [k, 'data:image/jpeg;base64,' + 'A'.repeat(70000)]), false, 'too big');
    assert.equal((await one('select public.sky_family_extra($1)', [k])).avatar, PIC);
    await assert.rejects(q('select * from public.sky_avatars'), /permission denied/);
    await assert.rejects(q('select * from public.sky_notes'), /permission denied/);
    assert.equal(await one('select public.sky_family_avatar($1,$2)', [k, '']), true, 'removing it');
    assert.equal((await one('select public.sky_family_extra($1)', [k])).avatar, null);
  } finally { await db.close(); }
});
