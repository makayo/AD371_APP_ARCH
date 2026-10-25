'use strict';
// Prints the users table so you can show (e.g. in your video) that passwords are
// stored as salted scrypt hashes, not plaintext. Run: npm run db:inspect
const { DatabaseSync } = require('node:sqlite');
const dbPath = process.env.DB_PATH || 'data/app.db';
const db = new DatabaseSync(dbPath, { readOnly: true });

console.log(`\nDatabase: ${dbPath}\n`);
const users = db.prepare('SELECT id, username, role, password_hash, created_at FROM users ORDER BY id').all();
for (const u of users) {
  const [alg, N, r, p, salt, hash] = u.password_hash.split('$');
  console.log(`#${u.id}  ${u.username}  [${u.role}]  created ${u.created_at}`);
  console.log(`    algorithm=${alg}  N=${N} r=${r} p=${p}`);
  console.log(`    salt=${salt}`);
  console.log(`    hash=${hash.slice(0, 44)}...`);
}
const sessions = db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE expires_at > ?').get(Date.now());
console.log(`\nActive sessions: ${sessions.n} (stored as SHA-256 hashes of the cookie token)\n`);
db.close();
