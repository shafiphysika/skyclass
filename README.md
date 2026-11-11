# Skyclass

A classroom site with three views: teacher, student and parent.

- **Teacher:** star points with reasons, a class goal (the kite climbs as the class earns stars), daily attendance, interactive lessons with quizzes and polls, a fair name wheel, timer, group maker and dice, shortcuts to classroom websites, and news and homework posts.
- **Student:** my stars, badges, why I got each star, lessons to play, homework.
- **Parent:** my child's stars, attendance, recent activity, homework and news. Read-only.

## Run it

No build step. Serve the folder and open it:

```sh
npm start        # http://127.0.0.1:8766
npm test         # data logic tests
```

## Where data lives

Everything is saved in this browser only (`localStorage`). There are no accounts yet, so the student and parent views show data only on the device the teacher uses, and anyone holding that device can open any view. Use **Classes → Download backup** before clearing browser data.

**Classes → Bring in your ClassGrove classes** copies class lists and points from ClassGrove (point-party), either from this device or from a ClassGrove backup file. It only reads; ClassGrove is never changed.

Do not commit real rosters or backup files to this repository.

## Files

- `core.js`: data rules (validation, points, fair picking, lesson parsing, import). Tested in `tests/`.
- `app.js`: the pages. `style.css`: the look. `sites.js`: the list of classroom websites.
