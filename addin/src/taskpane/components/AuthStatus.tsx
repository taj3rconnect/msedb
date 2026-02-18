import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface AuthStatusProps {
  error: string;
  onRetry: () => void;
}

export default function AuthStatus({ error, onRetry }: AuthStatusProps) {
  return (
    <div className="mt-4 p-4 rounded-lg border bg-amber-50 border-amber-200 text-amber-800">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0" />
        <div className="flex-1">
          <p className="text-sm font-medium">Authentication Error</p>
          <p className="text-sm mt-1">{error}</p>
        </div>
      </div>
      <button
        onClick={onRetry}
        className="mt-3 w-full py-2 px-4 rounded-lg border border-amber-400 text-sm font-medium text-amber-800 hover:bg-amber-100"
      >
        Retry
      </button>
    </div>
  );
}
