'use strict';
// Server-side sessions with opaque random tokens.
// Why sessions instead of JWT here: logout must truly invalidate the credential.
// A stateless JWT stays valid until it expires even after "logout"; a server-side
// session row is deleted, so the old cookie is useless immediately.

const crypto = require('node:crypto');

const COOKIE_NAME = 'sid';

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function createSessionStore({ q, ttlMinutes }) {
  return {
    create(userId) {
      const token = crypto.randomBytes(32).toString('base64url'); // 256 bits of entropy
      const now = Date.now();
      q.insertSession.run(sha256(token), userId, now + ttlMinutes * 60_000, now);
      return token;
    },
    // Returns the user (role read fresh from the DB on every request) or null.
    lookup(token) {
      if (!token || token.length > 100) return null;
      const row = q.sessionUser.get(sha256(token));
      if (!row) return null;
      if (row.expires_at <= Date.now()) {
        q.deleteSession.run(sha256(token));
        return null;
      }
      return { id: row.id, username: row.username, role: row.role, created_at: row.created_at };
    },
    destroy(token) {
      if (token) q.deleteSession.run(sha256(token));
    },
    purgeExpired() {
      q.deleteExpiredSessions.run(Date.now());
    },
  };
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) {
      try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
    }
  }
  return out;
}

function sessionCookie(token, { secure, maxAgeSeconds }) {
  return [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',            // not readable by JavaScript, so XSS can't steal it
    'SameSite=Strict',     // not sent on cross-site requests (CSRF defense)
    `Max-Age=${maxAgeSeconds}`,
    secure ? 'Secure' : null, // HTTPS only in production
  ].filter(Boolean).join('; ');
}

function clearedCookie({ secure }) {
  return sessionCookie('', { secure, maxAgeSeconds: 0 });
}

module.exports = { createSessionStore, parseCookies, sessionCookie, clearedCookie, COOKIE_NAME };
