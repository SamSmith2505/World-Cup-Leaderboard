// ============================================================================
// World Cup 2026 Pick'em Pool — shared config (browser + serverless safe)
// ----------------------------------------------------------------------------
// Everything tweakable lives here. No Node-only APIs so this can be imported
// from both the static frontend and the /api serverless functions.
// ============================================================================

// --- Tier multipliers -------------------------------------------------------
// A team's TOTAL points (match pts + goals + advancement bonuses) are multiplied
// by its tier multiplier before being credited to owners.
export const TIER_MULTIPLIERS = {
  1: 1.0,
  2: 2.0,
  3: 2.5,
  4: 3.0,
  5: 3.5,
  6: 4.0,
};

// --- Scoring rules ----------------------------------------------------------
export const SCORING = {
  group: { win: 3, draw: 1, goal: 1 },
  knockout: { win: 5, draw: 0, goal: 1 },
};

// --- Advancement stages (CUMULATIVE bonuses) --------------------------------
// A team's bonus = sum of every stage value up to and including the stage it
// reached. Ordered from earliest to latest.
export const STAGES = [
  { key: 'none', label: 'Not advanced', bonus: 0 },
  { key: 'r32', label: 'Advanced out of group (R32)', bonus: 5 },
  { key: 'qf', label: 'Reached Quarterfinal', bonus: 8 },
  { key: 'sf', label: 'Reached Semifinal', bonus: 12 },
  { key: 'final', label: 'Reached Final', bonus: 18 },
  { key: 'champion', label: 'Won the Final (Champion)', bonus: 24 },
];

export const STAGE_INDEX = Object.fromEntries(STAGES.map((s, i) => [s.key, i]));

// Cumulative bonus earned for reaching a given stage key.
export function cumulativeBonus(stageKey) {
  const idx = STAGE_INDEX[stageKey] ?? 0;
  let total = 0;
  for (let i = 0; i <= idx; i++) total += STAGES[i].bonus;
  return total;
}

// --- Match rounds -----------------------------------------------------------
// `group` uses group scoring; everything else uses knockout scoring.
export const ROUNDS = [
  { key: 'group', label: 'Group Stage', knockout: false },
  { key: 'r32', label: 'Round of 32', knockout: true },
  { key: 'r16', label: 'Round of 16', knockout: true },
  { key: 'qf', label: 'Quarterfinal', knockout: true },
  { key: 'sf', label: 'Semifinal', knockout: true },
  { key: 'final', label: 'Final', knockout: true },
];

export const ROUND_INDEX = Object.fromEntries(ROUNDS.map((r) => [r.key, r]));

// --- Canonical team -> tier table -------------------------------------------
// SINGLE SOURCE OF TRUTH for tiers. The roster sheet's "Tier" column is ignored
// because it is inconsistent (e.g. Saudi Arabia tagged both T5 and T6 there).
// NOTE: Cape Verde placed in Tier 5 (matches sheet usage + spec's flag). Saudi
// Arabia kept in Tier 6 per spec. Adjust here if the final field changes.
export const TIERS = {
  1: ['Spain', 'France', 'England', 'Brazil', 'Portugal', 'Argentina'],
  2: ['Germany', 'Netherlands', 'Belgium', 'Norway', 'Colombia'],
  3: ['Japan', 'Mexico', 'United States', 'Morocco', 'Uruguay', 'Croatia', 'Switzerland', 'Turkey'],
  4: ['Ecuador', 'Austria', 'Senegal', 'Sweden', 'Canada', 'Ivory Coast', 'Paraguay', 'Scotland'],
  5: ['Egypt', 'Algeria', 'Bosnia and Herzegovina', 'Czechia', 'Ghana', 'South Korea', 'Tunisia', 'Iran', 'Cape Verde'],
  6: ['Uzbekistan', 'Haiti', 'Panama', 'Iraq', 'Qatar', 'Saudi Arabia', 'Curacao', 'Australia', 'Jordan', 'DR Congo', 'New Zealand', 'South Africa'],
};

// Reverse lookup: normalized team name -> tier number.
function normalize(name) {
  return String(name || '').trim().toLowerCase();
}

const _TEAM_TIER = {};
for (const [tier, teams] of Object.entries(TIERS)) {
  for (const t of teams) _TEAM_TIER[normalize(t)] = Number(tier);
}

// Common aliases so sheet spellings still resolve.
const ALIASES = {
  'usa': 'United States',
  'us': 'United States',
  'united states of america': 'United States',
  'south korea': 'South Korea',
  'korea republic': 'South Korea',
  'türkiye': 'Turkey',
  'turkiye': 'Turkey',
  'côte d\'ivoire': 'Ivory Coast',
  'cote d\'ivoire': 'Ivory Coast',
  'dr congo': 'DR Congo',
  'democratic republic of congo': 'DR Congo',
  'bosnia': 'Bosnia and Herzegovina',
  'czech republic': 'Czechia',
  'cape verde': 'Cape Verde',
  'cabo verde': 'Cape Verde',
  'curaçao': 'Curacao',
};

export function canonicalTeam(name) {
  const n = normalize(name);
  if (_TEAM_TIER[n] !== undefined) {
    // return the canonical-cased name
    for (const teams of Object.values(TIERS)) {
      for (const t of teams) if (normalize(t) === n) return t;
    }
  }
  if (ALIASES[n]) return ALIASES[n];
  return String(name || '').trim(); // unknown — return as-is so admin can see it
}

export function tierOf(name) {
  const canon = canonicalTeam(name);
  return _TEAM_TIER[normalize(canon)] ?? null;
}

export function multiplierOf(name) {
  const tier = tierOf(name);
  return tier ? (TIER_MULTIPLIERS[tier] ?? 1) : 1;
}

// All teams flat.
export const ALL_TEAMS = Object.values(TIERS).flat();

// --- Roster source ----------------------------------------------------------
// Public CSV export of the "Player Scores" tab. The app pulls this live so new
// players joining the sheet appear automatically (no redeploy needed).
export const ROSTER_CSV_URL =
  'https://docs.google.com/spreadsheets/d/1bhMDl1_p-NdugDCGydFOjRAZwCDOIBHp-KHmFPxPOWE/export?format=csv&gid=1808764118';

// --- Admin route ------------------------------------------------------------
// "Unlisted route" gating: the admin page lives at this hard-to-guess path.
// Change the filename + this constant together to rotate it.
export const ADMIN_PATH = '/admin-3f9a2c7b.html';
