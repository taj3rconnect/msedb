import { describe, it, expect } from 'vitest';
import { matchesConditions } from '../ruleEngine.js';
import type { IRuleConditions } from '../../models/Rule.js';
import type { GraphMessage } from '../metadataExtractor.js';

function makeMessage(overrides: Partial<GraphMessage> = {}): GraphMessage {
  return {
    id: 'msg-1',
    subject: 'Test Subject',
    bodyPreview: 'Hello world',
    from: { emailAddress: { name: 'Alice', address: 'alice@example.com' } },
    parentFolderId: 'folder-inbox',
    receivedDateTime: '2026-01-01T00:00:00Z',
    ...overrides,
  } as GraphMessage;
}

describe('matchesConditions', () => {
  it('returns true when no conditions are set', () => {
    expect(matchesConditions({}, makeMessage())).toBe(true);
  });

  it('matches senderEmail (case-insensitive)', () => {
    const conditions: IRuleConditions = { senderEmail: 'Alice@Example.com' };
    expect(matchesConditions(conditions, makeMessage())).toBe(true);
  });

  it('rejects non-matching senderEmail', () => {
    const conditions: IRuleConditions = { senderEmail: 'bob@other.com' };
    expect(matchesConditions(conditions, makeMessage())).toBe(false);
  });

  it('matches senderEmail array', () => {
    const conditions: IRuleConditions = { senderEmail: ['bob@other.com', 'alice@example.com'] };
    expect(matchesConditions(conditions, makeMessage())).toBe(true);
  });

  it('matches senderDomain', () => {
    const conditions: IRuleConditions = { senderDomain: 'example.com' };
    expect(matchesConditions(conditions, makeMessage())).toBe(true);
  });

  it('rejects non-matching senderDomain', () => {
    const conditions: IRuleConditions = { senderDomain: 'other.com' };
    expect(matchesConditions(conditions, makeMessage())).toBe(false);
  });

  it('matches subjectContains (case-insensitive)', () => {
    const conditions: IRuleConditions = { subjectContains: 'test' };
    expect(matchesConditions(conditions, makeMessage())).toBe(true);
  });

  it('rejects non-matching subjectContains', () => {
    const conditions: IRuleConditions = { subjectContains: 'missing' };
    expect(matchesConditions(conditions, makeMessage())).toBe(false);
  });

  it('matches bodyContains', () => {
    const conditions: IRuleConditions = { bodyContains: 'hello' };
    expect(matchesConditions(conditions, makeMessage())).toBe(true);
  });

  it('matches fromFolder', () => {
    const conditions: IRuleConditions = { fromFolder: 'folder-inbox' };
    expect(matchesConditions(conditions, makeMessage())).toBe(true);
  });

  it('requires ALL conditions to match (AND logic)', () => {
    const conditions: IRuleConditions = {
      senderEmail: 'alice@example.com',
      subjectContains: 'missing',
    };
    expect(matchesConditions(conditions, makeMessage())).toBe(false);
  });

  it('handles message with no sender', () => {
    const conditions: IRuleConditions = { senderEmail: 'alice@example.com' };
    const msg = makeMessage({ from: undefined } as unknown as Partial<GraphMessage>);
    expect(matchesConditions(conditions, msg)).toBe(false);
  });
});
