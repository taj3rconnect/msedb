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

  const [workingHoursStart, setWorkingHoursStart] = useState(prefs.workingHoursStart ?? 9);
  const [workingHoursEnd, setWorkingHoursEnd] = useState(prefs.workingHoursEnd ?? 17);
  const [patternSettings, setPatternSettings] = useState<PatternSettings>(saved);

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
