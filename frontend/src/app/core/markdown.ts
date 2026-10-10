import DOMPurify, { type DOMPurify as Purifier } from 'dompurify';
import { Marked } from 'marked';

/**
 * Model answers as sanitized HTML (ADR 0015). The text is untrusted (the model read third-party news), so:
 * raw HTML in the source is escaped rather than parsed, the result goes through DOMPurify with a small
 * allow-list (no images, no attributes beyond href/align/start), links survive only for http(s) and open in a
 * new tab without a referrer. Angular's own [innerHTML] sanitizer then runs as a second layer; everything
 * allowed here is also allowed there, so it never has to strip (and warn).
 */
const TAGS = [
  'p', 'br', 'strong', 'em', 'del', 'code', 'pre', 'blockquote', 'hr', 'ul', 'ol', 'li', 'a',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
]; // prettier-ignore
const ATTRS = ['href', 'align', 'start'];
const SAFE_SCHEMES = new Set(['http:', 'https:']);

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const marked = new Marked({
  async: false,
  gfm: true,
  breaks: true,
  renderer: {
    html: ({ text }) => escapeHtml(text), // `<script>` in the answer shows as text
    image: ({ text }) => escapeHtml(text), // no remote images (tracking pixels): keep the alt text
  },
});

let purifier: Purifier | null = null;

function purify(): Purifier {
  if (purifier) return purifier;
  const p = DOMPurify(window); // own instance, so the hook below affects nobody else
  p.addHook('afterSanitizeAttributes', (node) => {
    if (node.nodeName !== 'A') return;
    if (!isSafeUrl(node.getAttribute('href'))) {
      node.removeAttribute('href'); // the link text stays, as plain text
      return;
    }
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer nofollow');
  });
  return (purifier = p);
}

/** Absolute http(s) only: relative links would point into the app, other schemes can run code. */
export function isSafeUrl(href: string | null): boolean {
  if (!href) return false;
  try {
    return SAFE_SCHEMES.has(new URL(href).protocol);
  } catch {
    return false;
  }
}

export function renderMarkdown(src: string): string {
  if (!src) return '';
  const html = marked.parse(src) as string;
  return purify().sanitize(html, { ALLOWED_TAGS: TAGS, ALLOWED_ATTR: ATTRS });
}

export interface ChatLine {
  role: 'user' | 'assistant';
  text: string;
}

/** The conversation as markdown source (not HTML), for the clipboard. */
export function conversationMarkdown(
  symbol: string,
  model: string | null | undefined,
  messages: readonly ChatLine[],
): string {
  const ai = model ? `AI (${model})` : 'AI';
  const parts = messages
    .filter((m) => m.text.trim())
    .map((m) => `**${m.role === 'user' ? 'You' : ai}:** ${m.text.trim()}`);
  return [`# Ask AI: ${symbol}`, ...parts].join('\n\n') + '\n';
}
