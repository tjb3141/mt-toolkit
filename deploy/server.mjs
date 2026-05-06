// Node entry point that runs the Expo server build.
// Started by systemd (mt-toolkit.service) after `npm run build`.
//
// Reads PORT from env (default 3000). Listens on localhost only —
// Caddy fronts it for TLS and static assets.

import { createRequestHandler } from '@expo/server/adapter/express.js';
import express from 'express';
import compression from 'compression';
import morgan from 'morgan';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '..', 'dist');

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';

const app = express();
app.disable('x-powered-by');
app.use(compression());
app.use(morgan('tiny'));

// Static client assets — Caddy will normally serve these directly,
// but this fallback keeps the server usable on its own.
app.use(express.static(path.join(distDir, 'client'), { maxAge: '1h', extensions: ['html'] }));

// All remaining routes go through Expo Router (pages + API).
app.all('*', createRequestHandler({ build: path.join(distDir, 'server') }));

app.listen(port, host, () => {
  console.log(`[mt-toolkit] listening on http://${host}:${port}`);
});
