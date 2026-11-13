// Skyclass data logic. Pure functions, no DOM, so tests can run it in Node.
(function (root) {
  'use strict';
  const MAX_NAME = 60, MAX_STUDENTS = 120, MAX_TEXT = 2000, MAX_LOG = 300;

  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const clip = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
  const int = (v, lo, hi, d) => { v = Math.round(Number(v)); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
  const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; // local date, not UTC

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
    { at: 10, icon: '🧑‍🚀', label: 'Cadet' }, { at: 25, icon: '🚀', label: 'Lift-off' },
    { at: 50, icon: '🛰️', label: 'Orbiter' }, { at: 100, icon: '🌠', label: 'Star pilot' },
    { at: 200, icon: '🪐', label: 'Sky captain' },
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
    attendance: {}, posts: [], goal: { target: 300, reward: 'Game time' }, assign: [], results: {}, checkin: {}, race: null, credit: {},
  });
  const emptyState = () => ({ v: 1, classes: [], lessons: sampleLessons(), links: [], lib: { repo: '', branch: 'main', items: [], drive: '' }, sets: sampleSets(), packs: [], activeClass: null });

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
      // An assignment is either a set played as one game, or one skill station of a story mission.
      cls.assign = (Array.isArray(c && c.assign) ? c.assign : []).slice(-80).map(a => a && (a.pack ? {
        id: typeof a.id === 'string' ? clip(a.id, 40) : uid(), pack: clip(a.pack, 30), skill: SKILL_IDS.includes(a.skill) ? a.skill : 'L', t: int(a.t, 0, 9e15, Date.now()),
      } : {
        id: typeof a.id === 'string' ? clip(a.id, 40) : uid(), setId: clip(a.setId, 40), game: SET_GAME_IDS.includes(a.game) ? a.game : 'flash',
        due: /^\d{4}-\d{2}-\d{2}$/.test(a.due) ? a.due : '', t: int(a.t, 0, 9e15, Date.now()),
      })).filter(Boolean);
      cls.credit = {};
      for (const [sid, m] of Object.entries((c && c.credit) || {})) if (ids.has(sid) && m && typeof m === 'object')
        for (const [k, v] of Object.entries(m).slice(0, 400)) (cls.credit[sid] = cls.credit[sid] || {})[clip(k, 40)] = int(v, 0, 3, 0);
      cls.results = {};
      for (const a of cls.assign) {
        const m = c && c.results && c.results[a.id]; if (!m || typeof m !== 'object') continue;
        for (const [sid, r] of Object.entries(m)) if (ids.has(sid) && r) (cls.results[a.id] = cls.results[a.id] || {})[sid] = cleanResult(r);
      }
      cls.checkin = {};
      for (const day of Object.keys((c && c.checkin) || {}).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().slice(-45)) {
        const m = c.checkin[day]; if (!m || typeof m !== 'object') continue;
        for (const [sid, v] of Object.entries(m)) if (ids.has(sid) && MOODS[v]) (cls.checkin[day] = cls.checkin[day] || {})[sid] = +v;
      }
      const r = c && c.race;
      cls.race = r && Array.isArray(r.teams) && r.teams.length >= 2 ? { teams: r.teams.slice(0, 6).map((t, i) => ({ name: clip(t && t.name, 20) || 'Team ' + (i + 1), score: int(t && t.score, 0, 9999, 0) })), target: int(r.target, 5, 999, 20) } : null;
      return cls;
    });
    if (Array.isArray(raw.lessons)) s.lessons = raw.lessons.slice(0, 200).map(normalizeLesson).filter(Boolean);
    s.links = (Array.isArray(raw.links) ? raw.links : []).slice(0, 60).map(cleanLink).filter(Boolean);
    s.lib = cleanLib(raw.lib);
    if (Array.isArray(raw.sets)) s.sets = raw.sets.slice(0, 100).map(normalizeSet).filter(Boolean);
    if (Array.isArray(raw.packs)) s.packs = raw.packs.slice(0, 60).map(normalizePack).filter(Boolean);
    const setIds = new Set(s.sets.map(x => x.id)), packIds = new Set(s.packs.map(x => x.id));
    for (const k of s.classes) { k.assign = k.assign.filter(a => a.pack ? packIds.has(a.pack) : setIds.has(a.setId)); for (const id of Object.keys(k.results)) if (!k.assign.some(a => a.id === id)) delete k.results[id]; }
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

  /* Question sets: one list (spelling words, vocabulary, questions) that every set game can use. */
  const SET_GAME_IDS = ['flash', 'spell', 'quiz'];
  const MOODS = { 1: ['😢', 'Sad'], 2: ['😟', 'Worried'], 3: ['😐', 'Okay'], 4: ['🙂', 'Good'], 5: ['😄', 'Great'] };
  function normalizeSet(x) {
    if (!x || typeof x !== 'object') return null;
    const items = (Array.isArray(x.items) ? x.items : []).slice(0, 200).map(it => ({ q: clip(it && it.q, 120), a: clip(it && it.a, 120) })).filter(it => it.q);
    return items.length ? { id: typeof x.id === 'string' ? clip(x.id, 40) : uid(), title: clip(x.title, 60) || 'Question set', items } : null;
  }
  // One item per line. "question | answer" or a single word. Leading "1." or "-" is ignored.
  function parseSetText(title, text, id) {
    const items = String(text || '').split('\n').map(l => l.replace(/^\s*(\d+[.)]|[-*•])\s*/, '')).filter(l => l.trim()).map(l => {
      const i = l.indexOf('|'); return i < 0 ? { q: l, a: '' } : { q: l.slice(0, i), a: l.slice(i + 1) };
    });
    return normalizeSet({ id, title, items });
  }
  const setText = set => set.items.map(it => it.a ? `${it.q} | ${it.a}` : it.q).join('\n');
  // Spelling uses the answer when there is one (the question is the clue), otherwise the word itself.
  const spellTarget = it => { const w = (it.a || it.q).trim(); return /^[A-Za-z]{2,14}$/.test(w) ? w.toLowerCase() : null; };
  function quizQuestions(set, n = 10, rand = Math.random) {
    const withA = set.items.filter(it => it.a), answers = [...new Set(withA.map(it => it.a))];
    if (withA.length < 1 || answers.length < 2) return [];
    return shuffle(withA, rand).slice(0, n).map(it => ({ q: it.q, answer: it.a, options: shuffle([it.a, ...shuffle(answers.filter(x => x !== it.a), rand).slice(0, 3)], rand) }));
  }
  const setGames = set => SET_GAME_IDS.filter(g => g === 'flash' || (g === 'spell' ? set.items.some(spellTarget) : quizQuestions(set, 1).length));
  const cleanResult = r => { const total = int(r.total, 1, 500, 1); return { best: int(r.best, 0, total, 0), total, tries: int(r.tries, 0, 100000, 0), t: int(r.t, 0, 9e15, 0) }; };
  function recordResult(cls, assignId, sid, score, total, now = Date.now()) {
    const m = cls.results[assignId] = cls.results[assignId] || {}, prev = m[sid];
    const next = cleanResult({ best: score, total, tries: 1, t: now });
    m[sid] = prev ? mergeResult(prev, next) : next;
    return m[sid];
  }
  // Results from the class device and from families' own devices are separate tries, so tries add up.
  function mergeResult(a, b) {
    if (!a) return b || null; if (!b) return a;
    const top = b.best / b.total > a.best / a.total ? b : a;
    return { best: top.best, total: top.total, tries: a.tries + b.tries, t: Math.max(a.t, b.t) };
  }
  function moodsFor(cls, day) { const m = cls.checkin[day] || {}, out = {}; for (const [sid, v] of Object.entries(m)) out[sid] = v; return out; }
  /* Story missions: one story becomes four skill stations that score themselves. */
  const SKILL_IDS = ['L', 'R', 'W', 'S'];
  const SKILLS4 = { L: ['🎧', 'Listening'], R: ['📖', 'Reading'], W: ['✍️', 'Writing'], S: ['🎤', 'Speaking'] };
  const CREW = [['🐙', 'Octo the Explorer'], ['👾', 'Pixel'], ['🦄', 'Comet Unicorn'], ['🐲', 'Nova Dragon'], ['🤖', 'Bolt'], ['🦊', 'Captain Fox'], ['🐳', 'Star Whale'], ['🦉', 'Professor Hoot'],
    ['🐼', 'Panda Pilot'], ['🦖', 'Rex Rocket'], ['🐧', 'Penguin Astronaut'], ['🐝', 'Buzz Orbiter'], ['🦋', 'Nebula Wings'], ['🐢', 'Turbo Turtle'], ['🦁', 'Leo the Brave'], ['🐬', 'Galaxy Dolphin'],
    ['🦜', 'Parrot Navigator'], ['🐸', 'Moon Hopper'], ['🦔', 'Spike the Scout'], ['🐨', 'Cosmo Koala']];
  const httpsUrl = v => { try { const u = new URL(clip(v, 300)); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; } };
  function normalizePack(p) {
    if (!p || typeof p !== 'object') return null;
    const lines = (a, n, m) => (Array.isArray(a) ? a : []).map(x => clip(x, m)).filter(Boolean).slice(0, n);
    const pack = {
      id: typeof p.id === 'string' && /^[\w-]{1,30}$/.test(p.id) ? p.id : 'pk' + uid().slice(0, 10), title: clip(p.title, 80) || 'Story mission', slides: httpsUrl(p.slides),
      words: (Array.isArray(p.words) ? p.words : []).map(w => w && { w: clip(w.w, 30), pic: clip(w.pic, 12), mean: clip(w.mean, 120) }).filter(w => w && w.w).slice(0, 40),
      story: lines(p.story, 60, 200), speak: lines(p.speak, 20, 160),
      questions: (Array.isArray(p.questions) ? p.questions : []).map(q => q && { q: clip(q.q, 160), a: clip(q.a, 80), wrong: lines(q.wrong, 3, 80) }).filter(q => q && q.q && q.a && q.wrong.length).slice(0, 30),
      tf: (Array.isArray(p.tf) ? p.tf : []).map(x => x && { s: clip(x.s, 160), t: !!x.t }).filter(x => x && x.s).slice(0, 30),
    };
    return pack.story.length || pack.words.length ? pack : null;
  }
  // Writing format: "Title:", "Slides:", then sections "Words:", "Story:", "Questions:", "True or false:", "Speak:".
  function parsePack(text, id) {
    const p = { id, words: [], story: [], questions: [], tf: [], speak: [] }; let sec = '';
    for (const raw of String(text || '').split('\n')) {
      const line = raw.trim(); if (!line) continue;
      const head = line.match(/^(title|slides|words|story|questions|true or false|speak)\s*:\s*(.*)$/i);
      if (head) { sec = head[1].toLowerCase(); if (sec === 'title') p.title = head[2]; if (sec === 'slides') p.slides = head[2]; continue; }
      const f = line.split('|').map(x => x.trim());
      if (sec === 'words') p.words.push({ w: f[0], pic: f.length > 2 ? f[1] : '', mean: f.length > 2 ? f[2] : f[1] || '' });
      else if (sec === 'story') p.story.push(line);
      else if (sec === 'speak') p.speak.push(line);
      else if (sec === 'questions') p.questions.push({ q: f[0], a: f[1], wrong: f.slice(2) });
      else if (sec === 'true or false') p.tf.push({ s: f[0], t: /^t/i.test(f[1] || '') });
    }
    return normalizePack(p);
  }
  function packText(p) {
    return [`Title: ${p.title}`, p.slides ? `Slides: ${p.slides}` : '', 'Words:', ...p.words.map(w => [w.w, w.pic, w.mean].filter((x, i) => x || i === 0).join(' | ')),
      'Story:', ...p.story, 'Questions:', ...p.questions.map(q => [q.q, q.a, ...q.wrong].join(' | ')), 'True or false:', ...p.tf.map(x => `${x.s} | ${x.t ? 'true' : 'false'}`), 'Speak:', ...p.speak].filter(Boolean).join('\n');
  }
  const wordsOf = s => (String(s).toLowerCase().match(/[a-z0-9']+/g) || []).map(w => w.replace(/'/g, ''));
  // Each item is worth 2 points: right first time 2, close or second try 1.
  function packStation(p, skill, rand = Math.random) {
    const sh = a => shuffle(a, rand), short = p.story.filter(l => { const n = wordsOf(l).length; return n >= 3 && n <= 10; });
    const pics = p.words.filter(w => w.pic), others = (list, x, n) => sh(list.filter(y => y !== x)).slice(0, n);
    if (skill === 'L') return sh([
      ...sh(pics).slice(0, 5).map(w => ({ type: 'pick', say: w.w, prompt: 'Listen. Which picture is it?', options: sh([w.pic, ...others(pics.map(x => x.pic), w.pic, 3)]), answer: w.pic, big: true })),
      ...sh(short).slice(0, pics.length >= 5 ? 3 : 8 - Math.min(5, pics.length)).map(l => ({ type: 'pick', say: l, prompt: 'Listen. Which sentence did you hear?', options: sh([l, ...others(short, l, 2)]), answer: l })),
    ]).filter(q => q.options.length >= 2);
    if (skill === 'R') {
      const qs = sh([...p.questions.map(q => ({ type: 'pick', prompt: q.q, options: sh([q.a, ...q.wrong]), answer: q.a })), ...p.tf.map(x => ({ type: 'pick', prompt: x.s, hint: 'True or false?', options: ['True', 'False'], answer: x.t ? 'True' : 'False' }))]).slice(0, 8);
      const start = Math.floor(rand() * Math.max(1, p.story.length - 3));
      if (p.story.length >= 4) qs.push({ type: 'order', prompt: 'Put the story in order.', parts: p.story.slice(start, start + 4) });
      return qs;
    }
    if (skill === 'W') {
      const spell = sh(p.words.filter(w => /^[A-Za-z]{2,14}$/.test(w.w))).slice(0, 4).map(w => ({ type: 'spell', say: w.w, clue: [w.pic, w.mean].filter(Boolean).join('  '), word: w.w.toLowerCase() }));
      const build = sh(short.filter(l => wordsOf(l).length <= 8)).slice(0, 2).map(l => ({ type: 'build', prompt: 'Build the sentence.', say: l, parts: l.replace(/[.!?,]+/g, '').split(/\s+/).filter(Boolean) }));
      const vocab = p.words.map(w => w.w.toLowerCase());
      const fill = sh(p.story.map(l => [l, vocab.find(v => wordsOf(l).includes(v))]).filter(x => x[1])).slice(0, 2).map(([l, v]) => ({ type: 'pick', prompt: l.replace(new RegExp(`\\b${v}\\b`, 'i'), '_____'), hint: 'Which word is missing?', options: sh([v, ...others(vocab, v, 2)]), answer: v }));
      return [...spell, ...build, ...fill];
    }
    return [...sh(p.words).slice(0, 3).map(w => ({ type: 'say', text: w.w, pic: w.pic })), ...sh(p.speak.length ? p.speak : short).slice(0, 3).map(l => ({ type: 'say', text: l }))];
  }
  // Share of the target's words heard in order (0 to 1). Forgiving on case, punctuation and extra words.
  function speechScore(target, heard) {
    const t = wordsOf(target), h = wordsOf(heard); let j = 0, hit = 0;
    for (const w of t) { const k = h.indexOf(w, j); if (k >= 0) { hit++; j = k + 1; } }
    return t.length ? hit / t.length : 0;
  }
  const starsFor = r => { if (!r) return 0; const x = r.best / r.total; return x >= .9 ? 3 : x >= .7 ? 2 : x >= .5 ? 1 : 0; };
  // Turns new mission stars into class points once, so playing again only adds stars you improved.
  function creditStars(cls, packs, getResult, now = Date.now()) {
    let added = 0;
    for (const p of packs) {
      const stations = cls.assign.filter(a => a.pack === p.id); if (!stations.length) continue;
      for (const st of cls.students) {
        const cr = cls.credit[st.id] = cls.credit[st.id] || {}; let all = stations.length === 4;
        for (const a of stations) {
          const s = starsFor(getResult(a.id, st.id)); if (!s) all = false;
          if (s > (cr[a.id] || 0)) { added += award(cls, st.id, s - (cr[a.id] || 0), `${p.title.slice(0, 30)}: ${SKILLS4[a.skill][1]}`, now); cr[a.id] = s; }
        }
        const bk = p.id + ':bonus';
        if (all && !cr[bk]) { added += award(cls, st.id, 3, `${p.title.slice(0, 30)}: mission complete`, now); cr[bk] = 3; }
      }
    }
    return added;
  }
  // The crew member a mission unlocks: shiny when every station has three stars.
  function crewFor(cls, packs, sid, getResult) {
    return packs.map((p, i) => {
      const stations = cls.assign.filter(a => a.pack === p.id); if (stations.length !== 4) return null;
      const stars = stations.map(a => starsFor(getResult(a.id, sid)));
      return { pack: p, icon: CREW[i % CREW.length][0], name: CREW[i % CREW.length][1], got: stars.every(s => s > 0), shiny: stars.every(s => s === 3) };
    }).filter(Boolean);
  }

  /* Merging: when another device or a co-teacher saved first, keep both sets of changes.
     base = the copy both sides started from, local = this device, server = what was saved meanwhile. */
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const byId = list => new Map((list || []).map(x => [x.id, x]));
  // Lists of things with ids: local additions and edits win, local deletions apply, server additions stay.
  function mergeList(base, local, server, mergeItem) {
    const b = byId(base), l = byId(local), out = [];
    for (const s of server || []) {
      const li = l.get(s.id), bi = b.get(s.id);
      if (!li) { if (!bi) out.push(s); continue; } // deleted here (was in base) or new on the server
      out.push(mergeItem ? mergeItem(bi, li, s) : (same(li, bi) ? s : li));
    }
    for (const li of local || []) if (!b.has(li.id) && !(server || []).some(s => s.id === li.id)) out.push(li); // new here
    return out;
  }
  // Day -> student -> value maps (attendance, check-ins): changes made here are applied on top of the server's.
  function mergeDays(base, local, server) {
    const out = JSON.parse(JSON.stringify(server || {}));
    const days = new Set([...Object.keys(base || {}), ...Object.keys(local || {})]);
    for (const d of days) {
      const bd = (base || {})[d] || {}, ld = (local || {})[d] || {};
      for (const sid of new Set([...Object.keys(bd), ...Object.keys(ld)])) {
        if (bd[sid] === ld[sid]) continue;
        out[d] = out[d] || {};
        if (ld[sid] === undefined) delete out[d][sid]; else out[d][sid] = ld[sid];
      }
    }
    return out;
  }
  function mergeStudent(bs, ls, ss) {
    const out = { ...ss };
    out.points = Math.max(0, ss.points + ls.points - (bs ? bs.points : ss.points));
    if (bs && ls.name !== bs.name) out.name = ls.name;
    const seen = bs ? Math.max(0, ...bs.log.map(l => l.t)) : Infinity;
    out.log = [...ss.log, ...ls.log.filter(l => l.t > seen)].sort((a, b) => a.t - b.t).slice(-MAX_LOG);
    return out;
  }
  function mergeClass(bc, lc, sc) {
    if (!bc) return lc;
    const out = { ...sc };
    out.students = mergeList(bc.students, lc.students, sc.students, (bs, ls, ss) => mergeStudent(bs, ls, ss));
    out.attendance = mergeDays(bc.attendance, lc.attendance, sc.attendance);
    out.checkin = mergeDays(bc.checkin, lc.checkin, sc.checkin);
    out.posts = mergeList(bc.posts, lc.posts, sc.posts);
    out.assign = mergeList(bc.assign, lc.assign, sc.assign);
    out.results = JSON.parse(JSON.stringify(sc.results || {}));
    for (const [aid, m] of Object.entries(lc.results || {})) for (const [sid, r] of Object.entries(m)) {
      const br = ((bc.results || {})[aid] || {})[sid]; if (same(br, r)) continue;
      const sr = (out.results[aid] = out.results[aid] || {})[sid];
      out.results[aid][sid] = sr ? { ...mergeResult(sr, r), tries: Math.max(sr.tries, r.tries) } : r;
    }
    out.credit = JSON.parse(JSON.stringify(sc.credit || {}));
    for (const [sid, m] of Object.entries(lc.credit || {})) for (const [k, v] of Object.entries(m)) { const c = out.credit[sid] = out.credit[sid] || {}; c[k] = Math.max(c[k] || 0, v); }
    for (const k of ['name', 'goal', 'race']) if (!same(bc[k], lc[k])) out[k] = lc[k];
    return out;
  }
  function mergeStates(base, local, server) {
    const out = { ...server };
    out.classes = mergeList(base.classes, local.classes, server.classes, mergeClass);
    for (const k of ['lessons', 'sets', 'packs', 'links']) out[k] = mergeList(base[k], local[k], server[k]);
    if (!same(base.lib, local.lib)) out.lib = local.lib;
    out.activeClass = local.activeClass;
    return normalize(out);
  }

  function sampleSets() {
    return [parseSetText('Space words', 'The star our planet goes around | sun\nThe planet we live on | earth\nIt shines in the night sky | moon\nA big ball of rock or gas that goes around a star | planet\nIt carries astronauts into space | rocket\nA person who travels into space | astronaut\nA group of stars that makes a picture | constellation\nA ball of ice and dust with a long tail | comet', 'sample-space')].filter(Boolean);
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

  const api = { uid, clip, today, SKILLS, BADGES, parseNames, newClass, newStudent, emptyState, normalize, normalizeLesson, cleanLink, cleanRepo, libraryFromTree, cleanLib, driveId, libUrl, MOODS, SET_GAME_IDS, mergeStates, SKILL_IDS, SKILLS4, CREW, normalizePack, parsePack, packText, packStation, speechScore, starsFor, creditStars, crewFor, wordsOf, normalizeSet, parseSetText, setText, spellTarget, quizQuestions, setGames, recordResult, mergeResult, moodsFor, parseLessonText, award, classTotal, badgesFor, nextBadge, pickFair, shuffle, makeGroups, attendanceRate, fromClassGrove, scoreQuiz };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.SkyCore = api;
})(this);
