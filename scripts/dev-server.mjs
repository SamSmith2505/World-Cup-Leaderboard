// Local dev server (no Vercel/KV needed): static files + in-memory /api routes.
// Run: node scripts/dev-server.mjs   then open http://localhost:5173
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rosterFromCSV, ROSTER_FALLBACK } from '../lib/roster.js';
import { ROSTER_CSV_URL } from '../lib/config.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.PORT || 5173;
const STATE_FILE = path.join(ROOT, '.devstate.json');

let store = readStore();
function readStore() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return { state: { matches: [], advancement: {}, meta: { lastUpdated: null } }, snapshot: null }; }
}
function writeStore() { fs.writeFileSync(STATE_FILE, JSON.stringify(store, null, 2)); }

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.ico': 'image/x-icon' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  if (p === '/api/roster') {
    let roster = ROSTER_FALLBACK, source = 'fallback';
    try {
      const r = await fetch(ROSTER_CSV_URL);
      if (r.ok) { const rr = rosterFromCSV(await r.text()); if (rr.length) { roster = rr; source = 'sheet'; } }
    } catch {}
    return json(res, { roster, source });
  }

  if (p === '/api/sync') {
    // No API key locally -> behave like the real handler with no key configured.
    return json(res, { ok: false, configured: false, message: 'dev: no API key' });
  }

  if (p === '/api/state') {
    if (req.method === 'GET') return json(res, store);
    if (req.method === 'POST') {
      const body = await readBody(req);
      if (body.action === 'snapshot') { store.snapshot = { standings: body.standings || [], at: body.at }; writeStore(); return json(res, { ok: true }); }
      store.state = body.state || store.state;
      store.state.meta = store.state.meta || {};
      store.state.meta.lastUpdated = body.at || store.state.meta.lastUpdated;
      writeStore();
      return json(res, { ok: true, state: store.state });
    }
  }

  // static
  let file = p === '/' ? '/index.html' : p;
  const full = path.join(ROOT, file);
  if (!full.startsWith(ROOT)) { res.writeHead(403); return res.end('no'); }
  try {
    const data = await fsp.readFile(full);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch { res.writeHead(404); res.end('not found'); }
});

function json(res, obj) { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); }
function readBody(req) {
  return new Promise((resolve) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } }); });
}

server.listen(PORT, () => console.log(`dev server: http://localhost:${PORT}  (admin: http://localhost:${PORT}/admin-3f9a2c7b.html)`));
