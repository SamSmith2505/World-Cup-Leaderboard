// ============================================================================
// /api/state — read & write the pool's results/overrides.
//   GET  -> current state { matches, advancement, meta }
//   POST -> replace state (admin). Body must include the admin token.
//   POST { action: 'snapshot' } -> store the current standings for "movers".
// ----------------------------------------------------------------------------
// Storage: Vercel KV (@vercel/kv) when KV env vars are present; otherwise falls
// back to a local JSON file so it works in `vercel dev` / local node without KV.
// ============================================================================

import { createClient } from '@vercel/kv';
import fs from 'node:fs/promises';
import path from 'node:path';

const STATE_KEY = 'wc:state';
const SNAP_KEY = 'wc:snapshot';
const LOCAL_FILE = path.join('/tmp', 'wc-state.json');

// Accept either Vercel KV or raw Upstash env var naming.
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const useKV = !!(KV_URL && KV_TOKEN);
const kv = useKV ? createClient({ url: KV_URL, token: KV_TOKEN }) : null;

const EMPTY_STATE = { matches: [], advancement: {}, meta: { lastUpdated: null } };

async function readKey(key, fallback) {
  if (useKV) {
    const v = await kv.get(key);
    return v ?? fallback;
  }
  try {
    const raw = await fs.readFile(LOCAL_FILE, 'utf8');
    const all = JSON.parse(raw);
    return all[key] ?? fallback;
  } catch {
    return fallback;
  }
}

async function writeKey(key, value) {
  if (useKV) {
    await kv.set(key, value);
    return;
  }
  let all = {};
  try { all = JSON.parse(await fs.readFile(LOCAL_FILE, 'utf8')); } catch {}
  all[key] = value;
  await fs.writeFile(LOCAL_FILE, JSON.stringify(all, null, 2));
}

function adminOk(req) {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return true; // no token configured -> allow (unlisted-route gating)
  const provided = req.headers['x-admin-token'] || req.body?.token;
  return provided === token;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    const state = await readKey(STATE_KEY, EMPTY_STATE);
    const snapshot = await readKey(SNAP_KEY, null);
    return res.status(200).json({ state, snapshot });
  }

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    if (!adminOk({ ...req, body })) return res.status(401).json({ error: 'unauthorized' });

    if (body?.action === 'snapshot') {
      // Caller computes standings client-side and posts them to freeze "today".
      await writeKey(SNAP_KEY, { standings: body.standings || [], at: body.at || null });
      return res.status(200).json({ ok: true });
    }

    const incoming = body?.state || EMPTY_STATE;
    incoming.meta = incoming.meta || {};
    incoming.meta.lastUpdated = body?.at || incoming.meta.lastUpdated || null;
    await writeKey(STATE_KEY, incoming);
    return res.status(200).json({ ok: true, state: incoming });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'method not allowed' });
}
