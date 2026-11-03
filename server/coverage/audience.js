// The audience description the coverage-gaps prompt uses to judge who a gap
// serves. The text itself (from the Audience Strategy deck) is internal, so it
// isn't in the repo: an admin saves it in Settings → Audience context and it
// lives in sync_state. Without it the report still runs, just without the
// audience lens.
import { getSyncState, setSyncState } from '../db.js';

const KEY = 'audience_context';
export const AUDIENCE_MAX_CHARS = 12000;

export const PERSONAS = {
  civic_champion: 'Civic Champion',
  food_explorer: 'Food Explorer',
  cultural_insider: 'Cultural Insider',
  business_professional: 'Business Professional',
  broad: 'Broad Dallas audience',
};

export const getAudienceContext = () => getSyncState(KEY) || '';
export const saveAudienceContext = (text) => setSyncState(KEY, text.slice(0, AUDIENCE_MAX_CHARS));

export function audienceSection() {
  const text = getAudienceContext().trim();
  if (!text) {
    return `AUDIENCE: no audience description has been provided. Set personas to ["broad"] and audience_fit to "" on every gap and exclusive.`;
  }
  return `AUDIENCE (D's owned audience and personas, from its internal audience strategy):\n${text}`;
}
