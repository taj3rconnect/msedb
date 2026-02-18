# Azure AD Configuration — MSEDB

## App Registration

| Field | Value |
|-------|-------|
| **App Name** | MSEDB |
| **Tenant ID** | `a6300e5c-dae4-413c-a6d2-646fbc2aa587` |
| **Client ID** | `a4492965-a878-4088-8584-cc68ca8fef0e` |
| **Client Secret ID** | `5bc6434f-6e1b-47f4-bc54-f3b91b670939` |
| **Client Secret Value** | `NLS8Q~3sSMBrIDYKb5I6pQwm~ZdHefwmphhEVdcx` |
| **Redirect URI** | `http://172.16.219.222:8010/auth/callback` |
| **Account Type** | Single tenant |

## Still Needed

- [ ] **Client Secret Value** — The actual secret string (not the Secret ID). Go to Certificates & secrets, create a new secret, and copy the Value column immediately.
- [x] **Admin Email** — `taj@aptask.com`
- [ ] **API Permissions** — Grant admin consent for these delegated permissions:
  - `User.Read`
  - `Mail.ReadWrite`
  - `Mail.Send`
  - `MailboxSettings.ReadWrite`
  - `offline_access`
- [ ] **Redirect URI** — Confirm `http://172.16.219.222:8010/auth/callback` is added under Authentication → Web

## Portal Links

- App registration: https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade
- Direct app link: https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationMenuBlade/~/Overview/appId/a4492965-a878-4088-8584-cc68ca8fef0e

## Environment Variables

These values go in `/home/admin/claude/MSEDB/.env`:

```env
AZURE_AD_TENANT_ID=a6300e5c-dae4-413c-a6d2-646fbc2aa587
AZURE_AD_CLIENT_ID=a4492965-a878-4088-8584-cc68ca8fef0e
AZURE_AD_CLIENT_SECRET=<paste secret value here>
ADMIN_EMAIL=<your Microsoft 365 email>
```
