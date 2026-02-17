# Coding Conventions

**Analysis Date:** 2026-02-16

## Naming Patterns

**Files:**
- kebab-case for all files (`event-collector.js`, `token-manager.js`, `pattern-detector.js`)
- *.test.js alongside source files in the same directory
- index.js for barrel exports (e.g., `services/graph/index.js`)
- Component files use PascalCase.jsx for React (e.g., `PatternCard.jsx`, `RuleRow.jsx`)

**Functions:**
- camelCase for all functions (e.g., `processWebhookNotification`, `getMailFolders`, `analyzeUserPatterns`)
- Async functions use no special prefix; async is in the signature (e.g., `async getMessages()`)
- Handlers use `handle` or `process` prefix (e.g., `handleError`, `processMessage`)
- Factory functions use `create` prefix (e.g., `createGraphClient`, `createSubscription`)

**Variables:**
- camelCase for variables and parameters (e.g., `userId`, `messageId`, `eventType`)
- UPPER_SNAKE_CASE for constants (e.g., `GRAPH_API_BASE_URL`, `MAX_RETRIES`, `DEFAULT_TIMEOUT`)
- No underscore prefix for private fields; use class methods for encapsulation

**Types (TypeScript/JSDoc):**
- PascalCase for interfaces and type aliases (e.g., `User`, `EmailEvent`, `Pattern`, `Rule`)
- No I prefix for interfaces (use `User`, not `IUser`)
- Enum values use UPPER_SNAKE_CASE (e.g., `Status.ACTIVE`, `EventType.DELETED`)

**Model/Document Names:**
- PascalCase for MongoDB model names (e.g., `User`, `EmailEvent`, `Pattern`, `Rule`)
- Singular form (use `User` not `Users`)

## Code Style

**Formatting:**
- 2 space indentation throughout
- Line length: 100 characters max (enforced via Prettier)
- Single quotes for strings: `'string'` not `"string"`
- Semicolons required at end of statements
- Trailing commas in multi-line objects/arrays

**Linting:**
- ESLint configuration enforces code quality
- No `console.log` in production code; use Winston logger instead
- No unused variables (ESLint rule: no-unused-vars)
- No var declarations; use const and let
- Run: `npm run lint` for validation

**Backend Tooling:**
- Express.js middleware pipeline pattern
- Mongoose models with timestamps: true on all schemas
- No direct database calls outside of model files

**Frontend Tooling:**
- React 18 with Vite build system
- TailwindCSS for styling
- shadcn/ui components for UI
- Zustand for client state management
- TanStack Query (React Query) for server state management

## Import Organization

**Order:**
1. External packages (express, mongoose, crypto, axios, react, etc.)
2. Internal modules (@services, @auth, @models, @utils)
3. Relative imports (./utils, ../config)
4. Type imports last (import type { User })

**Grouping:**
- Blank line between each group
- Within each group: alphabetical order by import path
- Type imports separated with `import type {}` syntax

**Path Aliases (Backend):**
- No path aliases used in backend; use relative imports
- Example: `const { tokenManager } = require('../auth/token-manager');`

**Path Aliases (Frontend):**
- `@/` maps to `src/`
- `@components/` maps to `src/components/`
- `@hooks/` maps to `src/hooks/`
- `@stores/` maps to `src/stores/`
- `@api/` maps to `src/api/`

**Relative Imports:**
- Use relative imports from sibling or parent directories when appropriate
- Backend example: `require('./utils/logger')` from same directory

## Error Handling

**Patterns:**
- Throw errors for unexpected conditions (invalid input, missing dependencies, invariant violations)
- Catch errors at boundaries (route handlers, job processors, middleware)
- Use try/catch for async functions; avoid .catch() chains
- Log error with context before throwing: `logger.error({ err, userId }, 'Failed to process user')`
- Include cause in error message: `new Error('Failed to fetch messages', { cause: originalError })`

**Custom Errors:**
- Extend Error class for custom error types (e.g., `ValidationError`, `NotFoundError`, `AuthenticationError`)
- Example location: `src/utils/errors.js` (backend) or `src/api/errors.js` (frontend)
- Use in specific contexts: authorization failures, validation failures, third-party API errors

**Async Error Handling:**
- Always use try/catch with async/await
- Example:
  ```javascript
  try {
    const messages = await mailService.getMessages(userId);
  } catch (err) {
    logger.error({ err, userId }, 'Failed to fetch messages');
    throw new Error('Unable to retrieve messages', { cause: err });
  }
  ```

**Expected Failures:**
- Return Result<T, E> type for expected failures (e.g., "user not found")
- Example: `{ success: true, data: user }` or `{ success: false, error: 'User not found' }`

## Logging

**Framework:**
- Winston logger in backend (`src/utils/logger.js`)
- Export logger instance from utils module
- Levels: debug, info, warn, error

**Patterns:**
- Structured logging with context object: `logger.info({ userId, action }, 'User signed in')`
- Log at service boundaries: Graph API calls, database operations, webhook events
- Log state transitions: rule created, automation executed, pattern approved
- Log errors with full context: user ID, message ID, operation being performed
- Never use `console.log` in production code

**Example:**
```javascript
// Good: structured logging with context
logger.info({ userId, patternId, confidence }, 'Pattern detected and suggested');

// Good: error logging
logger.error({ err, userId, messageId }, 'Failed to move message');

// Bad: console.log (not allowed)
console.log('User signed in');
```

**Frontend:**
- Use browser console for debugging during development
- No logging framework required in frontend
- Use error boundaries to catch React errors

## Comments

**When to Comment:**
- Explain why, not what: `// Retry 3 times because Microsoft Graph API has transient failures`
- Document business logic: `// Users must approve patterns before rules execute`
- Explain non-obvious algorithms: comment complex pattern detection or scoring logic
- Avoid obvious comments: don't comment `const count = 0;` or `return result;`

**JSDoc/TSDoc:**
- Required for public API functions: route handlers, service methods, exported utilities
- Optional for internal functions if signature is self-explanatory
- Use @param, @returns, @throws tags
- Example:
  ```javascript
  /**
   * Process a webhook notification from Microsoft Graph
   * @param {object} notification - The notification payload
   * @param {string} notification.subscriptionId - Graph subscription ID
   * @param {string} notification.clientState - User's client state token
   * @returns {Promise<void>}
   * @throws {ValidationError} If notification is invalid or clientState mismatch
   */
  async function processWebhookNotification(notification) { }
  ```

**TODO Comments:**
- Format: `// TODO: description` (no username; use git blame for authorship)
- Link to issue if one exists: `// TODO: Fix race condition in token refresh (issue #123)`
- Clean up before merging to main

## Function Design

**Size:**
- Keep under 50 lines; extract helpers for complex logic
- One level of abstraction per function
- Example: `processWebhookNotification` calls `processMessage` which calls helpers

**Parameters:**
- Max 3 parameters; use options object for 4+
- Destructure in parameter list: `function process({ userId, messageId, action })`
- Example:
  ```javascript
  // Good: destructured options
  async function createRule(userId, { name, conditions, action, safetyConfig }) { }

  // Bad: too many parameters
  async function createRule(userId, name, conditions, action, safetyConfig) { }
  ```

**Return Values:**
- Explicit return statements (no implicit undefined)
- Return early for guard clauses: `if (!user) return null;`
- Use Promise<T> for async functions

## Module Design

**Exports:**
- Named exports preferred for utilities and services: `export { getMessages, moveMessage }`
- Default exports only for React components: `export default PatternCard`
- Barrel files (index.js) re-export public API from module

**Barrel Files:**
- Use `src/services/graph/index.js` to export public API
- Keep internal helpers private (don't re-export in index.js)
- Example:
  ```javascript
  // src/services/graph/index.js
  export { graphClient } from './graph-client';
  export { getMailFolders, getMessages } from './mail-service';
  // Don't export internal helpers
  ```

**Circular Dependencies:**
- Avoid circular imports
- If needed, import from specific files instead of index.js
- Example: `require('./models/User')` instead of `require('./models')`

**Backend Structure:**
- `services/`: business logic, Graph API calls, data processing
- `models/`: Mongoose schemas with methods
- `routes/`: Express route handlers
- `middleware/`: Express middleware functions
- `auth/`: authentication and authorization logic
- `jobs/`: background job processors
- `config/`: configuration loading and setup
- `utils/`: shared utilities and logger

**Frontend Structure:**
- `components/`: React components (UI and feature components)
- `pages/`: page-level components (route targets)
- `hooks/`: custom React hooks
- `stores/`: Zustand state stores
- `api/`: API client and request functions
- `auth/`: authentication context and guards
- `utils/`: utilities and formatters
- `layouts/`: layout components

---

*Convention analysis: 2026-02-16*
*Update when patterns change*
