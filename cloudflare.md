# Cloudflare Tunnel Setup for MSEDB on aptask.com

This guide sets up a **permanent Cloudflare Tunnel** so `msedb.aptask.com` always points to the MSEDB application — no random URLs, no port forwarding.

---

## Prerequisites

- **aptask.com** must be managed by Cloudflare (DNS on Cloudflare)
- Access to the Cloudflare dashboard for aptask.com
- SSH access to the MSEDB server (`172.16.219.222`)

---

## Step 1: Authorize the Server with Cloudflare

Run this on the MSEDB server:

```bash
mkdir -p /home/admin/claude/MSEDB/.cloudflared

docker run -it --rm \
  -v /home/admin/claude/MSEDB/.cloudflared:/home/nonroot/.cloudflared \
  cloudflare/cloudflared:latest tunnel login
```

**What happens:** It prints a URL. Open that URL in your browser, select `aptask.com`, and click Authorize. A certificate file (`cert.pem`) is saved to `.cloudflared/`.

---

## Step 2: Create a Named Tunnel

```bash
docker run --rm \
  -v /home/admin/claude/MSEDB/.cloudflared:/home/nonroot/.cloudflared \
  cloudflare/cloudflared:latest tunnel create msedb
```

**What happens:** It creates a tunnel and prints a **Tunnel ID** (a UUID like `a1b2c3d4-e5f6-...`). Write this down — you'll need it in the next step.

It also saves a credentials file at `.cloudflared/<TUNNEL_ID>.json`.

---

## Step 3: Create the Config File

Create the file `/home/admin/claude/MSEDB/.cloudflared/config.yml` with this content:

```yaml
tunnel: PASTE_YOUR_TUNNEL_ID_HERE
credentials-file: /home/nonroot/.cloudflared/PASTE_YOUR_TUNNEL_ID_HERE.json

ingress:
  - hostname: msedb.aptask.com
    service: http://msedb-frontend:8081
  - service: http_status:404
```

**Important:** Replace `PASTE_YOUR_TUNNEL_ID_HERE` in both places with the actual Tunnel ID from Step 2.

---

## Step 4: Create the DNS Record

```bash
docker run --rm \
  -v /home/admin/claude/MSEDB/.cloudflared:/home/nonroot/.cloudflared \
  cloudflare/cloudflared:latest tunnel route dns msedb msedb.aptask.com
```

**What happens:** This automatically creates a CNAME record in Cloudflare DNS pointing `msedb.aptask.com` to your tunnel. You can verify in Cloudflare Dashboard > DNS.

---

## Step 5: Update docker-compose.yml

Open `/home/admin/claude/MSEDB/docker-compose.yml` and find the `msedb-tunnel` service. Replace it with:

```yaml
  msedb-tunnel:
    image: cloudflare/cloudflared:latest
    container_name: msedb-tunnel
    command: ["tunnel", "--no-autoupdate", "run", "msedb"]
    volumes:
      - ./.cloudflared:/home/nonroot/.cloudflared:ro
    depends_on:
      msedb-frontend:
        condition: service_healthy
    networks:
      - msedb-network
    restart: unless-stopped
    deploy:
      resources:
        limits:
          cpus: '0.25'
          memory: 128M
```

---

## Step 6: Restart the Application

```bash
cd /home/admin/claude/MSEDB
docker compose up -d
```

---

## Step 7: Update Azure AD (Microsoft App Registration)

1. Go to **Azure Portal** > **App Registrations** > your MSEDB app
2. Go to **Authentication** > **Redirect URIs**
3. Add: `https://msedb.aptask.com/api/auth/callback`
4. Save

---

## Step 8: Update the .env File

Edit `/home/admin/claude/MSEDB/.env` and update these two lines:

```
API_URL=https://msedb.aptask.com/api
FRONTEND_URL=https://msedb.aptask.com
```

Then restart again:

```bash
cd /home/admin/claude/MSEDB
docker compose up -d
```

---

## Step 9: Verify

Open `https://msedb.aptask.com` in your browser. You should see the MSEDB login page.

---

## Quick Reference

| Step | Command / Action | Purpose |
|------|-----------------|---------|
| 1 | `tunnel login` | Authorize server for aptask.com |
| 2 | `tunnel create msedb` | Create permanent tunnel with fixed ID |
| 3 | Create `config.yml` | Map msedb.aptask.com to the app |
| 4 | `tunnel route dns` | Create DNS record automatically |
| 5 | Edit `docker-compose.yml` | Use named tunnel instead of quick tunnel |
| 6 | `docker compose up -d` | Start the tunnel |
| 7 | Azure Portal | Allow OAuth callbacks on new URL |
| 8 | Edit `.env` | Point app config to new domain |
| 9 | Browser test | Confirm everything works |

---

## Troubleshooting

**Tunnel not connecting?**
```bash
docker logs msedb-tunnel
```

**DNS not resolving?**
Check Cloudflare Dashboard > DNS for a CNAME record pointing `msedb` to `<tunnel-id>.cfargotunnel.com`.

**OAuth login failing?**
Make sure the redirect URI in Azure AD exactly matches: `https://msedb.aptask.com/api/auth/callback`
