import 'dotenv/config';
import path from 'node:path';
import express from 'express';
import { createApiV1Router } from './src/server/apiRouter.ts';
import { assertProductionMasterKeyConfigured } from './src/server/securityAndCrypto.ts';

async function startServer() {
  assertProductionMasterKeyConfigured();

  const app = express();
  const PORT = Number(process.env.PORT || 3000);
  const rootDir = process.cwd();

  app.get('/healthz', (_req, res) => {
    res.status(200).json({ status: 'ok', storageEngine: 'node:sqlite' });
  });

  const { router: apiRouter } = createApiV1Router({ rootDir });

  app.use('/api/v1', apiRouter);
  app.use('/api', apiRouter);

  // Serve generated data read-only from canonical data/ directory
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
