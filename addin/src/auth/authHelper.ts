import { InteractionRequiredAuthError } from '@azure/msal-browser';
import { initMsal, getMsalInstance, tokenRequest } from './msalConfig.js';

/* global Office */

/**
 * Check if the current Office host supports Nested App Authentication (NAA).
 * NAA requires the NestedAppAuth 1.1 requirement set.
 * Returns false on older Office versions that lack NAA support.
 */
export function checkNaaSupport(): boolean {
  try {
    return Office.context.requirements.isSetSupported('NestedAppAuth', '1.1');
  } catch {
    return false;
  }
}

/**
 * Acquire an access token for the MSEDB backend API.
 *
 * Flow:
 * 1. Initialize MSAL (idempotent)
 * 2. Try silent token acquisition (cached or refreshable)
 * 3. On interaction required, fall back to popup
 * 4. On other errors, throw with descriptive message
 *
 * @returns The access token string
 * @throws Error if token acquisition fails
 */
export async function getAccessToken(): Promise<string> {
  await initMsal();
  const msal = getMsalInstance();

  try {
    const result = await msal.acquireTokenSilent(tokenRequest);
    return result.accessToken;
  } catch (error) {
    if (error instanceof InteractionRequiredAuthError) {
      try {
        const result = await msal.acquireTokenPopup(tokenRequest);
        return result.accessToken;
      } catch (popupError) {
        throw new Error(
          `Token acquisition via popup failed: ${popupError instanceof Error ? popupError.message : String(popupError)}`
        );
      }
    }
    throw new Error(
      `Token acquisition failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Check if the user is currently authenticated.
 * Attempts silent token acquisition and returns true if successful.
 */
export async function isAuthenticated(): Promise<boolean> {
  try {
    await getAccessToken();
    return true;
  } catch {
    return false;
  }
}
