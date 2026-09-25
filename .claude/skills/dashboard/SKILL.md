---
name: dashboard
description: Pull report data from the deployed D Magazine Content Intelligence dashboard (production numbers, not the stale local content.db). Use when asked to run a report, check current performance, or answer questions about content/sections/writers/sources/videos from live data.
---

Production data lives on Render; the local `content.db` is a stale dev copy. To read the live numbers, call the deployed API with the read-only client:

```bash
node --env-file=.env scripts/dash.mjs "/api/analytics/by-section"
```

It signs in with `DASH_URL` / `DASH_USER` / `DASH_PASS` from `.env` (a dedicated non-admin account) and does GET requests only. If those aren't set, tell the user rather than guessing credentials.

Find endpoints and their query params from the code instead of a list that goes stale:

- `grep -n "router.get" server/routes/*.js` for routes (mounted under `/api/analytics`, `/api/content`, `/api/insights`, `/api/goals`; see `server/index.js`)
- read the handler for the query params it accepts (period/date range, filters, sort)

Report conventions: scores are 0-100 Content Value (`true_value` is rolling ~30 days, `lifetime_value` is per-article only); every GA4 metric is a trailing-30-day figure per snapshot. Say which period/filters a number came from, and pull the data before summarizing rather than answering from memory.
