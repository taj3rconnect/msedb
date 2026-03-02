# Pattern Settings Tab Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Patterns" tab to Settings that exposes 6 pattern engine parameters as configurable per-user sliders with preset buttons, replacing the Preferences tab, and wire all values end-to-end into the pattern engine.

**Architecture:** Add `patternSettings` sub-document to the User model; expose it via a new PATCH endpoint; update the pattern engine to fetch and use those values instead of hardcoded constants; build a new `PatternSettingsSection` frontend component with presets and sliders, replacing `PreferencesSection`.

**Tech Stack:** TypeScript, Mongoose, Express, React, TanStack Query, shadcn/ui (Slider, Card, Button, Label)

---

## Preset Values Reference

| Preset | thresholdDelete | thresholdMove | thresholdMarkRead | observationWindowDays | rejectionCooldownDays | minSenderEvents |
|---|---|---|---|---|---|---|
| Conservative | 99 | 92 | 88 | 120 | 60 | 10 |
| Moderate | 98 | 85 | 80 | 90 | 30 | 5 |
| Aggressive | 90 | 75 | 70 | 60 | 14 | 3 |

---

### Task 1: Add `patternSettings` to User model

**Files:**
- Modify: `backend/src/models/User.ts`

**Step 1: Add `IPatternSettings` interface and update `IUserPreferences`**

In `backend/src/models/User.ts`, after the existing `IUserPreferences` interface, add:

```ts
export interface IPatternSettings {
  thresholdDelete: number;
  thresholdMove: number;
  thresholdMarkRead: number;
  observationWindowDays: number;
  rejectionCooldownDays: number;
  minSenderEvents: number;
}
```

Add `patternSettings: IPatternSettings;` to the `IUser` interface (after the `preferences` field).

Also remove `aggressiveness` from `IUserPreferences` (it's superseded by direct numeric controls).

**Step 2: Add the schema sub-document**

In `userSchema`, after the `preferences` block, add:

```ts
patternSettings: {
  thresholdDelete: { type: Number, default: 98 },
  thresholdMove: { type: Number, default: 85 },
  thresholdMarkRead: { type: Number, default: 80 },
  observationWindowDays: { type: Number, default: 90 },
  rejectionCooldownDays: { type: Number, default: 30 },
  minSenderEvents: { type: Number, default: 5 },
},
```

Also remove `aggressiveness` from the `preferences` schema block.

**Step 3: Verify TypeScript compiles**

```bash
cd /home/admin/claude/MSEDB/backend && npx tsc --noEmit
```

Expected: no errors (fix any type errors from removing aggressiveness).

**Step 4: Commit**

```bash
git add backend/src/models/User.ts
git commit -m "feat: add patternSettings sub-document to User model"
```

---

### Task 2: Expose and update `patternSettings` via API

**Files:**
- Modify: `backend/src/routes/settings.ts`
- Modify: `backend/src/routes/user.ts`

**Step 1: Include `patternSettings` in GET /api/settings**

In `backend/src/routes/settings.ts`, update the `User.findById` select string to include `patternSettings`:

```ts
User.findById(userId)
  .select('email displayName preferences patternSettings createdAt')
  .lean(),
```

Update the `res.json` response to include:

```ts
res.json({ user, mailboxes: safeMailboxes });
```

The `user` object from `.lean()` will now include `patternSettings` automatically since it's selected.

**Step 2: Add PATCH /api/user/pattern-settings endpoint**

In `backend/src/routes/user.ts`, add a new route after the existing `PATCH /preferences`:

```ts
/**
 * PATCH /api/user/pattern-settings
 *
 * Update pattern engine settings. All fields optional.
 * Validates ranges: thresholds 50-100, window 7-365, cooldown 3-90, minEvents 2-20.
 */
userRouter.patch('/pattern-settings', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const {
    thresholdDelete,
    thresholdMove,
    thresholdMarkRead,
    observationWindowDays,
    rejectionCooldownDays,
    minSenderEvents,
  } = req.body;

  const updateFields: Record<string, unknown> = {};

  function validateThreshold(value: unknown, name: string): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 50 || value > 100) {
      throw new ValidationError(`${name} must be an integer between 50 and 100`);
    }
    return value;
  }

  if (thresholdDelete !== undefined) {
    updateFields['patternSettings.thresholdDelete'] = validateThreshold(thresholdDelete, 'thresholdDelete');
  }
  if (thresholdMove !== undefined) {
    updateFields['patternSettings.thresholdMove'] = validateThreshold(thresholdMove, 'thresholdMove');
  }
  if (thresholdMarkRead !== undefined) {
    updateFields['patternSettings.thresholdMarkRead'] = validateThreshold(thresholdMarkRead, 'thresholdMarkRead');
  }
  if (observationWindowDays !== undefined) {
    if (typeof observationWindowDays !== 'number' || !Number.isInteger(observationWindowDays) || observationWindowDays < 7 || observationWindowDays > 365) {
      throw new ValidationError('observationWindowDays must be an integer between 7 and 365');
    }
    updateFields['patternSettings.observationWindowDays'] = observationWindowDays;
  }
  if (rejectionCooldownDays !== undefined) {
    if (typeof rejectionCooldownDays !== 'number' || !Number.isInteger(rejectionCooldownDays) || rejectionCooldownDays < 3 || rejectionCooldownDays > 90) {
      throw new ValidationError('rejectionCooldownDays must be an integer between 3 and 90');
    }
    updateFields['patternSettings.rejectionCooldownDays'] = rejectionCooldownDays;
  }
  if (minSenderEvents !== undefined) {
    if (typeof minSenderEvents !== 'number' || !Number.isInteger(minSenderEvents) || minSenderEvents < 2 || minSenderEvents > 20) {
      throw new ValidationError('minSenderEvents must be an integer between 2 and 20');
    }
    updateFields['patternSettings.minSenderEvents'] = minSenderEvents;
  }

  if (Object.keys(updateFields).length === 0) {
    throw new ValidationError('No valid pattern setting fields provided');
  }

  const user = await User.findByIdAndUpdate(
    userId,
    { $set: updateFields },
    { new: true },
  );

  if (!user) {
    throw new NotFoundError('User not found');
  }

  res.json({ patternSettings: user.patternSettings });
});
```

**Step 3: Verify TypeScript compiles**

```bash
cd /home/admin/claude/MSEDB/backend && npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add backend/src/routes/settings.ts backend/src/routes/user.ts
git commit -m "feat: expose and update patternSettings via API"
```

---

### Task 3: Wire `rejectionCooldownDays` into pattern rejection route

**Files:**
- Modify: `backend/src/routes/patterns.ts`

**Step 1: Find the hardcoded cooldown (line ~177)**

The line currently reads:
```ts
pattern.rejectionCooldownUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
```

**Step 2: Replace with user's setting**

Add a user lookup before the pattern update, and use the user's `rejectionCooldownDays`:

```ts
// Fetch user's pattern settings for cooldown duration
const user = await User.findById(userId).select('patternSettings').lean();
const cooldownDays = user?.patternSettings?.rejectionCooldownDays ?? 30;

pattern.status = 'rejected';
pattern.rejectedAt = new Date();
pattern.rejectionCooldownUntil = new Date(Date.now() + cooldownDays * 24 * 60 * 60 * 1000);
```

Make sure `User` is imported at the top of `patterns.ts` (check existing imports).

**Step 3: Verify TypeScript compiles**

```bash
cd /home/admin/claude/MSEDB/backend && npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add backend/src/routes/patterns.ts
git commit -m "feat: use user rejectionCooldownDays when setting pattern cooldown"
```

---

### Task 4: Wire pattern engine to use `patternSettings`

**Files:**
- Modify: `backend/src/services/patternEngine.ts`

**Step 1: Add `PatternEngineSettings` interface and import User**

At the top of `patternEngine.ts`, after existing imports add:

```ts
import { User } from '../models/User.js';
```

After the constants block, add:

```ts
export interface PatternEngineSettings {
  thresholdDelete: number;
  thresholdMove: number;
  thresholdMarkRead: number;
  observationWindowDays: number;
  rejectionCooldownDays: number;
  minSenderEvents: number;
}

export const DEFAULT_PATTERN_SETTINGS: PatternEngineSettings = {
  thresholdDelete: 98,
  thresholdMove: 85,
  thresholdMarkRead: 80,
  observationWindowDays: DEFAULT_OBSERVATION_WINDOW,
  rejectionCooldownDays: REJECTION_COOLDOWN_DAYS,
  minSenderEvents: MIN_SENDER_EVENTS,
};
```

**Step 2: Update `detectSenderPatterns` to accept `minSenderEvents`**

Change the function signature from:
```ts
export async function detectSenderPatterns(
  userId: Types.ObjectId,
  mailboxId: Types.ObjectId,
  observationWindowDays: number = DEFAULT_OBSERVATION_WINDOW,
): Promise<SenderAggregationResult[]>
```

To:
```ts
export async function detectSenderPatterns(
  userId: Types.ObjectId,
  mailboxId: Types.ObjectId,
  observationWindowDays: number = DEFAULT_OBSERVATION_WINDOW,
  minSenderEvents: number = MIN_SENDER_EVENTS,
): Promise<SenderAggregationResult[]>
```

In the aggregation pipeline's second `$match` stage, replace `MIN_SENDER_EVENTS` with the parameter:
```ts
{ $match: { totalEvents: { $gte: minSenderEvents } } },
```

**Step 3: Update `shouldSuggestPattern` to accept thresholds**

Change the function signature from:
```ts
export function shouldSuggestPattern(
  confidence: number,
  actionType: string,
  firstSeen: Date,
): boolean
```

To:
```ts
export function shouldSuggestPattern(
  confidence: number,
  actionType: string,
  firstSeen: Date,
  thresholds: Record<string, number> = SUGGESTION_THRESHOLDS,
): boolean
```

Update the threshold lookup inside the function from:
```ts
const threshold = SUGGESTION_THRESHOLDS[actionType];
```

To:
```ts
const threshold = thresholds[actionType];
```

**Step 4: Update `analyzeMailboxPatterns` to fetch and thread settings**

Add settings fetch at the start of `analyzeMailboxPatterns`, and thread through:

```ts
export async function analyzeMailboxPatterns(
  userId: Types.ObjectId,
  mailboxId: Types.ObjectId,
): Promise<{ senderPatterns: number; folderRoutingPatterns: number }> {
  const counters = { senderPatterns: 0, folderRoutingPatterns: 0 };

  // Fetch user's pattern settings (fall back to defaults if not set)
  const user = await User.findById(userId).select('patternSettings').lean();
  const settings: PatternEngineSettings = {
    ...DEFAULT_PATTERN_SETTINGS,
    ...(user?.patternSettings ?? {}),
  };

  // Build thresholds map for shouldSuggestPattern
  const thresholds: Record<string, number> = {
    delete: settings.thresholdDelete,
    move: settings.thresholdMove,
    archive: settings.thresholdMove,  // archive uses same threshold as move
    markRead: settings.thresholdMarkRead,
  };

  // --- Sender-level detection ---
  const senderResults = await detectSenderPatterns(
    userId,
    mailboxId,
    settings.observationWindowDays,
    settings.minSenderEvents,
  );

  // ... (rest of the loop stays the same, but update shouldSuggestPattern calls)
```

In the sender loop, update all `shouldSuggestPattern` calls to pass `thresholds`:
```ts
const suggest = shouldSuggestPattern(confidence, actionType, result.firstSeen, thresholds);
```

In the folder routing section, also update:
```ts
const folderResults = await detectFolderRoutingPatterns(
  userId,
  mailboxId,
  settings.observationWindowDays,
);
// ...
const suggest = shouldSuggestPattern(confidence, 'move', result.firstSeen, thresholds);
```

Also update the confidence >= 50 filter to use a min threshold from settings:
```ts
// Only persist if confidence is meaningful (> 50%)
if (confidence >= 50) {
```
(Leave this at 50 — it's a noise floor, not a suggestion threshold.)

**Step 5: Verify TypeScript compiles**

```bash
cd /home/admin/claude/MSEDB/backend && npx tsc --noEmit
```

**Step 6: Commit**

```bash
git add backend/src/services/patternEngine.ts
git commit -m "feat: wire patternSettings into pattern engine (replaces hardcoded constants)"
```

---

### Task 5: Frontend — update API types and client

**Files:**
- Modify: `frontend/src/api/settings.ts`

**Step 1: Add `PatternSettings` interface**

After the `UserPreferences` interface, add:

```ts
export interface PatternSettings {
  thresholdDelete: number;
  thresholdMove: number;
  thresholdMarkRead: number;
  observationWindowDays: number;
  rejectionCooldownDays: number;
  minSenderEvents: number;
}

export const DEFAULT_PATTERN_SETTINGS: PatternSettings = {
  thresholdDelete: 98,
  thresholdMove: 85,
  thresholdMarkRead: 80,
  observationWindowDays: 90,
  rejectionCooldownDays: 30,
  minSenderEvents: 5,
};
```

**Step 2: Remove `aggressiveness` from `UserPreferences`**

Remove the `aggressiveness` field from the `UserPreferences` interface.

**Step 3: Add `patternSettings` to `SettingsResponse`**

Update `SettingsResponse`:

```ts
export interface SettingsResponse {
  user: {
    email: string;
    displayName?: string;
    preferences: UserPreferences;
    patternSettings: PatternSettings;
    createdAt: string;
  };
  mailboxes: MailboxInfo[];
}
```

**Step 4: Add `updatePatternSettings` API function**

After `updatePreferences`, add:

```ts
/**
 * Update user pattern engine settings (field-level $set).
 */
export async function updatePatternSettings(
  settings: Partial<PatternSettings>,
): Promise<{ patternSettings: PatternSettings }> {
  return apiFetch<{ patternSettings: PatternSettings }>('/user/pattern-settings', {
    method: 'PATCH',
    body: JSON.stringify(settings),
  });
}
```

**Step 5: Verify TypeScript compiles**

```bash
cd /home/admin/claude/MSEDB/frontend && npx tsc --noEmit
```

**Step 6: Commit**

```bash
git add frontend/src/api/settings.ts
git commit -m "feat: add PatternSettings types and updatePatternSettings API client"
```

---

### Task 6: Frontend — add `useUpdatePatternSettings` hook

**Files:**
- Modify: `frontend/src/hooks/useSettings.ts`

**Step 1: Import new types and function**

Update the import at the top:

```ts
import {
  fetchSettings,
  updatePreferences,
  updatePatternSettings,
  exportData,
  deleteData,
  updateMailboxWhitelist,
} from '@/api/settings';
import type { SettingsResponse, UserPreferences, PatternSettings } from '@/api/settings';
```

**Step 2: Add the mutation hook**

After `useUpdatePreferences`, add:

```ts
/**
 * Mutation hook to update pattern engine settings.
 * Shows toast on success and invalidates settings query.
 */
export function useUpdatePatternSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (settings: Partial<PatternSettings>) => updatePatternSettings(settings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success('Pattern settings saved');
    },
    onError: () => {
      toast.error('Failed to save pattern settings');
    },
  });
}
```

**Step 3: Verify TypeScript compiles**

```bash
cd /home/admin/claude/MSEDB/frontend && npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add frontend/src/hooks/useSettings.ts
git commit -m "feat: add useUpdatePatternSettings hook"
```

---

### Task 7: Frontend — create `PatternSettingsSection` component

**Files:**
- Create: `frontend/src/components/settings/PatternSettingsSection.tsx`

**Step 1: Create the file**

```tsx
import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { useUpdatePreferences, useUpdatePatternSettings } from '@/hooks/useSettings';
import { DEFAULT_PATTERN_SETTINGS } from '@/api/settings';
import type { SettingsResponse, PatternSettings } from '@/api/settings';

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

const PRESETS: Record<string, PatternSettings> = {
  conservative: {
    thresholdDelete: 99,
    thresholdMove: 92,
    thresholdMarkRead: 88,
    observationWindowDays: 120,
    rejectionCooldownDays: 60,
    minSenderEvents: 10,
  },
  moderate: {
    thresholdDelete: 98,
    thresholdMove: 85,
    thresholdMarkRead: 80,
    observationWindowDays: 90,
    rejectionCooldownDays: 30,
    minSenderEvents: 5,
  },
  aggressive: {
    thresholdDelete: 90,
    thresholdMove: 75,
    thresholdMarkRead: 70,
    observationWindowDays: 60,
    rejectionCooldownDays: 14,
    minSenderEvents: 3,
  },
};

const PRESET_LABELS: Record<string, string> = {
  conservative: 'Conservative',
  moderate: 'Moderate',
  aggressive: 'Aggressive',
};

function detectActivePreset(settings: PatternSettings): string | null {
  for (const [key, preset] of Object.entries(PRESETS)) {
    if (
      preset.thresholdDelete === settings.thresholdDelete &&
      preset.thresholdMove === settings.thresholdMove &&
      preset.thresholdMarkRead === settings.thresholdMarkRead &&
      preset.observationWindowDays === settings.observationWindowDays &&
      preset.rejectionCooldownDays === settings.rejectionCooldownDays &&
      preset.minSenderEvents === settings.minSenderEvents
    ) {
      return key;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatHour(hour: number): string {
  if (hour === 0) return '12 AM';
  if (hour === 12) return '12 PM';
  if (hour < 12) return `${hour} AM`;
  return `${hour - 12} PM`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface PatternSettingsSectionProps {
  settings: SettingsResponse;
}

export function PatternSettingsSection({ settings }: PatternSettingsSectionProps) {
  const updatePreferences = useUpdatePreferences();
  const updatePatternSettings = useUpdatePatternSettings();

  const prefs = settings.user.preferences;
  const saved = settings.user.patternSettings ?? DEFAULT_PATTERN_SETTINGS;

  // Working hours state
  const [workingHoursStart, setWorkingHoursStart] = useState(prefs.workingHoursStart ?? 9);
  const [workingHoursEnd, setWorkingHoursEnd] = useState(prefs.workingHoursEnd ?? 17);

  // Pattern settings state
  const [patternSettings, setPatternSettings] = useState<PatternSettings>(saved);

  // Sync on settings reload
  useEffect(() => {
    setWorkingHoursStart(prefs.workingHoursStart ?? 9);
    setWorkingHoursEnd(prefs.workingHoursEnd ?? 17);
  }, [prefs.workingHoursStart, prefs.workingHoursEnd]);

  useEffect(() => {
    setPatternSettings(saved);
  }, [
    saved.thresholdDelete,
    saved.thresholdMove,
    saved.thresholdMarkRead,
    saved.observationWindowDays,
    saved.rejectionCooldownDays,
    saved.minSenderEvents,
  ]);

  const activePreset = detectActivePreset(patternSettings);

  const hoursChanged =
    workingHoursStart !== (prefs.workingHoursStart ?? 9) ||
    workingHoursEnd !== (prefs.workingHoursEnd ?? 17);

  const patternChanged =
    patternSettings.thresholdDelete !== saved.thresholdDelete ||
    patternSettings.thresholdMove !== saved.thresholdMove ||
    patternSettings.thresholdMarkRead !== saved.thresholdMarkRead ||
    patternSettings.observationWindowDays !== saved.observationWindowDays ||
    patternSettings.rejectionCooldownDays !== saved.rejectionCooldownDays ||
    patternSettings.minSenderEvents !== saved.minSenderEvents;

  const hasChanges = hoursChanged || patternChanged;
  const isSaving = updatePreferences.isPending || updatePatternSettings.isPending;

  function applyPreset(key: string) {
    setPatternSettings({ ...PRESETS[key] });
  }

  function setProp<K extends keyof PatternSettings>(key: K, value: PatternSettings[K]) {
    setPatternSettings((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    const ops: Promise<unknown>[] = [];

    if (hoursChanged) {
      const changed: Record<string, unknown> = {};
      if (workingHoursStart !== (prefs.workingHoursStart ?? 9)) changed.workingHoursStart = workingHoursStart;
      if (workingHoursEnd !== (prefs.workingHoursEnd ?? 17)) changed.workingHoursEnd = workingHoursEnd;
      ops.push(updatePreferences.mutateAsync(changed));
    }

    if (patternChanged) {
      ops.push(updatePatternSettings.mutateAsync(patternSettings));
    }

    await Promise.all(ops);
  }

  return (
    <div className="space-y-6">
      {/* Presets */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Presets</CardTitle>
          <CardDescription>
            Apply a preset to configure all pattern thresholds at once, then fine-tune below.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            {Object.keys(PRESETS).map((key) => (
              <Button
                key={key}
                variant={activePreset === key ? 'default' : 'outline'}
                onClick={() => applyPreset(key)}
              >
                {PRESET_LABELS[key]}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Working Hours */}
      <Card>
        <CardHeader>
          <CardTitle>Working Hours</CardTitle>
          <CardDescription>
            Automation actions are scheduled within this window.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Start</Label>
              <span className="text-sm font-medium text-muted-foreground">{formatHour(workingHoursStart)}</span>
            </div>
            <Slider
              value={[workingHoursStart]}
              onValueChange={([v]) => setWorkingHoursStart(v)}
              min={0}
              max={23}
              step={1}
            />
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>End</Label>
              <span className="text-sm font-medium text-muted-foreground">{formatHour(workingHoursEnd)}</span>
            </div>
            <Slider
              value={[workingHoursEnd]}
              onValueChange={([v]) => setWorkingHoursEnd(v)}
              min={0}
              max={23}
              step={1}
            />
          </div>
        </CardContent>
      </Card>

      {/* Suggestion Thresholds */}
      <Card>
        <CardHeader>
          <CardTitle>Suggestion Thresholds</CardTitle>
          <CardDescription>
            Minimum confidence % required before a pattern is suggested as a rule. Higher = fewer but more reliable suggestions.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {(
            [
              { label: 'Delete rule', key: 'thresholdDelete' },
              { label: 'Move / Archive rule', key: 'thresholdMove' },
              { label: 'Mark Read rule', key: 'thresholdMarkRead' },
            ] as const
          ).map(({ label, key }) => (
            <div key={key} className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>{label}</Label>
                <span className="text-sm font-medium text-muted-foreground">{patternSettings[key]}%</span>
              </div>
              <Slider
                value={[patternSettings[key]]}
                onValueChange={([v]) => setProp(key, v)}
                min={50}
                max={100}
                step={1}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Detection Sensitivity */}
      <Card>
        <CardHeader>
          <CardTitle>Detection Sensitivity</CardTitle>
          <CardDescription>
            Controls how much history and activity is required before patterns are detected.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Observation window</Label>
              <span className="text-sm font-medium text-muted-foreground">{patternSettings.observationWindowDays} days</span>
            </div>
            <Slider
              value={[patternSettings.observationWindowDays]}
              onValueChange={([v]) => setProp('observationWindowDays', v)}
              min={7}
              max={365}
              step={1}
            />
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Rejection cooldown</Label>
              <span className="text-sm font-medium text-muted-foreground">{patternSettings.rejectionCooldownDays} days</span>
            </div>
            <Slider
              value={[patternSettings.rejectionCooldownDays]}
              onValueChange={([v]) => setProp('rejectionCooldownDays', v)}
              min={3}
              max={90}
              step={1}
            />
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Min sender events</Label>
              <span className="text-sm font-medium text-muted-foreground">{patternSettings.minSenderEvents} events</span>
            </div>
            <Slider
              value={[patternSettings.minSenderEvents]}
              onValueChange={([v]) => setProp('minSenderEvents', v)}
              min={2}
              max={20}
              step={1}
            />
          </div>
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={!hasChanges || isSaving}>
          {isSaving ? 'Saving...' : 'Save Settings'}
        </Button>
      </div>
    </div>
  );
}
```

**Step 2: Verify TypeScript compiles**

```bash
cd /home/admin/claude/MSEDB/frontend && npx tsc --noEmit
```

Fix any import path issues.

**Step 3: Commit**

```bash
git add frontend/src/components/settings/PatternSettingsSection.tsx
git commit -m "feat: add PatternSettingsSection component with presets and sliders"
```

---

### Task 8: Frontend — update SettingsPage

**Files:**
- Modify: `frontend/src/pages/SettingsPage.tsx`

**Step 1: Replace Preferences tab with Patterns tab**

Replace the entire content of `SettingsPage.tsx`:

```tsx
import { Settings } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { EmptyState } from '@/components/shared/EmptyState';
import { PatternSettingsSection } from '@/components/settings/PatternSettingsSection';
import { MailboxSection } from '@/components/settings/MailboxSection';
import { WhitelistSection } from '@/components/settings/WhitelistSection';
import { DataManagement } from '@/components/settings/DataManagement';
import { ContactsSection } from '@/components/settings/ContactsSection';
import { useSettings } from '@/hooks/useSettings';

export function SettingsPage() {
  const { data: settings, isLoading, isError } = useSettings();

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (isError || !settings) {
    return (
      <EmptyState
        icon={Settings}
        title="Failed to load settings"
        description="There was an error loading your settings. Please try again."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Manage your preferences and account</p>
      </div>

      <Tabs defaultValue="patterns">
        <TabsList>
          <TabsTrigger value="patterns">Patterns</TabsTrigger>
          <TabsTrigger value="mailboxes">Mailboxes</TabsTrigger>
          <TabsTrigger value="whitelists">Whitelists</TabsTrigger>
          <TabsTrigger value="contacts">Contacts</TabsTrigger>
          <TabsTrigger value="data">Data</TabsTrigger>
        </TabsList>

        <TabsContent value="patterns">
          <PatternSettingsSection settings={settings} />
        </TabsContent>

        <TabsContent value="mailboxes">
          <MailboxSection settings={settings} />
        </TabsContent>

        <TabsContent value="whitelists">
          <WhitelistSection settings={settings} />
        </TabsContent>

        <TabsContent value="contacts">
          <ContactsSection settings={settings} />
        </TabsContent>

        <TabsContent value="data">
          <DataManagement />
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

**Step 2: Verify TypeScript compiles**

```bash
cd /home/admin/claude/MSEDB/frontend && npx tsc --noEmit
```

**Step 3: Rebuild and test in browser**

```bash
cd /home/admin/claude/MSEDB && docker compose up -d --build
```

Open the Settings page. Verify:
- "Patterns" tab is the first and default tab; "Preferences" tab is gone
- Presets row shows Conservative / Moderate / Moderate (active) / Aggressive buttons
- Clicking a preset changes all sliders instantly
- Changing any slider activates the Save button
- Saving shows a success toast
- Reloading the page shows saved values

**Step 4: Commit**

```bash
git add frontend/src/pages/SettingsPage.tsx
git commit -m "feat: replace Preferences tab with Patterns tab in Settings page"
```

---

### Task 9: Clean up dead code

**Files:**
- Modify: `backend/src/services/patternEngine.ts`
- Modify: `frontend/src/components/settings/PreferencesSection.tsx` (delete)

**Step 1: Remove unused constants from `patternEngine.ts`**

Remove the now-unused module-level constants (they are replaced by `DEFAULT_PATTERN_SETTINGS`):
```ts
// Remove these:
export const SUGGESTION_THRESHOLDS: Record<string, number> = { ... };
export const MIN_OBSERVATION_DAYS = 1;
export const DEFAULT_OBSERVATION_WINDOW = 90;
const RECENCY_WINDOW_DAYS = 7;
const REJECTION_COOLDOWN_DAYS = 30;
const MIN_SENDER_EVENTS = 5;
const MIN_FOLDER_MOVES = 5;
```

Keep `MAX_EVIDENCE_ITEMS = 10` (still used internally).

Note: `DEFAULT_OBSERVATION_WINDOW` and `MIN_SENDER_EVENTS` are still referenced inside `DEFAULT_PATTERN_SETTINGS` — move their values inline instead.

**Step 2: Delete `PreferencesSection.tsx`**

```bash
rm /home/admin/claude/MSEDB/frontend/src/components/settings/PreferencesSection.tsx
```

**Step 3: Verify TypeScript compiles**

```bash
cd /home/admin/claude/MSEDB/backend && npx tsc --noEmit
cd /home/admin/claude/MSEDB/frontend && npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove PreferencesSection and unused patternEngine constants"
```

---

### Task 10: Final smoke test and version bump

**Step 1: Rebuild containers**

```bash
cd /home/admin/claude/MSEDB && docker compose up -d --build
```

**Step 2: End-to-end verification checklist**

- [ ] Settings page opens on "Patterns" tab by default
- [ ] "Moderate" preset button is highlighted on first load (matches defaults)
- [ ] Clicking "Conservative" updates all 6 sliders and de-highlights Moderate
- [ ] Clicking "Aggressive" updates all 6 sliders
- [ ] Manually adjusting any slider de-highlights all presets
- [ ] Save button is disabled until a change is made
- [ ] Saving shows "Pattern settings saved" toast
- [ ] Reload — saved values persist
- [ ] Rejecting a pattern in the UI respects the saved `rejectionCooldownDays`
- [ ] Working hours save correctly (existing behavior preserved)
- [ ] Other tabs (Mailboxes, Whitelists, Contacts, Data) unaffected

**Step 3: Bump version**

Update `version.json` per versioning convention (increment subversion by .01).
