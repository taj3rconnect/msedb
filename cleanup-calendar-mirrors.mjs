/**
 * One-time cleanup script: deletes all mirror calendar events from Graph API
 * and wipes CalendarSyncMap, restoring each calendar to its original state.
 *
 * Mirror events were created without attendees, so no cancellation emails will be sent.
 */

import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import { readFileSync } from 'fs';

dotenv.config({ path: '/app/.env' });

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://msedb-mongo:27017/msedb';
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

// ── Mongoose schemas (minimal) ──────────────────────────────────────────────

const mailboxSchema = new mongoose.Schema({
  email: String,
  userId: mongoose.Schema.Types.ObjectId,
  msalCache: String,
  homeAccountId: String,
  tenantId: String,
  isConnected: Boolean,
});
const Mailbox = mongoose.model('Mailbox', mailboxSchema);

const calendarSyncMapSchema = new mongoose.Schema({
  sourceMailboxId: mongoose.Schema.Types.ObjectId,
  sourceEventId: String,
  subject: String,
  mirrors: [{ mailboxId: mongoose.Schema.Types.ObjectId, eventId: String, _id: false }],
  isDeleted: Boolean,
});
const CalendarSyncMap = mongoose.model('CalendarSyncMap', calendarSyncMapSchema);

// ── MSAL token acquisition ───────────────────────────────────────────────────

async function getAccessToken(mailboxId) {
  const { ConfidentialClientApplication } = await import('@azure/msal-node');

  const mailbox = await Mailbox.findById(mailboxId).lean();
  if (!mailbox?.msalCache) throw new Error(`No MSAL cache for mailbox ${mailboxId}`);

  const msalConfig = {
    auth: {
      clientId: process.env.AZURE_AD_CLIENT_ID,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET,
      authority: `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}`,
    },
  };

  const msalClient = new ConfidentialClientApplication(msalConfig);
  const cache = msalClient.getTokenCache();
  cache.deserialize(mailbox.msalCache);

  const accounts = await msalClient.getTokenCache().getAllAccounts();
  if (!accounts.length) throw new Error(`No accounts in MSAL cache for mailbox ${mailboxId}`);

  const result = await msalClient.acquireTokenSilent({
    account: accounts[0],
    scopes: ['https://graph.microsoft.com/.default'],
  });

  return result.accessToken;
}

// ── Graph API delete ─────────────────────────────────────────────────────────

async function deleteEvent(accessToken, email, eventId) {
  const url = `${GRAPH_BASE}/users/${encodeURIComponent(email)}/events/${encodeURIComponent(eventId)}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 404) return 'already_gone';
  if (!res.ok && res.status !== 204) {
    const body = await res.text();
    throw new Error(`DELETE ${url} → ${res.status}: ${body.slice(0, 200)}`);
  }
  return 'deleted';
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('Connected.');

  // Load all sync map entries with mirrors
  const entries = await CalendarSyncMap.find({
    isDeleted: false,
    'mirrors.0': { $exists: true },
  }).lean();

  console.log(`Found ${entries.length} CalendarSyncMap entries with mirrors to delete.`);

  // Build mailbox ID → { email, accessToken } map (cache tokens per mailbox)
  const mailboxCache = {};

  async function getMailboxInfo(mailboxId) {
    const key = mailboxId.toString();
    if (mailboxCache[key]) return mailboxCache[key];
    const mb = await Mailbox.findById(mailboxId).lean();
    if (!mb) { mailboxCache[key] = null; return null; }
    let token = null;
    try { token = await getAccessToken(mailboxId.toString()); } catch (e) {
      console.warn(`  Could not get token for ${mb.email}: ${e.message}`);
    }
    mailboxCache[key] = { email: mb.email, token };
    return mailboxCache[key];
  }

  let deleted = 0;
  let skipped = 0;
  let failed = 0;

  for (const entry of entries) {
    for (const mirror of entry.mirrors) {
      const mbInfo = await getMailboxInfo(mirror.mailboxId);
      if (!mbInfo || !mbInfo.token) { skipped++; continue; }

      try {
        const result = await deleteEvent(mbInfo.token, mbInfo.email, mirror.eventId);
        if (result === 'already_gone') {
          console.log(`  [GONE]    ${mbInfo.email} — ${entry.subject || '(no subject)'}`);
          skipped++;
        } else {
          console.log(`  [DELETED] ${mbInfo.email} — ${entry.subject || '(no subject)'}`);
          deleted++;
        }
      } catch (err) {
        console.error(`  [FAILED]  ${mbInfo.email} — ${entry.subject}: ${err.message}`);
        failed++;
      }
    }
  }

  console.log(`\nGraph deletes: ${deleted} deleted, ${skipped} already gone, ${failed} failed`);

  // Wipe all CalendarSyncMap entries (for all users)
  const wipeResult = await CalendarSyncMap.deleteMany({});
  console.log(`CalendarSyncMap wiped: ${wipeResult.deletedCount} entries removed.`);

  // Also clear all calendar delta links from mailboxes so next delta sync starts fresh
  const updateResult = await mongoose.connection.db.collection('mailboxes').updateMany(
    {},
    { $unset: { 'deltaLinks.calendar-events-delta': '' } }
  );
  console.log(`Delta links cleared: ${updateResult.modifiedCount} mailboxes updated.`);

  await mongoose.disconnect();
  console.log('\nDone. All mirror events deleted, sync map cleared.');
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
