'use strict';
// Automated version of the assignment's QA checklist. Run: npm test
// Uses only Node built-ins (node:test + fetch). Each run uses a fresh in-memory DB.

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../src/app');

const ADMIN = { username: 'admin', password: 'Admin-Test-Pass-123' };
const USER = { username: 'alice', password: 'correct-horse-battery' };

let server, app, base;

before(async () => {
  app = createApp({
    isProduction: false, port: 0, dbPath: ':memory:', sessionTtlMinutes: 60, cookieSecure: false,
    adminUsername: ADMIN.username, adminPassword: ADMIN.password,
    loginMaxAttempts: 5, loginMaxAttemptsPerIp: 1000, loginWindowMinutes: 15, trustProxy: false,
  });
  await app.seedAdmin();
  server = http.createServer(app.handler);
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});

after(() => { server.close(); app.close(); });

// --- helpers ---
async function call(path, { method = 'GET', body, cookie, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data, headers: res.headers };
}
const cookieFrom = (res) => (res.headers.get('set-cookie') || '').split(';')[0];
async function loginAs(creds) {
  const res = await call('/api/auth/login', { method: 'POST', body: creds });
  assert.equal(res.status, 200, `login as ${creds.username} should succeed`);
  return cookieFrom(res);
}

describe('1. Authentication functional tests', () => {
  test('registers a new account (201) and never returns the password hash', async () => {
    const res = await call('/api/auth/register', { method: 'POST', body: USER });
    assert.equal(res.status, 201);
    assert.equal(res.data.user.username, USER.username);
    assert.equal(res.data.user.role, 'user');
    assert.equal(res.data.user.password_hash, undefined);
    assert.ok(!JSON.stringify(res.data).includes('scrypt$'));
  });

  test('duplicate username is rejected (409)', async () => {
    const res = await call('/api/auth/register', { method: 'POST', body: USER });
    assert.equal(res.status, 409);
  });

  test('login creates a session with a hardened cookie', async () => {
    const res = await call('/api/auth/login', { method: 'POST', body: USER });
    assert.equal(res.status, 200);
    const setCookie = res.headers.get('set-cookie');
    assert.match(setCookie, /^sid=[A-Za-z0-9_-]{40,}/);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
    assert.equal(res.data.user.password_hash, undefined);
  });

  test('wrong password and unknown user return the SAME generic 401 message', async () => {
    const wrongPw = await call('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'definitely-wrong-1' } });
    const noUser = await call('/api/auth/login', { method: 'POST', body: { username: 'nobody_here', password: 'definitely-wrong-1' } });
    assert.equal(wrongPw.status, 401);
    assert.equal(noUser.status, 401);
    assert.equal(wrongPw.data.error, 'Invalid username or password.');
    assert.deepEqual(wrongPw.data, noUser.data);
  });

  test('logout invalidates the session server-side (old cookie can no longer be replayed)', async () => {
    const cookie = await loginAs(USER);
    assert.equal((await call('/api/auth/me', { cookie })).status, 200);
    const out = await call('/api/auth/logout', { method: 'POST', body: {}, cookie });
    assert.equal(out.status, 200);
    assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
    assert.equal((await call('/api/auth/me', { cookie })).status, 401, 'stolen/old cookie must be dead');
  });
});

describe('2. Authorization & privilege boundary tests', () => {
  test('standard user can access the user dashboard (200)', async () => {
    const cookie = await loginAs(USER);
    const res = await call('/api/user/dashboard', { cookie });
    assert.equal(res.status, 200);
    assert.equal(res.data.user.role, 'user');
  });

  test('standard user hitting the admin endpoint directly gets 403 Forbidden', async () => {
    const cookie = await loginAs(USER);
    const res = await call('/api/admin/users', { cookie });
    assert.equal(res.status, 403);
    assert.equal(res.data.users, undefined, 'no admin data may leak in the 403 body');
  });

  test('admin can access both user and admin resources', async () => {
    const cookie = await loginAs(ADMIN);
    assert.equal((await call('/api/user/dashboard', { cookie })).status, 200);
    const res = await call('/api/admin/users', { cookie });
    assert.equal(res.status, 200);
    assert.ok(res.data.users.length >= 2);
    for (const u of res.data.users) assert.equal(u.password_hash, undefined, 'admin list must not expose hashes');
  });

  test('logged-out requests to protected endpoints return 401', async () => {
    for (const p of ['/api/auth/me', '/api/user/dashboard', '/api/admin/users']) {
      assert.equal((await call(p)).status, 401, p);
    }
  });

  test('forged or garbage session cookies return 401', async () => {
    for (const cookie of ['sid=forged-token', 'sid=', `sid=${'A'.repeat(500)}`, 'sid=%E0%A4%A']) {
      assert.equal((await call('/api/admin/users', { cookie })).status, 401, cookie);
    }
  });

  test('privilege escalation via registration is impossible (role field is ignored)', async () => {
    const res = await call('/api/auth/register', {
      method: 'POST', body: { username: 'mallory', password: 'sneaky-password-123', role: 'admin', isAdmin: true },
    });
    assert.equal(res.status, 201);
    assert.equal(res.data.user.role, 'user');
    const cookie = await loginAs({ username: 'mallory', password: 'sneaky-password-123' });
    assert.equal((await call('/api/admin/users', { cookie })).status, 403);
  });

  test('client-supplied role headers are ignored', async () => {
    const cookie = await loginAs(USER);
    const res = await call('/api/admin/users', { cookie, headers: { 'X-Role': 'admin', 'X-User-Role': 'admin' } });
    assert.equal(res.status, 403);
  });

  test('public endpoint works for everyone (200)', async () => {
    assert.equal((await call('/api/public')).status, 200);
  });

  test('session status endpoint reports anonymous without leaking anything', async () => {
    const anon = await call('/api/auth/session');
    assert.equal(anon.status, 200);
    assert.deepEqual(anon.data, { authenticated: false, user: null });
    const cookie = await loginAs(USER);
    const authed = await call('/api/auth/session', { cookie });
    assert.equal(authed.data.authenticated, true);
    assert.equal(authed.data.user.password_hash, undefined);
  });
});

describe('3. Input validation & edge cases', () => {
  test('empty username/password are rejected with 400 on register and login', async () => {
    for (const path of ['/api/auth/register', '/api/auth/login']) {
      for (const body of [{}, { username: '', password: '' }, { username: 'bob' }, { password: 'x' }, { username: '   ', password: 'some-password-1' }]) {
        const res = await call(path, { method: 'POST', body });
        assert.equal(res.status, 400, `${path} ${JSON.stringify(body)}`);
      }
    }
  });

  test('weak passwords and invalid usernames are rejected on registration', async () => {
    const cases = [
      { username: 'bob', password: 'short' },
      { username: 'bobby', password: 'bobby-password-1' }, // contains username
      { username: 'a', password: 'long-enough-pass' },
      { username: 'bad name!', password: 'long-enough-pass' },
      { username: 'bob', password: 'x'.repeat(129) },
    ];
    for (const body of cases) {
      assert.equal((await call('/api/auth/register', { method: 'POST', body })).status, 400, JSON.stringify(body));
    }
  });

  test('SQL-injection-style input does not crash the server or bypass login', async () => {
    const payloads = ["' OR '1'='1", "admin'--", "'; DROP TABLE users; --", '" OR ""="', 'admin" /*'];
    for (const p of payloads) {
      const login = await call('/api/auth/login', { method: 'POST', body: { username: p, password: p } });
      assert.equal(login.status, 401, `login with ${p}`);
      const reg = await call('/api/auth/register', { method: 'POST', body: { username: p, password: 'long-enough-pass-1' } });
      assert.equal(reg.status, 400, `register with ${p}`);
    }
    // users table still intact and admin still works
    const cookie = await loginAs(ADMIN);
    assert.equal((await call('/api/admin/users', { cookie })).status, 200);
  });

  test('special characters, unicode and wrong types are handled without a 500', async () => {
    const bodies = [
      { username: '<script>alert(1)</script>', password: 'pass<>&"\'word1' },
      { username: 'ñandú_😀', password: '密码密码密码密码密码密码' },
      { username: ['admin'], password: { $ne: null } }, // NoSQL-style/type confusion
      { username: 123, password: true },
      { username: null, password: null },
    ];
    for (const body of bodies) {
      const res = await call('/api/auth/login', { method: 'POST', body });
      assert.ok([400, 401].includes(res.status), `${JSON.stringify(body)} -> ${res.status}`);
    }
  });

  test('malformed JSON, non-object JSON, wrong content type and oversized bodies are rejected cleanly', async () => {
    assert.equal((await call('/api/auth/login', { method: 'POST', body: '{"username":' })).status, 400);
    assert.equal((await call('/api/auth/login', { method: 'POST', body: '["a","b"]' })).status, 400);
    assert.equal((await call('/api/auth/login', { method: 'POST', body: 'null' })).status, 400);
    const form = await fetch(base + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'username=a&password=b',
    });
    assert.equal(form.status, 415);
    const big = await call('/api/auth/login', { method: 'POST', body: { username: 'a', password: 'x'.repeat(20_000) } });
    assert.equal(big.status, 413);
  });

  test('cross-origin state-changing requests are blocked (CSRF defense in depth)', async () => {
    const res = await call('/api/auth/login', { method: 'POST', body: USER, headers: { Origin: 'https://evil.example' } });
    assert.equal(res.status, 403);
  });

  test('path traversal on static files is blocked', async () => {
    for (const p of ['/../server.js', '/%2e%2e/server.js', '/..%2fsrc%2fconfig.js', '/%2e%2e%2f.env']) {
      const res = await fetch(base + p);
      assert.equal(res.status, 404, p);
    }
  });
});

describe('4. HTTP health: status codes and security headers', () => {
  test('pages and APIs send security headers; authenticated responses are not cached', async () => {
    const page = await fetch(base + '/');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(page.headers.get('x-frame-options'), 'DENY');
    assert.equal(page.headers.get('x-powered-by'), null);
    const cookie = await loginAs(USER);
    const api = await call('/api/user/dashboard', { cookie });
    assert.equal(api.headers.get('cache-control'), 'no-store');
  });

  test('unknown routes 404 and wrong methods 405 (never 500)', async () => {
    assert.equal((await call('/api/nope')).status, 404);
    assert.equal((await call('/api/admin/users', { method: 'DELETE' })).status, 405);
  });
});

describe('5. Brute-force protection', () => {
  test('repeated failed logins for one account are rate limited (429 with Retry-After)', async () => {
    await call('/api/auth/register', { method: 'POST', body: { username: 'victim', password: 'victim-strong-pass' } });
    let last;
    for (let i = 0; i < 6; i++) {
      last = await call('/api/auth/login', { method: 'POST', body: { username: 'victim', password: `wrong-guess-${i}` } });
    }
    assert.equal(last.status, 429);
    assert.ok(Number(last.headers.get('retry-after')) > 0);
    // Even the right password is refused while locked out.
    const right = await call('/api/auth/login', { method: 'POST', body: { username: 'victim', password: 'victim-strong-pass' } });
    assert.equal(right.status, 429);
  });
});
