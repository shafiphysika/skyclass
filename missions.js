// Story mission stations. run() draws one station into el and calls done(score, total) when finished.
(function (root) {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const say = t => root.SkyGames && root.SkyGames.say(t);
  const Rec = root.SpeechRecognition || root.webkitSpeechRecognition;
  const canListen = () => !!Rec;
  let ac;
  function tone(f, ms = 120) { try { ac = ac || new (root.AudioContext || root.webkitAudioContext)(); const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = f; g.gain.value = .1; o.connect(g).connect(ac.destination); o.start(); o.stop(ac.currentTime + ms / 1000); } catch { /* sound is optional */ } }
  const STAR = n => '⭐'.repeat(n) + '<i class="dim">' + '⭐'.repeat(3 - n) + '</i>';

  function run(el, items, opts) {
    const C = root.SkyCore, total = items.length * 2; let i = 0, score = 0, timers = [], rec = null, alive = true;
    const later = (fn, ms) => timers.push(setTimeout(() => alive && fn(), ms));
    const stopRec = () => { if (rec) { try { rec.abort(); } catch { /* already stopped */ } rec = null; } };
    function frame(body) {
      el.innerHTML = `<div class="m-top"><div class="m-dots">${items.map((_, k) => `<i class="${k < i ? 'past' : k === i ? 'on' : ''}"></i>`).join('')}</div><b class="m-score">${score} / ${total}</b></div><div class="m-body">${body}</div>`;
    }
    function next(got) {
      score += got; tone(got === 2 ? 880 : got ? 660 : 220, got ? 160 : 220);
      if (got) burst(); i++; later(() => (i < items.length ? show() : end()), got === 2 ? 650 : 1300);
    }
    function burst() { const s = el.querySelector('.m-score'); if (s) { s.classList.remove('pop'); void s.offsetWidth; s.classList.add('pop'); } }
    function end() {
      stopRec();
      const stars = C.starsFor({ best: score, total });
      el.innerHTML = `<div class="g-end m-end"><div class="m-stars">${STAR(stars)}</div><h2>${score} of ${total}</h2>
        <p>${['Good try! Play again to earn stars.', 'Nice work, cadet!', 'Great flying!', 'Perfect mission!'][stars]}</p><button class="btn" data-again>Play again</button></div>`;
      tone(stars === 3 ? 988 : 660, 400);
      if (opts.done) opts.done(score, total, stars);
    }
    function show() {
      stopRec(); const q = items[i];
      if (q.type === 'pick') {
        frame(`${q.say ? `<button class="m-hear" data-hear>🔊</button>` : ''}<p class="m-prompt ${q.say ? 'sm' : ''}">${esc(q.say ? q.prompt : q.prompt)}</p>${q.hint ? `<p class="hint">${esc(q.hint)}</p>` : ''}
          <div class="opts ${q.big ? 'pics' : ''}">${q.options.map(o => `<button data-o="${esc(o)}">${esc(o)}</button>`).join('')}</div>`);
        if (q.say) later(() => say(q.say), 300);
        el.onclick = e => {
          if (e.target.closest('[data-hear]')) return say(q.say);
          const b = e.target.closest('[data-o]'); if (!b || b.disabled) return;
          el.querySelectorAll('[data-o]').forEach(x => { x.disabled = true; if (x.dataset.o === q.answer) x.classList.add('right'); });
          if (b.dataset.o !== q.answer) b.classList.add('wrong');
          next(b.dataset.o === q.answer ? 2 : 0);
        };
      } else if (q.type === 'order' || q.type === 'build' || q.type === 'spell') {
        const target = q.type === 'spell' ? [...q.word] : q.parts, pool = shuffle(target.map((t, k) => ({ t, k }))); let at = 0, slips = 0;
        const draw = () => {
          const shown = target.slice(0, at), rest = target.length - at, tile = t => q.type === 'spell' ? t.toUpperCase() : t;
          frame(`${q.say || q.type === 'spell' ? '<button class="m-hear" data-hear>🔊</button>' : ''}<p class="m-prompt sm">${esc(q.type === 'spell' ? 'Spell the word.' : q.prompt)}</p>${q.clue ? `<p class="m-clue">${esc(q.clue)}</p>` : ''}
            <div class="m-built ${q.type}">${shown.map(t => `<b>${esc(tile(t))}</b>`).join(q.type === 'order' ? '' : ' ')}${'<i></i>'.repeat(rest)}</div>
            <div class="m-pool ${q.type}">${pool.map((p, k) => p.used ? '' : `<button data-k="${k}">${esc(tile(p.t))}</button>`).join('')}</div>`);
        };
        draw(); if (q.say) later(() => say(q.say), 300);
        el.onclick = e => {
          if (e.target.closest('[data-hear]')) return say(q.say || q.word);
          const b = e.target.closest('[data-k]'); if (!b) return;
          const p = pool[+b.dataset.k];
          if (p.t !== target[at]) { slips++; b.classList.add('wrong'); tone(200, 120); later(() => b.classList.remove('wrong'), 350); return; }
          p.used = true; at++; tone(500 + at * 40, 60); draw();
          if (at === target.length) next(slips === 0 ? 2 : slips <= (q.type === 'spell' ? 2 : 1) ? 1 : 0);
        };
      } else if (q.type === 'say') {
        let best = 0, tries = 0;
        const draw = msg => frame(`${q.pic ? `<span class="big m-pic">${esc(q.pic)}</span>` : ''}<p class="m-prompt">${esc(q.text)}</p>
          <div class="g-row"><button class="pill" data-hear>🔊 Hear it</button>${canListen() ? `<button class="btn m-mic" data-mic>🎤 ${tries ? 'Try again' : 'Tap and say it'}</button>` : ''}</div>
          <p class="m-heard" aria-live="polite">${msg || (canListen() ? 'Listen first, then say it out loud.' : 'This browser cannot listen. Open Skyclass in Safari or Chrome to score speaking.')}</p>
          ${tries || !canListen() ? `<button class="pill" data-next>${best >= 2 ? 'Next' : 'Next (keep ' + best + ' / 2)'}</button>` : ''}`);
        draw();
        el.onclick = e => {
          if (e.target.closest('[data-hear]')) return say(q.text);
          if (e.target.closest('[data-next]')) return next(best);
          if (!e.target.closest('[data-mic]') || rec) return;
          rec = new Rec(); rec.lang = 'en-US'; rec.interimResults = false; rec.maxAlternatives = 3;
          el.querySelector('[data-mic]').classList.add('live'); el.querySelector('.m-heard').textContent = 'Listening…';
          let heard = false;
          rec.onresult = ev => {
            heard = true; const alts = [...ev.results[0]].map(a => a.transcript), s = Math.max(...alts.map(a => C.speechScore(q.text, a)));
            const pts = s >= .8 ? 2 : s >= .5 ? 1 : 0; best = Math.max(best, pts); tries++; rec = null;
            if (pts === 2) return next(2);
            draw(`I heard: “${esc(alts[0])}”. ${pts ? 'Close! Try once more for full points.' : 'Listen again and try once more.'}`); tone(pts ? 600 : 260, 160);
          };
          rec.onerror = ev => { rec = null; draw(ev.error === 'not-allowed' ? 'Allow the microphone for this site, then try again.' : 'I did not hear anything. Tap the microphone and speak clearly.'); };
          rec.onend = () => { if (rec && !heard) { rec = null; draw('I did not hear anything. Tap the microphone and speak clearly.'); } };
          try { rec.start(); } catch { rec = null; draw('The microphone could not start. Try again.'); }
        };
      }
    }
    el.addEventListener('click', e => { if (e.target.closest('[data-again]')) { score = 0; i = 0; items = opts.fresh ? opts.fresh() : items; show(); } });
    if (!items.length) el.innerHTML = '<p class="empty">This station has nothing to practise yet. Ask your teacher to add words and sentences.</p>';
    else show();
    return () => { alive = false; timers.forEach(clearTimeout); stopRec(); el.onclick = null; try { speechSynthesis.cancel(); } catch { /* no speech */ } };
  }

  // Reads the story aloud one line at a time, highlighting the line being read.
  function reader(el, pack) {
    let alive = true;
    el.innerHTML = `<div class="m-story">${pack.story.map((l, k) => `<p data-line="${k}"><button class="m-hear sm" data-say="${k}" aria-label="Hear this line">🔊</button> ${esc(l)}</p>`).join('')}</div>
      <div class="g-row"><button class="btn" data-all>🔊 Read me the whole story</button></div>`;
    const readFrom = k => {
      if (!alive || k >= pack.story.length) return;
      el.querySelectorAll('[data-line]').forEach(p => p.classList.toggle('now', +p.dataset.line === k));
      el.querySelector(`[data-line="${k}"]`).scrollIntoView({ block: 'center', behavior: 'smooth' });
      try { const u = new SpeechSynthesisUtterance(pack.story[k]); u.lang = 'en-US'; u.rate = .85; u.onend = () => readFrom(k + 1); speechSynthesis.cancel(); speechSynthesis.speak(u); } catch { /* no speech */ }
    };
    el.onclick = e => { const b = e.target.closest('[data-say]'); if (b) { say(pack.story[+b.dataset.say]); return; } if (e.target.closest('[data-all]')) readFrom(0); };
    return () => { alive = false; el.onclick = null; try { speechSynthesis.cancel(); } catch { /* no speech */ } };
  }

  root.SkyMissions = { run, reader, canListen };
})(this);
