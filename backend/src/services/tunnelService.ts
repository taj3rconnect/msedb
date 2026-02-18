import http from 'http';
import https from 'https';
import logger from '../config/logger.js';
import { config } from '../config/index.js';
import { getTunnelConfig } from '../models/TunnelConfig.js';
import { WebhookSubscription } from '../models/WebhookSubscription.js';
import { syncSubscriptionsOnStartup } from './subscriptionService.js';

const DOCKER_SOCKET = '/var/run/docker.sock';
const TUNNEL_CONTAINER = 'msedb-tunnel';

/**
 * Make an HTTP request to the Docker Engine API via Unix socket.
 */
function dockerRequest(
  method: string,
  path: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath: DOCKER_SOCKET,
        path,
        method,
        headers: { 'Content-Type': 'application/json' },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf-8'),
          });
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy(new Error('Docker API request timed out'));
    });
    req.end();
  });
}

/**
 * Parse the Quick Tunnel URL from cloudflared container logs.
 * Returns the LAST match to get the most recent URL after a restart.
 */
function parseTunnelUrl(logs: string): string | null {
  const matches = logs.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g);
  return matches ? matches[matches.length - 1] : null;
}

/**
 * Read the tunnel URL from the cloudflared container logs via Docker API.
 */
export async function getTunnelUrlFromContainer(recentOnly = false): Promise<string | null> {
  try {
    let path = `/containers/${TUNNEL_CONTAINER}/logs?stderr=true&stdout=true&tail=50`;
    if (recentOnly) {
      // Only read logs from the last 30s to avoid stale URLs from previous runs
      const since = Math.floor(Date.now() / 1000) - 30;
      path += `&since=${since}`;
    }
    const res = await dockerRequest('GET', path);
    if (res.status !== 200) {
      logger.warn('Could not read tunnel container logs', {
        status: res.status,
      });
      return null;
    }
    // Docker logs have 8-byte header per frame — strip them
    const clean = res.body.replace(/[\x00-\x09\x0b\x0c\x0e-\x1f]/g, '');
    return parseTunnelUrl(clean);
  } catch (err) {
    logger.warn('Docker socket unavailable for tunnel URL detection', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Check if the current tunnel URL is healthy by hitting the webhook validation endpoint.
 */
export async function checkTunnelHealth(url: string): Promise<boolean> {
  if (!url) return false;

  return new Promise((resolve) => {
    const parsedUrl = new URL(`${url}/webhooks/graph?validationToken=healthcheck`);
    const proto = parsedUrl.protocol === 'https:' ? https : http;

    const req = proto.request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method: 'POST',
        timeout: 8000,
        rejectUnauthorized: false,
      },
      (res: http.IncomingMessage) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8');
          resolve(res.statusCode === 200 && body === 'healthcheck');
        });
      },
    );
    req.end();
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Restart the cloudflared tunnel container via Docker API.
 */
async function restartTunnelContainer(): Promise<boolean> {
  try {
    const res = await dockerRequest(
      'POST',
      `/containers/${TUNNEL_CONTAINER}/restart?t=2`,
    );
    return res.status === 204;
  } catch (err) {
    logger.error('Failed to restart tunnel container', {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Get the full tunnel status: URL from DB, health check, subscription count.
 */
export async function getTunnelStatus() {
  const tunnelConfig = await getTunnelConfig();
  const url = tunnelConfig.webhookUrl || config.graphWebhookUrl;

  const isHealthy = await checkTunnelHealth(url);

  // Update DB with health status
  tunnelConfig.isHealthy = isHealthy;
  tunnelConfig.lastHealthCheck = new Date();
  if (url && !tunnelConfig.webhookUrl) {
    tunnelConfig.webhookUrl = url;
  }
  await tunnelConfig.save();

  const subscriptionCount = await WebhookSubscription.countDocuments({
    status: 'active',
  });

  return {
    url: url || '',
    isHealthy,
    lastHealthCheck: tunnelConfig.lastHealthCheck,
    subscriptionCount,
  };
}

/**
 * Refresh the tunnel: restart container, detect new URL, update DB, re-sync subscriptions.
 */
export async function refreshTunnel() {
  logger.info('Refreshing Cloudflare tunnel...');

  // 1. Restart the container
  const restarted = await restartTunnelContainer();
  if (!restarted) {
    throw new Error('Failed to restart tunnel container');
  }

  // 2. Wait for cloudflared to register the URL (typically ~8s)
  await new Promise((resolve) => setTimeout(resolve, 10000));

  // 3. Parse the new URL from recent container logs only
  const newUrl = await getTunnelUrlFromContainer(true);
  if (!newUrl) {
    throw new Error(
      'Could not detect tunnel URL from container logs. The tunnel may still be starting.',
    );
  }

  // 4. Update DB and runtime config immediately
  const tunnelConfig = await getTunnelConfig();
  tunnelConfig.webhookUrl = newUrl;
  config.graphWebhookUrl = newUrl;

  // 5. Wait for Cloudflare DNS to propagate and tunnel to become healthy
  //    Quick Tunnel DNS can take 30-90s to propagate after URL assignment
  logger.info('Waiting for tunnel DNS to propagate...', { url: newUrl });
  let healthy = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    healthy = await checkTunnelHealth(newUrl);
    if (healthy) {
      logger.info('Tunnel is healthy', { url: newUrl, attempt });
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  if (!healthy) {
    tunnelConfig.isHealthy = false;
    tunnelConfig.lastHealthCheck = new Date();
    await tunnelConfig.save();
    throw new Error(
      'Tunnel URL detected but not responding after 100s. Cloudflare DNS may still be propagating — try again in a minute.',
    );
  }

  // 6. Expire old subscriptions
  await WebhookSubscription.updateMany(
    { status: 'active' },
    { status: 'expired' },
  );

  // 7. Re-sync subscriptions with new URL (tunnel is confirmed healthy)
  const syncResult = await syncSubscriptionsOnStartup();

  // 8. Final status update
  tunnelConfig.isHealthy = true;
  tunnelConfig.lastHealthCheck = new Date();
  await tunnelConfig.save();

  logger.info('Tunnel refresh completed', {
    url: newUrl,
    isHealthy: true,
    sync: syncResult,
  });

  const subscriptionCount = await WebhookSubscription.countDocuments({
    status: 'active',
  });

  return {
    url: newUrl,
    isHealthy: true,
    lastHealthCheck: tunnelConfig.lastHealthCheck,
    subscriptionCount,
    sync: syncResult,
  };
}

/**
 * Manually set the tunnel URL, update DB + runtime config, health check, and re-sync subscriptions.
 */
export async function updateTunnelUrl(url: string) {
  const tunnelConfig = await getTunnelConfig();
  tunnelConfig.webhookUrl = url;
  config.graphWebhookUrl = url;

  const isHealthy = await checkTunnelHealth(url);
  tunnelConfig.isHealthy = isHealthy;
  tunnelConfig.lastHealthCheck = new Date();
  await tunnelConfig.save();

  let syncResult = { total: 0, created: 0, renewed: 0, failed: 0 };

  if (isHealthy) {
    // Expire old subscriptions and re-sync with new URL
    await WebhookSubscription.updateMany(
      { status: 'active' },
      { status: 'expired' },
    );
    syncResult = await syncSubscriptionsOnStartup();
  }

  const subscriptionCount = await WebhookSubscription.countDocuments({
    status: 'active',
  });

  logger.info('Tunnel URL manually updated', {
    url,
    isHealthy,
    subscriptionCount,
  });

  return {
    url,
    isHealthy,
    lastHealthCheck: tunnelConfig.lastHealthCheck,
    subscriptionCount,
    sync: syncResult,
  };
}

/**
 * Initialize tunnel config on server startup.
 * Reads URL from DB, falls back to env, tries to detect from container.
 */
export async function initializeTunnelConfig(): Promise<void> {
  const tunnelConfig = await getTunnelConfig();

  // Priority: DB > env > container detection
  if (tunnelConfig.webhookUrl) {
    config.graphWebhookUrl = tunnelConfig.webhookUrl;
    logger.info('Tunnel URL loaded from DB', { url: tunnelConfig.webhookUrl });
    return;
  }

  if (config.graphWebhookUrl) {
    tunnelConfig.webhookUrl = config.graphWebhookUrl;
    await tunnelConfig.save();
    logger.info('Tunnel URL saved to DB from env', {
      url: config.graphWebhookUrl,
    });
    return;
  }

  // Try to detect from running container
  const containerUrl = await getTunnelUrlFromContainer();
  if (containerUrl) {
    tunnelConfig.webhookUrl = containerUrl;
    await tunnelConfig.save();
    config.graphWebhookUrl = containerUrl;
    logger.info('Tunnel URL detected from container', { url: containerUrl });
  } else {
    logger.warn(
      'No tunnel URL configured — set via dashboard or GRAPH_WEBHOOK_URL env var',
    );
  }
}
