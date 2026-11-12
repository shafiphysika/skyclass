const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

test('parseNames trims, numbers, dedupes case-insensitively', () => {
  assert.deepEqual(C.parseNames('1. Ali\n2) Sara, ali ;  \nZoya'), ['Ali', 'Sara', 'Zoya']);
});

test('award never drops below zero and logs the real change', () => {
  const c = C.newClass('6A', ['Ali']); const id = c.students[0].id;
  assert.equal(C.award(c, id, 2, 'Bright idea'), 2);
  assert.equal(C.award(c, id, -5, 'oops'), -2);
  assert.equal(c.students[0].points, 0);
  assert.equal(C.award(c, id, -1, 'again'), 0);
  assert.equal(c.students[0].log.length, 2);
});

test('fair wheel picks everyone once before repeating', () => {
  const pool = ['a', 'b', 'c']; let used = [], seen = [];
  for (let i = 0; i < 3; i++) { const r = C.pickFair(pool, used); used = r.used; seen.push(r.pick); }
  assert.deepEqual(seen.sort(), pool);
  const r = C.pickFair(pool, used); assert.equal(r.used.length, 1);
  assert.equal(C.pickFair([], []).pick, null);
});

test('groups are balanced and keep every member', () => {
  const g = C.makeGroups(['a', 'b', 'c', 'd', 'e'], 2);
  assert.deepEqual(g.map(x => x.length).sort(), [2, 3]);
  assert.equal(g.flat().length, 5);
});

test('attendance: late counts as present, no records is null not 0', () => {
  const c = C.newClass('x', ['A']); const id = c.students[0].id;
  assert.equal(C.attendanceRate(c, id), null);
  c.attendance['2026-11-10'] = { [id]: 'p' }; c.attendance['2026-11-11'] = { [id]: 'a' }; c.attendance['2026-11-12'] = { [id]: 'l' };
  assert.equal(C.attendanceRate(c, id), 67);
});

test('ClassGrove import maps seat numbers to roster positions', () => {
  const store = { roster: { '601': { names: ['Ali', '', 'Sara'] } }, classes: { '601': { pts: { 1: 12, 3: 7 }, goal: 500, reward: 'Picnic' } } };
  const [c] = C.fromClassGrove(store, 'My first school');
  assert.equal(c.name, 'My first school · 601');
  assert.deepEqual(c.students.map(s => [s.name, s.points]), [['Ali', 12], ['Sara', 7]]);
  assert.deepEqual(c.goal, { target: 500, reward: 'Picnic' });
});

test('normalize rejects junk and clamps hostile input', () => {
  const s = C.normalize({ classes: [{ name: 'x'.repeat(500), students: [{ name: '<b>Al</b>', points: -9 }, { name: '' }], attendance: { bad: {}, '2026-01-01': { nope: 'p' } } }], activeClass: 'ghost' });
  assert.equal(s.classes[0].name.length, 40);
  assert.equal(s.classes[0].students.length, 1);
  assert.equal(s.classes[0].students[0].points, 0);
  assert.deepEqual(s.classes[0].attendance, { '2026-01-01': {} });
  assert.equal(s.activeClass, s.classes[0].id);
  assert.equal(C.normalize(null).classes.length, 0);
});

test('lesson quick-write parses slide types and answers', () => {
  const l = C.parseLessonText('T', 'S', '🌍 Earth\nOur home\n\n? Pick\n- a\n* b\n\nT/F Sky is green\n= false\n\n% Vote\n- x\n- y');
  assert.deepEqual(l.slides.map(s => s.type), ['info', 'mcq', 'tf', 'poll']);
  assert.equal(l.slides[0].emoji, '🌍');
  assert.equal(C.parseLessonText('t', '', '☀️ Sun\nhot').slides[0].title, 'Sun');
  assert.equal(l.slides[1].answer, 1);
  assert.equal(l.slides[2].answer, 1);
  assert.deepEqual(C.scoreQuiz(l.slides, { 1: 1, 2: 0 }), { right: 1, total: 2, percent: 50 });
  assert.equal(C.parseLessonText('x', '', '   '), null);
});

test('sample lessons ship and badges step up', () => {
  assert.equal(C.emptyState().lessons.length, 2);
  assert.equal(C.badgesFor(30).length, 2);
  assert.equal(C.nextBadge(30).at, 50);
});

test('links keep https only', () => {
  assert.equal(C.cleanLink({ url: 'javascript:alert(1)' }), null);
  assert.equal(C.cleanLink({ url: 'http://x.com' }), null);
  assert.equal(C.cleanLink({ url: 'kahoot.com', title: 'K' }).url, 'https://kahoot.com/');
});

test('library: repo names, game folders and urls', () => {
  assert.equal(C.cleanRepo('https://github.com/Shafi/sky-lib.git'), 'Shafi/sky-lib');
  assert.equal(C.cleanRepo('not a repo'), '');
  const items = C.libraryFromTree([
    { type: 'blob', path: 'Science/Water_cycle.pptx', size: 5 }, { type: 'blob', path: 'notes.pdf', size: 1 },
    { type: 'blob', path: 'games/space-race/index.html' }, { type: 'blob', path: 'games/space-race/img/ship.png' }, { type: 'blob', path: 'games/space-race/help.html' },
    { type: 'blob', path: '.github/x.html' }, { type: 'blob', path: 'README.md' }, { type: 'tree', path: 'Science' }, { type: 'blob', path: 'quiz.html' },
  ]);
  assert.deepEqual(items.map(i => [i.kind, i.title, i.group]), [['slides', 'Water cycle', 'Science'], ['doc', 'notes', 'General'], ['game', 'space race', 'games'], ['game', 'quiz', 'General']]);
  const u = C.libUrl('Shafi/sky-lib', 'main', items[0]);
  assert.equal(u.raw, 'https://raw.githubusercontent.com/Shafi/sky-lib/main/Science/Water_cycle.pptx');
  assert.ok(u.office.startsWith('https://view.officeapps.live.com/op/embed.aspx?src=https%3A%2F%2Fraw.'));
  assert.equal(C.libUrl('Shafi/sky-lib', 'main', items[2]).site, 'https://shafi.github.io/sky-lib/games/space-race/index.html');
  const lib = C.normalize({ lib: { repo: 'a/b', branch: 'main', items: [{ path: '../x.pptx', kind: 'slides' }, { path: 'ok.pptx', kind: 'slides' }, { path: 'e.exe', kind: 'virus' }] } }).lib;
  assert.deepEqual(lib.items.map(i => i.path), ['ok.pptx']);
  assert.equal(C.driveId('https://drive.google.com/drive/u/0/folders/1AbC_dEf-GhIjKlMnOp?usp=sharing'), '1AbC_dEf-GhIjKlMnOp');
  assert.equal(C.driveId('https://evil.example/x'), '');
  assert.equal(C.normalize({ lib: { drive: '1AbC_dEf-GhIjKlMnOp' } }).lib.drive, '1AbC_dEf-GhIjKlMnOp');
});

test('games: sums are fair and scrambles differ', () => {
  const G = require('../games.js');
  for (let level = 1; level <= 3; level++) for (let i = 0; i < 200; i++) {
    const q = G.mathQ(level);
    assert.equal(new Set(q.options).size, 4); assert.ok(q.options.includes(q.answer)); assert.ok(q.options.every(o => o >= 0));
    const [a, op, b] = q.text.split(' '); assert.equal({ '+': +a + +b, '−': a - b, '×': a * b, '÷': a / b }[op], q.answer);
  }
  assert.equal(G.mathQ(1, () => 0).options.length, 4); // a stuck random source must not hang
  assert.notEqual(G.scramble('planet'), 'planet'); assert.notEqual(G.scramble('aab', () => 0.99), 'aab');
});
