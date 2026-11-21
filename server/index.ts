import 'dotenv/config';
import { createApp } from './app.ts';
import { TelemetryProvider } from './telemetryProvider.ts';

const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || '127.0.0.1';

const provider = new TelemetryProvider();
const app = createApp({ provider });

const server = app.listen(port, host, () => {
  console.log(
    `[WildPulse Proxy] Listening on http://${host}:${port} (Movebank Direct-Read Auth: ${
      provider.movebank.isAuthConfigured() ? 'configured' : 'public-only'
    })`,
  );
});

process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
