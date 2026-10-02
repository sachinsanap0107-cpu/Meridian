# Meridian

Meridian is a vanilla HTML/CSS/JavaScript symptom checker with a small Node.js backend and SQLite database.

Authentication is now **username + password only**. Google Sign-In has been removed.

## Run it

Node.js 22.5+ is required because the project uses Node's built-in `node:sqlite` API.

```bash
npm start
```

Then open:

**http://localhost:3000**

Important: do **not** open `index.html` directly and do not use VS Code Live Server for this project. The Node server must serve both the frontend and `/api/*` endpoints. This fixes the `Request failed (405)` error caused by sending a POST request to a static-file server that does not handle the API routes.

## Authentication

### Create account

- Name
- Username: 3–24 characters, letters/numbers/underscore only
- Password: at least 6 characters

### Log in

Use the same username and password.

Passwords are hashed with PBKDF2-SHA256 and a random salt. The server stores only the password hash/salt, not the plain password. A signed HTTP-only session cookie keeps the user logged in.

## API

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/api/auth/signup` | `{ name, username, password }` | Creates account and starts a session |
| POST | `/api/auth/login` | `{ username, password }` | Starts a session |
| POST | `/api/auth/logout` | — | Clears the session cookie |
| GET | `/api/auth/me` | — | Returns the current user |
| GET | `/api/history` | — | Requires a session |
| POST | `/api/history` | history data | Requires a session |
| DELETE | `/api/history` | — | Deletes the current user's history |

## If you previously ran the old Google/email version

The backend includes a small database migration that adds a username to existing users. For a brand-new/local project, you can also delete `meridian.db` once and restart if you want a completely clean account database.

## Project structure

All files are intentionally in one folder so the server can serve the frontend directly:

- `server.js` — HTTP server + API routes
- `auth.js` — password hashing + sessions
- `db.js` — SQLite database
- `script.js` — browser UI + symptom matching
- `index.html` — frontend
- `style.css` — styling
- `load-env.js` — optional `.env` loader
