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
// reached. Ordered from earliest to latest. Values per the pool's rules sheet:
//   out of group 3 · QF 8 · SF 12 · Final 18 · Champion 24.
export const STAGES = [
  { key: 'none', label: 'Not advanced', bonus: 0 },
  { key: 'r32', label: 'Advanced out of group', bonus: 3 },
  // R16 carries no extra bonus per the rules sheet — it's a display stage so a
  // team that wins its R32 game shows "R16" instead of staying on "R32".
  { key: 'r16', label: 'Reached Round of 16', bonus: 0 },
  { key: 'qf', label: 'Reached Quarterfinal', bonus: 8 },
  { key: 'sf', label: 'Reached Semifinal', bonus: 12 },
  { key: 'final', label: 'Reached Final', bonus: 18 },
  { key: 'champion', label: 'Won the Final (Champion)', bonus: 24 },
];

// Extra one-off bonus for finishing 1st in a group (on TOP of the out-of-group
// advancement bonus). Like all points, it's multiplied by the team's tier. So a
// group winner that's only made the R32 so far earns (3 + 5) × tier.
export const GROUP_WINNER_BONUS = 5;

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
  // 3rd-place playoff: knockout SCORING (5/win + goals) but NOT an advancement
  // stage — losing the semi then winning it doesn't mean you "reached the final".
  { key: 'third', label: '3rd Place Playoff', knockout: true },
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

// Common aliases so sheet spellings + API-Football spellings still resolve.
const ALIASES = {
  'usa': 'United States',
  'us': 'United States',
  'united states of america': 'United States',
  'south korea': 'South Korea',
  'south-korea': 'South Korea',
  'korea republic': 'South Korea',
  'türkiye': 'Turkey',
  'turkiye': 'Turkey',
  'türkiÿe': 'Turkey',
  'côte d\'ivoire': 'Ivory Coast',
  'cote d\'ivoire': 'Ivory Coast',
  'dr congo': 'DR Congo',
  'congo dr': 'DR Congo',
  'congo-dr': 'DR Congo',
  'democratic republic of congo': 'DR Congo',
  'bosnia': 'Bosnia and Herzegovina',
  'bosnia and herz.': 'Bosnia and Herzegovina',
  'bosnia & herzegovina': 'Bosnia and Herzegovina',
  'bosnia-herzegovina': 'Bosnia and Herzegovina',
  'czech republic': 'Czechia',
  'cape verde': 'Cape Verde',
  'cape verde islands': 'Cape Verde',
  'cabo verde': 'Cape Verde',
  'curaçao': 'Curacao',
};

// Explicit group assignments (canonical team name -> group letter). These take
// precedence over groups auto-derived from match data, so this is the source of
// truth for the draw. Keys must be canonical names (see TIERS above).
export const GROUPS = {
  // Group A
  'Mexico': 'A', 'South Africa': 'A', 'South Korea': 'A', 'Czechia': 'A',
  // Group B
  'Canada': 'B', 'Bosnia and Herzegovina': 'B', 'Qatar': 'B', 'Switzerland': 'B',
  // Group C
  'Brazil': 'C', 'Morocco': 'C', 'Haiti': 'C', 'Scotland': 'C',
  // Group D
  'United States': 'D', 'Paraguay': 'D', 'Australia': 'D', 'Turkey': 'D',
  // Group E
  'Germany': 'E', 'Curacao': 'E', 'Ivory Coast': 'E', 'Ecuador': 'E',
  // Group F
  'Netherlands': 'F', 'Japan': 'F', 'Sweden': 'F', 'Tunisia': 'F',
  // Group G
  'Belgium': 'G', 'Egypt': 'G', 'Iran': 'G', 'New Zealand': 'G',
  // Group H
  'Spain': 'H', 'Cape Verde': 'H', 'Saudi Arabia': 'H', 'Uruguay': 'H',
  // Group I
  'France': 'I', 'Senegal': 'I', 'Iraq': 'I', 'Norway': 'I',
  // Group J
  'Argentina': 'J', 'Algeria': 'J', 'Austria': 'J', 'Jordan': 'J',
  // Group K
  'Portugal': 'K', 'DR Congo': 'K', 'Uzbekistan': 'K', 'Colombia': 'K',
  // Group L
  'England': 'L', 'Croatia': 'L', 'Ghana': 'L', 'Panama': 'L',
};

export function groupOf(name) {
  return GROUPS[canonicalTeam(name)] || null;
}

// Extract a group letter from an API-Football round string, e.g. "Group A - 1".
export function groupFromApi(roundStr) {
  const m = String(roundStr || '').match(/group\s+([A-Z])/i);
  return m ? m[1].toUpperCase() : null;
}

// Map an API-Football "round" string to our round keys.
// Examples: "Group A - 1", "Round of 32", "Round of 16",
// "Quarter-finals", "Semi-finals", "Final", "3rd Place Final".
export function roundFromApi(roundStr) {
  const s = String(roundStr || '').toLowerCase();
  if (s.includes('group')) return 'group';
  if (s.includes('round of 32') || s.includes('1/16')) return 'r32';
  if (s.includes('round of 16') || s.includes('1/8')) return 'r16';
  if (s.includes('quarter') || s.includes('1/4')) return 'qf';
  if (s.includes('3rd') || s.includes('third place')) return 'third'; // knockout scoring, NOT an advancement stage
  if (s.includes('semi') || s.includes('1/2')) return 'sf';
  if (s.includes('final')) return 'final';
  return 'group';
}

// API-Football fixture statuses that mean the match is over.
export const FINAL_STATUSES = new Set(['FT', 'AET', 'PEN']);

// API-Football fixture statuses that mean the match is in progress (live).
export const LIVE_STATUSES = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'SUSP', 'INT', 'LIVE']);

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

// Canonical team -> flag code (ISO 3166-1 alpha-2, or GB subdivision codes).
// Used to build flag image URLs via flagcdn.com.
export const FLAG_CODES = {
  Spain: 'es', France: 'fr', England: 'gb-eng', Brazil: 'br', Portugal: 'pt', Argentina: 'ar',
  Germany: 'de', Netherlands: 'nl', Belgium: 'be', Norway: 'no', Colombia: 'co',
  Japan: 'jp', Mexico: 'mx', 'United States': 'us', Morocco: 'ma', Uruguay: 'uy',
  Croatia: 'hr', Switzerland: 'ch', Turkey: 'tr',
  Ecuador: 'ec', Austria: 'at', Senegal: 'sn', Sweden: 'se', Canada: 'ca',
  'Ivory Coast': 'ci', Paraguay: 'py', Scotland: 'gb-sct',
  Egypt: 'eg', Algeria: 'dz', 'Bosnia and Herzegovina': 'ba', Czechia: 'cz', Ghana: 'gh',
  'South Korea': 'kr', Tunisia: 'tn', Iran: 'ir', 'Cape Verde': 'cv',
  Uzbekistan: 'uz', Haiti: 'ht', Panama: 'pa', Iraq: 'iq', Qatar: 'qa', 'Saudi Arabia': 'sa',
  Curacao: 'cw', Australia: 'au', Jordan: 'jo', 'DR Congo': 'cd', 'New Zealand': 'nz',
  'South Africa': 'za',
};

// Flag image URL for a team (or null if unknown). `w` is a flagcdn width preset.
export function flagUrl(name, w = 40) {
  const code = FLAG_CODES[canonicalTeam(name)];
  return code ? `https://flagcdn.com/w${w}/${code}.png` : null;
}

// --- Pool money --------------------------------------------------------------
// Buy-in per player; the public page shows pot = players × buy-in.
export const BUY_IN_USD = 50;

// --- Roster source ----------------------------------------------------------
// Public CSV export of the "Player Scores" tab. The app pulls this live so new
// players joining the sheet appear automatically (no redeploy needed).
export const ROSTER_CSV_URL =
  'https://docs.google.com/spreadsheets/d/1bhMDl1_p-NdugDCGydFOjRAZwCDOIBHp-KHmFPxPOWE/export?format=csv&gid=1808764118';

// --- Admin route ------------------------------------------------------------
// "Unlisted route" gating: the admin page lives at this hard-to-guess path.
// Change the filename + this constant together to rotate it.
export const ADMIN_PATH = '/admin-3f9a2c7b.html';
