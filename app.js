// Public page — leaderboard + points-by-team, with throttled auto-sync.
import { compute, computeMovers, computeTeamPoints } from '/lib/scoring.js';
import { TIER_MULTIPLIERS, tierOf, canonicalTeam, groupOf } from '/lib/config.js';

const boardEl = document.getElementById('board');
const teamsEl = document.getElementById('teams');
const metaEl = document.getElementById('meta');
const moversEl = document.getElementById('movers');
const moversList = document.getElementById('moversList');

const expanded = new Set();
let lastData = null; // { state, snapshot, roster }

// ---- tab switching ---------------------------------------------------------
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
    const tab = btn.dataset.tab;
    document.getElementById('view-board').classList.toggle('hidden', tab !== 'board');
    document.getElementById('view-teams').classList.toggle('hidden', tab !== 'teams');
    if (tab === 'teams' && lastData) renderTeams();
  });
});
document.getElementById('teamSort').addEventListener('change', renderTeams);
document.getElementById('onlyScored').addEventListener('change', renderTeams);
document.getElementById('groupFilter').addEventListener('change', renderTeams);

// ---- data load -------------------------------------------------------------
async function load() {
  try {
    const [stateRes, rosterRes] = await Promise.all([
      fetch('/api/state').then((r) => r.json()),
      fetch('/api/roster').then((r) => r.json()),
    ]);
    const state = stateRes.state || { matches: [], advancement: {}, meta: {} };
    lastData = { state, snapshot: stateRes.snapshot || null, roster: rosterRes.roster || [], rosterSource: rosterRes.source };

    const { standings, lastUpdated } = compute(state, lastData.roster);
    render(standings);
    renderMovers(standings, lastData.snapshot);
    renderMeta(lastUpdated, lastData.roster.length, lastData.rosterSource);
    if (!document.getElementById('view-teams').classList.contains('hidden')) renderTeams();
  } catch (e) {
    boardEl.innerHTML = `<div class="loading">Couldn't load data. ${escapeHtml(String(e))}</div>`;
  }
}

function renderMeta(lastUpdated, n, source) {
  const when = lastUpdated ? new Date(lastUpdated).toLocaleString() : 'no results yet';
  const src = source === 'fallback' ? ' · roster: offline snapshot' : '';
  metaEl.textContent = `${n} players · updated: ${when}${src}`;
}

// ---- leaderboard -----------------------------------------------------------
function render(standings) {
  if (!standings.length) { boardEl.innerHTML = `<div class="loading">No players yet.</div>`; return; }
  boardEl.innerHTML = '';
  for (const row of standings) boardEl.appendChild(rowEl(row));
}

function rowEl(row) {
  const wrap = document.createElement('div');
  wrap.className = 'row' + (expanded.has(row.name) ? ' open' : '');
  const head = document.createElement('button');
  head.className = 'row-head';
  head.innerHTML = `
    <span class="rank rank-${row.rank}">${row.rank}</span>
    <span class="name">${escapeHtml(row.name)}</span>
    <span class="pts">${fmt(row.total)}</span>
    <span class="chev" aria-hidden="true">▸</span>`;
  head.addEventListener('click', () => {
    if (expanded.has(row.name)) expanded.delete(row.name); else expanded.add(row.name);
    wrap.classList.toggle('open');
  });
  const body = document.createElement('div');
  body.className = 'row-body';
  body.appendChild(breakdownTable(row.breakdown));
  wrap.appendChild(head); wrap.appendChild(body);
  return wrap;
}

function breakdownTable(breakdown) {
  const t = document.createElement('table');
  t.className = 'bd';
  t.innerHTML = `<thead><tr>
      <th>Team</th><th>Tier</th><th class="num">Base</th><th class="num">×</th><th class="num">Points</th>
    </tr></thead><tbody></tbody>`;
  const tb = t.querySelector('tbody');
  for (const tp of breakdown) {
    const tr = document.createElement('tr');
    const mult = TIER_MULTIPLIERS[tp.tier] ?? tp.multiplier ?? 1;
    tr.innerHTML = `
      <td>${escapeHtml(tp.team)}${stageTag(tp.stage)}</td>
      <td>T${tp.tier ?? '?'}</td>
      <td class="num" title="match ${fmt(tp.matchPts)} + goals ${fmt(tp.goals)} + bonus ${fmt(tp.advBonus)}">${fmt(tp.raw)}</td>
      <td class="num">${mult}</td>
      <td class="num strong">${fmt(tp.total)}</td>`;
    tb.appendChild(tr);
  }
  return t;
}

function stageTag(stage) {
  if (!stage || stage === 'none') return '';
  const map = { r32: 'R32', qf: 'QF', sf: 'SF', final: 'Final', champion: '🏆' };
  return ` <span class="tag">${map[stage] || stage}</span>`;
}

// ---- points by team --------------------------------------------------------
function ownersByTeam() {
  const map = {};
  for (const p of lastData.roster) {
    const seen = new Set();
    for (const t of p.picks || []) {
      const canon = canonicalTeam(t);
      if (seen.has(canon)) continue;
      seen.add(canon);
      (map[canon] ||= []).push(p.name);
    }
  }
  return map;
}

function renderTeams() {
  if (!lastData) return;
  const teamPoints = computeTeamPoints(lastData.state);
  const owners = ownersByTeam();

  // Union of teams that scored + teams someone picked (populated pre-tournament).
  const picked = new Set();
  for (const p of lastData.roster) for (const t of p.picks || []) picked.add(canonicalTeam(t));
  const names = new Set([...Object.keys(teamPoints), ...picked]);

  let rows = [...names].map((name) => {
    const r = teamPoints[name] || emptyTeam(name);
    r.owners = owners[r.team] || [];
    return r;
  });

  // Populate the group filter from groups we actually know about.
  refreshGroupFilter(rows);

  if (document.getElementById('onlyScored').checked) rows = rows.filter((r) => r.total > 0);
  const gf = document.getElementById('groupFilter').value;
  if (gf) rows = rows.filter((r) => r.group === gf);

  const sort = document.getElementById('teamSort').value;
  rows.sort((a, b) => {
    if (sort === 'tier') return (a.tier ?? 9) - (b.tier ?? 9) || b.total - a.total || a.team.localeCompare(b.team);
    if (sort === 'group') return (a.group || 'Z').localeCompare(b.group || 'Z') || b.total - a.total || a.team.localeCompare(b.team);
    if (sort === 'name') return a.team.localeCompare(b.team);
    return b.total - a.total || (a.tier ?? 9) - (b.tier ?? 9) || a.team.localeCompare(b.team);
  });

  if (!rows.length) { teamsEl.innerHTML = `<div class="loading">No teams to show.</div>`; return; }
  teamsEl.innerHTML = '';
  for (const r of rows) teamsEl.appendChild(teamCard(r));
}

function refreshGroupFilter(rows) {
  const sel = document.getElementById('groupFilter');
  const groups = [...new Set(rows.map((r) => r.group).filter(Boolean))].sort();
  const cur = sel.value;
  const wanted = '<option value="">All groups</option>' + groups.map((g) => `<option value="${g}">Group ${g}</option>`).join('');
  if (sel.dataset.groups !== groups.join('')) {
    sel.innerHTML = wanted;
    sel.dataset.groups = groups.join('');
    if (groups.includes(cur)) sel.value = cur;
  }
}

function emptyTeam(name) {
  return {
    team: name, tier: tierOf(name), group: groupOf(name), multiplier: TIER_MULTIPLIERS[tierOf(name)] ?? 1,
    matchPts: 0, goals: 0, advBonus: 0, raw: 0, total: 0,
    src: { groupWin: { pts: 0, n: 0 }, groupDraw: { pts: 0, n: 0 }, groupGoals: { pts: 0, n: 0 }, koWin: { pts: 0, n: 0 }, koGoals: { pts: 0, n: 0 }, adv: { pts: 0 } },
  };
}

function teamCard(r) {
  const s = r.src;
  const card = document.createElement('div');
  card.className = 'team-card';
  const items = [
    ['Group wins', s.groupWin.pts, s.groupWin.n ? `${s.groupWin.n}W` : ''],
    ['Group draws', s.groupDraw.pts, s.groupDraw.n ? `${s.groupDraw.n}D` : ''],
    ['Group goals', s.groupGoals.pts, s.groupGoals.n ? `${s.groupGoals.n}⚽` : ''],
    ['KO wins', s.koWin.pts, s.koWin.n ? `${s.koWin.n}W` : ''],
    ['KO goals', s.koGoals.pts, s.koGoals.n ? `${s.koGoals.n}⚽` : ''],
    ['Advancement', s.adv.pts, ''],
  ];
  const mult = TIER_MULTIPLIERS[r.tier] ?? r.multiplier ?? 1;
  const owners = r.owners || [];
  const ownersHtml = owners.length
    ? `Picked by <b>${owners.length}</b>: ${owners.map(escapeHtml).join(', ')}`
    : `Picked by <b>0</b>`;
  card.innerHTML = `
    <div class="tc-head">
      <span class="tc-name">${escapeHtml(r.team)}${stageTag(r.stage)}</span>
      ${r.group ? `<span class="tc-grp">Grp ${escapeHtml(r.group)}</span>` : ''}
      <span class="tc-tier tier-${r.tier}">T${r.tier ?? '?'}</span>
      <span class="tc-total">${fmt(r.total)}</span>
    </div>
    <div class="tc-owners">${ownersHtml}</div>
    <div class="tc-grid">
      ${items.map(([label, pts, note]) => `
        <div class="tc-item${pts ? '' : ' zero'}">
          <span class="tc-label">${label}</span>
          <span class="tc-val">${fmt(pts)}${note ? ` <span class="tc-note">${note}</span>` : ''}</span>
        </div>`).join('')}
    </div>
    <div class="tc-foot">
      <span>Base <b>${fmt(r.raw)}</b></span>
      <span>× ${mult}</span>
      <span>= <b>${fmt(r.total)}</b></span>
    </div>`;
  return card;
}

// ---- movers ----------------------------------------------------------------
function renderMovers(standings, snapshot) {
  const movers = computeMovers(standings, snapshot?.standings || null).slice(0, 3);
  if (!movers.length) { moversEl.classList.add('hidden'); return; }
  moversEl.classList.remove('hidden');
  moversList.innerHTML = '';
  for (const m of movers) {
    const dir = m.rankDelta > 0 ? 'up' : m.rankDelta < 0 ? 'down' : 'flat';
    const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '—';
    const el = document.createElement('div');
    el.className = `mover ${dir}`;
    el.innerHTML = `<span class="m-arrow">${arrow}</span>
      <span class="m-name">${escapeHtml(m.name)}</span>
      <span class="m-pts">+${fmt(Math.abs(m.pointsDelta))} pts${m.rankDelta ? ` · ${Math.abs(m.rankDelta)} spot${Math.abs(m.rankDelta) > 1 ? 's' : ''}` : ''}</span>`;
    moversList.appendChild(el);
  }
}

// ---- auto-sync (throttled server-side) -------------------------------------
async function triggerSync() {
  try {
    const j = await fetch('/api/sync').then((r) => r.json());
    if (j && j.updated) load(); // new results -> refresh
  } catch {}
}

function fmt(n) { const v = Number(n) || 0; return Number.isInteger(v) ? String(v) : v.toFixed(1); }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

load().then(triggerSync);
setInterval(load, 60_000);        // refresh view
setInterval(triggerSync, 300_000); // nudge a sync every 5 min (server throttles)
