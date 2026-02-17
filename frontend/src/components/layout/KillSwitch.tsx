import { Switch } from '@/components/ui/switch';
import { useAuthStore } from '@/stores/authStore';
import { useKillSwitch } from '@/hooks/useKillSwitch';

/**
 * Kill switch toggle for automation pause/resume.
 *
 * Visible on every page via the Topbar (per SAFE-02 requirements).
 * Green indicator = automation active, red = paused.
 */
export function KillSwitch() {
  const user = useAuthStore((s) => s.user);
  const mutation = useKillSwitch();
  const isPaused = user?.preferences?.automationPaused ?? false;

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1.5">
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            isPaused ? 'bg-red-500' : 'bg-green-500'
          }`}
        />
        <span className="text-sm font-medium">Automation</span>
      </div>
      <Switch
        size="sm"
        checked={!isPaused}
        disabled={mutation.isPending}
        onCheckedChange={(checked) => {
          mutation.mutate(!checked);
        }}
      />
    </div>
  );
}
