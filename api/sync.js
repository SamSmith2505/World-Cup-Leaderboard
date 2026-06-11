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

import { getState, setState, getSnapshot, setSnapshot } from '../lib/store.js';
import { canonicalTeam, tierOf, roundFromApi, groupFromApi, ROUND_INDEX, FINAL_STATUSES, ROSTER_CSV_URL } from '../lib/config.js';
import { fixtureKey, compute } from '../lib/scoring.js';
import { rosterFromCSV, ROSTER_FALLBACK } from '../lib/roster.js';

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

function sameUTCDay(a, b) {
  const x = new Date(a), y = new Date(b);
  return x.getUTCFullYear() === y.getUTCFullYear() && x.getUTCMonth() === y.getUTCMonth() && x.getUTCDate() === y.getUTCDate();
}

async function rosterForSnapshot() {
  try {
    const r = await fetch(ROSTER_CSV_URL);
    if (r.ok) { const rr = rosterFromCSV(await r.text()); if (rr.length) return rr; }
  } catch {}
  return ROSTER_FALLBACK;
}

// Save a once-per-(UTC)-day standings baseline so the leaderboard can show
// "gained today" and rank movement without anyone clicking anything.
async function rollDailySnapshot(state, now) {
  try {
    const snap = await getSnapshot();
    if (snap && snap.at && sameUTCDay(snap.at, now)) return; // already have today's baseline
    const roster = await rosterForSnapshot();
    const { standings } = compute(state, roster);
    await setSnapshot({ standings: standings.map((s) => ({ name: s.name, total: s.total, rank: s.rank })), at: now });
  } catch {}
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const wantsForce = (req.query?.force ?? '') === '1' || (req.query?.force ?? '') === 'true';
  const secretOk = !SYNC_SECRET || req.query?.key === SYNC_SECRET || req.headers['x-sync-secret'] === SYNC_SECRET;
  const force = wantsForce && secretOk;

  const key = apiKey();
  if (!key) {
    return res.status(200).json({ ok: false, configured: false, message: 'No API key set (APISPORTS_KEY). Manual entry still works.' });
  }

  const state = await getState();
  state.meta = state.meta || {};
  const last = state.meta.lastSyncAt ? Date.parse(state.meta.lastSyncAt) : 0;
  if (!force && last && Date.now() - last < THROTTLE_MS) {
    return res.status(200).json({ ok: true, skipped: true, reason: 'throttled', lastSyncAt: state.meta.lastSyncAt });
  }

  let fixtures;
  let apiErrors = null;
  try {
    const url = `${API_BASE}/fixtures?league=${encodeURIComponent(LEAGUE_ID)}&season=${encodeURIComponent(SEASON)}`;
    const r = await fetch(url, { headers: { 'x-apisports-key': key } });
    const data = await r.json();
    if (!r.ok) throw new Error('API status ' + r.status);
    fixtures = data?.response || [];
    // API-Football reports problems (bad key, plan/season limits, wrong params)
    // INSIDE a 200 response, in `errors`. Capture them or we fail silently.
    const errs = data?.errors;
    if (errs && (Array.isArray(errs) ? errs.length : Object.keys(errs).length)) apiErrors = errs;
  } catch (e) {
    try { state.meta.lastSyncError = String(e); await setState(state); } catch {}
    return res.status(200).json({ ok: false, error: String(e), message: 'API fetch failed; existing data unchanged.' });
  }

  const now = new Date().toISOString();

  // Zero fixtures = nothing usable came back (most often an `errors` payload).
  // Keep existing data, record why so the admin page can show it, and still
  // stamp lastSyncAt so the viewer-throttle keeps protecting the quota.
  if (!fixtures.length) {
    const reason = apiErrors
      ? 'API-Football errors: ' + JSON.stringify(apiErrors)
      : `API returned 0 fixtures for league=${LEAGUE_ID} season=${SEASON} (check WC_LEAGUE_ID / WC_SEASON and plan coverage)`;
    state.meta.lastSyncAt = now;
    state.meta.lastSyncError = reason;
    await setState(state);
    return res.status(200).json({ ok: false, error: reason, totalFixturesSeen: 0, message: 'No fixtures returned; existing data unchanged.' });
  }

  const apiMatches = [];
  const upcoming = [];
  const unmatched = new Set();
  for (const fx of fixtures) {
    const status = fx?.fixture?.status?.short;
    const round = roundFromApi(fx?.league?.round);
    const group = groupFromApi(fx?.league?.round);
    const teamA = canonicalTeam(fx?.teams?.home?.name);
    const teamB = canonicalTeam(fx?.teams?.away?.name);

    if (tierOf(teamA) == null && fx?.teams?.home?.name) unmatched.add(fx.teams.home.name);
    if (tierOf(teamB) == null && fx?.teams?.away?.name) unmatched.add(fx.teams.away.name);

    if (FINAL_STATUSES.has(status)) {
      const scoreA = Number(fx?.goals?.home) || 0;
      const scoreB = Number(fx?.goals?.away) || 0;
      let winner = null;
      if (scoreA === scoreB && ROUND_INDEX[round]?.knockout) {
        if (fx?.teams?.home?.winner === true) winner = 'A';
        else if (fx?.teams?.away?.winner === true) winner = 'B';
      }
      apiMatches.push({
        id: 'api:' + fx?.fixture?.id,
        source: 'api', manual: false,
        round, group, teamA, teamB, scoreA, scoreB, winner,
        final: true, status, date: fx?.fixture?.date,
      });
    } else {
      // Scheduled OR in-progress fixture. Carries live score + minute when live,
      // used for the "next match", "live now", and "today's matches" views.
      upcoming.push({
        id: 'api:' + fx?.fixture?.id,
        date: fx?.fixture?.date, round, group, teamA, teamB, status,
        scoreA: Number(fx?.goals?.home) || 0,
        scoreB: Number(fx?.goals?.away) || 0,
        elapsed: fx?.fixture?.status?.elapsed ?? null,
      });
    }
  }

  // Merge: keep manual entries; add API matches that aren't manually overridden.
  const manual = (state.matches || []).filter(isManual);
  const manualKeys = new Set(manual.map(fixtureKey));
  const freshApi = apiMatches.filter((m) => !manualKeys.has(fixtureKey(m)));

  state.matches = [...manual, ...freshApi];
  state.fixtures = upcoming; // refreshed wholesale each sync
  state.meta.lastSyncAt = now;
  state.meta.lastUpdated = now;
  // Data-health info for the admin page: API names that didn't canonicalize
  // (spelling drift like "Cabo Verde" vs "Cape Verde") + any soft API errors.
  state.meta.unmatchedTeams = [...unmatched];
  state.meta.lastSyncError = apiErrors ? 'API-Football errors: ' + JSON.stringify(apiErrors) : null;
  await setState(state);
  await rollDailySnapshot(state, now);

  return res.status(200).json({
    ok: true,
    updated: freshApi.length,
    upcoming: upcoming.length,
    manualKept: manual.length,
    totalFixturesSeen: fixtures.length,
    unmatchedTeams: [...unmatched],
    lastSyncAt: now,
  });
}
