# Company Brain — Editorial Performance Brief (pilot)

Status: draft / human review required. Source skill: https://github.com/rickyferrer/dmag-company-brain/blob/main/skills/editorial-performance-brief/SKILL.md

## Usage
Within the existing authenticated **Insights** chat, ask:

> Give me an editorial brief of Food & Drink articles published between 2026-09-01 and 2026-11-15. Rank by subscribe clicks and suggest themes worth following up.

The `editorial_brief` tool returns deterministic, parameterized SQL results from the existing read-only SQLite connection. It is **not** a new API, cross-app token, autonomous publisher, or separate user role. The existing session authentication and owner-specific conversation checks still apply.

Filters: publication date window (defaults to the preceding 90 calendar days), exact section, exact writer, publication slug, user need, and one of five rolling snapshot sort metrics. Up to eight top articles are returned. A full year is the maximum requested publication-date range.

## Important interpretation rules
- Date filters choose which articles **were published** in the window; their reporting metrics come from the **latest rolling ~30-day snapshots**. These are not historical metric totals during the specified publication period.
- `rolling_content_value` is a modeled per-article score (0–100), **not earned ad revenue**.
- `lifetime_content_value` is different from rolling Content Value and is not the sort metric for this tool.
- The newsletter and subscription fields exposed here are **rolling snapshot** values, not lifetime/backfilled totals. For historical signup attribution, use the existing Content views.
- The returned `rolling_article_users` must never be summed into site-wide unique users.
- The tool returns `newestSnapshot` and article snapshot timestamps for freshness checks.
- Recommendations from the LLM are hypotheses, not editorial directives or causal proof.
- No editorial publishing, CRM writes, outbound email, or auth changes are introduced.

## Acceptance checklist
1. Run `npm ci && npm test` with Node 20 and confirm tests pass.
2. Log in as normal user: request a Food & Drink brief and confirm article titles, URLs and rolling fields match Content.
3. Confirm /api/insights/ask returns 401 when signed out (route inherits `requireAuth`).
4. Check the request is not exposed as a public GET endpoint and that the assistant cannot access auth or session tables through its report tool.
5. Submit an ambiguous/invalid date or sort; confirm clean tool error with no SQL execution.
6. Compare a known article's latest snapshot and Content Value against live reporting.
7. Check that a historical publication range is not described as historical performance during those dates.
8. Verify that a missing snapshot is not reported as zero performance.
9. Check no site-wide unique-users aggregate is invented.
10. Confirm no publication or other write operation is triggered.

## Deployment
Open a draft PR. Do not merge until CI and a signed-in source-of-truth spot check pass. This pilot keeps all insights behind the existing login; a separate cross-application API should be designed later with explicit user identity and scoped permissions.