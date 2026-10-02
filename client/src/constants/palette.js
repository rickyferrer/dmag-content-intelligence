// Categorical chart palette — sampled from Mixpanel's bar-chart colors (the
// reference screenshot the team picked). Single source of truth for every
// "which category is this" color in the app: user needs (NeedBadge.jsx),
// publications (Publications/PublicationDetail.jsx) and traffic channels
// (server/utils/channels.js mirrors these hexes, since the server sends
// them down with /api/analytics/channels).
//
// These are FILL colors — vivid, and several (aqua, amber, peach, pink) are
// pastel enough that they're nearly unreadable as text on a white
// background. Mixpanel only ever uses them as bar/dot fills next to
// neutral dark labels. So anywhere a category color is used as TEXT (badge
// labels, tooltip headings, links), pass it through readableInk() first.
// Status colors (met/missed, +/- change, risk severity) are deliberately
// NOT part of this palette — they carry meaning and stay as they were.
export const PALETTE = {
  violet:  '#7856ff',
  coral:   '#ff7558',
  aqua:    '#7fe2d8',
  amber:   '#f9bd3c',
  rose:    '#b3596d',
  sky:     '#72bef4',
  peach:   '#ffb27a',
  teal:    '#0f7ea0',
  green:   '#3ca975',
  pink:    '#febbb3',
  orchid:  '#cb80dc',
  sea:     '#5cb7af',
};

function toRgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
}
function toHex(rgb) {
  return '#' + rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
}
// WCAG relative luminance.
function luminance(rgb) {
  const [r, g, b] = rgb.map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrastOnWhite(rgb) {
  return 1.05 / (luminance(rgb) + 0.05);
}

// Darkens a fill color toward black, in small steps, until it reaches
// WCAG AA contrast (4.5:1) against white — the same hue, just deep enough
// to read as text. A color that already passes is returned unchanged.
const inkCache = new Map();
export function readableInk(hex) {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
  if (inkCache.has(hex)) return inkCache.get(hex);
  const base = toRgb(hex);
  let out = hex;
  for (let t = 0; t <= 1; t += 0.02) {
    const mixed = base.map(v => v * (1 - t));
    if (contrastOnWhite(mixed) >= 4.5) { out = t === 0 ? hex : toHex(mixed); break; }
  }
  inkCache.set(hex, out);
  return out;
}
