# Testing Patterns

**Analysis Date:** 2026-02-16

## Test Framework

**Runner:**
- Node.js native test runner or Jest (to be determined during implementation)
- Config file location: `jest.config.js` or `vitest.config.js` in project root
- TypeScript support for both backend and tests

**Assertion Library:**
- Built-in expect from test framework
- Matchers: toBe, toEqual, toThrow, toResolve, toMatch, etc.

**Run Commands:**
```bash
npm test                                 # Run all tests
npm test -- --watch                      # Watch mode for development
npm test -- src/services/mail.test.js    # Single file
npm run test:coverage                    # Coverage report
```

## Test File Organization

**Location:**
- *.test.js alongside source files in the same directory
- No separate test/ directory tree
- Mirrors the structure of src/ exactly

**Naming:**
- unit-name.test.js for all tests (no distinction in filename between unit/integration)
- Follow kebab-case naming from source: `mail-service.js` has `mail-service.test.js`

**Structure:**
```
backend/src/
├── services/
│   ├── graph/
│   │   ├── graph-client.js
│   │   ├── graph-client.test.js
│   │   ├── mail-service.js
│   │   └── mail-service.test.js
│   ├── analyzer/
│   │   ├── pattern-detector.js
│   │   └── pattern-detector.test.js
├── models/
│   ├── User.js
│   └── User.test.js
├── auth/
│   ├── token-manager.js
│   └── token-manager.test.js
```

**Frontend:**
```
frontend/src/
├── components/
│   ├── PatternCard.jsx
│   └── PatternCard.test.jsx
├── hooks/
│   ├── usePatterns.js
│   └── usePatterns.test.js
├── stores/
│   ├── authStore.js
│   └── authStore.test.js
```

## Test Structure

**Suite Organization:**
```javascript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createUser, updateUser } from './user-service';

describe('UserService', () => {
  describe('createUser', () => {
    beforeEach(() => {
      // Setup: mocks, fixtures, etc.
    });

    afterEach(() => {
      // Cleanup: restore mocks, clear state
      vi.restoreAllMocks();
    });

    it('should create a user with valid input', () => {
      // arrange
      const input = { email: 'user@example.com', displayName: 'Test User' };

      // act
      const result = createUser(input);

      // assert
      expect(result).toEqual(expect.objectContaining({ email: input.email }));
    });

    it('should throw on duplicate email', () => {
      expect(() => createUser({ email: 'exists@example.com' })).toThrow('Email already exists');
    });
  });

  describe('updateUser', () => {
    it('should update user preferences', async () => {
      const userId = 'user-123';
      const updates = { preferences: { aggressiveness: 'aggressive' } };

      const result = await updateUser(userId, updates);

      expect(result.preferences.aggressiveness).toBe('aggressive');
    });
  });
});
```

**Patterns:**
- Use `beforeEach` for per-test setup; avoid `beforeAll` (leads to test interdependence)
- Use `afterEach` to restore all mocks: `vi.restoreAllMocks()`
- Add explicit arrange/act/assert comments in complex tests
- One assertion focus per test, but multiple expects OK if testing related conditions
- Describe blocks nest: module → function → behavior

## Mocking

**Framework:**
- Vitest built-in mocking (`vi` module) or Jest mocking
- Module mocking via `vi.mock()` at top of test file
- Function mocking via `vi.fn()`

**Patterns:**
```javascript
import { vi } from 'vitest';
import { fetchMessage } from './mail-service';
import * as graphApi from '../graph/graph-client';

// Mock entire module
vi.mock('../graph/graph-client', () => ({
  getClient: vi.fn(),
  getMessages: vi.fn()
}));

describe('MailService', () => {
  it('should fetch message from Graph API', async () => {
    // Setup mock
    const mockGetMessages = vi.mocked(graphApi.getMessages);
    mockGetMessages.mockResolvedValue([
      { id: 'msg-1', subject: 'Test' }
    ]);

    // Test code
    const messages = await fetchMessage('user-123');

    // Verify mock was called correctly
    expect(mockGetMessages).toHaveBeenCalledWith('user-123');
    expect(messages).toHaveLength(1);
  });

  it('should handle Graph API errors gracefully', async () => {
    const mockGetMessages = vi.mocked(graphApi.getMessages);
    mockGetMessages.mockRejectedValue(new Error('API error'));

    await expect(fetchMessage('user-123')).rejects.toThrow('API error');
  });
});
```

**What to Mock:**
- External APIs (Microsoft Graph API, Azure AD endpoints)
- Database operations (Mongoose models during unit tests)
- File system operations (fs, fs-extra)
- Network calls (axios, fetch)
- Time/dates (vi.useFakeTimers for scheduling tests)
- Child processes (child_process.exec)
- BullMQ jobs and queue operations

**What NOT to Mock:**
- Pure utility functions (string manipulation, formatting)
- Internal business logic (pattern detection, scoring algorithms)
- Mongoose schema methods during integration tests
- React hooks (test through components instead)

**Example: Mocking Database:**
```javascript
vi.mock('../models/User', () => ({
  User: {
    create: vi.fn(),
    findById: vi.fn(),
    updateOne: vi.fn()
  }
}));

it('should handle database errors', async () => {
  vi.mocked(User.findById).mockRejectedValue(new Error('DB error'));

  await expect(getUser('user-123')).rejects.toThrow('DB error');
});
```

## Fixtures and Factories

**Test Data:**
```javascript
// Factory functions in test file
function createTestUser(overrides = {}) {
  return {
    _id: 'user-123',
    email: 'test@example.com',
    displayName: 'Test User',
    role: 'user',
    graphConnected: true,
    ...overrides
  };
}

function createTestEmailEvent(overrides = {}) {
  return {
    _id: 'event-123',
    userId: 'user-123',
    messageId: 'msg-abc',
    eventType: 'deleted',
    timestamp: new Date(),
    sender: { email: 'from@example.com', domain: 'example.com' },
    subject: 'Test email',
    ...overrides
  };
}

describe('PatternDetector', () => {
  it('should detect delete pattern from events', () => {
    const user = createTestUser();
    const events = [
      createTestEmailEvent({ sender: { email: 'newsletter@example.com' } }),
      createTestEmailEvent({ sender: { email: 'newsletter@example.com' } }),
      createTestEmailEvent({ sender: { email: 'newsletter@example.com' } })
    ];

    const pattern = detectPatterns(user, events);
    expect(pattern.suggestedAction).toBe('delete');
  });
});
```

**Location:**
- Factory functions: define in test file near first usage or in a describe block
- Shared fixtures across multiple test files: `tests/fixtures/` directory (or `__fixtures__/`)
- Mock data from external APIs: `tests/fixtures/graph-responses.js`

**Example Shared Fixture:**
```javascript
// tests/fixtures/users.js
export const testUsers = {
  admin: {
    _id: 'admin-1',
    email: 'taj@example.com',
    role: 'admin'
  },
  regularUser: {
    _id: 'user-1',
    email: 'user@example.com',
    role: 'user'
  }
};

// In test file
import { testUsers } from '../../tests/fixtures/users';

describe('AuthService', () => {
  it('should grant admin role to first user', () => {
    const user = testUsers.admin;
    expect(user.role).toBe('admin');
  });
});
```

## Coverage

**Requirements:**
- No enforced coverage target for MVP phase
- Coverage tracked for awareness
- Focus on critical paths: authentication, pattern detection, rule execution, Graph API integration

**Configuration:**
- Built-in coverage tool from test framework
- Exclude: *.test.js, config files, entry point files

**View Coverage:**
```bash
npm run test:coverage
open coverage/index.html
```

## Test Types

**Unit Tests:**
- Test single function in isolation
- Mock all external dependencies (Graph API, database, file system)
- Fast: each test should complete in <100ms
- Examples: `token-manager.test.js`, `metadata-extractor.test.js`, `usePatterns.test.js`

**Integration Tests:**
- Test multiple modules together
- Mock only external boundaries (Microsoft Graph, MongoDB)
- Real internal modules (services calling other services)
- Examples: `pattern-detector.test.js` (tests detector + scoring), `mail-service.test.js` (tests mail service + event collector)

**E2E Tests:**
- Not part of MVP phase
- Will test full user flows (login → connect mailbox → detect patterns → create rule)
- Framework: Playwright or Puppeteer (to be determined)

## Common Patterns

**Async Testing:**
```javascript
it('should fetch messages asynchronously', async () => {
  const messages = await mailService.getMessages('user-123');
  expect(messages).toHaveLength(3);
});

// With vi.waitFor for polling
it('should eventually complete operation', async () => {
  performAsyncOperation();
  await expect(() => vi.waitFor(() => {
    expect(state.isDone).toBe(true);
  })).resolves.not.toThrow();
});
```

**Error Testing:**
```javascript
// Synchronous error
it('should throw on invalid input', () => {
  expect(() => parsePattern(null)).toThrow('Pattern cannot be null');
});

// Async error
it('should reject on API failure', async () => {
  vi.mocked(graphApi.getMessages).mockRejectedValue(new Error('API error'));

  await expect(fetchMessages('user-123')).rejects.toThrow('API error');
});

// Specific error type
it('should throw ValidationError on invalid data', () => {
  expect(() => createRule({})).toThrow(ValidationError);
});
```

**Fake Timers (for scheduling):**
```javascript
it('should execute rule after grace period', async () => {
  vi.useFakeTimers();
  const clock = vi.getRealSystemTime();

  const result = await executeWithGracePeriod(rule, 24 * 60 * 60 * 1000);

  vi.advanceTimersByTime(25 * 60 * 60 * 1000); // 25 hours
  expect(result.executed).toBe(true);

  vi.useRealTimers();
});
```

**Snapshot Testing:**
- Not used in this codebase
- Prefer explicit assertions for clarity and maintainability
- Snapshots can hide bugs; explicit checks are more reliable

**React Component Testing:**
```javascript
import { render, screen } from '@testing-library/react';
import { PatternCard } from './PatternCard';

describe('PatternCard', () => {
  it('should display pattern details', () => {
    const pattern = {
      id: 'pattern-1',
      suggestedAction: 'delete',
      confidence: 95,
      sampleSize: 15
    };

    render(<PatternCard pattern={pattern} onApprove={vi.fn()} />);

    expect(screen.getByText('Delete')).toBeInTheDocument();
    expect(screen.getByText('95%')).toBeInTheDocument();
  });

  it('should call onApprove when user clicks approve', async () => {
    const handleApprove = vi.fn();
    const pattern = { id: 'pattern-1', suggestedAction: 'delete', confidence: 85 };

    render(<PatternCard pattern={pattern} onApprove={handleApprove} />);

    const approveButton = screen.getByRole('button', { name: /approve/i });
    await userEvent.click(approveButton);

    expect(handleApprove).toHaveBeenCalledWith('pattern-1');
  });
});
```

---

*Testing analysis: 2026-02-16*
*Update when test patterns change*
