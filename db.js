/* ==========================================================
   Meridian — database layer
   Uses Node's built-in node:sqlite (Node 22.5+).
   ========================================================== */

const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const DB_PATH = path.join(__dirname, "meridian.db");
const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    username      TEXT,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    password_salt TEXT,
    google_id     TEXT,
    picture       TEXT,
    created_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS history (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER NOT NULL,
    urgency        TEXT,
    top_match_name TEXT,
    top_match_pct  INTEGER,
    symptoms       TEXT,
    red_flags      TEXT,
    duration       TEXT,
    severity       INTEGER,
    created_at     TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

/* Upgrade a database created by the older email/Google version. */
const columns = db.prepare("PRAGMA table_info(users)").all();
if (!columns.some(c => c.name === "username")) {
  db.exec("ALTER TABLE users ADD COLUMN username TEXT");
}

/* Give old email accounts a usable username before the unique index is added. */
const missingUsers = db.prepare("SELECT id, name, email FROM users WHERE username IS NULL OR username = ''").all();
for (const row of missingUsers) {
  let base = String(row.email || row.name || "user").split("@")[0]
    .toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 24) || `user${row.id}`;
  let username = base;
  let n = 2;
  while (db.prepare("SELECT id FROM users WHERE username = ? AND id != ?").get(username, row.id)) {
    username = `${base.slice(0, 24 - String(n).length)}${n++}`;
  }
  db.prepare("UPDATE users SET username = ? WHERE id = ?").run(username, row.id);
}

try {
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)");
} catch (e) {
  console.error("Could not create username index. Remove meridian.db once and restart if this is a fresh/local project.");
  throw e;
}

module.exports = db;
