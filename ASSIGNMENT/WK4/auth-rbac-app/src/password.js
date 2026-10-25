'use strict';
// Password hashing with scrypt: a salted, deliberately slow, memory-hard KDF
// (listed alongside Argon2id and bcrypt in the OWASP Password Storage Cheat Sheet).
// Parameters follow OWASP's recommended minimum: N=2^17, r=8, p=1.
//
// Stored format (self-describing, so parameters can be raised later):
//   scrypt$N$r$p$<salt base64>$<hash base64>

const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);

const PARAMS = { N: 2 ** 17, r: 8, p: 1 };
const KEY_LEN = 64;
const SALT_LEN = 16;
const MAXMEM = 256 * 1024 * 1024;

async function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_LEN); // unique random salt per password
  const key = await scrypt(password.normalize('NFKC'), salt, KEY_LEN, { ...PARAMS, maxmem: MAXMEM });
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), key.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(N), r: Number(r), p: Number(p), maxmem: MAXMEM,
  });
  // Constant-time comparison so response timing doesn't reveal how many bytes matched.
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

// A real hash of a random value. Used when the username doesn't exist so that
// login takes the same time either way (prevents timing-based user enumeration).
let dummyHashPromise;
function getDummyHash() {
  if (!dummyHashPromise) dummyHashPromise = hashPassword(crypto.randomBytes(16).toString('hex'));
  return dummyHashPromise;
}

module.exports = { hashPassword, verifyPassword, getDummyHash };
