/** Cache rules for the service worker (M9 scope 12), pure so they can be unit-tested. */

export const MAX_CACHE_AGE_MS = 24 * 3_600_000;

/** A stored copy older than 24 h (or with no stamp at all) is never served. */
export function isExpired(
  cachedAt: string | null,
  now: number,
  maxAge = MAX_CACHE_AGE_MS,
): boolean {
  const at = Number(cachedAt);
  return !cachedAt || !Number.isFinite(at) || now - at > maxAge;
}

/**
 * The server saying "you are signed out": a 401, or a navigation that ended on the sign-in
 * page. The session cookie is HttpOnly, so the worker cannot read it; this is how it learns
 * the session is gone, and then it drops every per-user cache.
 */
export function signalsSignedOut(res: {
  status: number;
  redirected: boolean;
  url: string;
}): boolean {
  if (res.status === 401) return true;
  if (!res.redirected) return false;
  try {
    return new URL(res.url).pathname.startsWith("/sign-in");
  } catch {
    return false;
  }
}
