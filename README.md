# World Cup 2026 Pick'em Pool — Leaderboard

A mobile-first, single-page leaderboard for a World Cup 2026 pick'em pool. Public
read-only leaderboard + an unlisted admin page for entering/correcting results.
Manual-first (you enter results), with the roster pulled live from a Google Sheet.

## How it works

- **Roster** is read live from the "Player Scores" tab of the Google Sheet
  (`ROSTER_CSV_URL` in `lib/config.js`). New players/picks added to the sheet show
  up automatically within ~3 minutes — no redeploy. Each player can own any number
  of teams; tiers are NOT taken from the sheet (its Tier column is inconsistent) —
  they come from the canonical table in `lib/config.js`.
- **Results** are entered/confirmed by you on the admin page and stored in Vercel
  KV. They go live for everyone instantly.
- **Scoring** (see `lib/scoring.js`) is computed in the browser from results +
  roster: match points + goals + cumulative advancement bonuses, all × the team's
  tier multiplier, credited to every owner of that team.

## URLs

- Public leaderboard: `/`
- Admin (unlisted): `/admin-3f9a2c7b.html`  ← change this filename + `ADMIN_PATH`
  in `lib/config.js` to rotate it.

## Configuration — everything is in `lib/config.js`

- `TIER_MULTIPLIERS` — tier → multiplier.
- `SCORING` — group/knockout win/draw/goal points.
- `STAGES` — cumulative advancement bonuses (R32 → Champion).
- `TIERS` — the canonical team → tier table (single source of truth).
  - Cape Verde is in **Tier 5**; Saudi Arabia in **Tier 6**. Adjust if the field changes.
- `ROSTER_CSV_URL` — the published Google Sheet CSV.
- `ADMIN_PATH` — the unlisted admin route.

## Run locally (no Vercel/KV needed)

```bash
npm install
node scripts/dev-server.mjs      # http://localhost:5173
# admin: http://localhost:5173/admin-3f9a2c7b.html
```

The dev server mocks the two API routes and persists to `.devstate.json`.

Run the scoring tests:

```bash
npm test
```

## Deploy to Vercel

1. Push this repo to GitHub and import it into Vercel (Framework preset: **Other**).
2. In the project, add **Storage → KV** (Upstash). Vercel injects
   `KV_REST_API_URL` / `KV_REST_API_TOKEN` automatically.
3. (Optional) Set `ADMIN_TOKEN` to require a password for admin writes. If unset,
   the admin relies on the unlisted route alone (the page is `noindex`).
4. Deploy. The public leaderboard is at `/`; admin at the unlisted path above.

## Admin workflow (daily, ~2 min)

1. Open the unlisted admin page.
2. **Add / edit matches** — pick the round, both teams, the score, tick **final**.
   For a knockout decided on penalties, set the winner in the "pens?" dropdown.
   Every manual entry is flagged `manual` and takes precedence over any API data.
3. **Advancement** — for each picked team, set the furthest stage reached
   (cumulative: choosing "Reached Semifinal" awards R32 + QF + SF bonuses).
4. **Save all changes** → live for everyone.
5. (Optional) **Snapshot "today"** to freeze current standings so the public page's
   "biggest movers" compares against that baseline.

## Wiring an API later (optional)

The app is manual-first by design (free-tier WC2026 coverage is unreliable). To add
auto-pull, create `api/sync.js` that fetches fixtures/results from your provider,
maps them into the same `state.matches` shape, and writes via the KV helpers in
`api/state.js`. Keep advancement as a manual confirm step. Store the API key in an
env var. A Vercel Cron can call it a few times a day.

## File map

| File | Purpose |
|------|---------|
| `lib/config.js` | Tiers, multipliers, scoring rules, stages, roster URL, admin path |
| `lib/scoring.js` | Pure scoring engine (browser + server) |
| `lib/roster.js` | CSV parser + fallback roster snapshot |
| `api/state.js` | GET/POST results & overrides (Vercel KV) |
| `api/roster.js` | Live roster from the sheet (cached, with fallback) |
| `index.html` / `app.js` | Public leaderboard |
| `admin-*.html` / `admin.js` | Unlisted admin panel |
| `scripts/dev-server.mjs` | Local dev server (no Vercel needed) |
| `test/scoring.test.mjs` | Scoring engine tests |
