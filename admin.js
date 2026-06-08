// Admin panel — edit matches & advancement, persist via /api/state.
import { ROUNDS, STAGES, ALL_TEAMS, canonicalTeam, tierOf } from '/lib/config.js';
import { compute } from '/lib/scoring.js';

const $ = (id) => document.getElementById(id);
let state = { matches: [], advancement: {}, meta: {} };
let roster = [];

const tokenEl = $('token');
tokenEl.value = localStorage.getItem('wc-admin-token') || '';
tokenEl.addEventListener('change', () => localStorage.setItem('wc-admin-token', tokenEl.value));

// Populate round + team pickers.
$('nRound').innerHTML = ROUNDS.map((r) => `<option value="${r.key}">${r.label}</option>`).join('');
$('teams').innerHTML = ALL_TEAMS.slice().sort().map((t) => `<option value="${t}">`).join('');

async function load() {
  const [s, r] = await Promise.all([
    fetch('/api/state').then((x) => x.json()),
    fetch('/api/roster').then((x) => x.json()),
  ]);
  state = s.state || { matches: [], advancement: {}, meta: {} };
  state.matches = state.matches || [];
  state.advancement = state.advancement || {};
  roster = r.roster || [];
  renderMatches();
  renderAdvancement();
}

function renderMatches() {
  const c = $('matches');
  if (!state.matches.length) { c.innerHTML = '<p class="muted">No matches yet.</p>'; return; }
  c.innerHTML = '';
  state.matches.forEach((m, i) => {
    const row = document.createElement('div');
    row.className = 'match-row';
    const roundOpts = ROUNDS.map((r) => `<option value="${r.key}" ${r.key === m.round ? 'selected' : ''}>${r.label}</option>`).join('');
    row.innerHTML = `
      <select class="grow" data-i="${i}" data-f="round">${roundOpts}</select>
      <input class="grow" list="teams" data-i="${i}" data-f="teamA" value="${attr(m.teamA)}" />
      <input type="number" min="0" data-i="${i}" data-f="scoreA" value="${Number(m.scoreA) || 0}" />
      <span>–</span>
      <input type="number" min="0" data-i="${i}" data-f="scoreB" value="${Number(m.scoreB) || 0}" />
      <input class="grow" list="teams" data-i="${i}" data-f="teamB" value="${attr(m.teamB)}" />
      <label class="muted"><input type="checkbox" data-i="${i}" data-f="final" ${m.final ? 'checked' : ''}/> final</label>
      ${needsWinner(m) ? winnerSelect(m, i) : ''}
      <span class="flag">manual</span>
      <button class="btn danger" data-del="${i}">✕</button>`;
    c.appendChild(row);
  });
  c.querySelectorAll('[data-f]').forEach((el) => el.addEventListener('change', onField));
  c.querySelectorAll('[data-del]').forEach((el) => el.addEventListener('click', () => {
    state.matches.splice(Number(el.dataset.del), 1); renderMatches();
  }));
}

function needsWinner(m) {
  const r = ROUNDS.find((x) => x.key === m.round);
  return r && r.knockout && (Number(m.scoreA) || 0) === (Number(m.scoreB) || 0);
}
function winnerSelect(m, i) {
  return `<select data-i="${i}" data-f="winner" title="Winner on penalties">
    <option value="">pens?</option>
    <option value="A" ${m.winner === 'A' ? 'selected' : ''}>A wins</option>
    <option value="B" ${m.winner === 'B' ? 'selected' : ''}>B wins</option>
  </select>`;
}

function onField(e) {
  const i = Number(e.target.dataset.i);
  const f = e.target.dataset.f;
  const m = state.matches[i];
  if (f === 'final') m.final = e.target.checked;
  else if (f === 'scoreA' || f === 'scoreB') m[f] = Number(e.target.value) || 0;
  else if (f === 'teamA' || f === 'teamB') m[f] = canonicalTeam(e.target.value);
  else m[f] = e.target.value;
  m.manual = true;
  if (f === 'round' || f === 'scoreA' || f === 'scoreB') renderMatches();
}

$('addMatch').addEventListener('click', () => {
  const a = canonicalTeam($('nA').value);
  const b = canonicalTeam($('nB').value);
  if (!a || !b) return toast('Enter both teams');
  state.matches.push({
    round: $('nRound').value, teamA: a, teamB: b,
    scoreA: Number($('nSA').value) || 0, scoreB: Number($('nSB').value) || 0,
    final: true, manual: true,
  });
  $('nA').value = ''; $('nB').value = ''; $('nSA').value = 0; $('nSB').value = 0;
  renderMatches();
});

function renderAdvancement() {
  const c = $('advancement');
  // Teams actually picked by someone.
  const picked = new Set();
  for (const p of roster) for (const t of p.picks || []) picked.add(canonicalTeam(t));
  const teams = [...picked].sort((a, b) => (tierOf(a) || 9) - (tierOf(b) || 9) || a.localeCompare(b));
  if (!teams.length) { c.innerHTML = '<p class="muted">No picked teams yet.</p>'; return; }
  c.innerHTML = '';
  for (const t of teams) {
    const cur = state.advancement[t] || 'none';
    const row = document.createElement('div');
    row.className = 'adv-row';
    const opts = STAGES.map((s) => `<option value="${s.key}" ${s.key === cur ? 'selected' : ''}>${s.label}</option>`).join('');
    row.innerHTML = `<span>${escapeHtml(t)} <span class="muted">· T${tierOf(t) ?? '?'}</span></span>
      <select data-team="${attr(t)}">${opts}</select>`;
    row.querySelector('select').addEventListener('change', (e) => {
      const v = e.target.value;
      if (v === 'none') delete state.advancement[t];
      else state.advancement[t] = v;
    });
    c.appendChild(row);
  }
}

async function save() {
  const r = await fetch('/api/state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': tokenEl.value },
    body: JSON.stringify({ state, token: tokenEl.value, at: new Date().toISOString() }),
  });
  if (r.status === 401) return toast('Unauthorized — check token');
  if (!r.ok) return toast('Save failed');
  toast('Saved ✓');
}

async function snapshot() {
  const { standings } = compute(state, roster);
  const r = await fetch('/api/state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': tokenEl.value },
    body: JSON.stringify({ action: 'snapshot', standings, token: tokenEl.value, at: new Date().toISOString() }),
  });
  if (r.status === 401) return toast('Unauthorized — check token');
  toast('Snapshot saved ✓ (movers reset)');
}

$('save').addEventListener('click', save);
$('reload').addEventListener('click', load);
$('snapshot').addEventListener('click', snapshot);

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}
function attr(s) { return String(s || '').replace(/"/g, '&quot;'); }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// Date.now/new Date used at runtime in the browser is fine here.
load();
