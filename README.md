# Sustainable Future Poll

Dependency-free Node.js 22+ app. Run `npm start`, then open:

- http://localhost:3000/vote — mobile voting and thank-you screen
- http://localhost:3000/results — live word cloud, designed for 1920×1080
- Add `?lang=ar` or `?lang=en` to either URL; the language switch also remembers the preference.

The six priorities and visual identity follow the supplied HTML. Arabic supports right-to-left layout. No external fonts, analytics, or runtime services are required. The abstract brand mark follows the HTML reference; it is not the official ministry logo.

## Storage and voting

Votes are stored in `data/votes.json` as anonymous cookie-token-to-choice records. Totals are derived from those records. Writes are serialized and replace the file atomically before success is returned. Existing corrupt data causes startup to fail rather than erase votes. Back up this file regularly. Run **one Node process** against a data directory; do not use cluster mode or multiple replicas. Suitable for a small event poll, not a large distributed election system.

The HttpOnly, SameSite cookie lasts one year. Repeat submissions, including simultaneous requests with the same cookie, are rejected by the server. Cookies identify a browser profile, not physical hardware: clearing cookies, private browsing, or another browser allows another vote. Cookies must be enabled. The client checks the session again on reload and shows the thank-you screen if already voted.

Results fetch fresh data every three seconds after the previous request completes; failed connections retry and visibly mark previously loaded data as disconnected. Word sizes reflect relative vote counts, including ties. All counters start at zero.

## Hetzner deployment

Copy this folder to a server with Node 22+. No `npm install` is needed. Run as an unprivileged user with write access to the data folder, behind an HTTPS reverse proxy such as Caddy or nginx. Forward the public hostname to `127.0.0.1:3000`. Use a systemd service with the project as `WorkingDirectory` and `/usr/bin/node /absolute/project/path/server.js` as `ExecStart`, `Restart=on-failure`, and these environment variables:

```ini
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=3000
Environment=COOKIE_SECURE=true
Environment=DATA_DIR=/var/lib/sustainable-poll
```

Create that persistent data directory and give ownership to the service user before starting. Keep it outside release folders. Set `COOKIE_SECURE=true` only when visitors use HTTPS (leave it unset for local HTTP). Open the `/results` URL on the display and use the browser’s full-screen mode. Voting and results must use the same server and hostname.

To start a new poll, stop the service, archive the vote file, remove it from the data directory, and restart. Browser cookies can stay: their tokens have no vote in the new file. `npm test` runs isolated API integration tests without touching real votes.
