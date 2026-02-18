# Cloudflare Tunnel Setup for MSEDB

## Overview

MSEDB requires a publicly accessible HTTPS URL to receive real-time webhook notifications from Microsoft Graph API. Cloudflare Tunnel creates a secure tunnel from Cloudflare's edge network to the MSEDB server without opening inbound ports or configuring firewalls.

**Current setup:** Quick Tunnel (temporary, URL changes on restart)
**Target setup:** Named Tunnel with custom domain (permanent, stable URL)

## Server Details

| Item | Value |
|------|-------|
| Server IP | 172.16.219.222 |
| MSEDB Frontend Port | 3010 (HTTPS, self-signed cert) |
| MSEDB Backend Port | 8010 |
| Webhook Path | `/webhooks/graph` |
| Architecture | ARM64 (aarch64) — DGX server |

The frontend nginx reverse-proxies `/webhooks/*` to the backend on port 8010, so the tunnel only needs to point to the frontend on port 3010.

---

## Option A: Named Tunnel with Custom Domain (Recommended)

### Prerequisites

1. A domain managed in Cloudflare DNS (e.g., `aptask.com` or `jobtalk.ai`)
2. Cloudflare account with access to that domain's DNS settings
3. `cloudflared` installed on the server

### Step 1: Install cloudflared (ARM64)

```bash
# Download ARM64 binary
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 \
  -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared
cloudflared --version
```

### Step 2: Authenticate cloudflared

```bash
cloudflared tunnel login
```

This opens a browser URL. Select the domain you want to use (e.g., `aptask.com`). A certificate is saved to `~/.cloudflared/cert.pem`.

### Step 3: Create a Named Tunnel

```bash
cloudflared tunnel create msedb
```

This creates the tunnel and outputs a **Tunnel ID** (UUID). Note it down.
A credentials file is saved to `~/.cloudflared/<TUNNEL-ID>.json`.

### Step 4: Configure DNS

Create a CNAME record pointing your chosen subdomain to the tunnel:

```bash
cloudflared tunnel route dns msedb webhooks.aptask.com
```

This creates a CNAME record: `webhooks.aptask.com` -> `<TUNNEL-ID>.cfargotunnel.com`

### Step 5: Create Tunnel Config

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: <TUNNEL-ID>
credentials-file: /root/.cloudflared/<TUNNEL-ID>.json

ingress:
  - hostname: webhooks.aptask.com
    service: https://localhost:3010
    originRequest:
      noTLSVerify: true    # MSEDB uses self-signed cert
  - service: http_status:404
```

**Note:** `noTLSVerify: true` is needed because MSEDB's nginx uses a self-signed SSL certificate.

### Step 6: Test the Tunnel

```bash
cloudflared tunnel run msedb
```

Verify from any external machine:

```bash
curl -s -X POST "https://webhooks.aptask.com/webhooks/graph?validationToken=test123"
# Should return: test123
```

### Step 7: Run as a systemd Service (Persistent)

```bash
cloudflared service install
systemctl enable cloudflared
systemctl start cloudflared
systemctl status cloudflared
```

This ensures the tunnel starts automatically on boot and survives SSH disconnections.

### Step 8: Update MSEDB

In the MSEDB dashboard (admin only), update the **Webhook Tunnel URL** to:

```
https://webhooks.aptask.com
```

Click **Save & Re-sync** to create new webhook subscriptions with the permanent URL.

Alternatively, update the `.env` file:

```bash
# In /home/admin/claude/MSEDB/.env
GRAPH_WEBHOOK_URL=https://webhooks.aptask.com
```

Then restart: `docker compose up -d msedb-backend`

---

## Option B: Quick Tunnel (Temporary / Development Only)

Quick Tunnels require no Cloudflare account setup but generate a random URL that changes on every restart.

```bash
cloudflared tunnel --url https://localhost:3010 --no-tls-verify
```

Output will show something like:

```
Your quick Tunnel has been created! Visit it at:
https://random-words-here.trycloudflare.com
```

Copy the URL and update it in the MSEDB dashboard webhook card, or in `.env`:

```
GRAPH_WEBHOOK_URL=https://random-words-here.trycloudflare.com
```

**Limitations:**
- URL changes every restart
- Not suitable for production
- No custom domain
- Tunnel dies when process/SSH session ends

---

## Verification Checklist

After setting up the tunnel, verify:

- [ ] Tunnel is running: `systemctl status cloudflared` (or `ps aux | grep cloudflared`)
- [ ] Webhook endpoint responds: `curl -s -X POST "https://YOUR-DOMAIN/webhooks/graph?validationToken=test" ` returns `test`
- [ ] MSEDB backend shows subscriptions created in logs: `docker logs msedb-backend 2>&1 | grep "Subscription sync"`
- [ ] Dashboard shows active subscriptions count > 0 in the Webhook Tunnel URL card

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `502 Bad Gateway` through tunnel | Backend or frontend container not running | `docker compose up -d` |
| `Subscription validation failed` | Tunnel not reachable during subscription creation | Ensure tunnel is running, then re-sync from dashboard |
| `NotFound` on webhook validation | Wrong GRAPH_WEBHOOK_URL (path doubled) | URL should be base only, e.g., `https://webhooks.aptask.com` — the app appends `/webhooks/graph` automatically |
| Tunnel stops after SSH disconnect | Running as foreground process | Install as systemd service (Step 7) |
| `Exec format error` on cloudflared | Wrong binary architecture | Download `cloudflared-linux-arm64` (server is ARM64) |

## Azure AD Redirect URI

The Cloudflare tunnel URL is for **webhooks only**. The Azure AD redirect URI should remain pointed at the direct server address:

```
https://172.16.219.222:3010/auth/callback
```

Do NOT change the Azure AD redirect URI to the tunnel URL.
