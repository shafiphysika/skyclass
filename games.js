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

  const api = { mathQ, scramble, list: GAMES, best, start(id, el) { const g = GAMES.find(x => x.id === id); const stop = g.run(el, g); return () => { el.onclick = null; stop(); }; } };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.SkyGames = api;
})(this);
