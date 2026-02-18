import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useUpdatePreferences } from '@/hooks/useSettings';
import type { SettingsResponse } from '@/api/settings';

function formatHour(hour: number): string {
  if (hour === 0) return '12 AM';
  if (hour === 12) return '12 PM';
  if (hour < 12) return `${hour} AM`;
  return `${hour - 12} PM`;
}

const AGGRESSIVENESS_OPTIONS = [
  {
    value: 'conservative',
    label: 'Conservative',
    description: 'Higher thresholds, fewer suggestions. Best for new users.',
  },
  {
    value: 'moderate',
    label: 'Moderate',
    description: 'Balanced thresholds. Recommended for most users.',
  },
  {
    value: 'aggressive',
    label: 'Aggressive',
    description: 'Lower thresholds, more suggestions. For power users.',
  },
] as const;

interface PreferencesSectionProps {
  settings: SettingsResponse;
}

/**
 * Preferences tab section for working hours and aggressiveness settings.
 * Uses explicit save button (not auto-save) per Research anti-pattern warning.
 * Does NOT include automationPaused -- controlled by KillSwitch in Topbar.
 */
export function PreferencesSection({ settings }: PreferencesSectionProps) {
  const updatePreferences = useUpdatePreferences();
  const prefs = settings.user.preferences;

  const [workingHoursStart, setWorkingHoursStart] = useState(prefs.workingHoursStart ?? 9);
  const [workingHoursEnd, setWorkingHoursEnd] = useState(prefs.workingHoursEnd ?? 17);
  const [aggressiveness, setAggressiveness] = useState<string>(prefs.aggressiveness ?? 'moderate');

  // Sync local state when settings data changes (e.g., after a save)
  useEffect(() => {
    setWorkingHoursStart(prefs.workingHoursStart ?? 9);
    setWorkingHoursEnd(prefs.workingHoursEnd ?? 17);
    setAggressiveness(prefs.aggressiveness ?? 'moderate');
  }, [prefs.workingHoursStart, prefs.workingHoursEnd, prefs.aggressiveness]);

  const hasChanges =
    workingHoursStart !== (prefs.workingHoursStart ?? 9) ||
    workingHoursEnd !== (prefs.workingHoursEnd ?? 17) ||
    aggressiveness !== (prefs.aggressiveness ?? 'moderate');

  function handleSave() {
    const changed: Record<string, unknown> = {};
    if (workingHoursStart !== (prefs.workingHoursStart ?? 9)) {
      changed.workingHoursStart = workingHoursStart;
    }
    if (workingHoursEnd !== (prefs.workingHoursEnd ?? 17)) {
      changed.workingHoursEnd = workingHoursEnd;
    }
    if (aggressiveness !== (prefs.aggressiveness ?? 'moderate')) {
      changed.aggressiveness = aggressiveness;
    }
    updatePreferences.mutate(changed);
  }

  return (
    <div className="space-y-6">
      {/* Working Hours */}
      <Card>
        <CardHeader>
          <CardTitle>Working Hours</CardTitle>
          <CardDescription>
            Set your active hours. Automation actions will be scheduled within this window.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Start</Label>
              <span className="text-sm font-medium text-muted-foreground">
                {formatHour(workingHoursStart)}
              </span>
            </div>
            <Slider
              value={[workingHoursStart]}
              onValueChange={([value]) => setWorkingHoursStart(value)}
              min={0}
              max={23}
              step={1}
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>End</Label>
              <span className="text-sm font-medium text-muted-foreground">
                {formatHour(workingHoursEnd)}
              </span>
            </div>
            <Slider
              value={[workingHoursEnd]}
              onValueChange={([value]) => setWorkingHoursEnd(value)}
              min={0}
              max={23}
              step={1}
            />
          </div>
        </CardContent>
      </Card>

      {/* Aggressiveness */}
      <Card>
        <CardHeader>
          <CardTitle>Pattern Detection Aggressiveness</CardTitle>
          <CardDescription>
            Controls how readily the system suggests automation rules based on detected patterns.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup value={aggressiveness} onValueChange={setAggressiveness}>
            {AGGRESSIVENESS_OPTIONS.map((option) => (
              <div key={option.value} className="flex items-start space-x-3 py-2">
                <RadioGroupItem value={option.value} id={option.value} className="mt-0.5" />
                <div className="space-y-0.5">
                  <Label htmlFor={option.value} className="cursor-pointer font-medium">
                    {option.label}
                  </Label>
                  <p className="text-sm text-muted-foreground">{option.description}</p>
                </div>
              </div>
            ))}
          </RadioGroup>
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          disabled={!hasChanges || updatePreferences.isPending}
        >
          {updatePreferences.isPending ? 'Saving...' : 'Save Preferences'}
        </Button>
      </div>
    </div>
  );
}
