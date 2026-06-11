// ============================================================================
// Team-name health check: sheet ↔ canonical table ↔ API-Football.
//   node scripts/check-teams.mjs
// ----------------------------------------------------------------------------
// 1. Every team in the roster sheet must resolve to a canonical team (tier).
// 2. (If APISPORTS_KEY is set, e.g. in .env.local) every team name the API
//    uses must also resolve — catches "Cabo Verde" vs "Cape Verde" before
//    scores start flowing. Add fixes to ALIASES in lib/config.js.
// Exits 1 if anything is unmatched, so it can run in CI.
// ============================================================================

import fs from 'node:fs';
import { canonicalTeam, tierOf, ALL_TEAMS, ROSTER_CSV_URL } from '../lib/config.js';
import { rosterFromCSV, parseCSV } from '../lib/roster.js';

// Lightweight .env.local / .env loader (no dependency).
for (const f of ['.env.local', '.env']) {
  try {
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
    }
  } catch {}
}

let failed = false;

// --- 1. Sheet → canonical ----------------------------------------------------
console.log('— Checking roster sheet team names…');
const csv = await (await fetch(ROSTER_CSV_URL, { redirect: 'follow' })).text();
const rows = parseCSV(csv);
const header = rows[0].map((h) => h.trim().toLowerCase());
const pCol = Math.max(header.indexOf('player'), 0);
const tCol = header.includes('team') ? header.indexOf('team') : 1;

const badPicks = [];
for (const r of rows.slice(1)) {
  const player = String(r[pCol] ?? '').trim();
  const team = String(r[tCol] ?? '').trim();
  if (!player || !team) continue;
  if (tierOf(team) == null) badPicks.push({ player, team });
}
const roster = rosterFromCSV(csv);
console.log(`  ${roster.length} players, ${rows.length - 1} pick rows`);
if (badPicks.length) {
  failed = true;
  console.log('  ❌ Picks that do NOT match a canonical team (fix the sheet or add an alias):');
  for (const { player, team } of badPicks) console.log(`     - "${team}" (picked by ${player})`);
} else {
  console.log('  ✅ Every pick resolves to a canonical team.');
}

// --- Owned-team coverage ------------------------------------------------------
const owned = new Set(roster.flatMap((p) => p.picks).map(canonicalTeam));
const unowned = ALL_TEAMS.filter((t) => !owned.has(t));
console.log(`  ${owned.size}/${ALL_TEAMS.length} teams owned by someone` +
  (unowned.length ? ` (unowned: ${unowned.join(', ')})` : ''));

// --- 2. API names → canonical -------------------------------------------------
const key = process.env.APISPORTS_KEY || process.env.API_FOOTBALL_KEY;
if (!key) {
  console.log('\n— Skipping API-Football name check (set APISPORTS_KEY in .env.local to enable).');
} else {
  console.log('\n— Checking API-Football team names…');
  const base = process.env.API_FOOTBALL_BASE || 'https://v3.football.api-sports.io';
  const league = process.env.WC_LEAGUE_ID || '1';
  const season = process.env.WC_SEASON || '2026';
  const r = await fetch(`${base}/teams?league=${league}&season=${season}`, { headers: { 'x-apisports-key': key } });
  const data = await r.json();
  const errs = data?.errors;
  if (errs && (Array.isArray(errs) ? errs.length : Object.keys(errs).length)) {
    failed = true;
    console.log('  ❌ API-Football returned errors:', JSON.stringify(errs));
  }
  const apiNames = (data?.response || []).map((t) => t?.team?.name).filter(Boolean);
  console.log(`  ${apiNames.length} teams returned by the API`);
  const unmatched = apiNames.filter((n) => tierOf(n) == null);
  if (unmatched.length) {
    failed = true;
    console.log('  ❌ API names that do NOT resolve (add to ALIASES in lib/config.js):');
    for (const n of unmatched) console.log(`     - "${n}"`);
  } else if (apiNames.length) {
    console.log('  ✅ Every API team name resolves to a canonical team.');
  }
  // Reverse direction: canonical teams the API never mentioned.
  if (apiNames.length) {
    const apiCanon = new Set(apiNames.map(canonicalTeam));
    const missing = ALL_TEAMS.filter((t) => !apiCanon.has(t));
    if (missing.length) {
      failed = true;
      console.log('  ❌ Canonical teams missing from the API (spelling drift the other way?):');
      for (const t of missing) console.log(`     - ${t}`);
    }
  }
}

console.log(failed ? '\nResult: PROBLEMS FOUND ❌' : '\nResult: all good ✅');
process.exit(failed ? 1 : 0);
