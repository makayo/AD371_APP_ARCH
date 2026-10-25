'use strict';
const fs = require('node:fs');
const path = require('node:path');

const { openDb } = require('./db'); 
const { hashPassword, verifyPassword, getDummyHash } = require('./password');
const { createSessionStore, parseCookies, sessionCookie, clearedCookie, COOKIE_NAME } = require('./sessions');
const { validateCredentials } = require('./validate');
const { createLimiter } = require('./rateLimit');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MAX_BODY_BYTES = 10 * 1024;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

// ---------- response helpers ----------

function setSecurityHeaders(res, config) {
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
    "object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (config.cookieSecure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

function sendJson(res, status, body, headers = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store', // authenticated data must never be cached
    ...headers,
  });
  res.end(data);
}

async function readJsonBody(req) {
  const type = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  // Requiring JSON blocks classic cross-site <form> CSRF (forms can't send this type).
  if (type !== 'application/json') throw new HttpError(415, 'Content-Type must be application/json.');

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'Request body too large.');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'Malformed JSON.');
  }
}

function clientIp(req, config) {
  if (config.trustProxy) {
    const fwd = req.headers['x-forwarded-for'];
    if (fwd) return String(fwd).split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

// Reject cross-origin state-changing requests (defense in depth on top of SameSite).
function checkOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return; // non-browser clients (curl, tests) don't send Origin
  let originHost;
  try { originHost = new URL(origin).host; } catch { throw new HttpError(403, 'Forbidden.'); }
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (originHost !== host) throw new HttpError(403, 'Cross-origin request blocked.');
}

// ---------- the app ----------

function createApp(config) {
  const { db, q } = openDb(config.dbPath);
  const sessions = createSessionStore({ q, ttlMinutes: config.sessionTtlMinutes });
  // Two limiters: strict per account (stops guessing one password), looser per IP
  // (stops one client spraying many accounts without locking out a shared office NAT).
  const windowMs = config.loginWindowMinutes * 60_000;
  const accountLimiter = createLimiter({ max: config.loginMaxAttempts, windowMs });
  const ipLimiter = createLimiter({ max: config.loginMaxAttemptsPerIp || 50, windowMs });

  // ----- route guards (server-side authorization) -----
  // These run on the server for every protected request. Hiding a button in the
  // frontend is cosmetic; THIS is the access control.

  function requireAuth(ctx) {
    const token = parseCookies(ctx.req.headers.cookie)[COOKIE_NAME];
    const user = sessions.lookup(token);
    if (!user) throw new HttpError(401, 'Authentication required.');
    ctx.user = user;
    ctx.token = token;
  }

  const requireRole = (...roles) => (ctx) => {
    // Role comes from the database row joined to the session, never from the
    // client (no role in cookies, headers, request body or localStorage).
    if (!ctx.user || !roles.includes(ctx.user.role)) {
      throw new HttpError(403, 'Forbidden: insufficient role.');
    }
  };

  // ----- handlers -----

  async function register(ctx) {
    checkOrigin(ctx.req);
    const body = await readJsonBody(ctx.req);
    const { errors, username, password } = validateCredentials(body, { forRegistration: true });
    if (errors.length) throw new HttpError(400, 'Validation failed.', { errors });

    // The role is ALWAYS 'user' for self-registration. Any "role" field the client
    // sends is ignored (prevents mass-assignment privilege escalation).
    const hash = await hashPassword(password);
    try {
      const info = q.insertUser.run(username, hash, 'user');
      const user = q.publicUserById.get(info.lastInsertRowid);
      return sendJson(ctx.res, 201, { message: 'Account created. You can now log in.', user });
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) {
        throw new HttpError(409, 'That username is not available.');
      }
      throw err;
    }
  }

  async function login(ctx) {
    checkOrigin(ctx.req);
    const body = await readJsonBody(ctx.req);
    const { errors, username, password } = validateCredentials(body, { forRegistration: false });
    if (errors.length) throw new HttpError(400, 'Username and password are required.', { errors });

    const ipKey = [`ip:${clientIp(ctx.req, config)}`];
    const userKey = [`user:${username.toLowerCase()}`];
    if (ipLimiter.isBlocked(ipKey) || accountLimiter.isBlocked(userKey)) {
      const retry = Math.max(ipLimiter.retryAfterSeconds(ipKey), accountLimiter.retryAfterSeconds(userKey));
      return sendJson(ctx.res, 429, { error: 'Too many failed login attempts. Try again later.' },
        { 'Retry-After': String(retry) });
    }

    const user = q.userByUsername.get(username);
    // Always run the slow hash, even for unknown users, so timing doesn't leak
    // which usernames exist.
    const ok = await verifyPassword(password, user ? user.password_hash : await getDummyHash());

    if (!user || !ok) {
      ipLimiter.fail(ipKey);
      accountLimiter.fail(userKey);
      // One generic message for both cases: no user enumeration.
      throw new HttpError(401, 'Invalid username or password.');
    }

    accountLimiter.reset(userKey);
    // Rotate: drop any session the browser already had, then issue a fresh one
    // (prevents session fixation).
    sessions.destroy(parseCookies(ctx.req.headers.cookie)[COOKIE_NAME]);
    const token = sessions.create(user.id);
    const publicUser = q.publicUserById.get(user.id);
    return sendJson(ctx.res, 200, { message: 'Logged in.', user: publicUser }, {
      'Set-Cookie': sessionCookie(token, { secure: config.cookieSecure, maxAgeSeconds: config.sessionTtlMinutes * 60 }),
    });
  }

  async function logout(ctx) {
    checkOrigin(ctx.req);
    // Delete the session server-side so the old cookie can't be replayed.
    sessions.destroy(parseCookies(ctx.req.headers.cookie)[COOKIE_NAME]);
    return sendJson(ctx.res, 200, { message: 'Logged out.' }, {
      'Set-Cookie': clearedCookie({ secure: config.cookieSecure }),
    });
  }

  // Lets the frontend ask "am I logged in?" without generating a 401 on every
  // anonymous page load. It reveals nothing beyond the caller's own session.
  function sessionStatus(ctx) {
    const user = sessions.lookup(parseCookies(ctx.req.headers.cookie)[COOKIE_NAME]);
    return sendJson(ctx.res, 200, { authenticated: !!user, user: user || null });
  }

  function me(ctx) {
    return sendJson(ctx.res, 200, { user: ctx.user });
  }

  function publicInfo(ctx) {
    return sendJson(ctx.res, 200, {
      message: 'Public endpoint: anyone can read this, logged in or not.',
      time: new Date().toISOString(),
    });
  }

  function userDashboard(ctx) {
    return sendJson(ctx.res, 200, {
      message: `Welcome to your dashboard, ${ctx.user.username}.`,
      user: ctx.user,
      tips: ['Your password is stored as a salted scrypt hash.', 'Your session cookie is HttpOnly and SameSite=Strict.'],
    });
  }

  function adminUsers(ctx) {
    const now = Date.now();
    const roleCounts = Object.fromEntries(q.countUsers.all().map((r) => [r.role, r.count]));
    return sendJson(ctx.res, 200, {
      message: 'Admin only: user management.',
      metrics: {
        totalUsers: Object.values(roleCounts).reduce((a, b) => a + b, 0),
        admins: roleCounts.admin || 0,
        users: roleCounts.user || 0,
        activeSessions: q.countActiveSessions.get(now).count,
      },
      // listPublicUsers selects only safe columns; password_hash is never returned.
      users: q.listPublicUsers.all(),
    });
  }

  function health(ctx) {
    return sendJson(ctx.res, 200, { status: 'ok' });
  }

  // method + path -> guards + handler
  const routes = {
    'GET /api/health': [health],
    'GET /api/public': [publicInfo],
    'POST /api/auth/register': [register],
    'POST /api/auth/login': [login],
    'POST /api/auth/logout': [logout],
    'GET /api/auth/session': [sessionStatus],
    'GET /api/auth/me': [requireAuth, me],
    'GET /api/user/dashboard': [requireAuth, userDashboard],
    'GET /api/admin/users': [requireAuth, requireRole('admin'), adminUsers],
  };

  function serveStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendJson(res, 405, { error: 'Method not allowed.' });
    }
    let rel = pathname === '/' ? '/index.html' : pathname;
    let decoded;
    try { decoded = decodeURIComponent(rel); } catch { return sendJson(res, 400, { error: 'Bad path.' }); }
    const filePath = path.normalize(path.join(PUBLIC_DIR, decoded));
    // Path traversal guard: the resolved file must stay inside public/.
    if (!filePath.startsWith(PUBLIC_DIR + path.sep)) return sendJson(res, 404, { error: 'Not found.' });

    fs.readFile(filePath, (err, data) => {
      if (err) return sendJson(res, 404, { error: 'Not found.' });
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  }

  async function handler(req, res) {
    setSecurityHeaders(res, config);
    let pathname;
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
    } catch {
      return sendJson(res, 400, { error: 'Bad request.' });
    }

    const chain = routes[`${req.method} ${pathname}`];
    try {
      if (chain) {
        const ctx = { req, res };
        for (const step of chain) await step(ctx);
        return;
      }
      if (pathname.startsWith('/api/')) {
        const knownPath = Object.keys(routes).some((k) => k.split(' ')[1] === pathname);
        return sendJson(res, knownPath ? 405 : 404, { error: knownPath ? 'Method not allowed.' : 'Not found.' });
      }
      return serveStatic(req, res, pathname);
    } catch (err) {
      if (err instanceof HttpError) {
        return sendJson(res, err.status, { error: err.message, ...(err.extra || {}) });
      }
      // Unexpected errors: log details server-side, return nothing internal to the client.
      console.error('[error]', req.method, pathname, err);
      if (!res.headersSent) sendJson(res, 500, { error: 'Something went wrong. Please try again.' });
    }
  }

  async function seedAdmin() {
    if (!config.adminUsername || !config.adminPassword) return false;
    if (q.userByUsername.get(config.adminUsername)) return false;
    q.insertUser.run(config.adminUsername, await hashPassword(config.adminPassword), 'admin');
    return true;
  }

  const sweeper = setInterval(() => { sessions.purgeExpired(); ipLimiter.sweep(); accountLimiter.sweep(); }, 10 * 60_000);
  sweeper.unref();

  function close() {
    clearInterval(sweeper);
    db.close();
  }

  return { handler, seedAdmin, close, db, q };
}

module.exports = { createApp };
