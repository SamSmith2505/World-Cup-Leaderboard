// Run: node test/scoring.test.mjs
import assert from 'node:assert/strict';
import { compute, computeTeamPoints, eliminatedSet, derivedAdvancement, contestEliminated } from '../lib/scoring.js';
import { cumulativeBonus, tierOf } from '../lib/config.js';

let pass = 0;
function ok(name, fn) { fn(); pass++; console.log('  ✓', name); }

console.log('Scoring engine tests');

ok('tier lookup uses canonical table, ignores sheet column', () => {
  assert.equal(tierOf('Saudi Arabia'), 6);   // sheet had it as 5 for JDu
  assert.equal(tierOf('Cape Verde'), 5);
  assert.equal(tierOf('Argentina'), 1);
  assert.equal(tierOf('usa'), 3);             // alias
});

ok('cumulative advancement bonuses stack', () => {
  assert.equal(cumulativeBonus('none'), 0);
  assert.equal(cumulativeBonus('r32'), 3);     // out of group
  assert.equal(cumulativeBonus('qf'), 11);     // 3+8
  assert.equal(cumulativeBonus('sf'), 23);     // 3+8+12
  assert.equal(cumulativeBonus('final'), 41);  // +18
  assert.equal(cumulativeBonus('champion'), 65); // +24
});

const state = {
  matches: [
    { round: 'group', teamA: 'Argentina', teamB: 'Mexico', scoreA: 3, scoreB: 1, final: true },
    { round: 'group', teamA: 'Norway', teamB: 'Croatia', scoreA: 2, scoreB: 2, final: true },
    { round: 'r32', teamA: 'Argentina', teamB: 'Spain', scoreA: 0, scoreB: 0, winner: 'A', final: true },
    { round: 'final', teamA: 'Brazil', teamB: 'England', scoreA: 1, scoreB: 0, final: false }, // not final -> ignored
  ],
  advancement: { Argentina: 'champion', 'Cape Verde': 'r32' },
  meta: { lastUpdated: '2026-07-01T00:00:00Z' },
};

const teams = computeTeamPoints(state);

ok('group win + goals', () => {
  // Argentina group: win 3 + 3 goals = 6 ; r32: win 5 + 0 goals = 5 ; champion bonus 65
  assert.equal(teams['Argentina'].matchPts, 8);
  assert.equal(teams['Argentina'].goals, 3);
  assert.equal(teams['Argentina'].advBonus, 65);
  assert.equal(teams['Argentina'].raw, 76);
  assert.equal(teams['Argentina'].total, 76); // T1 x1.0
});

ok('draw awards 1 each + goals', () => {
  assert.equal(teams['Norway'].matchPts, 1);
  assert.equal(teams['Norway'].goals, 2);
  assert.equal(teams['Norway'].total, 6); // raw 3 x T2(2.0)
});

ok('knockout penalty loser: no win pts, but keeps the R32 advance bonus', () => {
  assert.equal(teams['Spain'].matchPts, 0);                 // lost on pens -> no win points
  assert.equal(teams['Spain'].advBonus, cumulativeBonus('r32')); // but it did reach the R32
  assert.equal(teams['Spain'].total, 3);                    // 3 raw x T1 (1.0)
});

ok('non-final match adds no match pts/goals, but bracket placement still advances', () => {
  // Brazil/England are named in the (not-yet-played) final fixture: no match
  // points or goals, but being in the final = reached-final advancement.
  assert.equal(teams['Brazil'].matchPts, 0);
  assert.equal(teams['Brazil'].goals, 0);
  assert.equal(teams['Brazil'].advBonus, cumulativeBonus('final')); // 43
});

ok('advancement-only team scores via multiplier', () => {
  // Cape Verde: r32 bonus 3, no matches, T5 x3.5 = 10.5
  assert.equal(teams['Cape Verde'].raw, 3);
  assert.equal(teams['Cape Verde'].total, 10.5);
});

const roster = [
  { name: 'Alice', picks: ['Argentina', 'Norway', 'Argentina'] }, // dup -> counted once
  { name: 'Bob', picks: ['Argentina', 'Cape Verde'] },            // shares Argentina
];
const { standings } = compute(state, roster);

ok('shared team credits all owners + dedupe', () => {
  const alice = standings.find((s) => s.name === 'Alice');
  const bob = standings.find((s) => s.name === 'Bob');
  assert.equal(alice.total, 82);    // 76 + 6 (Argentina counted once)
  assert.equal(bob.total, 86.5);    // 76 + 10.5
  assert.equal(alice.breakdown.length, 2);
});

ok('ranking is correct (highest first, ties share rank)', () => {
  assert.equal(standings[0].name, 'Bob');
  assert.equal(standings[0].rank, 1);
  assert.equal(standings[1].name, 'Alice');
  assert.equal(standings[1].rank, 2);
});

ok('per-source breakdown splits points correctly', () => {
  const a = teams['Argentina'].src;
  assert.equal(a.groupWin.pts, 3);  assert.equal(a.groupWin.n, 1);
  assert.equal(a.groupGoals.pts, 3); assert.equal(a.groupGoals.n, 3);
  assert.equal(a.koWin.pts, 5);     assert.equal(a.koWin.n, 1);
  assert.equal(a.koGoals.pts, 0);
  assert.equal(a.adv.pts, 65);
  const n = teams['Norway'].src;
  assert.equal(n.groupDraw.pts, 1); assert.equal(n.groupGoals.pts, 2);
});

ok('manual entry overrides API entry for the same fixture', () => {
  const s = {
    matches: [
      { round: 'group', teamA: 'Ghana', teamB: 'Iran', scoreA: 1, scoreB: 1, final: true, source: 'api' },
      // same fixture (order swapped), entered manually -> should win:
      { round: 'group', teamA: 'Iran', teamB: 'Ghana', scoreA: 0, scoreB: 3, final: true, source: 'manual' },
    ],
    advancement: {},
  };
  const t = computeTeamPoints(s);
  // Ghana counted from the MANUAL match only: win 3 + 3 goals = 6 raw
  assert.equal(t['Ghana'].matchPts, 3);
  assert.equal(t['Ghana'].goals, 3);
  assert.equal(t['Ghana'].raw, 6);
  assert.equal(t['Ghana'].games, 1); // not double-counted
  assert.equal(t['Iran'].raw, 0);
});

ok('elimination: knockout losers out, group losers not, manual flag honored', () => {
  const s = {
    matches: [
      { round: 'group', teamA: 'Brazil', teamB: 'Haiti', scoreA: 4, scoreB: 0, final: true },     // group loss != out
      { round: 'r32', teamA: 'France', teamB: 'Spain', scoreA: 2, scoreB: 1, final: true },        // Spain out
      { round: 'qf', teamA: 'Germany', teamB: 'Brazil', scoreA: 0, scoreB: 0, winner: 'B', final: true }, // Germany out (pens)
    ],
    eliminated: { Haiti: true }, // manual
  };
  const e = eliminatedSet(s);
  assert.ok(e.has('Spain'));
  assert.ok(e.has('Germany'));
  assert.ok(e.has('Haiti'));      // manual
  assert.ok(!e.has('France'));    // won
  assert.ok(!e.has('Brazil'));    // group loss isn't elimination; won its QF
});

ok('live in-progress fixtures credit goals (not win/draw) provisionally', () => {
  const s = {
    matches: [],
    fixtures: [
      // South Korea 1–0 live: goal counts, the win does NOT (can still flip).
      { round: 'group', group: 'A', teamA: 'South Korea', teamB: 'Czechia', scoreA: 1, scoreB: 0, status: '1H' },
      // A scheduled (not live) match must be ignored entirely.
      { round: 'group', teamA: 'Canada', teamB: 'Qatar', scoreA: 0, scoreB: 0, status: 'NS' },
    ],
    advancement: {},
  };
  const t = computeTeamPoints(s);
  assert.equal(t['South Korea'].goals, 1);
  assert.equal(t['South Korea'].matchPts, 0);       // no provisional win
  assert.equal(t['South Korea'].raw, 1);
  assert.equal(t['South Korea'].total, 3.5);        // 1 goal × T5 (3.5)
  assert.equal(t['South Korea'].live, true);
  assert.equal(t['Czechia'].live, true);            // playing live, 0 goals
  assert.equal(t['Czechia'].total, 0);
  assert.equal(t['Canada'], undefined);             // scheduled, not counted
});

ok('a final match for a pairing suppresses any stale live fixture', () => {
  const s = {
    matches: [{ round: 'group', teamA: 'South Korea', teamB: 'Czechia', scoreA: 2, scoreB: 1, final: true }],
    fixtures: [{ round: 'group', teamA: 'South Korea', teamB: 'Czechia', scoreA: 1, scoreB: 0, status: '2H' }],
    advancement: {},
  };
  const t = computeTeamPoints(s);
  // Counted once, from the FINAL match: win 3 + 2 goals = 5 raw (no double count).
  assert.equal(t['South Korea'].goals, 2);
  assert.equal(t['South Korea'].matchPts, 3);
  assert.equal(t['South Korea'].raw, 5);
  assert.ok(!t['South Korea'].live);
});

ok('advancement auto-derives live from the knockout bracket', () => {
  const s = {
    matches: [
      { round: 'r32', teamA: 'South Africa', teamB: 'Canada', scoreA: 0, scoreB: 1, final: true }, // both reached R32
      { round: 'final', teamA: 'Spain', teamB: 'France', scoreA: 2, scoreB: 1, final: true },        // Spain champion
    ],
    fixtures: [
      { round: 'r32', teamA: 'Brazil', teamB: 'Japan', status: 'NS' },        // scheduled R32 still = out of group
      { round: 'qf', teamA: 'Germany', teamB: 'Winner R16-3', status: 'NS' }, // Germany reached QF; placeholder skipped
    ],
    advancement: {},
  };
  const t = computeTeamPoints(s);
  assert.equal(t['South Africa'].advBonus, cumulativeBonus('r32'));   // 5 — advanced even though it LOST in R32
  assert.equal(t['Canada'].advBonus, cumulativeBonus('r32'));
  assert.equal(t['Brazil'].advBonus, cumulativeBonus('r32'));         // scheduled R32 counts
  assert.equal(t['Germany'].advBonus, cumulativeBonus('qf'));         // 13
  assert.equal(t['Spain'].advBonus, cumulativeBonus('champion'));     // 67 — won the final
  assert.equal(t['France'].advBonus, cumulativeBonus('final'));       // 43 — reached final, lost
  assert.equal(t['Winner R16-3'], undefined);                         // placeholder not credited
});

ok('manual advancement overrides the auto-derived stage', () => {
  const s = {
    matches: [{ round: 'r32', teamA: 'Spain', teamB: 'France', scoreA: 1, scoreB: 0, final: true }],
    advancement: { Spain: 'champion' }, // admin override
  };
  const t = computeTeamPoints(s);
  assert.equal(t['Spain'].advBonus, cumulativeBonus('champion')); // manual wins
  assert.equal(t['France'].advBonus, cumulativeBonus('r32'));     // auto still applies to the other team
});

ok('group winner: 1st in a completed group gets +5 (tier-scaled); others get nothing', () => {
  const s = {
    matches: [
      { round: 'group', group: 'A', teamA: 'Mexico', teamB: 'South Africa', scoreA: 2, scoreB: 0, final: true },
      { round: 'group', group: 'A', teamA: 'South Korea', teamB: 'Czechia', scoreA: 1, scoreB: 1, final: true },
      { round: 'group', group: 'A', teamA: 'Mexico', teamB: 'South Korea', scoreA: 3, scoreB: 1, final: true },
      { round: 'group', group: 'A', teamA: 'Czechia', teamB: 'South Africa', scoreA: 0, scoreB: 2, final: true },
      { round: 'group', group: 'A', teamA: 'Mexico', teamB: 'Czechia', scoreA: 1, scoreB: 0, final: true },
      { round: 'group', group: 'A', teamA: 'South Africa', teamB: 'South Korea', scoreA: 1, scoreB: 1, final: true },
    ],
    advancement: {},
  };
  const t = computeTeamPoints(s);
  assert.equal(t['Mexico'].groupWinner, true);
  assert.equal(t['Mexico'].src.adv.pts, 5);   // group-winner bonus (no knockout fixtures here)
  assert.ok(!t['South Africa'].groupWinner);  // 2nd
  assert.equal(t['South Africa'].src.adv.pts, 0);
});

ok('group winner + advancing out of group stack to 8 (3 + 5) before the multiplier', () => {
  const s = {
    matches: [
      { round: 'group', group: 'A', teamA: 'Mexico', teamB: 'South Africa', scoreA: 1, scoreB: 0, final: true },
      { round: 'group', group: 'A', teamA: 'Mexico', teamB: 'South Korea', scoreA: 1, scoreB: 0, final: true },
      { round: 'group', group: 'A', teamA: 'Mexico', teamB: 'Czechia', scoreA: 1, scoreB: 0, final: true },
      { round: 'group', group: 'A', teamA: 'South Africa', teamB: 'South Korea', scoreA: 0, scoreB: 0, final: true },
      { round: 'group', group: 'A', teamA: 'South Africa', teamB: 'Czechia', scoreA: 0, scoreB: 0, final: true },
      { round: 'group', group: 'A', teamA: 'South Korea', teamB: 'Czechia', scoreA: 0, scoreB: 0, final: true },
    ],
    fixtures: [{ round: 'r32', teamA: 'Mexico', teamB: 'Japan', status: 'NS' }], // Mexico also advanced
    advancement: {},
  };
  const t = computeTeamPoints(s);
  assert.equal(t['Mexico'].advBonus, 8); // out-of-group 3 + group-winner 5
});

ok('group winner bonus waits until the group is actually complete', () => {
  const s = {
    matches: [{ round: 'group', group: 'A', teamA: 'Mexico', teamB: 'South Africa', scoreA: 2, scoreB: 0, final: true }],
    advancement: {},
  };
  const t = computeTeamPoints(s);
  assert.ok(!t['Mexico'].groupWinner); // only one game played -> group undecided
});

ok('winning a knockout match advances the stage the moment it is final', () => {
  const s = {
    matches: [
      // Morocco won its R32 game -> now reached the R16 (no extra bonus, but the
      // stage/tag must move off R32).
      { round: 'r32', teamA: 'Scotland', teamB: 'Morocco', scoreA: 0, scoreB: 1, final: true },
      // Won an R16 game -> reached the QF (and earns the +8 QF bonus).
      { round: 'r16', teamA: 'Spain', teamB: 'Mexico', scoreA: 2, scoreB: 0, final: true },
    ],
    advancement: {},
  };
  const adv = derivedAdvancement(s);
  assert.equal(adv['Morocco'], 'r16');   // advanced past R32
  assert.equal(adv['Scotland'], 'r32');  // lost in R32, stays
  assert.equal(adv['Spain'], 'qf');      // won R16 -> reached QF
  assert.equal(adv['Mexico'], 'r16');    // lost in R16, stays
  const t = computeTeamPoints(s);
  assert.equal(t['Morocco'].advBonus, cumulativeBonus('r16')); // 3 (R16 adds nothing)
  assert.equal(t['Morocco'].advBonus, 3);
  assert.equal(t['Spain'].advBonus, cumulativeBonus('qf'));     // 11
});

ok('3rd-place playoff counts as a KO win but confers no advancement bonus', () => {
  const s = {
    matches: [
      { round: 'sf', teamA: 'England', teamB: 'Argentina', scoreA: 1, scoreB: 0, final: true },   // Argentina loses SF
      { round: 'third', teamA: 'Argentina', teamB: 'France', scoreA: 2, scoreB: 0, final: true }, // wins 3rd place
    ],
    advancement: {},
  };
  const adv = derivedAdvancement(s);
  assert.equal(adv['Argentina'], 'sf');    // reached SF — NOT bumped to 'final' by the playoff win
  assert.equal(adv['England'], 'final');   // England won the actual semi -> reached the final
  const t = computeTeamPoints(s);
  assert.equal(t['Argentina'].src.koWin.pts, 5);            // playoff win still scores 5
  assert.equal(t['Argentina'].goals, 2);                    // + its goals
  assert.equal(t['Argentina'].advBonus, cumulativeBonus('sf')); // 23 — no phantom "reached final" bonus
});

ok('group-stage non-advancers are eliminated once the knockout bracket is set', () => {
  const s = {
    matches: [
      { round: 'group', group: 'A', teamA: 'South Africa', teamB: 'Czechia', scoreA: 0, scoreB: 1, final: true },
    ],
    fixtures: [
      { round: 'r32', teamA: 'Mexico', teamB: 'Japan', status: 'NS' }, // bracket set -> Mexico & Japan advanced
    ],
  };
  const e = eliminatedSet(s);
  assert.ok(e.has('South Africa')); // played the group, didn't reach R32 -> out
  assert.ok(e.has('Czechia'));      // ditto
  assert.ok(!e.has('Mexico'));      // advanced
  assert.ok(!e.has('Japan'));       // advanced
});

ok('nobody is group-eliminated before the bracket exists', () => {
  const s = {
    matches: [{ round: 'group', group: 'A', teamA: 'South Africa', teamB: 'Czechia', scoreA: 0, scoreB: 1, final: true }],
    fixtures: [],
  };
  const e = eliminatedSet(s);
  assert.ok(!e.has('South Africa')); // group stage still in progress -> not greyed
  assert.ok(!e.has('Czechia'));
});

ok('contest elimination: an entry whose surviving teams ⊆ a higher entry can’t win', () => {
  const state = {
    matches: [
      { round: 'group', teamA: 'France', teamB: 'Norway', scoreA: 1, scoreB: 0, final: true }, // France +4 (shared)
      { round: 'group', teamA: 'Spain', teamB: 'Norway', scoreA: 5, scoreB: 0, final: true },   // Spain +8 (leader only)
    ],
    fixtures: [{ round: 'r32', teamA: 'France', teamB: 'Japan', status: 'NS' }], // bracket set; France alive, Spain out
    advancement: {},
  };
  const roster = [
    { name: 'Leader', picks: ['France', 'Spain'] },
    { name: 'Sub', picks: ['France'] },
  ];
  const dead = contestEliminated(state, roster);
  assert.ok(dead.has('Sub'));      // France is shared; Spain gives Leader an untouchable edge
  assert.ok(!dead.has('Leader'));  // nobody is ahead of the leader
});

ok('contest elimination: an entry with exclusive live upside is NOT eliminated', () => {
  const state = {
    matches: [{ round: 'group', teamA: 'Spain', teamB: 'Norway', scoreA: 5, scoreB: 0, final: true }], // Leader +8
    fixtures: [
      { round: 'r32', teamA: 'Spain', teamB: 'Japan', status: 'NS' },     // Leader's Spain alive
      { round: 'r32', teamA: 'Argentina', teamB: 'Egypt', status: 'NS' }, // Challenger's Argentina alive (exclusive)
    ],
    advancement: {},
  };
  const roster = [
    { name: 'Leader', picks: ['Spain'] },       // 8 now
    { name: 'Challenger', picks: ['Argentina'] }, // 0 now, but Argentina (T1) can run the table
  ];
  const dead = contestEliminated(state, roster);
  assert.ok(!dead.has('Challenger')); // exclusive Argentina upside > 8 -> still alive
});

console.log(`\n${pass} tests passed ✓`);
