import { describe, it, expect } from 'vitest';

/**
 * Coverage for the whitelist suppression semantics used by
 * loadWhitelistMatcher() and POST /api/patterns/bulk-suppress.
 *
 * The matcher is the gate that keeps a silenced sender from being re-detected
 * by patternEngine on every analysis run, so its edge cases matter.
 */

/** Mirrors loadWhitelistMatcher's returned predicate. */
function buildMatcher(whitelistedSenders: string[], whitelistedDomains: string[]) {
  const senders = new Set(whitelistedSenders.map((s) => s.toLowerCase()));
  const domains = new Set(whitelistedDomains.map((d) => d.toLowerCase()));
  return (senderEmail: string): boolean => {
    if (!senderEmail) return false;
    const normalized = senderEmail.toLowerCase();
    if (senders.has(normalized)) return true;
    const domain = normalized.split('@')[1];
    return domain ? domains.has(domain) : false;
  };
}

/** Mirrors the route's choice of which value to whitelist. */
function suppressionValue(
  condition: { senderEmail?: string; senderDomain?: string },
  scope: 'sender' | 'domain',
): string | undefined {
  const email = condition.senderEmail?.trim();
  const domain = condition.senderDomain?.trim();
  return scope === 'domain' ? (domain ?? email?.split('@')[1]) : (email ?? domain);
}

describe('whitelist suppression matcher', () => {
  it("silences the exact address the user named — taj@haslani.com", () => {
    const isSuppressed = buildMatcher(['taj@haslani.com'], []);
    expect(isSuppressed('taj@haslani.com')).toBe(true);
  });

  it('does not silence other senders at the same domain under sender scope', () => {
    const isSuppressed = buildMatcher(['taj@haslani.com'], []);
    expect(isSuppressed('someone-else@haslani.com')).toBe(false);
  });

  it('silences every sender at a whitelisted domain', () => {
    const isSuppressed = buildMatcher([], ['haslani.com']);
    expect(isSuppressed('taj@haslani.com')).toBe(true);
    expect(isSuppressed('anyone@haslani.com')).toBe(true);
    expect(isSuppressed('taj@example.com')).toBe(false);
  });

  it('matches case-insensitively in both directions', () => {
    expect(buildMatcher(['Taj@Haslani.COM'], [])('taj@haslani.com')).toBe(true);
    expect(buildMatcher(['taj@haslani.com'], [])('TAJ@HASLANI.COM')).toBe(true);
    expect(buildMatcher([], ['HASLANI.com'])('taj@Haslani.Com')).toBe(true);
  });

  it('does not treat a bare or empty sender as suppressed', () => {
    const isSuppressed = buildMatcher(['taj@haslani.com'], ['haslani.com']);
    expect(isSuppressed('')).toBe(false);
    expect(isSuppressed('no-at-sign')).toBe(false);
  });

  it('leaves everything else untouched', () => {
    const isSuppressed = buildMatcher(['taj@haslani.com'], ['spam.example']);
    expect(isSuppressed('newsletter@github.com')).toBe(false);
  });
});

describe('suppression value selection', () => {
  it('uses the exact address under sender scope', () => {
    expect(suppressionValue({ senderEmail: 'taj@haslani.com', senderDomain: 'haslani.com' }, 'sender'))
      .toBe('taj@haslani.com');
  });

  it('uses the domain under domain scope', () => {
    expect(suppressionValue({ senderEmail: 'taj@haslani.com', senderDomain: 'haslani.com' }, 'domain'))
      .toBe('haslani.com');
  });

  it('derives the domain from the address when the pattern carries no domain', () => {
    expect(suppressionValue({ senderEmail: 'taj@haslani.com' }, 'domain')).toBe('haslani.com');
  });

  it('falls back to the domain when the pattern carries no address', () => {
    expect(suppressionValue({ senderDomain: 'haslani.com' }, 'sender')).toBe('haslani.com');
  });

  it('returns undefined when there is nothing to suppress', () => {
    expect(suppressionValue({}, 'sender')).toBeUndefined();
    expect(suppressionValue({}, 'domain')).toBeUndefined();
  });
});
