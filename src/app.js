import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import config from './config/index.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { generalLimiter } from './middleware/rate-limit.js';
import routes from './routes.js';

/**
 * Builds the Express application. Kept separate from `server.js` (which opens the port) so tests can
 * import the app and drive it with supertest without binding to a network port.
 */
export function createApp() {
  const app = express();

  if (config.trustProxy) app.set('trust proxy', config.trustProxy);

  app.use(helmet()); // sensible security headers
  app.use(
    cors({
      origin: config.corsOrigins.includes('*') ? '*' : config.corsOrigins,
      exposedHeaders: ['Location', 'RateLimit', 'RateLimit-Policy', 'Content-Disposition'],
    })
  );
  if (!config.isTest) app.use(morgan(config.isProd ? 'combined' : 'dev'));
  app.use(express.json({ limit: '100kb' }));

  // Liveness probe for load balancers / uptime checks (no auth, no database).
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
  });

  app.use('/api', generalLimiter, routes);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
