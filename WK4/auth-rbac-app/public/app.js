'use strict';
// Minimal frontend. Note: nothing security-relevant lives here.
// - The session cookie is HttpOnly, so this script can't read it (and doesn't need to).
// - Showing/hiding the Admin link is cosmetic; the server enforces roles.
// - All server data is rendered with textContent, never innerHTML (no XSS sinks).

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

let currentUser = null;

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: options.body ? { 'Content-Type': 'application/json' } : {},
    ...options,
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON body */ }
  return { status: res.status, ok: res.ok, data };
}

function showMessage(el, text, kind) {
  el.textContent = text;
  el.className = `msg ${kind || ''}`;
}

function errorText(data, fallback) {
  if (!data) return fallback;
  if (Array.isArray(data.errors) && data.errors.length) return data.errors.join(' ');
  return data.error || fallback;
}

// ---------- session state ----------

async function refreshSession() {
  const { ok, data } = await api('/api/auth/session');
  currentUser = ok && data.authenticated ? data.user : null;
  $('#whoami').textContent = currentUser ? `${currentUser.username} · ${currentUser.role}` : 'Not logged in';
  $('#whoami').dataset.role = currentUser ? currentUser.role : '';
  $('#logout-btn').hidden = !currentUser;
  $$('[data-guest]').forEach((a) => { a.hidden = !!currentUser; });
  $$('[data-auth]').forEach((a) => { a.hidden = !currentUser; });
  $$('[data-admin]').forEach((a) => { a.hidden = !(currentUser && currentUser.role === 'admin'); });
}

// ---------- views ----------

const loaders = {
  async home() {
    const { data } = await api('/api/public');
    $('#public-data').textContent = JSON.stringify(data, null, 2);
  },
  async dashboard() {
    const { status, data } = await api('/api/user/dashboard');
    if (status === 401) return go('login', 'Please log in to view your dashboard.');
    $('#dashboard-data').textContent = JSON.stringify(data, null, 2);
  },
  async admin() {
    const { status, data } = await api('/api/admin/users');
    const msg = $('#admin-msg');
    const tbody = $('#admin-users');
    const metrics = $('#admin-metrics');
    tbody.replaceChildren();
    metrics.replaceChildren();
    if (status === 401) return go('login', 'Please log in first.');
    if (status === 403) return showMessage(msg, '403 Forbidden: the server refused. Your account does not have the admin role.', 'error');
    showMessage(msg, '', '');
    for (const [label, value] of Object.entries(data.metrics)) {
      const div = document.createElement('div');
      div.className = 'metric';
      const b = document.createElement('b'); b.textContent = String(value);
      const s = document.createElement('span'); s.textContent = label.replace(/([A-Z])/g, ' $1').toLowerCase();
      div.append(b, s);
      metrics.append(div);
    }
    for (const u of data.users) {
      const tr = document.createElement('tr');
      for (const v of [u.id, u.username, u.role, u.created_at]) {
        const td = document.createElement('td'); td.textContent = String(v); tr.append(td);
      }
      tbody.append(tr);
    }
  },
};

let pendingLoginNotice = '';

function go(view, notice) {
  if (notice) pendingLoginNotice = notice;
  if (location.hash !== `#${view}`) location.hash = view;
  else render();
}

async function render() {
  const view = (location.hash || '#home').slice(1);
  const known = ['home', 'register', 'login', 'dashboard', 'admin'];
  const name = known.includes(view) ? view : 'home';
  $$('.view').forEach((v) => { v.hidden = v.id !== `view-${name}`; });
  $$('nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === name));
  if (name === 'login' && pendingLoginNotice) {
    showMessage($('#login-form .msg'), pendingLoginNotice, 'error');
    pendingLoginNotice = '';
  }
  if (loaders[name]) await loaders[name]();
}

// ---------- forms ----------

function clientValidate(form) {
  // Usability only. The server re-validates everything.
  const u = form.username.value.trim();
  const p = form.password.value;
  if (!u || !p) return 'Username and password are required.';
  if (form.id === 'register-form') {
    if (!form.username.checkValidity()) return 'Username must be 3–32 characters: letters, numbers, _ . -';
    if (p.length < 10) return 'Password must be at least 10 characters.';
  }
  return '';
}

$('#register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const msg = form.querySelector('.msg');
  const problem = clientValidate(form);
  if (problem) return showMessage(msg, problem, 'error');
  const { ok, data } = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username: form.username.value.trim(), password: form.password.value }),
  });
  if (!ok) return showMessage(msg, errorText(data, 'Registration failed.'), 'error');
  form.reset();
  showMessage(msg, data.message, 'success');
});

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const msg = form.querySelector('.msg');
  const problem = clientValidate(form);
  if (problem) return showMessage(msg, problem, 'error');
  const { ok, data } = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: form.username.value.trim(), password: form.password.value }),
  });
  form.password.value = '';
  if (!ok) return showMessage(msg, errorText(data, 'Login failed.'), 'error');
  showMessage(msg, '', '');
  form.reset();
  await refreshSession();
  go('dashboard');
});

$('#logout-btn').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST', body: '{}' });
  await refreshSession();
  go('home');
});

// ---------- access tester ----------

$$('[data-probe]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const path = btn.dataset.probe;
    const { status, data } = await api(path);
    const li = document.createElement('li');
    li.className = status < 300 ? 'ok' : 'bad';
    const code = document.createElement('b'); code.textContent = String(status);
    const text = document.createElement('span');
    text.textContent = ` GET ${path} as ${currentUser ? `${currentUser.username} (${currentUser.role})` : 'anonymous'}: ${data && (data.error || data.message) || ''}`;
    li.append(code, text);
    $('#probe-log').prepend(li);
  });
});

window.addEventListener('hashchange', render);
refreshSession().then(render);
