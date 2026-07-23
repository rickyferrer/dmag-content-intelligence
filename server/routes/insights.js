import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  listInsightConversations, getInsightConversation, createInsightConversation,
  appendInsightMessage, deleteInsightConversation, getRecentInsightMessages,
} from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'content.db');

const router = Router();
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Separate read-only connection — the real safety guarantee against writes,
// independent of the keyword check below (which just gives a cleaner error).
let readonlyDb;
function getReadonlyDb() {
  if (!readonlyDb) readonlyDb = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  return readonlyDb;
}

const FORBIDDEN = /\b(insert|update|delete|drop|alter|attach|detach|pragma|create|replace|vacuum|reindex)\b/i;

function runQuery(sql) {
  const trimmed = sql.trim().replace(/;+\s*$/, '');
  if (!/^select\b/i.test(trimmed)) throw new Error('Only SELECT queries are allowed.');
  if (FORBIDDEN.test(trimmed)) throw new Error('Query contains a disallowed keyword.');
  if (trimmed.includes(';')) throw new Error('Only a single statement is allowed.');

  const rows = getReadonlyDb().prepare(trimmed).all();
  const capped = rows.slice(0, 200);
  let json = JSON.stringify(capped);
  if (json.length > 12000) {
    json = json.slice(0, 12000) + `... [truncated — ${capped.length} rows total, narrow your query]`;
  }
  return { row_count: rows.length, returned: capped.length, data: json };
}

const SCHEMA_PROMPT = `You are an analyst answering questions about D Magazine's Content Intelligence dashboard, backed by a SQLite database. Use the query_database tool to fetch real data before answering — never guess numbers.

## Schema

**content** — one row per article/post
  wp_id, title, url, content_type (article, micropost, gallery, recipe, ...), author, writer,
  published_at (ISO date), section (e.g. FrontBurner, Food & Drink, Commercial Real Estate),
  categories, tags (JSON strings), user_need, user_need_secondary, user_need_confidence,
  subscription_required, excluded_from_scoring
  - user_need is one of: update_me, educate_me, give_perspective, divert_me, inspire_me, help_me, connect_me, keep_me_engaged
  - URLs for magazine issues look like /publications/{d-magazine|d-home|d-ceo}/{year}/{month}/{slug}/

**analytics_snapshots** — many rows per wp_id over time (a history of snapshots)
  wp_id, snapshot_at, ga4_pageviews, ga4_users, ga4_loyal_users, ga4_inmarket_pageviews,
  ga4_loyal_inmarket_pv, ga4_avg_engagement_time, ga4_sessions, ga4_subscribe_clicks,
  ga4_email_signups, ga4_ad_revenue, mf_unique_users, mf_pageviews, mf_loyal_users,
  mf_scroll_depth, mf_recirculation_rate, mf_newsletter_signups, true_value
  - true_value is the article's "True Value" score, 0-100 — the dashboard's core strategic
    content-value metric. It blends subscribe-click rate, loyal/in-market readership, newsletter
    signup rate, engagement time, and ad revenue per reader, weighted by strategic priority and
    shrunk by a traffic-confidence factor. true_value of 0 usually means excluded_from_scoring
    or not enough traffic yet — filter true_value > 0 for "best content" questions.
  - ALWAYS join to only the latest snapshot per article:
    JOIN (SELECT wp_id, MAX(snapshot_at) latest FROM analytics_snapshots GROUP BY wp_id) lx
      ON a.wp_id = lx.wp_id AND a.snapshot_at = lx.latest

**content_sources** — per-article traffic source breakdown (Google, Facebook, direct, dark social, etc.), from Marfeel. Same latest-snapshot pattern as above (table name in the join changes).

**source_performance** — GA4 channel-level rollup (not per-article): channel, users, sessions, subscribe_clicks, avg_engagement_time, ad_revenue, snapshot_at.

**gsc_queries** — real Google Search Console query data per article (rolling 90-day window): wp_id, snapshot_at, query, clicks, impressions, ctr, position. Same latest-snapshot pattern.

**site_daily_metrics** — site-wide GA4 traffic by calendar date (one row per date, ~400 days of history), independent of any specific article: date, users, loyal_users, pageviews, sessions, subscribe_clicks, ad_revenue, newsletter_signups, avg_engagement_time.
  - Use this table (not analytics_snapshots) for any question about site-wide traffic in a
    specific date range — e.g. "how many users last week," "pageviews in March," "was last
    weekend's traffic normal." analytics_snapshots only has each article's *current* rolling
    trailing-30-day GA4 numbers (refreshed daily, not a specific calendar window), so it can't
    answer a "traffic during date range X" question at all — filtering it by published_at
    answers a different question ("how did articles published in X perform"), not "how much
    traffic did the site get during X."
  - IMPORTANT: 'users' and 'loyal_users' are distinct-count metrics, not additive event counts
    like pageviews/subscribe_clicks/ad_revenue. Summing them across multiple days over-counts
    every repeat visitor once per day they showed up (confirmed: a naive SUM of daily users
    over 30 days once read 645,193 vs. a true 30-day-unique count of 605,897 — and 54,009 vs.
    22,256 for loyal_users specifically, a 2.4x inflation, since "loyal" is by definition a
    repeat-visit audience). If asked for total/unique users over a range, either report each
    day's value individually, use AVG for a rough daily-typical figure, or say plainly that
    this table can't give an exact period-unique count for users — do not SUM the users or
    loyal_users columns across more than one row and present it as a total.

## Rules
- Only SELECT queries. Use LIMIT for exploratory queries.
- Prefer concrete numbers and article titles over vague summaries.
- Keep the final answer concise (a few sentences or a short list) — this is read by a busy editorial team, not a data analyst.
- Do not use markdown tables (the UI can't render them). Use plain prose or a "- " bullet list instead.
- If a question can't be answered from this data, say so plainly.`;

const QUERY_TOOL = {
  name: 'query_database',
  description: 'Run a read-only SQL SELECT query against the SQLite database and get the results as JSON (capped at 200 rows).',
  input_schema: {
    type: 'object',
    properties: {
      sql: { type: 'string', description: 'A single SELECT statement.' },
    },
    required: ['sql'],
  },
};

function makeTitle(question) {
  const trimmed = question.trim();
  return trimmed.length <= 60 ? trimmed : trimmed.slice(0, 57).trimEnd() + '…';
}

// GET /api/insights/conversations
router.get('/conversations', (req, res) => {
  res.json(listInsightConversations());
});

// GET /api/insights/conversations/:id
router.get('/conversations/:id', (req, res) => {
  const conversation = getInsightConversation(req.params.id);
  if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
  res.json(conversation);
});

// DELETE /api/insights/conversations/:id
router.delete('/conversations/:id', (req, res) => {
  deleteInsightConversation(req.params.id);
  res.json({ ok: true });
});

// POST /api/insights/ask
router.post('/ask', async (req, res) => {
  const { question, conversation_id } = req.body || {};
  if (!question || typeof question !== 'string' || !question.trim()) {
    return res.status(400).json({ error: 'question is required' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured' });
  }

  const isNewConversation = !conversation_id;
  const convId = conversation_id || createInsightConversation(makeTitle(question));
  const priorMessages = isNewConversation ? [] : getRecentInsightMessages(convId).map(m => ({ role: m.role, content: m.content }));

  const messages = [...priorMessages, { role: 'user', content: question.trim() }];
  const queriesRun = [];
  const MAX_TURNS = 6;

  try {
    let finalText = null;

    for (let turn = 0; turn < MAX_TURNS && finalText === null; turn++) {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: SCHEMA_PROMPT,
        tools: [QUERY_TOOL],
        messages,
      });

      if (response.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: response.content });

        const toolResults = [];
        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;
          let resultContent;
          try {
            const result = runQuery(block.input.sql);
            queriesRun.push(block.input.sql);
            resultContent = JSON.stringify(result);
          } catch (err) {
            resultContent = JSON.stringify({ error: err.message });
          }
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: resultContent });
        }
        messages.push({ role: 'user', content: toolResults });
      } else {
        finalText = response.content.find(b => b.type === 'text')?.text || '(no answer generated)';
      }
    }

    if (finalText === null) {
      finalText = 'I wasn’t able to finish answering that within the allotted steps — try a narrower question.';
    }

    appendInsightMessage(convId, 'user', question.trim());
    appendInsightMessage(convId, 'assistant', finalText, queriesRun);

    res.json({ conversation_id: convId, answer: finalText, queries_run: queriesRun });
  } catch (err) {
    console.error('[Insights] Error:', err.message);
    // Don't leave an empty, titled-but-message-less conversation in the list
    // if the very first question in it failed.
    if (isNewConversation) { try { deleteInsightConversation(convId); } catch {} }
    res.status(500).json({ error: err.message });
  }
});

export default router;
