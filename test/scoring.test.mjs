// Run: node test/scoring.test.mjs
import assert from 'node:assert/strict';
import { compute, computeTeamPoints, eliminatedSet } from '../lib/scoring.js';
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
  assert.equal(cumulativeBonus('r32'), 5);
  assert.equal(cumulativeBonus('qf'), 13);     // 5+8
  assert.equal(cumulativeBonus('sf'), 25);     // 5+8+12
  assert.equal(cumulativeBonus('final'), 43);  // +18
  assert.equal(cumulativeBonus('champion'), 67); // +24
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
  // Argentina group: win 3 + 3 goals = 6 ; r32: win 5 + 0 goals = 5 ; champion bonus 67
  assert.equal(teams['Argentina'].matchPts, 8);
  assert.equal(teams['Argentina'].goals, 3);
  assert.equal(teams['Argentina'].advBonus, 67);
  assert.equal(teams['Argentina'].raw, 78);
  assert.equal(teams['Argentina'].total, 78); // T1 x1.0
});

ok('draw awards 1 each + goals', () => {
  assert.equal(teams['Norway'].matchPts, 1);
  assert.equal(teams['Norway'].goals, 2);
  assert.equal(teams['Norway'].total, 6); // raw 3 x T2(2.0)
});

ok('knockout penalty winner gets the win', () => {
  assert.equal(teams['Spain'].matchPts, 0); // lost on pens
  assert.equal(teams['Spain'].total, 0);
});

ok('non-final match is ignored', () => {
  assert.equal(teams['Brazil'], undefined);
});

ok('advancement-only team scores via multiplier', () => {
  // Cape Verde: r32 bonus 5, no matches, T5 x3.5 = 17.5
  assert.equal(teams['Cape Verde'].raw, 5);
  assert.equal(teams['Cape Verde'].total, 17.5);
});

const roster = [
  { name: 'Alice', picks: ['Argentina', 'Norway', 'Argentina'] }, // dup -> counted once
  { name: 'Bob', picks: ['Argentina', 'Cape Verde'] },            // shares Argentina
];
const { standings } = compute(state, roster);

ok('shared team credits all owners + dedupe', () => {
  const alice = standings.find((s) => s.name === 'Alice');
  const bob = standings.find((s) => s.name === 'Bob');
  assert.equal(alice.total, 84);    // 78 + 6 (Argentina counted once)
  assert.equal(bob.total, 95.5);    // 78 + 17.5
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
  assert.equal(a.adv.pts, 67);
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

console.log(`\n${pass} tests passed ✓`);
