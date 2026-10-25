'use strict';
// Server-side input validation. Client-side checks exist for usability only;
// these are the ones that actually protect the system.

const USERNAME_RE = /^[A-Za-z0-9_.-]{3,32}$/;
const PASSWORD_MIN = 10;
const PASSWORD_MAX = 128; // upper bound stops huge inputs being fed to the slow hash (DoS)

function validateCredentials(body, { forRegistration }) {
  const errors = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { errors: ['Request body must be a JSON object.'] };
  }
  const { username, password } = body;

  if (typeof username !== 'string' || username.trim() === '') errors.push('Username is required.');
  if (typeof password !== 'string' || password === '') errors.push('Password is required.');
  if (errors.length) return { errors };

  const u = username.trim();
  if (password.length > PASSWORD_MAX) errors.push(`Password must be at most ${PASSWORD_MAX} characters.`);

  if (forRegistration) {
    if (!USERNAME_RE.test(u)) {
      errors.push('Username must be 3-32 characters: letters, numbers, underscore, dot or hyphen.');
    }
    if (password.length < PASSWORD_MIN) errors.push(`Password must be at least ${PASSWORD_MIN} characters.`);
    if (password.toLowerCase().includes(u.toLowerCase())) errors.push('Password must not contain the username.');
  } else if (u.length > 64) {
    errors.push('Invalid username or password.');
  }

  return { errors, username: u, password };
}

module.exports = { validateCredentials, USERNAME_RE, PASSWORD_MIN, PASSWORD_MAX };
