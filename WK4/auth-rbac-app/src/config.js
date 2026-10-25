'use strict';
// All secrets and environment-specific settings come from environment variables
// (loaded from .env by `node --env-file-if-exists=.env`). Nothing secret is hardcoded.

const env = process.env;
const isProduction = env.NODE_ENV === 'production';

const config = {
  isProduction,
  port: Number(env.PORT) || 3000,
  dbPath: env.DB_PATH || 'data/app.db',
  sessionTtlMinutes: Number(env.SESSION_TTL_MINUTES) || 120,
  // Cookies get the Secure flag in production (HTTPS). Locally over http they can't.
  cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : isProduction,
  adminUsername: env.ADMIN_USERNAME || '',
  adminPassword: env.ADMIN_PASSWORD || '',
  loginMaxAttempts: Number(env.LOGIN_MAX_ATTEMPTS) || 5,          // per account
  loginMaxAttemptsPerIp: Number(env.LOGIN_MAX_ATTEMPTS_PER_IP) || 50, // per client IP
  loginWindowMinutes: Number(env.LOGIN_WINDOW_MINUTES) || 15,
  trustProxy: env.TRUST_PROXY === 'true',
};

if (isProduction && config.adminPassword && config.adminPassword.length < 12) {
  throw new Error('ADMIN_PASSWORD must be at least 12 characters in production.');
}

module.exports = config;
