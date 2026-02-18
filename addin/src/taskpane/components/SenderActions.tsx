import React from 'react';
import { ShieldCheck, Trash2 } from 'lucide-react';
import type { SenderInfo, WhitelistAction, ActionScope } from '../../types/index';

interface SenderActionsProps {
  sender: SenderInfo;
  onAction: (action: WhitelistAction, scope: ActionScope) => void;
  loading: boolean;
  disabled: boolean;
}

export default function SenderActions({ sender, onAction, loading, disabled }: SenderActionsProps) {
  const isDisabled = loading || disabled;

  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold text-gray-700">Sender Actions</h3>
        <p className="text-xs text-gray-500 truncate">{sender.email}</p>
      </div>
      <button
        onClick={() => onAction('whitelist', 'sender')}
        disabled={isDisabled}
        className={`w-full py-2 px-4 rounded-lg border text-sm font-medium flex items-center justify-center gap-2 border-green-500 text-green-700 hover:bg-green-50 ${
          isDisabled ? 'opacity-50 cursor-not-allowed' : ''
        }`}
      >
        <ShieldCheck className="w-4 h-4" />
        Never Delete Sender
      </button>
      <button
        onClick={() => onAction('blacklist', 'sender')}
        disabled={isDisabled}
        className={`w-full py-2 px-4 rounded-lg border text-sm font-medium flex items-center justify-center gap-2 border-red-500 text-red-700 hover:bg-red-50 ${
          isDisabled ? 'opacity-50 cursor-not-allowed' : ''
        }`}
      >
        <Trash2 className="w-4 h-4" />
        Always Delete Sender
      </button>
    </div>
  );
}
