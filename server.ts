import 'dotenv/config';
import path from 'path';
import { pathToFileURL } from 'url';
import express, { Express } from 'express';
import cookieParser from 'cookie-parser';
import { openDatabase, DbInstance } from './server/db/database';
import { initSchema } from './server/db/schema';
import { getSchemaVersion } from './server/db/migrations';
import { seedDatabase } from './server/db/seed';
import { attachSessionUser } from './server/middleware/auth';
import { createAuthRouter } from './server/modules/auth';
import { createBootstrapRouter } from './server/modules/bootstrap';
import { createProfilesRouter } from './server/modules/profiles';
import { createMarketplaceRouter } from './server/modules/marketplace';
import { createEventsRouter } from './server/modules/events';
import { createVenuesRouter } from './server/modules/venues';
import { createProductionRouter } from './server/modules/production';
import { createEcosystemRouter } from './server/modules/ecosystem';
import { createCommunicationsRouter } from './server/modules/communications';
import { createAdminRouter } from './server/modules/admin';
import { createMediaRouter } from './server/modules/media';
import { createGeoRouter } from './server/modules/geo';
import { createDirectoryRouter } from './server/modules/directory';
import { createSocialRouter } from './server/modules/social';
import { createFeedRouter } from './server/modules/feed';
import { createCommunitiesRouter } from './server/modules/communities';
import { createSearchRouter } from './server/modules/search';
import type http from 'http';
import { createStorageAdapter, getUploadRoot } from './server/services/storageAdapter';
import {
  createRealtimeHub,
  registerDbRealtimeHub,
  RealtimeHub,
} from './server/services/realtimeHub';

export function createApp(options?: { dbPath?: string; uploadDir?: string }): {
  app: Express;
  db: DbInstance;
  realtimeHub: RealtimeHub;
  attachWebSocket: (server: http.Server) => void;
} {
  const db = openDatabase(options?.dbPath);
  initSchema(db);
  seedDatabase(db);

  const realtimeHub = createRealtimeHub(db);
  registerDbRealtimeHub(db, realtimeHub);

  const storageAdapter = createStorageAdapter(options?.uploadDir);
  const uploadRoot = getUploadRoot(options?.uploadDir);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
    next();
  });
  app.use(express.json({ limit: '5mb' }));
  app.use(cookieParser());
  app.use(attachSessionUser(db));

  app.use(
    '/uploads',
    express.static(uploadRoot, {
      dotfiles: 'deny',
      maxAge: '7d',
      setHeaders: (res) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
      },
    })
  );

  app.get('/api/health', (_req, res) => {
    try {
      const check = db.prepare('SELECT 1 as ok').get() as { ok: number } | undefined;
      if (check?.ok !== 1) {
        return res.status(503).json({
          ok: false,
          service: 'sanatsahnede-api',
          dbReady: false,
          timestamp: new Date().toISOString(),
        });
      }
      return res.json({
        ok: true,
        service: 'sanatsahnede-api',
        dbReady: true,
        dbSchemaVersion: getSchemaVersion(db),
        timestamp: new Date().toISOString(),
      });
    } catch {
      return res.status(503).json({
        ok: false,
        service: 'sanatsahnede-api',
        dbReady: false,
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.use('/api/auth', createAuthRouter(db));
  app.use('/api/media', createMediaRouter(db, storageAdapter));
  app.use('/api/geo', createGeoRouter(db));
  app.use('/api/social', createSocialRouter(db));
  app.use('/api/feed', createFeedRouter(db));
  app.use('/api/communities', createCommunitiesRouter(db, realtimeHub));
  app.use('/api', createSearchRouter(db));
  app.use('/api', createDirectoryRouter(db));
  app.use('/api', createBootstrapRouter(db));
  app.use('/api', createProfilesRouter(db));
  app.use('/api', createMarketplaceRouter(db));
  app.use('/api/events', createEventsRouter(db));
  app.use('/api', createVenuesRouter(db));
  app.use('/api', createProductionRouter(db));
  app.use('/api', createEcosystemRouter(db));
  app.use('/api', createCommunicationsRouter(db, realtimeHub));
  app.use('/api/admin', createAdminRouter(db));

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API uç noktası bulunamadı.' });
  });

  app.use('/api', (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[API Error]', err);
    if (res.headersSent) return;
    const status = typeof err?.status === 'number' ? err.status : 500;
    res.status(status).json({
      error: status >= 500 ? 'Sunucu geçici bir hata ile karşılaştı.' : err?.message || 'İstek işlenemedi.',
    });
  });

  return {
    app,
    db,
    realtimeHub,
    attachWebSocket: (server: http.Server) => realtimeHub.attachToServer(server),
  };
}

async function startServer() {
  const { app, attachWebSocket } = createApp();
  const isProd = process.env.NODE_ENV === 'production';

  app.use('/src/assets/images', express.static(path.resolve(process.cwd(), 'src/assets/images')));

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT || 3000);
  const httpServer = app.listen(port, '0.0.0.0', () => {
    console.log(`SanatSahnede full-stack server running on http://0.0.0.0:${port}`);
  });
  attachWebSocket(httpServer);
}

const isDirectExecution =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution && process.env.NODE_ENV !== 'test') {
  startServer().catch((err) => {
    console.error('Failed to start SanatSahnede server:', err);
    process.exit(1);
  });
}
