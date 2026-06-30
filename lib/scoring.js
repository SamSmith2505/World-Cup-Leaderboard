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
  LIVE_STATUSES,
  GROUPS,
  GROUP_WINNER_BONUS,
  ALL_TEAMS,
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

  // Live (in-progress) fixtures contribute GOAL points provisionally — a goal
  // that's been scored won't be taken back, so crediting it live is safe. Match
  // win/draw points wait until the match is final (they can still flip). Skip a
  // live fixture if a final/manual match already exists for the same pairing.
  const finalKeys = new Set();
  for (const m of matches) if (m && m.final) finalKeys.add(fixtureKey(m));

  for (const f of state?.fixtures ?? []) {
    if (!f || !LIVE_STATUSES.has(f.status)) continue;
    const key = fixtureKey(f);
    if (manualKeys.has(key) || finalKeys.has(key)) continue;
    const round = ROUND_INDEX[f.round] || ROUND_INDEX.group;
    const rules = round.knockout ? SCORING.knockout : SCORING.group;
    const a = ensure(f.teamA);
    const b = ensure(f.teamB);
    const sa = Number(f.scoreA) || 0;
    const sb = Number(f.scoreB) || 0;

    if (!round.knockout && f.group) {
      if (!a.group) a.group = f.group;
      if (!b.group) b.group = f.group;
    }

    const aGoalPts = sa * rules.goal;
    const bGoalPts = sb * rules.goal;
    a.goals += aGoalPts; b.goals += bGoalPts;
    if (round.knockout) {
      a.src.koGoals.pts += aGoalPts; a.src.koGoals.n += sa;
      b.src.koGoals.pts += bGoalPts; b.src.koGoals.n += sb;
    } else {
      a.src.groupGoals.pts += aGoalPts; a.src.groupGoals.n += sa;
      b.src.groupGoals.pts += bGoalPts; b.src.groupGoals.n += sb;
    }
    // Mark the teams as having live (provisional) points so the UI can flag it.
    a.live = true; b.live = true;
    a.liveGoals = (a.liveGoals || 0) + sa;
    b.liveGoals = (b.liveGoals || 0) + sb;
  }

  // Advancement bonuses (cumulative). Auto-derived live from the knockout
  // bracket; a manual admin entry for a team overrides the auto stage.
  const effectiveAdv = {};
  for (const [name, stage] of Object.entries(derivedAdvancement(state))) {
    effectiveAdv[canonicalTeam(name)] = stage;
  }
  for (const [name, stage] of Object.entries(advancement)) {
    if (stage && stage !== 'none') effectiveAdv[canonicalTeam(name)] = stage; // manual wins
  }
  for (const [name, stageKey] of Object.entries(effectiveAdv)) {
    if (!stageKey || stageKey === 'none') continue;
    const t = ensure(name);
    const bonus = cumulativeBonus(stageKey);
    t.advBonus += bonus;
    t.src.adv.pts += bonus;
    t.stage = stageKey;
  }

  // Group-winner bonus (on top of advancement), for completed groups only.
  for (const name of groupWinners(state)) {
    const t = ensure(name);
    t.advBonus += GROUP_WINNER_BONUS;
    t.src.adv.pts += GROUP_WINNER_BONUS;
    t.groupWinner = true;
  }

  // Finalize raw + multiplied totals.
  for (const t of Object.values(teams)) {
    t.raw = t.matchPts + t.goals + t.advBonus;
    t.total = round2(t.raw * (t.multiplier || 1));
  }

  return teams;
}

// Winners (1st place) of COMPLETED groups, from final group matches. Tiebreak:
// points -> goal difference -> goals for (FIFA's first three criteria). A group
// counts only once all four of its teams have played their 3 games, so the
// bonus lands when the group is actually decided (not mid-stage).
export function groupWinners(state) {
  const matches = state?.matches ?? [];
  const manualKeys = new Set();
  for (const m of matches) if (isManual(m)) manualKeys.add(fixtureKey(m));

  const tbl = {}; // canonical team -> { pts, gd, gf, played }
  function row(name) {
    const canon = canonicalTeam(name);
    return (tbl[canon] ||= { team: canon, pts: 0, gd: 0, gf: 0, played: 0 });
  }

  for (const m of matches) {
    if (!m || !m.final || m.round !== 'group') continue;
    if (!isManual(m) && manualKeys.has(fixtureKey(m))) continue;
    const a = row(m.teamA), b = row(m.teamB);
    const sa = Number(m.scoreA) || 0, sb = Number(m.scoreB) || 0;
    a.played++; b.played++;
    a.gf += sa; b.gf += sb;
    a.gd += sa - sb; b.gd += sb - sa;
    if (sa > sb) a.pts += 3; else if (sb > sa) b.pts += 3; else { a.pts += 1; b.pts += 1; }
  }

  // Expected teams per group letter (config is the source of truth for the draw).
  const expected = {};
  for (const [team, letter] of Object.entries(GROUPS)) (expected[letter] ||= []).push(team);

  const winners = new Set();
  for (const teams of Object.values(expected)) {
    const rows = teams.map((t) => tbl[t]).filter(Boolean);
    if (rows.length < teams.length || rows.some((r) => r.played < 3)) continue; // group not complete
    rows.sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || x.team.localeCompare(y.team));
    winners.add(rows[0].team);
  }
  return winners;
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

  // Group-stage eliminations: once the knockout bracket exists (any team has
  // reached the R32), every team that did NOT advance out of its group is out
  // too. Before the bracket is set we don't grey anyone (a 3rd-place team could
  // still sneak in as a best-third qualifier).
  const advancers = new Set(Object.keys(derivedAdvancement(state)));
  if (advancers.size) {
    for (const team of ALL_TEAMS) if (!advancers.has(team)) out.add(team);
  }
  return out;
}

// Auto-derive each team's furthest stage from the knockout bracket present in
// state. A team NAMED in a knockout fixture/result has reached that round, so
// advancement bonuses populate live as the bracket fills in — no manual step.
// Placeholder entries ("Winner Group A") don't canonicalize and are skipped.
// Returns { canonicalTeam: stageKey }. Manual state.advancement still overrides.
export function derivedAdvancement(state) {
  // Knockout rounds in order; each maps to the stage a team that's IN it has
  // reached. Winning a round bumps a team to the NEXT stage.
  const rank = { r32: 0, r16: 1, qf: 2, sf: 3, final: 4, champion: 5 };
  const nextStage = { r32: 'r16', r16: 'qf', qf: 'sf', sf: 'final', final: 'champion' };
  const out = {};
  const consider = [...(state?.matches || []), ...(state?.fixtures || [])];

  function bump(name, stage) {
    const canon = canonicalTeam(name);
    if (tierOf(canon) == null) return; // skip placeholders / unknown names
    if (out[canon] === undefined || rank[stage] > rank[out[canon]]) out[canon] = stage;
  }

  // Being NAMED in a knockout fixture/result = reached that round.
  for (const m of consider) {
    if (!m || !m.teamA || !m.teamB) continue;
    if (rank[m.round] === undefined) continue; // not a knockout round (e.g. 'group')
    bump(m.teamA, m.round);
    bump(m.teamB, m.round);
  }

  // Winning a completed knockout match = reached the NEXT round, the moment the
  // result is final — so the tag advances right when a team wins, before the
  // next-round fixture is even drawn (winning the final = champion).
  for (const m of state?.matches || []) {
    if (!m || !m.final) continue;
    const stage = nextStage[m.round];
    if (!stage) continue;
    const sa = Number(m.scoreA) || 0, sb = Number(m.scoreB) || 0;
    const w = sa > sb ? 'A' : sb > sa ? 'B' : (m.winner === 'A' || m.winner === 'B' ? m.winner : null);
    if (w === 'A') bump(m.teamA, stage);
    else if (w === 'B') bump(m.teamB, stage);
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
