# Skyclass

A classroom site with three views: teacher, student and parent.

- **Teacher:** star points with reasons, a class goal (the kite climbs as the class earns stars), daily attendance, interactive lessons with quizzes and polls, a fair name wheel, timer, group maker and dice, shortcuts to classroom websites, and news and homework posts.
- **Student:** my stars, badges, why I got each star, lessons to play, homework.
- **Parent:** my child's stars, attendance, recent activity, homework and news. Read-only.

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
