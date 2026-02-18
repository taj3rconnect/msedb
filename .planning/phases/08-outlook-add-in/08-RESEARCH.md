# Phase 8: Outlook Add-in - Research

**Researched:** 2026-02-17
**Domain:** Office Add-ins (Outlook), Office.js, Azure AD SSO, XML Manifest
**Confidence:** MEDIUM-HIGH

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PLUG-01 | Outlook Add-in shell -- Office Add-in with taskpane and context menu commands, deployed via sideload, communicates with MSEDB backend API | Manifest XML structure with `MessageReadCommandSurface` extension point, `ContextMenu` not available for Outlook (use ribbon buttons + taskpane instead), sideloading via `npm start` or manual upload, Yeoman generator scaffold |
| PLUG-02 | Sender whitelist/blacklist from Outlook -- right-click or taskpane action to mark sender as "never delete" or "always delete", syncs to MSEDB whitelist and creates/updates automation rules | `Office.context.mailbox.item.from` provides sender email/name on read surface; existing backend endpoints `PUT /api/mailboxes/:id/whitelist` for per-mailbox lists, `POST /api/rules` for rule creation; add-in sends Bearer token + payload to backend API |
| PLUG-03 | Domain whitelist/blacklist from Outlook -- same as PLUG-02 at domain level (e.g., mark all @newsletter.com as always delete) | Extract domain from sender email client-side (`email.split('@')[1]`), same backend whitelist endpoints accept `domains[]` array, same rule creation endpoint |
| PLUG-04 | Plugin auth integration -- authenticates via Azure AD SSO using Office.js getAccessTokenAsync(), backend validates token against same Azure AD app registration | Two approaches: Legacy SSO (`OfficeRuntime.auth.getAccessToken`) or NAA (`@azure/msal-browser` with `createNestablePublicClientApplication`). NAA is the modern recommended approach. Both require Azure AD app registration updates: expose API with `access_as_user` scope, pre-authorize Office client IDs, add SPA redirect `brk-multihub://`. Backend validates JWT with `aud` = app ID, `scp` = `access_as_user`, `iss` = `login.microsoftonline.com` |
</phase_requirements>

## Summary

Phase 8 builds an Outlook Add-in as a separate web package that runs inside Outlook (desktop, web, new Outlook) and communicates with the existing MSEDB backend API. The add-in provides a taskpane and ribbon buttons (not context menu -- Outlook does not support the ContextMenu extension point) for users to whitelist or blacklist senders and domains directly from their email reading experience.

The critical technical decision is authentication. Microsoft now recommends **Nested App Authentication (NAA)** with `@azure/msal-browser` over the legacy `OfficeRuntime.auth.getAccessToken()` approach. NAA uses `createNestablePublicClientApplication` to create an MSAL client that runs as a nested app inside Outlook, obtaining tokens silently via the user's existing Office session. The existing Azure AD app registration (created in Phase 2) must be updated to expose a web API with the `access_as_user` scope and pre-authorize Office client application IDs. The backend must add a new middleware that validates SSO tokens (different from the existing JWT cookie-based session tokens) by checking `aud`, `iss`, `scp`, and `preferred_username` claims, then mapping the user to the existing MSEDB User record.

The add-in itself is a small React + TypeScript web app served by webpack-dev-server during development and by the existing nginx container (or a new static hosting path) in production. It uses the XML add-in manifest format (production-ready for Outlook) to declare a `MessageReadCommandSurface` extension point with ribbon buttons. The taskpane provides the UI for sender/domain whitelist/blacklist actions and syncs with the existing MSEDB backend endpoints.

**Primary recommendation:** Use NAA with `@azure/msal-browser` for SSO auth. Use the XML manifest format (stable, production-ready). Build the add-in as a separate package within the monorepo, sharing TypeScript types with the backend. Deploy alongside the existing frontend container.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@azure/msal-browser` | ^3.x | NAA SSO authentication in Office Add-in | Microsoft's recommended auth library for Office Add-ins with NAA support |
| `office-addin-manifest` | latest | Manifest validation and sideloading tooling | Official Microsoft tooling for add-in development |
| React | ^19.0.0 | Taskpane UI framework | Matches existing MSEDB frontend stack for consistency |
| TypeScript | ^5.7.0 | Type safety | Matches existing project configuration |
| Webpack | ^5.x | Bundling for Office Add-in | Standard bundler for Office Add-in projects (Yeoman generator default) |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `webpack-dev-server` | ^5.x | HTTPS dev server with self-signed cert | Development sideloading requires HTTPS |
| `html-webpack-plugin` | ^5.x | Generate HTML entry points (taskpane.html, commands.html) | Required by Office Add-in manifest |
| `office-addin-dev-certs` | latest | Generate trusted self-signed SSL certificates | Development only -- Office requires HTTPS even in dev |
| `tailwindcss` | ^4.0.0 | Styling consistent with MSEDB dashboard | Visual consistency requirement |
| `lucide-react` | ^0.574.0 | Icons consistent with MSEDB dashboard | Visual consistency requirement |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| NAA (recommended) | Legacy SSO (`getAccessToken`) | Legacy SSO is simpler but Microsoft explicitly labels it "legacy" and recommends NAA for modern auth. NAA has wider platform support and uses standard MSAL patterns |
| XML manifest | Unified JSON manifest | JSON manifest is production-ready for Outlook but XML has far more community examples, tooling, and is the Yeoman generator default. JSON manifest adds complexity with no benefit for this use case |
| Webpack | Vite | Vite is used by the main frontend, but Office Add-in tooling (Yeoman, office-addin-dev-certs, sideloading) is built around Webpack. Fighting the toolchain adds risk |
| Separate React app | iframe embedding existing frontend | Add-in has very limited UI needs (a few buttons, status messages). A separate lightweight React app is cleaner than embedding the full dashboard |

**Installation:**
```bash
# In the add-in directory (e.g., /addin)
npm install @azure/msal-browser react react-dom tailwindcss lucide-react
npm install -D typescript webpack webpack-cli webpack-dev-server html-webpack-plugin \
  copy-webpack-plugin css-loader style-loader ts-loader \
  office-addin-dev-certs @types/office-js @types/react @types/react-dom
```

## Architecture Patterns

### Recommended Project Structure
```
addin/
├── manifest.xml              # Office Add-in manifest (XML format)
├── package.json              # Add-in-specific dependencies
├── tsconfig.json             # TypeScript config
├── webpack.config.js         # Webpack config with HTTPS dev server
├── src/
│   ├── taskpane/
│   │   ├── taskpane.html     # Taskpane entry HTML
│   │   ├── taskpane.tsx      # Taskpane React root
│   │   ├── App.tsx           # Main taskpane UI component
│   │   └── components/
│   │       ├── SenderActions.tsx    # Whitelist/blacklist sender UI
│   │       ├── DomainActions.tsx    # Whitelist/blacklist domain UI
│   │       ├── StatusBanner.tsx     # Success/error feedback
│   │       └── AuthStatus.tsx       # SSO status display
│   ├── commands/
│   │   ├── commands.html     # Function commands entry HTML
│   │   └── commands.ts       # Ribbon button ExecuteFunction handlers
│   ├── auth/
│   │   ├── msalConfig.ts     # MSAL NAA configuration
│   │   └── authHelper.ts     # Token acquisition helpers
│   ├── api/
│   │   └── backendClient.ts  # HTTP client for MSEDB backend API
│   └── types/
│       └── index.ts          # Shared types (whitelist, rule, etc.)
├── assets/
│   ├── icon-16.png           # Add-in icon 16x16
│   ├── icon-32.png           # Add-in icon 32x32
│   └── icon-80.png           # Add-in icon 80x80
└── dist/                     # Webpack output
```

### Pattern 1: NAA SSO Token Acquisition
**What:** Authenticate the add-in user via NAA, obtaining a token that the MSEDB backend can validate
**When to use:** Every API call from the add-in to the MSEDB backend

```typescript
// Source: https://learn.microsoft.com/en-us/office/dev/add-ins/develop/enable-nested-app-authentication-in-your-add-in
import { createNestablePublicClientApplication, InteractionRequiredAuthError } from "@azure/msal-browser";

let msalInstance: Awaited<ReturnType<typeof createNestablePublicClientApplication>> | null = null;

async function initMsal(): Promise<void> {
  if (!msalInstance) {
    msalInstance = await createNestablePublicClientApplication({
      auth: {
        clientId: "YOUR_AZURE_AD_CLIENT_ID", // Same as MSEDB app registration
        authority: `https://login.microsoftonline.com/YOUR_TENANT_ID`,
      },
      cache: {
        cacheLocation: "localStorage",
      },
    });
  }
}

async function getAccessToken(): Promise<string> {
  await initMsal();
  const tokenRequest = {
    // Request a token scoped to the MSEDB backend API
    scopes: ["api://YOUR_DOMAIN/YOUR_CLIENT_ID/access_as_user"],
  };

  try {
    const result = await msalInstance!.acquireTokenSilent(tokenRequest);
    return result.accessToken;
  } catch (error) {
    if (error instanceof InteractionRequiredAuthError) {
      const result = await msalInstance!.acquireTokenPopup(tokenRequest);
      return result.accessToken;
    }
    throw error;
  }
}
```

### Pattern 2: Backend SSO Token Validation Middleware
**What:** New Express middleware that validates SSO tokens from the add-in (different from existing cookie-based JWT)
**When to use:** On add-in-specific API routes (or as alternative auth on existing routes)

```typescript
// Source: https://learn.microsoft.com/en-us/office/dev/add-ins/develop/sso-in-office-add-ins
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

const client = jwksClient({
  jwksUri: `https://login.microsoftonline.com/${config.azureAdTenantId}/discovery/v2.0/keys`,
});

function getKey(header: jwt.JwtHeader, callback: jwt.SigningKeyCallback): void {
  client.getSigningKey(header.kid!, (err, key) => {
    callback(err, key?.getPublicKey());
  });
}

export async function requireSsoAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    throw new UnauthorizedError('No Bearer token');
  }
  const token = authHeader.substring(7);

  return new Promise((resolve, reject) => {
    jwt.verify(token, getKey, {
      audience: config.azureAdClientId,  // or api://domain/client-id
      issuer: `https://login.microsoftonline.com/${config.azureAdTenantId}/v2.0`,
      algorithms: ['RS256'],
    }, async (err, decoded) => {
      if (err) {
        reject(new UnauthorizedError('Invalid SSO token'));
        return;
      }
      const payload = decoded as { preferred_username: string; oid: string; scp: string };
      if (payload.scp !== 'access_as_user') {
        reject(new UnauthorizedError('Invalid scope'));
        return;
      }
      // Map SSO user to MSEDB user
      const user = await User.findOne({ email: payload.preferred_username.toLowerCase() });
      if (!user) {
        reject(new UnauthorizedError('User not found in MSEDB'));
        return;
      }
      req.user = { userId: user._id.toString(), email: user.email, role: user.role };
      resolve();
      next();
    });
  });
}
```

### Pattern 3: Reading Current Email Sender in Outlook
**What:** Access the currently selected email's sender info from the add-in
**When to use:** When the taskpane opens or when a ribbon button is clicked

```typescript
// Source: https://learn.microsoft.com/en-us/javascript/api/outlook/office.messageread
function getCurrentEmailSender(): { email: string; name: string; domain: string } | null {
  const item = Office.context.mailbox.item;
  if (!item) return null;

  const from = item.from;
  const email = from.emailAddress.toLowerCase();
  const domain = email.split('@')[1];

  return {
    email,
    name: from.displayName,
    domain,
  };
}
```

### Pattern 4: Manifest XML for Outlook MessageReadCommandSurface
**What:** Declare ribbon buttons on the message read surface
**When to use:** In manifest.xml

```xml
<!-- Source: https://learn.microsoft.com/en-us/office/dev/add-ins/develop/create-addin-commands -->
<ExtensionPoint xsi:type="MessageReadCommandSurface">
  <OfficeTab id="TabDefault">
    <Group id="msedb.msgReadGroup">
      <Label resid="GroupLabel" />
      <Control xsi:type="Button" id="msedb.showTaskpane">
        <Label resid="TaskpaneButtonLabel" />
        <Supertip>
          <Title resid="TaskpaneButtonLabel" />
          <Description resid="TaskpaneButtonTip" />
        </Supertip>
        <Icon>
          <bt:Image size="16" resid="Icon.16x16" />
          <bt:Image size="32" resid="Icon.32x32" />
          <bt:Image size="80" resid="Icon.80x80" />
        </Icon>
        <Action xsi:type="ShowTaskpane">
          <SourceLocation resid="Taskpane.Url" />
        </Action>
      </Control>
    </Group>
  </OfficeTab>
</ExtensionPoint>
```

### Anti-Patterns to Avoid
- **Caching SSO tokens client-side:** Office caches tokens internally. Calling `getAccessToken`/`acquireTokenSilent` is cheap. Caching yourself risks leaking tokens.
- **Using ContextMenu extension point for Outlook:** `ContextMenu` is only supported in Word, Excel, PowerPoint, and OneNote -- NOT Outlook. Use `MessageReadCommandSurface` ribbon buttons instead.
- **Embedding the full MSEDB dashboard in the taskpane:** The taskpane is narrow (320px-450px) and should only contain the sender/domain actions, not the entire dashboard. Keep it focused.
- **Creating a separate Azure AD app registration for the add-in:** Use the SAME app registration as the MSEDB backend. Just add the SPA redirect and expose the API. This ensures the SSO token's `aud` claim matches what the backend expects.
- **Hard-coding backend URL in add-in:** Use environment variables injected at build time via webpack DefinePlugin.
- **Calling Graph API from the add-in client:** The add-in does NOT need to call Graph API directly. It only calls the MSEDB backend API, which already has Graph API access.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SSL certificates for dev | Manual openssl cert generation | `office-addin-dev-certs` | Handles OS trust store registration, auto-cleanup, platform differences |
| Token validation | Manual JWT parsing/verification | `jsonwebtoken` + `jwks-rsa` | JWKS key rotation, RS256 signature verification, claim validation are complex |
| MSAL initialization for Office | Custom OAuth flow in Office | `createNestablePublicClientApplication` from `@azure/msal-browser` | NAA handles the nested broker protocol with Office host automatically |
| Manifest XML authoring from scratch | Write 200+ lines of XML by hand | Yeoman generator (`yo office`) then customize | Generator produces valid, tested manifest with correct namespace declarations |
| Sideloading tooling | Manual manifest upload | `npm start` via office-addin-dev-server | Automates sideloading across desktop and web Outlook |

**Key insight:** The Office Add-in ecosystem has very specific tooling requirements (HTTPS everywhere, XML manifest schemas, JWKS validation). Fighting these patterns wastes time and introduces subtle bugs.

## Common Pitfalls

### Pitfall 1: CORS Rejection from Add-in to Backend
**What goes wrong:** The add-in runs in a different origin than the MSEDB backend (e.g., `https://localhost:3000` vs `http://172.16.219.222:8010`). The backend CORS config only allows `config.appUrl` (the frontend).
**Why it happens:** The existing CORS middleware in `security.ts` restricts `origin` to `config.appUrl` which is the dashboard URL.
**How to avoid:** Update the CORS configuration to allow the add-in origin as well. Use an array of allowed origins: `[config.appUrl, config.addinUrl]`. In production, the add-in may be served from the same domain or a specific subdomain.
**Warning signs:** Network tab shows `403` or CORS preflight failures on add-in API calls.

### Pitfall 2: SSO Token vs Session JWT Confusion
**What goes wrong:** The add-in sends a Bearer token but the existing `requireAuth` middleware expects an httpOnly cookie (`msedb_session`). The request is rejected.
**Why it happens:** Two different auth mechanisms: cookies for the web dashboard, Bearer tokens for the add-in.
**How to avoid:** Create a `requireSsoAuth` middleware that checks the `Authorization: Bearer` header and validates the SSO token. Use a "try SSO then try cookie" composite middleware if routes should accept both, or mount add-in routes separately.
**Warning signs:** `401 No session token` errors when the add-in makes API calls.

### Pitfall 3: Mailbox ID Resolution
**What goes wrong:** The add-in knows the user's email but not which MSEDB mailbox ID to use for whitelist/rule operations. The backend endpoints require a `mailboxId`.
**Why it happens:** The add-in SSO token provides `preferred_username` (email) but the backend needs `mailboxId` from MongoDB.
**How to avoid:** Add an endpoint (or reuse `/auth/me`) that the add-in can call to get the user's mailboxes by email. The add-in should match `Office.context.mailbox.userProfile.emailAddress` to find the correct mailbox. Cache the mailboxId in the taskpane's state after the first lookup.
**Warning signs:** The add-in cannot determine which mailbox to operate on, or operates on the wrong one.

### Pitfall 4: Office.js Not Initialized Before Use
**What goes wrong:** Code tries to access `Office.context.mailbox.item` before `Office.onReady()` resolves.
**Why it happens:** React renders before Office.js is initialized, or MSAL init races with Office init.
**How to avoid:** Call `Office.onReady()` before rendering the React app. Gate all Office API usage behind the ready state.
**Warning signs:** `Office is not defined` or `Cannot read property 'mailbox' of undefined` errors.

### Pitfall 5: Manifest Validation Failures on Sideload
**What goes wrong:** The add-in fails to sideload because the manifest XML has schema errors or missing required elements.
**Why it happens:** XML manifest has strict schema requirements (namespace declarations, element ordering, resource IDs).
**How to avoid:** Use `npx office-addin-manifest validate manifest.xml` before sideloading. Start from Yeoman generator output and modify incrementally.
**Warning signs:** "Invalid manifest" error in the sideload dialog, no error detail provided.

### Pitfall 6: NAA Not Supported on Older Office Versions
**What goes wrong:** `createNestablePublicClientApplication` throws an error on older Office versions that lack NAA support.
**Why it happens:** NAA requires the `NestedAppAuth 1.1` requirement set which is not available on all Office platforms.
**How to avoid:** Check `Office.context.requirements.isSetSupported("NestedAppAuth", "1.1")` before using NAA. Implement a fallback using legacy `OfficeRuntime.auth.getAccessToken()` or dialog-based auth.
**Warning signs:** `getAccessToken` throws error code 13012 (NAA not supported), add-in shows blank taskpane.

## Code Examples

### Complete Taskpane React Component

```typescript
// Source: Synthesized from Microsoft Learn docs and existing MSEDB patterns
import React, { useState, useEffect } from 'react';
import { getAccessToken } from '../auth/authHelper';

interface SenderInfo {
  email: string;
  name: string;
  domain: string;
}

export function App() {
  const [sender, setSender] = useState<SenderInfo | null>(null);
  const [mailboxId, setMailboxId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Read current email's sender
    const item = Office.context.mailbox.item;
    if (item?.from) {
      const email = item.from.emailAddress.toLowerCase();
      setSender({
        email,
        name: item.from.displayName,
        domain: email.split('@')[1],
      });
    }

    // Resolve mailbox ID
    resolveMailboxId();
  }, []);

  async function resolveMailboxId() {
    try {
      const token = await getAccessToken();
      const res = await fetch(`${BACKEND_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      const outlookEmail = Office.context.mailbox.userProfile.emailAddress.toLowerCase();
      const match = data.mailboxes.find(
        (mb: { email: string }) => mb.email === outlookEmail
      );
      if (match) setMailboxId(match.id);
    } catch (err) {
      setStatus('Failed to resolve mailbox');
    }
  }

  async function handleAction(type: 'whitelist' | 'blacklist', scope: 'sender' | 'domain') {
    if (!sender || !mailboxId) return;
    setLoading(true);
    try {
      const token = await getAccessToken();
      const value = scope === 'sender' ? sender.email : sender.domain;

      if (type === 'whitelist') {
        // Add to whitelist
        const current = await fetch(`${BACKEND_URL}/api/mailboxes/${mailboxId}/whitelist`, {
          headers: { Authorization: `Bearer ${token}` },
        }).then(r => r.json());

        const key = scope === 'sender' ? 'senders' : 'domains';
        const updated = [...new Set([...current[key], value])];

        await fetch(`${BACKEND_URL}/api/mailboxes/${mailboxId}/whitelist`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ [key]: updated }),
        });
        setStatus(`Added ${value} to whitelist (never delete)`);
      } else {
        // Blacklist = create a delete rule
        await fetch(`${BACKEND_URL}/api/rules`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            mailboxId,
            name: `Always delete: ${value}`,
            conditions: scope === 'sender'
              ? { senderEmail: value }
              : { senderDomain: value },
            actions: [{ actionType: 'delete' }],
          }),
        });
        setStatus(`Created delete rule for ${value}`);
      }
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  if (!sender) return <div>Select an email to use MSEDB actions.</div>;

  return (
    <div>
      <h3>MSEDB Actions</h3>
      <p>Sender: {sender.name} ({sender.email})</p>
      <p>Domain: @{sender.domain}</p>

      <h4>Sender Actions</h4>
      <button onClick={() => handleAction('whitelist', 'sender')} disabled={loading}>
        Never Delete (Whitelist Sender)
      </button>
      <button onClick={() => handleAction('blacklist', 'sender')} disabled={loading}>
        Always Delete (Blacklist Sender)
      </button>

      <h4>Domain Actions</h4>
      <button onClick={() => handleAction('whitelist', 'domain')} disabled={loading}>
        Never Delete Domain
      </button>
      <button onClick={() => handleAction('blacklist', 'domain')} disabled={loading}>
        Always Delete Domain
      </button>

      {status && <p>{status}</p>}
    </div>
  );
}
```

### Azure AD App Registration Updates Required

```
1. Go to Azure Portal > App Registrations > MSEDB

2. Authentication > Add Platform > Single-page application
   - Add redirect URI: brk-multihub://localhost:3000 (dev)
   - Add redirect URI: brk-multihub://msedb-api.yourdomain.com (production)

3. Expose an API > Set Application ID URI
   - Set to: api://localhost:3000/<client-id> (dev) or api://msedb-api.yourdomain.com/<client-id> (prod)

4. Expose an API > Add a scope
   - Scope name: access_as_user
   - Who can consent: Admins and users
   - Admin consent display name: "Access MSEDB as current user"
   - Admin consent description: "Allow the Outlook add-in to access MSEDB APIs as the current user"
   - State: Enabled

5. Expose an API > Add authorized client applications
   - Client ID: ea5a67f6-b6f3-4338-b240-c655ddc3cc8e (all Microsoft Office endpoints)
   - Authorized scopes: check access_as_user

6. Manifest > Set requestedAccessTokenVersion to 2
```

### Manifest XML Template

```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<OfficeApp
  xmlns="http://schemas.microsoft.com/office/appforoffice/1.1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:bt="http://schemas.microsoft.com/office/officeappbasictypes/1.0"
  xmlns:mailappor="http://schemas.microsoft.com/office/mailappversionoverrides/1.0"
  xsi:type="MailApp">

  <Id>GENERATE-A-GUID-HERE</Id>
  <Version>1.0.0.0</Version>
  <ProviderName>MSEDB</ProviderName>
  <DefaultLocale>en-US</DefaultLocale>
  <DisplayName DefaultValue="MSEDB Email Manager" />
  <Description DefaultValue="Manage email whitelist and blacklist rules from Outlook" />
  <IconUrl DefaultValue="https://localhost:3000/assets/icon-32.png" />
  <HighResolutionIconUrl DefaultValue="https://localhost:3000/assets/icon-80.png" />
  <SupportUrl DefaultValue="https://msedb.yourdomain.com/help" />

  <Hosts>
    <Host Name="Mailbox" />
  </Hosts>

  <Requirements>
    <Sets>
      <Set Name="Mailbox" MinVersion="1.3" />
    </Sets>
  </Requirements>

  <FormSettings>
    <Form xsi:type="ItemRead">
      <DesktopSettings>
        <SourceLocation DefaultValue="https://localhost:3000/taskpane.html" />
        <RequestedHeight>250</RequestedHeight>
      </DesktopSettings>
    </Form>
  </FormSettings>

  <Permissions>ReadItem</Permissions>
  <Rule xsi:type="RuleCollection" Mode="Or">
    <Rule xsi:type="ItemIs" ItemType="Message" FormType="Read" />
  </Rule>

  <DisableEntityHighlighting>true</DisableEntityHighlighting>

  <VersionOverrides xmlns="http://schemas.microsoft.com/office/mailappversionoverrides" xsi:type="VersionOverridesV1_0">
    <VersionOverrides xmlns="http://schemas.microsoft.com/office/mailappversionoverrides/1.1" xsi:type="VersionOverridesV1_1">
      <Requirements>
        <bt:Sets DefaultMinVersion="1.3">
          <bt:Set Name="Mailbox" />
        </bt:Sets>
      </Requirements>

      <Hosts>
        <Host xsi:type="MailHost">
          <DesktopFormFactor>
            <FunctionFile resid="Commands.Url" />

            <ExtensionPoint xsi:type="MessageReadCommandSurface">
              <OfficeTab id="TabDefault">
                <Group id="msedb.msgReadGroup">
                  <Label resid="GroupLabel" />
                  <Control xsi:type="Button" id="msedb.showTaskpane">
                    <Label resid="TaskpaneLabel" />
                    <Supertip>
                      <Title resid="TaskpaneLabel" />
                      <Description resid="TaskpaneTip" />
                    </Supertip>
                    <Icon>
                      <bt:Image size="16" resid="Icon.16x16" />
                      <bt:Image size="32" resid="Icon.32x32" />
                      <bt:Image size="80" resid="Icon.80x80" />
                    </Icon>
                    <Action xsi:type="ShowTaskpane">
                      <SourceLocation resid="Taskpane.Url" />
                    </Action>
                  </Control>
                </Group>
              </OfficeTab>
            </ExtensionPoint>
          </DesktopFormFactor>
        </Host>
      </Hosts>

      <Resources>
        <bt:Images>
          <bt:Image id="Icon.16x16" DefaultValue="https://localhost:3000/assets/icon-16.png" />
          <bt:Image id="Icon.32x32" DefaultValue="https://localhost:3000/assets/icon-32.png" />
          <bt:Image id="Icon.80x80" DefaultValue="https://localhost:3000/assets/icon-80.png" />
        </bt:Images>
        <bt:Urls>
          <bt:Url id="Commands.Url" DefaultValue="https://localhost:3000/commands.html" />
          <bt:Url id="Taskpane.Url" DefaultValue="https://localhost:3000/taskpane.html" />
        </bt:Urls>
        <bt:ShortStrings>
          <bt:String id="GroupLabel" DefaultValue="MSEDB" />
          <bt:String id="TaskpaneLabel" DefaultValue="Email Manager" />
        </bt:ShortStrings>
        <bt:LongStrings>
          <bt:String id="TaskpaneTip" DefaultValue="Open MSEDB to whitelist or blacklist this sender" />
        </bt:LongStrings>
      </Resources>

      <WebApplicationInfo>
        <Id>YOUR_AZURE_AD_CLIENT_ID</Id>
        <Resource>api://localhost:3000/YOUR_AZURE_AD_CLIENT_ID</Resource>
        <Scopes>
          <Scope>openid</Scope>
          <Scope>profile</Scope>
        </Scopes>
      </WebApplicationInfo>
    </VersionOverrides>
  </VersionOverrides>
</OfficeApp>
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Legacy SSO (`OfficeRuntime.auth.getAccessToken`) | NAA with `@azure/msal-browser` `createNestablePublicClientApplication` | 2024-2025 | NAA is now the recommended approach; legacy SSO docs are labeled "legacy" |
| Exchange identity tokens | NAA with MSAL.js | Deprecated March 2026 | Exchange identity tokens being retired; MUST use NAA or legacy SSO |
| XML-only manifest | Unified JSON manifest (production for Outlook) | 2024 | JSON manifest available for Outlook production, but XML remains dominant in tooling |
| Yeoman generator (`yo office`) | Still current but Teams Toolkit also supported | 2024-2025 | Yeoman generator remains the standard CLI tool for Office Add-in scaffolding |

**Deprecated/outdated:**
- **Exchange identity tokens:** Being retired March 2026. All add-ins must migrate to NAA or legacy SSO.
- **`Office.context.auth.getAccessTokenAsync()`:** Replaced by `OfficeRuntime.auth.getAccessToken()` (legacy) or MSAL NAA (modern).
- **`getAccessTokenAsync` method name:** The current method is `getAccessToken` (without Async suffix) on `OfficeRuntime.auth`.

## Open Questions

1. **Production hosting of add-in static files**
   - What we know: During development, webpack-dev-server serves the add-in files over HTTPS. In production, the files need to be served over HTTPS from a URL accessible to Outlook.
   - What's unclear: Should the add-in files be served from the existing nginx frontend container (adding a `/addin/` path), or from a separate container, or from the backend via static file serving?
   - Recommendation: Serve from the existing nginx frontend container by adding an `/addin/` location block. This avoids adding another container and keeps deployment simple. The add-in files are static HTML/JS/CSS.

2. **Blacklist implementation: rule creation vs dedicated blacklist field**
   - What we know: The backend has a whitelist concept (senders/domains that are protected from automation) but no explicit "blacklist" field. A blacklist would mean "always delete."
   - What's unclear: Should blacklisting create a Rule via `POST /api/rules`, or should a dedicated blacklist field be added to the Mailbox model?
   - Recommendation: Use the existing rule creation endpoint (`POST /api/rules`) to create a delete rule for the blacklisted sender/domain. This is simpler, reuses existing infrastructure, and the rule appears in the Rules page for management.

3. **Same-origin vs cross-origin in production**
   - What we know: In dev, the add-in runs on `https://localhost:3000` and the backend on `http://localhost:8010` -- cross-origin. In production with Cloudflare Tunnel, both could be on the same domain with different paths.
   - What's unclear: Will the add-in be on `msedb.yourdomain.com/addin/` (same origin as frontend) or a separate subdomain?
   - Recommendation: Serve from the frontend domain (`msedb.yourdomain.com/addin/`) to simplify CORS. Update manifest URLs to match.

## Sources

### Primary (HIGH confidence)
- [Enable single sign-on in an Office Add-in with nested app authentication](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/enable-nested-app-authentication-in-your-add-in) -- NAA implementation, MSAL configuration, code examples (updated 2026-01-23)
- [Enable legacy Office SSO in an Office Add-in](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/sso-in-office-add-ins) -- Legacy SSO flow, token validation, access token format (updated 2026-02-12)
- [Register an Office Add-in that uses SSO with Microsoft identity platform](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/register-sso-add-in-aad-v2) -- Azure AD setup: expose API, access_as_user scope, pre-authorize Office clients (updated 2026-01-23)
- [Create add-in commands with add-in only manifest](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/create-addin-commands) -- Manifest XML structure, ExtensionPoint types, Control/Action patterns (updated 2025-12-12)
- [Sideload Outlook add-ins for testing](https://learn.microsoft.com/en-us/office/dev/add-ins/outlook/sideload-outlook-add-ins-for-testing) -- Sideloading process, npm start automation (updated 2025-12-12)

### Secondary (MEDIUM confidence)
- [Office.MessageRead interface](https://learn.microsoft.com/en-us/javascript/api/outlook/office.messageread) -- `item.from` property for sender access
- [Outlook Add-in SSO NAA code sample](https://github.com/OfficeDev/Office-Add-in-samples/tree/main/Samples/auth/Outlook-Add-in-SSO-NAA) -- Reference implementation
- [Outlook Add-in SSO NAA Identity sample](https://github.com/OfficeDev/Office-Add-in-samples/tree/main/Samples/auth/Outlook-Add-in-SSO-NAA-Identity) -- Identity claim forwarding pattern
- [NestedAppAuth requirement set](https://learn.microsoft.com/en-us/javascript/api/requirement-sets/common/nested-app-auth-requirement-sets) -- Platform support matrix

### Tertiary (LOW confidence)
- ContextMenu NOT supported for Outlook -- confirmed by Microsoft docs listing supported extension points for Outlook (MessageReadCommandSurface, MessageComposeCommandSurface) but need to validate that no workaround exists for right-click context menus
- Pre-authorized Office client ID `ea5a67f6-b6f3-4338-b240-c655ddc3cc8e` -- from Microsoft docs, covers all Office endpoints

## Metadata

**Confidence breakdown:**
- Standard stack: MEDIUM-HIGH -- NAA approach is well-documented by Microsoft with official code samples, but is relatively new (2024-2025) and the team has no prior Office Add-in experience
- Architecture: HIGH -- Add-in project structure follows established Yeoman generator patterns; manifest XML format is stable and well-documented
- Pitfalls: HIGH -- CORS, auth middleware separation, and Office.js initialization issues are well-known patterns from Microsoft docs and community issues
- Azure AD configuration: HIGH -- Microsoft provides exact steps and client IDs for pre-authorization; matches existing MSEDB app registration

**Research date:** 2026-02-17
**Valid until:** 2026-03-17 (30 days -- Office Add-in APIs are stable; NAA is production-ready)
