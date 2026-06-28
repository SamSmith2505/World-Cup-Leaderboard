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
- `STAGES` — cumulative advancement bonuses (out of group 3 · QF 8 · SF 12 ·
  Final 18 · Champion 24) and `GROUP_WINNER_BONUS` (5, for finishing 1st in a
  group — credited automatically on top of the advancement bonus).
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

Check team-name health (sheet picks ↔ canonical table ↔ API-Football names —
catches things like "Cabo Verde" vs "Cape Verde" before scores flow):

```bash
npm run check     # add APISPORTS_KEY to .env.local to also check API names
```

The admin page shows the same checks live in its **Data health** panel,
including any error API-Football reported on the last sync.

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
3. **Advancement** — auto-fills live from the knockout bracket (a team named in
   the R32 gets the out-of-group bonus, bumping up through QF/SF/Final/Champion
   as results come in; cumulative). You only touch a dropdown to **override**.
   The +5 group-winner bonus is also automatic (1st in a completed group).
4. **Save all changes** → live for everyone.
5. (Optional) **Snapshot "today"** to freeze current standings so the public page's
   "biggest movers" compares against that baseline.

## Auto-updating scores (API-Football)

`/api/sync` pulls World Cup fixtures from API-Football, maps rounds/teams/groups,
and merges them into state — **without ever clobbering manual entries** (a manual
edit for a fixture always wins and survives future syncs). Advancement bonuses
stay a manual confirm step.

To turn it on:
1. Get a free key at https://dashboard.api-football.com (api-sports.io **direct**,
   not RapidAPI).
2. Add `APISPORTS_KEY` to Vercel env vars; redeploy.

How updates are triggered:
- **Open pages** drive the live refresh: while the page is open it nudges
  `/api/sync` ~every 60s, and the server throttles real API calls to ~90s
  (`THROTTLE_MS` in `api/sync.js`). The throttle collapses all viewers into at
  most one API call per window, so quota is bounded by the throttle, not by how
  many people are watching.
- **GitHub Actions** (`.github/workflows/sync.yml`) pings `/api/sync?force=1` as
  a backstop so finals still land when nobody's watching. GitHub cron has a
  5-minute floor and is best-effort, so it's set to `*/5` — it is NOT the live
  path.
- A daily Vercel cron is kept as a further backstop.

Rate limit: with the ~90s throttle, viewer-driven syncs cost ≤ ~960 req/day and
the `*/5` cron adds ~288/day — comfortable on a paid API-Football plan. Back on
the free 100/day tier? Raise `THROTTLE_MS` and the GitHub cron to `*/20`.
Hitting the cap just skips an update; nothing breaks.

Optional hardening: set `SYNC_SECRET` in Vercel **and** as a GitHub repo secret of the
same name — then only forced syncs carrying the secret bypass the throttle, so nobody
can drain your daily quota via the public URL.

Env overrides if the competition id/season differ: `WC_LEAGUE_ID` (default `1`),
`WC_SEASON` (default `2026`).

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
| `scripts/check-teams.mjs` | Team-name health check (sheet ↔ canonical ↔ API) |
| `test/scoring.test.mjs` | Scoring engine tests |
