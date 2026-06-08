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
} from './config.js';

// Per-team raw breakdown from all final matches + advancement.
export function computeTeamPoints(state) {
  const matches = state?.matches ?? [];
  const advancement = state?.advancement ?? {};

  // team -> { matchPts, goals, advBonus, raw, multiplier, tier, total, games }
  const teams = {};

  function ensure(name) {
    const canon = canonicalTeam(name);
    if (!teams[canon]) {
      teams[canon] = {
        team: canon,
        tier: tierOf(canon),
        multiplier: multiplierOf(canon),
        matchPts: 0,
        goals: 0,
        advBonus: 0,
        games: 0,
        raw: 0,
        total: 0,
      };
    }
    return teams[canon];
  }

  for (const m of matches) {
    if (!m || !m.final) continue;
    const round = ROUND_INDEX[m.round] || ROUND_INDEX.group;
    const rules = round.knockout ? SCORING.knockout : SCORING.group;

    const a = ensure(m.teamA);
    const b = ensure(m.teamB);
    const sa = Number(m.scoreA) || 0;
    const sb = Number(m.scoreB) || 0;

    a.goals += sa * rules.goal;
    b.goals += sb * rules.goal;
    a.games += 1;
    b.games += 1;

    // Determine winner. For knockouts that finished level (penalties), the admin
    // can set m.winner = 'A' | 'B'. Otherwise winner is by score.
    let winner = null; // 'A' | 'B' | null(draw)
    if (sa > sb) winner = 'A';
    else if (sb > sa) winner = 'B';
    else if (m.winner === 'A' || m.winner === 'B') winner = m.winner;

    if (round.knockout) {
      if (winner === 'A') a.matchPts += rules.win;
      else if (winner === 'B') b.matchPts += rules.win;
      // knockout draws award nobody the win unless winner set above
    } else {
      if (winner === 'A') a.matchPts += rules.win;
      else if (winner === 'B') b.matchPts += rules.win;
      else {
        a.matchPts += rules.draw;
        b.matchPts += rules.draw;
      }
    }
  }

  // Advancement bonuses (cumulative).
  for (const [name, stageKey] of Object.entries(advancement)) {
    if (!stageKey || stageKey === 'none') continue;
    const t = ensure(name);
    t.advBonus += cumulativeBonus(stageKey);
    t.stage = stageKey;
  }

  // Finalize raw + multiplied totals.
  for (const t of Object.values(teams)) {
    t.raw = t.matchPts + t.goals + t.advBonus;
    t.total = round2(t.raw * (t.multiplier || 1));
  }

  return teams;
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
    breakdown.sort((x, y) => y.total - x.total);
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
