import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { TelemetryProvider } from './telemetryProvider.ts';

export interface CreateAppOptions {
  provider?: TelemetryProvider;
  distDir?: string;
}

export function createApp(options?: CreateAppOptions) {
  const app = express();
  const provider = options?.provider ?? new TelemetryProvider();
  const distDir = options?.distDir ?? path.resolve(process.cwd(), 'dist');

  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json(provider.getHealth());
  });

  app.get('/api/fleet', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const fleet = await provider.getFleet({ includeDemoSeed: true });
      res.json(fleet);
    } catch (err) {
      next(err);
    }
  });

  app.get(
    '/api/studies/:studyId',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const studyId = String(req.params.studyId ?? '').trim();
        if (!studyId || !/^[a-zA-Z0-9_-]+$/.test(studyId)) {
          res.status(400).json({
            studyId,
            diagnosticStatus: 'TAG_SILENT',
            feedStatus: 'LIVE_API',
            animals: [],
            licenseTermsText: null,
            licenseMd5: null,
            message: 'Invalid Movebank Study ID format.',
          });
          return;
        }

        const licenseMd5Raw = req.query.licenseMd5;
        const licenseMd5 =
          typeof licenseMd5Raw === 'string' && licenseMd5Raw.trim().length > 0
            ? licenseMd5Raw.trim()
            : undefined;

        const studyRes = await provider.getStudy(studyId, licenseMd5);
        res.json(studyRes);
      } catch (err) {
        next(err);
      }
    },
  );

  app.get(
    '/api/atn/marine',
    async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const fleet = await provider.getAtnMarineFleet();
        res.json(fleet);
      } catch (err) {
        next(err);
      }
    },
  );

  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'Unknown telemetry proxy endpoint' });
  });

  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('*', (req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith('/api')) {
        next();
        return;
      }
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        next();
      }
    });
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : 'Internal telemetry proxy error';
    res.status(500).json({ error: message });
  });

  return app;
}
