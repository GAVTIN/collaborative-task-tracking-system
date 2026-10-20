/**
 * Process entry point: migrate the database, open the port, and shut down cleanly on SIGINT/SIGTERM.
 */
import { createApp } from './app.js';
import config from './config/index.js';
import db from './db/index.js';
import { migrate } from './db/migrate.js';
import { purgeExpiredTokens } from './modules/auth/tokens.js';
import hub from './modules/notifications/hub.js';

const applied = migrate();
if (applied > 0) console.log(`[db] applied ${applied} migration(s)`);
purgeExpiredTokens();

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`[server] Task Tracker API listening on http://localhost:${config.port} (${config.env})`);
  console.log(`[server] health check: http://localhost:${config.port}/health`);
});

// Hourly housekeeping of the logout deny-list. unref() so the timer never blocks shutdown.
setInterval(purgeExpiredTokens, 60 * 60 * 1000).unref();

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[server] ${signal} received, shutting down...`);

  hub.closeAll(); // end open SSE streams, otherwise server.close() would wait for them forever
  server.close(() => {
    db.close();
    console.log('[server] shutdown complete');
    process.exit(0);
  });
  server.closeIdleConnections?.();
  setTimeout(() => process.exit(1), 10_000).unref(); // last-resort kill switch
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
