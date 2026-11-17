import { expect, test, type Page } from "@playwright/test";
import { addCategory, addRow, signUp } from "./helpers";

/** Wait until the service worker has saved this page's HTML and API reads for offline use. */
async function waitForOfflineCache(page: Page, paths: string[]) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect
    .poll(
      () =>
        page.evaluate(async (wanted: string[]) => {
          const names = await caches.keys();
          const pages = names.find(n => n.startsWith("kash-pages-"));
          const data = names.find(n => n.startsWith("kash-data-"));
          if (!pages || !data) return false;
          const pageKeys = (await (await caches.open(pages)).keys()).map(
            r => new URL(r.url).pathname,
          );
          const dataKeys = (await (await caches.open(data)).keys()).length;
          return wanted.every(p => pageKeys.includes(p)) && dataKeys > 0;
        }, paths),
      { timeout: 20_000 },
    )
    .toBe(true);
}

test.describe("mobile", () => {
  test.use({ viewport: { width: 360, height: 740 }, hasTouch: true });

  test("M4-E-4 no horizontal scroll on any main screen, and the bottom nav works", async ({
    page,
  }) => {
    const { budgetId } = await signUp(page, "mobile");
    await addCategory(
      page,
      budgetId,
      "A rather long category name for narrow screens",
    );
    await page.goto(`/b/${budgetId}/expenses`);
    await addRow(page, 1, {
      name: "An expense with a name that is long enough to stress a narrow layout",
      amount: "12.34",
      category: "A rather long category name for narrow screens",
    });
    await page.getByRole("button", { name: "Save expenses" }).click();
    await expect(
      page.getByRole("cell", {
        name: "An expense with a name that is long enough to stress a narrow layout",
        exact: true,
      }),
    ).toBeVisible();

    const screens = [
      "dashboard",
      "expenses",
      "incomes",
      "categories",
      "compare",
      "settings",
    ];
    for (const screen of screens) {
      await page.goto(`/b/${budgetId}/${screen}`);
      await expect(
        page.getByRole("heading", { level: 1 }).first(),
      ).toBeVisible();
      await page.waitForLoadState("networkidle");
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(
        scrollWidth,
        `${screen} overflows horizontally`,
      ).toBeLessThanOrEqual(clientWidth);
    }

    // Bottom navigation.
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav).toBeVisible();
    await page.goto(`/b/${budgetId}/dashboard`);
    await nav.getByRole("link", { name: "Categories" }).click();
    await expect(page).toHaveURL(/\/categories$/);
    await nav.getByRole("link", { name: "Compare" }).click();
    await expect(page).toHaveURL(/\/compare$/);

    // Touch targets: every visible control in the nav and header is at least 44px tall.
    for (const el of await nav.getByRole("link").all()) {
      const box = await el.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    await page.goto(`/b/${budgetId}/categories`);
    // Wait for late-appearing controls (the chat button) so the list of buttons is stable.
    await expect(page.getByRole("button", { name: "Ask Kash" })).toBeVisible();
    await page.waitForLoadState("networkidle");
    for (const el of await page.getByRole("button").all()) {
      const box = await el.boundingBox();
      if (box) expect(box.height).toBeGreaterThanOrEqual(43.5);
    }
  });

  test("M4-E-5 quick add: a repeat category takes four interactions", async ({
    page,
  }) => {
    const { budgetId } = await signUp(page, "quick");
    await addCategory(page, budgetId, "Groceries");
    await page.goto(`/b/${budgetId}/dashboard`);

    // First time: the category has to be picked.
    await page.getByRole("button", { name: "Add expense" }).click();
    const sheet = page.getByRole("dialog", { name: "Quick add expense" });
    await sheet.getByLabel("Amount").fill("5.25");
    await sheet.getByLabel("Name").fill("Coffee beans");
    await sheet.getByLabel("Category").selectOption({ label: "Groceries" });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByRole("cell", { name: "Coffee beans", exact: true }),
    ).toBeVisible();

    // Second time: the category is remembered. Count every interaction.
    let interactions = 0;
    await page.getByRole("button", { name: "Add expense" }).click();
    interactions++;
    await sheet.getByLabel("Amount").fill("3.10");
    interactions++;
    await sheet.getByLabel("Name").fill("Milk");
    interactions++;
    await expect(sheet.getByLabel("Category")).toHaveValue(/.+/); // remembered, not touched
    await page.getByRole("button", { name: "Save", exact: true }).click();
    interactions++;
    await expect(
      page.getByRole("cell", { name: "Milk", exact: true }),
    ).toBeVisible();
    expect(interactions).toBeLessThanOrEqual(4);

    // Save and add another keeps the sheet open and the category.
    await page.getByRole("button", { name: "Add expense" }).click();
    await sheet.getByLabel("Amount").fill("1.00");
    await sheet.getByLabel("Name").fill("Bread");
    await page.getByRole("button", { name: "Save and add another" }).click();
    await expect(page.getByText("Saved. Add another.")).toBeVisible();
    await expect(sheet.getByLabel("Amount")).toHaveValue("");
    await page.getByRole("button", { name: "Close" }).click();
    await expect(
      page.getByRole("cell", { name: "Bread", exact: true }),
    ).toBeVisible();

    // The manifest shortcut opens the sheet.
    await page.goto("/app?quickadd=1");
    await expect(
      page.getByRole("dialog", { name: "Quick add expense" }),
    ).toBeVisible();
  });
});

test("M4-E-6 offline: the dashboard renders from cache, writes are disabled, going online refreshes", async ({
  page,
  context,
}) => {
  const { budgetId } = await signUp(page, "offline");
  await page.goto(`/b/${budgetId}/expenses`);
  await addRow(page, 1, { name: "Cached lunch", amount: "9.99" });
  await page.getByRole("button", { name: "Save expenses" }).click();
  await expect(
    page.getByRole("cell", { name: "Cached lunch", exact: true }),
  ).toBeVisible();
  await page.goto(`/b/${budgetId}/dashboard`);
  await expect(
    page.getByRole("cell", { name: "Cached lunch", exact: true }),
  ).toBeVisible();
  await page.goto(`/b/${budgetId}/expenses`);
  await expect(
    page.getByRole("cell", { name: "Cached lunch", exact: true }),
  ).toBeVisible();
  await waitForOfflineCache(page, [`/b/${budgetId}/expenses`]);
  await page.goto(`/b/${budgetId}/dashboard`);
  await expect(
    page.getByRole("cell", { name: "Cached lunch", exact: true }),
  ).toBeVisible();
  await waitForOfflineCache(page, [
    `/b/${budgetId}/dashboard`,
    `/b/${budgetId}/expenses`,
  ]);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText(/Offline\. Showing saved data/)).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Cached lunch", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Add expense" })).toHaveCount(
    0,
  );

  await page.goto(`/b/${budgetId}/expenses`);
  await expect(
    page.getByText(/You are offline\. Adding is disabled/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save expenses" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("cell", { name: "Cached lunch", exact: true }),
  ).toBeVisible();

  // Something changes on the server while we are away; coming back online shows it.
  await context.setOffline(false);
  const created = await page.request.post(
    `/api/v1/budgets/${budgetId}/transactions`,
    {
      headers: { "sec-fetch-site": "same-origin" },
      data: {
        items: [
          {
            type: "expense",
            name: "Added while away",
            amountCents: 700,
            date: "2026-11-05",
          },
        ],
      },
    },
  );
  expect(created.status()).toBe(201);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByText(/Offline\. Showing saved data/)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Save expenses" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("cell", { name: "Added while away", exact: true }),
  ).toBeVisible();
});

test("M4-E-7 after sign-out nothing is cached, so offline shows no budget data", async ({
  page,
  context,
}) => {
  const { budgetId } = await signUp(page, "signedout");
  await page.goto(`/b/${budgetId}/dashboard`);
  await waitForOfflineCache(page, [`/b/${budgetId}/dashboard`]);

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(/\/sign-in/);
  const leftovers = await page.evaluate(async () =>
    (await caches.keys()).filter(
      n => n.startsWith("kash-data-") || n.startsWith("kash-pages-"),
    ),
  );
  expect(leftovers).toEqual([]);

  await context.setOffline(true);
  await page.goto("/app");
  await expect(
    page.getByRole("heading", { name: "You are offline" }),
  ).toBeVisible();
  await page.goto(`/b/${budgetId}/dashboard`);
  await expect(
    page.getByRole("heading", { name: "You are offline" }),
  ).toBeVisible();
  await expect(page.getByText("My Budget")).toHaveCount(0);
});

test("M4-E-8 installability: valid manifest, registered worker, no installability errors", async ({
  page,
}) => {
  await page.goto("/sign-in");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href).toBeTruthy();
  const res = await page.request.get(href ?? "");
  expect(res.status()).toBe(200);
  const manifest = (await res.json()) as {
    name: string;
    short_name: string;
    start_url: string;
    display: string;
    theme_color: string;
    background_color: string;
    icons: { src: string; sizes: string; type: string; purpose?: string }[];
    shortcuts: { name: string; url: string }[];
  };
  expect(manifest).toMatchObject({ name: "Kash", display: "standalone" });
  expect(manifest.short_name).toBeTruthy();
  expect(manifest.theme_color).toMatch(/^#/);
  expect(manifest.background_color).toMatch(/^#/);
  const sizes = manifest.icons.map(i => i.sizes);
  expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  expect(manifest.icons.some(i => i.purpose === "maskable")).toBe(true);
  for (const icon of manifest.icons) {
    const r = await page.request.get(icon.src);
    expect(r.status()).toBe(200);
    expect(r.headers()["content-type"]).toContain("image/png");
  }
  expect(manifest.shortcuts[0]).toMatchObject({ name: "Add expense" });
  expect(
    await page.locator('link[rel="apple-touch-icon"]').getAttribute("href"),
  ).toBeTruthy();
  expect(
    await page.locator('meta[name="apple-mobile-web-app-capable"]').count(),
  ).toBeGreaterThan(0);

  const scope = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    return reg.scope;
  });
  expect(scope).toBe(new URL("/", page.url()).href);

  // Chromium's own installability check (the criteria behind the install prompt).
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Page.enable");
  const { installabilityErrors } = (await cdp.send(
    "Page.getInstallabilityErrors",
  )) as {
    installabilityErrors: { errorId: string }[];
  };
  expect(installabilityErrors).toEqual([]);
});
