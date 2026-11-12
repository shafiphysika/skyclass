// Skyclass data logic. Pure functions, no DOM, so tests can run it in Node.
(function (root) {
  'use strict';
  const MAX_NAME = 60, MAX_STUDENTS = 120, MAX_TEXT = 2000, MAX_LOG = 300;

  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const clip = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
  const int = (v, lo, hi, d) => { v = Math.round(Number(v)); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
  const today = (d = new Date()) => d.toISOString().slice(0, 10);

  const SKILLS = [
    { id: 'help', label: 'Helping others', icon: '🤝', points: 1 },
    { id: 'focus', label: 'Great focus', icon: '🎯', points: 1 },
    { id: 'idea', label: 'Bright idea', icon: '💡', points: 2 },
    { id: 'kind', label: 'Kindness', icon: '💛', points: 1 },
    { id: 'work', label: 'Hard work', icon: '💪', points: 2 },
    { id: 'team', label: 'Teamwork', icon: '🧩', points: 1 },
    { id: 'read', label: 'Reading star', icon: '📚', points: 1 },
    { id: 'home', label: 'Homework done', icon: '🏠', points: 1 },
  ];
  const BADGES = [
    { at: 10, icon: '🌱', label: 'Sprout' }, { at: 25, icon: '🎈', label: 'Lift-off' },
    { at: 50, icon: '🪁', label: 'Kite flyer' }, { at: 100, icon: '🌈', label: 'Rainbow rider' },
    { at: 200, icon: '🚀', label: 'Sky captain' },
  ];

  function parseNames(text) {
    const seen = new Set(), out = [];
    for (const raw of String(text || '').split(/[\n,;]+/)) {
      const n = clip(raw.replace(/^\d+[.)]\s*/, ''), MAX_NAME);
      if (n && !seen.has(n.toLowerCase()) && out.length < MAX_STUDENTS) { seen.add(n.toLowerCase()); out.push(n); }
    }
    return out;
  }

  const newStudent = (name, points = 0) => ({ id: uid(), name: clip(name, MAX_NAME), points: int(points, 0, 1e6, 0), log: [] });
  const newClass = (name, names = []) => ({
    id: uid(), name: clip(name, 40) || 'My class', students: names.map(n => newStudent(n)),
    attendance: {}, posts: [], goal: { target: 300, reward: 'Game time' },
  });
  const emptyState = () => ({ v: 1, classes: [], lessons: sampleLessons(), links: [], lib: { repo: '', branch: 'main', items: [], drive: '' }, activeClass: null });

  // Trust boundary: anything loaded from storage or an imported file goes through here.
  function normalize(raw) {
    const s = emptyState();
    if (!raw || typeof raw !== 'object') return s;
    s.classes = (Array.isArray(raw.classes) ? raw.classes : []).slice(0, 60).map(c => {
      const cls = newClass(c && c.name);
      if (c && typeof c.id === 'string') cls.id = clip(c.id, 40);
      cls.students = (Array.isArray(c && c.students) ? c.students : []).slice(0, MAX_STUDENTS)
        .filter(st => st && clip(st.name, MAX_NAME))
        .map(st => ({
          id: typeof st.id === 'string' ? clip(st.id, 40) : uid(), name: clip(st.name, MAX_NAME),
          points: int(st.points, 0, 1e6, 0),
          log: (Array.isArray(st.log) ? st.log : []).slice(-MAX_LOG).map(l => ({ t: int(l && l.t, 0, 9e15, 0), d: int(l && l.d, -100, 100, 0), r: clip(l && l.r, 60) })),
        }));
      const ids = new Set(cls.students.map(x => x.id));
      for (const [day, map] of Object.entries((c && c.attendance) || {})) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !map || typeof map !== 'object') continue;
        cls.attendance[day] = {};
        for (const [sid, v] of Object.entries(map)) if (ids.has(sid) && (v === 'p' || v === 'a' || v === 'l')) cls.attendance[day][sid] = v;
      }
      cls.posts = (Array.isArray(c && c.posts) ? c.posts : []).slice(-100).map(p => ({
        id: typeof (p && p.id) === 'string' ? clip(p.id, 40) : uid(), kind: p && p.kind === 'homework' ? 'homework' : 'news',
        text: String((p && p.text) || '').slice(0, MAX_TEXT), due: /^\d{4}-\d{2}-\d{2}$/.test(p && p.due) ? p.due : '', t: int(p && p.t, 0, 9e15, Date.now()),
      })).filter(p => p.text.trim());
      cls.goal = { target: int(c && c.goal && c.goal.target, 10, 100000, 300), reward: clip(c && c.goal && c.goal.reward, 60) || 'Game time' };
      return cls;
    });
    if (Array.isArray(raw.lessons)) s.lessons = raw.lessons.slice(0, 200).map(normalizeLesson).filter(Boolean);
    s.links = (Array.isArray(raw.links) ? raw.links : []).slice(0, 60).map(cleanLink).filter(Boolean);
    s.lib = cleanLib(raw.lib);
    s.activeClass = s.classes.some(c => c.id === raw.activeClass) ? raw.activeClass : (s.classes[0] ? s.classes[0].id : null);
    return s;
  }

  // Only https links are kept, so a saved link can never run script.
  function cleanLink(l) {
    let url = clip(l && l.url, 300); if (url && !/^[a-z]+:/i.test(url)) url = 'https://' + url;
    try { const u = new URL(url); if (u.protocol !== 'https:') return null; return { id: typeof l.id === 'string' ? clip(l.id, 40) : uid(), title: clip(l.title, 50) || u.hostname, url: u.href }; } catch { return null; }
  }

  /* Library: files listed from a public GitHub repository. */
  const EXT = { pptx: 'slides', ppt: 'slides', ppsx: 'slides', pps: 'slides', pdf: 'doc', docx: 'doc', doc: 'doc', xlsx: 'doc', html: 'game', htm: 'game', png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', mp4: 'video', webm: 'video' };
  const KINDS = ['slides', 'doc', 'game', 'image', 'video'];
  function cleanRepo(v) {
    const m = String(v || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/, '').replace(/\/+$/, '').match(/^([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})$/);
    return m ? m[1] + '/' + m[2] : '';
  }
  const nice = s => s.replace(/[-_]+/g, ' ').trim();
  // GitHub tree -> library items. A folder with index.html is one game; its other files are hidden as parts of it.
  function libraryFromTree(tree) {
    const blobs = (Array.isArray(tree) ? tree : []).filter(t => t && t.type === 'blob' && typeof t.path === 'string' && !/(^|\/)(\.|node_modules\/)/.test(t.path));
    const dirOf = p => p.split('/').slice(0, -1).join('/'), isIndex = p => /(^|\/)index\.html?$/i.test(p);
    const gameDirs = new Set(blobs.filter(t => isIndex(t.path) && dirOf(t.path)).map(t => dirOf(t.path)));
    const topGame = p => { const parts = dirOf(p).split('/'); for (let i = 1; i <= parts.length; i++) { const d = parts.slice(0, i).join('/'); if (gameDirs.has(d)) return d; } return null; };
    return blobs.map(t => {
      const parts = t.path.split('/'), file = parts[parts.length - 1], m = file.match(/^(.*)\.([a-z0-9]+)$/i), kind = m && EXT[m[2].toLowerCase()], game = topGame(t.path);
      if (!kind) return null;
      if (game !== null) return isIndex(t.path) && dirOf(t.path) === game ? { path: t.path, kind: 'game', title: nice(parts[parts.length - 2]), group: parts.length > 2 ? nice(parts[0]) : 'Games', size: 0 } : null;
      return { path: t.path, kind, title: nice(m[1]), group: parts.length > 1 ? nice(parts[0]) : 'General', size: int(t.size, 0, 1e10, 0) };
    }).filter(Boolean).slice(0, 400);
  }
  function cleanLib(l) {
    l = l && typeof l === 'object' ? l : {};
    const repo = cleanRepo(l && l.repo), branch = /^[\w.\/-]{1,100}$/.test(l && l.branch) ? l.branch : 'main';
    const items = !repo ? [] : (Array.isArray(l.items) ? l.items : []).slice(0, 400).map(it => {
      const path = String((it && it.path) || '');
      if (!path || path.length > 300 || /(^|\/)\.\.(\/|$)/.test(path) || !KINDS.includes(it.kind)) return null;
      return { path, kind: it.kind, title: clip(it.title, 80) || path, group: clip(it.group, 40) || 'General', size: int(it.size, 0, 1e10, 0) };
    }).filter(Boolean);
    return { repo, branch, items, drive: driveId(l.drive) };
  }
  // Accepts a Google Drive folder link or a bare folder id; returns the id or ''.
  function driveId(v) {
    const s = String(v || '').trim(), m = s.match(/\/folders\/([A-Za-z0-9_-]{10,80})/) || s.match(/^([A-Za-z0-9_-]{10,80})$/);
    return m ? m[1] : '';
  }
  function libUrl(repo, branch, item) {
    const p = item.path.split('/').map(encodeURIComponent).join('/'), [o, r] = repo.split('/'), raw = `https://raw.githubusercontent.com/${repo}/${branch}/${p}`;
    return { raw, page: `https://github.com/${repo}/blob/${branch}/${p}`, site: `https://${o.toLowerCase()}.github.io/${r}/${p}`, office: 'https://view.officeapps.live.com/op/embed.aspx?src=' + encodeURIComponent(raw) };
  }

  const SLIDE_TYPES = ['info', 'mcq', 'poll', 'tf'];
  function normalizeLesson(l) {
    if (!l || typeof l !== 'object') return null;
    const slides = (Array.isArray(l.slides) ? l.slides : []).slice(0, 60).map(sl => {
      const type = SLIDE_TYPES.includes(sl && sl.type) ? sl.type : 'info';
      let options = type === 'tf' ? ['True', 'False'] : (Array.isArray(sl.options) ? sl.options.map(o => clip(o, 120)).filter(Boolean).slice(0, 6) : []);
      if ((type === 'mcq' || type === 'poll') && options.length < 2) options = ['Option A', 'Option B'];
      return { type, title: clip(sl.title, 140), body: String(sl.body || '').slice(0, MAX_TEXT), emoji: clip(sl.emoji, 8), options, answer: type === 'mcq' || type === 'tf' ? int(sl.answer, 0, options.length - 1, 0) : null };
    });
    if (!slides.length) return null;
    return { id: typeof l.id === 'string' ? clip(l.id, 40) : uid(), title: clip(l.title, 100) || 'Untitled lesson', subject: clip(l.subject, 40), slides };
  }

  // Quick-write format: blank line between slides. "? Question" starts a quiz; "* " marks the right option;
  // "% Question" starts a poll; "T/F Statement" + "= true|false".
  function parseLessonText(title, subject, text) {
    const slides = String(text || '').split(/\n\s*\n/).map(block => {
      const lines = block.split('\n').map(x => x.trim()).filter(Boolean);
      if (!lines.length) return null;
      const head = lines[0];
      if (/^t\/f\s/i.test(head)) {
        const ans = lines.find(x => /^=\s*/.test(x));
        return { type: 'tf', title: head.replace(/^t\/f\s+/i, ''), answer: ans && /^=\s*f/i.test(ans) ? 1 : 0 };
      }
      if (head.startsWith('?') || head.startsWith('%')) {
        const opts = lines.slice(1).filter(x => /^[-*]/.test(x));
        return { type: head.startsWith('?') ? 'mcq' : 'poll', title: head.slice(1).trim(), options: opts.map(x => x.replace(/^[-*]\s*/, '')), answer: Math.max(0, opts.findIndex(x => x.startsWith('*'))) };
      }
      const m = head.match(/^(\p{Extended_Pictographic}️?(?:‍\p{Extended_Pictographic}️?)*)\s*(.*)$/u); // keeps ☀️ and joined emoji whole
      return { type: 'info', title: m ? m[2] : head, emoji: m ? m[1] : '', body: lines.slice(1).join('\n') };
    }).filter(Boolean);
    return normalizeLesson({ title, subject, slides });
  }

  function award(cls, studentId, delta, reason, now = Date.now()) {
    const st = cls.students.find(s => s.id === studentId);
    if (!st) return null;
    const before = st.points;
    st.points = Math.max(0, before + int(delta, -100, 100, 0));
    const d = st.points - before;
    if (d) { st.log.push({ t: now, d, r: clip(reason, 60) }); if (st.log.length > MAX_LOG) st.log.splice(0, st.log.length - MAX_LOG); }
    return d;
  }
  // A family view carries only one child, so the server sends the class total alongside.
  const classTotal = cls => Number.isFinite(cls.total) ? cls.total : cls.students.reduce((a, s) => a + s.points, 0);
  const badgesFor = pts => BADGES.filter(b => pts >= b.at);
  const nextBadge = pts => BADGES.find(b => pts < b.at) || null;

  // Fair wheel: nobody is picked twice until everyone eligible has had a turn.
  function pickFair(pool, used, rand = Math.random) {
    const left = pool.filter(x => !used.includes(x));
    const fresh = left.length ? left : pool.slice();
    if (!fresh.length) return { pick: null, used: [] };
    const pick = fresh[Math.floor(rand() * fresh.length)];
    return { pick, used: (left.length ? used : []).concat(pick) };
  }

  function shuffle(a, rand = Math.random) {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function makeGroups(items, n, rand = Math.random) {
    n = int(n, 1, Math.max(1, items.length), 1);
    const out = Array.from({ length: n }, () => []);
    shuffle(items, rand).forEach((x, i) => out[i % n].push(x));
    return out;
  }

  function attendanceRate(cls, studentId) {
    let seen = 0, here = 0;
    for (const day of Object.values(cls.attendance)) if (day[studentId]) { seen++; if (day[studentId] !== 'a') here++; }
    return seen ? Math.round(here / seen * 100) : null; // null = no records yet, not 0%
  }

  // Read-only import of ClassGrove / point-party data: {roster:{id:{names}}, classes:{id:{pts:{seat:n}}}}.
  function fromClassGrove(store, schoolLabel) {
    const roster = (store && store.roster) || {}, data = (store && store.classes) || {};
    return Object.entries(roster).filter(([, r]) => r && Array.isArray(r.names)).map(([id, r]) => {
      const cls = newClass((schoolLabel ? schoolLabel + ' · ' : '') + (r.label || r.name || id));
      const pts = (data[id] && data[id].pts) || {};
      cls.students = r.names.map((n, i) => n ? newStudent(n, pts[i + 1]) : null).filter(Boolean).slice(0, MAX_STUDENTS);
      const g = data[id] && data[id].goal; if (g) cls.goal.target = int(g, 10, 100000, 300);
      if (data[id] && data[id].reward) cls.goal.reward = clip(data[id].reward, 60);
      return cls;
    }).filter(c => c.students.length);
  }

  function scoreQuiz(slides, answers) {
    let right = 0, total = 0;
    slides.forEach((s, i) => { if (s.type === 'mcq' || s.type === 'tf') { total++; if (answers[i] === s.answer) right++; } });
    return { right, total, percent: total ? Math.round(right / total * 100) : null };
  }

  function sampleLessons() {
    return [
      parseLessonText('The water cycle', 'Science',
        '☀️ The sun warms the water\nWater in seas, rivers and puddles heats up and rises as invisible vapour.\n\n☁️ Clouds form\nHigh in the cold sky, vapour cools and turns into tiny droplets. That is condensation.\n\n🌧️ Rain falls\nWhen droplets join and get heavy, they fall as rain, snow or hail.\n\n? What do we call water vapour turning into droplets?\n- Evaporation\n* Condensation\n- Melting\n\nT/F Rain is part of the water cycle.\n= true\n\n% Which part of the water cycle is your favourite?\n- Evaporation\n- Clouds\n- Rain'),
      parseLessonText('Fractions with pizza', 'Maths',
        '🍕 One whole pizza\nA fraction shows part of a whole. The bottom number says how many equal slices.\n\n🔢 Top and bottom\nIn 3/4, we have 3 slices out of 4 equal slices.\n\n? Which is bigger?\n* 1/2\n- 1/4\n- 1/8\n\nT/F 2/4 is the same as 1/2.\n= true'),
    ].filter(Boolean);
  }

  const api = { uid, clip, today, SKILLS, BADGES, parseNames, newClass, newStudent, emptyState, normalize, normalizeLesson, cleanLink, cleanRepo, libraryFromTree, cleanLib, driveId, libUrl, parseLessonText, award, classTotal, badgesFor, nextBadge, pickFair, shuffle, makeGroups, attendanceRate, fromClassGrove, scoreQuiz };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.SkyCore = api;
})(this);
