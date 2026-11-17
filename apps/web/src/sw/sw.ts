/**
 * Kash service worker (ADR-0009). Hand-written, compiled to /sw.js by scripts/build-sw.ts.
 *
 * - Static assets (/_next/static, icons): cache-first.
 * - Page navigations: network-first, the last good page for that URL is the offline fallback.
 * - GET /api/v1/{me,budgets...}: stale-while-revalidate, keyed per signed-in user.
 * - Never cached: /api/auth/*, non-GET, error responses, members and invites.
 * - Stored copies expire after 24 h; a 401 or a redirect to sign-in clears every per-user cache.
 * - Sign-out: the page deletes every per-user cache (see lib/pwa.ts) and tells this worker.
 * - A new worker waits; the page shows "Update available" and asks it to take over.
 */
import { isExpired, signalsSignedOut } from "./cache-policy";

declare const __BUILD_ID__: string;
const sw = self as unknown as ServiceWorkerGlobalScope;

const VERSION = __BUILD_ID__;
const STATIC = `kash-static-${VERSION}`;
const META = "kash-meta";
const PRECACHE = [
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];
const CACHED_AT = "x-kash-cached-at";
const USER_KEY = "/__kash/user";

/**
 * Shown when a page was never saved. Self-contained on purpose: it must render with no
 * network, so it cannot depend on any script or stylesheet of the app.
 */
const OFFLINE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline - Kash</title>
<style>body{font:16px system-ui,sans-serif;margin:0;padding:2rem;max-width:24rem;margin-inline:auto}
h1{font-size:1.5rem}p{color:#555}a{color:inherit}</style></head><body>
<h1>You are offline</h1>
<p>This page was not saved on this device. Pages you opened recently while signed in are available offline; reconnect to see anything else.</p>
<p><a href="/app">Try again</a></p></body></html>`;

const offlineResponse = () =>
  new Response(OFFLINE_HTML, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });

const dataCache = (uid: string) => `kash-data-${uid}`;
const pageCache = (uid: string) => `kash-pages-${uid}`;

async function currentUser(): Promise<string | undefined> {
  const meta = await caches.open(META);
  const hit = await meta.match(USER_KEY);
  return hit ? await hit.text() : undefined;
}

async function setUser(uid: string | undefined): Promise<void> {
  const meta = await caches.open(META);
  if (!uid) {
    await meta.delete(USER_KEY);
    return;
  }
  const previous = await currentUser();
  if (previous && previous !== uid) await clearUserCaches();
  await meta.put(USER_KEY, new Response(uid));
}

async function clearUserCaches(): Promise<void> {
  for (const name of await caches.keys())
    if (name.startsWith("kash-data-") || name.startsWith("kash-pages-"))
      await caches.delete(name);
}

/** Add a header saying when the cached copy was stored, so the page can show "as of". */
function stamp(res: Response, at: string): Response {
  const headers = new Headers(res.headers);
  headers.set(CACHED_AT, at);
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

const isCacheableApi = (url: URL) =>
  /^\/api\/v1\/(me|budgets)(\/|$)/.test(url.pathname) &&
  !/\/(members|invites)(\/|$)/.test(url.pathname);

async function notifyUpdated(url: string): Promise<void> {
  for (const client of await sw.clients.matchAll())
    client.postMessage({ type: "data-updated", url });
}

async function staleWhileRevalidate(
  event: FetchEvent,
  uid: string,
): Promise<Response> {
  const cache = await caches.open(dataCache(uid));
  const request = event.request;
  let cached = await cache.match(request);
  if (cached && isExpired(cached.headers.get(CACHED_AT), Date.now())) {
    await cache.delete(request);
    cached = undefined;
  }
  // Read the stored body now: once the page consumes `cached` it can no longer be cloned.
  const cachedText = cached ? await cached.clone().text() : undefined;
  const refresh = (async () => {
    const res = await fetch(request);
    if (signalsSignedOut(res)) {
      await setUser(undefined);
      await clearUserCaches();
      return res;
    }
    if (!res.ok) return res;
    const stored = stamp(res.clone(), String(Date.now()));
    await cache.put(request, stored);
    // Tell the page only after the new copy is stored, so its reload reads the fresh data.
    if (cachedText !== undefined && cachedText !== (await res.clone().text()))
      void notifyUpdated(request.url);
    return res;
  })();
  if (cached) {
    // Serve the stored copy now; the refresh finishes in the background.
    event.waitUntil(refresh.catch(() => undefined));
    return cached;
  }
  return refresh;
}

async function networkFirstPage(
  request: Request,
  uid: string | undefined,
): Promise<Response> {
  try {
    const res = await fetch(request);
    if (signalsSignedOut(res)) {
      // The cookie is gone: the next navigation drops every per-user cache.
      await setUser(undefined);
      await clearUserCaches();
      return res;
    }
    // Only successful pages for a known user are kept; redirects and errors never are.
    if (uid && res.ok && !res.redirected) {
      const cache = await caches.open(pageCache(uid));
      await cache.put(request, stamp(res.clone(), String(Date.now())));
    }
    return res;
  } catch {
    if (uid) {
      const hit = await (await caches.open(pageCache(uid))).match(request);
      if (hit && !isExpired(hit.headers.get(CACHED_AT), Date.now())) return hit;
    }
    return offlineResponse();
  }
}

async function cacheFirst(request: Request): Promise<Response> {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) await cache.put(request, res.clone());
  return res;
}

sw.addEventListener("install", event => {
  event.waitUntil(
    caches
      .open(STATIC)
      .then(cache => cache.addAll(PRECACHE))
      // Do not skipWaiting: the new version takes over on the next launch, or when the
      // page asks for it after the user taps "Update available".
      .catch(() => undefined),
  );
});

sw.addEventListener("activate", event => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys())
        if (name.startsWith("kash-static-") && name !== STATIC)
          await caches.delete(name);
      await sw.clients.claim();
    })(),
  );
});

sw.addEventListener("fetch", event => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== sw.location.origin) return;
  if (url.pathname.startsWith("/api/auth/")) return;

  if (url.pathname.startsWith("/api/")) {
    if (request.method !== "GET") {
      // A successful write makes every cached read for this user suspect: drop them.
      // Widget queries and validation are POSTs that never write, so they keep the cache.
      if (
        url.pathname.startsWith("/api/v1/") &&
        !/\/widgets\/(query|validate)$/.test(url.pathname)
      )
        event.respondWith(
          fetch(request).then(async res => {
            if (res.ok) {
              const uid = await currentUser();
              if (uid) await caches.delete(dataCache(uid));
            }
            return res;
          }),
        );
      return;
    }
    if (!isCacheableApi(url)) return;
    event.respondWith(
      (async () => {
        const uid = await currentUser();
        if (!uid) return fetch(request);
        try {
          return await staleWhileRevalidate(event, uid);
        } catch {
          // Offline and nothing stored.
          return Response.json(
            { error: { code: "internal", message: "You are offline" } },
            { status: 503 },
          );
        }
      })(),
    );
    return;
  }

  if (request.method !== "GET") return;

  if (request.mode === "navigate") {
    event.respondWith(
      currentUser().then(uid => networkFirstPage(request, uid)),
    );
    return;
  }

  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/")
  )
    event.respondWith(cacheFirst(request));
});

interface Message {
  type: string;
  userId?: string;
  urls?: string[];
  /** `warm`: treat non-static urls as pages to cache for offline reload. */
  page?: boolean;
}

sw.addEventListener("message", event => {
  const msg = event.data as Message;
  switch (msg.type) {
    case "skip-waiting":
      void sw.skipWaiting();
      break;
    case "user":
      event.waitUntil(setUser(msg.userId));
      break;
    case "clear":
      event.waitUntil(setUser(undefined).then(clearUserCaches));
      break;
    case "warm":
      // The page loaded before this worker controlled it, so its assets and its own HTML were
      // never intercepted. Fetch them now (mostly served from the HTTP cache).
      event.waitUntil(
        (async () => {
          const uid = await currentUser();
          const statics = await caches.open(STATIC);
          for (const u of msg.urls ?? []) {
            const url = new URL(u, sw.location.origin);
            if (url.origin !== sw.location.origin) continue;
            if (url.pathname.startsWith("/_next/static/")) {
              if (!(await statics.match(url)))
                await statics.add(url).catch(() => undefined);
            } else if (uid && msg.page) {
              await networkFirstPage(
                new Request(url, {
                  credentials: "same-origin",
                  mode: "same-origin",
                }),
                uid,
              ).catch(() => undefined);
            }
          }
        })(),
      );
      break;
  }
});
