import { formatDistanceToNow } from 'date-fns';

/**
 * Format a date as mm-dd-yy--hh:mm AM/PM
 * e.g. 03-07-26--2:34 PM
 */
export function formatDateTime(date: string | Date): string {
  const d = new Date(date);
  if (isNaN(d.getTime())) return '—';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  const rawHour = d.getHours();
  const ampm = rawHour >= 12 ? 'PM' : 'AM';
  const hh = rawHour % 12 || 12;
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${mm}-${dd}-${yy}--${hh}:${min} ${ampm}`;
}

/**
 * Format a date as relative time (e.g., "5 minutes ago").
 */
export function formatRelativeTime(date: string | Date): string {
  return formatDistanceToNow(new Date(date), { addSuffix: true });
}

/**
 * Format a number with locale-specific separators (e.g., 1,234).
 */
export function formatNumber(n: number): string {
  return n.toLocaleString();
}

/**
 * Format an email address, truncating if too long.
 */
export function formatEmail(email?: string): string {
  if (!email) return 'Unknown';
  if (email.length <= 30) return email;
  return `${email.slice(0, 27)}...`;
}

/**
 * Wrap whitespace-separated query words found in `text` with a <mark> tag.
 * Used to highlight search matches in inbox sender/subject/body text.
 */
export function highlightText(text: string, query: string): string {
  if (!query || !text) return text;
  const words = query.split(/\s+/).filter((w) => w.length >= 2);
  if (!words.length) return text;
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(${escaped.join('|')})`, 'gi');
  return text.replace(pattern, '<mark class="bg-yellow-200 dark:bg-yellow-500/30 rounded-sm px-0.5">$1</mark>');
}

