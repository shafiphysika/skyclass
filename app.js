(function () {
  'use strict';
  const C = SkyCore, KEY = 'skyclass-v1', UIKEY = 'skyclass-ui';
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const top = $('#top'), app = $('#app'), tabs = $('#tabs'), dlg = $('#dlg'), fx = $('#fx');

  let state, ui = { role: null, tab: 'board', who: null, skill: 'help' };
  try { state = C.normalize(JSON.parse(localStorage.getItem(KEY))); } catch { state = C.emptyState(); }
  try { Object.assign(ui, JSON.parse(localStorage.getItem(UIKEY)) || {}); } catch { /* first visit */ }
  let last = null, wheelUsed = {}, wheelRot = 0, wheelPick = null, player = null, stopGame = null;
  const wonAt = {}; // class id -> goal already reached, so the party plays once
  const timer = { left: 300, total: 300, end: 0, tick: null };

  // Online mode is optional: without config.js values (or if the library fails to load) everything stays on this device.
  const cfg = window.SKY_CONFIG || {};
  const sb = window.supabase && cfg.supabaseUrl && cfg.supabaseKey ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey) : null;
  const cloud = { user: null, rev: 0, status: '', codes: [], res: {}, moods: {}, logins: [], pins: [] };
  const PIN_PICS = ['🐶', '🐱', '🦊', '🐼', '🐸', '🐵', '🦁', '🐰'];
  let roster = null, pinFor = null, pinTyped = ''; // iPad login in progress
  let fam = null, famCode = null, syncT; // fam: the read-only school a family code unlocked; famCode stays in memory only

  function saveLocal() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); localStorage.setItem(UIKEY, JSON.stringify(ui)); }
    catch { toast('This device is out of storage. Download a backup from Classes now.'); }
  }
  function save() { if (cloud.user) ui.dirty = true; saveLocal(); if (cloud.user) { setStatus('Saving…'); clearTimeout(syncT); syncT = setTimeout(push, 1200); } }
  const S = () => fam && ui.role !== 'teacher' ? fam : state;
  const cls = () => S().classes.find(c => c.id === S().activeClass) || null;
  const student = () => { const c = cls(); return !c ? null : S() === fam ? c.students[0] || null : c.students.find(s => s.id === ui.who) || null; };
  const hash = s => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.codePointAt(0)) >>> 0; return h; };
  const ANIMALS = ['🦊', '🐼', '🐯', '🐸', '🦉', '🐙', '🦄', '🐨', '🐧', '🦁', '🐰', '🐢', '🦋', '🐬', '🐝', '🦕'];
  const avatar = st => `<span class="ava" style="--h:${hash(st.id) % 360}">${ANIMALS[hash(st.name) % ANIMALS.length]}</span>`;
  const niceDate = d => new Date(d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

  let toastT;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 3200); }
  function burst(el, text = '⭐') {
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const r = el.getBoundingClientRect();
    for (let i = 0; i < 6; i++) {
      const s = document.createElement('span');
      s.textContent = text; s.className = 'spark';
      s.style.left = r.left + r.width / 2 + 'px'; s.style.top = r.top + r.height / 2 + 'px';
      s.style.setProperty('--dx', (Math.random() * 160 - 80) + 'px'); s.style.setProperty('--dy', (-60 - Math.random() * 110) + 'px');
      s.addEventListener('animationend', () => s.remove()); fx.appendChild(s);
    }
  }
  function party() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (let i = 0; i < 44; i++) {
      const s = document.createElement('span');
      s.textContent = '🎉⭐🎈✨🌈'.match(/\p{Extended_Pictographic}/gu)[i % 5]; s.className = 'confetti';
      s.style.left = Math.random() * 100 + 'vw'; s.style.animationDelay = Math.random() * .9 + 's'; s.style.fontSize = 1.2 + Math.random() * 1.6 + 'rem';
      s.addEventListener('animationend', () => s.remove()); fx.appendChild(s);
    }
  }
  function enterAnim() { app.classList.remove('enter'); void app.offsetWidth; app.classList.add('enter'); }
  function endGame() { if (stopGame) { stopGame(); stopGame = null; } }
  function openDlg(html, kind = '') { dlg.className = kind; dlg.innerHTML = html; if (!dlg.open) dlg.showModal(); }
  function closeDlg() { endGame(); if (dlg.open) dlg.close(); player = null; }

  /* ---------- shared pieces ---------- */
  const CLOUDS = '<i class="cloud c1"></i><i class="cloud c2"></i><i class="cloud c3"></i>';
  const KITE = '<span class="rocket">🚀</span>';
  const stringPath = lift => { const x = 30 + lift * 45 + 3, y = 70 - lift * 58 + 14; return `M6,100 Q${x * .45},${y + 34} ${x},${y}`; };
  function skyText(c) {
    const total = C.classTotal(c), g = c.goal;
    return total >= g.target ? `<h2>Goal reached: ${esc(g.reward)}!</h2><p>${total} stars together. Set the next goal when you are ready.</p>`
      : `<h2>${g.target - total} stars to ${esc(g.reward)}</h2><p>${esc(c.name)} has ${total} of ${g.target} stars. Every star fuels the rocket.</p>`;
  }
  function skyHTML(c, canEdit) {
    const lift = Math.min(1, C.classTotal(c) / c.goal.target); wonAt[c.id] = lift >= 1;
    return `<section class="sky${lift >= 1 ? ' won' : ''}" id="sky" style="--lift:${lift}">${CLOUDS}<i class="rainbow"></i>
      <svg class="string" viewBox="0 0 100 100" preserveAspectRatio="none"><path id="kstring" d="${stringPath(lift)}"/></svg>
      <div class="kite">${KITE}</div><div class="skytext" id="skytext">${skyText(c)}</div>
      ${canEdit ? '<button class="pill" data-act="goal">Change goal</button>' : ''}</section>`;
  }
  function refreshSky(c) {
    const sky = $('#sky'); if (!sky) return;
    const lift = Math.min(1, C.classTotal(c) / c.goal.target);
    sky.style.setProperty('--lift', lift); sky.classList.toggle('won', lift >= 1); $('#kstring').setAttribute('d', stringPath(lift)); $('#skytext').innerHTML = skyText(c);
  }
  const postsHTML = (c, canDelete) => c.posts.length ? c.posts.slice().reverse().map(p => `<article class="post ${p.kind}">
      <span class="tag">${p.kind === 'homework' ? '📝 Homework' : '📣 News'}</span>
      <p>${esc(p.text).replace(/\n/g, '<br>')}</p>
      <small>${niceDate(p.t)}${p.due ? ', due ' + niceDate(p.due + 'T12:00') : ''}</small>
      ${canDelete ? `<button class="x" data-act="delpost" data-id="${esc(p.id)}" aria-label="Delete post">✕</button>` : ''}</article>`).join('')
    : '<p class="empty">Nothing posted yet.</p>';
  const badgesHTML = pts => C.BADGES.map(b => `<span class="badge ${pts >= b.at ? 'got' : ''}" title="${b.at} stars"><b>${b.icon}</b>${esc(b.label)}<small>${b.at}</small></span>`).join('');

  /* ---------- chrome ---------- */
  const TABS = {
    teacher: [['board', '⭐', 'Points'], ['attend', '✅', 'Attendance'], ['lessons', '📖', 'Lessons'], ['tools', '🎡', 'Tools'], ['games', '🎮', 'Games'], ['practice', '🎯', 'Practice'], ['library', '📚', 'Library'], ['sites', '🧭', 'Fun sites'], ['news', '📣', 'News'], ['setup', '⚙️', 'Classes']],
    student: [['me', '🌟', 'My stars'], ['practice', '🎯', 'Practice'], ['games', '🎮', 'Games'], ['lessons', '📖', 'Lessons'], ['library', '📚', 'Library'], ['news', '📝', 'Homework']],
    parent: [],
  };
  function render() {
    document.body.dataset.role = ui.role || 'home';
    if (!ui.role) { top.innerHTML = tabs.innerHTML = ''; app.innerHTML = homeHTML(); return; }
    const list = TABS[ui.role]; if (list.length && !list.some(t => t[0] === ui.tab)) ui.tab = list[0][0];
    const picker = ui.role === 'teacher' && state.classes.length ? `<label class="pick"><span class="sr">Class</span><select data-change="class">${state.classes.map(c => `<option value="${esc(c.id)}" ${c.id === state.activeClass ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>` : '';
    top.innerHTML = `<button class="brand" data-act="home">🚀 Skyclass</button>${picker}<button class="pill" data-act="home">Switch view</button>`;
    tabs.innerHTML = list.map(([id, ic, label]) => `<button data-act="tab" data-tab="${id}" ${ui.tab === id ? 'aria-current="page"' : ''}><span>${ic}</span>${label}</button>`).join('');
    app.innerHTML = ui.role === 'teacher' ? teacherHTML() : ui.role === 'student' ? studentHTML() : parentHTML();
    if (ui.role === 'teacher' && ui.tab === 'tools') paintTimer();
  }
  function homeHTML() {
    return `<section class="hero sky" style="--lift:.95">${CLOUDS}
      <svg class="string" viewBox="0 0 100 100" preserveAspectRatio="none"><path d="${stringPath(.95)}"/></svg><div class="kite">${KITE}</div>
      <i class="sun"></i><span class="balloon b1">🛸</span><span class="balloon b2">🛰️</span><span class="balloon b3">👾</span><i class="hill h1"></i><i class="hill h2"></i>
      <div class="herotext"><h1 aria-label="Skyclass">${[...'Skyclass'].map((ch, i) => `<span style="--i:${i}">${ch}</span>`).join('')}</h1><p>Mission control for your class: stars, lessons and games. Who is on board?</p></div>
      <div class="doors">
        <button data-act="enter" data-role="teacher"><span>🧑‍🏫</span><b>Teacher</b><small>Command the mission</small></button>
        <button data-act="enter" data-role="student"><span>🎒</span><b>Student</b><small>Check my stars, play and learn</small></button>
        <button data-act="enter" data-role="parent"><span>👪</span><b>Parent</b><small>Follow my child on the journey</small></button>
      </div><p class="devnote">Everything is saved on this device only.</p></section>`;
  }

  /* ---------- teacher ---------- */
  function teacherHTML() {
    const c = cls();
    if (ui.tab === 'setup' || (!c && !['sites', 'lessons', 'games', 'library', 'practice'].includes(ui.tab))) return setupHTML(c);
    if (ui.tab === 'practice') return practiceHTML(true);
    if (ui.tab === 'sites') return sitesHTML();
    if (ui.tab === 'games') return gamesHTML();
    if (ui.tab === 'library') return libraryHTML(true);
    if (ui.tab === 'lessons') return lessonsHTML(true);
    if (!c.students.length) return `<p class="empty">${esc(c.name)} has no students yet. <button class="pill" data-act="tab" data-tab="setup">Add students</button></p>`;
    if (ui.tab === 'board') return boardHTML(c);
    if (ui.tab === 'attend') return attendHTML(c);
    if (ui.tab === 'tools') return toolsHTML(c);
    return `<h2 class="h">News and homework for ${esc(c.name)}</h2>
      <form class="panel form" data-form="post"><label>Type<select name="kind"><option value="news">News</option><option value="homework">Homework</option></select></label>
      <label>Due date (homework)<input type="date" name="due"></label>
      <label class="wide">Message<textarea name="text" rows="3" maxlength="2000" required placeholder="Bring your library book on Thursday."></textarea></label>
      <button class="btn">Post to class</button></form><div class="posts">${postsHTML(c, true)}</div>`;
  }
  function boardHTML(c) {
    const skill = C.SKILLS.find(s => s.id === ui.skill) || C.SKILLS[0];
    return `${skyHTML(c, true)}
      <div class="skills" role="group" aria-label="Reason for the star">${C.SKILLS.map(s => `<button data-act="skill" data-id="${s.id}" aria-pressed="${s.id === skill.id}">${s.icon} ${s.label} <b>+${s.points}</b></button>`).join('')}</div>
      <div class="bar"><p>Tap a student to give <b>${skill.icon} ${skill.label}</b>.</p><button class="pill" data-act="giveall">Whole class +1</button><button class="pill" data-act="undo" ${last ? '' : 'disabled'}>Undo</button></div>
      <div class="cards">${c.students.map((s, i) => `<div class="card" style="--h:${hash(s.id) % 360};--i:${i}" data-sid="${esc(s.id)}">
        <button class="give" data-act="give" data-sid="${esc(s.id)}" aria-label="Give ${esc(s.name)} a star">${avatar(s)}<span class="nm">${esc(s.name)}</span><span class="pts">${s.points}</span></button>
        <button class="minus" data-act="take" data-sid="${esc(s.id)}" aria-label="Take 1 star from ${esc(s.name)}">−</button></div>`).join('')}</div>`;
  }
  function attendHTML(c) {
    const day = C.today(), rec = c.attendance[day] || {};
    const n = v => c.students.filter(s => rec[s.id] === v).length;
    const moods = c.students.map(s => [s, moodOf(c, s.id, day)]).filter(x => x[1]), care = moods.filter(x => x[1] <= 2).map(x => x[0].name);
    return `<h2 class="h">Attendance, ${niceDate(Date.now())}</h2>
      <div class="bar"><p><b>${n('p')}</b> present, <b>${n('l')}</b> late, <b>${n('a')}</b> away, <b>${c.students.length - n('p') - n('l') - n('a')}</b> not marked</p><button class="pill" data-act="allhere">Mark everyone present</button></div>
      <section class="panel moodbar"><div><h3>Morning check-in</h3><p>${moods.length} of ${c.students.length} checked in today${moods.length ? ': ' + [5, 4, 3, 2, 1].map(v => `${C.MOODS[v][0]} ${moods.filter(x => x[1] === v).length}`).join('  ') : '.'}</p>
        ${care.length ? `<p class="care">💛 Check on: ${care.map(esc).join(', ')}</p>` : ''}</div><button class="btn" data-act="kiosk">Open check-in for the class</button></section>
      <div class="rows">${c.students.map(s => `<div class="row">${avatar(s)}<span class="nm">${esc(s.name)}</span>${moodOf(c, s.id, day) ? `<span class="mood" title="${C.MOODS[moodOf(c, s.id, day)][1]}">${C.MOODS[moodOf(c, s.id, day)][0]}</span>` : ''}<span class="seg">
        ${[['p', 'Present'], ['l', 'Late'], ['a', 'Away']].map(([v, l]) => `<button data-act="mark" data-sid="${esc(s.id)}" data-v="${v}" class="m-${v}" aria-pressed="${rec[s.id] === v}">${l}</button>`).join('')}</span></div>`).join('')}</div>`;
  }
  function lessonsHTML(teacher) {
    return `<div class="bar"><h2 class="h">${teacher ? 'Interactive lessons' : 'Play a lesson'}</h2>${teacher ? '<button class="btn" data-act="newlesson">Write a lesson</button>' : ''}</div>
      <div class="lessons">${S().lessons.map(l => { const q = l.slides.filter(s => s.type !== 'info').length; return `<article class="lesson" style="--h:${hash(l.title) % 360}">
        <span class="big">${esc(l.slides.find(s => s.emoji)?.emoji || '📖')}</span><h3>${esc(l.title)}</h3>
        <p>${esc(l.subject || 'Lesson')}: ${l.slides.length} slides, ${q} question${q === 1 ? '' : 's'}</p>
        <button class="btn" data-act="play" data-id="${esc(l.id)}">${teacher ? 'Present' : 'Play'}</button>
        ${teacher ? `<button class="x" data-act="dellesson" data-id="${esc(l.id)}" aria-label="Delete ${esc(l.title)}">✕</button>` : ''}</article>`; }).join('') || '<p class="empty">No lessons yet.</p>'}</div>`;
  }
  function toolsHTML(c) {
    return `<div class="tools">
      <section class="panel"><h2 class="h">Name wheel</h2><p>Everyone here today gets a turn before anyone repeats.</p>${wheelHTML(c)}
        <button class="btn" data-act="spin">Spin</button><div id="wheelout" class="out" aria-live="polite"></div></section>
      <section class="panel"><h2 class="h">Timer</h2><div class="ring" id="ring"><span id="clock">5:00</span></div>
        <div class="chips">${[1, 2, 5, 10, 15].map(m => `<button data-act="tset" data-m="${m}">${m} min</button>`).join('')}</div>
        <div class="chips"><button class="btn" data-act="tgo" id="tgo">Start</button><button class="pill" data-act="treset">Reset</button></div></section>
      <section class="panel"><h2 class="h">Group maker</h2><form data-form="groups" class="inline"><label>Groups <input type="number" name="n" min="2" max="12" value="4"></label><button class="btn">Make groups</button></form><div id="groupsout" class="groups"></div></section>
      <section class="panel"><h2 class="h">Dice</h2><div id="dice" class="dice"><span>⚄</span><span>⚂</span></div><button class="btn" data-act="roll">Roll</button></section>
      ${raceHTML(c)}</div>`;
  }
  const RACE_COLORS = [190, 320, 45, 140, 265, 15];
  const raceOf = c => c.race || { teams: [{ name: 'Rockets', score: 0 }, { name: 'Comets', score: 0 }], target: 20 };
  function raceHTML(c) {
    const r = raceOf(c), lead = Math.max(...r.teams.map(t => t.score));
    return `<section class="panel race" id="race"><h2 class="h">Team race</h2><p>Give teams points for answers, teamwork or tidy desks. First rocket to reach the planet wins.</p>
      <div class="lanes">${r.teams.map((t, i) => `<div class="lane" style="--h:${RACE_COLORS[i]}"><b class="tname">${esc(t.name)}</b>
        <div class="track"><span class="rk" style="left:calc(${Math.min(1, t.score / r.target)} * (100% - 2.6rem))">🚀</span><span class="goalp">🪐</span></div>
        <b class="tscore">${t.score}${t.score === lead && lead > 0 ? ' 👑' : ''}</b><button class="pill" data-act="race" data-i="${i}" data-d="-1" aria-label="Take a point from ${esc(t.name)}">−</button><button class="btn" data-act="race" data-i="${i}" data-d="1" aria-label="Give ${esc(t.name)} a point">+1</button></div>`).join('')}</div>
      <div class="raceq" id="raceq">${S().sets.length ? `<label>Question from <select id="raceset">${S().sets.map(s => `<option value="${esc(s.id)}">${esc(s.title)}</option>`).join('')}</select></label><button class="pill" data-act="raceask">Ask a question</button><div id="raceout" aria-live="polite"></div>` : ''}</div>
      <form class="inline" data-form="race"><label>Teams<input name="names" value="${esc(r.teams.map(t => t.name).join(', '))}" maxlength="140" placeholder="Rockets, Comets, Stars"></label><label>Points to win<input type="number" name="target" min="5" max="999" value="${r.target}"></label><button class="pill">Save teams</button><button type="button" class="pill" data-act="racereset">Reset scores</button></form></section>`;
  }

  /* ---------- story missions ---------- */
  const packById = id => S().packs.find(p => p.id === id);
  const stationsOf = (c, pid) => c ? c.assign.filter(a => a.pack === pid) : [];
  const getRes = c => (aid, sid) => resultFor(c, aid, sid);
  const starRow = n => '⭐'.repeat(n) + `<i class="dim">${'⭐'.repeat(3 - n)}</i>`;
  function missionsHTML(teacher) {
    const c = cls(), s = teacher ? null : student();
    const packs = teacher ? S().packs : S().packs.filter(p => stationsOf(c, p.id).length);
    if (!packs.length && !teacher) return '';
    return `<div class="bar"><h2 class="h">🚀 Story missions</h2>${teacher ? '<button class="btn" data-act="editpack">New story mission</button>' : ''}</div>
      ${teacher ? '<p class="lead">One story becomes four stations: listening, reading, writing and speaking. Each scores itself, and stars go straight onto the class points.</p>' : ''}
      <div class="missions">${packs.map((p, i) => {
        const st = stationsOf(c, p.id), live = st.length === 4, crew = c && s ? C.crewFor(c, S().packs, s.id, getRes(c)).find(x => x.pack.id === p.id) : null;
        const cr = C.CREW[S().packs.indexOf(p) % C.CREW.length];
        return `<article class="mission" style="--h:${hash(p.title) % 360};--i:${i}"><span class="crew ${crew && crew.got ? 'got' : ''} ${crew && crew.shiny ? 'shiny' : ''}" title="${esc(cr[1])}">${cr[0]}</span>
          <h3>${esc(p.title)}</h3><p>${p.story.length} story lines, ${p.words.length} words</p>
          ${s ? `<div class="stations">${C.SKILL_IDS.map(k => { const a = st.find(x => x.skill === k), r = a && resultFor(c, a.id, s.id); return `<span>${C.SKILLS4[k][0]}<b>${starRow(C.starsFor(r))}</b></span>`; }).join('')}</div>` : ''}
          <div class="chips">${teacher ? `${c ? (live ? `<button class="btn" data-act="packprog" data-pack="${esc(p.id)}">Progress in ${esc(c.name)}</button><button class="pill" data-act="packstop" data-pack="${esc(p.id)}">Stop for this class</button>` : `<button class="btn" data-act="packstart" data-pack="${esc(p.id)}">Start for ${esc(c.name)}</button>`) : ''}
            <button class="pill" data-act="mission" data-pack="${esc(p.id)}">Preview</button><button class="pill" data-act="editpack" data-pack="${esc(p.id)}">Edit</button>` : `<button class="btn" data-act="mission" data-pack="${esc(p.id)}">${st.some(a => resultFor(c, a.id, s.id)) ? 'Continue mission' : 'Start mission'}</button>`}</div>
          ${teacher ? `<button class="x" data-act="delpack" data-pack="${esc(p.id)}" aria-label="Delete ${esc(p.title)}">✕</button>` : ''}</article>`;
      }).join('') || '<p class="empty">No story missions yet. Make one from this week\'s story.</p>'}</div>`;
  }
  function crewHTML(c, s) {
    const crew = C.crewFor(c, S().packs, s.id, getRes(c)); if (!crew.length) return '';
    return `<h3 class="h">My space crew</h3><p class="lead">Finish all four stations of a mission to meet a new crew member. Three stars everywhere makes them shine.</p>
      <div class="crewgrid">${crew.map(x => `<div class="crewcard ${x.got ? 'got' : ''} ${x.shiny ? 'shiny' : ''}"><span>${x.got ? x.icon : '❔'}</span><b>${x.got ? esc(x.name) : 'Locked'}</b><small>${esc(x.pack.title)}</small></div>`).join('')}</div>`;
  }
  let missionPack = null;
  function paintMission() {
    const p = missionPack, c = cls(), s = ui.role === 'teacher' ? null : student(), st = stationsOf(c, p.id);
    openDlg(`<div class="phead"><span>🚀 ${esc(p.title)}</span><button class="pill" data-act="closedlg">Close</button></div>
      <div class="mhome"><div class="chips">${p.slides ? `<a class="pill" href="${esc(p.slides)}" target="_blank" rel="noopener noreferrer">📽️ Watch the slides</a>` : ''}${p.story.length ? '<button class="pill" data-act="readstory">📖 Read the story</button>' : ''}</div>
        <div class="stationgrid">${C.SKILL_IDS.map((k, i) => { const a = st.find(x => x.skill === k), r = a && s ? resultFor(c, a.id, s.id) : null;
          return `<button class="station s${k}" style="--i:${i}" data-act="station" data-skill="${k}"><span class="big">${C.SKILLS4[k][0]}</span><b>${C.SKILLS4[k][1]}</b><span class="srow">${starRow(C.starsFor(r))}</span><small>${r ? `Best ${r.best} of ${r.total}` : s ? 'Not started' : 'Preview'}</small></button>`; }).join('')}</div>
        ${s && !st.length ? '<p class="hint">Your teacher has not started this mission for your class, so scores are not saved.</p>' : ''}</div><span></span>`, 'player');
  }
  function crewReveal(x) {
    party();
    openDlg(`<div class="phead"><span>New crew member!</span><button class="pill" data-act="mission" data-pack="${esc(x.pack.id)}">Back to mission</button></div>
      <div class="slide reveal ${x.shiny ? 'shiny' : ''}"><span class="big">${x.icon}</span><h2>${esc(x.name)} joined your crew!</h2><p>${x.shiny ? 'Three stars in every station. A shiny crew member!' : 'Get three stars in every station to make them shine.'}</p></div><span></span>`, 'player');
  }
  async function stationDone(p, k, score, total) {
    const c = cls(), s = ui.role === 'teacher' ? null : student(), a = stationsOf(c, p.id).find(x => x.skill === k);
    if (!s || !a) return;
    if (k === 'S' && !SkyMissions.canListen()) return; // no microphone scoring here, so do not record a zero
    const before = C.crewFor(c, S().packs, s.id, getRes(c)).find(x => x.pack.id === p.id), pts = s.points;
    await saveScore(c, a.id, s, score, total, true);
    C.creditStars(c, S().packs, getRes(c)); if (!fam) save();
    const after = C.crewFor(c, S().packs, s.id, getRes(c)).find(x => x.pack.id === p.id);
    if (s.points > pts) toast(`+${s.points - pts} star${s.points - pts === 1 ? '' : 's'} for ${s.name.split(' ')[0]}!`);
    if (after && after.got && (!before || !before.got || (after.shiny && !before.shiny))) setTimeout(() => dlg.open && crewReveal(after), 1600);
  }
  function packProgress(c, p) {
    const st = stationsOf(c, p.id), rows = c.students.map(s => ({ s, stars: C.SKILL_IDS.map(k => { const a = st.find(x => x.skill === k); return a ? C.starsFor(resultFor(c, a.id, s.id)) : 0; }) }));
    const done = rows.filter(r => r.stars.every(x => x > 0)).length;
    openDlg(`<div class="phead"><span>🚀 ${esc(p.title)}: ${esc(c.name)}</span><button class="pill" data-act="closedlg">Close</button></div>
      <p>${done} of ${c.students.length} finished all four stations.${cloud.user ? ' <button class="linkish" data-act="refreshprog" data-pack="' + esc(p.id) + '">Refresh</button>' : ''}</p>
      <div class="pgrid"><b>Student</b>${C.SKILL_IDS.map(k => `<b title="${C.SKILLS4[k][1]}">${C.SKILLS4[k][0]}</b>`).join('')}
        <b>Class</b>${C.SKILL_IDS.map((k, i) => { const v = rows.filter(r => r.stars[i] > 0); return `<b class="avg">${v.length ? (v.reduce((n, r) => n + r.stars[i], 0) / v.length).toFixed(1) + '⭐' : '–'}<small>${v.length} played</small></b>`; }).join('')}
        ${rows.map(r => `<span class="nm">${esc(r.s.name)}</span>${r.stars.map(n => `<span class="st${n}">${n ? '⭐'.repeat(n) : '·'}</span>`).join('')}`).join('')}</div>`, 'player');
  }

  /* ---------- iPad login: class code, tap your name, picture PIN ---------- */
  const KNOWN = 'skyclass-classes';
  const knownClasses = () => { try { return JSON.parse(localStorage.getItem(KNOWN)) || []; } catch { return []; } };
  function loginHTML() {
    if (!sb) return '';
    if (roster && pinFor) return `<section class="panel pinpad"><button class="pill" data-act="pinback">← Not ${esc(pinFor.name)}</button><h2 class="h">Hi ${esc(pinFor.name)}! Tap your secret pictures.</h2>
      <div class="pinshow">${[0, 1, 2, 3].map(i => `<i>${pinTyped[i] ? PIN_PICS[+pinTyped[i] - 1] : ''}</i>`).join('')}</div>
      <div class="pinkeys">${PIN_PICS.map((p, i) => `<button data-act="pinkey" data-k="${i + 1}" aria-label="Picture ${i + 1}">${p}</button>`).join('')}<button class="pill" data-act="pinclear">Clear</button></div></section>`;
    if (roster) return `<section class="panel"><div class="bar"><h2 class="h">${esc(roster.name)}: tap your name</h2><button class="pill" data-act="rosterout">Change class</button></div>
      <div class="cards">${roster.students.map(s => `<div class="card"><button class="give" data-act="rosterpick" data-sid="${esc(s.id)}">${avatar(s)}<span class="nm">${esc(s.name)}</span></button></div>`).join('') || '<p class="empty">Nobody in this class has a picture PIN yet.</p>'}</div></section>`;
    const known = knownClasses();
    return `<form class="panel form" data-form="classlogin"><h2 class="h">Join your class</h2>${known.length ? `<div class="chips wide">${known.map(k => `<button type="button" class="btn" data-act="classpick" data-code="${esc(k.code)}">${esc(k.name)}</button>`).join('')}</div>` : ''}
      <label>Class code from your teacher<input name="code" maxlength="8" autocomplete="off" autocapitalize="characters" required placeholder="ABCD2345"></label><button class="btn">Join</button></form>`;
  }
  async function openRoster(code) {
    code = code.trim().toUpperCase();
    const { data, error } = await sb.rpc('sky_class_roster', { p_class: code });
    if (error) return toast('Could not reach the class. Check the internet connection.');
    if (!data) return toast('That class code did not work. Check it with your teacher.');
    roster = { code, name: data.name, students: data.students }; pinFor = null; pinTyped = '';
    const list = knownClasses().filter(k => k.code !== code); list.unshift({ code, name: data.name });
    try { localStorage.setItem(KNOWN, JSON.stringify(list.slice(0, 8))); } catch { /* remembering is a convenience */ }
    render();
  }
  async function tryPin() {
    const { data, error } = await sb.rpc('sky_pin_login', { p_class: roster.code, p_student: pinFor.id, p_pin: pinTyped });
    pinTyped = '';
    if (error) { render(); return toast('Could not reach the class. Try again.'); }
    if (data === 'LOCKED') { pinFor = null; render(); return toast('Too many wrong tries. Ask your teacher, or wait ten minutes.'); }
    if (!data) { render(); const p = $('.pinshow'); if (p) { p.classList.add('bad'); } return toast('Those pictures are not right. Try again.'); }
    pinFor = null; await openFamily(data, false, false);
  }
  function ipadHTML(c) {
    if (!cloud.user || !c || !c.students.length) return '';
    const login = cloud.logins.find(l => l.class_id === c.id), pins = cloud.pins.filter(p => p.class_id === c.id), missing = c.students.filter(s => !pins.some(p => p.student_id === s.id)).length;
    if (!login) return `<section class="panel"><h3>iPad login for ${esc(c.name)}</h3><p>Students join with a class code, tap their name and enter a 4-picture PIN. No QR codes or long codes to type. Save the site to each iPad's home screen once.</p>
      <button class="btn" data-act="ipadon">Turn on iPad login</button></section>`;
    return `<section class="panel"><h3>iPad login for ${esc(c.name)}</h3><p>Class code: <code class="bigcode">${esc(login.code)}</code></p>
      <p>On each iPad: open <b>${esc(location.host + location.pathname)}</b>, choose Student, enter the code once. The iPad remembers the class.</p>
      <div class="chips"><button class="btn" data-act="pincards">🖨️ Print picture PIN cards</button>${missing ? `<button class="pill" data-act="ipadpins">Make PINs for ${missing} new student${missing === 1 ? '' : 's'}</button>` : ''}<button class="pill danger" data-act="ipadoff">Turn off iPad login</button></div></section>`;
  }
  const newPin = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), b => (b % 8) + 1).join('');
  async function loadLogins() {
    const [l, p] = await Promise.all([sb.from('sky_class_logins').select('code,class_id'), sb.from('sky_pins').select('class_id,student_id,pin')]);
    cloud.logins = l.data || []; cloud.pins = p.data || [];
  }

  /* ---------- practice: question sets, assignments and results ---------- */
  const GAME = id => SkyGames.setGames.find(g => g.id === id);
  const setById = id => S().sets.find(s => s.id === id);
  const resultFor = (c, aid, sid) => C.mergeResult((c.results[aid] || {})[sid], cloud.res[`${c.id}|${sid}|${aid}`]);
  const moodOf = (c, sid, day) => (c.checkin[day] || {})[sid] || cloud.moods[`${c.id}|${sid}|${day}`] || 0;
  const pct = r => Math.round(r.best / r.total * 100);
  const gameBtns = (set, aid) => C.setGames(set).map(g => `<button class="pill" data-act="setplay" data-set="${esc(set.id)}" data-game="${g}"${aid ? ` data-assign="${esc(aid)}"` : ''}>${GAME(g).icon} ${GAME(g).title}</button>`).join('');
  function practiceHTML(teacher) {
    const c = cls(), s = teacher ? null : student();
    const todo = c ? c.assign.slice().reverse().map(a => {
      const set = setById(a.setId), g = GAME(a.game); if (!set) return '';
      if (teacher) {
        const played = c.students.filter(st => resultFor(c, a.id, st.id)).length;
        return `<div class="row"><span class="big sm">${g.icon}</span><span class="nm"><b>${esc(set.title)}</b><small>${g.title}${a.due ? ', due ' + niceDate(a.due + 'T12:00') : ''}</small></span><span class="done">${played} of ${c.students.length} played</span>
          <button class="pill" data-act="results" data-id="${esc(a.id)}">Results</button><button class="x" data-act="unassign" data-id="${esc(a.id)}" aria-label="Remove this assignment">✕</button></div>`;
      }
      const r = resultFor(c, a.id, s.id);
      return `<div class="row"><span class="big sm">${g.icon}</span><span class="nm"><b>${esc(set.title)}</b><small>${g.title}${a.due ? ', due ' + niceDate(a.due + 'T12:00') : ''}</small></span><span class="done ${r ? (pct(r) >= 80 ? 'ok' : '') : 'new'}">${r ? `Best ${r.best} of ${r.total}` : 'Not started'}</span>
        <button class="btn" data-act="setplay" data-set="${esc(set.id)}" data-game="${a.game}" data-assign="${esc(a.id)}">${r ? 'Play again' : 'Start'}</button></div>`;
    }).join('') : '';
    const sets = S().sets.map((set, i) => `<article class="lesson setcard" style="--h:${hash(set.title) % 360};--i:${i}"><h3>${esc(set.title)}</h3><p>${set.items.length} item${set.items.length === 1 ? '' : 's'}</p>
      <div class="chips">${gameBtns(set)}</div>
      ${teacher ? `<div class="chips">${c ? `<button class="btn" data-act="assign" data-set="${esc(set.id)}">Assign to ${esc(c.name)}</button>` : ''}<button class="pill" data-act="print" data-set="${esc(set.id)}">🖨️ Worksheet</button><button class="pill" data-act="editset" data-set="${esc(set.id)}">Edit</button></div>
        <button class="x" data-act="delset" data-set="${esc(set.id)}" aria-label="Delete ${esc(set.title)}">✕</button>` : ''}</article>`).join('');
    return `${missionsHTML(teacher)}<div class="bar"><h2 class="h">${teacher ? 'Practice' : 'My practice'}</h2>${teacher ? `${cloud.user ? '<button class="pill" data-act="refresh">Refresh scores</button>' : ''}<button class="btn" data-act="editset">New question set</button>` : ''}</div>
      ${c ? `<section class="panel"><h3>${teacher ? `Assigned to ${esc(c.name)}` : 'To do'}</h3>${todo ? `<div class="rows">${todo}</div>` : `<p class="empty">${teacher ? 'Nothing assigned yet. Pick a set below and press Assign.' : 'No practice set for you yet.'}</p>`}</section>` : ''}
      <h3 class="h">${teacher ? 'Question sets' : 'Practise anything'}</h3>${teacher ? '<p class="lead">Type one list, play it as flashcards, spelling or a quiz, print it, or send it home.</p>' : ''}
      <div class="lessons">${sets || '<p class="empty">No question sets yet.</p>'}</div>`;
  }
  function wheelPool(c) { const rec = c.attendance[C.today()] || {}; return c.students.filter(s => rec[s.id] !== 'a'); }
  function wheelHTML(c) {
    const pool = wheelPool(c), n = pool.length, a = 360 / Math.max(n, 1), pt = d => { const r = d * Math.PI / 180; return (100 + 96 * Math.sin(r)).toFixed(2) + ',' + (100 - 96 * Math.cos(r)).toFixed(2); };
    const fs = Math.max(4.5, Math.min(11, 150 / Math.max(n, 6)));
    const seg = pool.map((s, i) => `${n === 1 ? '<circle cx="100" cy="100" r="96"' : `<path d="M100,100 L${pt(i * a)} A96,96 0 0 1 ${pt((i + 1) * a)}Z"`} fill="hsl(${(i * 47 + 200) % 360} 85% ${i % 2 ? 68 : 60}%)"/>
      <text x="188" y="100" text-anchor="end" dominant-baseline="middle" font-size="${fs}" transform="rotate(${(i + .5) * a - 90} 100 100)">${esc(s.name.slice(0, 14))}</text>`).join('');
    return `<div class="wheelwrap"><i class="pointer"></i><svg id="wheel" class="wheel" viewBox="0 0 200 200" style="transform:rotate(${wheelRot}deg)" data-act="spin" role="img" aria-label="Name wheel">${seg}<circle cx="100" cy="100" r="12" fill="#fff" stroke="#1b2a5c" stroke-width="3"/></svg></div>`;
  }
  function gamesHTML() {
    const best = SkyGames.best();
    return `<h2 class="h">Games</h2><p class="lead">Quick brain games. Best scores are kept on this device.</p>
      <div class="lessons">${SkyGames.list.map((g, i) => `<article class="lesson game" style="--h:${g.hue};--i:${i}"><span class="big">${g.icon}</span><h3>${g.title}</h3><p>${g.blurb}</p>
        <p class="best">${best[g.id] != null ? `Best: ${esc(best[g.id])} ${g.unit}` : 'Not played yet'}</p><button class="btn" data-act="game" data-id="${g.id}">Play</button></article>`).join('')}</div>`;
  }
  const LIB = { slides: ['📽️', 'Slides'], doc: ['📄', 'Document'], game: ['🎮', 'Game'], image: ['🖼️', 'Picture'], video: ['🎬', 'Video'] };
  function libraryHTML(teacher) {
    const lib = S().lib, groups = {};
    lib.items.forEach(it => (groups[it.group] = groups[it.group] || []).push(it));
    const setup = teacher ? `<form class="panel form" data-form="librepo"><label class="wide">GitHub repository that holds your slides and games<input name="repo" value="${esc(lib.repo)}" placeholder="yourname/skyclass-library" required></label><button class="btn">Sync from GitHub</button>
      <p class="hint wide">Put PowerPoints, PDFs, pictures and HTML games in a public GitHub repository, one folder per subject, then sync. Sync again after adding files. Everyone can see a public repository, so keep student details out of it.</p></form>
      <form class="panel form" data-form="libdrive"><label class="wide">Google Drive folder for big slide files<input name="drive" value="${lib.drive ? 'https://drive.google.com/drive/folders/' + esc(lib.drive) : ''}" placeholder="https://drive.google.com/drive/folders/…"></label><button class="btn">Save folder</button>
      <p class="hint wide">Share the folder as "Anyone with the link: Viewer", then paste its link. Files you add to the folder appear here by themselves. Leave empty to remove it.</p></form>` : '';
    const drive = lib.drive ? `<section class="sitegroup"><h3>📽️ Slides</h3><iframe class="drive" src="https://drive.google.com/embeddedfolderview?id=${esc(lib.drive)}#grid" title="Slides folder" loading="lazy"></iframe><p class="hint">Tap a file to open it in Google Drive.</p></section>` : '';
    return `<h2 class="h">Library</h2>${setup}${drive}${Object.keys(groups).sort().map(g => `<section class="sitegroup"><h3>${esc(g)}</h3><div class="sites">${groups[g].map(it => `<button class="site libitem" data-act="libopen" data-path="${esc(it.path)}"><b>${LIB[it.kind][0]} ${esc(it.title)}</b><small>${LIB[it.kind][1]}${it.size ? ', ' + (it.size / 1e6).toFixed(1) + ' MB' : ''}</small></button>`).join('')}</div></section>`).join('')
      || (drive ? '' : `<p class="empty">${teacher ? 'No files yet. Add a Drive folder or sync a repository above.' : 'Your teacher has not added any files yet.'}</p>`)}`;
  }
  async function libSync(text) {
    const repo = C.cleanRepo(text); if (!repo) return toast('Write the repository as owner/name, for example yourname/skyclass-library.');
    try {
      const info = await fetch(`https://api.github.com/repos/${repo}`);
      if (info.status === 404) return toast('That repository was not found. It has to be public.');
      if (!info.ok) throw new Error('github');
      const branch = (await info.json()).default_branch, tree = await fetch(`https://api.github.com/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
      if (!tree.ok) throw new Error('github');
      state.lib = { repo, branch, items: C.libraryFromTree((await tree.json()).tree) }; state = C.normalize(state); save(); render();
      toast(`Library synced: ${state.lib.items.length} file${state.lib.items.length === 1 ? '' : 's'}.`);
    } catch { toast('GitHub could not be reached just now. Try again in a few minutes.'); }
  }
  function sitesHTML() {
    return `<h2 class="h">Fun sites, one tap away</h2><p class="lead">Each one opens in a new tab so your class stays here.</p>
      <section class="sitegroup"><h3>📌 My links</h3><div class="sites">${state.links.map(l => `<span class="site mine"><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer"><b>${esc(l.title)}</b><small>${esc(new URL(l.url).hostname)}</small></a><button class="x" data-act="dellink" data-id="${esc(l.id)}" aria-label="Remove ${esc(l.title)}">✕</button></span>`).join('')}
        <form class="site add" data-form="link"><input name="title" placeholder="Name" maxlength="50" aria-label="Link name"><input name="url" placeholder="website.com" required aria-label="Link address"><button class="pill">Add link</button></form></div></section>
      ${SKY_SITES.map(g => `<section class="sitegroup"><h3>${g.icon} ${g.group}</h3><div class="sites">${g.sites.map(([t, u, d]) => `<a class="site" href="${u}" target="_blank" rel="noopener noreferrer"><b>${t}</b><small>${d}</small></a>`).join('')}</div></section>`).join('')}`;
  }
  function setupHTML(c) {
    return `<h2 class="h">Classes</h2>
      ${c ? `<section class="panel"><h3>${esc(c.name)}: ${c.students.length} students</h3>
        <form data-form="rename" class="inline"><label>Class name <input name="name" value="${esc(c.name)}" maxlength="40" required></label><button class="pill">Rename</button></form>
        <form data-form="addstudents" class="form"><label class="wide">Add students, one name per line<textarea name="names" rows="3" placeholder="Ayesha Khan&#10;Bilal Ahmed"></textarea></label><button class="btn">Add students</button></form>
        <div class="namelist">${c.students.map(s => `<span>${esc(s.name)}<button class="x" data-act="delstudent" data-sid="${esc(s.id)}" aria-label="Remove ${esc(s.name)}">✕</button></span>`).join('')}</div>
        <button class="pill danger" data-act="delclass">Delete this class</button></section>` : '<p class="lead">Start with a class. Paste your list of names, or try the sample class first.</p>'}
      <section class="panel"><h3>New class</h3><form data-form="newclass" class="form"><label>Class name<input name="name" maxlength="40" required placeholder="Grade 4 Blue"></label>
        <label class="wide">Student names, one per line<textarea name="names" rows="4" placeholder="Ayesha Khan&#10;Bilal Ahmed"></textarea></label><button class="btn">Create class</button>
        <button type="button" class="pill" data-act="sample">Try a sample class</button></form></section>
      <section class="panel"><h3>Bring in your ClassGrove classes</h3><p>Copies class lists and points. Your ClassGrove site and its data are not changed.</p>
        <div class="chips"><button class="btn" data-act="cglocal">Copy from this device</button><button class="pill" data-act="cgfile">Import a ClassGrove backup file</button></div></section>
      <section class="panel"><h3>Backup</h3><p>Skyclass keeps everything in this browser. Download a backup before clearing browser data or changing devices.</p>
        <div class="chips"><button class="btn" data-act="backup">Download backup</button><button class="pill" data-act="restore">Restore a backup</button></div></section>${accountHTML(c)}`;
  }
  function accountHTML(c) {
    if (!sb) return '<section class="panel"><h3>Online accounts</h3><p>Online saving is not connected on this copy of Skyclass, so everything stays on this device.</p></section>';
    if (!cloud.user) return `<section class="panel"><h3>Save online and share with families</h3><p>Sign in to keep your classes online and to give each family a code for their own devices.</p>
      <form data-form="signin" class="form"><label>Email<input type="email" name="email" autocomplete="username" required></label><label>Password<input type="password" name="password" autocomplete="current-password" minlength="8" required></label>
      <button class="btn">Sign in</button><button type="button" class="pill" data-act="signup">Create account</button></form></section>`;
    const row = s => { const k = cloud.codes.find(x => x.class_id === c.id && x.student_id === s.id);
      return `<div class="row"><span class="nm">${esc(s.name)}</span>${k ? `<code>${esc(k.code)}</code><button class="pill" data-act="copycode" data-code="${esc(k.code)}">Copy</button>` : ''}<button class="pill" data-act="recode" data-sid="${esc(s.id)}">${k ? 'New code' : 'Make code'}</button></div>`; };
    return `<section class="panel"><h3>Signed in as ${esc(cloud.user.email)}</h3><p id="sync">${esc(cloud.status)}</p><button class="pill" data-act="signout">Sign out</button></section>
      ${c && c.students.length ? `<section class="panel"><h3>Family codes for ${esc(c.name)}</h3><p>A code opens one child's stars, attendance, homework and lessons on any device. At ${esc(location.host + location.pathname)} choose Student or Parent, then enter the code. Treat a code like a password. Making a new code switches the old one off.</p>
        <div class="chips"><button class="btn" data-act="makecodes">Make codes for everyone</button></div><div class="rows">${c.students.map(row).join('')}</div></section>` : ''}${ipadHTML(c)}`;
  }

  /* ---------- student and parent ---------- */
  function whoHTML(title) {
    const codeForm = sb ? '<form class="panel form" data-form="famcode"><h2 class="h">Enter your family code</h2><label>Code from your teacher<input name="code" maxlength="12" autocomplete="off" autocapitalize="characters" required placeholder="ABCDE23456"></label><label class="check wide"><input type="checkbox" name="keep"> Remember the code on this device. Only tick this on your own phone or computer.</label><button class="btn">Open</button></form>' : '';
    const join = loginHTML(); if (roster) return join;
    if (!state.classes.length) return join + codeForm || '<p class="empty">Your teacher has not set up a class on this device yet.</p>';
    const c = cls();
    return `${join}${codeForm}<h2 class="h">${codeForm ? 'Or, on the class device: ' : ''}${title}</h2><label class="pick block">Class <select data-change="class">${state.classes.map(k => `<option value="${esc(k.id)}" ${k.id === c.id ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}</select></label>
      <div class="cards">${c.students.map(s => `<div class="card"><button class="give" data-act="who" data-sid="${esc(s.id)}">${avatar(s)}<span class="nm">${esc(s.name)}</span></button></div>`).join('') || '<p class="empty">No students in this class yet.</p>'}</div>`;
  }
  function studentHTML() {
    const c = cls(), s = student();
    if (!s) return whoHTML('Tap your name');
    if (ui.tab === 'lessons') return lessonsHTML(false);
    if (ui.tab === 'games') return gamesHTML();
    if (ui.tab === 'library') return libraryHTML(false);
    if (ui.tab === 'news') return `<h2 class="h">Homework and news</h2><div class="posts">${postsHTML(c, false)}</div>`;
    if (ui.tab === 'practice') return practiceHTML(false);
    const next = C.nextBadge(s.points), prev = C.badgesFor(s.points).pop(), base = prev ? prev.at : 0, mood = moodOf(c, s.id, C.today());
    const checkin = mood ? `<p class="feel">Today you feel ${C.MOODS[mood][0]} ${C.MOODS[mood][1].toLowerCase()}. <button class="linkish" data-act="moodagain">Change</button></p>`
      : `<section class="panel checkin"><h3>Good morning, ${esc(s.name.split(' ')[0])}! How are you feeling?</h3><div class="moods">${[5, 4, 3, 2, 1].map(v => `<button data-act="mood" data-v="${v}"><span>${C.MOODS[v][0]}</span>${C.MOODS[v][1]}</button>`).join('')}</div></section>`;
    const todoMissions = S().packs.filter(p => { const st = stationsOf(c, p.id); return st.length && st.some(a => !resultFor(c, a.id, s.id)); }).length, todoSets = c.assign.filter(a => !a.pack && setById(a.setId) && !resultFor(c, a.id, s.id)).length;
    const banner = todoMissions ? `🚀 ${todoMissions === 1 ? 'A story mission is' : todoMissions + ' story missions are'} waiting. Earn stars and meet a new crew member!` : todoSets ? `🎯 You have ${todoSets} practice ${todoSets === 1 ? 'game' : 'games'} waiting. Let's go!` : '';
    return `${checkin}${banner ? `<button class="panel todo" data-act="tab" data-tab="practice">${banner}</button>` : ''}<section class="mecard">${avatar(s)}<div><h2>${esc(s.name)}</h2><p class="bigpts"><b>${s.points}</b> stars</p>
        ${next ? `<div class="meter"><i style="width:${Math.round((s.points - base) / (next.at - base) * 100)}%"></i></div><p>${next.at - s.points} more to become a ${next.icon} ${next.label}</p>` : '<p>You have every badge. Sky captain!</p>'}</div>
        <button class="pill" data-act="notme">${fam ? 'Use another code' : 'Not me'}</button></section>
      <div class="badges">${badgesHTML(s.points)}</div>${crewHTML(c, s)}${skyHTML(c, false)}
      <h3 class="h">Why I got stars</h3>${logHTML(s, 8)}`;
  }
  const logHTML = (s, n) => s.log.length ? `<ul class="log">${s.log.slice(-n).reverse().map(l => `<li><b class="${l.d < 0 ? 'neg' : ''}">${l.d > 0 ? '+' : ''}${l.d}</b> ${esc(l.r || 'Star')} <small>${niceDate(l.t)}</small></li>`).join('')}</ul>` : '<p class="empty">No stars yet. The first one is coming.</p>';
  function parentHTML() {
    const c = cls(), s = student();
    if (!s) return whoHTML('Choose your child');
    const rate = C.attendanceRate(c, s.id), today = (c.attendance[C.today()] || {})[s.id];
    return `<section class="mecard">${avatar(s)}<div><h2>${esc(s.name)}</h2><p>${esc(c.name)}</p></div><button class="pill" data-act="notme">${fam ? 'Use another code' : 'Choose another child'}</button></section>
      <div class="stats"><div><b>${s.points}</b>stars earned</div><div><b>${rate === null ? 'n/a' : rate + '%'}</b>${rate === null ? 'no attendance recorded yet' : 'attendance'}</div>
        <div><b>${today ? { p: 'Present', l: 'Late', a: 'Away' }[today] : 'n/a'}</b>today</div></div>
      <div class="badges">${badgesHTML(s.points)}</div>
      <div class="two"><section><h3 class="h">Recent stars</h3>${logHTML(s, 12)}</section><section><h3 class="h">Homework and news</h3><div class="posts">${postsHTML(c, false)}</div></section></div>
      <div class="two"><section><h3 class="h">Practice</h3>${c.assign.filter(a => setById(a.setId)).map(a => { const r = resultFor(c, a.id, s.id); return `<div class="row"><span class="big sm">${GAME(a.game).icon}</span><span class="nm"><b>${esc(setById(a.setId).title)}</b><small>${GAME(a.game).title}${a.due ? ', due ' + niceDate(a.due + 'T12:00') : ''}</small></span><span class="done">${r ? `Best ${r.best} of ${r.total}, ${r.tries} ${r.tries === 1 ? 'try' : 'tries'}` : 'Not started'}</span></div>`; }).join('') || '<p class="empty">No practice assigned.</p>'}</section>
        <section><h3 class="h">Morning check-ins</h3>${(() => { const days = [...Array(7)].map((_, i) => C.today(new Date(Date.now() - i * 864e5))).filter(d => moodOf(c, s.id, d)); return days.length ? `<div class="rows">${days.map(d => `<div class="row"><span class="nm">${niceDate(d + 'T12:00')}</span><span class="mood">${C.MOODS[moodOf(c, s.id, d)][0]}</span>${C.MOODS[moodOf(c, s.id, d)][1]}</div>`).join('')}</div>` : '<p class="empty">No check-ins this week.</p>'; })()}</section></div>`;
  }

  /* ---------- lesson player ---------- */
  function paintPlayer() {
    const { lesson, i, answers, votes, teacher } = player, n = lesson.slides.length;
    let body;
    if (i >= n) {
      const sc = C.scoreQuiz(lesson.slides, answers);
      body = `<div class="slide end"><span class="big">🎉</span><h2>${teacher ? 'Lesson finished' : sc.total ? `You got ${sc.right} of ${sc.total}` : 'Lesson finished'}</h2><p>${esc(lesson.title)}</p><button class="btn" data-act="closedlg">Close</button></div>`;
    } else {
      const s = lesson.slides[i], done = answers[i] !== undefined;
      if (s.type === 'info') body = `<div class="slide">${s.emoji ? `<span class="big">${esc(s.emoji)}</span>` : ''}<h2>${esc(s.title)}</h2><p>${esc(s.body).replace(/\n/g, '<br>')}</p></div>`;
      else if (s.type === 'poll') {
        const v = votes[i] || (votes[i] = s.options.map(() => 0)), max = Math.max(1, ...v);
        body = `<div class="slide"><h2>${esc(s.title)}</h2><p class="hint">${teacher ? 'Tap an option once for each hand up.' : 'Pick one.'}</p><div class="opts">${s.options.map((o, k) => `<button data-act="vote" data-k="${k}" ${!teacher && done ? 'disabled' : ''} class="poll"><i style="width:${v[k] / max * 100}%"></i><span>${esc(o)}</span><b>${v[k]}</b></button>`).join('')}</div></div>`;
      } else body = `<div class="slide"><h2>${esc(s.title)}</h2><div class="opts">${s.options.map((o, k) => `<button data-act="answer" data-k="${k}" ${done ? 'disabled' : ''} class="${done ? (k === s.answer ? 'right' : k === answers[i] ? 'wrong' : '') : ''}">${esc(o)}</button>`).join('')}</div>
        <p class="hint" aria-live="polite">${done ? (answers[i] === s.answer ? 'Correct!' : 'Not quite. The answer is ' + esc(s.options[s.answer]) + '.') : ''}</p></div>`;
    }
    openDlg(`<div class="phead"><span>${esc(lesson.title)}</span><button class="pill" data-act="closedlg">Close</button></div>${body}
      <div class="pfoot"><button class="pill" data-act="pprev" ${i ? '' : 'disabled'}>Back</button><span class="dots">${lesson.slides.map((_, k) => `<i class="${k === i ? 'on' : k < i ? 'past' : ''}"></i>`).join('')}</span><button class="btn" data-act="pnext" ${i >= n ? 'disabled' : ''}>${i === n - 1 ? 'Finish' : 'Next'}</button></div>`, 'player');
  }

  /* ---------- timer ---------- */
  function paintTimer() {
    const clock = $('#clock'); if (!clock) return;
    const left = timer.end ? Math.max(0, Math.ceil((timer.end - Date.now()) / 1000)) : timer.left;
    clock.textContent = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
    $('#ring').style.setProperty('--p', timer.total ? left / timer.total : 0);
    $('#tgo').textContent = timer.end ? 'Pause' : 'Start';
  }
  function stopTimer() { if (timer.end) timer.left = Math.max(0, Math.ceil((timer.end - Date.now()) / 1000)); timer.end = 0; clearInterval(timer.tick); }
  function beep() {
    try { const a = new (window.AudioContext || window.webkitAudioContext)(); [0, .3, .6].forEach(t => { const o = a.createOscillator(), g = a.createGain(); o.frequency.value = 880; g.gain.value = .2; o.connect(g).connect(a.destination); o.start(a.currentTime + t); o.stop(a.currentTime + t + .18); }); } catch { /* no audio available */ }
  }

  /* ---------- import and backup ---------- */
  function addClasses(list, label) {
    if (!list.length) return toast(`No ${label} classes found.`);
    state.classes.push(...list); state.activeClass = list[0].id; state = C.normalize(state); ui.tab = 'board'; save(); render();
    toast(`Copied ${list.length} class${list.length === 1 ? '' : 'es'} from ${label}.`);
  }
  function readClassGroveLocal() {
    const get = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
    const idx = get('pointparty-schools'), schools = idx && Array.isArray(idx.schools) && idx.schools.length ? idx.schools : [{ id: 'default', name: '' }];
    return schools.flatMap(s => { const st = get(s.id === 'default' ? 'pointparty-v1' : 'pointparty-school-' + s.id); return st ? C.fromClassGrove(st, schools.length > 1 ? C.clip(s.name, 24) : '') : []; });
  }
  function pickFile(cb) {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = async () => { try { cb(JSON.parse(await inp.files[0].text())); } catch { toast('That file could not be read. Choose a .json backup file.'); } };
    inp.click();
  }

  /* ---------- actions ---------- */
  function give(c, sid, delta, reason, el) {
    const d = C.award(c, sid, delta, reason); if (!d) return 0;
    const card = app.querySelector(`.card[data-sid="${CSS.escape(sid)}"]`);
    if (card) { card.querySelector('.pts').textContent = c.students.find(s => s.id === sid).points; card.classList.remove('pop'); void card.offsetWidth; card.classList.add('pop'); if (d > 0) burst(el || card); }
    return d;
  }
  const acts = {
    home() { ui.role = null; render(); enterAnim(); },
    enter(b) { ui.role = b.dataset.role; ui.tab = TABS[ui.role][0] ? TABS[ui.role][0][0] : ''; if (ui.role !== 'teacher') { ui.who = null; if (sb && ui.code) openFamily(ui.code, true); } if (!cls() && state.classes[0]) state.activeClass = state.classes[0].id; save(); render(); enterAnim(); },
    tab(b) { ui.tab = b.dataset.tab; save(); render(); enterAnim(); scrollTo(0, 0); },
    game(b) {
      const g = SkyGames.list.find(x => x.id === b.dataset.id); if (!g) return;
      openDlg(`<div class="phead"><span>${g.icon} ${g.title}</span><button class="pill" data-act="closedlg">Close</button></div><div id="game" class="gamebox"></div><span></span>`, 'player');
      stopGame = SkyGames.start(g.id, $('#game'));
    },
    libopen(b) {
      const lib = S().lib, it = lib.items.find(x => x.path === b.dataset.path); if (!it) return;
      const u = C.libUrl(lib.repo, lib.branch, it), t = esc(it.title);
      const view = it.kind === 'slides' ? (it.size > 10e6 ? '<div class="slide"><span class="big">📽️</span><h2>Too big to preview</h2><p>Slide files over 10 MB cannot be shown here. Download it and open it in PowerPoint.</p></div>' : `<iframe class="viewer" src="${esc(u.office)}" title="${t}" allowfullscreen></iframe>`)
        : it.kind === 'game' ? `<iframe class="viewer" src="${esc(u.site)}" title="${t}" sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock" allow="fullscreen"></iframe>`
        : it.kind === 'image' ? `<img class="viewer" src="${esc(u.raw)}" alt="${t}">`
        : it.kind === 'video' ? `<video class="viewer" src="${esc(u.site)}" controls></video>` : '';
      if (!view) return window.open(u.page, '_blank', 'noopener');
      openDlg(`<div class="phead"><span>${t}</span><span><a class="pill" href="${esc(it.kind === 'game' ? u.site : u.raw)}" target="_blank" rel="noopener noreferrer">${it.kind === 'game' ? 'Open in new tab' : 'Download'}</a> <button class="pill" data-act="closedlg">Close</button></span></div>${view}<span></span>`, 'player');
    },
    skill(b) { ui.skill = b.dataset.id; save(); render(); },
    give(b) { const c = cls(), sk = C.SKILLS.find(s => s.id === ui.skill) || C.SKILLS[0], d = give(c, b.dataset.sid, sk.points, sk.label, b); if (d) { last = [[b.dataset.sid, d]]; afterAward(c); } },
    take(b) { const c = cls(), d = give(c, b.dataset.sid, -1, 'Point removed'); if (d) { last = [[b.dataset.sid, d]]; afterAward(c); } },
    giveall() { const c = cls(); last = c.students.map(s => [s.id, give(c, s.id, 1, 'Whole class')]).filter(x => x[1]); afterAward(c); toast('Everyone got a star.'); },
    undo() { const c = cls(); if (!last) return; last.forEach(([sid, d]) => give(c, sid, -d, 'Undo')); last = null; afterAward(c); toast('Undone.'); },
    goal() { const c = cls(); openDlg(`<form data-form="goal" class="form"><h2 class="h">Class goal</h2><label>Stars needed<input type="number" name="target" min="10" max="100000" value="${c.goal.target}" required></label><label>Reward<input name="reward" maxlength="60" value="${esc(c.goal.reward)}" required></label><button class="btn">Save goal</button><button type="button" class="pill" data-act="closedlg">Cancel</button></form>`); },
    mark(b) { const c = cls(), day = C.today(), rec = c.attendance[day] || (c.attendance[day] = {}); if (rec[b.dataset.sid] === b.dataset.v) delete rec[b.dataset.sid]; else rec[b.dataset.sid] = b.dataset.v; save(); render(); },
    allhere() { const c = cls(); c.attendance[C.today()] = Object.fromEntries(c.students.map(s => [s.id, 'p'])); save(); render(); toast('Everyone marked present.'); },
    delpost(b) { const c = cls(); c.posts = c.posts.filter(p => p.id !== b.dataset.id); save(); render(); },
    newlesson() {
      openDlg(`<form data-form="lesson" class="form"><h2 class="h">Write a lesson</h2><label>Title<input name="title" maxlength="100" required></label><label>Subject<input name="subject" maxlength="40" placeholder="Science"></label>
        <label class="wide">Slides. Leave a blank line between slides.<textarea name="text" rows="12" required placeholder="🌍 Our planet&#10;Earth is the third planet from the sun.&#10;&#10;? Which planet do we live on?&#10;- Mars&#10;* Earth&#10;&#10;T/F The sun is a star.&#10;= true&#10;&#10;% Which planet would you visit?&#10;- Mars&#10;- Saturn"></textarea></label>
        <p class="hint wide">Start a line with <b>?</b> for a quiz question and mark the right answer with <b>*</b>. Use <b>%</b> for a class poll and <b>T/F</b> for true or false.</p>
        <button class="btn">Save lesson</button><button type="button" class="pill" data-act="closedlg">Cancel</button></form>`);
    },
    dellesson(b) { if (confirm('Delete this lesson?')) { state.lessons = state.lessons.filter(l => l.id !== b.dataset.id); save(); render(); } },
    play(b) { const lesson = S().lessons.find(l => l.id === b.dataset.id); if (lesson) { player = { lesson, i: 0, answers: {}, votes: {}, teacher: ui.role === 'teacher' }; paintPlayer(); } },
    pnext() { if (player) { player.i++; paintPlayer(); if (player.i >= player.lesson.slides.length) burst($('.slide.end .big'), '🎉'); } },
    pprev() { if (player && player.i) { player.i--; paintPlayer(); } },
    answer(b) { const k = +b.dataset.k; player.answers[player.i] = k; const ok = k === player.lesson.slides[player.i].answer; paintPlayer(); if (ok) burst($('.opts .right')); },
    vote(b) { const k = +b.dataset.k; player.votes[player.i][k]++; if (!player.teacher) player.answers[player.i] = k; paintPlayer(); },
    closedlg: closeDlg,
    spin() {
      const c = cls(), pool = wheelPool(c), w = $('#wheel'); if (!pool.length || w.classList.contains('spinning')) return;
      const r = C.pickFair(pool.map(s => s.id), wheelUsed[c.id] || []); wheelUsed[c.id] = r.used;
      const i = pool.findIndex(s => s.id === r.pick), mid = (i + .5) * 360 / pool.length;
      wheelRot += 1440 + ((((-mid - wheelRot) % 360) + 360) % 360);
      w.classList.add('spinning'); w.style.transform = `rotate(${wheelRot}deg)`; $('#wheelout').innerHTML = ''; wheelPick = r.pick;
      const done = () => { w.classList.remove('spinning'); const out = $('#wheelout'); if (out) { out.innerHTML = `<b>${esc(pool[i].name)}</b><button class="pill" data-act="wheelstar">Give a star</button>`; burst(out, '✨'); } };
      setTimeout(done, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 4300); // matches the 4.2s spin in style.css
    },
    wheelstar(b) { const c = cls(); if (C.award(c, wheelPick, 1, 'Name wheel')) { save(); burst(b); b.disabled = true; toast('Star given.'); } },
    tset(b) { stopTimer(); timer.left = timer.total = b.dataset.m * 60; paintTimer(); },
    treset() { stopTimer(); timer.left = timer.total; paintTimer(); },
    tgo() {
      if (timer.end) { stopTimer(); return paintTimer(); }
      if (!timer.left) timer.left = timer.total;
      timer.end = Date.now() + timer.left * 1000;
      timer.tick = setInterval(() => { if (Date.now() >= timer.end) { stopTimer(); timer.left = 0; beep(); toast('Time is up!'); } paintTimer(); }, 250); paintTimer();
    },
    roll() { const d = $('#dice'); d.classList.remove('rolling'); void d.offsetWidth; d.classList.add('rolling'); d.innerHTML = [0, 0].map(() => `<span>${'⚀⚁⚂⚃⚄⚅'[Math.floor(Math.random() * 6)]}</span>`).join(''); },
    dellink(b) { state.links = state.links.filter(l => l.id !== b.dataset.id); save(); render(); },
    delstudent(b) { const c = cls(), s = c.students.find(x => x.id === b.dataset.sid); if (s && confirm(`Remove ${s.name} and their ${s.points} stars?`)) { c.students = c.students.filter(x => x !== s); save(); render(); } },
    delclass() { const c = cls(); if (confirm(`Delete ${c.name} with all its stars and attendance? Download a backup first if you may need it.`)) { state.classes = state.classes.filter(x => x !== c); state.activeClass = state.classes[0] ? state.classes[0].id : null; save(); render(); } },
    sample() { const c = C.newClass('Sample class', ['Ayesha', 'Bilal', 'Chen', 'Dania', 'Emre', 'Fatima', 'Gabriel', 'Hana', 'Ibrahim', 'Jasmine', 'Karim', 'Layla']); c.students.forEach((s, i) => C.award(c, s.id, (i * 7) % 12 + 2, 'Great start')); addClasses([c], 'the sample'); },
    cglocal() { addClasses(readClassGroveLocal(), 'ClassGrove'); },
    cgfile() { pickFile(o => addClasses(C.fromClassGrove(o, ''), 'the ClassGrove backup')); },
    backup() { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify({ app: 'skyclass', saved: new Date().toISOString(), state })], { type: 'application/json' })); a.download = `skyclass-backup-${C.today()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); },
    restore() { pickFile(o => { if (!o || o.app !== 'skyclass' || !o.state) return toast('That is not a Skyclass backup file.'); if (!confirm('Replace everything on this device with the backup?')) return; state = C.normalize(o.state); save(); render(); toast('Backup restored.'); }); },
    who(b) { ui.who = b.dataset.sid; save(); render(); },
    notme() { ui.who = null; ui.code = null; fam = null; famCode = null; pinFor = null; pinTyped = ''; saveLocal(); render(); },
    signup(b) { signIn(b.form, true); },
    async signout() { clearTimeout(syncT); await sb.auth.signOut(); cloud.user = null; cloud.codes = []; cloud.res = {}; cloud.moods = {}; render(); toast('Signed out. Your classes are still on this device.'); },
    async makecodes() {
      const c = cls(), rows = c.students.filter(s => !cloud.codes.some(k => k.class_id === c.id && k.student_id === s.id)).map(s => ({ code: newCode(), class_id: c.id, student_id: s.id }));
      if (!rows.length) return toast('Everyone already has a code.');
      const { error } = await sb.from('sky_codes').insert(rows); if (error) return toast('Codes were not made. ' + error.message);
      await loadCodes(); render(); toast(`Made ${rows.length} code${rows.length === 1 ? '' : 's'}.`);
    },
    async recode(b) {
      const c = cls(), m = { class_id: c.id, student_id: b.dataset.sid };
      await sb.from('sky_codes').delete().match(m);
      const { error } = await sb.from('sky_codes').insert({ code: newCode(), ...m }); if (error) toast('Code was not made. ' + error.message);
      await loadCodes(); render();
    },
    mission(b) { missionPack = packById(b.dataset.pack); if (missionPack) paintMission(); },
    readstory() { endGame(); openDlg(`<div class="phead"><span>📖 ${esc(missionPack.title)}</span><button class="pill" data-act="backmission">Back to mission</button></div><div id="game" class="gamebox"></div><span></span>`, 'player'); stopGame = SkyMissions.reader($('#game'), missionPack); },
    backmission() { endGame(); paintMission(); },
    station(b) {
      const p = missionPack, k = b.dataset.skill; endGame();
      openDlg(`<div class="phead"><span>${C.SKILLS4[k][0]} ${esc(p.title)}: ${C.SKILLS4[k][1]}</span><button class="pill" data-act="backmission">Back to mission</button></div><div id="game" class="gamebox"></div><span></span>`, 'player');
      stopGame = SkyMissions.run($('#game'), C.packStation(p, k), { fresh: () => C.packStation(p, k), done: (score, total) => stationDone(p, k, score, total) });
    },
    editpack(b) {
      const p = b.dataset.pack ? packById(b.dataset.pack) : null;
      openDlg(`<form data-form="pack" class="form"><h2 class="h">${p ? 'Edit story mission' : 'New story mission'}</h2><input type="hidden" name="id" value="${p ? esc(p.id) : ''}">
        <label class="wide">Write the mission<textarea name="text" rows="18" required placeholder="Title: My story&#10;Slides: https://drive.google.com/…&#10;Words:&#10;dog | 🐶 | an animal that barks&#10;Story:&#10;Every day, we go for a walk.&#10;Questions:&#10;What do they do every day? | go for a walk | go swimming | go to the zoo&#10;True or false:&#10;They walk every day. | true&#10;Speak:&#10;Thank you, neighbor!">${p ? esc(C.packText(p)) : ''}</textarea></label>
        <p class="hint wide"><b>Words:</b> word | picture emoji | meaning. <b>Story:</b> one sentence per line. <b>Questions:</b> question | right answer | wrong | wrong. <b>True or false:</b> sentence | true or false. <b>Speak:</b> sentences to say aloud. Listening uses the words and story, writing uses the words and short sentences.</p>
        <button class="btn">Save mission</button><button type="button" class="pill" data-act="closedlg">Cancel</button></form>`);
    },
    delpack(b) { const p = packById(b.dataset.pack); if (p && confirm(`Delete "${p.title}" and its scores in every class? Stars already given stay.`)) { state.packs = state.packs.filter(x => x !== p); state = C.normalize(state); save(); render(); } },
    packstart(b) { const c = cls(), p = packById(b.dataset.pack); if (!p || stationsOf(c, p.id).length) return; C.SKILL_IDS.forEach(k => c.assign.push({ id: `${p.id}:${k}`, pack: p.id, skill: k, t: Date.now() })); state = C.normalize(state); save(); render(); toast(`${p.title} started for ${c.name}.`); },
    packstop(b) { const c = cls(); if (!confirm('Stop this mission for the class? Its scores in this class are removed; stars already given stay.')) return; c.assign = c.assign.filter(a => a.pack !== b.dataset.pack); state = C.normalize(state); save(); render(); },
    async packprog(b) { if (cloud.user) { await loadExtras(); creditAll(); } packProgress(cls(), packById(b.dataset.pack)); },
    async refreshprog(b) { await loadExtras(); creditAll(); packProgress(cls(), packById(b.dataset.pack)); },
    classpick(b) { openRoster(b.dataset.code); },
    rosterout() { roster = null; pinFor = null; render(); },
    rosterpick(b) { pinFor = roster.students.find(s => s.id === b.dataset.sid); pinTyped = ''; render(); },
    pinback() { pinFor = null; pinTyped = ''; render(); },
    pinclear() { pinTyped = ''; render(); },
    pinkey(b) { if (pinTyped.length >= 4) return; pinTyped += b.dataset.k; tone(); render(); if (pinTyped.length === 4) tryPin(); },
    async ipadon() {
      const c = cls(), code = Array.from(crypto.getRandomValues(new Uint8Array(8)), x => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[x % 32]).join('');
      const { error } = await sb.from('sky_class_logins').insert({ code, class_id: c.id }); if (error) return toast('iPad login could not be turned on. ' + error.message);
      await acts.ipadpins(); },
    async ipadpins() {
      const c = cls(), rows = c.students.filter(s => !cloud.pins.some(p => p.class_id === c.id && p.student_id === s.id)).map(s => ({ class_id: c.id, student_id: s.id, pin: newPin() }));
      if (rows.length) { const { error } = await sb.from('sky_pins').insert(rows); if (error) return toast('PINs could not be made. ' + error.message); }
      await loadLogins(); render(); toast('iPad login is on. Print the PIN cards for your class.'); },
    async ipadoff() { const c = cls(); if (!confirm(`Turn off iPad login for ${c.name}? Students will need a new class code later.`)) return; await sb.from('sky_class_logins').delete().match({ class_id: c.id }); await loadLogins(); render(); },
    pincards() {
      const c = cls(), login = cloud.logins.find(l => l.class_id === c.id), w = window.open('', '_blank'); if (!w || !login) return toast('Allow pop-ups for this site to print PIN cards.');
      const cards = c.students.map(s => { const p = cloud.pins.find(x => x.class_id === c.id && x.student_id === s.id); return p ? `<div class="card"><b>${esc(s.name)}</b><span class="pics">${[...p.pin].map(d => PIN_PICS[+d - 1]).join(' ')}</span><small>Class code ${esc(login.code)}</small></div>` : ''; }).join('');
      w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(c.name)} PIN cards</title><style>body{font:16px system-ui,sans-serif;margin:1cm}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:.4cm}.card{border:2px dashed #888;border-radius:12px;padding:.4cm;display:grid;gap:.2cm;text-align:center;break-inside:avoid}.card b{font-size:20px}.pics{font-size:38px;letter-spacing:.1em}small{color:#555}@media print{button{display:none}}</style>
        <button onclick="print()">Print</button><h2>${esc(c.name)}: secret picture PINs</h2><p>Site: ${esc(location.host + location.pathname)}. Cut out the cards. Each child taps their name, then their four pictures in order.</p><div class="grid">${cards}</div>`);
      w.document.close(); },
    setplay(b) {
      const set = setById(b.dataset.set), g = GAME(b.dataset.game); if (!set || !g) return;
      const aid = b.dataset.assign, s = ui.role === 'teacher' ? null : student(), c = cls();
      openDlg(`<div class="phead"><span>${g.icon} ${esc(set.title)}: ${g.title}</span><button class="pill" data-act="closedlg">Close</button></div><div id="game" class="gamebox"></div><span></span>`, 'player');
      stopGame = SkyGames.startSet(g.id, $('#game'), set, aid && s && c ? (score, total) => saveScore(c, aid, s, score, total) : null);
    },
    editset(b) {
      const set = b.dataset.set ? setById(b.dataset.set) : null;
      openDlg(`<form data-form="set" class="form"><h2 class="h">${set ? 'Edit question set' : 'New question set'}</h2><input type="hidden" name="id" value="${set ? esc(set.id) : ''}">
        <label class="wide">Title<input name="title" maxlength="60" required value="${set ? esc(set.title) : ''}" placeholder="Week 3 spelling"></label>
        <label class="wide">One per line<textarea name="text" rows="12" required placeholder="cat&#10;dog&#10;A pet that says moo | cow&#10;What is 3 + 4? | 7">${set ? esc(C.setText(set)) : ''}</textarea></label>
        <p class="hint wide">Write a word on its own for spelling, or <b>question | answer</b> for flashcards and quizzes. A quiz needs at least two different answers. Spelling uses the answer when there is one, so <b>A pet that says moo | cow</b> asks the child to spell cow.</p>
        <button class="btn">Save set</button><button type="button" class="pill" data-act="closedlg">Cancel</button></form>`);
    },
    delset(b) { const set = setById(b.dataset.set); if (set && confirm(`Delete "${set.title}"? Practice already assigned from it will be removed too.`)) { state.sets = state.sets.filter(x => x !== set); state = C.normalize(state); save(); render(); } },
    assign(b) {
      const set = setById(b.dataset.set), c = cls(); if (!set || !c) return;
      openDlg(`<form data-form="assign" class="form"><h2 class="h">Assign "${esc(set.title)}" to ${esc(c.name)}</h2><input type="hidden" name="set" value="${esc(set.id)}">
        <fieldset class="wide gamepick"><legend>Game</legend>${C.setGames(set).map((g, i) => `<label class="check"><input type="radio" name="game" value="${g}" ${i ? '' : 'checked'}> ${GAME(g).icon} ${GAME(g).title}</label>`).join('')}</fieldset>
        <label>Due date (optional)<input type="date" name="due"></label>
        <p class="hint wide">Students see it under Practice. At home they need their family code; scores come back to you after they play.</p>
        <button class="btn">Assign</button><button type="button" class="pill" data-act="closedlg">Cancel</button></form>`);
    },
    unassign(b) { const c = cls(); if (confirm('Remove this assignment and its scores from the class?')) { c.assign = c.assign.filter(a => a.id !== b.dataset.id); delete c.results[b.dataset.id]; save(); render(); } },
    results(b) {
      const c = cls(), a = c.assign.find(x => x.id === b.dataset.id); if (!a) return;
      const rows = c.students.map(s => [s, resultFor(c, a.id, s.id)]).sort((x, y) => (y[1] ? pct(y[1]) + 1 : 0) - (x[1] ? pct(x[1]) + 1 : 0));
      const played = rows.filter(r => r[1]), avg = played.length ? Math.round(played.reduce((n, r) => n + pct(r[1]), 0) / played.length) : null;
      openDlg(`<div class="phead"><span>${GAME(a.game).icon} ${esc(setById(a.setId).title)}: ${GAME(a.game).title}</span><button class="pill" data-act="closedlg">Close</button></div>
        <p>${played.length} of ${c.students.length} played${avg === null ? '' : `, class average ${avg}%`}.</p>
        <div class="rows">${rows.map(([s, r]) => `<div class="row">${avatar(s)}<span class="nm">${esc(s.name)}</span>${r ? `<span class="meter sm"><i style="width:${pct(r)}%"></i></span><span class="done ${pct(r) >= 80 ? 'ok' : ''}">${r.best}/${r.total}</span><small>${r.tries} ${r.tries === 1 ? 'try' : 'tries'}</small>` : '<span class="done new">Not yet</span>'}</div>`).join('')}</div>`);
    },
    async refresh() { await loadExtras(); render(); toast('Scores refreshed.'); },
    print(b) {
      const set = setById(b.dataset.set), w = set && window.open('', '_blank'); if (!w) return toast('Allow pop-ups for this site to print worksheets.');
      const items = set.items.slice(0, 40), spell = items.map(C.spellTarget);
      const line = (it, i) => it.a ? `<li>${esc(it.q)}<span class="blank"></span></li>` : spell[i] ? `<li><span class="mix">${esc(SkyGames.scramble(spell[i]).toUpperCase().split('').join(' '))}</span><span class="blank"></span></li>` : `<li>${esc(it.q)}<span class="blank long"></span></li>`;
      w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(set.title)}</title><style>body{font:17px/1.6 system-ui,sans-serif;margin:2cm;color:#111}h1{font-size:26px;margin:0 0 4px}.meta{display:flex;gap:3em;margin:10px 0 24px}li{margin:14px 0}.blank{display:inline-block;border-bottom:1.5px solid #333;min-width:9em;margin-left:1em}.blank.long{display:block;min-width:100%;margin:22px 0 0}.mix{letter-spacing:.15em;font-weight:700}.key{page-break-before:always}.key li{margin:4px 0}@media print{button{display:none}}</style>
        <button onclick="print()">Print</button><h1>${esc(set.title)}</h1><div class="meta"><span>Name: ________________</span><span>Date: ____________</span></div>
        <p>${items.some(it => it.a) ? 'Write the answer on the line.' : 'Unscramble each word and write it on the line.'}</p><ol>${items.map(line).join('')}</ol>
        <section class="key"><h1>Answer key</h1><ol>${items.map((it, i) => `<li>${esc(it.a || spell[i] || it.q)}</li>`).join('')}</ol></section>`);
      w.document.close();
    },
    kiosk() { paintKiosk(); },
    kioskpick(b) { const c = cls(), s = c.students.find(x => x.id === b.dataset.sid); if (!s) return;
      openDlg(`<div class="phead"><span>Morning check-in</span><button class="pill" data-act="kiosk">Back</button></div><div class="slide"><span class="big">${ANIMALS[hash(s.name) % ANIMALS.length]}</span><h2>Hi ${esc(s.name.split(' ')[0])}! How are you feeling?</h2>
        <div class="moods big">${[5, 4, 3, 2, 1].map(v => `<button data-act="kioskmood" data-sid="${esc(s.id)}" data-v="${v}"><span>${C.MOODS[v][0]}</span>${C.MOODS[v][1]}</button>`).join('')}</div></div><span></span>`, 'player'); },
    kioskmood(b) { const c = cls(), day = C.today(); (c.checkin[day] = c.checkin[day] || {})[b.dataset.sid] = +b.dataset.v; save(); tone(); render(); paintKiosk(); },
    mood(b) { checkIn(+b.dataset.v); },
    moodagain() { const c = cls(), s = student(), day = C.today(); if (c.checkin[day]) delete c.checkin[day][s.id]; delete cloud.moods[`${c.id}|${s.id}|${day}`]; render(); },
    race(b) {
      const c = cls(), r = c.race = raceOf(c), t = r.teams[+b.dataset.i]; if (!t) return;
      const before = t.score; t.score = Math.max(0, Math.min(9999, t.score + +b.dataset.d));
      if (before < r.target && t.score >= r.target) { party(); toast(`${t.name} reached the planet!`); }
      save(); const box = $('#race'); if (box) box.outerHTML = raceHTML(c); if (+b.dataset.d > 0) burst($(`#race .lane:nth-child(${+b.dataset.i + 1}) .rk`), '✨');
    },
    racereset() { const c = cls(); c.race = raceOf(c); c.race.teams.forEach(t => { t.score = 0; }); save(); $('#race').outerHTML = raceHTML(c); },
    raceask() { const set = setById($('#raceset').value); if (!set) return; const it = set.items[Math.floor(Math.random() * set.items.length)];
      $('#raceout').innerHTML = `<p class="g-clue">${esc(it.q)}</p>${it.a ? `<button class="pill" data-act="racereveal" data-a="${esc(it.a)}">Show answer</button>` : ''}`; },
    racereveal(b) { b.outerHTML = `<p class="answer">${esc(b.dataset.a)}</p>`; },
    copycode(b) { navigator.clipboard.writeText(b.dataset.code).then(() => toast('Code copied.'), () => toast('Copy did not work. Select the code and copy it by hand.')); },
  };

  /* ---------- online: teacher account, saving, family codes ---------- */
  function setStatus(t) { cloud.status = t; const el = $('#sync'); if (el) el.textContent = t; }
  const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), b => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
  // Mission stars earned at home become class points on the teacher's device, once each.
  function creditAll() { let n = 0; for (const c of state.classes) n += C.creditStars(c, state.packs, getRes(c)); if (n) save(); return n; }
  async function loadExtras() {
    if (!cloud.user) return;
    const since = C.today(new Date(Date.now() - 14 * 864e5));
    const [r, m] = await Promise.all([sb.from('sky_results').select('class_id,student_id,assign_id,best,total,tries,updated_at'), sb.from('sky_checkins').select('class_id,student_id,day,mood').gte('day', since)]);
    cloud.res = {}; (r.data || []).forEach(x => { cloud.res[`${x.class_id}|${x.student_id}|${x.assign_id}`] = { best: x.best, total: x.total, tries: x.tries, t: Date.parse(x.updated_at) || 0 }; });
    cloud.moods = {}; (m.data || []).forEach(x => { cloud.moods[`${x.class_id}|${x.student_id}|${x.day}`] = x.mood; });
  }
  async function saveScore(c, aid, s, score, total, quiet) {
    if (fam) {
      const { data } = await sb.rpc('sky_family_play', { p_code: famCode, p_assign: aid, p_score: score, p_total: total });
      if (!data) return toast('Your score could not be sent. Check your connection and play again.');
    }
    C.recordResult(c, aid, s.id, score, total); if (!fam) save(); render(); if (!quiet) toast(fam ? 'Score sent to your teacher.' : 'Score saved.');
  }
  async function checkIn(v) {
    const c = cls(), s = student(), day = C.today(); if (!c || !s) return;
    if (fam) { const { data } = await sb.rpc('sky_family_checkin', { p_code: famCode, p_day: day, p_mood: v }); if (!data) return toast('Your check-in could not be sent. Try again.'); }
    (c.checkin[day] = c.checkin[day] || {})[s.id] = v; if (!fam) save(); render(); toast('Thanks for checking in!');
  }
  function paintKiosk() {
    const c = cls(), day = C.today();
    openDlg(`<div class="phead"><span>Morning check-in: tap your name</span><button class="pill" data-act="closedlg">Done</button></div>
      <div class="cards kiosk">${c.students.map(s => { const m = moodOf(c, s.id, day); return `<div class="card"><button class="give${m ? ' did' : ''}" data-act="kioskpick" data-sid="${esc(s.id)}">${avatar(s)}<span class="nm">${esc(s.name)}</span>${m ? `<span class="mood">${C.MOODS[m][0]}</span>` : ''}</button></div>`; }).join('')}</div><span></span>`, 'player');
  }
  function tone() { try { const a = new (window.AudioContext || window.webkitAudioContext)(), o = a.createOscillator(), g = a.createGain(); o.frequency.value = 784; g.gain.value = .12; o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + .15); } catch { /* sound is optional */ } }
  async function loadCodes() { const { data } = await sb.from('sky_codes').select('code,class_id,student_id'); cloud.codes = data || []; }
  async function push() {
    if (!cloud.user) return;
    const { data, error } = await sb.rpc('sky_save', { p_state: state, p_rev: cloud.rev });
    if (error) return setStatus('Not saved online yet. Your changes are safe on this device.');
    // shortcut: no merging. If another device saved first, its copy wins. Upgrade if two teachers ever edit one school at once.
    if (data === null) { toast('This school was changed on another device. Loading that version.'); return pull(true); }
    cloud.rev = ui.rev = data; ui.dirty = false; ui.owner = cloud.user.id; saveLocal(); setStatus('Saved online');
  }
  async function pull(force) {
    const { data, error } = await sb.from('sky_schools').select('state,rev').maybeSingle();
    if (error) return setStatus('Could not reach online storage. Working from this device.');
    if (!data) { cloud.rev = 0; return push(); } // first sign-in: this device becomes the online copy
    if (!force && ui.owner !== cloud.user.id && state.classes.length && !confirm('This account already has classes saved online. Replace the classes on this device with them? Cancel keeps this device as it is and signs you out.')) return acts.signout();
    state = C.normalize(data.state); cloud.rev = ui.rev = data.rev; ui.dirty = false; ui.owner = cloud.user.id; last = null; saveLocal(); setStatus('Saved online'); render();
  }
  async function startSync(user) {
    cloud.user = user;
    if (ui.owner === user.id && ui.dirty) { cloud.rev = ui.rev || 0; await push(); } else await pull(); // unsent edits from this device go up first
    if (cloud.user) { await loadCodes(); await loadExtras(); await loadLogins(); creditAll(); }
    render();
  }
  async function signIn(f, create) {
    if (!f.reportValidity()) return;
    const cred = { email: f.email.value.trim(), password: f.password.value };
    const { data, error } = create ? await sb.auth.signUp({ ...cred, options: { emailRedirectTo: location.origin + location.pathname } }) : await sb.auth.signInWithPassword(cred);
    if (error) return toast(error.message);
    if (!data.session) return toast('Account created. Open the confirmation email, then sign in here.');
    await startSync(data.session.user); toast('Signed in.');
  }
  // keep=false leaves the code in memory only, so a shared computer forgets it when the page closes.
  async function openFamily(code, quiet, keep = true) {
    const { data, error } = await sb.rpc('sky_family_view', { p_code: code });
    if (error) { if (!quiet) toast('Could not reach the class. Check your connection and try again.'); return; }
    if (data) {
      const sid = data.student && data.student.id, results = {}, checkin = {};
      for (const a of data.assign || []) { const r = C.mergeResult(data.localResults && data.localResults[a.id], data.homeResults && data.homeResults[a.id]); if (r) results[a.id] = { [sid]: r }; }
      for (const src of [data.localCheckins || {}, data.homeCheckins || {}]) for (const [d, v] of Object.entries(src)) if (v) checkin[d] = { [sid]: v };
      fam = C.normalize({ classes: [{ ...data.class, students: [data.student], assign: data.assign, results, checkin, credit: data.credit }], lessons: data.lessons, lib: data.lib, sets: data.sets, packs: data.packs });
      if (fam.classes[0]) C.creditStars(fam.classes[0], fam.packs, (aid, s) => (fam.classes[0].results[aid] || {})[s]); // shows stars the teacher's device has not collected yet
    }
    if (!data || !fam.classes[0] || !fam.classes[0].students[0]) { ui.code = null; fam = null; famCode = null; saveLocal(); render(); return toast('That code did not work. Check it with your teacher.'); }
    fam.classes[0].total = data.class.total; famCode = code; ui.code = keep ? code : null; saveLocal(); render();
  }
  function afterAward(c) { const won = C.classTotal(c) >= c.goal.target; if (won && !wonAt[c.id]) { party(); toast(`Goal reached: ${c.goal.reward}!`); } wonAt[c.id] = won; save(); refreshSky(c); const u = app.querySelector('[data-act="undo"]'); if (u) u.disabled = !last; }

  const forms = {
    post(f) { const c = cls(); c.posts.push({ id: C.uid(), kind: f.kind.value, text: f.text.value, due: f.kind.value === 'homework' ? f.due.value : '', t: Date.now() }); state = C.normalize(state); toast('Posted.'); },
    goal(f) { const c = cls(); c.goal = { target: +f.target.value, reward: f.reward.value }; state = C.normalize(state); closeDlg(); },
    lesson(f) { const l = C.parseLessonText(f.title.value, f.subject.value, f.text.value); if (!l) return toast('Write at least one slide.'), false; state.lessons.push(l); closeDlg(); toast('Lesson saved.'); },
    link(f) { const l = C.cleanLink({ title: f.title.value, url: f.url.value }); if (!l) return toast('That address does not look right. Try something like website.com.'), false; state.links.push(l); },
    rename(f) { cls().name = C.clip(f.name.value, 40) || cls().name; },
    addstudents(f) { const c = cls(), have = new Set(c.students.map(s => s.name.toLowerCase())), names = C.parseNames(f.names.value).filter(n => !have.has(n.toLowerCase())); if (!names.length) return toast('Type at least one new name.'), false; c.students.push(...names.map(n => C.newStudent(n))); toast(`Added ${names.length} student${names.length === 1 ? '' : 's'}.`); },
    newclass(f) { const c = C.newClass(f.name.value, C.parseNames(f.names.value)); state.classes.push(c); state.activeClass = c.id; if (c.students.length) ui.tab = 'board'; toast(`${c.name} created.`); },
    signin(f) { signIn(f, false); return false; },
    pack(f) {
      const id = f.id.value || undefined, p = C.parsePack(f.text.value, id); if (!p) return toast('A mission needs at least a story or some words.'), false;
      const i = state.packs.findIndex(x => x.id === p.id); if (i >= 0) state.packs[i] = p; else state.packs.push(p);
      state = C.normalize(state); closeDlg(); toast(`Saved "${p.title}". Press Start for your class when you are ready.`);
    },
    classlogin(f) { openRoster(f.code.value); return false; },
    set(f) {
      const id = f.id.value || undefined, set = C.parseSetText(f.title.value, f.text.value, id); if (!set) return toast('Write at least one line.'), false;
      const i = state.sets.findIndex(x => x.id === id); if (i >= 0) state.sets[i] = set; else state.sets.push(set);
      state = C.normalize(state); closeDlg(); toast(`Saved "${set.title}" with ${set.items.length} items.`);
    },
    assign(f) { const c = cls(); c.assign.push({ id: C.uid(), setId: f.set.value, game: f.game.value, due: f.due.value, t: Date.now() }); state = C.normalize(state); closeDlg(); toast('Assigned. Students will see it under Practice.'); },
    race(f) { const c = cls(), old = raceOf(c), names = f.names.value.split(',').map(x => x.trim()).filter(Boolean).slice(0, 6);
      if (names.length < 2) return toast('Write at least two team names, separated by commas.'), false;
      c.race = { teams: names.map(n => ({ name: n, score: (old.teams.find(t => t.name === n) || {}).score || 0 })), target: +f.target.value }; state = C.normalize(state); toast('Teams saved.'); },
    librepo(f) { libSync(f.repo.value); return false; },
    libdrive(f) { const id = C.driveId(f.drive.value); if (f.drive.value.trim() && !id) return toast('That does not look like a Drive folder link. Copy it from the folder\'s Share button.'), false; state.lib.drive = id; toast(id ? 'Drive folder saved.' : 'Drive folder removed.'); },
    famcode(f) { openFamily(f.code.value.trim().toUpperCase(), false, f.keep.checked); return false; },
    groups(f) { const c = cls(), g = C.makeGroups(wheelPool(c).map(s => s.name), +f.n.value); $('#groupsout').innerHTML = g.map((m, i) => `<div style="--h:${i * 55 % 360}"><b>Group ${i + 1}</b>${m.map(esc).join('<br>')}</div>`).join(''); return false; },
  };

  document.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b && !b.disabled && acts[b.dataset.act]) acts[b.dataset.act](b); });
  document.addEventListener('submit', e => { const f = e.target, h = forms[f.dataset.form]; if (!h) return; e.preventDefault(); if (h(f) !== false) { save(); render(); } });
  document.addEventListener('change', e => { if (e.target.dataset.change === 'class') { state.activeClass = e.target.value; ui.who = ui.role === 'teacher' ? ui.who : null; last = null; save(); render(); } });
  document.addEventListener('keydown', e => { if (!player || e.target.closest('input,textarea')) return; if (e.key === 'ArrowRight' && player.i < player.lesson.slides.length) acts.pnext(); if (e.key === 'ArrowLeft') acts.pprev(); });
  dlg.addEventListener('close', () => { endGame(); player = null; });
  dlg.addEventListener('click', e => { if (e.target === dlg && !dlg.classList.contains('player')) closeDlg(); });
  render();
  // While a teacher is signed in, stars earned on iPads and at home reach the board within a minute.
  setInterval(async () => { if (!cloud.user || ui.role !== 'teacher' || document.hidden) return; await loadExtras(); if (creditAll() && !dlg.open) render(); }, 60000);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { /* works without offline support */ });
  if (sb) {
    sb.auth.getSession().then(({ data }) => { if (data.session) startSync(data.session.user); });
    if (ui.code && ui.role && ui.role !== 'teacher') openFamily(ui.code, true);
  }
})();
