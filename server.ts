import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { runPaperBuildPipeline } from './src/pipeline/buildPipeline.ts';
import { createApiV1Router } from './src/server/apiRouter.ts';

async function startServer() {
  const rootDir = process.cwd();

  // Ensure initial paper build has run so /data and /public/data are populated
  if (!fs.existsSync(path.join(rootDir, 'data', 'papers-manifest.json'))) {
    runPaperBuildPipeline(rootDir);
  }

  const app = express();
  const port = Number(process.env.PORT) || 3000;

  // Mount /api/v1 REST endpoints (and /YANJUAN/api/v1 alias)
  const { router: apiV1Router } = createApiV1Router({ rootDir });
  app.use('/api/v1', apiV1Router);
  app.use('/YANJUAN/api/v1', apiV1Router);

  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(rootDir, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`[Yanjuan Desk] Server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
