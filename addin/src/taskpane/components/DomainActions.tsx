import React from 'react';
import { Globe, Trash2 } from 'lucide-react';
import type { WhitelistAction, ActionScope } from '../../types/index';

interface DomainActionsProps {
  domain: string;
  onAction: (action: WhitelistAction, scope: ActionScope) => void;
  loading: boolean;
  disabled: boolean;
}

export default function DomainActions({ domain, onAction, loading, disabled }: DomainActionsProps) {
  const isDisabled = loading || disabled;

  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold text-gray-700">Domain Actions</h3>
        <p className="text-xs text-gray-500">@{domain}</p>
      </div>
      <button
        onClick={() => onAction('whitelist', 'domain')}
        disabled={isDisabled}
        className={`w-full py-2 px-4 rounded-lg border text-sm font-medium flex items-center justify-center gap-2 border-green-500 text-green-700 hover:bg-green-50 ${
          isDisabled ? 'opacity-50 cursor-not-allowed' : ''
        }`}
      >
        <Globe className="w-4 h-4" />
        Never Delete Domain
      </button>
      <button
        onClick={() => onAction('blacklist', 'domain')}
        disabled={isDisabled}
        className={`w-full py-2 px-4 rounded-lg border text-sm font-medium flex items-center justify-center gap-2 border-red-500 text-red-700 hover:bg-red-50 ${
          isDisabled ? 'opacity-50 cursor-not-allowed' : ''
        }`}
      >
        <Trash2 className="w-4 h-4" />
        Always Delete Domain
      </button>
    </div>
  );
}
