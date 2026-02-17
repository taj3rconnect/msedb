import { formatDistanceToNow } from 'date-fns';

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
 * Capitalize and humanize an event type name.
 */
export function formatEventType(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}
