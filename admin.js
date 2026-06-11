// Admin panel — edit matches & advancement, persist via /api/state.
import { ROUNDS, STAGES, ALL_TEAMS, canonicalTeam, tierOf } from '/lib/config.js';
import { compute } from '/lib/scoring.js';

const $ = (id) => document.getElementById(id);
let state = { matches: [], advancement: {}, meta: {} };
let roster = [];

const tokenEl = $('token');
tokenEl.value = localStorage.getItem('wc-admin-token') || '';
tokenEl.addEventListener('change', () => localStorage.setItem('wc-admin-token', tokenEl.value));

// Populate round + team + group pickers.
const GROUP_LETTERS = 'ABCDEFGHIJKL'.split('');
$('nRound').innerHTML = ROUNDS.map((r) => `<option value="${r.key}">${r.label}</option>`).join('');
$('teams').innerHTML = ALL_TEAMS.slice().sort().map((t) => `<option value="${t}">`).join('');
$('nGroup').innerHTML = '<option value="">Grp</option>' + GROUP_LETTERS.map((g) => `<option value="${g}">${g}</option>`).join('');
function groupOpts(sel) {
  return '<option value="">Grp</option>' + GROUP_LETTERS.map((g) => `<option value="${g}" ${g === sel ? 'selected' : ''}>${g}</option>`).join('');
}

async function load() {
  const [s, r] = await Promise.all([
    fetch('/api/state').then((x) => x.json()),
    fetch('/api/roster').then((x) => x.json()),
  ]);
  state = s.state || { matches: [], advancement: {}, meta: {} };
  state.matches = state.matches || [];
  state.advancement = state.advancement || {};
  state.eliminated = state.eliminated || {};
  state.meta = state.meta || {};
  roster = r.roster || [];
  renderSyncInfo();
  renderHealth();
  renderMatches();
  renderAdvancement();
}

// Cross-check team names: every sheet pick and every API team name must
// resolve to a canonical team, or scores will silently not credit owners.
function renderHealth() {
  const el = $('health');
  const issues = [];
  for (const p of roster) {
    for (const t of p.picks || []) {
      if (tierOf(t) == null) issues.push(`Sheet pick "${t}" (${p.name}) doesn't match any team — fix the sheet spelling or add an alias in lib/config.js.`);
    }
  }
  if (state.meta?.unmatchedTeams?.length) {
    issues.push(`API team names with no match: ${state.meta.unmatchedTeams.join(', ')} — add them to ALIASES in lib/config.js.`);
  }
  if (state.meta?.lastSyncError) issues.push(`Last sync: ${state.meta.lastSyncError}`);
  el.innerHTML = issues.length
    ? issues.map((i) => `<div class="health bad">⚠️ ${escapeHtml(i)}</div>`).join('')
    : `<div class="health ok">✅ All ${roster.length} players' picks match canonical teams · no API name mismatches or sync errors reported.</div>`;
}

function renderSyncInfo() {
  const el = $('syncInfo');
  const t = state.meta?.lastSyncAt;
  el.textContent = t ? `last API sync: ${new Date(t).toLocaleString()}` : 'no API sync yet';
}

function isManual(m) { return m?.source === 'manual' || m?.manual === true; }

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
      ${m.round === 'group' ? `<select data-i="${i}" data-f="group">${groupOpts(m.group)}</select>` : ''}
      <input class="grow" list="teams" data-i="${i}" data-f="teamA" value="${attr(m.teamA)}" />
      <input type="number" min="0" data-i="${i}" data-f="scoreA" value="${Number(m.scoreA) || 0}" />
      <span>–</span>
      <input type="number" min="0" data-i="${i}" data-f="scoreB" value="${Number(m.scoreB) || 0}" />
      <input class="grow" list="teams" data-i="${i}" data-f="teamB" value="${attr(m.teamB)}" />
      <label class="muted"><input type="checkbox" data-i="${i}" data-f="final" ${m.final ? 'checked' : ''}/> final</label>
      ${needsWinner(m) ? winnerSelect(m, i) : ''}
      ${isManual(m) ? '<span class="flag">manual</span>' : '<span class="flag2">auto</span>'}
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
  m.source = 'manual'; // editing an auto match converts it to a manual override
  renderMatches();
}

$('addMatch').addEventListener('click', () => {
  const a = canonicalTeam($('nA').value);
  const b = canonicalTeam($('nB').value);
  if (!a || !b) return toast('Enter both teams');
  const round = $('nRound').value;
  state.matches.push({
    round, group: round === 'group' ? ($('nGroup').value || null) : null,
    teamA: a, teamB: b,
    scoreA: Number($('nSA').value) || 0, scoreB: Number($('nSB').value) || 0,
    final: true, manual: true, source: 'manual',
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
    const isOut = !!state.eliminated[t];
    row.innerHTML = `<span>${escapeHtml(t)} <span class="muted">· T${tierOf(t) ?? '?'}</span></span>
      <span class="adv-controls">
        <label class="muted"><input type="checkbox" class="elimchk" ${isOut ? 'checked' : ''}/> out</label>
        <select data-team="${attr(t)}">${opts}</select>
      </span>`;
    row.querySelector('select').addEventListener('change', (e) => {
      const v = e.target.value;
      if (v === 'none') delete state.advancement[t];
      else state.advancement[t] = v;
    });
    row.querySelector('.elimchk').addEventListener('change', (e) => {
      if (e.target.checked) state.eliminated[t] = true;
      else delete state.eliminated[t];
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

async function syncNow() {
  toast('Syncing…');
  try {
    const j = await fetch('/api/sync?force=1').then((r) => r.json());
    if (j.configured === false) return toast('No API key set on server');
    if (j.ok === false) return toast('Sync failed: ' + (j.error || j.message || '?'));
    await load();
    let msg = `Synced ✓ ${j.updated} auto matches`;
    if (j.unmatchedTeams?.length) msg += ` · unmatched: ${j.unmatchedTeams.join(', ')}`;
    toast(msg);
  } catch (e) { toast('Sync error'); }
}

$('save').addEventListener('click', save);
$('reload').addEventListener('click', load);
$('snapshot').addEventListener('click', snapshot);
$('syncNow').addEventListener('click', syncNow);

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}
function attr(s) { return String(s || '').replace(/"/g, '&quot;'); }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// Date.now/new Date used at runtime in the browser is fine here.
load();
