/** Native clients authenticate with revocable sessions, never browser cookies. */
export const mobileAuthPrefix = '/api/mobile/v1/auth/';
const anonymousActions = new Set(['login', 'register', 'verify-email', 'resend-verification', 'forgot-password', 'reset-password']);

export function isMobileAuthRequest(path: string) {
  return path.startsWith(mobileAuthPrefix) && anonymousActions.has(path.slice(mobileAuthPrefix.length));
}

export function mobileAdminAllowed(method: string, path: string) {
  return (method === 'GET' && ['/api/admin/overview', '/api/admin/images', '/api/admin/quota-requests'].includes(path))
    || (method === 'DELETE' && /^\/api\/admin\/images\/[^/]+$/.test(path))
    || (method === 'PATCH' && /^\/api\/admin\/quota-requests\/[^/]+$/.test(path));
}

export const mobileSessionDays = 30;
