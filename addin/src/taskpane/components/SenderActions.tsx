import React from 'react';
import { Ban, MailOpen, ShieldCheck } from 'lucide-react';
import type { SenderInfo } from '../../types/index';

interface SenderActionsProps {
  sender: SenderInfo;
  onAlwaysDelete: (email: string) => void;
  onAlwaysMarkRead: (email: string) => void;
  onWhitelist: (email: string) => void;
  loading: boolean;
  disabled: boolean;
}

export default function SenderActions({
  sender,
  onAlwaysDelete,
  onAlwaysMarkRead,
  onWhitelist,
  loading,
  disabled,
}: SenderActionsProps) {
  const isDisabled = loading || disabled;

  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold text-gray-700">Sender Actions</h3>
        <p className="text-xs text-gray-500 truncate">{sender.email}</p>
      </div>
      <button
        onClick={() => onAlwaysDelete(sender.email)}
        disabled={isDisabled}
        className={`w-full py-2 px-4 rounded-lg border text-sm font-medium flex items-center justify-center gap-2 border-red-500 text-red-700 hover:bg-red-50 ${
          isDisabled ? 'opacity-50 cursor-not-allowed' : ''
        }`}
      >
        <Ban className="w-4 h-4" />
        Always Delete Sender
      </button>
      <button
        onClick={() => onAlwaysMarkRead(sender.email)}
        disabled={isDisabled}
        className={`w-full py-2 px-4 rounded-lg border text-sm font-medium flex items-center justify-center gap-2 border-blue-500 text-blue-700 hover:bg-blue-50 ${
          isDisabled ? 'opacity-50 cursor-not-allowed' : ''
        }`}
      >
        <MailOpen className="w-4 h-4" />
        Always Mark Read
      </button>
      <button
        onClick={() => onWhitelist(sender.email)}
        disabled={isDisabled}
        className={`w-full py-2 px-4 rounded-lg border text-sm font-medium flex items-center justify-center gap-2 border-green-500 text-green-700 hover:bg-green-50 ${
          isDisabled ? 'opacity-50 cursor-not-allowed' : ''
        }`}
      >
        <ShieldCheck className="w-4 h-4" />
        Never Delete Sender
      </button>
    </div>
  );
}
