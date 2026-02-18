import {
  createNestablePublicClientApplication,
  type IPublicClientApplication,
} from '@azure/msal-browser';

/* Webpack DefinePlugin globals */
declare const AZURE_AD_CLIENT_ID: string;
declare const AZURE_AD_TENANT_ID: string;
declare const ADDIN_DOMAIN: string;

/**
 * MSAL configuration for NAA (Nested App Authentication) in the Outlook add-in.
 * Uses the same Azure AD app registration as the MSEDB backend.
 */
export const msalConfig = {
  auth: {
    clientId: AZURE_AD_CLIENT_ID,
    authority: `https://login.microsoftonline.com/${AZURE_AD_TENANT_ID}`,
  },
  cache: {
    cacheLocation: 'localStorage' as const,
  },
};

/**
 * Token request scopes targeting the MSEDB backend API.
 * The scope format matches the Azure AD "Expose an API" configuration:
 * api://{domain}/{clientId}/access_as_user
 */
export const tokenRequest = {
  scopes: [`api://${ADDIN_DOMAIN}/${AZURE_AD_CLIENT_ID}/access_as_user`],
};

let msalInstance: IPublicClientApplication | null = null;

/**
 * Initialize the MSAL instance using NAA (Nested App Authentication).
 * This creates a nestable public client that runs within the Office host.
 * Idempotent -- safe to call multiple times.
 */
export async function initMsal(): Promise<void> {
  if (!msalInstance) {
    msalInstance = await createNestablePublicClientApplication(msalConfig);
  }
}

/**
 * Get the initialized MSAL instance.
 * Throws if initMsal() has not been called.
 */
export function getMsalInstance(): IPublicClientApplication {
  if (!msalInstance) {
    throw new Error(
      'MSAL not initialized. Call initMsal() before getMsalInstance().'
    );
  }
  return msalInstance;
}
