# D Magazine Content Intelligence Dashboard

A full-stack analytics dashboard that ingests editorial content from WordPress, enriches it with GA4 and Marfeel data, classifies each piece using Dmitry Shishkin's User Needs Model 2.0, and computes a **True Content Value** score — helping editors understand the actual value of content beyond raw pageviews.

---

## Prerequisites

- Node.js 18+
- npm 9+
- A GA4 service account JSON file with Viewer access to property `320675632`
- Marfeel API credentials (email + password)
- Anthropic API key

---

## Setup

### 1. Install dependencies

```bash
npm install
cd client && npm install && cd ..
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in:

| Variable | Description |
|---|---|
| `MARFEEL_PASSWORD` | Your Marfeel account password |
| `ANTHROPIC_API_KEY` | Anthropic API key from console.anthropic.com |
| `DASHBOARD_USER` | Basic auth username for the dashboard |
| `DASHBOARD_PASS` | Basic auth password for the dashboard |

### 3. Add the GA4 service account

Place your GA4 service account JSON file at:

```
credentials/ga4-service-account.json
```

The service account must have the **Viewer** role on GA4 property `320675632`. To create one:
1. Go to Google Cloud Console → IAM & Admin → Service Accounts
2. Create a service account, download the JSON key
3. In GA4 Admin → Property → Property Access Management, add the service account email with Viewer role

### 4. Start in development mode

```bash
npm run dev
```

This starts the Express server on `http://localhost:3001` and the Vite dev server on `http://localhost:5173`. Both run concurrently.

---

## How the True Value Formula Works

```
True Value = Ad Revenue
           + (Subscribe Clicks × W_subscription)
           + (Email Signups × W_signup)
           + (Loyal In-Market Pageviews × W_loyal_inmarket_pv)
           + (Avg Engagement Time × Sessions × W_engagement)
```

**Default weights:**

| Signal | Weight | Rationale |
|---|---|---|
| Ad Revenue | ×1 | Direct dollar value from GAM |
| Subscribe Click | $50 | Estimated LTV of a subscription conversion |
| Email Signup | $5 | Estimated value of email list member |
| Loyal In-Market PV | $0.10 | DFW reader engaged repeatedly → high-value audience signal |
| Engagement × Sessions | $0.001 | Time-spent as a proxy for content depth value |

Weights are adjustable in the Settings panel without redeployment — changes are stored in SQLite and applied to all future snapshots. Use "Recalculate All Scores" to backfill historical snapshots with new weights.

---

## Cron Schedule

| Job | Schedule | What it does |
|---|---|---|
| Content sync | Every hour at :05 | Fetches new/updated WP posts |
| Analytics sync | Every hour at :20 | Snapshots GA4 + Marfeel metrics |
| Classification | Every hour at :40 | Sends unclassified articles to Claude |

First-run classification of 90 days of content may take time (batches of 5 with 1s delays to respect API rate limits). Watch server logs for progress.

---

## Deploying to Render

### Build command
```
npm install && cd client && npm install && npm run build
```

### Start command
```
node server/index.js
```

### Environment variables
Set all variables from `.env.example` in the Render dashboard under Environment. Upload the GA4 service account JSON content as a secret file, or set `GA4_KEY_FILE` to point to where Render stores it.

Set `NODE_ENV=production` so the Express server serves the built React app.

---

## Adding the `email_signup` GA4 Event

Once the `email_signup` event is instrumented on dmagazine.com:

1. No code changes needed — the GA4 sync (`server/sync/ga4.js`) already queries for `email_signup` events and stores them in `ga4_email_signups`
2. The True Value formula already includes `email_signups × W_signup` in the computation
3. Set `TV_WEIGHT_SIGNUP` in `.env` (default: `5`) to tune the contribution

---

## Project Structure

```
/
├── server/
│   ├── index.js          Express entry point + auth
│   ├── db.js             SQLite schema + helpers
│   ├── sync/
│   │   ├── wordpress.js  WP REST API fetcher
│   │   ├── ga4.js        Google Analytics Data API client
│   │   ├── marfeel.js    Marfeel API client (rate-limited queue)
│   │   └── scheduler.js  Cron jobs + manual triggers
│   ├── classify/
│   │   └── userNeeds.js  Anthropic classification (User Needs Model 2.0)
│   ├── routes/           Express route handlers
│   └── utils/            True Value computation + HTML stripping
├── client/
│   └── src/
│       ├── App.jsx        Navigation shell
│       ├── views/         Overview, ContentTable, Detail, UserNeeds, Settings
│       ├── components/    NeedBadge, KPICard, TrueValueBar, ScatterPlot
│       └── api/           Fetch wrappers for all backend endpoints
├── credentials/           GA4 service account JSON (gitignored)
└── .env                   Secrets (gitignored)
```

---

## Notes

- **Marfeel rate limit:** 1 request/minute. The client spaces calls with a 65-second delay and never parallelizes requests.
- **In-market geo filtering** in GA4 is approximate (city-level matching) — this limitation is noted in the UI tooltip on the Loyal In-Market metric.
- **Loyal users** in GA4 are approximated as returning users (exact 3+ session segmentation requires the Audiences API which requires additional property configuration).
- All secrets stay in `.env` / Render env vars — never hardcoded.
