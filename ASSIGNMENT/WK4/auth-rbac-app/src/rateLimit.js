'use strict';
// Simple in-memory limiter for failed logins (brute force / credential stuffing).
// Keyed by IP and by username, so one attacker can't hammer one account, and one
// IP can't spray many accounts. In a multi-instance deployment, move this to Redis.

function createLimiter({ max, windowMs }) {
  const hits = new Map(); // key -> { count, resetAt }

  function entry(key) {
    const now = Date.now();
    let e = hits.get(key);
    if (!e || e.resetAt <= now) {
      e = { count: 0, resetAt: now + windowMs };
      hits.set(key, e);
    }
    return e;
  }

  return {
    isBlocked(keys) {
      return keys.some((k) => entry(k).count >= max);
    },
    retryAfterSeconds(keys) {
      const now = Date.now();
      return Math.max(1, Math.ceil(Math.max(...keys.map((k) => entry(k).resetAt - now)) / 1000));
    },
    fail(keys) {
      for (const k of keys) entry(k).count += 1;
    },
    reset(keys) {
      for (const k of keys) hits.delete(k);
    },
    sweep() {
      const now = Date.now();
      for (const [k, e] of hits) if (e.resetAt <= now) hits.delete(k);
    },
  };
}

module.exports = { createLimiter };
