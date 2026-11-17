import type { ErrorCode } from "@kash/contract";

/** Domain error. Route handlers map `code` to an HTTP status via `ERROR_STATUS`. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

/**
 * `instanceof` alone is not enough: Next can bundle this module twice (the instrumentation
 * entry and the route chunks), giving two `AppError` classes.
 */
export const isAppError = (e: unknown): e is AppError =>
  e instanceof AppError ||
  (e instanceof Error && e.name === "AppError" && "code" in e);

export const unauthenticated = () =>
  new AppError("unauthenticated", "Sign in required");
export const forbidden = () =>
  new AppError("forbidden", "Your role does not allow this");
export const notFound = (what = "Resource") =>
  new AppError("not_found", `${what} not found`);
export const conflict = (message: string) => new AppError("conflict", message);
export const validationFailed = (message: string, details?: unknown) =>
  new AppError("validation_failed", message, details);
export const encryptionNotConfigured = () =>
  new AppError(
    "encryption_not_configured",
    "APP_ENCRYPTION_KEY is not set on this instance",
  );
export const providerNotConfigured = (provider: string) =>
  new AppError(
    "provider_not_configured",
    `${provider} is not configured on this instance`,
  );

/** Remove credentials from text bound for a log: URL userinfo, bearer tokens, Kash tokens. */
export function scrubSecrets(text: string): string {
  return text
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]*@/gi, "$1[redacted]@")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/kash_[A-Za-z0-9_-]{8,}/g, "kash_[redacted]")
    .replace(/(secret|password|token|key)=([^\s&]+)/gi, "$1=[redacted]");
}

/** Raw errors go to the server log only, scrubbed. Never store or return them. */
export function logError(label: string, e: unknown): void {
  const text = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  console.error(`[kash] ${label}: ${scrubSecrets(text).slice(0, 500)}`);
}

/** A short, safe error code: letters, digits and underscores only, else "error". */
export function safeCode(e: unknown): string {
  const c =
    typeof e === "object" && e !== null && "code" in e
      ? String((e as { code: unknown }).code)
      : "";
  return /^[A-Za-z0-9_]{1,32}$/.test(c) ? c : "error";
}
