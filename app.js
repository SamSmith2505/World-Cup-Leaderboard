// Public leaderboard — fetches state + roster, computes standings client-side.
import { compute, computeMovers } from '/lib/scoring.js';
import { TIER_MULTIPLIERS } from '/lib/config.js';

const boardEl = document.getElementById('board');
const metaEl = document.getElementById('meta');
const moversEl = document.getElementById('movers');
const moversList = document.getElementById('moversList');

const expanded = new Set();

async function load() {
  try {
    const [stateRes, rosterRes] = await Promise.all([
      fetch('/api/state').then((r) => r.json()),
      fetch('/api/roster').then((r) => r.json()),
    ]);
    const state = stateRes.state || { matches: [], advancement: {}, meta: {} };
    const snapshot = stateRes.snapshot || null;
    const roster = rosterRes.roster || [];

    const { standings, lastUpdated } = compute(state, roster);
    render(standings);
    renderMovers(standings, snapshot);
    renderMeta(lastUpdated, roster.length, rosterRes.source);
  } catch (e) {
    boardEl.innerHTML = `<div class="loading">Couldn't load data. ${escapeHtml(String(e))}</div>`;
  }
}

function renderMeta(lastUpdated, n, source) {
  const when = lastUpdated ? new Date(lastUpdated).toLocaleString() : 'no results entered yet';
  const src = source === 'fallback' ? ' · roster: offline snapshot' : '';
  metaEl.textContent = `${n} players · last updated: ${when}${src}`;
}

function render(standings) {
  if (!standings.length) {
    boardEl.innerHTML = `<div class="loading">No players yet.</div>`;
    return;
  }
  boardEl.innerHTML = '';
  for (const row of standings) {
    boardEl.appendChild(rowEl(row));
  }
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
    <span class="chev" aria-hidden="true">▸</span>
  `;
  head.addEventListener('click', () => {
    if (expanded.has(row.name)) expanded.delete(row.name);
    else expanded.add(row.name);
    wrap.classList.toggle('open');
  });

  const body = document.createElement('div');
  body.className = 'row-body';
  body.appendChild(breakdownTable(row.breakdown));

  wrap.appendChild(head);
  wrap.appendChild(body);
  return wrap;
}

function breakdownTable(breakdown) {
  const t = document.createElement('table');
  t.className = 'bd';
  t.innerHTML = `
    <thead><tr>
      <th>Team</th><th>Tier</th><th class="num">Base</th>
      <th class="num">×</th><th class="num">Points</th>
    </tr></thead>
    <tbody></tbody>`;
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

function renderMovers(standings, snapshot) {
  const prev = snapshot?.standings || null;
  const movers = computeMovers(standings, prev).slice(0, 3);
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

function fmt(n) {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

load();
setInterval(load, 60_000); // light auto-refresh
