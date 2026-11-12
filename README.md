# Skyclass

A classroom site with three views: teacher, student and parent.

- **Teacher:** star points with reasons, a class goal (the kite climbs as the class earns stars), daily attendance, interactive lessons with quizzes and polls, a fair name wheel, timer, group maker and dice, shortcuts to classroom websites, and news and homework posts.
- **Student:** my stars, badges, why I got each star, lessons to play, homework.
- **Parent:** my child's stars, attendance, recent activity, homework and news. Read-only.

## Games and library

- **Games:** five built-in games for students (maths sprint, memory match, word scramble, colour echo, star catcher). Best scores stay on the device.
- **Library:** put PowerPoints, PDFs, pictures and HTML games in a public GitHub repository, one folder per subject. In **Library**, enter `owner/name` and press **Sync from GitHub**. Slides open in Microsoft's online viewer (files up to 10 MB; the file address is sent to Microsoft), a folder with `index.html` opens as a game (the repository needs GitHub Pages turned on), and PDFs open on GitHub. Families with a code see the same library.

## Practice, check-in and team race

- **Question sets** (Practice tab): type one list, a word per line for spelling or `question | answer` for flashcards and quizzes. Each set plays as Flashcards, Spelling ship or Quick quiz, prints as a worksheet with an answer key, and can be assigned to a class.
- **Assignments:** students see them under Practice. On the class device scores save straight away; at home children use their family code and the score is sent to the teacher. Results show best score and number of tries per child.
- **Morning check-in:** children pick a mood face on My stars, or on the class device through Attendance → Open check-in for the class. The teacher sees the class at a glance and who to check on.
- **Team race** (Tools): teams race rockets to a planet; ask questions from any set.
- **Works offline** after the first visit, and can be installed to a phone or tablet home screen.

## Story missions and iPad login

- **Story missions** (Practice tab): one story becomes four stations that score themselves. Listening (hear a word or sentence, pick the picture or sentence), Reading (questions, true or false, put the story in order), Writing (spell words, build sentences, fill the missing word) and Speaking (read aloud; the browser's speech recognition scores it). A story reader reads the whole story aloud line by line.
- **Stars and rewards:** each station gives up to three stars, plus three for finishing all four. Stars become class points once; improving a score adds the difference. Finishing a mission unlocks a space-crew member, shiny with three stars everywhere.
- **iPad login** (Classes tab, signed in): turn it on for a class, print the picture PIN cards, and students join with the class code, tap their name and their four pictures. Eight wrong tries lock that child for ten minutes.
- Story text is the teacher's own content and is stored only in their account, not in this repository.

## Run it

No build step. Serve the folder and open it:

```sh
npm start        # http://127.0.0.1:8766
npm install      # once, for the test database
npm test         # data logic and database access tests
```

## Where data lives

Without online accounts, everything is saved in this browser only (`localStorage`), and anyone holding the device can open any view.

## Online accounts (optional)

With a Supabase project connected, a teacher signs in under **Classes** and the school is saved online. The teacher then makes a **family code** for each child. On any device, a family chooses Student or Parent and enters the code to see that one child, read-only. A code works like a password; making a new one switches the old one off.

Setup:

1. Run `supabase/skyclass.sql` in the project's SQL editor. It only adds `sky_` tables and functions.
2. Put the project URL and the publishable key in `config.js`. Never a service-role key.
3. Add the site address to the project's allowed Auth redirect URLs.

Limits: one teacher account owns one school, with no sharing between teachers yet. If two devices edit at once, the first save wins and the other reloads. Lessons sent to families include quiz answers, because quizzes are practice, not grades.

**Classes → Bring in your ClassGrove classes** copies class lists and points from ClassGrove (point-party), either from this device or from a ClassGrove backup file. It only reads; ClassGrove is never changed.

Do not commit real rosters or backup files to this repository.

## Files

- `core.js`: data rules (validation, points, fair picking, lesson parsing, import). Tested in `tests/`.
- `app.js`: the pages. `style.css`: the look. `sites.js`: the list of classroom websites.
