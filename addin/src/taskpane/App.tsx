import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Shield } from 'lucide-react';
import { checkNaaSupport, getAccessToken } from '../auth/authHelper';
import { getMailboxes, getWhitelist, updateWhitelist, createRule, runRule } from '../api/backendClient';
import type { SenderInfo, MailboxInfo } from '../types/index';
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
  const [allMailboxes, setAllMailboxes] = useState<MailboxInfo[]>([]);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusState | null>(null);
  const [loading, setLoading] = useState(false);
  const [isComposeView, setIsComposeView] = useState(false);

  const mailboxesResolved = useRef(false);

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
   * Authenticate and resolve ALL connected mailboxes.
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

    if (mailboxesResolved.current) return;

    try {
      const mailboxes = await getMailboxes();
      const connected = mailboxes.filter((mb) => mb.isConnected);
      setAllMailboxes(connected);
      mailboxesResolved.current = true;

      if (connected.length === 0) {
        setAuthError('No connected mailboxes found in MSEDB');
      }
    } catch (err) {
      setAuthError(`Failed to resolve mailboxes: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  useEffect(() => {
    readSenderInfo();
    authenticateAndResolve();
  }, [readSenderInfo, authenticateAndResolve]);

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
   * Create rule + run it across ALL connected mailboxes.
   */
  const createAndRunInAllMailboxes = useCallback(
    async (
      name: string,
      conditions: Record<string, unknown>,
      actions: Array<{ actionType: string }>,
    ) => {
      const results = await Promise.allSettled(
        allMailboxes.map(async (mb) => {
          const { rule } = await createRule({
            mailboxId: mb.id,
            name,
            conditions,
            actions,
            skipStaging: true,
          });
          const result = await runRule(rule._id);
          return result;
        }),
      );

      let totalApplied = 0;
      let mailboxCount = 0;
      for (const r of results) {
        if (r.status === 'fulfilled') {
          totalApplied += r.value.applied;
          mailboxCount++;
        }
      }

      return { totalApplied, mailboxCount };
    },
    [allMailboxes]
  );

  /**
   * Always Delete — by sender email
   */
  const handleAlwaysDeleteSender = useCallback(
    async (email: string) => {
      setLoading(true);
      setStatus(null);
      try {
        const { totalApplied, mailboxCount } = await createAndRunInAllMailboxes(
          email,
          { senderEmail: email },
          [{ actionType: 'delete' }],
        );
        const mbLabel = mailboxCount > 1 ? ` across ${mailboxCount} mailboxes` : '';
        setStatus({
          type: 'success',
          message: `Rule created for ${email}${mbLabel} — ${totalApplied} emails deleted`,
        });
      } catch (err) {
        setStatus({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      } finally {
        setLoading(false);
      }
    },
    [createAndRunInAllMailboxes]
  );

  /**
   * Always Mark Read — by sender email
   */
  const handleAlwaysMarkReadSender = useCallback(
    async (email: string) => {
      setLoading(true);
      setStatus(null);
      try {
        const { totalApplied, mailboxCount } = await createAndRunInAllMailboxes(
          email,
          { senderEmail: email },
          [{ actionType: 'markRead' }],
        );
        const mbLabel = mailboxCount > 1 ? ` across ${mailboxCount} mailboxes` : '';
        setStatus({
          type: 'success',
          message: `Rule created for ${email}${mbLabel} — ${totalApplied} emails marked read`,
        });
      } catch (err) {
        setStatus({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      } finally {
        setLoading(false);
      }
    },
    [createAndRunInAllMailboxes]
  );

  /**
   * Whitelist sender — add to whitelist on all mailboxes
   */
  const handleWhitelistSender = useCallback(
    async (email: string) => {
      setLoading(true);
      setStatus(null);
      try {
        for (const mb of allMailboxes) {
          const current = await getWhitelist(mb.id);
          const existing = current.senders || [];
          const updated = [...new Set([...existing, email])];
          await updateWhitelist(mb.id, { senders: updated });
        }
        setStatus({ type: 'success', message: `Added ${email} to whitelist` });
      } catch (err) {
        setStatus({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      } finally {
        setLoading(false);
      }
    },
    [allMailboxes]
  );

  /**
   * Always Delete — by domain
   */
  const handleAlwaysDeleteDomain = useCallback(
    async (domain: string) => {
      setLoading(true);
      setStatus(null);
      try {
        const { totalApplied, mailboxCount } = await createAndRunInAllMailboxes(
          `Always delete @${domain}`,
          { senderDomain: domain },
          [{ actionType: 'delete' }],
        );
        const mbLabel = mailboxCount > 1 ? ` across ${mailboxCount} mailboxes` : '';
        setStatus({
          type: 'success',
          message: `Rule created for @${domain}${mbLabel} — ${totalApplied} emails deleted`,
        });
      } catch (err) {
        setStatus({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      } finally {
        setLoading(false);
      }
    },
    [createAndRunInAllMailboxes]
  );

  /**
   * Always Mark Read — by domain
   */
  const handleAlwaysMarkReadDomain = useCallback(
    async (domain: string) => {
      setLoading(true);
      setStatus(null);
      try {
        const { totalApplied, mailboxCount } = await createAndRunInAllMailboxes(
          `Always mark read @${domain}`,
          { senderDomain: domain },
          [{ actionType: 'markRead' }],
        );
        const mbLabel = mailboxCount > 1 ? ` across ${mailboxCount} mailboxes` : '';
        setStatus({
          type: 'success',
          message: `Rule created for @${domain}${mbLabel} — ${totalApplied} emails marked read`,
        });
      } catch (err) {
        setStatus({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      } finally {
        setLoading(false);
      }
    },
    [createAndRunInAllMailboxes]
  );

  /**
   * Whitelist domain
   */
  const handleWhitelistDomain = useCallback(
    async (domain: string) => {
      setLoading(true);
      setStatus(null);
      try {
        for (const mb of allMailboxes) {
          const current = await getWhitelist(mb.id);
          const existing = current.domains || [];
          const updated = [...new Set([...existing, domain])];
          await updateWhitelist(mb.id, { domains: updated });
        }
        setStatus({ type: 'success', message: `Added @${domain} to whitelist` });
      } catch (err) {
        setStatus({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      } finally {
        setLoading(false);
      }
    },
    [allMailboxes]
  );

  const retryAuth = useCallback(() => {
    authenticateAndResolve();
  }, [authenticateAndResolve]);

  const hasMailboxes = allMailboxes.length > 0;

  return (
    <div className="taskpane-container">
      <header className="flex items-center gap-2 pb-3 border-b border-gray-200">
        <Shield className="w-5 h-5 text-blue-600" />
        <h1 className="text-base font-semibold text-gray-900">
          MSEDB Email Manager
        </h1>
        {hasMailboxes && (
          <span className="ml-auto text-xs text-gray-400">
            {allMailboxes.length} mailbox{allMailboxes.length !== 1 ? 'es' : ''}
          </span>
        )}
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
            onAlwaysDelete={handleAlwaysDeleteSender}
            onAlwaysMarkRead={handleAlwaysMarkReadSender}
            onWhitelist={handleWhitelistSender}
            loading={loading}
            disabled={!hasMailboxes || !isAuthReady}
          />

          <DomainActions
            domain={sender.domain}
            onAlwaysDelete={handleAlwaysDeleteDomain}
            onAlwaysMarkRead={handleAlwaysMarkReadDomain}
            onWhitelist={handleWhitelistDomain}
            loading={loading}
            disabled={!hasMailboxes || !isAuthReady}
          />
        </div>
      )}

      {status && (
        <StatusBanner status={status} onDismiss={() => setStatus(null)} />
      )}
    </div>
  );
}
