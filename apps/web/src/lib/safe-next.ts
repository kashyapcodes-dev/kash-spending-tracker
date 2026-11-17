/**
 * Only same-site paths: `next` comes from the URL, so it must not become an open redirect.
 * No backslash and no control character anywhere: browsers strip tabs and newlines, so
 * "/<TAB>/evil.com" would otherwise become "//evil.com".
 */
// eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
const SAFE_PATH = /^\/(?![/\\])[^\\\x00-\x1f\x7f]*$/;

export function safeNext(next: string | undefined): string {
  return next && SAFE_PATH.test(next) ? next : "/app";
}
