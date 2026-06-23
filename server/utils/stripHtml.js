import { convert } from 'html-to-text';

export function stripHtml(html) {
  if (!html) return '';
  return convert(html, {
    wordwrap: false,
    selectors: [
      { selector: 'a', options: { ignoreHref: true } },
      { selector: 'img', format: 'skip' },
      { selector: 'figure', format: 'skip' },
      { selector: 'script', format: 'skip' },
      { selector: 'style', format: 'skip' },
    ],
  }).trim();
}

export function truncate(text, maxChars = 1500) {
  if (!text || text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '...';
}
