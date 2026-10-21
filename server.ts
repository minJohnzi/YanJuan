import path from 'node:path';
import express from 'express';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { createApiV1Router } from './src/server/apiRouter.ts';
import { assertProductionMasterKeyConfigured } from './src/server/securityAndCrypto.ts';

function buildFirebaseVerifyIdTokenFn():
  | ((token: string) => Promise<{ uid: string; email?: string }>)
  | undefined {
  const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!rawServiceAccount) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(rawServiceAccount);
    if (getApps().length === 0) {
      initializeApp({
        credential: cert(parsed),
      });
    }
    return async (token: string) => {
      const decoded = await getAuth().verifyIdToken(token);
      return {
        uid: decoded.uid,
        email: decoded.email,
      };
    };
  } catch (err) {
    console.error('[server] Failed to initialize Firebase Admin SDK:', err);
    return undefined;
  }
}

async function startServer() {
  assertProductionMasterKeyConfigured();

  const app = express();
  const PORT = Number(process.env.PORT || 3000);
  const rootDir = process.cwd();

  app.get('/healthz', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  const verifyIdTokenFn = buildFirebaseVerifyIdTokenFn();
  const { router: apiRouter } = createApiV1Router({
    rootDir,
    verifyIdTokenFn,
  });

  app.use('/api/v1', apiRouter);
  app.use('/api', apiRouter);

  // Serve static generated data & extracted images
  app.use('/data', express.static(path.join(rootDir, 'data')));

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(rootDir, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

