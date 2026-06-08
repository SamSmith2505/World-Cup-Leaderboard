// ============================================================================
// Scoring engine — pure functions, browser + serverless safe.
// ----------------------------------------------------------------------------
// compute(state, roster) -> { standings, teamPoints, lastUpdated }
//   state:  { matches: [...], advancement: { TeamName: stageKey }, meta }
//   roster: [ { name, picks: [TeamName, ...] }, ... ]
// ============================================================================

import {
  SCORING,
  ROUND_INDEX,
  cumulativeBonus,
  tierOf,
  multiplierOf,
  canonicalTeam,
  groupOf,
} from './config.js';

// Is this match a manual entry (admin) vs an auto-pulled API one?
function isManual(m) {
  return m?.source === 'manual' || m?.manual === true;
}

// Stable key identifying a fixture regardless of source/home-away order.
export function fixtureKey(m) {
  const a = canonicalTeam(m?.teamA);
  const b = canonicalTeam(m?.teamB);
  const teams = [a, b].sort().join(' v ');
  return `${m?.round || 'group'}::${teams}`;
}

// Per-team raw breakdown from all final matches + advancement.
// Each team gets a `src` object splitting points by where they came from.
export function computeTeamPoints(state) {
  const matches = state?.matches ?? [];
  const advancement = state?.advancement ?? {};

  // Manual entries take precedence: drop any API match whose fixture also has a
  // manual entry.
  const manualKeys = new Set();
  for (const m of matches) if (isManual(m)) manualKeys.add(fixtureKey(m));

  const teams = {};

  function ensure(name) {
    const canon = canonicalTeam(name);
    if (!teams[canon]) {
      teams[canon] = {
        team: canon,
        tier: tierOf(canon),
        group: groupOf(canon), // config override; may be filled from matches below
        multiplier: multiplierOf(canon),
        matchPts: 0,
        goals: 0,
        advBonus: 0,
        games: 0,
        raw: 0,
        total: 0,
        // per-source breakdown ({ pts, n } where n is a count)
        src: {
          groupWin: { pts: 0, n: 0 },
          groupDraw: { pts: 0, n: 0 },
          groupGoals: { pts: 0, n: 0 },
          koWin: { pts: 0, n: 0 },
          koGoals: { pts: 0, n: 0 },
          adv: { pts: 0 },
        },
      };
    }
    return teams[canon];
  }

  for (const m of matches) {
    if (!m || !m.final) continue;
    if (!isManual(m) && manualKeys.has(fixtureKey(m))) continue; // overridden manually
    const round = ROUND_INDEX[m.round] || ROUND_INDEX.group;
    const rules = round.knockout ? SCORING.knockout : SCORING.group;

    const a = ensure(m.teamA);
    const b = ensure(m.teamB);
    const sa = Number(m.scoreA) || 0;
    const sb = Number(m.scoreB) || 0;

    a.games += 1;
    b.games += 1;

    // Capture group from a group-stage match (if not already set via config).
    if (!round.knockout && m.group) {
      if (!a.group) a.group = m.group;
      if (!b.group) b.group = m.group;
    }

    // Goals.
    const aGoalPts = sa * rules.goal;
    const bGoalPts = sb * rules.goal;
    a.goals += aGoalPts;
    b.goals += bGoalPts;
    if (round.knockout) {
      a.src.koGoals.pts += aGoalPts; a.src.koGoals.n += sa;
      b.src.koGoals.pts += bGoalPts; b.src.koGoals.n += sb;
    } else {
      a.src.groupGoals.pts += aGoalPts; a.src.groupGoals.n += sa;
      b.src.groupGoals.pts += bGoalPts; b.src.groupGoals.n += sb;
    }

    // Winner (penalty shootout winner can be set via m.winner).
    let winner = null;
    if (sa > sb) winner = 'A';
    else if (sb > sa) winner = 'B';
    else if (m.winner === 'A' || m.winner === 'B') winner = m.winner;

    if (round.knockout) {
      if (winner === 'A') { a.matchPts += rules.win; a.src.koWin.pts += rules.win; a.src.koWin.n += 1; }
      else if (winner === 'B') { b.matchPts += rules.win; b.src.koWin.pts += rules.win; b.src.koWin.n += 1; }
    } else {
      if (winner === 'A') { a.matchPts += rules.win; a.src.groupWin.pts += rules.win; a.src.groupWin.n += 1; }
      else if (winner === 'B') { b.matchPts += rules.win; b.src.groupWin.pts += rules.win; b.src.groupWin.n += 1; }
      else {
        a.matchPts += rules.draw; a.src.groupDraw.pts += rules.draw; a.src.groupDraw.n += 1;
        b.matchPts += rules.draw; b.src.groupDraw.pts += rules.draw; b.src.groupDraw.n += 1;
      }
    }
  }

  // Advancement bonuses (cumulative).
  for (const [name, stageKey] of Object.entries(advancement)) {
    if (!stageKey || stageKey === 'none') continue;
    const t = ensure(name);
    const bonus = cumulativeBonus(stageKey);
    t.advBonus += bonus;
    t.src.adv.pts += bonus;
    t.stage = stageKey;
  }

  // Finalize raw + multiplied totals.
  for (const t of Object.values(teams)) {
    t.raw = t.matchPts + t.goals + t.advBonus;
    t.total = round2(t.raw * (t.multiplier || 1));
  }

  return teams;
}

// Teams that are out: auto-derived from knockout losses, plus any admin-set
// manual flags in state.eliminated. Returns a Set of canonical team names.
export function eliminatedSet(state) {
  const out = new Set();
  for (const [name, v] of Object.entries(state?.eliminated || {})) {
    if (v) out.add(canonicalTeam(name));
  }
  const matches = state?.matches ?? [];
  const manualKeys = new Set();
  for (const m of matches) if (m?.source === 'manual' || m?.manual === true) manualKeys.add(fixtureKey(m));
  for (const m of matches) {
    if (!m || !m.final) continue;
    if (!(m.source === 'manual' || m.manual === true) && manualKeys.has(fixtureKey(m))) continue;
    const round = ROUND_INDEX[m.round] || ROUND_INDEX.group;
    if (!round.knockout) continue;
    const sa = Number(m.scoreA) || 0, sb = Number(m.scoreB) || 0;
    let winner = null;
    if (sa > sb) winner = 'A';
    else if (sb > sa) winner = 'B';
    else if (m.winner === 'A' || m.winner === 'B') winner = m.winner;
    if (winner === 'A') out.add(canonicalTeam(m.teamB));
    else if (winner === 'B') out.add(canonicalTeam(m.teamA));
  }
  return out;
}

// Build the participant standings.
export function compute(state, roster) {
  const teams = computeTeamPoints(state);

  const standings = (roster || []).map((p) => {
    const seen = new Set();
    const breakdown = [];
    let total = 0;
    for (const pick of p.picks || []) {
      const canon = canonicalTeam(pick);
      if (seen.has(canon)) continue; // dedupe: owning a team once
      seen.add(canon);
      const tp = teams[canon] || {
        team: canon,
        tier: tierOf(canon),
        multiplier: multiplierOf(canon),
        matchPts: 0,
        goals: 0,
        advBonus: 0,
        raw: 0,
        total: 0,
        games: 0,
      };
      total += tp.total;
      breakdown.push(tp);
    }
    // Sort each player's teams by tier (T1 first), then by points within a tier.
    breakdown.sort((x, y) => (x.tier ?? 9) - (y.tier ?? 9) || y.total - x.total || x.team.localeCompare(y.team));
    return { name: p.name, total: round2(total), breakdown };
  });

  standings.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  // Assign ranks (ties share a rank).
  let lastTotal = null;
  let lastRank = 0;
  standings.forEach((row, i) => {
    if (row.total !== lastTotal) {
      lastRank = i + 1;
      lastTotal = row.total;
    }
    row.rank = lastRank;
  });

  return { standings, teamPoints: teams, lastUpdated: state?.meta?.lastUpdated || null };
}

// Compare two standings arrays to find day's biggest movers (by rank delta).
export function computeMovers(current, previous) {
  if (!previous || !previous.length) return [];
  const prevRank = Object.fromEntries(previous.map((r) => [r.name, r.rank]));
  const prevTotal = Object.fromEntries(previous.map((r) => [r.name, r.total]));
  return current
    .map((r) => ({
      name: r.name,
      rankDelta: (prevRank[r.name] ?? r.rank) - r.rank, // positive = climbed
      pointsDelta: round2(r.total - (prevTotal[r.name] ?? r.total)),
    }))
    .filter((m) => m.rankDelta !== 0 || m.pointsDelta !== 0)
    .sort((a, b) => Math.abs(b.pointsDelta) - Math.abs(a.pointsDelta));
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
