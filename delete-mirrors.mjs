import mongoose from 'mongoose';
import { readFileSync } from 'fs';

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://msedb-mongo:27017/msedb';
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

const mailboxSchema = new mongoose.Schema({ email: String, msalCache: String });
const Mailbox = mongoose.model('Mailbox', mailboxSchema);

async function getToken(mailboxId) {
  const { ConfidentialClientApplication } = await import('@azure/msal-node');
  const mb = await Mailbox.findById(mailboxId).lean();
  if (!mb?.msalCache) throw new Error('no cache');
  const app = new ConfidentialClientApplication({ auth: {
    clientId: process.env.AZURE_AD_CLIENT_ID,
    clientSecret: process.env.AZURE_AD_CLIENT_SECRET,
    authority: `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}`,
  }});
  app.getTokenCache().deserialize(mb.msalCache);
  const accounts = await app.getTokenCache().getAllAccounts();
  if (!accounts.length) throw new Error('no accounts');
  const r = await app.acquireTokenSilent({ account: accounts[0], scopes: ['https://graph.microsoft.com/.default'] });
  return { token: r.accessToken, email: mb.email };
}

async function run() {
  await mongoose.connect(MONGO_URI);
  const pairs = JSON.parse(readFileSync('/app/mirror_events.json', 'utf8'));
  console.log(`Deleting ${pairs.length} mirror events...`);

  const tokenCache = {};
  let deleted = 0, gone = 0, failed = 0;

  for (const { mirrorEventId, targetMailboxId } of pairs) {
    const key = targetMailboxId.toString();
    if (!tokenCache[key]) {
      try { tokenCache[key] = await getToken(key); }
      catch (e) { console.error(`Token failed for ${key}: ${e.message}`); tokenCache[key] = null; }
    }
    const info = tokenCache[key];
    if (!info) { failed++; continue; }

    const url = `${GRAPH_BASE}/users/${encodeURIComponent(info.email)}/events/${encodeURIComponent(mirrorEventId)}`;
    try {
      const res = await fetch(url, { method: 'DELETE', headers: { Authorization: `Bearer ${info.token}` } });
      if (res.status === 404 || res.status === 204 || res.ok) {
        if (res.status === 404) { gone++; } else { deleted++; }
      } else {
        const b = await res.text();
        console.error(`FAIL ${res.status}: ${b.slice(0,100)}`);
        failed++;
      }
    } catch (e) { console.error(`ERR: ${e.message}`); failed++; }
  }

  console.log(`\nDeleted: ${deleted}, Already gone: ${gone}, Failed: ${failed}`);
  await mongoose.disconnect();
}

run().catch(e => { console.error(e); process.exit(1); });
