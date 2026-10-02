/* ==========================================================
   Meridian backend — server
   Plain Node http server (no Express) so this runs with zero
   npm installs — just `node server.js` on Node 22+.
   Serves the frontend statically and exposes the JSON API.
   ========================================================== */

require("./load-env")();

const http = require("http");
const fs = require("fs");
const path = require("path");
const db = require("./db");
const {
  hashPassword,
  verifyPassword,
  newSessionToken,
  verifySession,
  SESSION_MAX_AGE_MS
} = require("./auth");

const PORT = process.env.PORT || 3000;
const FRONTEND_DIR = __dirname;

/* ---------- small helpers ---------- */

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(";").forEach(pair => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return out;
}

function getCookieSecuritySuffix() {
  return process.env.NODE_ENV === "production" ? "; Secure" : "";
}

function setSessionCookie(res, token) {
  const maxAgeSec = Math.floor(SESSION_MAX_AGE_MS / 1000);
  const secure = getCookieSecuritySuffix();
  res.setHeader("Set-Cookie", `session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`);
}

function clearSessionCookie(res) {
  const secure = getCookieSecuritySuffix();
  res.setHeader("Set-Cookie", `session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => {
      data += chunk;
      if (data.length > 1e6) req.destroy(new Error("Body too large"));
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(new Error("Invalid JSON body")); }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    picture: row.picture || null,
    createdAt: row.created_at || null
  };
}

function getUserFromReq(req) {
  const token = parseCookies(req).session;
  if (!token) return null;
  const payload = verifySession(token);
  if (!payload) return null;
  const row = db.prepare("SELECT id, name, username, picture, created_at FROM users WHERE id = ?").get(payload.uid);
  return publicUser(row);
}

/* ---------- static file serving ---------- */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function serveStatic(req, res, urlPath) {
  const safePath = path.normalize(urlPath === "/" ? "/index.html" : urlPath).replace(/^(\.\.[/\\])+/, "");
  const fullPath = path.join(FRONTEND_DIR, safePath);
  if (!fullPath.startsWith(FRONTEND_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("Not found");
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(fullPath)] || "application/octet-stream" });
    res.end(data);
  });
}

/* ---------- API routes ---------- */

const routes = [];
function route(method, pattern, handler) {
  routes.push({ method, pattern, handler });
}

route("POST", "/api/auth/signup", async (req, res, body) => {
  const name = (body.name || "").trim();
  const username = (body.username || "").trim().toLowerCase();
  const password = body.password || "";

  if (!name || !/^[a-z0-9_]{3,24}$/.test(username) || password.length < 6) {
    return sendJson(res, 400, {
      error: "Name, username (3–24 letters, numbers, or _), and a password of at least 6 characters are required."
    });
  }

  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (existing) return sendJson(res, 409, { error: "That username is already taken — choose another one." });

  const { hash, salt } = hashPassword(password);
  const internalEmail = `${username}@meridian.local`;
  const info = db.prepare(
    "INSERT INTO users (name, username, email, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(name, username, internalEmail, hash, salt, new Date().toISOString());

  const user = { id: Number(info.lastInsertRowid), name, username, picture: null };
  setSessionCookie(res, newSessionToken(user.id));
  sendJson(res, 200, { user });
});

route("POST", "/api/auth/login", async (req, res, body) => {
  const username = (body.username || "").trim().toLowerCase();
  const password = body.password || "";
  const row = db.prepare("SELECT * FROM users WHERE username = ?").get(username);

  if (!row || !verifyPassword(password, row.password_hash, row.password_salt)) {
    return sendJson(res, 401, { error: "Incorrect username or password." });
  }

  setSessionCookie(res, newSessionToken(row.id));
  sendJson(res, 200, { user: publicUser(row) });
});

route("POST", "/api/auth/logout", async (req, res) => {
  clearSessionCookie(res);
  sendJson(res, 200, { ok: true });
});

route("GET", "/api/auth/me", async (req, res) => {
  sendJson(res, 200, { user: getUserFromReq(req) });
});

route("GET", "/api/history", async (req, res) => {
  const user = getUserFromReq(req);
  if (!user) return sendJson(res, 401, { error: "Sign in to view history." });

  const rows = db.prepare("SELECT * FROM history WHERE user_id = ? ORDER BY id DESC LIMIT 50").all(user.id);
  const entries = rows.map(r => ({
    id: r.id,
    date: r.created_at,
    urgency: r.urgency,
    topMatch: r.top_match_name ? { name: r.top_match_name, pct: r.top_match_pct } : null,
    symptoms: JSON.parse(r.symptoms || "[]"),
    redFlags: JSON.parse(r.red_flags || "[]"),
    duration: r.duration,
    severity: r.severity
  }));
  sendJson(res, 200, { entries });
});

route("POST", "/api/history", async (req, res, body) => {
  const user = getUserFromReq(req);
  if (!user) return sendJson(res, 401, { error: "Sign in to save history." });

  const { urgency, topMatch, symptoms, redFlags, duration, severity } = body;
  db.prepare(`
    INSERT INTO history (user_id, urgency, top_match_name, top_match_pct, symptoms, red_flags, duration, severity, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    user.id,
    urgency || null,
    topMatch ? topMatch.name : null,
    topMatch ? topMatch.pct : null,
    JSON.stringify(symptoms || []),
    JSON.stringify(redFlags || []),
    duration || null,
    severity || null,
    new Date().toISOString()
  );
  sendJson(res, 200, { ok: true });
});

route("DELETE", "/api/history", async (req, res) => {
  const user = getUserFromReq(req);
  if (!user) return sendJson(res, 401, { error: "Sign in first." });
  db.prepare("DELETE FROM history WHERE user_id = ?").run(user.id);
  sendJson(res, 200, { ok: true });
});

route("GET", "/api/history/:id", async (req, res, body, params) => {
  const user = getUserFromReq(req);
  if (!user) return sendJson(res, 401, { error: "Sign in to view history." });

  const id = parseInt(params.id, 10);
  if (!id || isNaN(id)) return sendJson(res, 400, { error: "Invalid record ID." });

  const r = db.prepare("SELECT * FROM history WHERE id = ? AND user_id = ?").get(id, user.id);
  if (!r) return sendJson(res, 404, { error: "Record not found." });

  const entry = {
    id: r.id,
    date: r.created_at,
    urgency: r.urgency,
    topMatch: r.top_match_name ? { name: r.top_match_name, pct: r.top_match_pct } : null,
    symptoms: JSON.parse(r.symptoms || "[]"),
    redFlags: JSON.parse(r.red_flags || "[]"),
    duration: r.duration,
    severity: r.severity
  };
  sendJson(res, 200, { entry });
});

route("DELETE", "/api/history/:id", async (req, res, body, params) => {
  const user = getUserFromReq(req);
  if (!user) return sendJson(res, 401, { error: "Sign in first." });

  const id = parseInt(params.id, 10);
  if (!id || isNaN(id)) return sendJson(res, 400, { error: "Invalid record ID." });

  const existing = db.prepare("SELECT id FROM history WHERE id = ? AND user_id = ?").get(id, user.id);
  if (!existing) return sendJson(res, 404, { error: "Record not found." });

  db.prepare("DELETE FROM history WHERE id = ? AND user_id = ?").run(id, user.id);
  sendJson(res, 200, { ok: true });
});

/* ---------- server ---------- */

function matchRoute(routeItem, method, pathname) {
  if (routeItem.method !== method) return null;
  if (routeItem.pattern === pathname) return { params: {} };
  if (routeItem.pattern.includes(":")) {
    const pParts = routeItem.pattern.split("/");
    const uParts = pathname.split("/");
    if (pParts.length !== uParts.length) return null;
    const params = {};
    for (let i = 0; i < pParts.length; i++) {
      if (pParts[i].startsWith(":")) {
        params[pParts[i].slice(1)] = decodeURIComponent(uParts[i]);
      } else if (pParts[i] !== uParts[i]) {
        return null;
      }
    }
    return { params };
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let matchedHandler = null;
  let params = {};

  for (const r of routes) {
    const m = matchRoute(r, req.method, url.pathname);
    if (m) {
      matchedHandler = r.handler;
      params = m.params;
      break;
    }
  }

  if (matchedHandler) {
    let body = {};
    if (req.method === "POST" || req.method === "PUT") {
      try { body = await readJsonBody(req); }
      catch (e) { return sendJson(res, 400, { error: e.message }); }
    }
    try {
      await matchedHandler(req, res, body, params);
    } catch (e) {
      console.error(e);
      sendJson(res, 500, { error: "Server error" });
    }
    return;
  }

  if (req.method === "GET") return serveStatic(req, res, url.pathname);

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`Meridian server running at http://localhost:${PORT}`);
  console.log("Username/password authentication is enabled. Google authentication is disabled.");
});

module.exports = server;
