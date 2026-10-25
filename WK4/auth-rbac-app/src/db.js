'use strict';
// SQLite via Node's built-in node:sqlite module. All queries use prepared
// statements with bound parameters, so user input is never concatenated into SQL.

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function openDb(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Only a SHA-256 hash of each session token is stored. If the database leaks,
    -- the attacker can't use the rows to hijack live sessions.
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash  TEXT PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at  INTEGER NOT NULL,
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  `);

  const q = {
    insertUser: db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)'),
    userByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
    // Public projection: never selects password_hash.
    publicUserById: db.prepare('SELECT id, username, role, created_at FROM users WHERE id = ?'),
    listPublicUsers: db.prepare('SELECT id, username, role, created_at FROM users ORDER BY id'),
    countUsers: db.prepare("SELECT role, COUNT(*) AS count FROM users GROUP BY role"),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)'),
    sessionUser: db.prepare(`
      SELECT u.id, u.username, u.role, u.created_at, s.expires_at
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    deleteExpiredSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
    countActiveSessions: db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE expires_at > ?'),
  };

  return { db, q };
}

module.exports = { openDb };
