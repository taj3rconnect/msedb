import React, { useEffect } from 'react';
import { CheckCircle, XCircle, X } from 'lucide-react';

interface StatusBannerProps {
  status: { type: 'success' | 'error'; message: string };
  onDismiss: () => void;
}

export default function StatusBanner({ status, onDismiss }: StatusBannerProps) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 5000);
    return () => clearTimeout(timer);
  }, [status, onDismiss]);

  const isSuccess = status.type === 'success';

  return (
    <div
      className={`mt-4 p-3 rounded-lg border flex items-start gap-2 ${
        isSuccess
          ? 'bg-green-50 border-green-200 text-green-800'
          : 'bg-red-50 border-red-200 text-red-800'
      }`}
    >
      {isSuccess ? (
        <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" />
      ) : (
        <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
      )}
      <span className="text-sm flex-1">{status.message}</span>
      <button
        onClick={onDismiss}
        className="shrink-0 hover:opacity-70"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
