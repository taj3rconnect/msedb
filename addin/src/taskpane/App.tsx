import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Shield } from 'lucide-react';
import { checkNaaSupport, getAccessToken } from '../auth/authHelper';
import { getMailboxes, getWhitelist, updateWhitelist, createRule } from '../api/backendClient';
import type { SenderInfo, WhitelistAction, ActionScope } from '../types/index';
import SenderActions from './components/SenderActions';
import DomainActions from './components/DomainActions';
import StatusBanner from './components/StatusBanner';
import AuthStatus from './components/AuthStatus';

/* global Office */

interface StatusState {
  type: 'success' | 'error';
  message: string;
}

export default function App() {
  const [sender, setSender] = useState<SenderInfo | null>(null);
  const [mailboxId, setMailboxId] = useState<string | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusState | null>(null);
  const [loading, setLoading] = useState(false);
  const [isComposeView, setIsComposeView] = useState(false);

  const mailboxIdRef = useRef<string | null>(null);

  /**
   * Read sender info from the currently selected Outlook item.
   */
  const readSenderInfo = useCallback(() => {
    try {
      const item = Office.context.mailbox.item;

      if (!item) {
        setSender(null);
        setIsComposeView(false);
        return;
      }

      // Check if this is a compose view (item.from is a method in compose, object in read)
      if (typeof item.from === 'function' || !item.from) {
        setSender(null);
        setIsComposeView(true);
        return;
      }

      setIsComposeView(false);
      const from = item.from;
      const email = from.emailAddress.toLowerCase();
      const displayName = from.displayName || email;
      const domain = email.split('@')[1] || '';

      setSender({ email, name: displayName, domain });
    } catch {
      setSender(null);
      setIsComposeView(false);
    }
  }, []);

  /**
   * Authenticate and resolve MSEDB mailbox.
   * Mailbox resolution only happens once; result is cached.
   */
  const authenticateAndResolve = useCallback(async () => {
    setAuthError(null);

    if (!checkNaaSupport()) {
      setAuthError('NAA not supported on this version of Office. Please update to the latest version.');
      return;
    }

    try {
      await getAccessToken();
      setIsAuthReady(true);
    } catch (err) {
      setAuthError(`Authentication failed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    // Only resolve mailbox once
    if (mailboxIdRef.current) {
      setMailboxId(mailboxIdRef.current);
      return;
    }

    try {
      const mailboxes = await getMailboxes();
      const userEmail = Office.context.mailbox.userProfile.emailAddress.toLowerCase();
      const match = mailboxes.find(
        (mb) => mb.email.toLowerCase() === userEmail
      );

      if (match) {
        mailboxIdRef.current = match.id;
        setMailboxId(match.id);
      } else {
        setAuthError(`No matching mailbox found in MSEDB for ${userEmail}`);
      }
    } catch (err) {
      setAuthError(`Failed to resolve mailbox: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  /**
   * Initialize: read sender info, authenticate, and resolve mailbox.
   */
  useEffect(() => {
    readSenderInfo();
    authenticateAndResolve();
  }, [readSenderInfo, authenticateAndResolve]);

  /**
   * Register ItemChanged handler so the taskpane updates when the user selects
   * a different email in Outlook.
   */
  useEffect(() => {
    const onItemChanged = () => {
      readSenderInfo();
      setStatus(null);
    };

    Office.context.mailbox.addHandlerAsync(
      Office.EventType.ItemChanged,
      onItemChanged
    );

    return () => {
      Office.context.mailbox.removeHandlerAsync(
        Office.EventType.ItemChanged
      );
    };
  }, [readSenderInfo]);

  /**
   * Handle whitelist/blacklist actions for sender or domain.
   */
  const handleAction = useCallback(
    async (action: WhitelistAction, scope: ActionScope) => {
      if (!sender || !mailboxId) return;

      setLoading(true);
      setStatus(null);

      const value = scope === 'sender' ? sender.email : sender.domain;

      try {
        if (action === 'whitelist') {
          const current = await getWhitelist(mailboxId);
          const key = scope === 'sender' ? 'senders' : 'domains';
          const existing = current[key] || [];
          const updatedList = [...new Set([...existing, value])];
          await updateWhitelist(mailboxId, { [key]: updatedList });
          setStatus({
            type: 'success',
            message: `Added ${value} to whitelist (never delete)`,
          });
        } else {
          await createRule({
            mailboxId,
            name: `Always delete: ${value}`,
            conditions:
              scope === 'sender'
                ? { senderEmail: value }
                : { senderDomain: value },
            actions: [{ actionType: 'delete' }],
          });
          setStatus({
            type: 'success',
            message: `Created delete rule for ${value}`,
          });
        }
      } catch (err) {
        setStatus({
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setLoading(false);
      }
    },
    [sender, mailboxId]
  );

  const retryAuth = useCallback(() => {
    authenticateAndResolve();
  }, [authenticateAndResolve]);

  return (
    <div className="taskpane-container">
      <header className="flex items-center gap-2 pb-3 border-b border-gray-200">
        <Shield className="w-5 h-5 text-blue-600" />
        <h1 className="text-base font-semibold text-gray-900">
          MSEDB Email Manager
        </h1>
      </header>

      {authError && (
        <AuthStatus error={authError} onRetry={retryAuth} />
      )}

      {!authError && isComposeView && (
        <div className="mt-4 p-3 rounded-lg bg-gray-50 text-sm text-gray-600">
          This add-in works when reading emails. Open or select a received email to use MSEDB actions.
        </div>
      )}

      {!authError && !isComposeView && !sender && (
        <div className="mt-4 p-3 rounded-lg bg-gray-50 text-sm text-gray-600">
          Select an email to use MSEDB actions.
        </div>
      )}

      {!authError && sender && (
        <div className="mt-4 space-y-4">
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-sm font-medium text-gray-900 truncate">
              {sender.name}
            </p>
            <p className="text-xs text-gray-600 truncate">{sender.email}</p>
            <p className="text-xs text-gray-500">@{sender.domain}</p>
          </div>

          <SenderActions
            sender={sender}
            onAction={handleAction}
            loading={loading}
            disabled={!mailboxId || !isAuthReady}
          />

          <DomainActions
            domain={sender.domain}
            onAction={handleAction}
            loading={loading}
            disabled={!mailboxId || !isAuthReady}
          />
        </div>
      )}

      {status && (
        <StatusBanner status={status} onDismiss={() => setStatus(null)} />
      )}
    </div>
  );
}
