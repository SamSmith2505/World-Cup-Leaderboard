// ============================================================================
// /api/sync — pull World Cup fixtures from API-Football and merge into state.
//   GET/POST            -> sync if not throttled
//   GET/POST ?force=1   -> sync now, ignoring the throttle
// ----------------------------------------------------------------------------
// - Auto-pulled matches are source:'api'. Manual admin entries (source:'manual')
//   ALWAYS win: an API fixture is skipped if a manual entry exists for it.
// - Advancement bonuses are NOT auto-derived — they stay a manual confirm step.
// - Server-side throttle keeps us well under the free 100-req/day limit even if
//   many people open the page at once.
// ============================================================================

import { getState, setState } from '../lib/store.js';
import { canonicalTeam, tierOf, roundFromApi, groupFromApi, ROUND_INDEX, FINAL_STATUSES } from '../lib/config.js';
import { fixtureKey } from '../lib/scoring.js';

// Throttle for NON-forced calls (page visits). The cron uses force=1 and
// bypasses this; keeping it ~= the cron interval means viewer-triggered syncs
// don't add API calls on top of the cron.
const THROTTLE_MS = 20 * 60 * 1000;
const API_BASE = process.env.API_FOOTBALL_BASE || 'https://v3.football.api-sports.io';
const LEAGUE_ID = process.env.WC_LEAGUE_ID || '1'; // API-Football: World Cup = 1
const SEASON = process.env.WC_SEASON || '2026';
// Optional: if set, only force=1 requests carrying this secret bypass the
// throttle (prevents someone draining the daily API quota via the public URL).
const SYNC_SECRET = process.env.SYNC_SECRET || '';

function apiKey() {
  return process.env.APISPORTS_KEY || process.env.API_FOOTBALL_KEY || '';
}
function isManual(m) {
  return m?.source === 'manual' || m?.manual === true;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const wantsForce = (req.query?.force ?? '') === '1' || (req.query?.force ?? '') === 'true';
  const secretOk = !SYNC_SECRET || req.query?.key === SYNC_SECRET || req.headers['x-sync-secret'] === SYNC_SECRET;
  const force = wantsForce && secretOk;

  const key = apiKey();
  if (!key) {
    // TEMP diagnostic: report env-var NAMES (never values) that look key-ish, so
    // we can spot a misnamed/mis-scoped var. Remove after setup is confirmed.
    const SYSTEM = /^(AWS_|VERCEL_|LAMBDA_|_|NODE_|PATH$|PWD$|LANG$|TZ$|HOME$|SHLVL$|NOW_)/;
    const envHints = Object.keys(process.env).filter((k) => !SYSTEM.test(k)).sort();
    return res.status(200).json({ ok: false, configured: false, message: 'No API key set (APISPORTS_KEY). Manual entry still works.', envHints });
  }

  const state = await getState();
  state.meta = state.meta || {};
  const last = state.meta.lastSyncAt ? Date.parse(state.meta.lastSyncAt) : 0;
  if (!force && last && Date.now() - last < THROTTLE_MS) {
    return res.status(200).json({ ok: true, skipped: true, reason: 'throttled', lastSyncAt: state.meta.lastSyncAt });
  }

  let fixtures;
  try {
    const url = `${API_BASE}/fixtures?league=${encodeURIComponent(LEAGUE_ID)}&season=${encodeURIComponent(SEASON)}`;
    const r = await fetch(url, { headers: { 'x-apisports-key': key } });
    const data = await r.json();
    if (!r.ok) throw new Error('API status ' + r.status);
    fixtures = data?.response || [];
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e), message: 'API fetch failed; existing data unchanged.' });
  }

  const apiMatches = [];
  const unmatched = new Set();
  for (const fx of fixtures) {
    const status = fx?.fixture?.status?.short;
    if (!FINAL_STATUSES.has(status)) continue; // only completed matches
    const round = roundFromApi(fx?.league?.round);
    const group = groupFromApi(fx?.league?.round);
    const teamA = canonicalTeam(fx?.teams?.home?.name);
    const teamB = canonicalTeam(fx?.teams?.away?.name);
    const scoreA = Number(fx?.goals?.home) || 0;
    const scoreB = Number(fx?.goals?.away) || 0;

    if (tierOf(teamA) == null) unmatched.add(fx?.teams?.home?.name);
    if (tierOf(teamB) == null) unmatched.add(fx?.teams?.away?.name);

    let winner = null;
    if (scoreA === scoreB && ROUND_INDEX[round]?.knockout) {
      if (fx?.teams?.home?.winner === true) winner = 'A';
      else if (fx?.teams?.away?.winner === true) winner = 'B';
    }

    apiMatches.push({
      id: 'api:' + fx?.fixture?.id,
      source: 'api',
      manual: false,
      round, group, teamA, teamB, scoreA, scoreB,
      winner,
      final: true,
      status,
    });
  }

  // Merge: keep manual entries; add API matches that aren't manually overridden.
  const manual = (state.matches || []).filter(isManual);
  const manualKeys = new Set(manual.map(fixtureKey));
  const freshApi = apiMatches.filter((m) => !manualKeys.has(fixtureKey(m)));

  const now = new Date().toISOString();
  state.matches = [...manual, ...freshApi];
  state.meta.lastSyncAt = now;
  state.meta.lastUpdated = now;
  await setState(state);

  return res.status(200).json({
    ok: true,
    updated: freshApi.length,
    manualKept: manual.length,
    totalFixturesSeen: fixtures.length,
    unmatchedTeams: [...unmatched],
    lastSyncAt: now,
  });
}
