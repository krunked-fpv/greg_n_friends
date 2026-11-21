import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.resolve(__dirname, '..', 'dist');

const SUBPATH = '/wildpulse';
const SUBPATH_PREFIX = `${SUBPATH}/`;

const parsedPort = Number.parseInt(process.env.SUBPATH_PORT ?? '4273', 10);
const PORT = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 4273;

const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.mjs', 'application/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.geojson', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.map', 'application/json; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

function sendPlain(res, statusCode, message) {
  const body = `${message}\n`;
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES.get(ext) ?? 'application/octet-stream';
}

export function createSubpathPreviewServer(distDir = DIST_DIR) {
  const resolvedDist = path.resolve(distDir);
  const distPrefix = resolvedDist.endsWith(path.sep)
    ? resolvedDist
    : `${resolvedDist}${path.sep}`;

  return http.createServer(async (req, res) => {
    const method = (req.method ?? 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405, {
        Allow: 'GET, HEAD',
        'Content-Type': 'text/plain; charset=utf-8',
      });
      res.end('Method Not Allowed\n');
      return;
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
    } catch {
      sendPlain(res, 400, 'Bad Request');
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(parsedUrl.pathname);
    } catch {
      sendPlain(res, 400, 'Malformed URI');
      return;
    }

    // Redirect bare /wildpulse -> /wildpulse/ just like GitHub Pages project hosting
    if (pathname === SUBPATH) {
      res.writeHead(301, {
        Location: `${SUBPATH_PREFIX}${parsedUrl.search}`,
        'Cache-Control': 'no-store',
      });
      res.end();
      return;
    }

    // Reject /api/* and any request outside /wildpulse/ with 404
    if (!pathname.startsWith(SUBPATH_PREFIX)) {
      sendPlain(res, 404, 'Not Found');
      return;
    }

    const relativeSubpath = pathname.slice(SUBPATH_PREFIX.length).replace(/^\/+/, '');
    if (relativeSubpath === 'api' || relativeSubpath.startsWith('api/')) {
      sendPlain(res, 404, 'Not Found');
      return;
    }

    const candidateRel = relativeSubpath === '' ? 'index.html' : relativeSubpath;
    let filePath = path.resolve(resolvedDist, candidateRel);

    if (filePath !== resolvedDist && !filePath.startsWith(distPrefix)) {
      sendPlain(res, 404, 'Not Found');
      return;
    }

    let stat = await fs.promises.stat(filePath).catch(() => null);
    if (!stat) {
      sendPlain(res, 404, 'Not Found');
      return;
    }

    if (stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      stat = await fs.promises.stat(filePath).catch(() => null);
      if (!stat || !stat.isFile()) {
        sendPlain(res, 404, 'Not Found');
        return;
      }
    } else if (!stat.isFile()) {
      sendPlain(res, 404, 'Not Found');
      return;
    }

    try {
      const content = await fs.promises.readFile(filePath);
      res.writeHead(200, {
        'Content-Type': getMimeType(filePath),
        'Content-Length': content.byteLength,
        'Cache-Control': 'no-cache',
      });
      if (method === 'HEAD') {
        res.end();
      } else {
        res.end(content);
      }
    } catch {
      sendPlain(res, 500, 'Internal Server Error');
    }
  });
}

const isEntrypoint =
  process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isEntrypoint) {
  if (!fs.existsSync(DIST_DIR)) {
    console.warn(
      `[subpath-preview] Warning: "${DIST_DIR}" does not exist yet. Run "npm run build" before requesting /wildpulse/.`,
    );
  }

  const server = createSubpathPreviewServer(DIST_DIR);
  const host = process.env.SUBPATH_HOST;

  const onListening = () => {
    console.log(
      `[subpath-preview] Serving ${DIST_DIR} strictly at http://127.0.0.1:${PORT}${SUBPATH_PREFIX}`,
    );
    console.log(
      `[subpath-preview] /wildpulse -> 301 /wildpulse/ | / & /api/* -> 404`,
    );
  };

  if (host) {
    server.listen(PORT, host, onListening);
  } else {
    server.listen(PORT, onListening);
  }

  const shutdown = () => {
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
