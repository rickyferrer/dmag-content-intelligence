// Reads the weekly editorial agenda from the Monday.com board the newsroom
// plans on (https://dmagazine-company.monday.com/boards/9655252442).
//
// An "agenda" for a week is every board item whose Publishing Date falls
// between that week's Monday and Sunday. Needs MONDAY_API_TOKEN — a personal
// API token (monday.com → profile picture → Developers → My access tokens)
// from someone who can see the board; read access is enough, nothing is ever
// written back to Monday.
const MONDAY_API = 'https://api.monday.com/v2';
const PAGE_SIZE = 500;

export const BOARD_ID = process.env.MONDAY_BOARD_ID || '9655252442';

// Column IDs on the DMagazine.com board. Overridable by env in case the board
// is rebuilt and the IDs change.
const COLUMNS = {
  date: process.env.MONDAY_DATE_COLUMN || 'date4',            // "Publishing Date"
  status: process.env.MONDAY_STATUS_COLUMN || 'status',       // "Status"
  pub: process.env.MONDAY_PUB_COLUMN || 'dropdown_mm2ycqh3',  // "Pub" (D Online / D CEO / D Home / D Weddings)
  people: process.env.MONDAY_PEOPLE_COLUMN || 'person',       // "Working On"
  liveLink: process.env.MONDAY_LIVELINK_COLUMN || 'text_mm5jspf9', // "Live Link"
};

export function mondayConfigured() {
  return !!process.env.MONDAY_API_TOKEN;
}

async function mondayRequest(query, variables) {
  const res = await fetch(MONDAY_API, {
    method: 'POST',
    headers: { Authorization: process.env.MONDAY_API_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30000),
  });
  if (res.status === 401 || res.status === 403) throw new Error('Monday.com rejected MONDAY_API_TOKEN (check the token and that it can see the board)');
  if (!res.ok) throw new Error(`Monday.com API HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(`Monday.com API error: ${json.errors.map(e => e.message).join('; ')}`);
  return json.data;
}

const ITEM_FIELDS = `
  id name url
  group { title }
  column_values(ids: ${JSON.stringify(Object.values(COLUMNS))}) { id text }
`;

function shapeItem(raw) {
  const col = (id) => raw.column_values.find(c => c.id === id)?.text || '';
  const dateText = col(COLUMNS.date); // "2026-10-26" or "2026-10-28 10:00"
  return {
    id: String(raw.id),
    title: (raw.name || '').trim(),
    url: raw.url || null,
    date: dateText ? dateText.slice(0, 10) : null,
    status: col(COLUMNS.status) || null,
    pub: col(COLUMNS.pub) || null,
    group: raw.group?.title || null,
    people: col(COLUMNS.people) || null,
    liveLink: col(COLUMNS.liveLink) || null,
  };
}

// Every item on the board, paged by cursor. Filtering to the week happens
// locally: the board is a few hundred items, and a local date comparison is
// far less fragile than Monday's server-side date-filter syntax.
async function fetchAllItems() {
  const items = [];
  let data = await mondayRequest(
    `query ($boardId: [ID!]) { boards(ids: $boardId) { items_page(limit: ${PAGE_SIZE}) { cursor items { ${ITEM_FIELDS} } } } }`,
    { boardId: [BOARD_ID] },
  );
  let page = data.boards?.[0]?.items_page;
  if (!data.boards?.length) throw new Error(`Monday.com board ${BOARD_ID} not found or not visible to this token`);
  while (page) {
    items.push(...page.items.map(shapeItem));
    if (!page.cursor) break;
    data = await mondayRequest(
      `query ($cursor: String!) { next_items_page(limit: ${PAGE_SIZE}, cursor: $cursor) { cursor items { ${ITEM_FIELDS} } } }`,
      { cursor: page.cursor },
    );
    page = data.next_items_page;
  }
  return items;
}

export function weekEnd(weekStart) {
  const d = new Date(weekStart + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}

// `weekStart` is that week's Monday as YYYY-MM-DD.
export async function fetchAgenda(weekStart) {
  const end = weekEnd(weekStart);
  const all = await fetchAllItems();
  const items = all
    .filter(i => i.date && i.date >= weekStart && i.date <= end)
    .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  console.log(`[Monday] Agenda ${weekStart} → ${end}: ${items.length} of ${all.length} board items`);
  return { items, boardItemCount: all.length };
}
