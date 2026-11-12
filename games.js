// Skyclass arcade. Each game draws into one element and returns a stop() that clears its timers.
(function (root) {
  'use strict';
  const shuffle = (a, rand = Math.random) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  // level 1: + and − to 20. level 2: bigger numbers and ×. level 3: × and ÷ to 12. Answers are never negative.
  function mathQ(level, rand = Math.random) {
    const n = m => 1 + Math.floor(rand() * m), ops = level === 1 ? ['+', '−'] : level === 2 ? ['+', '−', '×'] : ['×', '÷', '+', '−'];
    const op = ops[Math.floor(rand() * ops.length)];
    let a, b, answer;
    if (op === '+') { const m = level === 1 ? 10 : 50; a = n(m); b = n(m); answer = a + b; }
    else if (op === '−') { a = n(level === 1 ? 20 : 100); b = n(a); answer = a - b; }
    else if (op === '×') { const m = level === 2 ? 10 : 12; a = n(m); b = n(m); answer = a * b; }
    else { b = n(12); answer = n(12); a = b * answer; }
    const opts = new Set([answer]);
    for (let k = 1; opts.size < 4; k++) opts.add(answer + k * (rand() < .5 && answer - k >= 0 ? -1 : 1));
    return { text: `${a} ${op} ${b}`, answer, options: shuffle([...opts], rand) };
  }
  function scramble(word, rand = Math.random) {
    for (let i = 0; i < 12; i++) { const s = shuffle([...word], rand).join(''); if (s !== word) return s; }
    return word.slice(1) + word[0];
  }

  const WORDS = 'planet,school,friend,garden,animal,bridge,circle,flower,number,orange,pencil,rocket,window,yellow,monkey,castle,dragon,forest,island,jungle,kitten,mirror,ocean,puzzle,rabbit,silver,tiger,violin,winter,zebra,teacher,science,rainbow,holiday,library,morning,picture,weather,kitchen,dolphin'.split(',');
  const FACES = ['🦊', '🐼', '🐸', '🦉', '🐙', '🦄', '🐧', '🦁', '🐢', '🦋', '🐬', '🐝', '🍎', '🚀', '🌈', '⚽'];
  const BEST = 'skyclass-best';
  const best = () => { try { return JSON.parse(localStorage.getItem(BEST)) || {}; } catch { return {}; } };
  function record(g, score) {
    const b = best(), old = b[g.id], isBest = old == null || (g.low ? score < old : score > old);
    if (isBest) { b[g.id] = score; try { localStorage.setItem(BEST, JSON.stringify(b)); } catch { /* scores are a nicety */ } }
    return isBest;
  }
  let ac;
  function tone(freq, ms = 140) {
    try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = freq; g.gain.value = .12; o.connect(g).connect(ac.destination); o.start(); o.stop(ac.currentTime + ms / 1000); } catch { /* sound is optional */ }
  }
  function over(el, g, score, again) {
    const top = record(g, score);
    el.innerHTML = `<div class="g-end"><span class="big">${top ? '🏆' : g.icon}</span><h2>${score} ${g.unit}</h2><p>${top ? 'New best score!' : `Your best is ${best()[g.id]} ${g.unit}.`}</p><button class="btn" data-again>Play again</button></div>`;
    el.onclick = e => { if (e.target.closest('[data-again]')) again(); };
    tone(top ? 880 : 520, 300);
  }
  const frame = (el, body) => { el.innerHTML = `<div class="g-top"><b class="g-score">0</b><div class="g-bar"><i></i></div></div><div class="g-body">${body}</div>`; };
  // Runs a countdown bar; calls end() once when time is up.
  function countdown(el, secs, end) {
    const until = Date.now() + secs * 1000, bar = el.querySelector('.g-bar i');
    const t = setInterval(() => { const left = Math.max(0, until - Date.now()); bar.style.width = left / secs / 10 + '%'; if (!left) { clearInterval(t); end(); } }, 100);
    return () => clearInterval(t);
  }

  const GAMES = [
    { id: 'maths', icon: '🧮', title: 'Maths sprint', blurb: 'How many sums can you solve in 60 seconds?', unit: 'points', hue: 200,
      run(el, g) {
        let stop = () => {};
        const menu = () => {
          el.innerHTML = `<div class="g-end"><span class="big">🧮</span><h2>Pick a level</h2><div class="opts">${['Easy: + and −', 'Medium: bigger numbers and ×', 'Hard: × and ÷'].map((l, i) => `<button data-level="${i + 1}">${l}</button>`).join('')}</div></div>`;
          el.onclick = e => { const b = e.target.closest('[data-level]'); if (b) play(+b.dataset.level); };
        };
        const play = level => {
          let score = 0, streak = 0, q;
          frame(el, '<p class="g-q"></p><div class="opts"></div><p class="hint g-streak"></p>');
          const ask = () => { q = mathQ(level); el.querySelector('.g-q').textContent = q.text + ' = ?'; el.querySelector('.opts').innerHTML = q.options.map(o => `<button data-o="${o}">${o}</button>`).join(''); };
          el.onclick = e => {
            const b = e.target.closest('[data-o]'); if (!b) return;
            if (+b.dataset.o === q.answer) { streak++; score += streak >= 5 ? 2 : 1; tone(660 + streak * 30, 90); el.querySelector('.g-streak').textContent = streak >= 5 ? `${streak} in a row: double points!` : ''; ask(); }
            else { streak = 0; tone(180, 200); b.classList.add('wrong'); b.disabled = true; el.querySelector('.g-streak').textContent = ''; }
            el.querySelector('.g-score').textContent = score;
          };
          ask(); stop = countdown(el, 60, () => over(el, g, score, menu));
        };
        menu(); return () => stop();
      } },
    { id: 'memory', icon: '🃏', title: 'Memory match', blurb: 'Find all eight pairs in as few turns as you can.', unit: 'turns', low: true, hue: 320,
      run(el, g) {
        let t;
        const play = () => {
          const deck = shuffle(shuffle(FACES).slice(0, 8).flatMap(f => [f, f]));
          let open = [], found = 0, turns = 0, lock = false;
          frame(el, `<div class="g-grid">${deck.map((f, i) => `<button class="g-card" data-i="${i}" aria-label="Card ${i + 1}"><span>${f}</span></button>`).join('')}</div>`);
          el.querySelector('.g-bar').hidden = true;
          el.onclick = e => {
            const c = e.target.closest('.g-card'); if (!c || lock || c.classList.contains('up')) return;
            c.classList.add('up'); open.push(c); tone(520, 60); if (open.length < 2) return;
            el.querySelector('.g-score').textContent = ++turns + ' turns';
            const [a, b] = open; open = [];
            if (deck[a.dataset.i] === deck[b.dataset.i]) { a.classList.add('done'); b.classList.add('done'); tone(780, 160); if (++found === 8) t = setTimeout(() => over(el, g, turns, play), 600); }
            else { lock = true; t = setTimeout(() => { a.classList.remove('up'); b.classList.remove('up'); lock = false; }, 800); }
          };
        };
        play(); return () => clearTimeout(t);
      } },
    { id: 'words', icon: '🔤', title: 'Word scramble', blurb: 'Put the letters back in order. 90 seconds on the clock.', unit: 'words', hue: 40,
      run(el, g) {
        let stop = () => {};
        const play = () => {
          const list = shuffle(WORDS); let n = 0, score = 0, word, pool, built;
          frame(el, '<div class="g-row g-built"></div><div class="g-row g-pool"></div><button class="pill" data-skip>Skip this word</button>');
          const draw = () => {
            el.querySelector('.g-built').innerHTML = built.map((p, i) => `<button class="g-tile" data-back="${i}">${pool[p].toUpperCase()}</button>`).join('') + '<i class="g-slot"></i>'.repeat(word.length - built.length);
            el.querySelector('.g-pool').innerHTML = [...pool].map((ch, i) => `<button class="g-tile" data-take="${i}" ${built.includes(i) ? 'disabled' : ''}>${ch.toUpperCase()}</button>`).join('');
          };
          const next = () => { word = list[n++ % list.length]; pool = scramble(word); built = []; draw(); };
          el.onclick = e => {
            const t = e.target.closest('button'); if (!t) return;
            if (t.dataset.take) built.push(+t.dataset.take); else if (t.dataset.back) built.splice(+t.dataset.back, 1); else if ('skip' in t.dataset) return next(); else return;
            if (built.length === word.length) {
              if (built.map(i => pool[i]).join('') === word) { el.querySelector('.g-score').textContent = ++score; tone(780, 160); return next(); }
              tone(180, 200); built = [];
            } else tone(520, 50);
            draw();
          };
          next(); stop = countdown(el, 90, () => over(el, g, score, play));
        };
        play(); return () => stop();
      } },
    { id: 'echo', icon: '🎵', title: 'Colour echo', blurb: 'Watch the pattern, then repeat it. It grows every round.', unit: 'rounds', hue: 140,
      run(el, g) {
        let timers = [];
        const NOTES = [330, 392, 494, 587], wait = (fn, ms) => timers.push(setTimeout(fn, ms));
        const play = () => {
          const seq = []; let at = 0, showing = true;
          frame(el, `<div class="g-pads">${NOTES.map((_, i) => `<button class="g-pad p${i}" data-pad="${i}" aria-label="Pad ${i + 1}"></button>`).join('')}</div><p class="hint g-streak">Watch…</p>`);
          el.querySelector('.g-bar').hidden = true;
          const flash = i => { const p = el.querySelector('.p' + i); if (!p) return; p.classList.add('lit'); tone(NOTES[i], 260); wait(() => p.classList.remove('lit'), 300); };
          const round = () => {
            seq.push(Math.floor(Math.random() * 4)); at = 0; showing = true; el.querySelector('.g-streak').textContent = 'Watch…';
            seq.forEach((p, k) => wait(() => flash(p), 600 + k * 520));
            wait(() => { showing = false; const h = el.querySelector('.g-streak'); if (h) h.textContent = 'Your turn'; }, 600 + seq.length * 520);
          };
          el.onclick = e => {
            const b = e.target.closest('[data-pad]'); if (!b || showing) return;
            flash(+b.dataset.pad);
            if (+b.dataset.pad !== seq[at]) { showing = true; return wait(() => over(el, g, seq.length - 1, play), 500); }
            if (++at === seq.length) { el.querySelector('.g-score').textContent = seq.length + ' rounds'; showing = true; wait(round, 700); }
          };
          round();
        };
        play(); return () => timers.forEach(clearTimeout);
      } },
    { id: 'catch', icon: '🧺', title: 'Star catcher', blurb: 'Slide the basket to catch stars. Dodge the storm clouds.', unit: 'stars', hue: 260,
      run(el, g) {
        let raf, stop = () => {};
        const play = () => {
          frame(el, '<canvas class="g-canvas" width="640" height="420" aria-label="Star catcher game"></canvas><p class="hint">Move your finger or mouse left and right.</p>');
          const cv = el.querySelector('canvas'), cx = cv.getContext('2d'); let x = 320, score = 0, items = [], last = performance.now(), spawn = 0, live = true;
          cv.onpointermove = e => { const r = cv.getBoundingClientRect(); x = (e.clientX - r.left) / r.width * 640; };
          const loop = now => {
            if (!live) return; const dt = Math.min(50, now - last) / 1000; last = now; spawn -= dt;
            if (spawn <= 0) { items.push({ x: 30 + Math.random() * 580, y: -20, v: 150 + Math.random() * 130 + score * 3, bad: Math.random() < .25 }); spawn = .45; }
            cx.clearRect(0, 0, 640, 420); cx.font = '34px serif'; cx.textAlign = 'center';
            items = items.filter(it => {
              it.y += it.v * dt;
              if (it.y > 360 && it.y < 410 && Math.abs(it.x - x) < 46) { score = Math.max(0, score + (it.bad ? -2 : 1)); tone(it.bad ? 160 : 700, 70); el.querySelector('.g-score').textContent = score; return false; }
              cx.fillText(it.bad ? '⛈️' : '⭐', it.x, it.y); return it.y < 450;
            });
            cx.font = '48px serif'; cx.fillText('🧺', x, 405); raf = requestAnimationFrame(loop);
          };
          raf = requestAnimationFrame(loop);
          stop = countdown(el, 40, () => { live = false; over(el, g, score, play); });
        };
        play(); return () => { cancelAnimationFrame(raf); stop(); };
      } },
  ];

  /* Games that run on a teacher's question set. Each calls done(score, total) once at the end. */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function say(text) {
    try { const u = new SpeechSynthesisUtterance(text); u.lang = 'en-US'; u.rate = .85; speechSynthesis.cancel(); speechSynthesis.speak(u); return true; } catch { return false; }
  }
  const canSay = () => typeof speechSynthesis !== 'undefined';
  function finish(el, icon, score, total, again, done) {
    const pct = total ? Math.round(score / total * 100) : 0;
    el.innerHTML = `<div class="g-end"><span class="big">${pct >= 80 ? '🏆' : pct >= 50 ? '🚀' : icon}</span><h2>${score} of ${total}</h2><p>${pct >= 80 ? 'Mission accomplished!' : pct >= 50 ? 'Good flying. Try again to beat it.' : 'Keep practising, cadet.'}</p><button class="btn" data-again>Play again</button></div>`;
    el.onclick = e => { if (e.target.closest('[data-again]')) again(); };
    tone(pct >= 80 ? 880 : 520, 300);
    if (done) done(score, total);
  }
  const ROUND = 10;
  const SET_GAMES = [
    { id: 'flash', icon: '🃏', title: 'Flashcards', blurb: 'Flip each card. Say the answer before you look.',
      run(el, set, done) {
        const play = () => {
          const deck = shuffle(set.items).slice(0, ROUND), total = deck.length, missed = new Set(); let queue = deck.slice(), right = 0;
          frame(el, '<div class="g-flip"><button class="g-face" aria-live="polite"></button></div><p class="hint g-tip">Tap the card to flip it.</p><div class="g-row g-acts" hidden><button class="pill" data-k="again">↻ Not yet</button><button class="btn" data-k="got">✓ I knew it</button></div>');
          el.querySelector('.g-bar').hidden = true;
          const show = () => {
            const it = queue[0], face = el.querySelector('.g-face');
            face.classList.remove('back'); face.innerHTML = `<span>${esc(it.q)}</span>`; el.querySelector('.g-acts').hidden = true;
            el.querySelector('.g-tip').textContent = it.a ? 'Tap the card to see the answer.' : 'Read it aloud, then tap the card.';
          };
          el.onclick = e => {
            const it = queue[0];
            if (e.target.closest('.g-face')) {
              const face = el.querySelector('.g-face'); face.classList.add('back');
              face.innerHTML = `<span>${esc(it.a || it.q)}</span>${canSay() ? '<i class="g-say" data-say>🔊</i>' : ''}`; el.querySelector('.g-acts').hidden = false; tone(600, 60);
              if (e.target.closest('[data-say]')) say(it.a || it.q);
              return;
            }
            const k = e.target.closest('[data-k]'); if (!k) return;
            queue.shift();
            if (k.dataset.k === 'got') { if (!missed.has(it)) right++; tone(780, 120); } else { missed.add(it); queue.push(it); tone(300, 120); }
            el.querySelector('.g-score').textContent = `${right} / ${total}`;
            queue.length ? show() : finish(el, '🃏', right, total, play, done);
          };
          show();
        };
        play(); return () => {};
      } },
    { id: 'spell', icon: '🛠️', title: 'Spelling ship', blurb: 'Tap the letters in order. Every word you spell repairs the ship.',
      run(el, set, done) {
        const C = root.SkyCore || require('./core.js'); let t;
        const play = () => {
          const words = shuffle(set.items.filter(it => C.spellTarget(it))).slice(0, ROUND), total = words.length; let n = 0, right = 0, at = 0, slips = 0, word, pool;
          frame(el, `<div class="g-ship">${words.map(() => '<i></i>').join('')}<span>🚀</span></div><p class="g-clue"></p><div class="g-row"><button class="pill" data-say ${canSay() ? '' : 'hidden'}>🔊 Hear the word</button></div><div class="g-row g-built"></div><div class="g-row g-pool"></div>`);
          el.querySelector('.g-bar').hidden = true;
          const draw = () => {
            el.querySelector('.g-built').innerHTML = [...word].map((ch, i) => i < at ? `<b class="g-tile">${ch.toUpperCase()}</b>` : '<i class="g-slot"></i>').join('');
            el.querySelector('.g-pool').innerHTML = pool.map((ch, i) => `<button class="g-tile" data-i="${i}">${ch.toUpperCase()}</button>`).join('');
          };
          const next = () => {
            const it = words[n]; word = C.spellTarget(it); at = 0; slips = 0;
            const extra = shuffle('abcdefghijklmnopqrstuvwxyz'.split('').filter(ch => !word.includes(ch))).slice(0, 2);
            pool = shuffle([...word, ...extra]);
            const clue = el.querySelector('.g-clue');
            if (it.a) clue.textContent = it.q;
            else { clue.textContent = word.toUpperCase(); clue.classList.add('peek'); clearTimeout(t); t = setTimeout(() => { clue.textContent = 'Spell the word you saw.'; clue.classList.remove('peek'); }, 2500); }
            if (canSay()) say(word);
            draw();
          };
          el.onclick = e => {
            if (e.target.closest('[data-say]')) return say(word);
            const b = e.target.closest('[data-i]'); if (!b) return;
            const ch = pool[+b.dataset.i];
            if (ch !== word[at]) { slips++; b.classList.add('wrong'); tone(180, 150); setTimeout(() => b.classList.remove('wrong'), 350); return; }
            pool.splice(+b.dataset.i, 1); at++; tone(520 + at * 40, 70);
            if (at < word.length) return draw();
            draw(); if (slips === 0) right++;
            el.querySelectorAll('.g-ship i')[n].classList.add(slips === 0 ? 'on' : 'half');
            el.querySelector('.g-score').textContent = `${right} / ${total}`; tone(880, 160);
            clearTimeout(t); t = setTimeout(() => (++n < total ? next() : finish(el, '🛠️', right, total, play, done)), 700);
          };
          next();
        };
        play(); return () => clearTimeout(t);
      } },
    { id: 'quiz', icon: '❓', title: 'Quick quiz', blurb: 'Pick the right answer before the timer runs out.',
      run(el, set, done) {
        const C = root.SkyCore || require('./core.js'); let t, stop = () => {};
        const play = () => {
          const qs = C.quizQuestions(set, ROUND), total = qs.length; let n = 0, right = 0;
          frame(el, '<p class="g-clue"></p><div class="opts"></div>');
          const ask = () => {
            stop(); const q = qs[n];
            el.querySelector('.g-clue').textContent = q.q;
            el.querySelector('.opts').innerHTML = q.options.map(o => `<button data-o="${esc(o)}">${esc(o)}</button>`).join('');
            stop = countdown(el, 20, () => reveal(null));
          };
          const reveal = pick => {
            stop(); const q = qs[n], ok = pick === q.answer; if (ok) right++;
            el.querySelectorAll('[data-o]').forEach(b => { b.disabled = true; if (b.dataset.o === q.answer) b.classList.add('right'); else if (b.dataset.o === pick) b.classList.add('wrong'); });
            el.querySelector('.g-score').textContent = `${right} / ${total}`; tone(ok ? 780 : 180, 180);
            t = setTimeout(() => (++n < total ? ask() : finish(el, '❓', right, total, play, done)), 1100);
          };
          el.onclick = e => { const b = e.target.closest('[data-o]'); if (b && !b.disabled) reveal(b.dataset.o); };
          ask();
        };
        play(); return () => { clearTimeout(t); stop(); };
      } },
  ];

  const api = { mathQ, scramble, list: GAMES, best, setGames: SET_GAMES, say, canSay,
    start(id, el) { const g = GAMES.find(x => x.id === id); const stop = g.run(el, g); return () => { el.onclick = null; stop(); }; },
    startSet(id, el, set, done) { const g = SET_GAMES.find(x => x.id === id); const stop = g.run(el, set, done); /* every finished round counts, so playing again can raise the best */ return () => { el.onclick = null; stop(); try { speechSynthesis.cancel(); } catch { /* no speech */ } }; } };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.SkyGames = api;
})(this);
