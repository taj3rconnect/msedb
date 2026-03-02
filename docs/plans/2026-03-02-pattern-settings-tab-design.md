# Pattern Settings Tab — Design

**Date:** 2026-03-02
**Status:** Approved

## Summary

Replace the Preferences tab with a new **Patterns** tab that:
- Moves Working Hours into the Patterns tab
- Removes the Aggressiveness radio (superseded by direct numeric controls)
- Exposes 6 configurable pattern engine parameters per user
- Wires those parameters end-to-end into the pattern engine (replacing hardcoded constants)

## Parameters Exposed

| Parameter | Default | Range | What it controls |
|---|---|---|---|
| `thresholdDelete` | 98 | 50–100 | Confidence % required to suggest a delete rule |
| `thresholdMove` | 85 | 50–100 | Confidence % required to suggest a move/archive rule |
| `thresholdMarkRead` | 80 | 50–100 | Confidence % required to suggest a mark-read rule |
| `observationWindowDays` | 90 | 7–365 | Days of email history scanned by the engine |
| `rejectionCooldownDays` | 30 | 3–90 | Days before a dismissed pattern re-surfaces |
| `minSenderEvents` | 5 | 2–20 | Min emails from a sender before analysis runs |

## Architecture

### Storage
Add `patternSettings` sub-document to the User model (alongside `preferences`):
```ts
interface IPatternSettings {
  thresholdDelete: number;       // default 98
  thresholdMove: number;         // default 85
  thresholdMarkRead: number;     // default 80
  observationWindowDays: number; // default 90
  rejectionCooldownDays: number; // default 30
  minSenderEvents: number;       // default 5
}
```

### Backend changes
1. **`User.ts`** — add `patternSettings` to schema with defaults
2. **`settings.ts` route** — include `patternSettings` in GET response; add PATCH `/api/settings/pattern-settings` to save
3. **`patternEngine.ts`** — `analyzeMailboxPatterns()` fetches user's `patternSettings` from DB; passes values through to all helper functions instead of using module-level constants

### Frontend changes
1. **`SettingsPage.tsx`** — replace Preferences tab with Patterns tab
2. **`PatternSettingsSection.tsx`** (new) — Working Hours + 6 pattern sliders, explicit Save button
3. **`settings.ts` API client** — add `patternSettings` to `SettingsResponse` type; add `updatePatternSettings` API call
4. **`useSettings.ts`** — add `useUpdatePatternSettings` mutation hook

## Presets

Three preset buttons appear at the top of the tab. Clicking one populates all sliders instantly (does not auto-save — user still clicks Save).

| Preset | Delete% | Move% | MarkRead% | Window | Cooldown | MinEvents |
|---|---|---|---|---|---|---|
| Conservative | 99 | 92 | 88 | 120 days | 60 days | 10 |
| Moderate | 98 | 85 | 80 | 90 days | 30 days | 5 |
| Aggressive | 90 | 75 | 70 | 60 days | 14 days | 3 |

A preset button shows as "active" (highlighted) when all sliders exactly match its values.

## UI Layout (Patterns tab)

```
[ Presets row ]
  [ Conservative ]  [ Moderate ]  [ Aggressive ]

[ Working Hours card ]
  Start slider — End slider

[ Suggestion Thresholds card ]
  Delete rule threshold   ████████░░  98%
  Move rule threshold     ████████░░  85%
  Mark Read threshold     ████████░░  80%

[ Detection Sensitivity card ]
  Observation window      ████░░░░░░  90 days
  Rejection cooldown      ███░░░░░░░  30 days
  Min sender events       ██░░░░░░░░  5 events

[ Save Patterns Settings button ]
```

## Key Decisions
- Sliders for all parameters (consistent with Working Hours sliders already in use)
- Explicit Save button (not auto-save), matching existing pattern in PreferencesSection
- `patternSettings` stored as a separate sub-document from `preferences` to keep the schema clean
- Pattern engine fetches settings at analysis time (not cached), so changes take effect on next run
- `aggressiveness` field removed from the User model preferences (no longer needed)
