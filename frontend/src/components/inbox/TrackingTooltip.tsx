import { useState, useEffect } from 'react';
import { Loader2, MapPin, Monitor, Globe } from 'lucide-react';
import { fetchTrackedDetail, type TrackingDetail } from '@/api/tracking';

interface TrackingTooltipProps {
  trackingId: string;
}

export function TrackingTooltip({ trackingId }: TrackingTooltipProps) {
  const [detail, setDetail] = useState<TrackingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchTrackedDetail(trackingId)
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [trackingId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span className="text-xs">Loading...</span>
      </div>
    );
  }

  if (error || !detail) {
    return <div className="p-2 text-xs text-muted-foreground">No tracking data</div>;
  }

  if (detail.openCount === 0) {
    return <div className="p-2 text-xs text-muted-foreground">Not opened yet</div>;
  }

  return (
    <div className="p-2 space-y-2 max-w-[300px]">
      <div className="text-xs font-medium">
        Opened {detail.openCount} {detail.openCount === 1 ? 'time' : 'times'}
      </div>
      <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
        {detail.opens.map((open, i) => (
          <div key={i} className="text-xs border-l-2 border-green-500 pl-2 py-0.5 space-y-0.5">
            <div className="text-muted-foreground">
              {new Date(open.timestamp).toLocaleString()}
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {(open.country || open.city) && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {[open.city, open.country].filter(Boolean).join(', ')}
                </span>
              )}
              {open.device && (
                <span className="flex items-center gap-1">
                  <Monitor className="h-3 w-3" />
                  {open.device}
                </span>
              )}
              {open.browser && (
                <span className="flex items-center gap-1">
                  <Globe className="h-3 w-3" />
                  {open.browser}
                </span>
              )}
            </div>
            {open.os && (
              <div className="text-muted-foreground">{open.os}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
