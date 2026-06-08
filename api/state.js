// ============================================================================
// /api/state — read & write the pool's results/overrides.
//   GET  -> { state, snapshot }
//   POST -> replace state (admin). { state, at, token? }
//   POST { action: 'snapshot', standings } -> freeze standings for "movers".
// ============================================================================

import { getState, setState, getSnapshot, setSnapshot, EMPTY_STATE } from '../lib/store.js';

function adminOk(provided) {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return true; // no token configured -> rely on unlisted route
  return provided === token;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    const [state, snapshot] = await Promise.all([getState(), getSnapshot()]);
    return res.status(200).json({ state, snapshot });
  }

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    const provided = req.headers['x-admin-token'] || body?.token;
    if (!adminOk(provided)) return res.status(401).json({ error: 'unauthorized' });

    if (body?.action === 'snapshot') {
      await setSnapshot({ standings: body.standings || [], at: body.at || null });
      return res.status(200).json({ ok: true });
    }

    const incoming = body?.state || EMPTY_STATE;
    incoming.meta = incoming.meta || {};
    incoming.meta.lastUpdated = body?.at || incoming.meta.lastUpdated || null;
    // Preserve lastSyncAt from existing state if the admin payload omits it.
    if (incoming.meta.lastSyncAt == null) {
      const prev = await getState();
      incoming.meta.lastSyncAt = prev?.meta?.lastSyncAt ?? null;
    }
    await setState(incoming);
    return res.status(200).json({ ok: true, state: incoming });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'method not allowed' });
}
