// Lokale Vorschau: liefert public/ aus und beantwortet /api/kurse mit dem echten Worker-Code.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import worker from '../worker/index.js';

const WURZEL = new URL('../public/', import.meta.url).pathname;
const TYPEN = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const port = Number(process.env.PORT || 8788);

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  if (url.pathname.startsWith('/api/')) {
    const antwort = await worker.fetch(new Request(url));
    res.writeHead(antwort.status, Object.fromEntries(antwort.headers));
    return res.end(await antwort.text());
  }
  const pfad = normalize(join(WURZEL, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!pfad.startsWith(WURZEL)) { res.writeHead(403); return res.end(); }
  try { res.writeHead(200, { 'Content-Type': TYPEN[extname(pfad)] || 'application/octet-stream' }); res.end(await readFile(pfad)); }
  catch { res.writeHead(404); res.end(); }
}).listen(port, () => console.log(`Vorschau: http://localhost:${port}/`));
