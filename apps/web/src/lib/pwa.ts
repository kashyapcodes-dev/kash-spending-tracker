"use client";

import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
let cachedAt: number | undefined;

/** `fetch` for the API client: remembers when a response served from the offline cache was saved. */
export const trackedFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  const stamp = Number(res.headers.get("x-kash-cached-at"));
  if (stamp && stamp !== cachedAt && (!cachedAt || stamp > cachedAt)) {
    cachedAt = stamp;
    listeners.forEach(l => l());
  }
  return res;
};

/** When the data on screen was last saved by the service worker, if it came from there. */
export function useCachedAt(): number | undefined {
  return useSyncExternalStore(
    cb => {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    () => cachedAt,
    () => undefined,
  );
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    cb => {
      window.addEventListener("online", cb);
      window.addEventListener("offline", cb);
      return () => {
        window.removeEventListener("online", cb);
        window.removeEventListener("offline", cb);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

/** Ask whichever worker is active to do something. A no-op without a service worker. */
export async function postToWorker(message: unknown): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration();
  reg?.active?.postMessage(message);
}

/**
 * Bumped by every sign-out. A save that started under an older epoch is dropped, so a response
 * arriving while sign-out clears the caches cannot write the signed-out user's data back.
 */
let cacheEpoch = 0;
export const currentCacheEpoch = () => cacheEpoch;

/** Delete everything saved for the signed-in user. Called on sign-out, before leaving the page. */
export async function clearOfflineData(): Promise<void> {
  cacheEpoch++;
  try {
    if ("caches" in window) {
      for (const name of await caches.keys())
        if (name.startsWith("kash-data-") || name.startsWith("kash-pages-"))
          await caches.delete(name);
      await (await caches.open("kash-meta")).delete("/__kash/user");
    }
    cachedAt = undefined;
    await postToWorker({ type: "clear" });
  } catch {
    // Cache storage can be unavailable (private windows); nothing was stored then either.
  }
}

/** Tell page code that cached data was refreshed in the background. */
/** Fired by the review page after accepting or dismissing, so the nav badge refreshes. */
export const STAGED_CHANGED = "kash:staged-changed";
export const DATA_CHANGED = "kash:data-changed";
export const notifyDataChanged = () =>
  window.dispatchEvent(new Event(DATA_CHANGED));
