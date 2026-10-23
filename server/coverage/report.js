// Weekly Coverage Gaps report.
//
// Compares three things for a given week and asks Claude to find the gaps:
//   1. the week's agenda from Monday.com (what D plans to publish),
//   2. what D has already published in the last two weeks (content table),
//   3. what competitors published in the last seven days (competitor_articles).
//
// Three kinds of finding come back: stories competitors covered that D hasn't
// (and hasn't scheduled), upcoming events/announcements with nothing scheduled,
// and agenda items no tracked competitor is covering (D's exclusives).
//
// Claude only ever points at headlines by ID. The links and titles shown to
// editors are resolved from the database here, so a finding can never cite a
// URL that wasn't actually collected.
import Anthropic from '@anthropic-ai/sdk';
import { getDb, setSyncState, getSyncState } from '../db.js';
import { syncCompetitors, competitorHealth } from './competitors.js';
import { fetchAgenda, mondayConfigured, weekEnd } from './monday.js';

const MODEL = process.env.COVERAGE_MODEL || 'claude-sonnet-5';
const COMPETITOR_WINDOW_DAYS = 7;
const OWN_PUBLISHED_WINDOW_DAYS = 14;
const MAX_COMPETITOR_ROWS = 900;
const MAX_OWN_ROWS = 300;
const MAX_GAPS = 12;
const MAX_EXCLUSIVES = 8;
const STALE_RUN_MS = 20 * 60 * 1000;

let client;
const getClient = () => (client ||= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }));

// ── Week helpers (Central time — that's when the newsroom's Monday starts) ───

export function centralToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(now); // YYYY-MM-DD
}

export function mondayOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export function currentWeekStart(now = new Date()) {
  return mondayOf(centralToday(now));
}

export function isMonday(dateStr) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && new Date(dateStr + 'T00:00:00Z').getUTCDay() === 1;
}

// ── Prompt ───────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an editorial analyst for D Magazine, the Dallas city magazine. Its brands are D Magazine (print + dmagazine.com, including the FrontBurner blog and food coverage), D CEO (business, real estate, healthcare, finance), D Home, and D Weddings. Its beats are Dallas–Fort Worth civic life and politics, restaurants and food, real estate, business, arts/events/things to do, home, and long-form local features.

You will be given:
- AGENDA: what D plans to publish this week, from the newsroom's Monday.com board. Titles are often terse working slugs ("Oh My Gourd", "Spa Guide"). Status "Published" means it is already live. "PRINT:" items are print-magazine stories being posted online.
- D_PUBLISHED: what D already published in the last two weeks.
- COMPETITORS: headlines competitors published in the last seven days, each with an ID like C123. Titles marked [title from URL] are rewrites of a URL slug, not the real headline.

Find coverage gaps and call submit_coverage_report. Rules:

1. Classify EVERY agenda item (kind + a short theme). Kinds: original_story (a reported or written story, INCLUDING "PRINT:" stories being posted online and personality features), event_coverage (a dated event, opening, or contest D is covering), recirculation (re-promoting an older piece), print_or_admin (ONLY page furniture and logistics: table of contents, cover/issue admin), roundup_or_recurring (briefs, deal tickers, guides, recurring franchises). Group names are hints, not definitions: "Recirculation/Date Book" mixes re-promotions with dated event items and fresh news items, so judge each item by its title.
2. For each agenda item list the competitor IDs (competitor_overlap) that cover the same story, event, or very close topic. Leave it empty if none.
3. gaps — two types:
   - competitor_covered: a story competitors published that D has neither published (D_PUBLISHED) nor scheduled (AGENDA). BEFORE reporting any gap, search D_PUBLISHED and AGENDA for the same story or event; if D already covered or scheduled it, even days ago or from a different angle, it is NOT a gap — omit it entirely. Only when D has something merely adjacent (same broad subject, clearly different story) report the gap and list that item in related_ids.
   - upcoming_unscheduled: an event, opening, hearing, election item, announcement, or deadline that competitors are previewing or announcing for this week or just after, with nothing on the AGENDA. It must concern something that has NOT happened yet as of today's date; if it already happened, it is competitor_covered instead. Only state dates that appear in the provided text; otherwise say the date isn't stated. Never invent dates, venues, or facts.
   Merge closely related stories into ONE gap (for example, several election or ballot-measure pieces) instead of listing each separately.
4. Be selective: at most ${MAX_GAPS} gaps, ranked most important first. Prefer topics several outlets covered, or one outlet's clearly significant, time-sensitive Dallas story squarely in D's beats. SKIP: sports scores and game recaps, routine crime/accident reports, weather, wire or national stories with no Dallas angle, syndicated filler, and pure press-release fluff. Local politics and elections ARE in scope when they are a real local story.
5. urgency: high = time-sensitive (this week) and significant; medium = worthwhile but not time-bound; low = nice to have.
6. suggested_angle: one concrete, specific pitch D could run (not "cover this"). section_hint: where it would live (e.g. FrontBurner, Food & Drink, D CEO – Real Estate, Things to Do).
7. exclusives: agenda items of kind original_story or event_coverage that NO tracked competitor is covering — where D is alone. One short note each (what makes it distinctive and how to promote it). At most ${MAX_EXCLUSIVES}. The competitor list is limited to the outlets provided, so phrase this as "no tracked outlet covered this", never "no one else covered this".
8. Use only IDs that appear in the input. Every gap needs at least one competitor ID in evidence.`;

const TOOL = {
  name: 'submit_coverage_report',
  description: 'Submit the structured coverage-gap analysis for the week.',
  input_schema: {
    type: 'object',
    properties: {
      agenda: {
        type: 'array',
        description: 'One entry per agenda item, using its A-id.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Agenda ID such as A3' },
            kind: { type: 'string', enum: ['original_story', 'event_coverage', 'recirculation', 'print_or_admin', 'roundup_or_recurring'] },
            theme: { type: 'string', description: 'What the item is actually about, in a few words' },
            competitor_overlap: { type: 'array', items: { type: 'string' }, description: 'C-ids covering the same story/topic' },
          },
          required: ['id', 'kind', 'theme', 'competitor_overlap'],
        },
      },
      gaps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            gap_type: { type: 'string', enum: ['competitor_covered', 'upcoming_unscheduled'] },
            topic: { type: 'string', description: 'Short headline-style label for the gap' },
            why_it_matters: { type: 'string', description: 'One or two sentences: why D should care' },
            suggested_angle: { type: 'string' },
            section_hint: { type: 'string' },
            urgency: { type: 'string', enum: ['high', 'medium', 'low'] },
            evidence: { type: 'array', items: { type: 'string' }, description: 'C-ids supporting the gap (1-6)' },
            related_ids: { type: 'array', items: { type: 'string' }, description: 'A- or P-ids of adjacent D coverage, if any' },
          },
          required: ['gap_type', 'topic', 'why_it_matters', 'suggested_angle', 'section_hint', 'urgency', 'evidence', 'related_ids'],
        },
      },
      exclusives: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            agenda_id: { type: 'string' },
            note: { type: 'string' },
          },
          required: ['agenda_id', 'note'],
        },
      },
    },
    required: ['agenda', 'gaps', 'exclusives'],
  },
};

const md = (iso) => (iso || '').slice(5, 10);
const oneLine = (s) => (s || '').replace(/\s+/g, ' ').trim();

function buildUserPrompt({ weekStart, end, agenda, own, competitors }) {
  const wd = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  const agendaLines = agenda.map(a =>
    `${a.ref} | ${wd(a.date)} ${md(a.date)} | ${a.pub || 'no pub set'} | ${a.status || 'no status'} | ${a.group || ''} | ${oneLine(a.title)}`);
  const ownLines = own.map(p => `${p.ref} | ${md(p.published_at)} | ${p.content_type} | ${p.section || ''} | ${oneLine(p.title)}`);
  const compLines = competitors.map(c => {
    const title = c.title_from_url ? `[title from URL] ${oneLine(c.title)}` : oneLine(c.title);
    const snippet = c.summary ? ` — ${oneLine(c.summary).slice(0, 140)}` : '';
    return `${c.ref} | ${md(c.published_at)} | ${c.source} | ${title}${snippet}`;
  });
  return [
    `Week under review: ${weekStart} (Monday) through ${end} (Sunday). Today is ${centralToday()}.`,
    `\nAGENDA (${agenda.length} items)\n${agendaLines.join('\n')}`,
    `\nD_PUBLISHED, last ${OWN_PUBLISHED_WINDOW_DAYS} days (${own.length} items)\n${ownLines.join('\n')}`,
    `\nCOMPETITORS, last ${COMPETITOR_WINDOW_DAYS} days (${competitors.length} headlines)\n${compLines.join('\n')}`,
  ].join('\n');
}

// ── Generation ───────────────────────────────────────────────────────────────

// Tool inputs are usually clean JSON, but a model occasionally sends an array
// field as a JSON-encoded string (or omits it) — coerce rather than crash a
// weekly job over it.
function asArray(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try { const parsed = JSON.parse(v); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
  }
  return [];
}


// ── Deterministic "did D already cover this?" check ─────────────────────────
// Whether a gap is really a gap hinges on the model noticing that D's own
// recent piece is the same story, and it doesn't do that reliably run to run
// (the Perot Museum expansion was flagged one run and not the next, with D's
// article sitting right there in the input). So after the model responds,
// each gap's wording is compared against D's published titles and the agenda
// by shared distinctive words; close matches are attached and flagged so an
// editor sees "D may already have this" instead of trusting the model.
const GENERIC_WORDS = new Set(['dallas', 'texas', 'county', 'north', 'south', 'east', 'west', 'worth', 'fort', 'city', 'about', 'after', 'again', 'their', 'there', 'these', 'those', 'which', 'while', 'where', 'would', 'could', 'should', 'with', 'from', 'that', 'this', 'what', 'will', 'have', 'been', 'into', 'over', 'more', 'than', 'says', 'said', 'news', 'best', 'week', 'weekend', 'first', 'year', 'years', 'new', 'one', 'two']);

function distinctiveTokens(text) {
  return new Set((text || '').toLowerCase().replace(/&#?\w+;/g, ' ').replace(/[^a-z0-9$]+/g, ' ').split(' ')
    .map(t => t.replace(/^\$/, ''))
    .filter(t => t.length >= 4 && !GENERIC_WORDS.has(t)));
}

const MIN_SHARED_WORDS = 3;

// Returns the D items (agenda + recently published) that share at least
// MIN_SHARED_WORDS distinctive words with the gap's topic + evidence headlines.
export function likelyCoveredBy(gapText, candidates) {
  const gapTokens = distinctiveTokens(gapText);
  const hits = [];
  for (const c of candidates) {
    const shared = [...distinctiveTokens(c.title)].filter(t => gapTokens.has(t));
    if (shared.length >= MIN_SHARED_WORDS) hits.push({ ...c, shared: shared.length });
  }
  return hits.sort((a, b) => b.shared - a.shared).slice(0, 2);
}

const URGENCY_RANK = { high: 0, medium: 1, low: 2 };
const sentenceCase = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export async function generateCoverageReport({ weekStart, agendaItems, boardItemCount = null }) {
  const db = getDb();
  const end = weekEnd(weekStart);
  if (agendaItems.length === 0) {
    throw new Error(`No Monday.com items have a Publishing Date between ${weekStart} and ${end}`);
  }

  const compSince = new Date(Date.now() - COMPETITOR_WINDOW_DAYS * 86400000).toISOString();
  const competitors = db.prepare(`
    SELECT id, source, url, title, title_from_url, summary, section, published_at
    FROM competitor_articles WHERE published_at >= ? ORDER BY published_at DESC LIMIT ?
  `).all(compSince, MAX_COMPETITOR_ROWS).map(c => ({ ...c, ref: `C${c.id}` }));
  if (competitors.length === 0) throw new Error('No competitor headlines have been collected yet — run the competitor sync first');

  const ownSince = new Date(Date.now() - OWN_PUBLISHED_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
  const own = db.prepare(`
    SELECT title, url, content_type, section, published_at FROM content
    WHERE published_at >= ? AND title != '' AND content_type != 'tribe_events'
    ORDER BY published_at DESC LIMIT ?
  `).all(ownSince, MAX_OWN_ROWS).map((p, i) => ({ ...p, ref: `P${i + 1}` }));

  const agenda = agendaItems.map((a, i) => ({ ...a, ref: `A${i + 1}` }));

  const prompt = buildUserPrompt({ weekStart, end, agenda, own, competitors });
  const callModel = async () => {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 9000,
      system: SYSTEM_PROMPT,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: TOOL.name },
      messages: [{ role: 'user', content: prompt }],
    });
    if (response.stop_reason === 'max_tokens') throw new Error('The model ran out of room before finishing the report');
    const block = response.content.find(b => b.type === 'tool_use');
    if (!block) throw new Error('The model did not return a structured report');
    const input = block.input || {};
    return {
      usage: response.usage,
      out: { agenda: asArray(input.agenda), gaps: asArray(input.gaps), exclusives: asArray(input.exclusives) },
    };
  };

  // One retry if the analysis comes back unusable (nothing classified at all).
  let { out, usage } = await callModel();
  if (out.agenda.length === 0) {
    console.warn('[Coverage] Model returned no usable agenda classification — retrying once');
    ({ out, usage } = await callModel());
    if (out.agenda.length === 0) throw new Error('The model returned no usable analysis (retried once)');
  }
  const response = { usage };

  // Resolve IDs back to real records; anything Claude cites that wasn't in the
  // input is silently dropped.
  const compByRef = new Map(competitors.map(c => [c.ref, c]));
  const agendaByRef = new Map(agenda.map(a => [a.ref, a]));
  const ownByRef = new Map(own.map(p => [p.ref, p]));
  const norm = (id) => String(id || '').trim().toUpperCase();
  const evidence = (ids, cap = 6) => [...new Set(asArray(ids).map(norm))].map(id => compByRef.get(id)).filter(Boolean).slice(0, cap)
    .map(c => ({ source: c.source, title: c.title_from_url ? sentenceCase(c.title) : c.title, url: c.url, date: c.published_at, titleFromUrl: !!c.title_from_url }));

  const classified = new Map(out.agenda.map(a => [norm(a?.id), a]));
  const agendaOut = agenda.map(a => {
    const c = classified.get(a.ref);
    return {
      title: a.title, date: a.date, pub: a.pub, status: a.status, group: a.group, people: a.people, url: a.url,
      kind: c?.kind || 'unclassified', theme: c?.theme || '',
      overlap: evidence(c?.competitor_overlap, 4),
    };
  });

  const related = (ids) => asArray(ids).map(norm).map(id => {
    if (agendaByRef.has(id)) { const a = agendaByRef.get(id); return { kind: 'agenda', title: a.title, date: a.date, url: a.url }; }
    if (ownByRef.has(id)) { const p = ownByRef.get(id); return { kind: 'published', title: p.title, date: p.published_at?.slice(0, 10), url: p.url }; }
    return null;
  }).filter(Boolean);

  const gaps = out.gaps
    .filter(g => g && typeof g === 'object')
    .map(g => ({
      gapType: g.gap_type, topic: g.topic, whyItMatters: g.why_it_matters, suggestedAngle: g.suggested_angle,
      sectionHint: g.section_hint, urgency: g.urgency, evidence: evidence(g.evidence), related: related(g.related_ids),
    }))
    .filter(g => g.evidence.length > 0 && g.topic)
    .map(g => {
      const text = [g.topic, ...g.evidence.map(e => e.title)].join(' ');
      const candidates = [
        ...agenda.map(a => ({ kind: 'agenda', title: a.title, date: a.date, url: a.url })),
        ...own.map(p => ({ kind: 'published', title: p.title, date: p.published_at?.slice(0, 10), url: p.url })),
      ];
      const known = new Set(g.related.map(r => r.title));
      const likely = likelyCoveredBy(text, candidates).filter(c => !known.has(c.title))
        .map(({ shared, ...c }) => ({ ...c, likelyDuplicate: true }));
      const flagged = g.related.map(r => ({ ...r, likelyDuplicate: likelyCoveredBy(text, [r]).length > 0 }));
      return { ...g, related: [...likely, ...flagged] };
    })
    .sort((a, b) => (URGENCY_RANK[a.urgency] ?? 3) - (URGENCY_RANK[b.urgency] ?? 3) || b.evidence.length - a.evidence.length)
    .slice(0, MAX_GAPS);

  const exclusives = out.exclusives
    .map(x => ({ agenda: agendaByRef.get(norm(x?.agenda_id)), note: x?.note }))
    .filter(x => x.agenda)
    .slice(0, MAX_EXCLUSIVES)
    .map(x => ({ title: x.agenda.title, date: x.agenda.date, pub: x.agenda.pub, status: x.agenda.status, url: x.agenda.url, note: x.note }));

  const report = {
    weekStart, weekEnd: end,
    generatedAt: new Date().toISOString(),
    model: MODEL,
    stats: {
      agendaItems: agenda.length, boardItems: boardItemCount,
      competitorHeadlines: competitors.length, ownPublished: own.length,
      gaps: gaps.length, exclusives: exclusives.length,
      inputTokens: response.usage?.input_tokens ?? null, outputTokens: response.usage?.output_tokens ?? null,
    },
    sources: competitorHealth(compSince),
    gaps, exclusives, agenda: agendaOut,
  };

  db.prepare('INSERT OR REPLACE INTO coverage_reports (week_start, generated_at, model, report_json) VALUES (?, ?, ?, ?)')
    .run(weekStart, report.generatedAt, MODEL, JSON.stringify(report));
  return report;
}

// ── Orchestration + run status ───────────────────────────────────────────────

let running = false;

export function getRunStatus() {
  let status = null;
  try { status = JSON.parse(getSyncState('coverage_run_status') || 'null'); } catch { /* ignore */ }
  // A run killed mid-flight (deploy, crash) never writes its final status —
  // don't let it read as "running" forever.
  if (status?.state === 'running' && (!running || Date.now() - Date.parse(status.startedAt) > STALE_RUN_MS)) {
    return { ...status, state: 'error', error: 'The last run was interrupted (likely a restart) — run it again' };
  }
  return status;
}

export function isRunning() {
  return running;
}

export async function runCoverageReport({ weekStart = currentWeekStart() } = {}) {
  if (running) throw new Error('A coverage report is already being generated');
  if (!mondayConfigured()) throw new Error('MONDAY_API_TOKEN is not set');
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  running = true;
  const startedAt = new Date().toISOString();
  setSyncState('coverage_run_status', JSON.stringify({ state: 'running', weekStart, startedAt }));
  try {
    // Refresh competitor headlines first so the report never reads stale data;
    // a failure here still leaves whatever was collected earlier.
    try { await syncCompetitors(); } catch (err) { console.warn('[Coverage] Competitor refresh failed:', err.message); }
    const { items, boardItemCount } = await fetchAgenda(weekStart);
    const report = await generateCoverageReport({ weekStart, agendaItems: items, boardItemCount });
    setSyncState('coverage_run_status', JSON.stringify({ state: 'done', weekStart, startedAt, finishedAt: new Date().toISOString() }));
    console.log(`[Coverage] Report for ${weekStart}: ${report.stats.gaps} gaps, ${report.stats.exclusives} exclusives (${report.stats.inputTokens} in / ${report.stats.outputTokens} out tokens)`);
    return report;
  } catch (err) {
    setSyncState('coverage_run_status', JSON.stringify({ state: 'error', weekStart, startedAt, finishedAt: new Date().toISOString(), error: err.message }));
    console.error('[Coverage] Report failed:', err.message);
    throw err;
  } finally {
    running = false;
  }
}
