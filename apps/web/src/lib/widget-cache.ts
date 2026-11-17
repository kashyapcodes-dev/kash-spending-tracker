import type { QuerySlot } from "@kash/contract";
import { currentCacheEpoch } from "@/lib/pwa";

/**
 * Widget queries are POSTs, which the service worker cannot cache, so the last results are kept
 * here. The cache name starts with `kash-data-`, so sign-out deletes it with the rest (M4).
 */
const NAME = "kash-data-widgets";
const url = (key: string) => `/__kash/widgets/${encodeURIComponent(key)}`;

/** `epoch` is `currentCacheEpoch()` taken when the request started; a sign-out since voids the save. */
export async function saveSlots(
  key: string,
  slots: QuerySlot[],
  epoch: number = currentCacheEpoch(),
) {
  if (epoch !== currentCacheEpoch()) return;
  try {
    const c = await caches.open(NAME);
    // Re-check after the await: sign-out may have run while the cache was opening.
    if (epoch !== currentCacheEpoch()) {
      await caches.delete(NAME);
      return;
    }
    await c.put(url(key), new Response(JSON.stringify(slots)));
  } catch {
    // Cache storage can be unavailable; the dashboard just will not work offline.
  }
}

export async function loadSlots(key: string): Promise<QuerySlot[] | undefined> {
  try {
    const r = await (await caches.open(NAME)).match(url(key));
    return r ? ((await r.json()) as QuerySlot[]) : undefined;
  } catch {
    return undefined;
  }
}
