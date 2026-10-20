// TODO: Security limitation - This module provides client ID management but does NOT
// implement secure authentication. The clientId is stored in browser localStorage and
// can be trivially forged. Cross-tenant access is possible until the platform implements
// proper session-based or JWT authentication. This matches the existing security model
// used throughout the X-Ray feature set.

const CLIENT_ID_KEY = "polaris-client-id";

export function getClientId(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  
  // Try URL query param first (for multi-window support)
  const urlParams = new URLSearchParams(window.location.search);
  const queryClientId = urlParams.get("clientId");
  
  if (queryClientId) {
    // Update localStorage to match URL
    localStorage.setItem(CLIENT_ID_KEY, queryClientId);
    return queryClientId;
  }
  
  // Fall back to localStorage
  return localStorage.getItem(CLIENT_ID_KEY);
}

export function setClientId(clientId: string): void {
  if (typeof window !== "undefined") {
    localStorage.setItem(CLIENT_ID_KEY, clientId);
  }
}

export function clearClientId(): void {
  if (typeof window !== "undefined") {
    localStorage.removeItem(CLIENT_ID_KEY);
  }
}
