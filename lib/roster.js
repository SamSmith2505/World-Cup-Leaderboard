// ============================================================================
// Roster parsing + fallback snapshot.
// ----------------------------------------------------------------------------
// The live roster is pulled from the Google Sheet CSV (see /api/roster.js).
// This file holds the CSV parser plus a committed snapshot used as a fallback
// when the sheet can't be reached.
// ============================================================================

import { canonicalTeam } from './config.js';

// Minimal CSV parser (handles quoted fields + commas inside quotes).
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* skip */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

// Turn "Player,Team,Tier" rows into [{ name, picks: [team,...] }].
// The sheet's Tier column is intentionally ignored — tiers come from config.
export function rosterFromCSV(text) {
  const rows = parseCSV(text);
  if (!rows.length) return [];
  // Detect + drop header row.
  const header = rows[0].map((h) => String(h).trim().toLowerCase());
  const hasHeader = header.includes('player') && header.includes('team');
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const pCol = hasHeader ? header.indexOf('player') : 0;
  const tCol = hasHeader ? header.indexOf('team') : 1;

  const byPlayer = new Map();
  const order = [];
  for (const r of dataRows) {
    const name = String(r[pCol] ?? '').trim();
    const team = String(r[tCol] ?? '').trim();
    if (!name || !team) continue;
    if (!byPlayer.has(name)) { byPlayer.set(name, new Set()); order.push(name); }
    byPlayer.get(name).add(canonicalTeam(team));
  }
  return order.map((name) => ({ name, picks: [...byPlayer.get(name)] }));
}

// Fallback snapshot (from the sheet on 2026-06-07). Used only if the live fetch
// fails. Tiers are derived from config, not stored here.
export const ROSTER_FALLBACK = [
  { name: 'Sam', picks: ['France', 'Germany', 'Mexico', 'Senegal', 'South Korea', 'Saudi Arabia', 'Norway', 'Croatia', 'Cape Verde'] },
  { name: 'JDu', picks: ['France', 'Netherlands', 'Morocco', 'Ecuador', 'Egypt', 'South Korea', 'Argentina', 'Mexico', 'Saudi Arabia'] },
  { name: 'Jon', picks: ['Spain', 'France', 'Germany', 'Mexico', 'Switzerland', 'Austria', 'Czechia', 'Tunisia', 'Australia'] },
];
