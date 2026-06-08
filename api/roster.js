// ============================================================================
// /api/roster — live roster from the Google Sheet (with fallback snapshot).
//   GET -> { roster: [{name, picks:[...]}], source: 'sheet'|'fallback' }
// Cached for a few minutes so new sheet entries appear without a redeploy but we
// don't hammer Google on every page load.
// ============================================================================

import { ROSTER_CSV_URL } from '../lib/config.js';
import { rosterFromCSV, ROSTER_FALLBACK } from '../lib/roster.js';

let cache = { at: 0, roster: null };
const TTL_MS = 3 * 60 * 1000;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const now = Date.now();
  if (cache.roster && now - cache.at < TTL_MS) {
    return res.status(200).json({ roster: cache.roster, source: 'sheet-cached' });
  }

  try {
    const r = await fetch(ROSTER_CSV_URL, { redirect: 'follow' });
    if (!r.ok) throw new Error('sheet status ' + r.status);
    const text = await r.text();
    const roster = rosterFromCSV(text);
    if (!roster.length) throw new Error('empty roster');
    cache = { at: now, roster };
    return res.status(200).json({ roster, source: 'sheet' });
  } catch (e) {
    return res.status(200).json({ roster: ROSTER_FALLBACK, source: 'fallback', error: String(e) });
  }
}
