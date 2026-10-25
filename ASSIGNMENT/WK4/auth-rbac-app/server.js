'use strict';
const http = require('node:http');
const config = require('./src/config');
const { createApp } = require('./src/app');

async function main() {
  const app = createApp(config);
  if (await app.seedAdmin()) {
    console.log(`[seed] Admin account "${config.adminUsername}" created from environment variables.`);
  } else if (!config.adminUsername) {
    console.warn('[seed] ADMIN_USERNAME / ADMIN_PASSWORD not set; no admin account seeded. See .env.example.');
  }

  const server = http.createServer(app.handler);
  server.headersTimeout = 15_000;
  server.requestTimeout = 30_000;
  server.listen(config.port, () => {
    console.log(`Auth + RBAC demo listening on http://localhost:${config.port} (${config.isProduction ? 'production' : 'development'})`);
  });

  const shutdown = () => server.close(() => { app.close(); process.exit(0); });
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
