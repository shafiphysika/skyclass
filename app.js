(function () {
  'use strict';
  const C = SkyCore, KEY = 'skyclass-v1', UIKEY = 'skyclass-ui';
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const top = $('#top'), app = $('#app'), tabs = $('#tabs'), dlg = $('#dlg'), fx = $('#fx');

  let state, ui = { role: null, tab: 'board', who: null, skill: 'help' };
  try { state = C.normalize(JSON.parse(localStorage.getItem(KEY))); } catch { state = C.emptyState(); }
  try { Object.assign(ui, JSON.parse(localStorage.getItem(UIKEY)) || {}); } catch { /* first visit */ }
  let last = null, wheelUsed = {}, wheelRot = 0, wheelPick = null, player = null;
  const timer = { left: 300, total: 300, end: 0, tick: null };

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); localStorage.setItem(UIKEY, JSON.stringify(ui)); }
    catch { toast('This device is out of storage. Download a backup from Classes now.'); }
  }
  const cls = () => state.classes.find(c => c.id === state.activeClass) || null;
  const student = () => { const c = cls(); return c ? c.students.find(s => s.id === ui.who) || null : null; };
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
  function openDlg(html, kind = '') { dlg.className = kind; dlg.innerHTML = html; if (!dlg.open) dlg.showModal(); }
  function closeDlg() { if (dlg.open) dlg.close(); player = null; }

  /* ---------- shared pieces ---------- */
  const CLOUDS = '<i class="cloud c1"></i><i class="cloud c2"></i><i class="cloud c3"></i>';
  const KITE = '<svg viewBox="0 0 60 90" width="60" height="90"><path d="M30 2 56 34 30 66 4 34Z" fill="#ff5d8f"/><path d="M30 2 56 34 30 34Z" fill="#ffc93c"/><path d="M30 34 30 66 4 34Z" fill="#3aa0ff"/><path class="tail" d="M30 66q-8 6 0 12t0 12" fill="none" stroke="#1b2a5c" stroke-width="2" stroke-linecap="round"/></svg>';
  const stringPath = lift => { const x = 30 + lift * 45 + 3, y = 70 - lift * 58 + 14; return `M6,100 Q${x * .45},${y + 34} ${x},${y}`; };
  function skyText(c) {
    const total = C.classTotal(c), g = c.goal;
    return total >= g.target ? `<h2>Goal reached: ${esc(g.reward)}!</h2><p>${total} stars together. Set the next goal when you are ready.</p>`
      : `<h2>${g.target - total} stars to ${esc(g.reward)}</h2><p>${esc(c.name)} has ${total} of ${g.target} stars. Every star lifts the kite.</p>`;
  }
  function skyHTML(c, canEdit) {
    const lift = Math.min(1, C.classTotal(c) / c.goal.target);
    return `<section class="sky" id="sky" style="--lift:${lift}">${CLOUDS}
      <svg class="string" viewBox="0 0 100 100" preserveAspectRatio="none"><path id="kstring" d="${stringPath(lift)}"/></svg>
      <div class="kite">${KITE}</div><div class="skytext" id="skytext">${skyText(c)}</div>
      ${canEdit ? '<button class="pill" data-act="goal">Change goal</button>' : ''}</section>`;
  }
  function refreshSky(c) {
    const sky = $('#sky'); if (!sky) return;
    const lift = Math.min(1, C.classTotal(c) / c.goal.target);
    sky.style.setProperty('--lift', lift); $('#kstring').setAttribute('d', stringPath(lift)); $('#skytext').innerHTML = skyText(c);
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
    teacher: [['board', '⭐', 'Points'], ['attend', '✅', 'Attendance'], ['lessons', '📖', 'Lessons'], ['tools', '🎡', 'Tools'], ['sites', '🧭', 'Fun sites'], ['news', '📣', 'News'], ['setup', '⚙️', 'Classes']],
    student: [['me', '🌟', 'My stars'], ['lessons', '📖', 'Lessons'], ['news', '📝', 'Homework']],
    parent: [],
  };
  function render() {
    document.body.dataset.role = ui.role || 'home';
    if (!ui.role) { top.innerHTML = tabs.innerHTML = ''; app.innerHTML = homeHTML(); return; }
    const list = TABS[ui.role]; if (list.length && !list.some(t => t[0] === ui.tab)) ui.tab = list[0][0];
    const picker = ui.role === 'teacher' && state.classes.length ? `<label class="pick"><span class="sr">Class</span><select data-change="class">${state.classes.map(c => `<option value="${esc(c.id)}" ${c.id === state.activeClass ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>` : '';
    top.innerHTML = `<button class="brand" data-act="home">🪁 Skyclass</button>${picker}<button class="pill" data-act="home">Switch view</button>`;
    tabs.innerHTML = list.map(([id, ic, label]) => `<button data-act="tab" data-tab="${id}" ${ui.tab === id ? 'aria-current="page"' : ''}><span>${ic}</span>${label}</button>`).join('');
    app.innerHTML = ui.role === 'teacher' ? teacherHTML() : ui.role === 'student' ? studentHTML() : parentHTML();
    if (ui.role === 'teacher' && ui.tab === 'tools') paintTimer();
  }
  function homeHTML() {
    return `<section class="hero sky" style="--lift:.95">${CLOUDS}
      <svg class="string" viewBox="0 0 100 100" preserveAspectRatio="none"><path d="${stringPath(.95)}"/></svg><div class="kite">${KITE}</div>
      <div class="herotext"><h1>Skyclass</h1><p>Stars, lessons and classroom games for the whole school day. Who is here?</p></div>
      <div class="doors">
        <button data-act="enter" data-role="teacher"><span>🧑‍🏫</span><b>Teacher</b><small>Run the class</small></button>
        <button data-act="enter" data-role="student"><span>🎒</span><b>Student</b><small>See my stars and play lessons</small></button>
        <button data-act="enter" data-role="parent"><span>👪</span><b>Parent</b><small>See how my child is doing</small></button>
      </div><p class="devnote">Everything is saved on this device only.</p></section>`;
  }

  /* ---------- teacher ---------- */
  function teacherHTML() {
    const c = cls();
    if (ui.tab === 'setup' || (!c && ui.tab !== 'sites' && ui.tab !== 'lessons')) return setupHTML(c);
    if (ui.tab === 'sites') return sitesHTML();
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
      <div class="cards">${c.students.map(s => `<div class="card" data-sid="${esc(s.id)}">
        <button class="give" data-act="give" data-sid="${esc(s.id)}" aria-label="Give ${esc(s.name)} a star">${avatar(s)}<span class="nm">${esc(s.name)}</span><span class="pts">${s.points}</span></button>
        <button class="minus" data-act="take" data-sid="${esc(s.id)}" aria-label="Take 1 star from ${esc(s.name)}">−</button></div>`).join('')}</div>`;
  }
  function attendHTML(c) {
    const day = C.today(), rec = c.attendance[day] || {};
    const n = v => c.students.filter(s => rec[s.id] === v).length;
    return `<h2 class="h">Attendance, ${niceDate(Date.now())}</h2>
      <div class="bar"><p><b>${n('p')}</b> present, <b>${n('l')}</b> late, <b>${n('a')}</b> away, <b>${c.students.length - n('p') - n('l') - n('a')}</b> not marked</p><button class="pill" data-act="allhere">Mark everyone present</button></div>
      <div class="rows">${c.students.map(s => `<div class="row">${avatar(s)}<span class="nm">${esc(s.name)}</span><span class="seg">
        ${[['p', 'Present'], ['l', 'Late'], ['a', 'Away']].map(([v, l]) => `<button data-act="mark" data-sid="${esc(s.id)}" data-v="${v}" class="m-${v}" aria-pressed="${rec[s.id] === v}">${l}</button>`).join('')}</span></div>`).join('')}</div>`;
  }
  function lessonsHTML(teacher) {
    return `<div class="bar"><h2 class="h">${teacher ? 'Interactive lessons' : 'Play a lesson'}</h2>${teacher ? '<button class="btn" data-act="newlesson">Write a lesson</button>' : ''}</div>
      <div class="lessons">${state.lessons.map(l => { const q = l.slides.filter(s => s.type !== 'info').length; return `<article class="lesson" style="--h:${hash(l.title) % 360}">
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
      <section class="panel"><h2 class="h">Dice</h2><div id="dice" class="dice"><span>⚄</span><span>⚂</span></div><button class="btn" data-act="roll">Roll</button></section></div>`;
  }
  function wheelPool(c) { const rec = c.attendance[C.today()] || {}; return c.students.filter(s => rec[s.id] !== 'a'); }
  function wheelHTML(c) {
    const pool = wheelPool(c), n = pool.length, a = 360 / Math.max(n, 1), pt = d => { const r = d * Math.PI / 180; return (100 + 96 * Math.sin(r)).toFixed(2) + ',' + (100 - 96 * Math.cos(r)).toFixed(2); };
    const fs = Math.max(4.5, Math.min(11, 150 / Math.max(n, 6)));
    const seg = pool.map((s, i) => `${n === 1 ? '<circle cx="100" cy="100" r="96"' : `<path d="M100,100 L${pt(i * a)} A96,96 0 0 1 ${pt((i + 1) * a)}Z"`} fill="hsl(${(i * 47 + 200) % 360} 85% ${i % 2 ? 68 : 60}%)"/>
      <text x="188" y="100" text-anchor="end" dominant-baseline="middle" font-size="${fs}" transform="rotate(${(i + .5) * a - 90} 100 100)">${esc(s.name.slice(0, 14))}</text>`).join('');
    return `<div class="wheelwrap"><i class="pointer"></i><svg id="wheel" class="wheel" viewBox="0 0 200 200" style="transform:rotate(${wheelRot}deg)" data-act="spin" role="img" aria-label="Name wheel">${seg}<circle cx="100" cy="100" r="12" fill="#fff" stroke="#1b2a5c" stroke-width="3"/></svg></div>`;
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
        <div class="chips"><button class="btn" data-act="backup">Download backup</button><button class="pill" data-act="restore">Restore a backup</button></div></section>`;
  }

  /* ---------- student and parent ---------- */
  function whoHTML(title) {
    if (!state.classes.length) return '<p class="empty">Your teacher has not set up a class on this device yet.</p>';
    const c = cls();
    return `<h2 class="h">${title}</h2><label class="pick block">Class <select data-change="class">${state.classes.map(k => `<option value="${esc(k.id)}" ${k.id === c.id ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}</select></label>
      <div class="cards">${c.students.map(s => `<div class="card"><button class="give" data-act="who" data-sid="${esc(s.id)}">${avatar(s)}<span class="nm">${esc(s.name)}</span></button></div>`).join('') || '<p class="empty">No students in this class yet.</p>'}</div>`;
  }
  function studentHTML() {
    const c = cls(), s = student();
    if (!s) return whoHTML('Tap your name');
    if (ui.tab === 'lessons') return lessonsHTML(false);
    if (ui.tab === 'news') return `<h2 class="h">Homework and news</h2><div class="posts">${postsHTML(c, false)}</div>`;
    const next = C.nextBadge(s.points), prev = C.badgesFor(s.points).pop(), base = prev ? prev.at : 0;
    return `<section class="mecard">${avatar(s)}<div><h2>${esc(s.name)}</h2><p class="bigpts"><b>${s.points}</b> stars</p>
        ${next ? `<div class="meter"><i style="width:${Math.round((s.points - base) / (next.at - base) * 100)}%"></i></div><p>${next.at - s.points} more to become a ${next.icon} ${next.label}</p>` : '<p>You have every badge. Sky captain!</p>'}</div>
        <button class="pill" data-act="notme">Not me</button></section>
      <div class="badges">${badgesHTML(s.points)}</div>${skyHTML(c, false)}
      <h3 class="h">Why I got stars</h3>${logHTML(s, 8)}`;
  }
  const logHTML = (s, n) => s.log.length ? `<ul class="log">${s.log.slice(-n).reverse().map(l => `<li><b class="${l.d < 0 ? 'neg' : ''}">${l.d > 0 ? '+' : ''}${l.d}</b> ${esc(l.r || 'Star')} <small>${niceDate(l.t)}</small></li>`).join('')}</ul>` : '<p class="empty">No stars yet. The first one is coming.</p>';
  function parentHTML() {
    const c = cls(), s = student();
    if (!s) return whoHTML('Choose your child');
    const rate = C.attendanceRate(c, s.id), today = (c.attendance[C.today()] || {})[s.id];
    return `<section class="mecard">${avatar(s)}<div><h2>${esc(s.name)}</h2><p>${esc(c.name)}</p></div><button class="pill" data-act="notme">Choose another child</button></section>
      <div class="stats"><div><b>${s.points}</b>stars earned</div><div><b>${rate === null ? 'n/a' : rate + '%'}</b>${rate === null ? 'no attendance recorded yet' : 'attendance'}</div>
        <div><b>${today ? { p: 'Present', l: 'Late', a: 'Away' }[today] : 'n/a'}</b>today</div></div>
      <div class="badges">${badgesHTML(s.points)}</div>
      <div class="two"><section><h3 class="h">Recent stars</h3>${logHTML(s, 12)}</section><section><h3 class="h">Homework and news</h3><div class="posts">${postsHTML(c, false)}</div></section></div>`;
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
    home() { ui.role = null; render(); },
    enter(b) { ui.role = b.dataset.role; ui.tab = TABS[ui.role][0] ? TABS[ui.role][0][0] : ''; if (ui.role !== 'teacher') ui.who = null; if (!cls() && state.classes[0]) state.activeClass = state.classes[0].id; save(); render(); },
    tab(b) { ui.tab = b.dataset.tab; save(); render(); scrollTo(0, 0); },
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
    play(b) { const lesson = state.lessons.find(l => l.id === b.dataset.id); if (lesson) { player = { lesson, i: 0, answers: {}, votes: {}, teacher: ui.role === 'teacher' }; paintPlayer(); } },
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
    notme() { ui.who = null; save(); render(); },
  };
  function afterAward(c) { save(); refreshSky(c); const u = app.querySelector('[data-act="undo"]'); if (u) u.disabled = !last; }

  const forms = {
    post(f) { const c = cls(); c.posts.push({ id: C.uid(), kind: f.kind.value, text: f.text.value, due: f.kind.value === 'homework' ? f.due.value : '', t: Date.now() }); state = C.normalize(state); toast('Posted.'); },
    goal(f) { const c = cls(); c.goal = { target: +f.target.value, reward: f.reward.value }; state = C.normalize(state); closeDlg(); },
    lesson(f) { const l = C.parseLessonText(f.title.value, f.subject.value, f.text.value); if (!l) return toast('Write at least one slide.'), false; state.lessons.push(l); closeDlg(); toast('Lesson saved.'); },
    link(f) { const l = C.cleanLink({ title: f.title.value, url: f.url.value }); if (!l) return toast('That address does not look right. Try something like website.com.'), false; state.links.push(l); },
    rename(f) { cls().name = C.clip(f.name.value, 40) || cls().name; },
    addstudents(f) { const c = cls(), have = new Set(c.students.map(s => s.name.toLowerCase())), names = C.parseNames(f.names.value).filter(n => !have.has(n.toLowerCase())); if (!names.length) return toast('Type at least one new name.'), false; c.students.push(...names.map(n => C.newStudent(n))); toast(`Added ${names.length} student${names.length === 1 ? '' : 's'}.`); },
    newclass(f) { const c = C.newClass(f.name.value, C.parseNames(f.names.value)); state.classes.push(c); state.activeClass = c.id; if (c.students.length) ui.tab = 'board'; toast(`${c.name} created.`); },
    groups(f) { const c = cls(), g = C.makeGroups(wheelPool(c).map(s => s.name), +f.n.value); $('#groupsout').innerHTML = g.map((m, i) => `<div style="--h:${i * 55 % 360}"><b>Group ${i + 1}</b>${m.map(esc).join('<br>')}</div>`).join(''); return false; },
  };

  document.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b && !b.disabled && acts[b.dataset.act]) acts[b.dataset.act](b); });
  document.addEventListener('submit', e => { const f = e.target, h = forms[f.dataset.form]; if (!h) return; e.preventDefault(); if (h(f) !== false) { save(); render(); } });
  document.addEventListener('change', e => { if (e.target.dataset.change === 'class') { state.activeClass = e.target.value; ui.who = ui.role === 'teacher' ? ui.who : null; last = null; save(); render(); } });
  document.addEventListener('keydown', e => { if (!player || e.target.closest('input,textarea')) return; if (e.key === 'ArrowRight' && player.i < player.lesson.slides.length) acts.pnext(); if (e.key === 'ArrowLeft') acts.pprev(); });
  dlg.addEventListener('close', () => { player = null; });
  dlg.addEventListener('click', e => { if (e.target === dlg && !dlg.classList.contains('player')) closeDlg(); });
  render();
})();
